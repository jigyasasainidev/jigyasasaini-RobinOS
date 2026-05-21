import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";

const PLATFORM_GEO: Record<Platform, string> = {
  TikTok: "us",
  Instagram: "us",
  Facebook: "us",
  YouTube: "us",
};

const TIER_LIMITS: Record<string, { audioLimit: number; hashtagLimit: number; platforms: Platform[] }> = {
  free: { audioLimit: 2, hashtagLimit: 3, platforms: ["Instagram"] },
  creator: { audioLimit: 50, hashtagLimit: 70, platforms: ["Instagram"] },
  pro_creator: { audioLimit: 200, hashtagLimit: 200, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  agency: { audioLimit: 99999, hashtagLimit: 500, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  scale_agency: { audioLimit: 99999, hashtagLimit: 500, platforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
};

const normalizeTier = (raw: string | null | undefined): string => {
  const t = String(raw || "free").toLowerCase();
  if (t === "starter") return "creator";
  if (t === "pro") return "pro_creator";
  return t;
};

const slugifyHashtag = (value: string): string => {
  const cleaned = value
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("");
  return cleaned ? `#${cleaned}` : "";
};

const safeFetchJson = async (url: string): Promise<any | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const safeFetchText = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

const fetchRealAudios = async (platform: Platform) => {
  const geo = PLATFORM_GEO[platform] || "us";
  const [appleData, deezerData] = await Promise.all([
    safeFetchJson(`https://rss.applemarketingtools.com/api/v2/${geo}/music/most-played/100/songs.json`),
    safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100"),
  ]);

  const seen = new Set<string>();
  const rows: Array<{ title: string; artist: string }> = [];

  const appleRows = Array.isArray(appleData?.feed?.results)
    ? appleData.feed.results.map((x: any) => ({ title: String(x?.name || "").trim(), artist: String(x?.artistName || "").trim() }))
    : [];
  const deezerRows = Array.isArray(deezerData?.data)
    ? deezerData.data.map((x: any) => ({ title: String(x?.title || "").trim(), artist: String(x?.artist?.name || "").trim() }))
    : [];

  for (const item of [...appleRows, ...deezerRows]) {
    if (!item.title || !item.artist) continue;
    const key = `${item.title.toLowerCase()}::${item.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(item);
    if (rows.length >= 12) break;
  }

  return rows.map((item, idx) => ({
    title: item.title,
    artist: item.artist,
    category: idx < 4 ? "Trending" : idx < 8 ? "Rising" : "Viral",
    uses: `Chart #${idx + 1}`,
    trend: idx < 5 ? "up" : idx < 9 ? "stable" : "new",
    tip: `Use this audio on ${platform} with a strong first 2 seconds and clear on-screen context for better retention.`,
  }));
};

const fetchRealHashtags = async (platform: Platform) => {
  const rss = await safeFetchText("https://trends.google.com/trending/rss?geo=US");
  if (!rss) return [];

  const titles: string[] = [];
  const itemRegex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(rss)) !== null) {
    const title = String(m[1] || "").trim();
    if (title) titles.push(title);
    if (titles.length >= 30) break;
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of titles) {
    const tag = slugifyHashtag(t);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= 15) break;
  }

  return tags.map((tag, idx) => ({
    tag,
    category: idx < 5 ? "Trending" : idx < 10 ? "Rising" : "Niche",
    posts: `Rank #${idx + 1}`,
    trend: idx < 6 ? "up" : idx < 11 ? "stable" : "new",
    tip: `Pair ${tag} with a platform-specific hook and recent context on ${platform} for stronger discoverability.`,
  }));
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { platform, type } = await req.json();
    const platformName = (platform || "Instagram") as Platform;

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

    // Get profile for tier & usage (auto-create if missing)
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, current_plan, trending_scans_used, trending_scans_reset_at, hashtag_scans_used, hashtag_scans_reset_at")
      .eq("user_id", userId)
      .maybeSingle();

    let resolvedProfile = profile;
    if (!resolvedProfile) {
      const { data: userData } = await supabase.auth.getUser(authHeader!.replace("Bearer ", ""));
      const fallbackProfile = {
        user_id: userId,
        email: userData.user?.email ?? null,
        display_name: (userData.user?.user_metadata?.display_name as string | undefined) ?? userData.user?.email ?? null,
        full_name: (userData.user?.user_metadata?.display_name as string | undefined) ?? userData.user?.email ?? null,
      };
      const { data: createdProfile } = await supabase
        .from("profiles")
        .upsert(fallbackProfile, { onConflict: "user_id" })
        .select("subscription_tier, current_plan, trending_scans_used, trending_scans_reset_at, hashtag_scans_used, hashtag_scans_reset_at")
        .single();
      resolvedProfile = createdProfile;
    }

    const normalizedTier = normalizeTier(resolvedProfile?.subscription_tier || resolvedProfile?.current_plan || "free");

    // Monthly reset check
    const now = new Date();
    const isHashtagRequest = type === "hashtags";

    const resetField = isHashtagRequest ? "hashtag_scans_reset_at" : "trending_scans_reset_at";
    const usedField = isHashtagRequest ? "hashtag_scans_used" : "trending_scans_used";
    const resetAt = resolvedProfile?.[resetField] ? new Date(resolvedProfile[resetField]) : new Date(0);
    const monthChanged = now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear();
    let scansUsed = monthChanged ? 0 : (resolvedProfile?.[usedField] || 0);

    if (monthChanged) {
      await supabase.from("profiles").update({ [usedField]: 0, [resetField]: now.toISOString() }).eq("user_id", userId);
      scansUsed = 0;
    }

    const limits = TIER_LIMITS[normalizedTier] || TIER_LIMITS.free;
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

    const results = isHashtagRequest
      ? await fetchRealHashtags(platformName)
      : await fetchRealAudios(platformName);

    if (!Array.isArray(results) || results.length === 0) {
      await supabase.from("profiles").update({ [usedField]: scansUsed }).eq("user_id", userId);
      return new Response(JSON.stringify({ error: "Live trend data is temporarily unavailable. Please retry in a minute." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
