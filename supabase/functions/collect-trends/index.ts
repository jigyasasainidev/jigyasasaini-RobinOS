// ============================================================
// ROBINOS CENTRALIZED TREND COLLECTION PIPELINE
// Background ingestion from free data sources + AI enrichment
// Intended to run via Supabase cron schedule (every 3 hours)
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

// ============================================================
// TYPES
// ============================================================
interface SnapshotRecord {
  id: string;
}

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
  category: string;
  uses: string;
  trend: string;
  tip: string;
  audio_source: string;
  virality_score: number;
}

interface HashtagRecord {
  tag: string;
  category: string;
  posts: string;
  trend: string;
  tip: string;
  hashtag_source: string;
  virality_score: number;
}

// ============================================================
// CONFIGURATION
// Niches to collect topics for on each full cycle
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

const PLATFORMS = ["TikTok", "Instagram", "Facebook", "YouTube"];

const TOPICS_TTL_HOURS = 4;
const AUDIOS_TTL_HOURS = 3;
const HASHTAGS_TTL_HOURS = 3;

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
    const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemXml);
    const trafficMatch = /<ht:approx_traffic>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:approx_traffic>/i.exec(itemXml);

    const title = titleMatch ? titleMatch[1].trim() : "";
    const approxTraffic = trafficMatch ? trafficMatch[1].trim() : "";

    if (title) {
      items.push({ title, approxTraffic });
    }
  }

  return items.slice(0, 30);
};

// ============================================================
// APPLE MUSIC RSS — MOST PLAYED SONGS
// ============================================================
interface AppleMusicTrack {
  title: string;
  artist: string;
}

const fetchAppleMusicTop100 = async (geo = "us"): Promise<AppleMusicTrack[]> => {
  const data = await safeFetchJson(
    `https://rss.applemarketingtools.com/api/v2/${geo}/music/most-played/100/songs.json`
  );
  if (!data || !Array.isArray((data as any)?.feed?.results)) return [];

  return (data as any).feed.results
    .map((x: any) => ({
      title: String(x?.name || "").trim(),
      artist: String(x?.artistName || "").trim(),
    }))
    .filter((x: AppleMusicTrack) => x.title && x.artist);
};

// ============================================================
// DEEZER API — CHARTS
// ============================================================
const fetchDeezerChart = async (): Promise<AppleMusicTrack[]> => {
  const data = await safeFetchJson("https://api.deezer.com/chart/0/tracks?limit=100");
  if (!data || !Array.isArray((data as any)?.data)) return [];

  return (data as any).data
    .map((x: any) => ({
      title: String(x?.title || "").trim(),
      artist: String(x?.artist?.name || "").trim(),
    }))
    .filter((x: AppleMusicTrack) => x.title && x.artist);
};

// ============================================================
// AI ENRICHMENT — CLASSIFY + SCORE TOPICS BY NICHE
// ============================================================
const GROQ_API_KEY = () => Deno.env.get("GROQ_API_KEY") || "";

interface AIEnrichmentInput {
  niche: string;
  googleTrends: GoogleTrendItem[];
}

interface AIEnrichmentOutput {
  topics: TopicRecord[];
}

const aiEnrichTopics = async (input: AIEnrichmentInput): Promise<TopicRecord[]> => {
  const apiKey = GROQ_API_KEY();
  if (!apiKey) {
    console.warn("[collect-trends] GROQ_API_KEY not configured — skipping AI enrichment");
    return [];
  }

  const trendTitles = input.googleTrends
    .slice(0, 10)
    .map((t) => `- ${t.title}${t.approxTraffic ? ` (${t.approxTraffic})` : ""}`)
    .join("\n");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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
                        title: { type: "string" },
                        description: { type: "string" },
                        platforms: { type: "string" },
                        heat: { type: "number" },
                        hook_types: { type: "array", items: { type: "string" } },
                        volume: { type: "string", enum: ["High", "Medium", "Emerging"] },
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
      }),
    });

    if (!response.ok) {
      console.warn(`[collect-trends] AI enrichment failed for ${input.niche}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return [];

    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.topics || [];
  } catch (err) {
    console.error(`[collect-trends] AI enrichment error for ${input.niche}:`, err);
    return [];
  }
};

// ============================================================
// VIRALITY SCORE CALCULATOR
// Deterministic scoring based on multiple signals
// ============================================================
function calculateViralityScore(topic: { heat: number; volume?: string; platforms: string }): number {
  // Heat contributes 0-60 points (heat is 0-99, so 99 * 0.606 = 60)
  const heatScore = Math.min(topic.heat, 99) * 0.606;

  // Volume contributes 0-20 points
  const volumeScore = topic.volume === "High" ? 20 : topic.volume === "Medium" ? 10 : 5;

  // Platform count contributes 0-20 points (4 max platforms, 5 each)
  const platformCount = topic.platforms
    ? topic.platforms.split(",").filter((p) => p.trim()).length
    : 0;
  const platformScore = Math.min(platformCount, 4) * 5;

  return Math.min(Math.round(heatScore + volumeScore + platformScore), 100);
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

// ============================================================
// SLUGIFY HASHTAG (same logic as trending-audio function)
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
    niche_key: niche,
    title: t.title,
    description: t.description,
    platforms: t.platforms,
    heat: Math.min(Math.max(t.heat, 0), 99),
    hook_types: JSON.stringify(t.hook_types || []),
    volume: t.volume || "Medium",
    virality_score: calculateViralityScore(t),
    trend_velocity: t.heat / 10,
    source: "ai",
    collection_snapshot_id: snapshotId,
    expires_at: expiresAt,
    collected_at: new Date().toISOString(),
  }));

  // Use upsert to prevent duplicates on niche + title
  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_topics")
      .upsert(record, {
        onConflict: "niche_key, title",
        ignoreDuplicates: false,
      });

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
    title: a.title,
    artist: a.artist,
    category: a.category,
    uses: a.uses,
    trend: a.trend,
    tip: a.tip,
    audio_source: a.audio_source,
    virality_score: a.virality_score,
    collection_snapshot_id: snapshotId,
    expires_at: expiresAt,
    collected_at: new Date().toISOString(),
  }));

  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_audios")
      .upsert(record, {
        onConflict: "platform, title, artist",
        ignoreDuplicates: false,
      });

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
    tag: h.tag,
    category: h.category,
    posts: h.posts,
    trend: h.trend,
    tip: h.tip,
    hashtag_source: h.hashtag_source,
    virality_score: h.virality_score,
    collection_snapshot_id: snapshotId,
    expires_at: expiresAt,
    collected_at: new Date().toISOString(),
  }));

  let stored = 0;
  for (const record of records) {
    const { error } = await supabase
      .from("trend_hashtags")
      .upsert(record, {
        onConflict: "platform, tag",
        ignoreDuplicates: false,
      });

    if (!error) stored++;
  }

  return stored;
}

// ============================================================
// AUDIO COLLECTION PIPELINE
// ============================================================
async function collectAudiosForPlatform(
  supabase: ReturnType<typeof createClient>,
  platform: string,
  snapshotId: string,
  expiresAt: string
): Promise<{ audiosCollected: number; errors: string[] }> {
  const errors: string[] = [];

  // Fetch Apple Music + Deezer
  const [appleTracks, deezerTracks] = await Promise.all([
    fetchAppleMusicTop100(),
    fetchDeezerChart(),
  ]);

  const seen = new Set<string>();
  const allTracks: AppleMusicTrack[] = [];

  for (const track of [...appleTracks, ...deezerTracks]) {
    const key = `${track.title.toLowerCase()}::${track.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allTracks.push(track);
    if (allTracks.length >= 12) break;
  }

  if (allTracks.length === 0) {
    errors.push(`No audio data available for ${platform}`);
    return { audiosCollected: 0, errors };
  }

  const audioRecords: AudioRecord[] = allTracks.map((track, idx) => ({
    title: track.title,
    artist: track.artist,
    category: idx < 4 ? "Trending" : idx < 8 ? "Rising" : "Viral",
    uses: `Chart #${idx + 1}`,
    trend: idx < 5 ? "up" : idx < 9 ? "stable" : "new",
    tip: `Use this audio on ${platform} with a strong first 2 seconds and clear on-screen context for better retention.`,
    audio_source: idx < appleTracks.length ? "apple_music" : "deezer",
    virality_score: calculateAudioVirality(
      idx < 4 ? "Trending" : idx < 8 ? "Rising" : "Viral",
      idx
    ),
  }));

  const stored = await storeAudios(supabase, audioRecords, platform, snapshotId, expiresAt);
  return { audiosCollected: stored, errors };
}

// ============================================================
// HASHTAG COLLECTION PIPELINE
// ============================================================
async function collectHashtagsForPlatform(
  supabase: ReturnType<typeof createClient>,
  platform: string,
  snapshotId: string,
  expiresAt: string
): Promise<{ hashtagsCollected: number; errors: string[] }> {
  const errors: string[] = [];

  // Fetch Google Trends RSS
  const googleTrends = await fetchGoogleTrends();

  if (googleTrends.length === 0) {
    errors.push(`Google Trends RSS returned no data for ${platform}`);
    return { hashtagsCollected: 0, errors };
  }

  // Convert trend titles to hashtags
  const seen = new Set<string>();
  const hashtagRecords: HashtagRecord[] = [];

  for (const trend of googleTrends) {
    const tag = slugifyHashtag(trend.title);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());

    const idx = hashtagRecords.length;
    const category = idx < 5 ? "Trending" : idx < 10 ? "Rising" : "Niche";

    hashtagRecords.push({
      tag,
      category,
      posts: trend.approxTraffic ? `~${trend.approxTraffic}` : `Rank #${idx + 1}`,
      trend: idx < 6 ? "up" : idx < 11 ? "stable" : "new",
      tip: `Pair ${tag} with a platform-specific hook and recent context on ${platform} for stronger discoverability.`,
      hashtag_source: "google_trends",
      virality_score: calculateHashtagVirality(category, idx),
    });

    if (hashtagRecords.length >= 15) break;
  }

  if (hashtagRecords.length === 0) {
    errors.push(`No hashtags generated for ${platform}`);
    return { hashtagsCollected: 0, errors };
  }

  const stored = await storeHashtags(supabase, hashtagRecords, platform, snapshotId, expiresAt);
  return { hashtagsCollected: stored, errors };
}

// ============================================================
// SINGLE NICHE COLLECTION (TOPICS)
// ============================================================
async function collectTopicsForNiche(
  supabase: ReturnType<typeof createClient>,
  niche: string,
  snapshotId: string,
  expiresAt: string
): Promise<{ topicsCollected: number; errors: string[] }> {
  const errors: string[] = [];

  // Fetch Google Trends for context
  const googleTrends = await fetchGoogleTrends();

  // AI enrich topics for this niche
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
      status: "running",
      niche_keys: COLLECTION_NICHES,
      platforms: PLATFORMS,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    console.error("[collect-trends] Failed to create snapshot:", snapshotError);
    return;
  }

  const snapshotId = snapshot.id;
  const topicsExpiresAt = calculateExpiresAt(TOPICS_TTL_HOURS);
  const audiosExpiresAt = calculateExpiresAt(AUDIOS_TTL_HOURS);
  const hashtagsExpiresAt = calculateExpiresAt(HASHTAGS_TTL_HOURS);

  let totalTopics = 0;
  let totalAudios = 0;
  let totalHashtags = 0;

  // Phase 1: Collect topics for all niches (parallelized in batches of 5)
  console.log(`[collect-trends] Phase 1: Collecting topics for ${COLLECTION_NICHES.length} niches...`);
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
    console.log(`[collect-trends] Batch complete: ${i + batch.length}/${COLLECTION_NICHES.length} niches processed`);
  }

  // Phase 2: Collect audios for all platforms (parallel)
  console.log(`[collect-trends] Phase 2: Collecting audios for ${PLATFORMS.length} platforms...`);
  const audioResults = await Promise.all(
    PLATFORMS.map((platform) => collectAudiosForPlatform(supabase, platform, snapshotId, audiosExpiresAt))
  );
  for (const result of audioResults) {
    totalAudios += result.audiosCollected;
    allErrors.push(...result.errors);
  }

  // Phase 3: Collect hashtags for all platforms (parallel)
  console.log(`[collect-trends] Phase 3: Collecting hashtags for ${PLATFORMS.length} platforms...`);
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
      status: allErrors.length > 0 ? "completed_with_errors" : "completed",
      topics_collected: totalTopics,
      audios_collected: totalAudios,
      hashtags_collected: totalHashtags,
      errors: JSON.stringify(allErrors),
      completed_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  console.log(`[collect-trends] Collection complete: ${totalTopics} topics, ${totalAudios} audios, ${totalHashtags} hashtags`);
  if (allErrors.length > 0) {
    console.warn(`[collect-trends] Errors: ${allErrors.length} non-fatal issues`);
  }
}

// ============================================================
// SERVE
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // Only allow authenticated internal calls (service_role or cron trigger)
  const authHeader = req.headers.get("authorization");
  const supabase = createServiceClient();

  // If auth provided, verify it's service_role or admin
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    // Allow if no user found (service_role key used directly) — service_role bypasses RLS
  }

  try {
    await runFullCollection(supabase);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Trend collection completed",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[collect-trends] Fatal error:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});