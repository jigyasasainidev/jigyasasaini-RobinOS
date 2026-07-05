// ============================================================
// PROCESS-WEBHOOK-WORKER — async queue orchestrator (M4)
// ============================================================
// URL:  POST /functions/v1/process-webhook-worker[?action=...]
// Auth: NONE — service_role only via Edge Function Secrets.
// JWT:  verify_jwt = false (set in supabase/config.toml)
//
// Invocation modes:
//   ?action=process (default)  — process up to N pending events
//                                 in one batch. Bounded by
//                                 max_runtime_ms. Used by cron.
//   ?action=health             — return queue stats only; do
//                                 not process anything.
//
// The actual per-row work happens in the process_webhook_event()
// SQL RPC (migration 56). This function is the orchestrator:
//   - Generates a worker_id
//   - Emits structured logs at start, per-row, heartbeat, end
//   - Enforces wall-clock deadline
//   - Handles RPC-level (catastrophic) errors by breaking the loop
//     gracefully
//   - Schedules retries on transient per-row failures (the SQL
//     function handles classification + schedule_webhook_retry
//     internally)
//
// Concurrency protection:
//   - Each process_webhook_event() call uses FOR UPDATE SKIP LOCKED,
//     so two concurrent workers can never claim the same row.
//   - Stale locks (locked_at older than 5 minutes) are recoverable
//     by the next worker.
//
// Idempotency:
//   - Per-row operations are atomic in SQL.
//   - retry_webhook_event (admin RPC) resets a dead-letter row
//     to status='received' so the worker re-processes it.
//
// What this worker does NOT do (out of M4 scope):
//   - Resolve products / users / purchases (M5+)
//   - Grant entitlements (M6)
//   - Handle refunds / disputes (M7, M8)
//   - Affiliate commissions (M10)
//   - Send emails
//
// The worker stops at status='verified' (the M5+ handoff point).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ── Env ─────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    JSON.stringify({
      fn: "process-webhook-worker",
      event: "STARTUP_MISCONFIGURED",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !SERVICE_KEY,
      },
      ts: Date.now(),
    }),
  );
}

// ── Tunables ────────────────────────────────────────────────
// Defaults match the M3 design doc §6.3. Override via query params.

const DEFAULT_BATCH_SIZE     = 50;
const DEFAULT_MAX_RUNTIME_MS = 25000;
const HEARTBEAT_INTERVAL_MS  = 5000;
const HARD_TIMEOUT_MS        = 30000; // never exceed this even if max_runtime_ms is higher

// ── Structured logging ─────────────────────────────────────
// All log lines are JSON with: fn, event, worker_id, ts.
// NEVER include: buyer email, raw payload, decrypted secret,
// provided signature, or full row data.

// ── Response builders ──────────────────────────────────────

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── Helpers ────────────────────────────────────────────────

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ── Health action ──────────────────────────────────────────

interface QueueStats {
  received_count: number;
  failed_retryable_count: number;
  failed_retryable_due_now: number;
  processing_count: number;
  verified_count: number;
  failed_terminal_count: number;
  awaiting_admin_count: number;
  queue_depth: number;
  oldest_pending_received_at: string | null;
  oldest_pending_age_seconds: number | null;
  queried_at: string;
}

async function handleHealth(
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await supabase.rpc("get_webhook_queue_stats");
  if (error) {
    console.error(JSON.stringify({
      fn: "process-webhook-worker",
      event: "HEALTH_RPC_FAILED",
      error_message: error.message,
      ts: Date.now(),
    }));
    return jsonResponse(500, {
      error: "queue_stats_unavailable",
      message: error.message,
    });
  }
  const stats = data as QueueStats;
  console.info(JSON.stringify({
    fn: "process-webhook-worker",
    event: "HEALTH_OK",
    queue_depth: stats.queue_depth,
    received_count: stats.received_count,
    failed_retryable_due_now: stats.failed_retryable_due_now,
    processing_count: stats.processing_count,
    verified_count: stats.verified_count,
    failed_terminal_count: stats.failed_terminal_count,
    oldest_pending_age_seconds: stats.oldest_pending_age_seconds,
    ts: Date.now(),
  }));
  return jsonResponse(200, stats);
}

// ── Process action ─────────────────────────────────────────

interface BatchSummary {
  worker_id: string;
  batch_size_requested: number;
  max_runtime_ms: number;
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  timed_out: boolean;
  iterations: number;
  processed_count: number;
  awaiting_claim_count: number;
  failed_terminal_count: number;
  failed_retryable_count: number;
  no_op_count: number;
  queue_empty_at_iteration: number | null;
  rpc_failure: { iteration: number; error: string } | null;
}

interface ProcessResult {
  success: boolean;
  action: string;
  webhook_event_id: string;
  provider_id: string;
  provider_event_type?: string;
  standardized_event_type?: string;
  event_mapping_confidence?: string;
  trace_id?: string;
  lock_id?: string;
  error?: string;
  classification?: string;
}

async function handleProcess(
  supabase: ReturnType<typeof createClient>,
  workerId: string,
  batchSize: number,
  maxRuntimeMs: number,
  deadline: number,
): Promise<{ summary: BatchSummary; response: Response }> {
  const startTime = Date.now();
  const summary: BatchSummary = {
    worker_id: workerId,
    batch_size_requested: batchSize,
    max_runtime_ms: maxRuntimeMs,
    started_at: new Date(startTime).toISOString(),
    finished_at: "",
    elapsed_ms: 0,
    timed_out: false,
    iterations: 0,
    processed_count: 0,
    awaiting_claim_count: 0,
    failed_terminal_count: 0,
    failed_retryable_count: 0,
    no_op_count: 0,
    queue_empty_at_iteration: null,
    rpc_failure: null,
  };

  logEvent("info", "WORKER_START", workerId, {
    batch_size: batchSize,
    max_runtime_ms: maxRuntimeMs,
  });

  // Heartbeat — periodic structured log while the batch runs.
  const heartbeat = setInterval(() => {
    logEvent("info", "WORKER_HEARTBEAT", workerId, {
      elapsed_ms: Date.now() - startTime,
      iterations: summary.iterations,
      processed_count: summary.processed_count,
      failed_terminal_count: summary.failed_terminal_count,
      failed_retryable_count: summary.failed_retryable_count,
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    while (Date.now() < deadline && summary.iterations < batchSize) {
      summary.iterations++;

      let result: ProcessResult | null;
      try {
        const { data, error } = await supabase.rpc("process_webhook_event");
        if (error) throw error;
        result = data as ProcessResult | null;
      } catch (err) {
        // Catastrophic RPC failure (DB unreachable, network drop).
        // The SQL function is designed to catch per-row errors and
        // return structured results; reaching here means the RPC
        // itself failed. Log and break the loop. The cron will
        // retry on the next tick.
        logEvent("error", "WORKER_RPC_FAILED", workerId, {
          iteration: summary.iterations,
          error_message: errMsg(err),
        });
        summary.rpc_failure = {
          iteration: summary.iterations,
          error: errMsg(err),
        };
        break;
      }

      if (result === null) {
        // Queue is empty.
        summary.queue_empty_at_iteration = summary.iterations;
        logEvent("info", "WORKER_QUEUE_EMPTY", workerId, {
          iterations: summary.iterations,
        });
        break;
      }

      // Per-row structured logging. Mirrors the SQL action field.
      const eventLogFields: Record<string, unknown> = {
        webhook_event_id: result.webhook_event_id,
        provider_id: result.provider_id,
        trace_id: result.trace_id,
        lock_id: result.lock_id,
      };

      if (result.action === "processed") {
        // M6: terminal success — webhook validation + M5 resolution +
        // M6 record_purchase + M6 grant_entitlement all succeeded.
        // The row is now at status='processed' and the buyer has an
        // active RobinOS entitlement for the provider-defined duration.
        summary.processed_count++;
        eventLogFields.provider_event_type = result.provider_event_type;
        eventLogFields.standardized_event_type = result.standardized_event_type;
        eventLogFields.event_mapping_confidence = result.event_mapping_confidence;
        if (result.resolution_outcome) {
          eventLogFields.resolution_outcome = result.resolution_outcome;
        }
        if (result.linked_user_id) {
          eventLogFields.linked_user_id = result.linked_user_id;
        }
        if (result.linked_purchase_id) {
          eventLogFields.linked_purchase_id = result.linked_purchase_id;
        }
        if (result.plan) {
          eventLogFields.plan = result.plan;
        }
        if (result.expires_at) {
          eventLogFields.expires_at = result.expires_at;
        }
        if (typeof result.duration_days === "number") {
          eventLogFields.duration_days = result.duration_days;
        }
        logEvent("info", "WORKER_ROW_PROCESSED", workerId, eventLogFields);
      } else if (result.action === "awaiting_claim") {
        // M5: guest buyer — no RobinOS account matched. The row
        // transitioned to status='awaiting_claim' for M9 to handle.
        // This is a SUCCESS for M5 (identity resolution is complete
        // and the row is in the correct downstream state).
        summary.awaiting_claim_count++;
        eventLogFields.provider_event_type = result.provider_event_type;
        eventLogFields.standardized_event_type = result.standardized_event_type;
        eventLogFields.event_mapping_confidence = result.event_mapping_confidence;
        if (result.resolution_outcome) {
          eventLogFields.resolution_outcome = result.resolution_outcome;
        }
        logEvent("info", "WORKER_ROW_AWAITING_CLAIM", workerId, eventLogFields);
      } else if (result.action === "failed_terminal") {
        summary.failed_terminal_count++;
        eventLogFields.error = result.error;
        eventLogFields.classification = result.classification;
        logEvent("error", "WORKER_ROW_FAILED_TERMINAL", workerId, eventLogFields);
      } else if (result.action === "failed_retryable") {
        summary.failed_retryable_count++;
        eventLogFields.error = result.error;
        eventLogFields.classification = result.classification;
        logEvent("warn", "WORKER_ROW_RETRY_SCHEDULED", workerId, eventLogFields);
      } else {
        // Unknown action: should not happen. Log and continue.
        summary.no_op_count++;
        eventLogFields.result = result;
        logEvent("error", "WORKER_ROW_UNKNOWN_ACTION", workerId, eventLogFields);
      }
    }

    if (Date.now() >= deadline) {
      logEvent("warn", "WORKER_DEADLINE_REACHED", workerId, {
        iterations: summary.iterations,
        processed_count: summary.processed_count,
      });
    } else if (summary.iterations >= batchSize) {
      logEvent("info", "WORKER_BATCH_FULL", workerId, {
        iterations: summary.iterations,
        processed_count: summary.processed_count,
      });
    }
  } finally {
    // Graceful shutdown — always clean up, even on exception.
    clearInterval(heartbeat);
    summary.finished_at = new Date().toISOString();
    summary.elapsed_ms = Date.now() - startTime;
    summary.timed_out = summary.elapsed_ms >= maxRuntimeMs;
    logEvent("info", "WORKER_DONE", workerId, summary);
  }

  return {
    summary,
    response: jsonResponse(200, summary),
  };
}

// ── Logging helper ─────────────────────────────────────────

function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  workerId: string,
  meta: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    fn: "process-webhook-worker",
    event,
    worker_id: workerId,
    ts: Date.now(),
    ...meta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

// ── Main handler ───────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // 1. OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
      },
    });
  }

  // 2. Method check
  if (req.method !== "POST") {
    return emptyResponse(405);
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") ?? "process").toLowerCase();

  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Dispatch by action
  if (action === "health") {
    return await handleHealth(supabase);
  }

  if (action !== "process") {
    return jsonResponse(400, {
      error: "invalid_action",
      message: `Unknown action: ${action}. Valid actions: process, health.`,
    });
  }

  // 4. Parse tunables (with bounds)
  const rawBatch = parseInt(url.searchParams.get("batch_size") ?? "", 10);
  const rawMax   = parseInt(url.searchParams.get("max_runtime_ms") ?? "", 10);

  const batchSize = clamp(
    Number.isFinite(rawBatch) ? rawBatch : DEFAULT_BATCH_SIZE,
    1,
    500,
  );
  const maxRuntimeMs = clamp(
    Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_RUNTIME_MS,
    1000,
    HARD_TIMEOUT_MS,
  );

  // 5. Process batch
  const workerId = crypto.randomUUID();
  const deadline = Date.now() + maxRuntimeMs;

  const { response } = await handleProcess(
    supabase,
    workerId,
    batchSize,
    maxRuntimeMs,
    deadline,
  );
  return response;
});

// ── Numeric clamp ──────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
