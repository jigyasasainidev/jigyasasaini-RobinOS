// ============================================================
// ROBINOS TRENDING AUDIO — ENTITLEMENT PROXY v4
// ============================================================
// RESPONSIBILITIES (this function):
//   1. Validate user session
//   2. Check + increment entitlement quota (trend_scan / hashtag_scan)
//   3. Delegate to Idea Stream service via shared client
//   4. Return result to frontend
//
// THIS FUNCTION NO LONGER:
//   - Fetches Apple Music RSS
//   - Fetches Deezer charts
//   - Fetches Google Trends RSS
//   - Scores, normalizes, or ranks tracks
//   - Writes to trend_audios or trend_hashtags tables
//   - Runs a cache refresh pipeline
//   - Knows anything about Idea Stream internals
//
// All intelligence production is owned by the Idea Stream service.
// RobinOS is a pure consumer of its stable /trends API.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";
import { fetchTrends } from "../_shared/trend-engine-client.ts";
import type { Platform, TrendType } from "../_shared/trend-engine-client.ts";

const VALID_PLATFORMS: Platform[] = ["TikTok", "Instagram", "Facebook", "YouTube"];
const VALID_TYPES: TrendType[]    = ["audio", "hashtags"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body     = await req.json();
    const platform = (body?.platform ?? "Instagram") as Platform;
    const type     = (body?.type     ?? "audio")     as TrendType;

    // ── Input validation ───────────────────────────────────
    if (!VALID_PLATFORMS.includes(platform)) {
      return new Response(JSON.stringify({
        error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        code:  "INVALID_PLATFORM",
      }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
    if (!VALID_TYPES.includes(type)) {
      return new Response(JSON.stringify({
        error: `type must be one of: ${VALID_TYPES.join(", ")}`,
        code:  "INVALID_TYPE",
      }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Entitlement check ──────────────────────────────────
    const featureKey = type === "hashtags" ? FEATURES.HASHTAG_SCAN : FEATURES.TREND_SCAN;
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader, featureKey, crypto.randomUUID()
    );

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(JSON.stringify({
          error:     entitlement.code === "FEATURE_DISABLED"
                       ? `${type === "hashtags" ? "Hashtag" : "Trend"} scanning requires a higher plan.`
                       : entitlement.message || "Scan limit reached.",
          code:      entitlement.code,
          feature:   entitlement.feature,
          plan:      entitlement.plan,
          limit:     entitlement.limit,
          used:      entitlement.used,
          remaining: entitlement.remaining,
          reset_at:  entitlement.reset_at,
        }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      return entitlementError;
    }

    // ── Resolve user ID for analytics (non-fatal) ──────────
    const supabase = createServiceClient();
    let analyticsUserId = "";
    try {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      analyticsUserId = user?.id ?? "";
    } catch { /* non-fatal */ }

    // ── Delegate to Idea Stream service ───────────────────
    const result = await fetchTrends(platform, type);

    if (!result.ok) {
      console.error("[trending-audio] Idea Stream call failed", {
        platform, type, code: result.code, status: result.status,
      });
      return new Response(JSON.stringify({
        error: "Trend data temporarily unavailable. Please retry.",
        code:  result.code,
      }), { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // ── Analytics (non-fatal) ──────────────────────────────
    if (analyticsUserId) {
      trackFeatureUsage({ supabase, userId: analyticsUserId, feature: featureKey });
    }

    // ── Return normalized response to frontend ─────────────
    const responseBody =
      type === "hashtags"
        ? { hashtags: result.hashtags ?? [], usage: entitlement, cached: result.cached }
        : { audios:   result.audios   ?? [], usage: entitlement, cached: result.cached };

    return new Response(JSON.stringify(responseBody), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[trending-audio] unexpected error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
      code:  "INTERNAL_ERROR",
    }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
