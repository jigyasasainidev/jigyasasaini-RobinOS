// ============================================================
// ROBINOS TRENDING AUDIO & HASHTAGS — CACHE-FIRST
// Centralized Trend Intelligence Consumer
// ============================================================
// FLOW:
// 1. Entitlement check (unchanged)
// 2. Cache lookup by platform + type (audios/hashtags) + fresh expires_at
// 3. If cache hit → return cached data instantly
// 4. If cache miss → fetch live from free APIs → store to cache → return
//
// Audio data sourced from free APIs:
// - Apple Music RSS (most-played songs)
// - Deezer Charts
// Hashtags sourced from:
// - Google Trends RSS
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";

type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";

const PLATFORM_GEO: Record<Platform, string> = {
  TikTok: "us",
  Instagram: "us",
  Facebook: "us",
  YouTube: "us",
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

// ============================================================
// CACHE ROUTINES
// ============================================================
function calculateExpiresAt(hoursFromNow: number): string {
  const now = new Date();
  now.setHours(now.getHours() + hoursFromNow);
  return now.toISOString();
}

function calculateAudioVirality(category: string, index: number): number {
  const categoryBonus = category === "Trending" ? 30 : category === "Viral" ? 40 : category === "Rising" ? 20 : 10;
  const positionBonus = Math.max(0, 12 - index) * 5;
  return Math.min(categoryBonus + positionBonus, 100);
}

function calculateHashtagVirality(category: string, index: number): number {
  const categoryBonus = category === "Trending" ? 35 : category === "Rising" ? 25 : category === "Niche" ? 10 : 5;
  const positionBonus = Math.max(0, 15 - index) * 3;
  return Math.min(categoryBonus + positionBonus, 100);
}

interface CachedAudio {
  title: string;
  artist: string;
  category: string;
  uses: string;
  trend: string;
  tip: string;
}

interface CachedHashtag {
  tag: string;
  category: string;
  posts: string;
  trend: string;
  tip: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { platform, type } = await req.json();
    const platformName = (platform || "Instagram") as Platform;

    const authHeader = req.headers.get("authorization");

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // ============================================================
    const featureKey = type === "hashtags" ? FEATURES.HASHTAG_SCAN : FEATURES.TREND_SCAN;
    const effectiveRequestId = crypto.randomUUID();

    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader || "",
      featureKey,
      effectiveRequestId
    );

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(
          JSON.stringify({
            error: entitlement.code === "FEATURE_DISABLED"
              ? `${type === "hashtags" ? "Hashtag" : "Trend"} scanning requires a higher plan.`
              : entitlement.message || "Scan limit reached. Upgrade to continue.",
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

    const supabase = createServiceClient();
    const now = new Date().toISOString();

    if (type === "hashtags") {
      // ============================================================
      // HASHTAGS — CACHE LOOKUP
      // ============================================================
      const { data: cachedHashtags, error: cacheError } = await supabase
        .from("trend_hashtags")
        .select("tag, category, posts, trend, tip")
        .eq("platform", platformName)
        .gt("expires_at", now)
        .order("virality_score", { ascending: false })
        .limit(15);

      if (!cacheError && cachedHashtags && cachedHashtags.length > 0) {
        return new Response(
          JSON.stringify({
            hashtags: cachedHashtags,
            usage: entitlement,
            cached: true,
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Cache MISS — fetch live
      const liveHashtags = await fetchRealHashtags(platformName);

      if (!Array.isArray(liveHashtags) || liveHashtags.length === 0) {
        return new Response(
          JSON.stringify({ error: "Live trend data is temporarily unavailable. Please retry in a minute." }),
          { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Store to cache
      const hashtagExpiresAt = calculateExpiresAt(3);
      for (let i = 0; i < liveHashtags.length; i++) {
        const h = liveHashtags[i];
        await supabase.from("trend_hashtags").upsert(
          {
            platform: platformName,
            tag: h.tag,
            category: h.category,
            posts: h.posts,
            trend: h.trend,
            tip: h.tip,
            hashtag_source: "google_trends",
            virality_score: calculateHashtagVirality(h.category, i),
            expires_at: hashtagExpiresAt,
            collected_at: now,
          },
          { onConflict: "platform, tag", ignoreDuplicates: false }
        );
      }

      return new Response(
        JSON.stringify({
          hashtags: liveHashtags,
          usage: entitlement,
          cached: false,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    } else {
      // ============================================================
      // AUDIOS — CACHE LOOKUP
      // ============================================================
      const { data: cachedAudios, error: cacheError } = await supabase
        .from("trend_audios")
        .select("title, artist, category, uses, trend, tip")
        .eq("platform", platformName)
        .gt("expires_at", now)
        .order("virality_score", { ascending: false })
        .limit(12);

      if (!cacheError && cachedAudios && cachedAudios.length > 0) {
        return new Response(
          JSON.stringify({
            audios: cachedAudios,
            usage: entitlement,
            cached: true,
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Cache MISS — fetch live
      const liveAudios = await fetchRealAudios(platformName);

      if (!Array.isArray(liveAudios) || liveAudios.length === 0) {
        return new Response(
          JSON.stringify({ error: "Live trend data is temporarily unavailable. Please retry in a minute." }),
          { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Store to cache
      const audioExpiresAt = calculateExpiresAt(3);
      for (let i = 0; i < liveAudios.length; i++) {
        const a = liveAudios[i];
        await supabase.from("trend_audios").upsert(
          {
            platform: platformName,
            title: a.title,
            artist: a.artist,
            category: a.category,
            uses: a.uses,
            trend: a.trend,
            tip: a.tip,
            audio_source: "apple_music",
            virality_score: calculateAudioVirality(a.category, i),
            expires_at: audioExpiresAt,
            collected_at: now,
          },
          { onConflict: "platform, title, artist", ignoreDuplicates: false }
        );
      }

      return new Response(
        JSON.stringify({
          audios: liveAudios,
          usage: entitlement,
          cached: false,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("trending-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});