// ============================================================
// ROBINOS → TREND ENGINE CLIENT ADAPTER
// ============================================================
// This is the ONLY file in RobinOS that knows the Trend Engine
// URL or internal key. All other RobinOS code that needs trend
// data must call fetchTrends() from here — never fetch directly.
//
// Architecture contract:
//   RobinOS → this adapter → Trend Engine HTTP API → its own DB
//
// To swap the entire backend intelligence service:
//   1. Deploy a new service at a new URL
//   2. Update TREND_ENGINE_URL secret
//   3. This file needs no changes
//   4. All callers need no changes
// ============================================================

export type Platform      = "TikTok" | "Instagram" | "Facebook" | "YouTube";
export type TrendType     = "audio" | "hashtags";
export type VelocityTier  = "exploding" | "hot" | "rising" | "stable";
export type MomentumDir   = "up" | "stable" | "down";

// ── Canonical response types — mirrors Trend Engine schema v2 ─

export interface TrendAudio {
  title:              string;
  artist:             string;
  image_url:          string | null;
  category:           string;
  uses:               string;
  trend:              "up" | "stable" | "new";
  tip:                string;
  velocity:           VelocityTier;
  confidence:         number;
  creator_count:      number;
  repost_count:       number;
  momentum_direction: MomentumDir;
  window_label:       string;
}

export interface TrendHashtag {
  tag:                string;
  category:           string;
  posts:              string;
  trend:              "up" | "stable" | "new";
  tip:                string;
  velocity:           VelocityTier;
  confidence:         number;
  creator_count:      number;
  momentum_direction: MomentumDir;
  window_label:       string;
}

export interface TrendEngineResult {
  ok:           true;
  platform:     Platform;
  type:         TrendType;
  cached:       boolean;
  count:        number;
  refreshed_at: string | null;
  expires_at:   string | null;
  audios?:      TrendAudio[];
  hashtags?:    TrendHashtag[];
  _meta?: {
    schema_version: string;
    served_at:      string;
  };
}

export interface TrendEngineFailure {
  ok:      false;
  code:    string;
  message: string;
  status:  number;
}

export type TrendResult = TrendEngineResult | TrendEngineFailure;

// ── Internal constants ─────────────────────────────────────

const TIMEOUT_MS = 12_000; // 12s — Trend Engine should respond in <500ms on cache hit

// ── Main fetch function ────────────────────────────────────

/**
 * Fetches trends from the isolated Trend Engine service.
 *
 * Requires these Supabase secrets:
 *   TREND_ENGINE_URL              — base URL of the Trend Engine API
 *   TREND_ENGINE_INTERNAL_API_KEY — shared secret for server-to-server auth
 *
 * Returns a typed TrendResult. Callers must check result.ok before reading data.
 */
export async function fetchTrends(
  platform: Platform,
  type: TrendType,
): Promise<TrendResult> {
  const baseUrl = Deno.env.get("TREND_ENGINE_URL");
  const apiKey  = Deno.env.get("TREND_ENGINE_INTERNAL_API_KEY");

  if (!baseUrl || !apiKey) {
    return {
      ok:      false,
      code:    "TREND_ENGINE_NOT_CONFIGURED",
      message: "Trend Engine is not configured. Set TREND_ENGINE_URL and TREND_ENGINE_INTERNAL_API_KEY secrets.",
      status:  503,
    };
  }

  // Build URL — GET /trends?platform=X&type=Y
  const url = new URL("/trends", baseUrl.replace(/\/$/, ""));
  url.searchParams.set("platform", platform);
  url.searchParams.set("type",     type);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method:  "GET",
      headers: {
        "x-trend-engine-key": apiKey,
        "Accept":             "application/json",
      },
      signal: ctrl.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let code    = "TREND_ENGINE_ERROR";
      let message = `Trend Engine returned HTTP ${res.status}`;
      try {
        const body = await res.json();
        code    = String(body.code    ?? code);
        message = String(body.message ?? message);
      } catch { /* ignore parse failure */ }

      return { ok: false, code, message, status: res.status };
    }

    const data = await res.json() as TrendEngineResult;

    // Validate schema_version — warn on mismatch but don't fail
    const version = data._meta?.schema_version;
    if (version && version !== "2.0") {
      console.warn(`[trend-engine-client] schema version mismatch: expected 2.0, got ${version}`);
    }

    return {
      ok:           true,
      platform:     data.platform     ?? platform,
      type:         data.type         ?? type,
      cached:       data.cached       ?? true,
      count:        data.count        ?? (data.audios?.length ?? data.hashtags?.length ?? 0),
      refreshed_at: data.refreshed_at ?? null,
      expires_at:   data.expires_at   ?? null,
      audios:       data.audios,
      hashtags:     data.hashtags,
      _meta:        data._meta,
    };

  } catch (err) {
    clearTimeout(timer);

    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok:      false,
      code:    isTimeout ? "TREND_ENGINE_TIMEOUT" : "TREND_ENGINE_FETCH_FAILED",
      message: isTimeout
        ? `Trend Engine did not respond within ${TIMEOUT_MS / 1000}s`
        : (err instanceof Error ? err.message : "Unknown network error"),
      status: 503,
    };
  }
}

/**
 * Pings the Trend Engine health endpoint.
 * Returns true if the service is reachable and healthy.
 * Use this for monitoring/alerting — not in the request path.
 */
export async function pingTrendEngine(): Promise<boolean> {
  const baseUrl = Deno.env.get("TREND_ENGINE_URL");
  if (!baseUrl) return false;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res   = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
