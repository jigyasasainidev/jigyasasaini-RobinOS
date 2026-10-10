// ============================================================
// ROBINOS TRENDING AUDIO + HASHTAGS — Groq-Powered, No DB
// ============================================================
// FLOW:
//   1. Auth + entitlement check
//   2. Call Groq with platform + type specific prompt
//   3. Return structured trending data directly to frontend
//
// No database writes. No Idea Stream. No cron needed.
// Frontend caches results for 12 hours in localStorage.
// Every cache miss triggers a fresh Groq generation.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CORS_HEADERS,
  FEATURES,
  checkAndIncrementUsage,
} from "../_shared/entitlement.ts";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// Groq decommissioned llama-3.3-70b-versatile on 2026-08-16.
// openai/gpt-oss-120b is the recommended replacement (tool use + JSON).
const GROQ_MODEL    = "openai/gpt-oss-120b";

type Platform  = "TikTok" | "Instagram" | "Facebook" | "YouTube";
type TrendType = "audio" | "hashtags";

// ── System prompts ────────────────────────────────────────
const AUDIO_SYSTEM = `You are a senior music trend analyst and creator intelligence expert with deep expertise in viral audio, social media music trends, and creator content strategy. You track what songs and sounds are actually exploding right now across creator platforms.

Your job: Return a curated list of 15 trending audio tracks for a specific platform. These should feel REAL — like actual chart data, not generic placeholders.

For each audio track provide:
- title: Real or realistic song/audio title (be specific — actual popular songs or realistic trending titles)
- artist: Artist or creator name
- category: Music genre or content type (e.g. "Hip Hop", "Lo-fi", "EDM", "Bollywood", "Pop", "Drill", "Afrobeats", "Phonk", "Ambient")
- uses: Estimated creator usage count in realistic format (e.g. "4.2M uses", "890K uses", "12.5M uses")
- trend: Current trend direction — "up", "stable", or "new"
- tip: ONE sharp creator insight (max 8 words) — e.g. "Perfect for morning routine transitions" or "Exploding on aesthetic lifestyle reels"
- velocity: How fast it is spreading — "exploding", "hot", "rising", or "stable"
- momentum_direction: "up", "stable", or "down"
- window_label: Time window context (e.g. "Last 48h", "This week", "Past 30 days")

Rules:
- Mix velocities (3-4 exploding, 4-5 hot, 4-5 rising, 2-3 stable)
- Match the platform culture (TikTok = fast/viral, Instagram = aesthetic, YouTube = longer content, Facebook = broader appeal)
- Include platform-relevant genres (TikTok: Phonk, Hip Hop, Drill; Instagram: Pop, R&B, Bollywood; YouTube: Lo-fi, Gaming, Cinematic)
- Tips must be actionable creator advice, not generic descriptions
- Make usage numbers realistic and varied`;

const HASHTAG_SYSTEM = `You are a senior social media strategist and hashtag intelligence analyst with deep expertise in viral hashtag trends, platform algorithms, and creator growth strategy. You know exactly which hashtags are exploding, which are oversaturated, and which are hidden gems.

Your job: Return a curated list of 15 trending hashtags for a specific platform. These should feel REAL — actual hashtag data from that platform's current ecosystem.

For each hashtag provide:
- tag: The hashtag WITH the # symbol (e.g. "#fyp", "#aesthetic", "#viral")
- category: Content category (e.g. "Lifestyle", "Beauty", "Gaming", "Fitness", "Business", "Food", "Travel", "Motivation")
- posts: Realistic post count (e.g. "2.1B posts", "45M posts", "890K posts", "12M posts")
- trend: "up", "stable", or "new"
- tip: ONE sharp creator strategy insight (max 8 words) — e.g. "Boosts reach 3x on Reels" or "Algorithm favorite for new accounts"
- velocity: "exploding", "hot", "rising", or "stable"
- momentum_direction: "up", "stable", or "down"
- window_label: (e.g. "Last 48h", "This week", "Evergreen")

Rules:
- Mix popular (#fyp style, 10B+ posts) with mid-tier (1M-100M) and niche gems (under 1M)
- Match platform culture (TikTok: short punchy tags; Instagram: aesthetic lifestyle; YouTube: discovery + SEO; Facebook: community + interest)
- Include 3-4 niche/emerging hashtags that feel like insider knowledge
- Tips must be specific tactical advice for creators using that hashtag
- Post counts must be realistic and varied across the spectrum`;

// ── Groq tool schemas ──────────────────────────────────────
function buildAudioTool() {
  return {
    type: "function" as const,
    function: {
      name: "return_trending_audio",
      description: "Return 15 trending audio tracks for the given platform",
      parameters: {
        type: "object",
        properties: {
          audios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title:              { type: "string" },
                artist:             { type: "string" },
                category:           { type: "string" },
                uses:               { type: "string" },
                trend:              { type: "string", enum: ["up", "stable", "new"] },
                tip:                { type: "string" },
                velocity:           { type: "string", enum: ["exploding", "hot", "rising", "stable"] },
                momentum_direction: { type: "string", enum: ["up", "stable", "down"] },
                window_label:       { type: "string" },
              },
              required: ["title", "artist", "category", "uses", "trend", "tip", "velocity", "momentum_direction", "window_label"],
              additionalProperties: false,
            },
          },
        },
        required: ["audios"],
        additionalProperties: false,
      },
    },
  };
}

function buildHashtagTool() {
  return {
    type: "function" as const,
    function: {
      name: "return_trending_hashtags",
      description: "Return 15 trending hashtags for the given platform",
      parameters: {
        type: "object",
        properties: {
          hashtags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tag:                { type: "string" },
                category:           { type: "string" },
                posts:              { type: "string" },
                trend:              { type: "string", enum: ["up", "stable", "new"] },
                tip:                { type: "string" },
                velocity:           { type: "string", enum: ["exploding", "hot", "rising", "stable"] },
                momentum_direction: { type: "string", enum: ["up", "stable", "down"] },
                window_label:       { type: "string" },
              },
              required: ["tag", "category", "posts", "trend", "tip", "velocity", "momentum_direction", "window_label"],
              additionalProperties: false,
            },
          },
        },
        required: ["hashtags"],
        additionalProperties: false,
      },
    },
  };
}

// ── Groq call ──────────────────────────────────────────────
async function callGroq(
  platform: Platform,
  type: TrendType,
  apiKey: string,
): Promise<{ audios?: unknown[]; hashtags?: unknown[] }> {

  const systemPrompt = type === "audio" ? AUDIO_SYSTEM : HASHTAG_SYSTEM;
  const tool         = type === "audio" ? buildAudioTool() : buildHashtagTool();
  const toolName     = type === "audio" ? "return_trending_audio" : "return_trending_hashtags";

  const userPrompt = type === "audio"
    ? `Platform: ${platform}. Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. Return 15 trending audio tracks that creators are actively using on ${platform} RIGHT NOW. Focus on what's actually dominating the ${platform} audio library this week — include a mix of mainstream hits, niche bangers, and emerging sounds.`
    : `Platform: ${platform}. Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. Return 15 trending hashtags that are performing best for creators on ${platform} RIGHT NOW. Include a smart mix of mega hashtags for reach, mid-tier for targeting, and niche gems for discoverability. Make them feel like real intelligence, not obvious generic tags.`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:                 GROQ_MODEL,
        temperature:           0.75,
        max_completion_tokens: 8192,
        reasoning_effort:      "low",
        reasoning_format:      "hidden",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        tools:       [tool],
        tool_choice: { type: "function", function: { name: toolName } },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? "Groq request timed out" : `Groq network error: ${err}`);
  }
  clearTimeout(timer);

  if (res.status === 429) throw new Error("Groq rate limit reached. Please wait a moment.");
  if (res.status === 401 || res.status === 403) throw new Error("Groq API key invalid or not configured.");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[trending-audio] Groq HTTP error", res.status, t.slice(0, 200));
    throw new Error(`Groq returned HTTP ${res.status}`);
  }

  const data     = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    console.error("[trending-audio] no tool_calls in Groq response:", JSON.stringify(data).slice(0, 400));
    throw new Error("Groq returned no results");
  }

  let parsed: { audios?: unknown[]; hashtags?: unknown[] };
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("Failed to parse Groq response");
  }

  const list = type === "audio" ? (parsed?.audios ?? []) : (parsed?.hashtags ?? []);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Groq returned empty results");
  }

  console.log(`[trending-audio] Groq returned ${list.length} ${type} for ${platform}`);
  return parsed;
}

// ── Main handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Fast fail: Groq key required
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    console.error("[trending-audio] GROQ_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "AI provider not configured.", code: "PROVIDER_CONFIG_ERROR" }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", code: "AUTH_REQUIRED" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // Parse + validate body
    let platform: Platform = "Instagram";
    let type: TrendType    = "audio";
    try {
      const body = await req.json();
      platform   = (body?.platform ?? "Instagram") as Platform;
      type       = (body?.type     ?? "audio")     as TrendType;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const validPlatforms: Platform[]   = ["TikTok", "Instagram", "Facebook", "YouTube"];
    const validTypes:     TrendType[]  = ["audio", "hashtags"];
    if (!validPlatforms.includes(platform)) {
      return new Response(
        JSON.stringify({ error: `platform must be one of: ${validPlatforms.join(", ")}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    if (!validTypes.includes(type)) {
      return new Response(
        JSON.stringify({ error: `type must be one of: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // Entitlement check
    const featureKey = type === "hashtags" ? FEATURES.HASHTAG_SCAN : FEATURES.TREND_SCAN;
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader, featureKey, crypto.randomUUID()
    );

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(
          JSON.stringify({
            error:     entitlement.code === "FEATURE_DISABLED"
                         ? `${type === "hashtags" ? "Hashtag" : "Trend"} scanning requires a higher plan.`
                         : entitlement.message || "Scan limit reached.",
            code:      entitlement.code,
            feature:   entitlement.feature,
            plan:      entitlement.plan,
            remaining: entitlement.remaining,
          }),
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      return entitlementError;
    }

    // Call Groq
    let result: { audios?: unknown[]; hashtags?: unknown[] };
    try {
      result = await callGroq(platform, type, groqKey);
    } catch (err) {
      const msg    = err instanceof Error ? err.message : String(err);
      const status = msg.includes("rate limit") ? 429 : 503;
      console.error("[trending-audio] Groq failed:", msg);
      return new Response(
        JSON.stringify({ error: msg, code: "AI_ERROR" }),
        { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // Return to frontend
    const responseBody = type === "hashtags"
      ? { hashtags: result.hashtags ?? [], usage: entitlement, cached: false }
      : { audios:   result.audios   ?? [], usage: entitlement, cached: false };

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[trending-audio] unhandled:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
