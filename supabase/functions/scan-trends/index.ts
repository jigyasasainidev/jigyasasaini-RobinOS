// ============================================================
// ROBINOS SCAN TRENDS — Gemini Direct REST, Cache-First
// ============================================================
// FLOW:
// 1. Validate GEMINI_API_KEY (fast fail)
// 2. Auth + entitlement check in parallel (quota enforced)
// 3. Cache lookup — return instantly if fresh results exist
// 4. Cache miss → Gemini REST API (direct, no tool_choice) → return
//
// AI approach: plain JSON prompt — no function calling.
// Gemini responds with raw JSON text; we strip any markdown fences.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  checkAndIncrementUsage,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── Types ──────────────────────────────────────────────────
interface TrendTopic {
  title:      string;
  description:string;
  platforms:  string;
  heat:       number;
  hook_types: string[];
  volume:     "High" | "Medium" | "Emerging";
}

// ── Constants ──────────────────────────────────────────────
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const SYSTEM_PROMPT = `You are an expert viral content analyst with deep knowledge of internet trends and social media dynamics. When given a niche, you must identify 3-5 ACTUALLY trending topics that are currently gaining momentum or about to explode.

CRITICAL: Respond with ONLY valid JSON. No markdown, no code blocks, no explanation. Just raw JSON.

Your analysis must be based on real-world signals. For each topic provide:
- title: The exact trending topic, hashtag, or content angle
- description: WHY this is trending RIGHT NOW with specific data points (estimated view counts, engagement metrics, growth velocity)
- platforms: Which platforms this is trending on with specific signals (e.g. "2.3M views on TikTok in 48hrs, trending #3 on YouTube Shorts")
- heat: Score 70-99 based on actual growth velocity and virality indicators
- hook_types: Array of hook formats that are working for this trend (e.g. "POV", "Did you know", "Story time", "3 things about", "Watch till the end")
- volume: Estimated daily content volume - "High" (1000+ posts/day), "Medium" (100-999), "Emerging" (under 100)

Focus ONLY on verifiable, current trends. Be specific with numbers and platform data.

Return JSON in this format:
{"topics": [{"title": "string","description": "string","platforms": "string","heat": 85,"hook_types": ["string"],"volume": "High"}]}`;

// ── Call Gemini REST directly (no tool_choice / function calling) ──
async function callGeminiDirect(niche: string, apiKey: string): Promise<TrendTopic[]> {
  const userPrompt = `Analyze the "${niche}" niche and find 3-5 ACTUALLY trending topics that are viral or about to go viral right now in May 2026.`;

  const body = {
    contents: [{
      role: "user",
      parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }],
    }],
    generationConfig: {
      temperature:     0.7,
      topP:            0.95,
      topK:            40,
      maxOutputTokens: 8192,
    },
  };

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? "Gemini request timed out" : `Gemini network error: ${err}`);
  }
  clearTimeout(timer);

  if (res.status === 429) throw new Error("Gemini rate limit exceeded. Please retry shortly.");
  if (res.status === 403) throw new Error("Gemini API key invalid or quota exhausted.");
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[scan-trends] Gemini HTTP error", res.status, errText.slice(0, 200));
    throw new Error(`Gemini returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!rawText) {
    console.error("[scan-trends] Gemini returned empty text. Full response:", JSON.stringify(data).slice(0, 500));
    throw new Error("Gemini returned empty response");
  }

  // ── Strip markdown fences if present ────────────────────
  // Gemini sometimes wraps JSON in ```json ... ``` even when told not to.
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/,    "").trim();

  console.log("[scan-trends] Gemini raw text (first 300):", cleaned.slice(0, 300));

  let parsed: { topics?: TrendTopic[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try extracting JSON object from surrounding text as last resort
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.error("[scan-trends] JSON parse failed even after extraction. Text:", cleaned.slice(0, 400));
        throw new Error("Failed to parse Gemini JSON response");
      }
    } else {
      console.error("[scan-trends] No JSON found in response:", cleaned.slice(0, 400));
      throw new Error("Gemini response did not contain valid JSON");
    }
  }

  const topics = parsed?.topics ?? [];
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("Gemini returned no topics");
  }

  // ── Validate / normalise each topic ──────────────────────
  return topics.map((t: any): TrendTopic => ({
    title:       String(t.title       ?? "").trim(),
    description: String(t.description ?? "").trim(),
    platforms:   String(t.platforms   ?? "").trim(),
    heat:        Math.min(99, Math.max(70, Number(t.heat) || 75)),
    hook_types:  Array.isArray(t.hook_types) ? t.hook_types.map(String) : [],
    volume:      (["High","Medium","Emerging"] as const).includes(t.volume) ? t.volume : "Medium",
  })).filter(t => t.title && t.description);
}

// ── Main handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Fast fail: Gemini key must be present ────────────────
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    console.error("[scan-trends] GEMINI_API_KEY not configured");
    return new Response(
      JSON.stringify({ success: false, code: "PROVIDER_CONFIG_ERROR", error: "AI provider not configured." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    // ── Auth header ────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", code: "AUTH_REQUIRED" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Parse body ─────────────────────────────────────────
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

    const nicheKey  = niche.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80);
    const requestId = crypto.randomUUID();
    const supabase  = createServiceClient();
    const token     = authHeader.replace("Bearer ", "");

    console.log("[scan-trends] niche:", niche, "| nicheKey:", nicheKey, "| requestId:", requestId);

    // ── Phase 1: Entitlement + user (parallel) ─────────────
    const [entitlementResult, userResult] = await Promise.all([
      checkAndIncrementUsage(authHeader, FEATURES.TREND_SCAN, requestId),
      supabase.auth.getUser(token),
    ]);

    const { result: entitlement, error: entitlementError } = entitlementResult;

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
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      return entitlementError;
    }

    const analyticsUserId = userResult.data?.user?.id ?? "";

    // ── Phase 2: Cache lookup ──────────────────────────────
    const now = new Date().toISOString();
    const { data: cached, error: cacheErr } = await supabase
      .from("trend_topics")
      .select("title, description, platforms, heat, hook_types, volume")
      .eq("niche_key", nicheKey)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(5);

    if (!cacheErr && cached && cached.length > 0) {
      console.log("[scan-trends] cache HIT — returning", cached.length, "topics");
      if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });
      return new Response(
        JSON.stringify({
          topics: cached.map((t: any) => ({
            title:       t.title,
            description: t.description,
            platforms:   t.platforms,
            heat:        t.heat,
            hook_types:  Array.isArray(t.hook_types)
              ? t.hook_types
              : (() => { try { return JSON.parse(t.hook_types ?? "[]"); } catch { return []; } })(),
            volume: t.volume ?? "Medium",
          })),
          cached:  true,
          niche:   nicheKey,
          usage:   entitlement,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    console.log("[scan-trends] cache MISS — calling Gemini");

    // ── Phase 3: Gemini direct REST call ──────────────────
    let topics: TrendTopic[];
    try {
      topics = await callGeminiDirect(niche, geminiKey);
      console.log("[scan-trends] Gemini returned", topics.length, "topics");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[scan-trends] Gemini call failed:", msg);
      // Return 429 specifically for rate limits
      const status = msg.includes("rate limit") ? 429 : 503;
      return new Response(
        JSON.stringify({ error: msg, code: "AI_ERROR" }),
        { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── Phase 4: Cache write (fire-and-forget) ─────────────
    if (topics.length > 0) {
      const expiresAt = new Date(Date.now() + 4 * 3600_000).toISOString();
      const now2      = new Date().toISOString();

      Promise.allSettled(
        topics.map((t) => {
          const heatScore     = Math.min(t.heat, 99) * 0.606;
          const volumeScore   = t.volume === "High" ? 20 : t.volume === "Medium" ? 10 : 5;
          const platformCount = t.platforms.split(",").filter((p) => p.trim()).length;
          const viralityScore = Math.min(Math.round(heatScore + volumeScore + Math.min(platformCount, 4) * 5), 100);

          return supabase.from("trend_topics").upsert({
            niche_key:      nicheKey,
            title:          t.title,
            description:    t.description,
            platforms:      t.platforms,
            heat:           t.heat,
            hook_types:     JSON.stringify(t.hook_types),
            volume:         t.volume,
            virality_score: viralityScore,
            trend_velocity: t.heat / 10,
            source:         "ai",
            expires_at:     expiresAt,
            collected_at:   now2,
          }, { onConflict: "niche_key, title", ignoreDuplicates: false });
        })
      ).catch(() => { /* non-fatal */ });
    }

    if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });

    return new Response(
      JSON.stringify({ topics, cached: false, niche: nicheKey, usage: entitlement }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[scan-trends] unhandled error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
