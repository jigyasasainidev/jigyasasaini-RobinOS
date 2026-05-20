import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Platform = "youtube" | "instagram" | "tiktok" | "facebook";
type Style = "viral" | "seo_optimized" | "storytelling" | "educational" | "bold" | "conversational";

const platformGuidance: Record<Platform, string> = {
  youtube: "Write an SEO-focused YouTube description with searchable phrasing, intent-rich keywords, natural CTA structure, and discoverability language.",
  instagram: "Write with emotional hooks, scan-friendly formatting, engagement-first flow, and save/share optimization.",
  tiktok: "Write with retention hooks, curiosity patterns, trend-aware tone, and fast attention structure.",
  facebook: "Write a storytelling-first caption that encourages comments and discussion with conversational engagement.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!validStyles.includes(normalizedStyle)) {
      return new Response(JSON.stringify({ error: "Invalid generation style" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (normalizedPrompt.length < 3 || normalizedPrompt.length > 2000) {
      return new Response(JSON.stringify({ error: "Prompt must be 3-2000 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(supabaseUrl, serviceRole);
    const userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(token);

    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: usageStatus, error: usageStatusError } = await userSupabase.rpc("get_usage_status", { p_feature_name: "captions" });
    if (usageStatusError) {
      return new Response(JSON.stringify({ error: "Unable to verify usage limits right now." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!usageStatus?.allowed) {
      return new Response(JSON.stringify({
        error: "Daily limit reached — upgrade to continue creating",
        usage: usageStatus,
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        response_format: { type: "json_object" },
        messages: [
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
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "");
      console.error("generate-caption AI error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Caption generation failed" }), {
        status: aiResponse.status === 429 || aiResponse.status === 402 ? aiResponse.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await aiResponse.json();
    const content = raw?.choices?.[0]?.message?.content || "{}";

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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const effectiveRequestId = String(requestId || crypto.randomUUID());
    const { data: creationResult, error: creationError } = await userSupabase.rpc("create_caption_generation_if_allowed", {
      p_request_id: effectiveRequestId,
      p_platform: normalizedPlatform,
      p_generation_style: normalizedStyle,
      p_prompt: normalizedPrompt,
      p_generated_caption: generatedCaption,
      p_generated_hashtags: generatedHashtags,
      p_generated_keywords: generatedKeywords,
    });

    if (creationError) {
      console.error("generate-caption create_caption_generation_if_allowed error:", creationError);
      return new Response(JSON.stringify({ error: "Could not save generation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!creationResult?.ok) {
      return new Response(JSON.stringify({
        error: "Daily limit reached — upgrade to continue creating",
        usage: creationResult?.status ?? usageStatus,
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = creationResult?.generation;

    return new Response(JSON.stringify({ generation: row, usage: creationResult?.status ?? usageStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    console.error("generate-caption error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});