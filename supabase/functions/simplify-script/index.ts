import {
  validateGeminiConfig,
  callGemini,
  GEMINI_MODEL_FAST,
} from "../_shared/gemini.ts";
import {
  CORS_HEADERS,
  createServiceClient,
} from "../_shared/entitlement.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const configError = validateGeminiConfig();
  if (configError) return configError;

  // Auth check — simplify-script is an authenticated endpoint
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Verify JWT (no quota increment — simplify is a post-generation util)
  const supabase = createServiceClient();
  const token    = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { script } = await req.json();
    if (!script || typeof script !== "string") {
      return new Response(JSON.stringify({ error: "Script text required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (script.length > 10000) {
      return new Response(JSON.stringify({ error: "Script too long (max 10000 chars)" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const aiResult = await callGemini({
      model: GEMINI_MODEL_FAST,
      messages: [
        {
          role: "system",
          content: `You are a script simplifier for content creators. Convert the detailed script into a simple, easy-to-read format anyone can follow.

Rules:
1. Remove ALL markdown (no ##, **, etc)
2. Simple, conversational language
3. Three sections: WHAT TO SAY, HOW TO EDIT, TIPS
4. Numbered steps for "What to Say" — spoken words only, no timestamps
5. Editing directions explained like to a friend: "Add chill music here"
6. Remove jargon: no "pattern interrupt", "retention", "B-roll"
7. Plain text only — no markdown, no special symbols
8. Max 60% of original length`,
        },
        {
          role: "user",
          content: `Simplify this script:\n\n${script}`,
        },
      ],
    });

    if (!aiResult.ok) {
      console.error("simplify-script Gemini error:", aiResult.code);
      return new Response(
        JSON.stringify({ success: false, code: aiResult.code, error: aiResult.message }),
        { status: aiResult.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const simplified = aiResult.data?.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ simplified }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("simplify-script error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
