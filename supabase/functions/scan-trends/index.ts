// ============================================================
// ROBINOS SCAN TRENDS — CACHE-ONLY
// Centralized Trend Intelligence Consumer
// ============================================================
// FLOW:
// 1. Entitlement check
// 2. Cache lookup by niche_key + fresh expires_at
// 3. Cache hit  → return cached trends instantly
// 4. Cache miss → return 503 (background worker populates cache)
//
// AI generation has been removed. The collect-trends background
// worker is the sole writer of trend_topics. This function is
// a read-only consumer of pre-populated cache.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("authorization");

    const { niche } = await req.json();
    if (!niche || typeof niche !== "string") {
      return new Response(JSON.stringify({ error: "Niche is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Normalize niche key
    const nicheKey = niche.trim().toLowerCase().replace(/\s+/g, "_");

    // ── Entitlement check ──────────────────────────────────
    if (authHeader) {
      const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
        authHeader,
        FEATURES.TREND_SCAN,
        crypto.randomUUID()
      );

      if (entitlementError) {
        if (entitlement && !entitlement.success) {
          return new Response(
            JSON.stringify({
              error:     entitlement.message || "Scan limit reached. Upgrade to continue.",
              code:      entitlement.code,
              feature:   entitlement.feature,
              plan:      entitlement.plan,
              limit:     entitlement.limit,
              used:      entitlement.used,
              remaining: entitlement.remaining,
              reset_at:  entitlement.reset_at,
            }),
            { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }
        return entitlementError;
      }
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createServiceClient();
    const now      = new Date().toISOString();

    // Resolve userId for analytics (non-fatal)
    let analyticsUserId = "";
    try {
      const token = authHeader!.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      analyticsUserId = user?.id ?? "";
    } catch { /* non-fatal */ }

    // ── Cache lookup ───────────────────────────────────────
    const { data: cachedTopics, error: cacheError } = await supabase
      .from("trend_topics")
      .select("title, description, platforms, heat, hook_types, volume")
      .eq("niche_key", nicheKey)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(5);

    if (!cacheError && cachedTopics && cachedTopics.length > 0) {
      const topics = cachedTopics.map((t: any) => ({
        title:       t.title,
        description: t.description,
        platforms:   t.platforms,
        heat:        t.heat,
        hook_types:  t.hook_types || [],
        volume:      t.volume || "Medium",
      }));

      if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });

      return new Response(
        JSON.stringify({ topics, cached: true, niche: nicheKey }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Cache miss — no AI fallback ────────────────────────
    // The collect-trends background worker populates cache every 6h.
    // Return a clear error so the frontend can show a retry message.
    return new Response(
      JSON.stringify({
        error:  "Trend data for this niche is being refreshed. Please try again in a few minutes.",
        code:   "CACHE_MISS",
        niche:  nicheKey,
        cached: false,
      }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("scan-trends error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
