import {
  validateAIConfig,
  callAI,
  AI_MODEL_FAST,
} from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Startup: validate AI provider config ──────────────────
  const configError = validateAIConfig();
  if (configError) return configError;

  try {
    const { script } = await req.json();
    if (!script || typeof script !== "string") {
      return new Response(JSON.stringify({ error: "Script text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (script.length > 10000) {
      return new Response(JSON.stringify({ error: "Script too long (max 10000 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await callAI({
      model: AI_MODEL_FAST,
      messages: [
        {
          role: "system",
          content: `You are a script simplifier for content creators. Your job is to take a detailed AI-generated script and convert it into a simple, easy-to-read format that ANYONE can understand — even a 10-year-old.

Rules:
1. Remove ALL markdown formatting (no ##, **, etc)
2. Write in simple, conversational language
3. Break into clear sections: WHAT TO SAY, HOW TO EDIT, TIPS
4. Use numbered steps for "What to Say" — just the spoken words, no timestamps
5. For editing directions, write like you're explaining to a friend: "Add some chill music here", "Show a clip of..."
6. Keep the energy and hook of the original but make it dead simple
7. Remove jargon like "pattern interrupt", "retention", "B-roll"
8. Output should be clean plain text — no markdown, no special symbols
9. Keep it SHORT — maximum 60% of original length`,
        },
        {
          role: "user",
          content: `Simplify this script:\n\n${script}`,
        },
      ],
    });

    if (!aiResult.ok) {
      console.error("simplify-script AI error:", aiResult.code);
      return new Response(
        JSON.stringify({ success: false, code: aiResult.code, error: aiResult.message }),
        { status: aiResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const simplified = aiResult.data?.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ simplified }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("simplify-script error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
