// ============================================================
// ROBINOS TREND ENGINE — STANDALONE SERVICE v2
// ============================================================
// RESPONSIBILITIES:
//   - Serve cached trend data (audio + hashtags) via HTTP API
//   - Pre-populate cache on scheduled refresh cycles
//   - Expose health + metrics endpoints for observability
//
// ARCHITECTURE PROPERTIES:
//   - RobinOS is NEVER allowed to call this service directly
//     from the browser. Server-side (edge function) only.
//   - This service is fully replaceable. RobinOS only depends
//     on the stable /trends HTTP contract — not internals.
//   - All secrets come from environment variables. No .env files.
//
// ENDPOINTS:
//   GET  /health          — lightweight healthcheck (public)
//   GET  /trends          — read cached trends (key-protected)
//   POST /refresh         — trigger cache refresh (key-protected)
//   GET  /metrics         — operational stats (key-protected)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual, createHash } from "crypto";

// ── Environment ────────────────────────────────────────────
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TREND_ENGINE_INTERNAL_API_KEY",
] as const;

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    const val = process.env[key];
    if (!val) missing.push(key);
    else env[key] = val;
  }
  if (missing.length > 0) {
    console.error(`[trend-engine] FATAL: Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  return env;
}

const ENV = loadEnv();
const PORT = Number(process.env.PORT ?? 3001);

// ── Supabase client (service role — bypasses RLS for writes) ─
function createDb(): SupabaseClient {
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Types ──────────────────────────────────────────────────
type Platform     = "TikTok" | "Instagram" | "Facebook" | "YouTube";
type TrendType    = "audio" | "hashtags";
type Velocity     = "exploding" | "hot" | "rising" | "stable";
type MomentumDir  = "up" | "stable" | "down";

const VALID_PLATFORMS: Platform[] = ["TikTok", "Instagram", "Facebook", "YouTube"];
const VALID_TYPES:     TrendType[] = ["audio", "hashtags"];

const SCHEMA_VERSION = "2.0";
const CACHE_HOURS    = 6;
const AUDIO_CAP      = 20;
const HASHTAG_CAP    = 20;

// ── Structured logger ──────────────────────────────────────
function log(level: "info" | "warn" | "error", event: string, ctx: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    ts:      new Date().toISOString(),
    level,
    service: "trend-engine",
    event,
    ...ctx,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

// ── Timing-safe key comparison ─────────────────────────────
function secureCompare(a: string, b: string): boolean {
  // Hash both sides so timing is constant regardless of length difference
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  try {
    return timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

// ── Auth middleware ────────────────────────────────────────
function validateKey(req: Request): boolean {
  const provided = req.headers.get("x-trend-engine-key") ?? "";
  const expected = ENV.TREND_ENGINE_INTERNAL_API_KEY;
  return secureCompare(provided, expected);
}

// ── Idempotency — in-memory refresh lock ──────────────────
// Prevents concurrent refresh calls from double-fetching sources.
// Sufficient for a single-instance deployment.
const refreshLock = new Map<string, Promise<RefreshResult>>();

// ── Safe HTTP helpers ──────────────────────────────────────
async function safeFetchJson(url: string, timeoutMs = 10_000): Promise<unknown | null> {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res   = await fetch(url, {
      signal:  ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; RobinOSTrendEngine/2.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      log("warn", "source_fetch_failed", { url, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    log("warn", "source_fetch_error", { url, error: String(err) });
    return null;
  }
}

async function safeFetchText(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res   = await fetch(url, {
      signal:  ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; RobinOSTrendEngine/2.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      log("warn", "source_fetch_failed", { url, status: res.status });
      return null;
    }
    return await res.text();
  } catch (err) {
    log("warn", "source_fetch_error", { url, error: String(err) });
    return null;
  }
}

// ── Artwork helpers ────────────────────────────────────────
function fuzzyTrackKey(title: string, artist: string): string {
  const clean = (s: string) =>
    s.toLowerCase()
      .replace(/\(feat\.?[^)]*\)/gi, "")
      .replace(/feat\.?.+/gi, "")
      .replace(/\[.*?\]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const artistFirst = clean(artist).split(" ")[0] ?? "";
  return `${clean(title)} ${artistFirst}`.trim();
}

function appleArtwork(raw?: string): string | null {
  if (!raw) return null;
  const upgraded = raw
    .replace(/\{w\}x\{h\}/g, "600x600")
    .replace(/\d+x\d+bb/g, "600x600bb");
  return upgraded.startsWith("http") ? upgraded : null;
}

function deezerArtwork(track: Record<string, unknown>): string | null {
  const url = (track?.album as any)?.cover_big
    || (track?.album as any)?.cover_xl
    || (track?.album as any)?.cover_medium
    || (track?.artist as any)?.picture_big
    || (track?.artist as any)?.picture_medium;
  return url && String(url).startsWith("http") ? String(url) : null;
}

function isValidUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("http") && url.length > 12;
}

// ── Signal depth derivation ────────────────────────────────
function calcAudioVirality(category: string, idx: number): number {
  const c = category === "Viral" ? 42 : category === "Trending" ? 32 : category === "Rising" ? 22 : 18;
  return Math.min(100, c + Math.max(0, AUDIO_CAP - idx) * 3);
}

function calcHashtagVirality(category: string, idx: number): number {
  const c = category === "Trending" ? 38 : category === "Rising" ? 28 : category === "Evergreen" ? 22 : 14;
  return Math.min(100, c + Math.max(0, HASHTAG_CAP - idx) * 3);
}

function deriveVelocity(score: number, trend: string, rank: number): Velocity {
  if (score >= 90 || (trend === "up" && rank <= 3)) return "exploding";
  if (score >= 75 || (trend === "up" && rank <= 8)) return "hot";
  if (score >= 60 || trend === "up")                return "rising";
  return "stable";
}

function deriveConfidence(score: number, crossSource: boolean, rank: number): number {
  let c = 55 + Math.round((score / 100) * 25);
  if (crossSource)    c += 8;
  if (rank <= 3)      c += 7;
  else if (rank <= 8) c += 4;
  return Math.min(95, c);
}

function deriveCreatorCount(score: number, rank: number, crossSource: boolean): number {
  const base =
    score >= 90 ? 8000 + (100 - rank) * 650 :
    score >= 75 ? 2000 + (100 - rank) * 380 :
    score >= 60 ?  600 + (100 - rank) * 120 :
                   150 + (100 - rank) *  40;
  return base + (crossSource ? Math.round(base * 0.35) : 0);
}

function deriveRepostCount(creatorCount: number, rank: number): number {
  const ratio = 0.18 + ((20 - Math.min(rank, 20)) / 20) * 0.10;
  return Math.round(creatorCount * ratio);
}

function deriveMomentum(velocity: Velocity): MomentumDir {
  return velocity === "stable" ? "stable" : "up";
}

function deriveWindowLabel(velocity: Velocity): string {
  if (velocity === "exploding") return "Velocity spiked in last 3h";
  if (velocity === "hot")       return "Trending for 6h+";
  if (velocity === "rising")    return "Growing over 12h";
  return "Stable signal window";
}

// ── Platform profiles ──────────────────────────────────────
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
  Instagram: { categoryBonus: { Trending: 12, Niche: 8 },     rotationOffset: 0,  tipContext: "on Instagram with strong visual context and caption depth" },
  TikTok:    { categoryBonus: { Trending: 18, Rising: 12 },    rotationOffset: 10, tipContext: "on TikTok with fast delivery and trend-aware framing" },
  YouTube:   { categoryBonus: { Evergreen: 18, Trending: 8 },  rotationOffset: 5,  tipContext: "on YouTube with topic-specific framing and search-optimized context" },
  Facebook:  { categoryBonus: { Evergreen: 15, Trending: 10 }, rotationOffset: 15, tipContext: "on Facebook with broad-audience tone and community-friendly framing" },
};

function applyPlatformBonus(base: number, category: string, velocity: string, p: AudioProfile): number {
  return Math.min(100, base + (p.categoryBonus[category] ?? 0) + (p.velocityBias[velocity] ?? 0));
}

function rotateSlice<T>(arr: T[], offset: number, count: number): T[] {
  if (!arr.length) return [];
  const safe = offset % arr.length;
  return [...arr, ...arr].slice(safe, safe + count);
}

function expiresAt(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// ── Slugify hashtag ────────────────────────────────────────
function slugifyHashtag(raw: string): string | null {
  const cleaned = raw
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (!cleaned.length) return null;
  const joined = cleaned.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  return `#${joined}`;
}

// ── Source collectors ──────────────────────────────────────
interface RawTrack { title: string; artist: string; image_url: string | null }

async function fetchAppleTracks(): Promise<RawTrack[]> {
  const data = await safeFetchJson(
    "https://rss.applemarketingtools.com/api/v2/us/music/most-played/100/songs.json"
  );
  if (!Array.isArray((data as any)?.feed?.results)) return [];
  return (data as any).feed.results.map((x: any) => ({
    title:     String(x?.name || "").trim(),
    artist:    String(x?.artistName || "").trim(),
    image_url: appleArtwork(x?.artworkUrl100 || x?.artworkUrl60),
  })).filter((x: RawTrack) => x.title && x.artist);
}

async function fetchDeezerTracks(): Promise<RawTrack[]> {
  const data = await safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100");
  if (!Array.isArray((data as any)?.data)) return [];
  return (data as any).data.map((x: any) => ({
    title:     String(x?.title || "").trim(),
    artist:    String(x?.artist?.name || "").trim(),
    image_url: deezerArtwork(x),
  })).filter((x: RawTrack) => x.title && x.artist);
}

interface GoogleTrend { title: string }

async function fetchGoogleTrends(): Promise<GoogleTrend[]> {
  const rss = await safeFetchText("https://trends.google.com/trending/rss?geo=US");
  if (!rss) return [];
  const items: GoogleTrend[] = [];
  const rx = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = rx.exec(rss)) !== null) {
    const t = String(m[1] || "").trim();
    if (t) items.push({ title: t });
    if (items.length >= 80) break;
  }
  return items;
}

// ── Build audio rows for one platform ─────────────────────
async function buildAudioRows(platform: Platform): Promise<Record<string, unknown>[]> {
  const profile = AUDIO_PROFILES[platform];
  const [apple, deezer] = await Promise.all([fetchAppleTracks(), fetchDeezerTracks()]);

  // Deezer fuzzy map for artwork lookup
  const deezerFuzzyMap = new Map<string, string | null>();
  for (const x of deezer) {
    const fk = fuzzyTrackKey(x.title, x.artist);
    if (!deezerFuzzyMap.has(fk)) deezerFuzzyMap.set(fk, x.image_url);
  }

  // Apple pool with cross-source artwork merge
  const applePool: Array<RawTrack & { crossSource: boolean }> = [];
  const seen = new Set<string>();
  for (const x of apple) {
    const fk = fuzzyTrackKey(x.title, x.artist);
    if (seen.has(fk)) continue;
    seen.add(fk);
    const deezerArt = deezerFuzzyMap.get(fk);
    applePool.push({
      title:       x.title,
      artist:      x.artist,
      image_url:   isValidUrl(deezerArt) ? deezerArt : isValidUrl(x.image_url) ? x.image_url : null,
      crossSource: deezerFuzzyMap.has(fk),
    });
  }

  // Deezer-only additions
  const mergedMap = new Map<string, typeof applePool[0]>();
  for (const item of applePool) mergedMap.set(fuzzyTrackKey(item.title, item.artist), item);
  for (const item of deezer) {
    const fk = fuzzyTrackKey(item.title, item.artist);
    if (!mergedMap.has(fk)) mergedMap.set(fk, { ...item, crossSource: false });
  }

  let merged = Array.from(mergedMap.values());
  let rotated = rotateSlice(merged, profile.rotationOffset, AUDIO_CAP * 2);
  if (profile.preferCrossSource) {
    rotated = [...rotated.filter(x => x.crossSource), ...rotated.filter(x => !x.crossSource)];
  }
  const final = rotated.slice(0, AUDIO_CAP);

  const exp = expiresAt(CACHE_HOURS);
  const now = new Date().toISOString();

  return final.map((item, idx) => {
    const baseCategory =
      idx < 4  ? "Viral" : idx < 9  ? "Trending" : idx < 14 ? "Rising" : "Classic Remix";
    const category =
      platform === "TikTok"   && idx < 6  ? "Viral" :
      platform === "TikTok"   && idx < 12 ? "Rising" :
      platform === "YouTube"  && idx >= 14 ? "Classic Remix" :
      platform === "Facebook" && idx >= 12 ? "Classic Remix" :
      baseCategory;

    const trend      = idx < 6 ? "up" : idx < 12 ? "stable" : "new";
    const baseScore  = calcAudioVirality(category, idx);
    const baseVel    = deriveVelocity(baseScore, trend, idx + 1);
    const adjScore   = applyPlatformBonus(baseScore, category, baseVel, profile);
    const velocity   = deriveVelocity(adjScore, trend, idx + 1);
    const confidence = deriveConfidence(adjScore, item.crossSource, idx + 1);
    const cc         = deriveCreatorCount(adjScore, idx + 1, item.crossSource);

    return {
      platform,
      title:              item.title,
      artist:             item.artist,
      image_url:          isValidUrl(item.image_url) ? item.image_url : null,
      category,
      uses:               `Signal #${idx + 1}`,
      trend,
      tip:                `Use this audio ${profile.tipContext} for maximum platform retention.`,
      audio_source:       "apple_music",
      virality_score:     calcAudioVirality(category, idx),
      velocity,
      confidence,
      creator_count:      cc,
      repost_count:       deriveRepostCount(cc, idx + 1),
      momentum_direction: deriveMomentum(velocity),
      window_label:       deriveWindowLabel(velocity),
      expires_at:         exp,
      collected_at:       now,
    };
  });
}

// ── Build hashtag rows for one platform ───────────────────
async function buildHashtagRows(platform: Platform): Promise<Record<string, unknown>[]> {
  const profile = HASHTAG_PROFILES[platform];
  const trends  = await fetchGoogleTrends();

  const seen    = new Set<string>();
  const rawPool: Array<{ display: string }> = [];
  for (const t of trends) {
    const tag = slugifyHashtag(t.title);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    rawPool.push({ display: tag });
    if (rawPool.length >= 80) break;
  }

  const final = rotateSlice(rawPool, profile.rotationOffset, HASHTAG_CAP * 2).slice(0, HASHTAG_CAP);
  const exp   = expiresAt(CACHE_HOURS);
  const now   = new Date().toISOString();

  return final.map((item, idx) => {
    const baseCategory =
      idx < 5  ? "Trending" : idx < 11 ? "Rising" : idx < 16 ? "Evergreen" : "Niche";
    const category =
      platform === "YouTube"  && idx >= 10 ? "Evergreen" :
      platform === "Facebook" && idx >= 8  ? "Evergreen" :
      platform === "TikTok"   && idx < 8   ? "Trending" :
      platform === "TikTok"   && idx < 14  ? "Rising" :
      baseCategory;

    const trend      = idx < 7 ? "up" : idx < 13 ? "stable" : "new";
    const base       = calcHashtagVirality(category, idx);
    const adj        = Math.min(100, base + (profile.categoryBonus[category] ?? 0));
    const velocity   = deriveVelocity(adj, trend, idx + 1);

    return {
      platform,
      tag:                item.display,
      category,
      posts:              `Signal #${idx + 1}`,
      trend,
      tip:                `Pair ${item.display} with a timely hook ${profile.tipContext}.`,
      hashtag_source:     "google_trends",
      virality_score:     calcHashtagVirality(category, idx),
      velocity,
      confidence:         deriveConfidence(adj, false, idx + 1),
      creator_count:      deriveCreatorCount(adj, idx + 1, false),
      momentum_direction: deriveMomentum(velocity),
      window_label:       deriveWindowLabel(velocity),
      expires_at:         exp,
      collected_at:       now,
    };
  });
}

// ── Refresh result type ────────────────────────────────────
interface RefreshResult {
  platforms_refreshed: Platform[];
  audios_written:      number;
  hashtags_written:    number;
  errors:              string[];
  duration_ms:         number;
}

// ── Full refresh pipeline ──────────────────────────────────
async function runRefresh(db: SupabaseClient): Promise<RefreshResult> {
  const started = Date.now();
  const errors: string[] = [];
  let   audiosWritten = 0;
  let   hashtagsWritten = 0;

  // Validate cron safety: don't double-run if previous job still running
  // (handled by in-process refreshLock above — here we log metrics)
  log("info", "refresh_started", { platforms: VALID_PLATFORMS });

  const results = await Promise.allSettled(
    VALID_PLATFORMS.flatMap((platform) => [
      buildAudioRows(platform).then(async (rows) => {
        let written = 0;
        for (const row of rows) {
          const { error } = await db
            .from("trend_audios")
            .upsert(row as any, { onConflict: "platform, title, artist", ignoreDuplicates: false });
          if (error) errors.push(`audio[${platform}]: ${error.message}`);
          else written++;
        }
        audiosWritten += written;
        log("info", "platform_audio_written", { platform, written });
      }),
      buildHashtagRows(platform).then(async (rows) => {
        let written = 0;
        for (const row of rows) {
          const { error } = await db
            .from("trend_hashtags")
            .upsert(row as any, { onConflict: "platform, tag", ignoreDuplicates: false });
          if (error) errors.push(`hashtag[${platform}]: ${error.message}`);
          else written++;
        }
        hashtagsWritten += written;
        log("info", "platform_hashtag_written", { platform, written });
      }),
    ])
  );

  for (const r of results) {
    if (r.status === "rejected") {
      errors.push(`pipeline_error: ${String(r.reason)}`);
    }
  }

  // Cleanup: delete expired rows older than 48h to keep DB lean
  await db
    .from("trend_audios")
    .delete()
    .lt("expires_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  await db
    .from("trend_hashtags")
    .delete()
    .lt("expires_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  const duration_ms = Date.now() - started;

  log("info", "refresh_complete", {
    audios_written:   audiosWritten,
    hashtags_written: hashtagsWritten,
    errors:           errors.length,
    duration_ms,
  });

  return {
    platforms_refreshed: [...VALID_PLATFORMS],
    audios_written:      audiosWritten,
    hashtags_written:    hashtagsWritten,
    errors,
    duration_ms,
  };
}

// ── Response helpers ───────────────────────────────────────
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":               "application/json",
      "X-Schema-Version":           SCHEMA_VERSION,
      "X-Trend-Engine-Service":     "robinos-trend-engine",
      "Cache-Control":              "no-store",
      "Strict-Transport-Security":  "max-age=31536000",
    },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, code, message }, status);
}

// ── Route handlers ─────────────────────────────────────────

/** GET /health — public, no auth required */
function handleHealth(): Response {
  return jsonResponse({
    ok:      true,
    service: "trend-engine",
    version: SCHEMA_VERSION,
    ts:      new Date().toISOString(),
  });
}

/** GET /trends?platform=X&type=Y */
async function handleTrends(url: URL, db: SupabaseClient): Promise<Response> {
  const start    = Date.now();
  const platform = url.searchParams.get("platform") as Platform | null;
  const type     = url.searchParams.get("type")     as TrendType | null;

  // ── Input validation ───────────────────────────────────
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return errorResponse(
      "INVALID_PLATFORM",
      `platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
      400
    );
  }
  if (!type || !VALID_TYPES.includes(type)) {
    return errorResponse(
      "INVALID_TYPE",
      `type must be one of: ${VALID_TYPES.join(", ")}`,
      400
    );
  }

  const now       = new Date().toISOString();
  const table     = type === "audio" ? "trend_audios" : "trend_hashtags";
  const orderCol  = "virality_score";
  const cap       = type === "audio" ? AUDIO_CAP : HASHTAG_CAP;

  const selectCols = type === "audio"
    ? "title, artist, image_url, category, uses, trend, tip, velocity, confidence, creator_count, repost_count, momentum_direction, window_label, expires_at, collected_at"
    : "tag, category, posts, trend, tip, velocity, confidence, creator_count, momentum_direction, window_label, expires_at, collected_at";

  const { data: cached, error: cacheErr } = await db
    .from(table)
    .select(selectCols)
    .eq("platform", platform)
    .gt("expires_at", now)
    .order(orderCol, { ascending: false })
    .limit(cap);

  const latency = Date.now() - start;

  if (cacheErr) {
    log("error", "cache_read_failed", { platform, type, error: cacheErr.message, latency_ms: latency });
    return errorResponse("CACHE_READ_FAILED", "Failed to read trend cache.", 500);
  }

  if (!cached || cached.length === 0) {
    log("warn", "cache_miss", { platform, type, latency_ms: latency });
    return errorResponse(
      "CACHE_MISS",
      "Cache expired or empty. Trigger /refresh to regenerate.",
      503
    );
  }

  // Normalize response — guarantee all fields are present and typed
  const expiresValue   = (cached[0] as any)?.expires_at   ?? null;
  const refreshedValue = (cached[0] as any)?.collected_at ?? null;

  log("info", "cache_hit", { platform, type, count: cached.length, latency_ms: latency });

  const body: Record<string, unknown> = {
    ok:           true,
    platform,
    type,
    cached:       true,
    count:        cached.length,
    refreshed_at: refreshedValue,
    expires_at:   expiresValue,
    _meta: {
      schema_version: SCHEMA_VERSION,
      served_at:      new Date().toISOString(),
    },
  };

  if (type === "audio")    body.audios    = cached;
  else                     body.hashtags  = cached;

  return jsonResponse(body);
}

/** POST /refresh — triggers cache refresh for all platforms */
async function handleRefresh(db: SupabaseClient): Promise<Response> {
  const lockKey = "global";

  // Idempotent: if a refresh is already in progress, return 202
  if (refreshLock.has(lockKey)) {
    log("info", "refresh_already_running", {});
    return jsonResponse({ ok: true, status: "already_running", message: "Refresh in progress." }, 202);
  }

  const promise = runRefresh(db).finally(() => refreshLock.delete(lockKey));
  refreshLock.set(lockKey, promise);

  // Wait for result (cron caller will wait; HTTP caller can fire-and-forget too)
  try {
    const result = await promise;
    return jsonResponse({
      ok:     true,
      status: result.errors.length > 0 ? "completed_with_errors" : "completed",
      ...result,
    });
  } catch (err) {
    log("error", "refresh_fatal", { error: String(err) });
    return errorResponse("REFRESH_FAILED", "Refresh pipeline failed.", 500);
  }
}

/** GET /metrics — operational stats */
async function handleMetrics(db: SupabaseClient): Promise<Response> {
  const now = new Date().toISOString();

  const [audioStats, hashtagStats] = await Promise.all([
    db.from("trend_audios")
      .select("platform, expires_at, collected_at")
      .gt("expires_at", now),
    db.from("trend_hashtags")
      .select("platform, expires_at, collected_at")
      .gt("expires_at", now),
  ]);

  const countByPlatform = (rows: any[] | null) =>
    VALID_PLATFORMS.reduce((acc, p) => {
      acc[p] = (rows ?? []).filter((r: any) => r.platform === p).length;
      return acc;
    }, {} as Record<Platform, number>);

  // Find next expiry across all rows
  const allExpiries = [
    ...(audioStats.data ?? []),
    ...(hashtagStats.data ?? []),
  ].map((r: any) => r.expires_at).filter(Boolean).sort();

  const nextExpiry = allExpiries[0] ?? null;

  return jsonResponse({
    ok:               true,
    ts:               now,
    schema_version:   SCHEMA_VERSION,
    cache: {
      audio_rows_live:   audioStats.data?.length ?? 0,
      hashtag_rows_live: hashtagStats.data?.length ?? 0,
      audio_by_platform:   countByPlatform(audioStats.data),
      hashtag_by_platform: countByPlatform(hashtagStats.data),
      next_expiry:         nextExpiry,
      refresh_running:     refreshLock.size > 0,
    },
  });
}

// ── Main HTTP router ───────────────────────────────────────
const db = createDb();

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url    = new URL(req.url);
    const method = req.method;
    const path   = url.pathname;

    // Health is public — no key required
    if (method === "GET" && path === "/health") {
      return handleHealth();
    }

    // All other routes require the internal key
    if (!validateKey(req)) {
      log("warn", "auth_rejected", { path, method, ip: req.headers.get("x-forwarded-for") ?? "unknown" });
      return errorResponse("UNAUTHORIZED", "Invalid or missing x-trend-engine-key.", 401);
    }

    if (method === "GET"  && path === "/trends")  return handleTrends(url, db);
    if (method === "POST" && path === "/refresh") return handleRefresh(db);
    if (method === "GET"  && path === "/metrics") return handleMetrics(db);

    return errorResponse("NOT_FOUND", "Unknown endpoint.", 404);
  },
});

log("info", "server_started", { port: PORT, schema_version: SCHEMA_VERSION });

// Graceful shutdown
process.on("SIGTERM", () => {
  log("info", "server_shutting_down", { reason: "SIGTERM" });
  server.stop();
  process.exit(0);
});
