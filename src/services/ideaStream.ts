// ============================================================
// ROBINOS IDEA STREAM — FRONTEND SERVICE ADAPTER
// ============================================================
// THIS IS THE ONLY FILE IN ROBINOS THAT CALLS IDEA STREAM APIS.
//
// Architecture contract:
//   UI components → this adapter → Supabase edge functions
//                                → Idea Stream service → cached data
//
// RobinOS never knows:
//   - how trends are scored
//   - which sources are fetched (Apple, Deezer, Google Trends, etc.)
//   - how the cache works
//   - how the refresh pipeline runs
//   - the Trend Engine database structure
//
// To swap the entire intelligence backend:
//   1. Deploy a new service
//   2. Update IDEA_STREAM_BASE_URL + IDEA_STREAM_API_KEY secrets
//   3. This file needs no changes
//   4. All callers need no changes
// ============================================================

import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────

export type Platform     = "TikTok" | "Instagram" | "Facebook" | "YouTube";
export type VelocityTier = "exploding" | "hot" | "rising" | "stable";
export type MomentumDir  = "up" | "stable" | "down";
export type TrendDir     = "up" | "stable" | "new";

export interface TrendAudio {
  title:              string;
  artist:             string;
  image_url?:         string | null;
  category:           string;
  uses:               string;
  trend:              TrendDir;
  tip:                string;
  velocity?:          VelocityTier;
  confidence?:        number;
  creator_count?:     number;
  repost_count?:      number;
  momentum?:          MomentumDir;
  momentum_direction?: MomentumDir; // DB alias — both names accepted
  window_label?:      string;
}

export interface TrendHashtag {
  tag:                string;
  category:           string;
  posts:              string;
  trend:              TrendDir;
  tip:                string;
  velocity?:          VelocityTier;
  confidence?:        number;
  creator_count?:     number;
  momentum?:          MomentumDir;
  momentum_direction?: MomentumDir;
  window_label?:      string;
}

export interface TrendTopic {
  title:       string;
  description: string;
  platforms:   string;
  heat:        number;
  hook_types?: string[];
  volume?:     string;
}

export interface IdeaStreamUsage {
  used:       number;
  quota:      number;
  unlimited:  boolean;
  fair_usage: boolean;
  remaining?: number;
  reset_at?:  string;
}

// ── Result types ───────────────────────────────────────────

export interface AudioResult {
  ok:      true;
  audios:  TrendAudio[];
  usage?:  IdeaStreamUsage;
  cached:  boolean;
}

export interface HashtagResult {
  ok:       true;
  hashtags: TrendHashtag[];
  usage?:   IdeaStreamUsage;
  cached:   boolean;
}

export interface TopicsResult {
  ok:     true;
  topics: TrendTopic[];
  cached: boolean;
  niche:  string;
}

export interface IdeaStreamError {
  ok:      false;
  code:    string;
  message: string;
  status:  number;
}

export type GetAudioResult   = AudioResult   | IdeaStreamError;
export type GetHashtagResult = HashtagResult | IdeaStreamError;
export type GetTopicsResult  = TopicsResult  | IdeaStreamError;

// ── Internal helpers ───────────────────────────────────────

/** Parse entitlement or network error from a failed edge function call */
function parseEdgeError(error: unknown): IdeaStreamError {
  const rawStatus = (error as any)?.context?.status ?? (error as any)?.status ?? 500;
  let code    = "IDEA_STREAM_ERROR";
  let message = "Idea Stream request failed.";

  try {
    const raw = (error as any)?.context?.responseText ?? (error as any)?.message ?? "";
    const parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
    code    = String(parsed.code    ?? code);
    message = String(parsed.message ?? message);
  } catch { /* keep defaults */ }

  return { ok: false, code, message, status: rawStatus };
}

/** Is this an entitlement/quota error that should show the upgrade dialog? */
export function isEntitlementError(err: IdeaStreamError): boolean {
  return (
    err.status === 403 ||
    err.code === "USAGE_LIMIT_EXCEEDED" ||
    err.code === "FEATURE_DISABLED"
  );
}

// ── Core API functions ─────────────────────────────────────

/**
 * Fetch trending audio for a platform.
 *
 * Delegates to the `trending-audio` Supabase edge function, which:
 *   1. Checks entitlement + increments usage counter
 *   2. Calls the Idea Stream service (IDEA_STREAM_BASE_URL)
 *   3. Returns cached trend data with signal depth
 *
 * RobinOS knows nothing about source providers or scoring internals.
 */
export async function getTrendingAudio(platform: Platform): Promise<GetAudioResult> {
  console.debug("[ideaStream] getTrendingAudio", { platform, ts: Date.now() });

  const { data, error } = await supabase.functions.invoke("trending-audio", {
    body: { platform, type: "audio" },
  });

  if (error) {
    const err = parseEdgeError(error);
    console.warn("[ideaStream] getTrendingAudio failed", { platform, code: err.code, status: err.status });
    return err;
  }

  const audios = (data?.audios ?? []) as TrendAudio[];
  console.debug("[ideaStream] getTrendingAudio ok", { platform, count: audios.length, cached: data?.cached });

  return {
    ok:     true,
    audios,
    usage:  data?.usage ?? undefined,
    cached: data?.cached ?? true,
  };
}

/**
 * Fetch trending hashtags for a platform.
 *
 * Same proxy chain as getTrendingAudio — entitlement checked server-side.
 */
export async function getTrendingHashtags(platform: Platform): Promise<GetHashtagResult> {
  console.debug("[ideaStream] getTrendingHashtags", { platform, ts: Date.now() });

  const { data, error } = await supabase.functions.invoke("trending-audio", {
    body: { platform, type: "hashtags" },
  });

  if (error) {
    const err = parseEdgeError(error);
    console.warn("[ideaStream] getTrendingHashtags failed", { platform, code: err.code, status: err.status });
    return err;
  }

  const hashtags = (data?.hashtags ?? []) as TrendHashtag[];
  console.debug("[ideaStream] getTrendingHashtags ok", { platform, count: hashtags.length, cached: data?.cached });

  return {
    ok:       true,
    hashtags,
    usage:    data?.usage ?? undefined,
    cached:   data?.cached ?? true,
  };
}

/**
 * Scan a niche for AI-enriched trending topics (Trend Radar feature).
 *
 * Delegates to the `scan-trends` Supabase edge function, which:
 *   1. Checks entitlement + increments usage counter
 *   2. Checks topic cache (4h TTL)
 *   3. On cache miss: calls AI provider → stores result → returns
 *
 * RobinOS knows nothing about which AI provider is used or how topics
 * are classified.
 */
export async function scanNicheTrends(niche: string): Promise<GetTopicsResult> {
  const nicheKey = niche.trim().toLowerCase().replace(/\s+/g, "_");
  console.debug("[ideaStream] scanNicheTrends", { niche: nicheKey, ts: Date.now() });

  const { data, error } = await supabase.functions.invoke("scan-trends", {
    body: { niche },
  });

  if (error) {
    const err = parseEdgeError(error);
    console.warn("[ideaStream] scanNicheTrends failed", { niche: nicheKey, code: err.code, status: err.status });
    return err;
  }

  const topics = (data?.topics ?? []) as TrendTopic[];
  console.debug("[ideaStream] scanNicheTrends ok", { niche: nicheKey, count: topics.length, cached: data?.cached });

  return {
    ok:     true,
    topics,
    cached: data?.cached ?? false,
    niche:  data?.niche  ?? nicheKey,
  };
}
