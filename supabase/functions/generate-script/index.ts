import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { topic, tone, length, request_id } = await req.json();
    if (!topic) {
      return new Response(JSON.stringify({ error: "Topic is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError || !user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestId = String(request_id || crypto.randomUUID());
    const { data: usageStatus, error: usageError } = await userSupabase.rpc("get_usage_status", {
      p_feature_name: "scripts",
    });

    if (usageError) {
      console.error("usage status check failed:", usageError);
      return new Response(JSON.stringify({ error: "Unable to verify usage limits right now." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!usageStatus?.allowed) {
      return new Response(
        JSON.stringify({ error: "Daily limit reached — upgrade to continue creating", usage: usageStatus }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content || "").trim();

    if (!content) {
      await supabase
        .from("script_generations")
        .insert({ user_id: user.id, request_id: requestId, prompt: String(topic), tone: tone || "Casual", content_length: length || "60s Reel", generated_output: "", generation_status: "empty" });

      return new Response(JSON.stringify({ error: "Empty generation result" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: consumeResult, error: consumeError } = await userSupabase.rpc("consume_feature_quota", {
      p_feature_name: "scripts",
      p_increment: 1,
      p_idempotency_key: requestId,
    });

    if (consumeError || !consumeResult?.ok) {
      console.error("quota consume failed:", consumeError);
      return new Response(JSON.stringify({
        error: "Daily limit reached — upgrade to continue creating",
        usage: consumeResult?.status ?? usageStatus,
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const streamPayload = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(streamPayload, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
