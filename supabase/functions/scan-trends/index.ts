// ============================================================
// ROBINOS SCAN TRENDS — Gemini Direct, Cache-First
// ============================================================
// FLOW:
// 1. Validate Gemini config (fast fail)
// 2. Auth + entitlement check in parallel (quota enforced)
// 3. Cache lookup — return instantly if fresh results exist
//    (cache hits still consume quota — backend authoritative)
// 4. Cache miss → Gemini AI → fire-and-forget cache write → return
//
// QUOTA: enforced via checkAndIncrementUsage (TREND_SCAN feature)
// Free users → plan limit | Creator → higher | Agency → fair_usage
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  checkAndIncrementUsage,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";
import {
  validateGeminiConfig,
  callGemini,
  GEMINI_MODEL_DEFAULT,
} from "../_shared/gemini.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Fail fast if Gemini key not configured
  const configError = validateGeminiConfig();
  if (configError) return configError;

  try {
    // ── Auth header present ────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", code: "AUTH_REQUIRED" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Parse body ────────────────────────────────────────
    let niche: string;
    try {
      const body = await req.json();
      niche = typeof body?.niche === "string" ? body.niche.trim() : "";
    } catch {
      return new Response(
        JSON.stringify({ error: "Request body must be valid JSON" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    if (!niche) {
      return new Response(
        JSON.stringify({ error: "niche is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const nicheKey   = niche.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80);
    const requestId  = crypto.randomUUID();
    const supabase   = createServiceClient();
    const token      = authHeader.replace("Bearer ", "");

    // ── Phase 1: Entitlement check + user resolution (parallel) ──
    // checkAndIncrementUsage atomically verifies auth + increments quota.
    // supabase.auth.getUser runs in parallel for analytics userId.
    // IMPORTANT: quota is consumed here BEFORE cache/AI — prevents
    // bypassing limits via cache manipulation.
    const [entitlementResult, userResult] = await Promise.all([
      checkAndIncrementUsage(authHeader, FEATURES.TREND_SCAN, requestId),
      supabase.auth.getUser(token),
    ]);

    const { result: entitlement, error: entitlementError } = entitlementResult;

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        // Return structured 403 with plan/usage context so frontend
        // can show the correct upgrade dialog
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
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      return entitlementError;
    }

    const analyticsUserId = userResult.data?.user?.id ?? "";

    // ── Phase 2: Cache lookup ─────────────────────────────
    // Cache hits still count against quota (entitlement already incremented above).
    // This is correct — the user consumed a scan, regardless of cache state.
    const now = new Date().toISOString();
    const { data: cached, error: cacheErr } = await supabase
      .from("trend_topics")
      .select("title, description, platforms, heat, hook_types, volume")
      .eq("niche_key", nicheKey)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(5);

    if (!cacheErr && cached && cached.length > 0) {
      if (analyticsUserId) {
        trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });
      }
      return new Response(
        JSON.stringify({
          topics: cached.map((t: any) => ({
            title:       t.title,
            description: t.description,
            platforms:   t.platforms,
            heat:        t.heat,
            hook_types:  Array.isArray(t.hook_types)
              ? t.hook_types
              : (t.hook_types ? (() => { try { return JSON.parse(t.hook_types); } catch { return []; } })() : []),
            volume:      t.volume ?? "Medium",
          })),
          cached:  true,
          niche:   nicheKey,
          usage:   entitlement,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Phase 3: Cache miss — call Gemini ─────────────────
    const aiResult = await callGemini({
      model:     GEMINI_MODEL_DEFAULT,
      timeoutMs: 20_000,
      messages: [
        {
          role:    "system",
          content: `You are an expert viral content analyst. Identify 3-5 ACTUALLY trending topics for the given niche that are gaining momentum right now.

For each topic provide:
- title: exact trending topic or content angle
- description: WHY it's trending with specific data points
- platforms: comma-separated platforms with signals
- heat: score 70-99 based on growth velocity
- hook_types: array of working hook formats (POV, Did you know, Story time, etc.)
- volume: "High" (1000+ posts/day) | "Medium" (100-999) | "Emerging" (<100)

Be specific, cite real signals. Never fabricate — use best estimates.`,
        },
        {
          role:    "user",
          content: `Find 3-5 trending topics for the niche: "${niche}"`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name:        "return_trending_topics",
          description: "Return 3-5 trending topics for the given niche",
          parameters: {
            type: "object",
            properties: {
              topics: {
                type:  "array",
                items: {
                  type: "object",
                  properties: {
                    title:       { type: "string" },
                    description: { type: "string" },
                    platforms:   { type: "string" },
                    heat:        { type: "number" },
                    hook_types:  { type: "array", items: { type: "string" } },
                    volume:      { type: "string", enum: ["High", "Medium", "Emerging"] },
                  },
                  required: ["title", "description", "platforms", "heat", "hook_types", "volume"],
                  additionalProperties: false,
                },
              },
            },
            required:             ["topics"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_trending_topics" } },
    });

    if (!aiResult.ok) {
      return new Response(
        JSON.stringify({ success: false, code: aiResult.code, error: aiResult.message }),
        { status: aiResult.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const toolCall = aiResult.data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "No results generated" }),
        { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    let topics: any[] = [];
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      topics = parsed.topics ?? [];
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Phase 4: Cache write (fire-and-forget, non-blocking) ─
    // Does NOT block the response. Errors here are non-fatal.
    if (topics.length > 0) {
      const expiresAt = new Date(Date.now() + 4 * 3600_000).toISOString();
      const now2      = new Date().toISOString();

      Promise.allSettled(
        topics.map((t: any) => {
          const heatScore     = Math.min(t.heat ?? 0, 99) * 0.606;
          const volumeScore   = t.volume === "High" ? 20 : t.volume === "Medium" ? 10 : 5;
          const platformCount = (t.platforms ?? "").split(",").filter((p: string) => p.trim()).length;
          const viralityScore = Math.min(Math.round(heatScore + volumeScore + Math.min(platformCount, 4) * 5), 100);

          return supabase.from("trend_topics").upsert({
            niche_key:      nicheKey,
            title:          t.title,
            description:    t.description,
            platforms:      t.platforms,
            heat:           Math.min(Math.max(t.heat ?? 0, 0), 99),
            hook_types:     JSON.stringify(t.hook_types ?? []),
            volume:         t.volume ?? "Medium",
            virality_score: viralityScore,
            trend_velocity: (t.heat ?? 0) / 10,
            source:         "ai",
            expires_at:     expiresAt,
            collected_at:   now2,
          }, { onConflict: "niche_key, title", ignoreDuplicates: false });
        })
      ).catch(() => { /* non-fatal */ });
    }

    if (analyticsUserId) {
      trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });
    }

    return new Response(
      JSON.stringify({ topics, cached: false, niche: nicheKey, usage: entitlement }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("[scan-trends] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
