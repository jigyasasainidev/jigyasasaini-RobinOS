// ============================================================
// ROBINOS COLLECT TRENDS — REFRESH TRIGGER v3
// ============================================================
// RESPONSIBILITIES (this function):
//   1. Accept authenticated cron / admin trigger
//   2. Call Idea Stream service /refresh endpoint
//   3. Return result
//
// THIS FUNCTION NO LONGER:
//   - Fetches Apple Music RSS, Deezer, Google Trends
//   - Scores, normalizes, or ranks any data
//   - Writes to trend_audios, trend_hashtags, or trend_topics
//   - Runs AI enrichment for topics
//   - Manages the trend cache lifecycle
//   - Knows anything about Idea Stream internals
//
// All intelligence production and caching is owned by the
// Idea Stream service. This function is a thin scheduler trigger.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CORS_HEADERS, createServiceClient } from "../_shared/entitlement.ts";
import { triggerRefresh, pingIdeaStream } from "../_shared/trend-engine-client.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Only allow authenticated internal calls (service_role or cron trigger)
  const authHeader = req.headers.get("authorization");
  const supabase   = createServiceClient();

  if (authHeader) {
    // service_role key bypasses RLS — no user lookup needed
    const token = authHeader.replace("Bearer ", "");
    await supabase.auth.getUser(token);
  }

  try {
    console.log("[collect-trends] Triggering Idea Stream refresh...");

    // Optional: ping health first to fail fast if service is down
    const healthy = await pingIdeaStream();
    if (!healthy) {
      console.warn("[collect-trends] Idea Stream health check failed — skipping refresh trigger");
      return new Response(JSON.stringify({
        success: false,
        code:    "IDEA_STREAM_UNAVAILABLE",
        message: "Idea Stream service is not reachable.",
      }), { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const ok = await triggerRefresh();

    console.log("[collect-trends] Refresh trigger result:", ok);

    return new Response(JSON.stringify({
      success:   ok,
      message:   ok ? "Trend collection refresh triggered successfully." : "Refresh trigger failed.",
      timestamp: new Date().toISOString(),
    }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[collect-trends] Fatal error:", err);
    return new Response(JSON.stringify({
      success: false,
      error:   err instanceof Error ? err.message : "Unknown error",
    }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
