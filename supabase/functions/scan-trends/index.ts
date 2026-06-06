// ============================================================
// ROBINOS SCAN TRENDS — Groq (OpenAI-compatible), Cache-First
// ============================================================
// FLOW:
// 1. Validate GROQ_API_KEY (fast fail)
// 2. Auth + entitlement check in parallel (quota enforced)
// 3. Cache lookup — return instantly if fresh results exist
// 4. Cache miss → per-user rate limit → Groq API → cache write → return
//
// AI approach: Groq OpenAI-compatible endpoint with tool calling.
// llama-3.3-70b-versatile natively supports function calling,
// so we get structured JSON without any markdown-stripping hacks.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  checkAndIncrementUsage,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── Per-user in-memory rate limiter ───────────────────────
// Limits each user to 8 Groq calls per 60 seconds.
// Resets automatically after the window expires.
// Cache hits bypass this entirely — no Groq call needed.
const USER_RL_MAX    = 8;
const USER_RL_WINDOW = 60_000; // 60 seconds
const userRlStore    = new Map<string, { count: number; windowStart: number }>();

function checkUserRateLimit(userId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now  = Date.now();
  const slot = userRlStore.get(userId);

  if (!slot || now - slot.windowStart >= USER_RL_WINDOW) {
    userRlStore.set(userId, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (slot.count >= USER_RL_MAX) {
    const retryAfter = Math.ceil((USER_RL_WINDOW - (now - slot.windowStart)) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  slot.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

// ── Types ──────────────────────────────────────────────────
interface TrendTopic {
  title:       string;
  description: string;
  platforms:   string;
  heat:        number;
  hook_types:  string[];
  volume:      "High" | "Medium" | "Emerging";
}

// ── Constants ──────────────────────────────────────────────
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL    = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are an expert viral content analyst with deep knowledge of internet trends and social media dynamics. When given a niche, you must identify 3-5 ACTUALLY trending topics that are currently gaining momentum or about to explode.

Your analysis must be based on real-world signals. For each topic provide:
- title: The exact trending topic, hashtag, or content angle
- description: WHY this is trending RIGHT NOW with specific data points (estimated view counts, engagement metrics, growth velocity)
- platforms: Which platforms this is trending on with specific signals (e.g. "2.3M views on TikTok in 48hrs, trending #3 on YouTube Shorts")
- heat: Score 70-99 based on actual growth velocity and virality indicators
- hook_types: Array of hook formats that are working for this trend (e.g. "POV", "Did you know", "Story time", "3 things about", "Watch till the end")
- volume: Estimated daily content volume - "High" (1000+ posts/day), "Medium" (100-999), "Emerging" (under 100)

Focus ONLY on verifiable, current trends. Be specific with numbers and platform data. Do NOT fabricate metrics — use your best estimates based on pattern analysis.`;

// ── Groq API call (OpenAI-compatible with tool calling) ───
async function callGroq(niche: string, apiKey: string): Promise<TrendTopic[]> {
  const userPrompt = `Analyze the "${niche}" niche and find 3-5 ACTUALLY trending topics that are viral or about to go viral right now in May 2026.`;

  const body = {
    model:       GROQ_MODEL,
    temperature: 0.7,
    max_tokens:  8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userPrompt    },
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
              type: "array",
              items: {
                type: "object",
                properties: {
                  title:       { type: "string",  description: "Short catchy topic title" },
                  description: { type: "string",  description: "2-3 sentence explanation with specific data points on why this is trending" },
                  platforms:   { type: "string",  description: "Comma-separated platforms with specific signals" },
                  heat:        { type: "number",  description: "Heat score from 70-99 based on growth velocity" },
                  hook_types: {
                    type:  "array",
                    items: { type: "string" },
                    description: "Hook formats working for this trend",
                  },
                  volume: {
                    type: "string",
                    enum: ["High", "Medium", "Emerging"],
                    description: "Daily content volume",
                  },
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
  };

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body:   JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? "Groq request timed out" : `Groq network error: ${err}`);
  }
  clearTimeout(timer);

  if (res.status === 429) throw new Error("Groq rate limit exceeded. Please retry shortly.");
  if (res.status === 401 || res.status === 403) throw new Error("Groq API key invalid.");
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[scan-trends] Groq HTTP error", res.status, errText.slice(0, 200));
    throw new Error(`Groq returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    console.error("[scan-trends] Groq: no tool_calls in response:", JSON.stringify(data).slice(0, 400));
    throw new Error("No results generated from Groq");
  }

  let parsed: { topics?: TrendTopic[] };
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    console.error("[scan-trends] Groq: failed to parse tool arguments:", toolCall.function.arguments?.slice(0, 300));
    throw new Error("Failed to parse Groq tool response");
  }

  const topics = parsed?.topics ?? [];
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("Groq returned no topics");
  }

  console.log("[scan-trends] Groq returned", topics.length, "topics");

  // Validate / normalise each topic
  return topics.map((t: any): TrendTopic => ({
    title:       String(t.title       ?? "").trim(),
    description: String(t.description ?? "").trim(),
    platforms:   String(t.platforms   ?? "").trim(),
    heat:        Math.min(99, Math.max(70, Number(t.heat) || 75)),
    hook_types:  Array.isArray(t.hook_types) ? t.hook_types.map(String) : [],
    volume:      (["High", "Medium", "Emerging"] as const).includes(t.volume) ? t.volume : "Medium",
  })).filter(t => t.title && t.description);
}

// ── Main handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Fast fail: Groq key must be present ─────────────────
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    console.error("[scan-trends] GROQ_API_KEY not configured");
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
    const rlUserId        = analyticsUserId || `ip:${req.headers.get("x-forwarded-for") ?? "unknown"}`;

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

      const cachedTopics = cached.map((t: any) => ({
        title:       t.title,
        description: t.description,
        platforms:   t.platforms,
        heat:        t.heat,
        hook_types:  Array.isArray(t.hook_types)
          ? t.hook_types
          : (() => { try { return JSON.parse(t.hook_types ?? "[]"); } catch { return []; } })(),
        volume: t.volume ?? "Medium",
      }));

      // Persist to scan_history even on cache hit — user still performed a scan
      if (analyticsUserId) {
        supabase.from("scan_history").insert({
          user_id: analyticsUserId,
          niche,
          topics:  cachedTopics,
        }).then(({ error }) => {
          if (error) console.error("[scan-trends] scan_history (cache hit) insert failed:", error.message);
        });
      }

      return new Response(
        JSON.stringify({
          topics:  cachedTopics,
          cached:  true,
          niche:   nicheKey,
          usage:   entitlement,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    console.log("[scan-trends] cache MISS — calling Groq");

    // ── Per-user rate limit (only on cache miss) ──────────
    const rl = checkUserRateLimit(rlUserId);
    if (!rl.allowed) {
      console.warn("[scan-trends] user rate limited:", rlUserId, "retry in", rl.retryAfterSeconds, "s");
      return new Response(
        JSON.stringify({
          error:             `Too many scans. Please wait ${rl.retryAfterSeconds} seconds before scanning again.`,
          code:              "USER_RATE_LIMITED",
          retryAfterSeconds: rl.retryAfterSeconds,
        }),
        {
          status:  429,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    // ── Phase 3: Groq API call ─────────────────────────────
    let topics: TrendTopic[];
    try {
      topics = await callGroq(niche, groqKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[scan-trends] Groq call failed:", msg);
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

    // ── Phase 5: Persist to scan_history (fire-and-forget) ─
    // This is what populates the History page. Without this write,
    // the user's scan archive stays empty even after successful scans.
    if (analyticsUserId && topics.length > 0) {
      supabase.from("scan_history").insert({
        user_id:    analyticsUserId,
        niche,
        topics:     topics.map((t) => ({
          title:       t.title,
          description: t.description,
          platforms:   t.platforms,
          heat:        t.heat,
          hook_types:  t.hook_types,
          volume:      t.volume,
        })),
      }).then(({ error }) => {
        if (error) console.error("[scan-trends] scan_history insert failed:", error.message, error.code);
        else console.log("[scan-trends] scan_history persisted for user:", analyticsUserId);
      });
    }

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
