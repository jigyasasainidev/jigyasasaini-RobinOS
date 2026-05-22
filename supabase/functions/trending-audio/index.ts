// ============================================================
// ROBINOS TRENDING AUDIO & HASHTAGS — CACHE-FIRST v2
// Phase 1: Top-20, 6h cache, improved dedup/scoring,
//          velocity labels + confidence scores
// ============================================================
// FLOW:
// 1. Entitlement check (unchanged — no auth regressions)
// 2. Cache lookup by platform + type + fresh expires_at
// 3. Cache HIT  → return instantly, cached: true
// 4. Cache MISS → fetch live → normalize → dedup → rank → upsert → return
//
// ADDITIVE FIELDS (backward compatible):
//   velocity: "rising" | "hot" | "exploding" | "stable"
//   confidence: integer 55–95
// Existing fields (title, artist, category, uses, trend, tip,
//   tag, posts) remain unchanged.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── Constants ────────────────────────────────────────────────
type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";

const AUDIO_CAP = 20;       // items to collect
const HASHTAG_CAP = 20;     // items to collect
const CACHE_HOURS = 6;      // TTL for both audio + hashtag cache

const PLATFORM_GEO: Record<Platform, string> = {
  TikTok: "us",
  Instagram: "us",
  Facebook: "us",
  YouTube: "us",
};

// ── Fetch helpers ────────────────────────────────────────────
const safeFetchJson = async (url: string): Promise<any | null> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const safeFetchText = async (url: string): Promise<string | null> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

// ── Normalization helpers ────────────────────────────────────

/** Normalize audio title/artist for dedup keying */
function normalizeAudioKey(title: string, artist: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")   // strip punctuation
      .replace(/\s+/g, " ")       // collapse whitespace
      .trim();
  return `${norm(title)}::${norm(artist)}`;
}

/** Normalize audio display text (trim, collapse spaces) */
function normalizeAudioText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Normalize hashtag: canonical casing, ensure # prefix, dedup key */
function normalizeHashtag(raw: string): { display: string; key: string } | null {
  // Build camelCase hashtag from multi-word Google Trends title
  const cleaned = raw
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  if (!words.length) return null;

  // e.g. "Premier League" → "#PremierLeague"
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  const display = `#${joined}`;
  const key = display.toLowerCase();
  return { display, key };
}

// ── Velocity + Confidence derivation ────────────────────────

type Velocity = "rising" | "hot" | "exploding" | "stable";

function deriveVelocity(score: number, trend: string, rank: number): Velocity {
  if (score >= 85 || trend === "up" && rank <= 3) return "exploding";
  if (score >= 70 || (trend === "up" && rank <= 8)) return "hot";
  if (score >= 50 || trend === "up") return "rising";
  return "stable";
}

function deriveConfidence(
  score: number,
  crossSourceBonus: boolean,
  rank: number
): number {
  // Base from score bands: 55–80
  let conf = 55 + Math.round((score / 100) * 25);
  if (crossSourceBonus) conf += 8;           // appeared in multiple source lists
  if (rank <= 3) conf += 7;                  // top-3 rank zone
  else if (rank <= 8) conf += 4;
  return Math.min(95, conf);
}

// ── Virality scoring ─────────────────────────────────────────

function calcAudioVirality(category: string, index: number): number {
  const catBonus =
    category === "Viral"    ? 42 :
    category === "Trending" ? 32 :
    category === "Rising"   ? 22 :
    category === "Classic Remix" ? 18 : 12;

  // Position weight: rank 1 = max bonus, rank 20 = 0
  const posBonus = Math.max(0, AUDIO_CAP - index) * 3;
  return Math.min(100, catBonus + posBonus);
}

function calcHashtagVirality(category: string, index: number): number {
  const catBonus =
    category === "Trending"     ? 38 :
    category === "Rising"       ? 28 :
    category === "Evergreen"    ? 22 :
    category === "Niche"        ? 14 : 8;

  const posBonus = Math.max(0, HASHTAG_CAP - index) * 3;
  return Math.min(100, catBonus + posBonus);
}

// ── Cache TTL ─────────────────────────────────────────────────
function calculateExpiresAt(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

// ── Audio fetch + normalize + rank ──────────────────────────
async function fetchRealAudios(platform: Platform) {
  const geo = PLATFORM_GEO[platform] || "us";
  const [appleData, deezerData] = await Promise.all([
    safeFetchJson(
      `https://rss.applemarketingtools.com/api/v2/${geo}/music/most-played/100/songs.json`
    ),
    safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100"),
  ]);

  // Collect rows from both sources; track which appeared in both (cross-source bonus)
  const appleSet = new Set<string>();
  const appleRows: Array<{ title: string; artist: string }> = [];
  if (Array.isArray(appleData?.feed?.results)) {
    for (const x of appleData.feed.results) {
      const t = normalizeAudioText(String(x?.name || ""));
      const a = normalizeAudioText(String(x?.artistName || ""));
      if (t && a) {
        appleSet.add(normalizeAudioKey(t, a));
        appleRows.push({ title: t, artist: a });
      }
    }
  }

  const deezerRows: Array<{ title: string; artist: string }> = [];
  if (Array.isArray(deezerData?.data)) {
    for (const x of deezerData.data) {
      const t = normalizeAudioText(String(x?.title || ""));
      const a = normalizeAudioText(String(x?.artist?.name || ""));
      if (t && a) deezerRows.push({ title: t, artist: a });
    }
  }

  // Merge with cross-source tracking
  const seen = new Map<string, boolean>(); // key → crossSource
  const merged: Array<{ title: string; artist: string; crossSource: boolean }> = [];

  for (const item of appleRows) {
    const key = normalizeAudioKey(item.title, item.artist);
    if (!seen.has(key)) {
      seen.set(key, false);
      merged.push({ ...item, crossSource: false });
    }
  }
  for (const item of deezerRows) {
    const key = normalizeAudioKey(item.title, item.artist);
    if (!seen.has(key)) {
      seen.set(key, false);
      merged.push({ ...item, crossSource: false });
    } else {
      // Mark cross-source if already in list from apple
      const idx = merged.findIndex(
        (m) => normalizeAudioKey(m.title, m.artist) === key
      );
      if (idx >= 0) merged[idx] = { ...merged[idx], crossSource: true };
    }
  }

  // Slice to cap
  const final = merged.slice(0, AUDIO_CAP);

  return final.map((item, idx) => {
    const category =
      idx < 4  ? "Viral" :
      idx < 9  ? "Trending" :
      idx < 14 ? "Rising" :
                 "Classic Remix";
    const trend = idx < 6 ? "up" : idx < 12 ? "stable" : "new";
    const score = calcAudioVirality(category, idx);
    const velocity = deriveVelocity(score, trend, idx + 1);
    const confidence = deriveConfidence(score, item.crossSource, idx + 1);

    return {
      title:      item.title,
      artist:     item.artist,
      category,
      uses:       `Signal #${idx + 1}`,   // internal rank only — UI uses velocity/confidence
      trend,
      tip:        `Use this audio on ${platform} with a strong hook in the first 2 seconds and clear on-screen context for better retention.`,
      velocity,
      confidence,
    };
  });
}

// ── Hashtag fetch + normalize + rank ────────────────────────
async function fetchRealHashtags(platform: Platform) {
  const rss = await safeFetchText(
    "https://trends.google.com/trending/rss?geo=US"
  );
  if (!rss) return [];

  // Parse RSS titles
  const rawTitles: string[] = [];
  const itemRx =
    /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRx.exec(rss)) !== null) {
    const t = String(m[1] || "").trim();
    if (t) rawTitles.push(t);
    if (rawTitles.length >= 60) break;
  }

  // Normalize + dedup
  const seen = new Set<string>();
  const tags: Array<{ display: string; crossSource: boolean }> = [];

  for (const raw of rawTitles) {
    const normalized = normalizeHashtag(raw);
    if (!normalized) continue;
    if (seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    tags.push({ display: normalized.display, crossSource: false });
    if (tags.length >= HASHTAG_CAP) break;
  }

  return tags.map((item, idx) => {
    const category =
      idx < 5  ? "Trending" :
      idx < 11 ? "Rising" :
      idx < 16 ? "Evergreen" :
                 "Niche";
    const trend = idx < 7 ? "up" : idx < 13 ? "stable" : "new";
    const score = calcHashtagVirality(category, idx);
    const velocity = deriveVelocity(score, trend, idx + 1);
    const confidence = deriveConfidence(score, item.crossSource, idx + 1);

    return {
      tag:      item.display,
      category,
      posts:    `Signal #${idx + 1}`,   // internal rank only — UI uses velocity/confidence
      trend,
      tip:      `Pair ${item.display} with a platform-specific hook and current context on ${platform} for stronger discoverability.`,
      velocity,
      confidence,
    };
  });
}

// ── Main handler ─────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: CORS_HEADERS });

  try {
    const { platform, type } = await req.json();
    const platformName = (platform || "Instagram") as Platform;

    const authHeader = req.headers.get("authorization");

    // ── Entitlement check (unchanged) ─────────────────────────
    const featureKey =
      type === "hashtags" ? FEATURES.HASHTAG_SCAN : FEATURES.TREND_SCAN;
    const effectiveRequestId = crypto.randomUUID();

    const { result: entitlement, error: entitlementError } =
      await checkAndIncrementUsage(
        authHeader || "",
        featureKey,
        effectiveRequestId
      );

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(
          JSON.stringify({
            error:
              entitlement.code === "FEATURE_DISABLED"
                ? `${type === "hashtags" ? "Hashtag" : "Trend"} scanning requires a higher plan.`
                : entitlement.message || "Scan limit reached. Upgrade to continue.",
            code:      entitlement.code,
            feature:   entitlement.feature,
            plan:      entitlement.plan,
            limit:     entitlement.limit,
            used:      entitlement.used,
            remaining: entitlement.remaining,
            reset_at:  entitlement.reset_at,
          }),
          {
            status: 403,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }
      return entitlementError;
    }

    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Resolve userId for analytics (non-fatal)
    let analyticsUserId = "";
    try {
      const token = (authHeader || "").replace("Bearer ", "");
      const {
        data: { user },
      } = await supabase.auth.getUser(token);
      analyticsUserId = user?.id ?? "";
    } catch {
      /* non-fatal */
    }

    // ── HASHTAGS ─────────────────────────────────────────────
    if (type === "hashtags") {
      // Cache lookup
      const { data: cachedHashtags, error: cacheError } = await supabase
        .from("trend_hashtags")
        .select("tag, category, posts, trend, tip, velocity, confidence")
        .eq("platform", platformName)
        .gt("expires_at", now)
        .order("virality_score", { ascending: false })
        .limit(HASHTAG_CAP);   // ← 20

      if (!cacheError && cachedHashtags && cachedHashtags.length > 0) {
        if (analyticsUserId)
          trackFeatureUsage({
            supabase,
            userId: analyticsUserId,
            feature: FEATURES.HASHTAG_SCAN,
          });
        return new Response(
          JSON.stringify({ hashtags: cachedHashtags, usage: entitlement, cached: true }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Cache MISS — fetch live
      const liveHashtags = await fetchRealHashtags(platformName);

      if (!Array.isArray(liveHashtags) || liveHashtags.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              "Live trend data is temporarily unavailable. Please retry in a minute.",
          }),
          {
            status: 503,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }

      // Upsert to cache (6h TTL)
      const hashtagExpiresAt = calculateExpiresAt(CACHE_HOURS);
      for (let i = 0; i < liveHashtags.length; i++) {
        const h = liveHashtags[i];
        await supabase.from("trend_hashtags").upsert(
          {
            platform:         platformName,
            tag:              h.tag,
            category:         h.category,
            posts:            h.posts,
            trend:            h.trend,
            tip:              h.tip,
            velocity:         h.velocity,
            confidence:       h.confidence,
            hashtag_source:   "google_trends",
            virality_score:   calcHashtagVirality(h.category, i),
            expires_at:       hashtagExpiresAt,
            collected_at:     now,
          },
          { onConflict: "platform, tag", ignoreDuplicates: false }
        );
      }

      if (analyticsUserId)
        trackFeatureUsage({
          supabase,
          userId: analyticsUserId,
          feature: FEATURES.HASHTAG_SCAN,
        });
      return new Response(
        JSON.stringify({ hashtags: liveHashtags, usage: entitlement, cached: false }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── AUDIOS ───────────────────────────────────────────────
    // Cache lookup
    const { data: cachedAudios, error: cacheError } = await supabase
      .from("trend_audios")
      .select("title, artist, category, uses, trend, tip, velocity, confidence")
      .eq("platform", platformName)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(AUDIO_CAP);   // ← 20

    if (!cacheError && cachedAudios && cachedAudios.length > 0) {
      if (analyticsUserId)
        trackFeatureUsage({
          supabase,
          userId: analyticsUserId,
          feature: FEATURES.TREND_SCAN,
        });
      return new Response(
        JSON.stringify({ audios: cachedAudios, usage: entitlement, cached: true }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Cache MISS — fetch live
    const liveAudios = await fetchRealAudios(platformName);

    if (!Array.isArray(liveAudios) || liveAudios.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Live trend data is temporarily unavailable. Please retry in a minute.",
        }),
        {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // Upsert to cache (6h TTL)
    const audioExpiresAt = calculateExpiresAt(CACHE_HOURS);
    for (let i = 0; i < liveAudios.length; i++) {
      const a = liveAudios[i];
      await supabase.from("trend_audios").upsert(
        {
          platform:       platformName,
          title:          a.title,
          artist:         a.artist,
          category:       a.category,
          uses:           a.uses,
          trend:          a.trend,
          tip:            a.tip,
          velocity:       a.velocity,
          confidence:     a.confidence,
          audio_source:   "apple_music",
          virality_score: calcAudioVirality(a.category, i),
          expires_at:     audioExpiresAt,
          collected_at:   now,
        },
        { onConflict: "platform, title, artist", ignoreDuplicates: false }
      );
    }

    if (analyticsUserId)
      trackFeatureUsage({
        supabase,
        userId: analyticsUserId,
        feature: FEATURES.TREND_SCAN,
      });
    return new Response(
      JSON.stringify({ audios: liveAudios, usage: entitlement, cached: false }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[trending-audio] error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});
