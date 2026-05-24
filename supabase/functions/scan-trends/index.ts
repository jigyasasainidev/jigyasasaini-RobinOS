// ============================================================
// ROBINOS SCAN TRENDS — Gemini Direct, Cache-First, Unlimited
// ============================================================
// FLOW:
// 1. Auth: verify JWT (no quota checks — unlimited)
// 2. Cache lookup — return instantly if fresh results exist
// 3. Cache miss → Gemini AI → store async → return
//
// NO AI_API_KEY, NO GROQ, NO ai-provider.ts
// Uses GEMINI_API_KEY only.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CORS_HEADERS,
  createServiceClient,
} from "../_shared/entitlement.ts";
import {
  validateGeminiConfig,
  callGemini,
  GEMINI_MODEL_DEFAULT,
} from "../_shared/gemini.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Fail fast if Gemini key missing
  const configError = validateGeminiConfig();
  if (configError) return configError;

  try {
    // ── Auth: verify user JWT (no quota check) ────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const niche = typeof body?.niche === "string" ? body.niche.trim() : "";
    if (!niche) {
      return new Response(JSON.stringify({ error: "niche is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const nicheKey = niche.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80);

    // Verify JWT (non-blocking auth — just confirms logged-in user)
    const supabase = createServiceClient();
    const token    = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Cache lookup ──────────────────────────────────────
    const now = new Date().toISOString();
    const { data: cached, error: cacheErr } = await supabase
      .from("trend_topics")
      .select("title, description, platforms, heat, hook_types, volume")
      .eq("niche_key", nicheKey)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(5);

    if (!cacheErr && cached && cached.length > 0) {
      return new Response(
        JSON.stringify({
          topics: cached.map((t: any) => ({
            title:       t.title,
            description: t.description,
            platforms:   t.platforms,
            heat:        t.heat,
            hook_types:  Array.isArray(t.hook_types) ? t.hook_types : (t.hook_types ? JSON.parse(t.hook_types) : []),
            volume:      t.volume ?? "Medium",
          })),
          cached: true,
          niche:  nicheKey,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Cache miss: call Gemini ───────────────────────────
    const aiResult = await callGemini({
      model:    GEMINI_MODEL_DEFAULT,
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
            required: ["topics"],
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

    // ── Store to cache async (non-blocking) ───────────────
    if (topics.length > 0) {
      const expiresAt = new Date(Date.now() + 4 * 3600_000).toISOString();
      const now2      = new Date().toISOString();

      // Fire-and-forget — don't await, doesn't block response
      Promise.allSettled(
        topics.map((t) => {
          const heatScore    = Math.min(t.heat ?? 0, 99) * 0.606;
          const volumeScore  = t.volume === "High" ? 20 : t.volume === "Medium" ? 10 : 5;
          const platformCount = (t.platforms ?? "").split(",").filter((p: string) => p.trim()).length;
          const viralityScore = Math.min(Math.round(heatScore + volumeScore + Math.min(platformCount, 4) * 5), 100);

          return supabase.from("trend_topics").upsert({
            niche_key:       nicheKey,
            title:           t.title,
            description:     t.description,
            platforms:       t.platforms,
            heat:            Math.min(Math.max(t.heat ?? 0, 0), 99),
            hook_types:      JSON.stringify(t.hook_types ?? []),
            volume:          t.volume ?? "Medium",
            virality_score:  viralityScore,
            trend_velocity:  (t.heat ?? 0) / 10,
            source:          "ai",
            expires_at:      expiresAt,
            collected_at:    now2,
          }, { onConflict: "niche_key, title", ignoreDuplicates: false });
        })
      ).catch(() => { /* non-fatal */ });
    }

    return new Response(
      JSON.stringify({ topics, cached: false, niche: nicheKey }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[scan-trends] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
