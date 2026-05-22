// ============================================================
// ROBINOS SCAN TRENDS — CACHE-FIRST
// Centralized Trend Intelligence Consumer
// ============================================================
// FLOW:
// 1. Entitlement check (unchanged)
// 2. Cache lookup by niche_key + fresh expires_at
// 3. If cache hit → return cached trends instantly
// 4. If cache miss → generate via AI → store to cache → return
//
// This ensures:
// - Same niche = same cached trends for ALL users
// - Per-request AI generation is eliminated
// - AI only runs during background collection OR cache misses
// - Instant response for cached niches
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import {
  validateAIConfig,
  callAI,
  AI_MODEL_DEFAULT,
} from "../_shared/ai-provider.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Startup: validate AI provider config ──────────────────
  const configError = validateAIConfig();
  if (configError) return configError;

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

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // ============================================================
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
              error: entitlement.message || "Scan limit reached. Upgrade to continue.",
              code: entitlement.code,
              feature: entitlement.feature,
              plan: entitlement.plan,
              limit: entitlement.limit,
              used: entitlement.used,
              remaining: entitlement.remaining,
              reset_at: entitlement.reset_at,
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
    const now = new Date().toISOString();

    // ============================================================
    // CACHE LOOKUP — Check if we have fresh cached trends for this niche
    // ============================================================
    const { data: cachedTopics, error: cacheError } = await supabase
      .from("trend_topics")
      .select("title, description, platforms, heat, hook_types, volume")
      .eq("niche_key", nicheKey)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(5);

    if (!cacheError && cachedTopics && cachedTopics.length > 0) {
      // Cache HIT — return cached trends instantly
      const topics = cachedTopics.map((t: any) => ({
        title: t.title,
        description: t.description,
        platforms: t.platforms,
        heat: t.heat,
        hook_types: t.hook_types || [],
        volume: t.volume || "Medium",
      }));

      return new Response(
        JSON.stringify({
          topics,
          cached: true,
          niche: nicheKey,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // CACHE MISS — Generate via AI provider adapter
    // ============================================================
    const aiResult = await callAI({
      model: AI_MODEL_DEFAULT,
      messages: [
          {
            role: "system",
            content: `You are an expert viral content analyst with deep knowledge of internet trends and social media dynamics. When given a niche, you must identify 3-5 ACTUALLY trending topics that are currently gaining momentum or about to explode.

Your analysis must be based on real-world signals. For each topic provide:
- title: The exact trending topic, hashtag, or content angle
- description: WHY this is trending RIGHT NOW with specific data points (estimated view counts, engagement metrics, growth velocity)
- platforms: Which platforms this is trending on with specific signals (e.g. "2.3M views on TikTok in 48hrs, trending #3 on YouTube Shorts")
- heat: Score 70-99 based on actual growth velocity and virality indicators
- hook_types: Array of hook formats that are working for this trend (e.g. "POV", "Did you know", "Story time", "3 things about", "Watch till the end")
- volume: Estimated daily content volume - "High" (1000+ posts/day), "Medium" (100-999), "Emerging" (under 100)

Focus ONLY on verifiable, current trends. Be specific with numbers and platform data. Do NOT fabricate metrics — use your best estimates based on pattern analysis.`,
          },
          {
            role: "user",
            content: `Analyze the "${niche}" niche and find 3-5 ACTUALLY trending topics that are viral or about to go viral right now in May 2026.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_trending_topics",
              description: "Return 3-5 trending topics for the given niche with real data",
              parameters: {
                type: "object",
                properties: {
                  topics: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Short, catchy topic title" },
                        description: { type: "string", description: "2-3 sentence explanation with specific data points on why this is trending" },
                        platforms: { type: "string", description: "Comma-separated platforms with specific signals" },
                        heat: { type: "number", description: "Heat score from 70-99 based on growth velocity" },
                        hook_types: {
                          type: "array",
                          items: { type: "string" },
                          description: "Hook formats working for this trend",
                        },
                        volume: { type: "string", enum: ["High", "Medium", "Emerging"], description: "Daily content volume" },
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
          },
        ],
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
      return new Response(JSON.stringify({ error: "No results generated" }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const topics = parsed.topics || [];

    // ============================================================
    // STORE TO CACHE for future requests
    // ============================================================
    if (topics.length > 0) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 4);

      for (const topic of topics) {
        // Calculate virality score
        const heatScore = Math.min(topic.heat || 0, 99) * 0.606;
        const volumeScore = topic.volume === "High" ? 20 : topic.volume === "Medium" ? 10 : 5;
        const platformCount = topic.platforms
          ? topic.platforms.split(",").filter((p: string) => p.trim()).length
          : 0;
        const platformScore = Math.min(platformCount, 4) * 5;
        const viralityScore = Math.min(Math.round(heatScore + volumeScore + platformScore), 100);

        await supabase.from("trend_topics").upsert(
          {
            niche_key: nicheKey,
            title: topic.title,
            description: topic.description,
            platforms: topic.platforms,
            heat: Math.min(Math.max(topic.heat || 0, 0), 99),
            hook_types: JSON.stringify(topic.hook_types || []),
            volume: topic.volume || "Medium",
            virality_score: viralityScore,
            trend_velocity: (topic.heat || 0) / 10,
            source: "ai",
            expires_at: expiresAt.toISOString(),
            collected_at: new Date().toISOString(),
          },
          { onConflict: "niche_key, title", ignoreDuplicates: false }
        );
      }
    }

    return new Response(
      JSON.stringify({
        topics,
        cached: false,
        niche: nicheKey,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scan-trends error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});