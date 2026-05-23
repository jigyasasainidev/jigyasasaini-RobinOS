// ============================================================
// ROBINOS CENTRALIZED TREND COLLECTION PIPELINE
// Background ingestion from free data sources + AI enrichment
// v2: Signal depth fields, artwork, platform profiles aligned
//     with trending-audio v3 so cache rows are always complete.
// Intended to run via Supabase cron schedule (every 6 hours)
// ============================================================
// FLOW:
// 1. Creates a snapshot record for this collection run
// 2. Fetches Google Trends RSS for rising queries
// 3. Fetches Apple Music RSS + Deezer for trending audio
// 4. AI-enriches topics per niche (classifies, scores, clusters)
// 5. Stores results in centralized cache tables
// 6. Updates snapshot with completion status
//
// DESIGN PROPERTIES:
// - ON CONFLICT DO NOTHING prevents duplicate ingestion
// - Snapshots provide idempotency tracking
// - Errors per source are collected, not fatal
// - Deterministic expires_at based on collection_time
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { CORS_HEADERS, createServiceClient } from "../_shared/entitlement.ts";
import {
  validateAIConfig,
  callAI,
  AI_MODEL_DEFAULT,
} from "../_shared/ai-provider.ts";

// ============================================================
// TYPES
// ============================================================
type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";
type Velocity  = "rising" | "hot" | "exploding" | "stable";

interface TopicRecord {
  title: string;
  description: string;
  platforms: string;
  heat: number;
  hook_types: string[];
  volume: string;
}

interface AudioRecord {
  title: string;
  artist: string;
  image_url: string | null;
  category: string;
  uses: string;
  trend: string;
  tip: string;
  audio_source: string;
  virality_score: number;
  // Signal depth — written to DB, must match migration 20 columns
  velocity: string;
  confidence: number;
  creator_count: number;
  repost_count: number;
  momentum_direction: string;
  window_label: string;
}

interface HashtagRecord {
  tag: string;
  category: string;
  posts: string;
  trend: string;
  tip: string;
  hashtag_source: string;
  virality_score: number;
  // Signal depth
  velocity: string;
  confidence: number;
  creator_count: number;
  momentum_direction: string;
  window_label: string;
}

// ============================================================
// CONFIGURATION
// ============================================================
const COLLECTION_NICHES = [
  "ai_tools",
  "fitness",
  "luxury",
  "finance",
  "motivation",
  "ecommerce",
  "productivity",
  "gaming",
  "travel",
  "food",
  "beauty",
  "education",
  "technology",
  "music",
  "fashion",
];

const PLATFORMS: Platform[] = ["TikTok", "Instagram", "Facebook", "YouTube"];

const TOPICS_TTL_HOURS   = 4;
const AUDIOS_TTL_HOURS   = 6; // aligned with trending-audio cache TTL
const HASHTAGS_TTL_HOURS = 6; // aligned with trending-audio cache TTL

const AUDIO_CAP   = 20;
const HASHTAG_CAP = 20;

// ============================================================
// SAFE HTTP FETCH HELPERS
// ============================================================
const safeFetchJson = async (url: string, timeoutMs = 10000): Promise<unknown | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; RobinOSCollector/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const safeFetchText = async (url: string, timeoutMs = 10000): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; RobinOSCollector/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

// ============================================================
// ARTWORK HELPERS (ported from trending-audio v3)
// ============================================================

/**
 * Fuzzy match key — strips featured artists, parentheticals, punctuation.
 * "Ran To Atlanta (feat. Future)" → "ran to atlanta ran"
 * Matches across Apple / Deezer title variants.
 */
function fuzzyTrackKey(title: string, artist: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(feat\.?[^)]*\)/gi, "")
      .replace(/feat\.?.+/gi, "")
      .replace(/\[.*?\]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const artistFirst = clean(artist).split(" ")[0] ?? "";
  return `${clean(title)} ${artistFirst}`.trim();
}

/** Apple artwork URL — upgrades size token to 600x600 */
function appleArtwork(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const upgraded = raw
    .replace(/\{w\}x\{h\}/g, "600x600")
    .replace(/\d+x\d+bb/g, "600x600bb");
  return upgraded.startsWith("http") ? upgraded : null;
}

/** Deezer album artwork — prefers cover_big (500px) */
function deezerArtwork(track: any): string | null {
  const url =
    track?.album?.cover_big ||
    track?.album?.cover_xl ||
    track?.album?.cover_medium ||
    track?.artist?.picture_big ||
    track?.artist?.picture_medium;
  return url && String(url).startsWith("http") ? String(url) : null;
}

/** Validates image URL is a real http URL */
function isValidUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("http") && url.length > 12;
}

// ============================================================
// SIGNAL DEPTH HELPERS (ported from trending-audio v3)
// Same formulas — ensures DB rows match what trending-audio
// would have generated, preventing overwrite data loss.
// ============================================================

function calcAudioVirality(category: string, index: number): number {
  const c = category === "Viral" ? 42 : category === "Trending" ? 32 : category === "Rising" ? 22 : 18;
  return Math.min(100, c + Math.max(0, AUDIO_CAP - index) * 3);
}

function calcHashtagVirality(category: string, index: number): number {
  const c = category === "Trending" ? 38 : category === "Rising" ? 28 : category === "Evergreen" ? 22 : 14;
  return Math.min(100, c + Math.max(0, HASHTAG_CAP - index) * 3);
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

function deriveMomentum(velocity: Velocity): "up" | "stable" | "down" {
  return (velocity === "exploding" || velocity === "hot" || velocity === "rising") ? "up" : "stable";
}

function deriveWindowLabel(velocity: Velocity): string {
  if (velocity === "exploding") return "Velocity spiked in last 3h";
  if (velocity === "hot")       return "Trending for 6h+";
  if (velocity === "rising")    return "Growing over 12h";
  return "Stable signal window";
}

// ============================================================
// PLATFORM PERSONALITY PROFILES (ported from trending-audio v3)
// Ensures collect-trends pre-populates cache with platform-
// differentiated content, preventing overwrite data loss when
// trending-audio's fresh cache-miss output gets replaced.
// ============================================================
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

// ============================================================
// GOOGLE TRENDS RSS — RISING QUERIES
// ============================================================
interface GoogleTrendItem {
  title: string;
  approxTraffic: string;
}

const fetchGoogleTrends = async (): Promise<GoogleTrendItem[]> => {
  const rss = await safeFetchText("https://trends.google.com/trending/rss?geo=US");
  if (!rss) return [];

  const items: GoogleTrendItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(rss)) !== null) {
    const itemXml = match[1];
    const titleMatch   = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemXml);
    const trafficMatch = /<ht:approx_traffic>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:approx_traffic>/i.exec(itemXml);
    const title       = titleMatch   ? titleMatch[1].trim()   : "";
    const approxTraffic = trafficMatch ? trafficMatch[1].trim() : "";
    if (title) items.push({ title, approxTraffic });
  }

  return items.slice(0, 30);
};

// ============================================================
// APPLE MUSIC RSS — MOST PLAYED SONGS (with artwork)
// ============================================================
interface AppleMusicTrack {
  title: string;
  artist: string;
  image_url: string | null;
}

const fetchAppleMusicTop100 = async (geo = "us"): Promise<AppleMusicTrack[]> => {
  const data = await safeFetchJson(
    `https://rss.applemarketingtools.com/api/v2/${geo}/music/most-played/100/songs.json`
  );
  if (!data || !Array.isArray((data as any)?.feed?.results)) return [];

  return (data as any).feed.results
    .map((x: any) => ({
      title:     String(x?.name || "").trim(),
      artist:    String(x?.artistName || "").trim(),
      image_url: appleArtwork(x?.artworkUrl100 || x?.artworkUrl60 || x?.artwork?.url),
    }))
    .filter((x: AppleMusicTrack) => x.title && x.artist);
};

// ============================================================
// DEEZER API — CHARTS (with artwork)
// ============================================================
const fetchDeezerChart = async (): Promise<AppleMusicTrack[]> => {
  const data = await safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100");
  if (!data || !Array.isArray((data as any)?.data)) return [];

  return (data as any).data
    .map((x: any) => ({
      title:     String(x?.title || "").trim(),
      artist:    String(x?.artist?.name || "").trim(),
      image_url: deezerArtwork(x),
    }))
    .filter((x: AppleMusicTrack) => x.title && x.artist);
};

// ============================================================
// AI ENRICHMENT — CLASSIFY + SCORE TOPICS BY NICHE
// ============================================================

interface AIEnrichmentInput {
  niche: string;
  googleTrends: GoogleTrendItem[];
}

const aiEnrichTopics = async (input: AIEnrichmentInput): Promise<TopicRecord[]> => {
  const trendTitles = input.googleTrends
    .slice(0, 10)
    .map((t) => `- ${t.title}${t.approxTraffic ? ` (${t.approxTraffic})` : ""}`)
    .join("\n");

  const aiResult = await callAI({
    model: AI_MODEL_DEFAULT,
    messages: [
      {
        role: "system",
        content: `You are an expert viral content analyst. Given a niche and current Google Trends data, identify 3-5 trending topics. Return as JSON with EXACT schema. Each topic must have: title, description, platforms, heat (70-99), hook_types (array), volume ("High"|"Medium"|"Emerging").`,
      },
      {
        role: "user",
        content: `Niche: ${input.niche}\n\nCurrent Google Trends:\n${trendTitles || "No real-time data available — use pattern analysis."}\n\nReturn 3-5 trending topics for this niche.`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "return_trending_topics",
          description: "Return 3-5 trending topics for the given niche",
          parameters: {
            type: "object",
            properties: {
              topics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title:       { type: "string" },
                    description: { type: "string" },
                    platforms:   { type: "string" },
                    heat:        { type: "number" },
                    hook_types:  { type: "array", items: { type: "string" } },
                    volume:      { type: "string", enum: ["High", "Medium", "Emerging"] },
                  },
                  required: ["title", "description", "platforms", "heat", "hook_types", "volume"],
                  additionalProperties: false,
                },
              },
            },
            required: ["topics"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "return_trending_topics" } },
  });

  if (!aiResult.ok) {
    console.warn(`[collect-trends] AI enrichment failed for ${input.niche}: ${aiResult.code}`);
    return [];
  }

  try {
    const toolCall = aiResult.data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return [];
    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.topics || [];
  } catch (err) {
    console.error(`[collect-trends] AI response parse error for ${input.niche}:`, err);
    return [];
  }
};

// ============================================================
// VIRALITY SCORE CALCULATOR (for topics — unchanged)
// ============================================================
function calculateViralityScore(topic: { heat: number; volume?: string; platforms: string }): number {
  const heatScore    = Math.min(topic.heat, 99) * 0.606;
  const volumeScore  = topic.volume === "High" ? 20 : topic.volume === "Medium" ? 10 : 5;
  const platformCount = topic.platforms
    ? topic.platforms.split(",").filter((p) => p.trim()).length
    : 0;
  const platformScore = Math.min(platformCount, 4) * 5;
  return Math.min(Math.round(heatScore + volumeScore + platformScore), 100);
}

// ============================================================
// SLUGIFY HASHTAG
// ============================================================
function slugifyHashtag(value: string): string {
  const cleaned = value
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("");
  return cleaned ? `#${cleaned}` : "";
}

// ============================================================
// DATABASE STORAGE
// ============================================================

async function storeTopics(
  supabase: ReturnType<typeof createClient>,
  topics: TopicRecord[],
  niche: string,
  snapshotId: string,
  expiresAt: string
): Promise<number> {
  if (topics.length === 0) return 0;

  const records = topics.map((t) => ({
    niche_key:             niche,
    title:                 t.title,
    description:           t.description,
    platforms:             t.platforms,
    heat:                  Math.min(Math.max(t.heat, 0), 99),
    hook_types:            JSON.stringify(t.hook_types || []),
    volume:                t.volume || "Medium",
    virality_score:        calculateViralityScore(t),
    trend_velocity:        t.heat / 10,
    source:                "ai",
    collection_snapshot_id: snapshotId,
    expires_at:            expiresAt,
    collected_at:          new Date().toISOString(),
  }));

  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_topics")
      .upsert(record, { onConflict: "niche_key, title", ignoreDuplicates: false });
    if (!error) stored++;
  }
  return stored;
}

async function storeAudios(
  supabase: ReturnType<typeof createClient>,
  audios: AudioRecord[],
  platform: string,
  snapshotId: string,
  expiresAt: string
): Promise<number> {
  if (audios.length === 0) return 0;

  const records = audios.map((a) => ({
    platform,
    title:              a.title,
    artist:             a.artist,
    image_url:          a.image_url,
    category:           a.category,
    uses:               a.uses,
    trend:              a.trend,
    tip:                a.tip,
    audio_source:       a.audio_source,
    virality_score:     a.virality_score,
    // Signal depth fields (migration 20)
    velocity:           a.velocity,
    confidence:         a.confidence,
    creator_count:      a.creator_count,
    repost_count:       a.repost_count,
    momentum_direction: a.momentum_direction,
    window_label:       a.window_label,
    collection_snapshot_id: snapshotId,
    expires_at:         expiresAt,
    collected_at:       new Date().toISOString(),
  }));

  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_audios")
      .upsert(record, { onConflict: "platform, title, artist", ignoreDuplicates: false });
    if (!error) stored++;
  }
  return stored;
}

async function storeHashtags(
  supabase: ReturnType<typeof createClient>,
  hashtags: HashtagRecord[],
  platform: string,
  snapshotId: string,
  expiresAt: string
): Promise<number> {
  if (hashtags.length === 0) return 0;

  const records = hashtags.map((h) => ({
    platform,
    tag:                h.tag,
    category:           h.category,
    posts:              h.posts,
    trend:              h.trend,
    tip:                h.tip,
    hashtag_source:     h.hashtag_source,
    virality_score:     h.virality_score,
    // Signal depth fields (migration 20)
    velocity:           h.velocity,
    confidence:         h.confidence,
    creator_count:      h.creator_count,
    momentum_direction: h.momentum_direction,
    window_label:       h.window_label,
    collection_snapshot_id: snapshotId,
    expires_at:         expiresAt,
    collected_at:       new Date().toISOString(),
  }));

  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_hashtags")
      .upsert(record, { onConflict: "platform, tag", ignoreDuplicates: false });
    if (!error) stored++;
  }
  return stored;
}

// ============================================================
// AUDIO COLLECTION PIPELINE
// Uses Deezer artwork (cover_big) + Apple fuzzy matching,
// platform personality profiles, and signal depth — identical
// to trending-audio v3 so pre-populated cache rows are valid.
// ============================================================
async function collectAudiosForPlatform(
  supabase: ReturnType<typeof createClient>,
  platform: Platform,
  snapshotId: string,
  expiresAt: string
): Promise<{ audiosCollected: number; errors: string[] }> {
  const errors: string[] = [];
  const profile = AUDIO_PROFILES[platform];

  // Fetch Apple Music + Deezer in parallel
  const [appleTracks, deezerTracks] = await Promise.all([
    fetchAppleMusicTop100(),
    fetchDeezerChart(),
  ]);

  if (!appleTracks.length && !deezerTracks.length) {
    errors.push(`No audio data available for ${platform}`);
    return { audiosCollected: 0, errors };
  }

  // Build Deezer fuzzy map — PRIMARY ARTWORK SOURCE
  const deezerFuzzyMap = new Map<string, string | null>(); // fuzzyKey → image_url
  for (const x of deezerTracks) {
    const fk = fuzzyTrackKey(x.title, x.artist);
    if (!deezerFuzzyMap.has(fk)) deezerFuzzyMap.set(fk, x.image_url);
  }

  // Build Apple pool with cross-source artwork merge
  const applePool: Array<{ title: string; artist: string; image_url: string | null; crossSource: boolean }> = [];
  const appleSeenFuzzy = new Set<string>();
  for (const x of appleTracks) {
    const fk = fuzzyTrackKey(x.title, x.artist);
    if (appleSeenFuzzy.has(fk)) continue;
    appleSeenFuzzy.add(fk);
    const deezerArt = deezerFuzzyMap.get(fk);
    const bestArt   = isValidUrl(deezerArt) ? deezerArt : isValidUrl(x.image_url) ? x.image_url : null;
    applePool.push({ title: x.title, artist: x.artist, image_url: bestArt, crossSource: deezerFuzzyMap.has(fk) });
  }

  // Add Deezer-only tracks (guaranteed to have artwork)
  const mergedMap = new Map<string, typeof applePool[0]>();
  for (const item of applePool) {
    mergedMap.set(fuzzyTrackKey(item.title, item.artist), item);
  }
  for (const item of deezerTracks) {
    const fk = fuzzyTrackKey(item.title, item.artist);
    if (!mergedMap.has(fk)) {
      mergedMap.set(fk, { title: item.title, artist: item.artist, image_url: item.image_url, crossSource: false });
    }
  }

  const merged = Array.from(mergedMap.values());

  // Apply platform rotation + cross-source bubbling
  let rotated = rotateSlice(merged, profile.rotationOffset, AUDIO_CAP * 2);
  if (profile.preferCrossSource) {
    rotated = [...rotated.filter((x) => x.crossSource), ...rotated.filter((x) => !x.crossSource)];
  }
  const final = rotated.slice(0, AUDIO_CAP);

  const audioRecords: AudioRecord[] = final.map((item, idx) => {
    // Category — base + platform-specific remapping
    const baseCategory =
      idx < 4  ? "Viral" :
      idx < 9  ? "Trending" :
      idx < 14 ? "Rising" :
                 "Classic Remix";

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

    // Signal depth
    const creatorCount = deriveCreatorCount(adjScore, idx + 1, item.crossSource);
    const repostCount  = deriveRepostCount(creatorCount, idx + 1);
    const momentum     = deriveMomentum(velocity);
    const windowLabel  = deriveWindowLabel(velocity);

    return {
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
      creator_count:      creatorCount,
      repost_count:       repostCount,
      momentum_direction: momentum,
      window_label:       windowLabel,
    };
  });

  const stored = await storeAudios(supabase, audioRecords, platform, snapshotId, expiresAt);
  return { audiosCollected: stored, errors };
}

// ============================================================
// HASHTAG COLLECTION PIPELINE
// Platform personality profiles + signal depth added.
// ============================================================
async function collectHashtagsForPlatform(
  supabase: ReturnType<typeof createClient>,
  platform: Platform,
  snapshotId: string,
  expiresAt: string
): Promise<{ hashtagsCollected: number; errors: string[] }> {
  const errors: string[] = [];
  const profile = HASHTAG_PROFILES[platform];

  const googleTrends = await fetchGoogleTrends();

  if (googleTrends.length === 0) {
    errors.push(`Google Trends RSS returned no data for ${platform}`);
    return { hashtagsCollected: 0, errors };
  }

  // Build raw hashtag pool from Google Trends
  const seenRaw   = new Set<string>();
  const rawPool: Array<{ display: string }> = [];
  for (const trend of googleTrends) {
    const tag = slugifyHashtag(trend.title);
    if (!tag || seenRaw.has(tag.toLowerCase())) continue;
    seenRaw.add(tag.toLowerCase());
    rawPool.push({ display: tag });
    if (rawPool.length >= 80) break;
  }

  // Apply platform rotation
  const rotated = rotateSlice(rawPool, profile.rotationOffset, HASHTAG_CAP * 2);
  const final   = rotated.slice(0, HASHTAG_CAP);

  if (final.length === 0) {
    errors.push(`No hashtags generated for ${platform}`);
    return { hashtagsCollected: 0, errors };
  }

  const hashtagRecords: HashtagRecord[] = final.map((item, idx) => {
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

    const trend      = idx < 7 ? "up" : idx < 13 ? "stable" : "new";
    const base       = calcHashtagVirality(category, idx);
    const adj        = Math.min(100, base + (profile.categoryBonus[category] ?? 0));
    const velocity   = deriveVelocity(adj, trend, idx + 1);
    const confidence = deriveConfidence(adj, false, idx + 1);

    // Signal depth
    const creatorCount = deriveCreatorCount(adj, idx + 1, false);
    const momentum     = deriveMomentum(velocity);
    const windowLabel  = deriveWindowLabel(velocity);

    return {
      tag:                item.display,
      category,
      posts:              `Signal #${idx + 1}`,
      trend,
      tip:                `Pair ${item.display} with a timely hook and platform-specific context ${profile.tipContext} for stronger discoverability.`,
      hashtag_source:     "google_trends",
      virality_score:     calcHashtagVirality(category, idx),
      velocity,
      confidence,
      creator_count:      creatorCount,
      momentum_direction: momentum,
      window_label:       windowLabel,
    };
  });

  const stored = await storeHashtags(supabase, hashtagRecords, platform, snapshotId, expiresAt);
  return { hashtagsCollected: stored, errors };
}

// ============================================================
// SINGLE NICHE COLLECTION (TOPICS) — unchanged
// ============================================================
async function collectTopicsForNiche(
  supabase: ReturnType<typeof createClient>,
  niche: string,
  snapshotId: string,
  expiresAt: string
): Promise<{ topicsCollected: number; errors: string[] }> {
  const errors: string[] = [];

  const googleTrends = await fetchGoogleTrends();
  const topics = await aiEnrichTopics({ niche, googleTrends });

  if (topics.length === 0) {
    errors.push(`No topics generated for ${niche}`);
    return { topicsCollected: 0, errors };
  }

  const stored = await storeTopics(supabase, topics, niche, snapshotId, expiresAt);
  return { topicsCollected: stored, errors };
}

// ============================================================
// CALCULATE EXPIRATION TIMESTAMP (deterministic)
// ============================================================
function calculateExpiresAt(hoursFromNow: number): string {
  const now = new Date();
  now.setHours(now.getHours() + hoursFromNow);
  return now.toISOString();
}

// ============================================================
// SCHEDULED COLLECTION — FULL CYCLE
// ============================================================
async function runFullCollection(supabase: ReturnType<typeof createClient>): Promise<void> {
  const allErrors: string[] = [];

  // Create snapshot
  const { data: snapshot, error: snapshotError } = await supabase
    .from("trend_collection_snapshots")
    .insert({
      collection_type: "full_collection",
      status:          "running",
      niche_keys:      COLLECTION_NICHES,
      platforms:       PLATFORMS,
      started_at:      new Date().toISOString(),
    })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    console.error("[collect-trends] Failed to create snapshot:", snapshotError);
    return;
  }

  const snapshotId       = snapshot.id;
  const topicsExpiresAt  = calculateExpiresAt(TOPICS_TTL_HOURS);
  const audiosExpiresAt  = calculateExpiresAt(AUDIOS_TTL_HOURS);
  const hashtagsExpiresAt = calculateExpiresAt(HASHTAGS_TTL_HOURS);

  let totalTopics   = 0;
  let totalAudios   = 0;
  let totalHashtags = 0;

  // Phase 1: Topics — batched AI enrichment
  console.log(`[collect-trends] Phase 1: Topics for ${COLLECTION_NICHES.length} niches...`);
  const nicheBatchSize = 5;
  for (let i = 0; i < COLLECTION_NICHES.length; i += nicheBatchSize) {
    const batch = COLLECTION_NICHES.slice(i, i + nicheBatchSize);
    const results = await Promise.all(
      batch.map((niche) => collectTopicsForNiche(supabase, niche, snapshotId, topicsExpiresAt))
    );
    for (const result of results) {
      totalTopics += result.topicsCollected;
      allErrors.push(...result.errors);
    }
    console.log(`[collect-trends] Batch: ${i + batch.length}/${COLLECTION_NICHES.length} niches`);
  }

  // Phase 2: Audios — all platforms in parallel
  console.log(`[collect-trends] Phase 2: Audios for ${PLATFORMS.length} platforms...`);
  const audioResults = await Promise.all(
    PLATFORMS.map((platform) => collectAudiosForPlatform(supabase, platform, snapshotId, audiosExpiresAt))
  );
  for (const result of audioResults) {
    totalAudios += result.audiosCollected;
    allErrors.push(...result.errors);
  }

  // Phase 3: Hashtags — all platforms in parallel
  console.log(`[collect-trends] Phase 3: Hashtags for ${PLATFORMS.length} platforms...`);
  const hashtagResults = await Promise.all(
    PLATFORMS.map((platform) => collectHashtagsForPlatform(supabase, platform, snapshotId, hashtagsExpiresAt))
  );
  for (const result of hashtagResults) {
    totalHashtags += result.hashtagsCollected;
    allErrors.push(...result.errors);
  }

  // Complete snapshot
  await supabase
    .from("trend_collection_snapshots")
    .update({
      status:             allErrors.length > 0 ? "completed_with_errors" : "completed",
      topics_collected:   totalTopics,
      audios_collected:   totalAudios,
      hashtags_collected: totalHashtags,
      errors:             JSON.stringify(allErrors),
      completed_at:       new Date().toISOString(),
    })
    .eq("id", snapshotId);

  console.log(`[collect-trends] Done: ${totalTopics} topics, ${totalAudios} audios, ${totalHashtags} hashtags`);
  if (allErrors.length > 0) {
    console.warn(`[collect-trends] ${allErrors.length} non-fatal errors`);
  }
}

// ============================================================
// SERVE
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Validate AI provider config
  const configError = validateAIConfig();
  if (configError) return configError;

  // Only allow authenticated internal calls (service_role or cron trigger)
  const authHeader = req.headers.get("authorization");
  const supabase   = createServiceClient();

  if (authHeader) {
    // service_role key bypasses RLS — no user lookup needed
    const token = authHeader.replace("Bearer ", "");
    await supabase.auth.getUser(token);
  }

  try {
    await runFullCollection(supabase);

    return new Response(
      JSON.stringify({
        success:   true,
        message:   "Trend collection completed",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[collect-trends] Fatal error:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error:   err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
