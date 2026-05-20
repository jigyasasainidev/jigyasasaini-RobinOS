import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { platform, type } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI gateway not configured");

    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile for tier & usage
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, trending_scans_used, trending_scans_reset_at, hashtag_scans_used, hashtag_scans_reset_at")
      .eq("user_id", userId)
      .single();

    const tier = (profile?.subscription_tier || "free").toLowerCase();
    const normalizedTier = tier === "starter" ? "creator" : tier === "pro" ? "pro_creator" : tier;

    // Monthly reset check
    const now = new Date();
    const isHashtagRequest = type === "hashtags";

    const resetField = isHashtagRequest ? "hashtag_scans_reset_at" : "trending_scans_reset_at";
    const usedField = isHashtagRequest ? "hashtag_scans_used" : "trending_scans_used";
    const resetAt = profile?.[resetField] ? new Date(profile[resetField]) : new Date(0);
    const monthChanged = now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear();
    let scansUsed = monthChanged ? 0 : (profile?.[usedField] || 0);

    if (monthChanged) {
      await supabase.from("profiles").update({ [usedField]: 0, [resetField]: now.toISOString() }).eq("user_id", userId);
    }

    // Tier limits
    const tierLimits: Record<string, { audioLimit: number; hashtagLimit: number; platforms: string[] }> = {
      free: { audioLimit: 2, hashtagLimit: 3, platforms: ["Instagram"] },
      creator: { audioLimit: 50, hashtagLimit: 70, platforms: ["Instagram"] },
      pro_creator: { audioLimit: 200, hashtagLimit: 200, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
      agency: { audioLimit: 99999, hashtagLimit: 500, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
      scale_agency: { audioLimit: 99999, hashtagLimit: 500, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
    };

    const limits = tierLimits[normalizedTier] || tierLimits.free;
    const platformName = platform || "Instagram";
    const currentLimit = isHashtagRequest ? limits.hashtagLimit : limits.audioLimit;

    // Check platform access
    if (!limits.platforms.includes(platformName)) {
      return new Response(JSON.stringify({ 
        error: "platform_locked",
        message: `${platformName} requires Pro Creator or higher plan.`,
        allowed_platforms: limits.platforms,
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check scan limit
    if (scansUsed >= currentLimit) {
      return new Response(JSON.stringify({ 
        error: "limit_reached",
        message: normalizedTier === "free" 
          ? `Free plan limit reached. Upgrade to continue!`
          : `Monthly limit reached (${currentLimit}). Upgrade for more!`,
        used: scansUsed,
        limit: currentLimit,
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment usage
    await supabase.from("profiles").update({ 
      [usedField]: scansUsed + 1 
    }).eq("user_id", userId);

    // Build prompt based on type
    let systemPrompt: string;
    let userPrompt: string;

    if (isHashtagRequest) {
      systemPrompt = `You are a social media hashtag trends expert specializing in global social audio trends. Return ONLY a valid JSON array of 15 currently trending hashtags on ${platformName} as of today.

IMPORTANT RULES:
- Prioritize globally relevant creator hashtags across regions and niches
- Include platform-specific trending hashtags that are genuinely viral RIGHT NOW
- Include hashtags from entertainment, lifestyle, tech, motivation, comedy, and creator and business niches
- These must be REAL trending hashtags, not generic ones

Each item must have these fields:
- "tag": the hashtag including # symbol (e.g. "#CreatorGrowth")
- "category": one of "Trending", "Viral", "Rising", "Evergreen", "Niche"
- "posts": approximate number of posts using this hashtag (string like "2.3M" or "450K")
- "trend": "up" or "stable" or "new"
- "tip": a 1-sentence tip in English on how to use this hashtag effectively on ${platformName}

Return ONLY the JSON array, no markdown, no explanation.`;
      userPrompt = `List the top 15 trending hashtags on ${platformName} right now in March 2026. Focus on what global creators are using right now across entertainment, business, lifestyle, education, and viral trends.`;
    } else {
      systemPrompt = `You are a social media music trends expert specializing in global social audio trends. Return ONLY a valid JSON array of 12 currently trending audio/songs on ${platformName} as of today. 

IMPORTANT RULES:
- Prioritize globally trending tracks and creator-ready audio formats used across regions
- Include a mix of fast-rising and established viral tracks
- Include songs from the last 1-4 weeks that are genuinely trending RIGHT NOW
- Include platform-native trends, remixes, and creator-friendly sounds
- Include songs used in trending reels/edits

Each item must have these fields:
- "title": exact song/audio name as it appears on ${platformName}
- "artist": original artist name
- "category": one of "Trending", "Viral", "Rising", "Classic Remix", "Global Pop", "Creator Mix"
- "uses": approximate number of videos using this audio (string like "2.3M" or "450K")  
- "trend": "up" or "stable" or "new"
- "tip": a 1-sentence tip in English on how to use this audio for maximum engagement on ${platformName}

Make the data as realistic and current as possible. Keep output globally relevant and current. Return ONLY the JSON array, no markdown, no explanation.`;
      userPrompt = `List the top 12 trending audios on ${platformName} right now in March 2026. Focus on what global creators are using right now, including fast-rising and high-retention audio trends.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      // Rollback usage
      await supabase.from("profiles").update({ [usedField]: scansUsed }).eq("user_id", userId);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";
    
    let results;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      console.error("Failed to parse AI response:", content);
      results = [];
    }

    const responseKey = isHashtagRequest ? "hashtags" : "audios";

    return new Response(JSON.stringify({ 
      [responseKey]: results, 
      usage: { used: scansUsed + 1, limit: currentLimit },
      allowed_platforms: limits.platforms,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trending-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
