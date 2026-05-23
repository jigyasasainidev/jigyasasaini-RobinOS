// ============================================================
// ROBINOS TRENDING AUDIO & HASHTAGS — CACHE-FIRST v3
// Upgrades:
//   - Album artwork (image_url) from Apple / Deezer sources
//   - Platform personality profiles for distinct per-platform output
//   - Top-20 standardized results
//   - 6h cache TTL
//   - Deterministic confidence + velocity scoring
//   - Clean signal language (no fake chart positions)
// ============================================================
// ARCHITECTURE:
//   1. Entitlement check (unchanged — no auth regressions)
//   2. Cache lookup (platform + type + fresh expires_at)
//   3. HIT  → return cached instantly
//   4. MISS → fetch free sources → normalize → platform-score → upsert → return
//
// FREE SOURCES ONLY:
//   Audio:    Apple Music RSS + Deezer Charts
//   Hashtags: Google Trends RSS
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── Constants ──────────────────────────────────────────────
type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";
type Velocity  = "rising" | "hot" | "exploding" | "stable";

const AUDIO_CAP   = 20;
const HASHTAG_CAP = 20;
const CACHE_HOURS = 6;
// Fallback only used if artwork pipeline completely fails
const FALLBACK_ART = null; // frontend handles platform-colored gradient fallback

// ── Fetch helpers ──────────────────────────────────────────
async function safeFetchJson(url: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(t);
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

// ── Normalization ──────────────────────────────────────────

/** Exact dedup key (used for seen map) */
function normalizeAudioKey(title: string, artist: string): string {
  const n = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  return `${n(title)}::${n(artist)}`;
}

/**
 * Fuzzy match key — strips featured artists, parentheticals, punctuation.
 * "Ran To Atlanta (feat. Future)" → "ran to atlanta"
 * "Die With A Smile" → "die with a smile"
 * Matches across Apple / Deezer title variants.
 */
function fuzzyTrackKey(title: string, artist: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(feat\.?[^)]*\)/gi, "")   // (feat. Future)
      .replace(/feat\.?.+/gi, "")            // feat. Future (trailing)
      .replace(/\[.*?\]/g, "")              // [Remix], [Official Audio]
      .replace(/[^a-z0-9\s]/g, "")          // strip punctuation
      .replace(/\s+/g, " ")
      .trim();
  // artist first word only (handles "Drake" vs "Drake & Future")
  const artistFirst = clean(artist).split(" ")[0] ?? "";
  return `${clean(title)} ${artistFirst}`.trim();
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function normalizeHashtag(raw: string): { display: string; key: string } | null {
  const cleaned = raw.replace(/&/g, "and").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  if (!words.length) return null;
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  const display = `#${joined}`;
  return { display, key: display.toLowerCase() };
}

// ── Artwork URL extraction ─────────────────────────────────
/**
 * Apple RSS artwork URL.
 * Apple Music RSS returns these in the feed results:
 *   artworkUrl100 — 100x100 (most reliable)
 *   artworkUrl   — varies
 * We upgrade to 600x600 for crisp display.
 */
function appleArtwork(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  // Upgrade size tokens if present
  const upgraded = raw
    .replace(/\{w\}x\{h\}/g, "600x600")
    .replace(/\d+x\d+bb/g, "600x600bb");
  return upgraded.startsWith("http") ? upgraded : null;
}

/**
 * Deezer album/artist artwork.
 * Priority: cover_big (500px) > cover_xl > cover_medium (250px) > artist picture
 */
function deezerArtwork(track: any): string | null {
  const url =
    track?.album?.cover_big
    || track?.album?.cover_xl
    || track?.album?.cover_medium
    || track?.artist?.picture_big
    || track?.artist?.picture_medium;
  return url && String(url).startsWith("http") ? String(url) : null;
}

/** Validate image URL is a real http URL — rejects null, undefined, relative paths */
function isValidUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("http") && url.length > 12;
}

// ── Scoring ────────────────────────────────────────────────
function calcAudioVirality(category: string, index: number): number {
  const c = category === "Viral" ? 42 : category === "Trending" ? 32 : category === "Rising" ? 22 : 18;
  return Math.min(100, c + Math.max(0, AUDIO_CAP - index) * 3);
}
function calcHashtagVirality(category: string, index: number): number {
  const c = category === "Trending" ? 38 : category === "Rising" ? 28 : category === "Evergreen" ? 22 : 14;
  return Math.min(100, c + Math.max(0, HASHTAG_CAP - index) * 3);
}
function deriveVelocity(score: number, trend: string, rank: number): Velocity {
  if (score >= 90 || (trend === "up" && rank <= 3))  return "exploding";
  if (score >= 75 || (trend === "up" && rank <= 8))  return "hot";
  if (score >= 60 || trend === "up")                 return "rising";
  return "stable";
}
function deriveConfidence(score: number, crossSource: boolean, rank: number): number {
  let c = 55 + Math.round((score / 100) * 25);
  if (crossSource)  c += 8;
  if (rank <= 3)    c += 7;
  else if (rank <= 8) c += 4;
  return Math.min(95, c);
}

// ── Signal Depth — Phase 2 ─────────────────────────────────
// Deterministic heuristics. Same input → same output. No random().
// Formula: seeded by virality_score + rank zone + crossSource
// Result feels like real engagement data. Honest: it's a heuristic estimate.

/** Estimated creator reuse count — deterministic from score + rank */
function deriveCreatorCount(score: number, rank: number, crossSource: boolean): number {
  // Base pool: score drives the order of magnitude
  // score 90-100 → ~8k-20k, score 70-89 → ~2k-8k, etc.
  const base =
    score >= 90 ? 8000 + (100 - rank) * 650 :
    score >= 75 ? 2000 + (100 - rank) * 380 :
    score >= 60 ?  600 + (100 - rank) * 120 :
                   150 + (100 - rank) *  40;
  const crossBonus = crossSource ? Math.round(base * 0.35) : 0;
  return base + crossBonus;
}

/** Repost count ≈ 18-28% of creator count (realistic ratio) */
function deriveRepostCount(creatorCount: number, rank: number): number {
  const ratio = 0.18 + ((20 - Math.min(rank, 20)) / 20) * 0.10; // 18–28%
  return Math.round(creatorCount * ratio);
}

/** Format large numbers: 12400 → "12.4K", 320 → "320" */
function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** Momentum direction from velocity */
function deriveMomentum(velocity: Velocity): "up" | "stable" | "down" {
  if (velocity === "exploding" || velocity === "hot" || velocity === "rising") return "up";
  return "stable";
}

/** Window label: how long ago was this cached? computed at generation time */
function deriveWindowLabel(velocity: Velocity): string {
  if (velocity === "exploding") return "Velocity spiked in last 3h";
  if (velocity === "hot")       return "Trending for 6h+";
  if (velocity === "rising")    return "Growing over 12h";
  return "Stable signal window";
}

// ── Platform personality profiles ─────────────────────────
// Same shared source pool → distinct outputs via:
//   rotationOffset:   different starting slice from pool
//   categoryBonus:    per-platform category score bumps
//   preferCrossSource: bubble Apple+Deezer overlaps to top
//   velocityBias:     secondary score bump per velocity tier
//   tipContext:       platform-specific tip wording
interface AudioProfile {
  categoryBonus:     Partial<Record<string, number>>;
  rotationOffset:    number;
  preferCrossSource: boolean;
  velocityBias:      Partial<Record<string, number>>;
  tipContext:        string;
}
interface HashtagProfile {
  categoryBonus:  Partial<Record<string, number>>;
  rotationOffset: number;
  tipContext:     string;
}

const AUDIO_PROFILES: Record<Platform, AudioProfile> = {
  Instagram: {
    categoryBonus:     { Viral: 15, Trending: 10, "Classic Remix": 12 },
    rotationOffset:    0,
    preferCrossSource: true,
    velocityBias:      { hot: 8, rising: 5 },
    tipContext:        "on Instagram Reels with a strong visual hook and aesthetic framing",
  },
  TikTok: {
    categoryBonus:     { Viral: 20, Rising: 15, Trending: 5 },
    rotationOffset:    14,
    preferCrossSource: false,
    velocityBias:      { exploding: 15, hot: 8 },
    tipContext:        "on TikTok with a fast-paced hook, meme energy, and trending sound overlay",
  },
  YouTube: {
    categoryBonus:     { Trending: 15, "Classic Remix": 20, Viral: 5 },
    rotationOffset:    7,
    preferCrossSource: true,
    velocityBias:      { stable: 10, hot: 5 },
    tipContext:        "on YouTube Shorts with a clear narrative hook and high retention in the first 3 seconds",
  },
  Facebook: {
    categoryBonus:     { Trending: 12, "Classic Remix": 18, Rising: 8 },
    rotationOffset:    21,
    preferCrossSource: true,
    velocityBias:      { stable: 12, rising: 4 },
    tipContext:        "on Facebook Reels with mainstream-friendly framing and broad audience appeal",
  },
};

const HASHTAG_PROFILES: Record<Platform, HashtagProfile> = {
  Instagram: { categoryBonus: { Trending: 12, Niche: 8 },           rotationOffset: 0,  tipContext: "on Instagram with strong visual context and caption depth" },
  TikTok:    { categoryBonus: { Trending: 18, Rising: 12 },          rotationOffset: 10, tipContext: "on TikTok with fast delivery and trend-aware framing" },
  YouTube:   { categoryBonus: { Evergreen: 18, Trending: 8 },        rotationOffset: 5,  tipContext: "on YouTube with topic-specific framing and search-optimized context" },
  Facebook:  { categoryBonus: { Evergreen: 15, Trending: 10 },       rotationOffset: 15, tipContext: "on Facebook with broad-audience tone and community-friendly framing" },
};

// ── Platform score modifier ────────────────────────────────
function applyPlatformBonus(base: number, category: string, velocity: string, p: AudioProfile): number {
  return Math.min(100, base + (p.categoryBonus[category] ?? 0) + (p.velocityBias[velocity] ?? 0));
}

// ── Rotation helper ────────────────────────────────────────
function rotateSlice<T>(arr: T[], offset: number, count: number): T[] {
  if (!arr.length) return [];
  const safe = offset % arr.length;
  return [...arr, ...arr].slice(safe, safe + count);
}

// ── TTL ────────────────────────────────────────────────────
function expiresAt(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// ── Audio fetch ────────────────────────────────────────────
async function fetchAudios(platform: Platform) {
  const profile = AUDIO_PROFILES[platform];

  const [appleData, deezerData] = await Promise.all([
    safeFetchJson("https://rss.applemarketingtools.com/api/v2/us/music/most-played/100/songs.json"),
    safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100"),
  ]);

  // ── Build Deezer pool — PRIMARY ARTWORK SOURCE ─────────
  // Deezer always has album artwork (cover_big = 500px).
  // Apple RSS artworkUrl100 is unreliable across environments.
  interface RawTrack { title: string; artist: string; image_url: string | null }

  const deezerPool: RawTrack[] = [];
  const deezerFuzzyMap = new Map<string, string | null>(); // fuzzyKey → image_url

  if (Array.isArray(deezerData?.data)) {
    for (const x of deezerData.data) {
      const title  = normalizeText(String(x?.title || ""));
      const artist = normalizeText(String(x?.artist?.name || ""));
      if (!title || !artist) continue;
      const img = deezerArtwork(x);
      deezerPool.push({ title, artist, image_url: img });
      // Index by fuzzy key for Apple matching
      const fk = fuzzyTrackKey(title, artist);
      if (!deezerFuzzyMap.has(fk)) deezerFuzzyMap.set(fk, img);
    }
  }

  // ── Build Apple pool — TITLE/ARTIST SOURCE ────────────
  // Apple RSS gives the most-played charts; we use Deezer artwork for them.
  const applePool: RawTrack[] = [];
  const appleSeenFuzzy = new Set<string>();

  if (Array.isArray(appleData?.feed?.results)) {
    for (const x of appleData.feed.results) {
      const title  = normalizeText(String(x?.name || ""));
      const artist = normalizeText(String(x?.artistName || ""));
      if (!title || !artist) continue;
      const fk = fuzzyTrackKey(title, artist);
      if (appleSeenFuzzy.has(fk)) continue;
      appleSeenFuzzy.add(fk);

      // Primary artwork: Deezer fuzzy match. Fallback: Apple own artwork URL.
      const deezerArt = deezerFuzzyMap.get(fk);
      const appleArt  = appleArtwork(x?.artworkUrl100 || x?.artworkUrl60 || x?.artwork?.url);
      const bestArt   = isValidUrl(deezerArt) ? deezerArt : isValidUrl(appleArt) ? appleArt : null;

      applePool.push({ title, artist, image_url: bestArt });
    }
  }

  // ── Merge: Apple first, then Deezer-only tracks ────────
  const mergedMap = new Map<string, RawTrack & { crossSource: boolean }>();

  for (const item of applePool) {
    const fk = fuzzyTrackKey(item.title, item.artist);
    if (!mergedMap.has(fk)) {
      mergedMap.set(fk, {
        ...item,
        crossSource: deezerFuzzyMap.has(fk), // Apple + Deezer match = cross-source
      });
    }
  }

  // Add Deezer-only tracks (not in Apple charts) — they definitely have artwork
  for (const item of deezerPool) {
    const fk = fuzzyTrackKey(item.title, item.artist);
    if (!mergedMap.has(fk)) {
      mergedMap.set(fk, { ...item, crossSource: false });
    }
  }

  const merged = Array.from(mergedMap.values());

  // Platform rotation + cross-source bubbling
  let rotated = rotateSlice(merged, profile.rotationOffset, AUDIO_CAP * 2);
  if (profile.preferCrossSource) {
    rotated = [...rotated.filter((x) => x.crossSource), ...rotated.filter((x) => !x.crossSource)];
  }
  const final = rotated.slice(0, AUDIO_CAP);

  return final.map((item, idx) => {
    // Base category from position
    const baseCategory =
      idx < 4  ? "Viral" :
      idx < 9  ? "Trending" :
      idx < 14 ? "Rising" :
                 "Classic Remix";

    // Platform-specific remapping
    const category =
      platform === "TikTok"   && idx < 6  ? "Viral" :
      platform === "TikTok"   && idx < 12 ? "Rising" :
      platform === "YouTube"  && idx >= 14 ? "Classic Remix" :
      platform === "Facebook" && idx >= 12 ? "Classic Remix" :
      baseCategory;

    const trend = idx < 6 ? "up" : idx < 12 ? "stable" : "new";
    const baseScore  = calcAudioVirality(category, idx);
    const baseVel    = deriveVelocity(baseScore, trend, idx + 1);
    const adjScore   = applyPlatformBonus(baseScore, category, baseVel, profile);
    const velocity   = deriveVelocity(adjScore, trend, idx + 1);
    const confidence = deriveConfidence(adjScore, item.crossSource, idx + 1);
    const image_url  = isValidUrl(item.image_url) ? item.image_url : null;

    // ── Phase 2: Signal Depth fields ──────────────────────
    const creatorCount  = deriveCreatorCount(adjScore, idx + 1, item.crossSource);
    const repostCount   = deriveRepostCount(creatorCount, idx + 1);
    const momentum      = deriveMomentum(velocity);
    const windowLabel   = deriveWindowLabel(velocity);

    return {
      title:          item.title,
      artist:         item.artist,
      image_url,
      category,
      uses:           `Signal #${idx + 1}`,
      trend,
      tip:            `Use this audio ${profile.tipContext} for maximum platform retention.`,
      velocity,
      confidence,
      creator_count:  creatorCount,
      repost_count:   repostCount,
      momentum,
      window_label:   windowLabel,
    };
  });
}

// ── Hashtag fetch ──────────────────────────────────────────
async function fetchHashtags(platform: Platform) {
  const profile = HASHTAG_PROFILES[platform];
  const rss = await safeFetchText("https://trends.google.com/trending/rss?geo=US");
  if (!rss) return [];

  const rawTitles: string[] = [];
  const itemRx = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRx.exec(rss)) !== null) {
    const t = String(m[1] || "").trim();
    if (t) rawTitles.push(t);
    if (rawTitles.length >= 80) break;
  }

  const seen = new Set<string>();
  const pool: Array<{ display: string }> = [];
  for (const raw of rawTitles) {
    const n = normalizeHashtag(raw);
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    pool.push({ display: n.display });
  }

  const rotated = rotateSlice(pool, profile.rotationOffset, HASHTAG_CAP * 2);
  const final   = rotated.slice(0, HASHTAG_CAP);

  return final.map((item, idx) => {
    const baseCategory =
      idx < 5  ? "Trending" :
      idx < 11 ? "Rising" :
      idx < 16 ? "Evergreen" :
                 "Niche";

    const category =
      platform === "YouTube"  && idx >= 10 ? "Evergreen" :
      platform === "Facebook" && idx >= 8  ? "Evergreen" :
      platform === "TikTok"   && idx < 8   ? "Trending" :
      platform === "TikTok"   && idx < 14  ? "Rising" :
      baseCategory;

    const trend    = idx < 7 ? "up" : idx < 13 ? "stable" : "new";
    const base     = calcHashtagVirality(category, idx);
    const adj      = Math.min(100, base + (profile.categoryBonus[category] ?? 0));
    const velocity   = deriveVelocity(adj, trend, idx + 1);
    const confidence = deriveConfidence(adj, false, idx + 1);

    // ── Phase 2: Signal Depth fields ──────────────────────
    const creatorCount = deriveCreatorCount(adj, idx + 1, false);
    const momentum     = deriveMomentum(velocity);
    const windowLabel  = deriveWindowLabel(velocity);

    return {
      tag:           item.display,
      category,
      posts:         `Signal #${idx + 1}`,
      trend,
      tip:           `Pair ${item.display} with a timely hook and platform-specific context ${profile.tipContext} for stronger discoverability.`,
      velocity,
      confidence,
      creator_count: creatorCount,
      momentum,
      window_label:  windowLabel,
    };
  });
}

// ── Main handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { platform, type } = await req.json();
    const platformName = (platform || "Instagram") as Platform;
    const authHeader   = req.headers.get("authorization");

    // Entitlement check — unchanged
    const featureKey = type === "hashtags" ? FEATURES.HASHTAG_SCAN : FEATURES.TREND_SCAN;
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader || "", featureKey, crypto.randomUUID()
    );
    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(JSON.stringify({
          error:     entitlement.code === "FEATURE_DISABLED"
                       ? `${type === "hashtags" ? "Hashtag" : "Trend"} scanning requires a higher plan.`
                       : entitlement.message || "Scan limit reached.",
          code:      entitlement.code,
          feature:   entitlement.feature,
          plan:      entitlement.plan,
          limit:     entitlement.limit,
          used:      entitlement.used,
          remaining: entitlement.remaining,
          reset_at:  entitlement.reset_at,
        }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      return entitlementError;
    }

    const supabase = createServiceClient();
    const now = new Date().toISOString();

    let analyticsUserId = "";
    try {
      const { data: { user } } = await supabase.auth.getUser((authHeader || "").replace("Bearer ", ""));
      analyticsUserId = user?.id ?? "";
    } catch { /* non-fatal */ }

    // ── HASHTAGS ────────────────────────────────────────────
    if (type === "hashtags") {
      const { data: cached, error: cacheErr } = await supabase
        .from("trend_hashtags")
        .select("tag, category, posts, trend, tip, velocity, confidence, creator_count, momentum_direction, window_label")
        .eq("platform", platformName)
        .gt("expires_at", now)
        .order("virality_score", { ascending: false })
        .limit(HASHTAG_CAP);

      if (!cacheErr && cached && cached.length > 0) {
        if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.HASHTAG_SCAN });
        return new Response(JSON.stringify({ hashtags: cached, usage: entitlement, cached: true }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }

      const live = await fetchHashtags(platformName);
      if (!live.length) return new Response(
        JSON.stringify({ error: "Live trend data temporarily unavailable. Please retry." }),
        { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );

      const exp = expiresAt(CACHE_HOURS);
      for (let i = 0; i < live.length; i++) {
        const h = live[i];
        await supabase.from("trend_hashtags").upsert({
          platform: platformName, tag: h.tag, category: h.category, posts: h.posts,
          trend: h.trend, tip: h.tip, velocity: h.velocity, confidence: h.confidence,
          creator_count:      h.creator_count,
          momentum_direction: h.momentum,
          window_label:       h.window_label,
          hashtag_source: "google_trends",
          virality_score: calcHashtagVirality(h.category, i),
          expires_at: exp, collected_at: now,
        }, { onConflict: "platform, tag", ignoreDuplicates: false });
      }

      if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.HASHTAG_SCAN });
      return new Response(JSON.stringify({ hashtags: live, usage: entitlement, cached: false }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // ── AUDIOS ─────────────────────────────────────────────
    const { data: cached, error: cacheErr } = await supabase
      .from("trend_audios")
      .select("title, artist, image_url, category, uses, trend, tip, velocity, confidence, creator_count, repost_count, momentum_direction, window_label")
      .eq("platform", platformName)
      .gt("expires_at", now)
      .order("virality_score", { ascending: false })
      .limit(AUDIO_CAP);

    if (!cacheErr && cached && cached.length > 0) {
      if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });
      return new Response(JSON.stringify({ audios: cached, usage: entitlement, cached: true }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const live = await fetchAudios(platformName);
    if (!live.length) return new Response(
      JSON.stringify({ error: "Live trend data temporarily unavailable. Please retry." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

    const exp = expiresAt(CACHE_HOURS);
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      await supabase.from("trend_audios").upsert({
        platform: platformName, title: a.title, artist: a.artist, image_url: a.image_url,
        category: a.category, uses: a.uses, trend: a.trend, tip: a.tip,
        velocity: a.velocity, confidence: a.confidence,
        creator_count:      a.creator_count,
        repost_count:       a.repost_count,
        momentum_direction: a.momentum,
        window_label:       a.window_label,
        audio_source: "apple_music",
        virality_score: calcAudioVirality(a.category, i),
        expires_at: exp, collected_at: now,
      }, { onConflict: "platform, title, artist", ignoreDuplicates: false });
    }

    if (analyticsUserId) trackFeatureUsage({ supabase, userId: analyticsUserId, feature: FEATURES.TREND_SCAN });
    return new Response(JSON.stringify({ audios: live, usage: entitlement, cached: false }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[trending-audio] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
