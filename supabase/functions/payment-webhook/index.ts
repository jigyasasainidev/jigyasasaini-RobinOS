// ============================================================
// PAYMENT-WEBHOOK — single dispatcher for ALL payment providers
// ============================================================
// URL:  POST /functions/v1/payment-webhook/:provider_id
// Auth: NONE — the webhook signature IS the auth.
// JWT:  verify_jwt = false (set in supabase/config.toml)
//
// Flow (per design doc §2.1):
//   1. OPTIONS preflight → 204
//   2. Method check      → 405 if not POST
//   3. Path extraction   → 400 if :provider_id missing
//   4. Content-Type      → 415 if not adapter-supported
//   5. Read raw body     → preserves bytes for signature + raw_payload
//   6. Load provider     → 404 if missing, 503 if disabled
//   7. IP allowlist      → 403 if blocked (optional, DB-driven)
//   8. Resolve adapter   → 501 if not implemented
//   9. Parse body        → 400 INVALID_PAYLOAD if malformed
//  10. Verify signature  → 401 if invalid
//  11. Compute hash      → SHA-256(rawBody), hex
//  12. Enqueue atomically→ via enqueue_webhook_event RPC (M54)
//  13. Detect duplicate  → 200 with duplicate: true
//  14. Return 200        → stop WP from retrying
//
// What this function does NOT do (out of M3 scope):
//   - Process the event (worker, M4)
//   - Resolve users (M5)
//   - Grant entitlements (M6)
//   - Handle refunds/disputes (M7/M8)
//   - Affiliate logic (M10)
//   - Send emails
//
// Hard stop after enqueue. The worker picks up the row
// asynchronously per M4 design.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getProviderAdapter } from "../_shared/providers/registry.ts";
import { payloadError } from "../_shared/providers/types.ts";
import { decryptSecret } from "../_shared/crypto.ts";

// ── Env ─────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  // Fail loudly at startup so misconfiguration is obvious.
  console.error(
    JSON.stringify({
      fn: "payment-webhook",
      event: "STARTUP_MISCONFIGURED",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !SERVICE_KEY,
      },
      ts: Date.now(),
    }),
  );
}

// ── CORS / shared headers ──────────────────────────────────
const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const CORS_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Structured logging ─────────────────────────────────────
// All log lines are JSON with: fn, event, provider_id, trace_id, ts.
// NEVER include: buyer email, raw IPN_ID value, decrypted secret,
// provided WP_SECURITYKEY value, raw request body, or IP allowlist.

type LogLevel = "info" | "warn" | "error";

function log(
  level: LogLevel,
  event: string,
  providerId: string | null,
  traceId: string,
  meta: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    fn: "payment-webhook",
    provider_id: providerId,
    event,
    trace_id: traceId,
    ts: Date.now(),
    ...meta,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

// ── Response builders ──────────────────────────────────────
// Every error response has a stable shape:
//   { received: false, code: "...", ...extra }
// Every success response:
//   2xx → { received: true, id, [duplicate: true] }

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  traceId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "X-Trace-Id": traceId,
      ...extraHeaders,
    },
  });
}

function emptyResponse(
  status: number,
  traceId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(null, {
    status,
    headers: {
      ...CORS_HEADERS,
      "X-Trace-Id": traceId,
      ...extraHeaders,
    },
  });
}

// ── Path extraction ────────────────────────────────────────
// Supabase routes /functions/v1/<fn-name>/* to req.url with the
// wildcard appended. We parse the trailing segment as provider_id.

function extractProviderId(reqUrl: string): string | null {
  try {
    const u = new URL(reqUrl);
    // Path: /functions/v1/payment-webhook/<provider_id>
    const parts = u.pathname.split("/").filter(Boolean);
    const fnIdx = parts.indexOf("payment-webhook");
    if (fnIdx === -1) return null;
    const after = parts.slice(fnIdx + 1);
    if (after.length === 0) return null;
    // First segment after the function name is the provider id.
    const id = decodeURIComponent(after[0]).trim();
    if (!id) return null;
    // Defensive: ids are short, lowercase, no slashes.
    if (!/^[a-z0-9_-]{1,64}$/i.test(id)) return null;
    return id.toLowerCase();
  } catch {
    return null;
  }
}

// ── IP allowlist helpers ───────────────────────────────────
// IP comes from CF-Connecting-IP (Cloudflare/Supabase edge) or
// X-Forwarded-For. We pick the first XFF entry. Comparison uses
// Postgres cidr[] from the DB — we evaluate in SQL via a tiny
// RPC call OR evaluate locally. Local eval is simpler and
// avoids an extra round-trip.

function extractClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

function ipMatchesAnyCidr(ip: string, cidrs: string[]): boolean {
  for (const cidr of cidrs) {
    if (!cidr) continue;
    try {
      // Lightweight CIDR check using the platform's URL host parsing
      // is not sufficient. We delegate to a manual implementation.
      if (ipInCidr(ip, cidr)) return true;
    } catch {
      // Ignore malformed CIDR entries — admin must fix.
    }
  }
  return false;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash === -1) {
    return ip === cidr;
  }
  const cidrIp = cidr.slice(0, slash);
  const prefixLen = parseInt(cidr.slice(slash + 1), 10);
  if (Number.isNaN(prefixLen)) return false;

  const ipBytes = parseIp(ip);
  const cidrBytes = parseIp(cidrIp);
  if (!ipBytes || !cidrBytes) return false;
  if (ipBytes.length !== cidrBytes.length) return false;

  const fullBytes = Math.floor(prefixLen / 8);
  const extraBits = prefixLen % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== cidrBytes[i]) return false;
  }
  if (extraBits === 0) return true;
  const mask = (0xff << (8 - extraBits)) & 0xff;
  return (ipBytes[fullBytes] & mask) === (cidrBytes[fullBytes] & mask);
}

function parseIp(ip: string): Uint8Array | null {
  // IPv4
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const out = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      const n = parseInt(parts[i], 10);
      if (Number.isNaN(n) || n < 0 || n > 255) return null;
      out[i] = n;
    }
    return out;
  }
  // IPv6 (basic — full validation omitted for brevity, but
  // format is well-defined enough to gate obvious mismatches).
  if (ip.includes(":")) {
    // Use URL parsing to normalise and then split on ":".
    try {
      // Not perfectly RFC-compliant, but good enough for an
      // allowlist check; admin is responsible for valid CIDRs.
      const parts = ip.split(":");
      if (parts.length < 3 || parts.length > 8) return null;
      const out = new Uint8Array(16);
      let idx = 0;
      let emptySeen = false;
      for (const p of parts) {
        if (p === "") {
          if (emptySeen) return null;
          emptySeen = true;
          const skip = 8 - (parts.length - 1);
          idx += skip;
          continue;
        }
        const n = parseInt(p, 16);
        if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
        out[idx++] = (n >> 8) & 0xff;
        out[idx++] = n & 0xff;
      }
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Rate limiting (best-effort in-memory) ──────────────────
// Per-(provider_id, minute-bucket) counter. Reset every minute.
// Approximate — edge functions may run concurrently.

const RATE_LIMIT_PER_MINUTE = 60;
const rateLimitCounters = new Map<string, { count: number; minute: number }>();

function rateLimitCheck(providerId: string): {
  allowed: boolean;
  retryAfter: number;
} {
  const minute = Math.floor(Date.now() / 60000);
  const entry = rateLimitCounters.get(providerId);
  if (!entry || entry.minute !== minute) {
    rateLimitCounters.set(providerId, { count: 1, minute });
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_LIMIT_PER_MINUTE) {
    const nextMinuteStart = (minute + 1) * 60;
    return { allowed: false, retryAfter: Math.max(1, nextMinuteStart - Math.floor(Date.now() / 1000)) };
  }
  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

// ── Snapshot relevant request headers for raw_headers ──────
// We log user-agent, IP, and content-type. NOT authorization
// (we don't want any JWT-bearing header captured).

function snapshotHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const wanted = [
    "content-type",
    "user-agent",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "accept",
    "accept-encoding",
  ];
  for (const name of wanted) {
    const v = req.headers.get(name);
    if (v) out[name] = v;
  }
  return out;
}

// ── Main handler ───────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const traceId = crypto.randomUUID();

  // 1. OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 2. Method check
  if (req.method !== "POST") {
    return emptyResponse(405, traceId, { Allow: "POST, OPTIONS" });
  }

  // 3. Path extraction
  const providerId = extractProviderId(req.url);
  if (!providerId) {
    log("warn", "INVALID_REQUEST", null, traceId, { reason: "missing_provider_id" });
    return jsonResponse(400, {
      received: false,
      code: "INVALID_REQUEST",
      message: "Missing or invalid provider_id path segment",
    }, traceId);
  }

  log("info", "REQUEST_RECEIVED", providerId, traceId, {
    method: req.method,
    content_type: req.headers.get("content-type") ?? "",
    user_agent: req.headers.get("user-agent") ?? "",
    remote_ip: extractClientIp(req),
  });

  // 4. Resolve adapter (before parsing body so we know which
  //    Content-Type to accept).
  const adapter = getProviderAdapter(providerId);
  if (!adapter) {
    log("warn", "PROVIDER_NOT_FOUND", providerId, traceId);
    return jsonResponse(404, {
      received: false,
      code: "PROVIDER_NOT_FOUND",
    }, traceId);
  }

  // 5. Content-Type check (adapter-driven)
  const contentType = req.headers.get("content-type") ?? "";
  const ctLower = contentType.trim().toLowerCase();
  if (!ctLower.startsWith(adapter.expectedContentType)) {
    log("warn", "UNSUPPORTED_MEDIA_TYPE", providerId, traceId, {
      content_type: contentType,
      expected_prefix: adapter.expectedContentType,
    });
    return jsonResponse(415, {
      received: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
      expected: adapter.expectedContentType,
    }, traceId);
  }

  // 6. Read raw body — preserve exact bytes
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    log("error", "BODY_READ_FAILED", providerId, traceId, {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, {
      received: false,
      code: "INTERNAL_ERROR",
      message: "Failed to read request body",
    }, traceId);
  }

  // 7. Load provider config from DB
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let provider: {
    id: string;
    is_enabled: boolean;
    require_signature_verification: boolean;
    is_test_mode: boolean;
    allowed_ip_ranges: string[] | null;
  } | null;

  try {
    const { data, error } = await supabase
      .from("payment_providers")
      .select("id, is_enabled, require_signature_verification, is_test_mode, allowed_ip_ranges")
      .eq("id", providerId)
      .maybeSingle();
    if (error) {
      log("error", "PROVIDER_LOAD_FAILED", providerId, traceId, {
        error_message: error.message,
      });
      return jsonResponse(500, {
        received: false,
        code: "INTERNAL_ERROR",
        message: "Failed to load provider config",
      }, traceId);
    }
    provider = data;
  } catch (err) {
    log("error", "PROVIDER_LOAD_FAILED", providerId, traceId, {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, {
      received: false,
      code: "INTERNAL_ERROR",
      message: "Failed to load provider config",
    }, traceId);
  }

  if (!provider) {
    log("warn", "PROVIDER_NOT_FOUND", providerId, traceId);
    return jsonResponse(404, {
      received: false,
      code: "PROVIDER_NOT_FOUND",
    }, traceId);
  }

  log("info", "PROVIDER_RESOLVED", providerId, traceId, {
    is_enabled: provider.is_enabled,
    require_signature_verification: provider.require_signature_verification,
    is_test_mode: provider.is_test_mode,
    has_ip_allowlist: !!provider.allowed_ip_ranges && provider.allowed_ip_ranges.length > 0,
  });

  if (!provider.is_enabled) {
    log("warn", "PROVIDER_DISABLED", providerId, traceId);
    return jsonResponse(503, {
      received: false,
      code: "PROVIDER_DISABLED",
    }, traceId);
  }

  // 8. Rate limit (in-memory, per-provider, per-minute)
  const rl = rateLimitCheck(providerId);
  if (!rl.allowed) {
    log("warn", "RATE_LIMITED", providerId, traceId, {
      limit_per_minute: RATE_LIMIT_PER_MINUTE,
      retry_after: rl.retryAfter,
    });
    return jsonResponse(429, {
      received: false,
      code: "RATE_LIMITED",
      message: "Too many requests; retry after the indicated interval",
    }, traceId, { "Retry-After": String(rl.retryAfter) });
  }

  // 9. IP allowlist (optional)
  if (provider.allowed_ip_ranges && provider.allowed_ip_ranges.length > 0) {
    const clientIp = extractClientIp(req);
    if (!clientIp || !ipMatchesAnyCidr(clientIp, provider.allowed_ip_ranges)) {
      log("warn", "IP_NOT_ALLOWED", providerId, traceId, {
        remote_ip_hash: clientIp ? await quickHash(clientIp) : null,
      });
      return jsonResponse(403, {
        received: false,
        code: "IP_NOT_ALLOWED",
      }, traceId);
    }
  }

  // 10. Parse body via adapter
  let parsedBody: Record<string, string>;
  try {
    parsedBody = adapter.parseBody(rawBody, contentType);
  } catch (err) {
    if (isPayloadError(err)) {
      log("warn", "INVALID_PAYLOAD", providerId, traceId, {
        missing_field: err.field,
      });
      return jsonResponse(400, {
        received: false,
        code: "INVALID_PAYLOAD",
        field: err.field,
        message: err.message,
      }, traceId);
    }
    throw err;
  }

  // 11. Extract canonical fields (may throw INVALID_PAYLOAD)
  let fields;
  try {
    fields = adapter.extractEventFields(parsedBody);
  } catch (err) {
    if (isPayloadError(err)) {
      log("warn", "INVALID_PAYLOAD", providerId, traceId, {
        missing_field: err.field,
      });
      return jsonResponse(400, {
        received: false,
        code: "INVALID_PAYLOAD",
        field: err.field,
        message: err.message,
      }, traceId);
    }
    throw err;
  }

  // 12. Signature verification (adapter-driven, optional via
  //     payment_providers.require_signature_verification)
  if (provider.require_signature_verification) {
    // Load active secret for this provider + secret name.
    const secretName = adapter.signatureSecretName();
    const secretRow = await loadActiveSecret(supabase, providerId, secretName);

    if (!secretRow) {
      log("warn", "SIGNATURE_INVALID", providerId, traceId, {
        reason: "missing_stored_secret",
        secret_name: secretName,
      });
      return jsonResponse(401, {
        received: false,
        code: "SIGNATURE_INVALID",
      }, traceId);
    }

    // Decrypt the stored secret. Plaintext held in local var
    // only; never logged, never persisted.
    let decrypted: string;
    try {
      decrypted = await decryptSecret(secretRow);
    } catch (err) {
      log("error", "SIGNATURE_INVALID", providerId, traceId, {
        reason: "decrypt_failed",
        error_message: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(401, {
        received: false,
        code: "SIGNATURE_INVALID",
      }, traceId);
    }

    const result = adapter.verifySignature(decrypted, parsedBody, rawBody, req.headers);
    // Wipe local plaintext as soon as verification is done.
    decrypted = "";

    if (!result.isValid) {
      log("warn", "SIGNATURE_INVALID", providerId, traceId, {
        reason: result.reason ?? "unknown",
        secret_name: secretName,
      });
      return jsonResponse(401, {
        received: false,
        code: "SIGNATURE_INVALID",
      }, traceId);
    }

    log("info", "SIGNATURE_VERIFIED", providerId, traceId, {
      secret_name: secretName,
    });
  } else {
    log("warn", "SIGNATURE_VERIFICATION_DISABLED", providerId, traceId, {
      warning: "provider has require_signature_verification = false",
    });
  }

  // 13. Compute payload_hash (SHA-256 of raw body, hex)
  const payloadHash = await sha256Hex(rawBody);

  // 14. Atomically enqueue via RPC. The RPC handles dedup via
  //     ON CONFLICT (provider_id, provider_event_id) DO NOTHING.
  let enqueueResult: {
    id: string;
    is_duplicate: boolean;
    status: string;
  };

  try {
    const rpcArgs = {
      p_provider_id: providerId,
      p_provider_event_id: fields.providerEventId,
      p_provider_event_type: fields.providerEventType,
      p_raw_payload: parsedBody,
      p_raw_headers: snapshotHeaders(req),
      p_provider_transaction_id: fields.providerTransactionId,
      p_trace_id: traceId,
    };
    const { data, error } = await supabase.rpc("enqueue_webhook_event", rpcArgs);
    if (error) {
      log("error", "ENQUEUE_FAILED", providerId, traceId, {
        error_code: error.code,
        error_message: error.message,
      });
      return jsonResponse(500, {
        received: false,
        code: "INTERNAL_ERROR",
        message: "Failed to enqueue webhook event",
      }, traceId);
    }
    // RPC returns jsonb; Supabase JS parses it to an object.
    enqueueResult = data as typeof enqueueResult;
  } catch (err) {
    log("error", "ENQUEUE_FAILED", providerId, traceId, {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, {
      received: false,
      code: "INTERNAL_ERROR",
      message: "Failed to enqueue webhook event",
    }, traceId);
  }

  // 15. Duplicate or new — return 200 in both cases so the
  //     provider stops retrying.
  if (enqueueResult.is_duplicate) {
    log("info", "DUPLICATE_DETECTED", providerId, traceId, {
      webhook_event_id: enqueueResult.id,
      provider_event_id_hash: await quickHash(fields.providerEventId),
      existing_status: enqueueResult.status,
    });
    return jsonResponse(200, {
      received: true,
      duplicate: true,
      id: enqueueResult.id,
    }, traceId);
  }

  log("info", "ENQUEUED", providerId, traceId, {
    webhook_event_id: enqueueResult.id,
    payload_hash: payloadHash,
    standardized_event_type: fields.standardizedEventType,
    event_mapping_confidence: fields.eventMappingConfidence,
  });

  return jsonResponse(200, {
    received: true,
    id: enqueueResult.id,
  }, traceId);
});

// ── Helpers (file-scoped) ──────────────────────────────────

interface AdapterPayloadError extends Error {
  code: "INVALID_PAYLOAD";
  field: string;
}

function isPayloadError(err: unknown): err is AdapterPayloadError {
  return (
    err instanceof Error &&
    (err as AdapterPayloadError).code === "INVALID_PAYLOAD" &&
    typeof (err as AdapterPayloadError).field === "string"
  );
}

async function loadActiveSecret(
  supabase: ReturnType<typeof createClient>,
  providerId: string,
  secretName: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("payment_provider_secrets")
      .select("secret_value_encrypted")
      .eq("provider_id", providerId)
      .eq("secret_name", secretName)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return null;
    return data.secret_value_encrypted as string;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function quickHash(input: string): Promise<string> {
  return await sha256Hex(input);
}
