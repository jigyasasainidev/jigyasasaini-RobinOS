// ============================================================
// PROCESS-WEBHOOK-WORKER — STUB for Milestone 4
// ============================================================
// M3 implements only the synchronous webhook receiver. This
// worker is the async counterpart; its body is intentionally
// NOT implemented in M3.
//
// What this stub does:
//   - Accepts POST from a cron trigger (Supabase scheduled fn)
//   - Returns 200 with a "not_implemented" body
//   - Logs a clear WARN so cron activity is visible
//
// What M4 will replace this with:
//   - Claim a batch of webhook_events rows via SKIP LOCKED
//   - Resolve product mapping (provider_products)
//   - Resolve or create user (M5)
//   - Record purchase (M6)
//   - Grant entitlement (M6)
//   - Update webhook_events.status, retry_count, next_retry_at
//   - Handle terminal failures (failed_terminal) without retry
//
// Until M4 ships, events accumulate in webhook_events with
// status='received' and the admin sees them via the M11
// diagnostics UI.
// ============================================================

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

Deno.serve(async (req: Request) => {
  const traceId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  console.warn(JSON.stringify({
    fn: "process-webhook-worker",
    event: "STUB_CALLED",
    trace_id: traceId,
    note: "Worker body not yet implemented. Scheduled for M4.",
    ts: Date.now(),
  }));

  return new Response(
    JSON.stringify({
      implemented: false,
      message: "process-webhook-worker body is implemented in Milestone 4. Events continue to accumulate in webhook_events with status='received' until then.",
      trace_id: traceId,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
