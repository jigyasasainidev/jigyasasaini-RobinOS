import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  createErrorResponse,
} from "../_shared/entitlement.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { topic, tone, length, request_id } = await req.json();
    if (!topic) {
      return new Response(JSON.stringify({ error: "Topic is required" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // This is the authoritative enforcement point.
    // No frontend trust — all validation happens here.
    // ============================================================
    const requestId = String(request_id || crypto.randomUUID());
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader,
      FEATURES.SCRIPT_GENERATION,
      requestId
    );

    if (entitlementError) {
      // If usage limit exceeded, return the standardized error
      if (entitlement && !entitlement.success) {
        return new Response(
          JSON.stringify({
            error: entitlement.message || "Daily limit reached — upgrade to continue creating",
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

    // ============================================================
    // AI GENERATION
    // ============================================================
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createServiceClient();
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

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
            content: `You are an elite viral script writer for short-form and long-form content. You write scripts that maximize retention, emotional impact, and shareability.

When given a topic, tone, and length, generate:

1. **3 HOOKS** (opening lines that stop the scroll — each should be a different style: question, bold statement, story opener)
2. **FULL SCRIPT** (structured with timestamps, pattern interrupts every 3-5 seconds for short-form, clear sections for long-form. Include [VISUAL CUE] directions inline.)
3. **EDITING DIRECTIONS** (5-7 specific visual editing instructions: b-roll suggestions, text overlays, transitions, sound effects, pacing notes)

Format the output clearly with markdown headers. Be specific, actionable, and ruthlessly engaging. The script should feel like it was written by a top-tier content strategist.`,
          },
          {
            role: "user",
            content: `Topic: "${topic}"\nTone: ${tone || "Casual"}\nLength: ${length || "60s Reel"}`,
          },
        ],
        stream: false,
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

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content || "").trim();

    if (!content) {
      await supabase
        .from("script_generations")
        .insert({ user_id: user.id, request_id: requestId, prompt: String(topic), tone: tone || "Casual", content_length: length || "60s Reel", generated_output: "", generation_status: "empty" });

      return new Response(JSON.stringify({ error: "Empty generation result" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    await supabase.from("script_generations").insert({
      user_id: user.id,
      request_id: requestId,
      prompt: String(topic),
      tone: tone || "Casual",
      content_length: length || "60s Reel",
      generated_output: content,
      generation_status: "succeeded",
    });

    await supabase.from("script_history").insert({
      user_id: user.id,
      topic: String(topic),
      tone: tone || "Casual",
      length: length || "60s Reel",
      output: content,
    });

    const streamPayload = `data: ${JSON.stringify({ choices: [{ delta: { content } }], usage: entitlement })}\n\ndata: [DONE]\n\n`;
    return new Response(streamPayload, {
      headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});