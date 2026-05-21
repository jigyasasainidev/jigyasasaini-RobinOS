import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";

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

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // This is the authoritative enforcement point.
    // Scan-trends uses trend_scan feature key.
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

    // ============================================================
    // AI GENERATION
    // ============================================================
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
            content: `Analyze the "${niche}" niche and find 3-5 ACTUALLY trending topics that are viral or about to go viral right now in February 2026.`,
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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No results generated" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const topics = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(topics), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-trends error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});