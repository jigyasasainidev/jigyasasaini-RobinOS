import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ============================================================
// GROQ CONSTANTS
// ============================================================
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL    = "llama-3.3-70b-versatile";

type Platform = "youtube" | "instagram" | "tiktok" | "facebook";
type Style = "viral" | "seo_optimized" | "storytelling" | "educational" | "bold" | "conversational";

const platformGuidance: Record<Platform, string> = {
  youtube: "Write an SEO-focused YouTube description with searchable phrasing, intent-rich keywords, natural CTA structure, and discoverability language.",
  instagram: "Write with emotional hooks, scan-friendly formatting, engagement-first flow, and save/share optimization.",
  tiktok: "Write with retention hooks, curiosity patterns, trend-aware tone, and fast attention structure.",
  facebook: "Write a storytelling-first caption that encourages comments and discussion with conversational engagement.",
};

// ============================================================
// GROQ API CALL (OpenAI-compatible)
// ============================================================
async function callGroq(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 25_000
): Promise<string> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        temperature: 0.7,
        max_tokens:  4096,
        messages,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? "Groq request timed out" : `Groq network error: ${err}`);
  }
  clearTimeout(timer);

  if (res.status === 429) throw new Error("Groq rate limit exceeded. Please retry shortly.");
  if (res.status === 401 || res.status === 403) throw new Error("Groq API key invalid or quota exhausted.");
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[generate-caption] Groq HTTP error", res.status, errText.slice(0, 200));
    throw new Error(`Groq returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const content: string | null = data?.choices?.[0]?.message?.content?.trim() ?? null;

  if (!content) {
    console.error("[generate-caption] Groq empty response:", JSON.stringify(data).slice(0, 400));
    throw new Error("Groq returned empty content");
  }

  return content;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Startup: validate Groq key ────────────────────────────
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    return new Response(
      JSON.stringify({ success: false, code: "PROVIDER_CONFIG_ERROR", error: "AI provider not configured." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { platform, generationStyle, prompt, requestId } = await req.json();

    const normalizedPlatform = String(platform || "").toLowerCase() as Platform;
    const normalizedStyle = String(generationStyle || "").toLowerCase() as Style;
    const normalizedPrompt = String(prompt || "").trim();

    const validPlatforms: Platform[] = ["youtube", "instagram", "tiktok", "facebook"];
    const validStyles: Style[] = ["viral", "seo_optimized", "storytelling", "educational", "bold", "conversational"];

    if (!validPlatforms.includes(normalizedPlatform)) {
      return new Response(JSON.stringify({ error: "Invalid platform" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!validStyles.includes(normalizedStyle)) {
      return new Response(JSON.stringify({ error: "Invalid generation style" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (normalizedPrompt.length < 3 || normalizedPrompt.length > 2000) {
      return new Response(JSON.stringify({ error: "Prompt must be 3-2000 characters" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // ============================================================
    const effectiveRequestId = String(requestId || crypto.randomUUID());
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader,
      FEATURES.CAPTION_GENERATION,
      effectiveRequestId
    );

    if (entitlementError) {
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
    // AI GENERATION VIA GROQ
    // ============================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRole);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let content: string;
    try {
      content = await callGroq(groqKey, [
        {
          role: "system",
          content: `You are RobinOS Caption Engine. Return only JSON with keys: generated_caption (string), generated_hashtags (string[]), generated_keywords (string[]).

Goal: AI-powered platform optimization and discoverability for creators.

Style rules:
- viral: punchy, high-energy, pattern interrupt hooks
- seo_optimized: search intent language, discoverability keywords
- storytelling: narrative arc with emotional progression
- educational: clarity-first, value-dense, structured
- bold: provocative confident tone, still brand-safe
- conversational: human, warm, natural cadence

Platform rule:
${platformGuidance[normalizedPlatform]}

Output constraints:
- generated_caption: 2-7 concise lines, no markdown
- generated_hashtags: 8-14 entries, each starts with #
- generated_keywords: 6-12 entries, plain keywords without #
- Keep output practical and conversion-oriented.`,
        },
        {
          role: "user",
          content: `Platform: ${normalizedPlatform}\nStyle: ${normalizedStyle}\nContent idea: ${normalizedPrompt}`,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown AI error";
      const status = msg.includes("rate limit") ? 429 : 503;
      return new Response(
        JSON.stringify({ success: false, code: "AI_UNAVAILABLE", error: msg }),
        { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    let parsed: { generated_caption?: string; generated_hashtags?: string[]; generated_keywords?: string[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    const generatedCaption = String(parsed.generated_caption || "").trim();
    const generatedHashtags = (Array.isArray(parsed.generated_hashtags) ? parsed.generated_hashtags : [])
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/^#/, "")}`))
      .slice(0, 16);

    const generatedKeywords = (Array.isArray(parsed.generated_keywords) ? parsed.generated_keywords : [])
      .map((word) => String(word || "").trim())
      .filter(Boolean)
      .slice(0, 16);

    if (!generatedCaption) {
      return new Response(JSON.stringify({ error: "Empty generation result" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Save generation
    const { data: generation, error: insertError } = await supabase
      .from("caption_generations")
      .insert({
        user_id: user.id,
        request_id: effectiveRequestId,
        platform: normalizedPlatform,
        generation_style: normalizedStyle,
        prompt: normalizedPrompt,
        generated_caption: generatedCaption,
        generated_hashtags: generatedHashtags,
        generated_keywords: generatedKeywords,
        generation_status: "succeeded",
      })
      .select()
      .single();

    if (insertError) {
      console.error("generate-caption insert error:", insertError);
      return new Response(JSON.stringify({ error: "Could not save generation" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Analytics — silent, never blocks response
    trackFeatureUsage({ supabase, userId: user.id, feature: FEATURES.CAPTION_GENERATION });

    return new Response(
      JSON.stringify({ generation, usage: entitlement }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    console.error("generate-caption error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});