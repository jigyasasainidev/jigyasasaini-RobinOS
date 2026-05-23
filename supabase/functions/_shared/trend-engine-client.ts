// ============================================================
// ROBINOS → IDEA STREAM SERVICE CLIENT
// ============================================================
// This is the ONLY file in RobinOS edge functions that knows
// the Idea Stream service URL or API key.
//
// Architecture contract:
//   RobinOS edge fn → this client → Idea Stream HTTP API → its own DB
//
// Environment variables required in Supabase project secrets:
//   IDEA_STREAM_BASE_URL   — base URL of the Idea Stream service
//   IDEA_STREAM_API_KEY    — shared internal secret (x-idea-stream-key header)
//
// To swap the entire intelligence backend:
//   1. Deploy a new service at a new URL
//   2. Update IDEA_STREAM_BASE_URL + IDEA_STREAM_API_KEY secrets
//   3. This file needs no changes
//   4. All callers (trending-audio, collect-trends) need no changes
// ============================================================

export type Platform      = "TikTok" | "Instagram" | "Facebook" | "YouTube";
export type TrendType     = "audio" | "hashtags";
export type VelocityTier  = "exploding" | "hot" | "rising" | "stable";
export type MomentumDir   = "up" | "stable" | "down";

// ── Canonical response types — mirrors Idea Stream schema v2 ─

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

export interface IdeaStreamResult {
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

export interface IdeaStreamFailure {
  ok:      false;
  code:    string;
  message: string;
  status:  number;
}

export type FetchTrendsResult = IdeaStreamResult | IdeaStreamFailure;

// ── Internal constants ─────────────────────────────────────

const TIMEOUT_MS = 12_000; // 12s — cache-hit response should be <500ms
const AUTH_HEADER = "x-idea-stream-key";

// ── Main fetch function ────────────────────────────────────

/**
 * Fetches trends from the isolated Idea Stream service.
 *
 * Required Supabase project secrets:
 *   IDEA_STREAM_BASE_URL   — e.g. https://your-service.railway.app
 *   IDEA_STREAM_API_KEY    — shared internal secret
 */
export async function fetchTrends(
  platform: Platform,
  type: TrendType,
): Promise<FetchTrendsResult> {
  const baseUrl = Deno.env.get("IDEA_STREAM_BASE_URL");
  const apiKey  = Deno.env.get("IDEA_STREAM_API_KEY");

  if (!baseUrl || !apiKey) {
    console.warn("[idea-stream-client] IDEA_STREAM_BASE_URL or IDEA_STREAM_API_KEY not set — falling back to direct cache");
    return {
      ok:      false,
      code:    "IDEA_STREAM_NOT_CONFIGURED",
      message: "Idea Stream service is not configured.",
      status:  503,
    };
  }

  const url = new URL("/trends", baseUrl.replace(/\/$/, ""));
  url.searchParams.set("platform", platform);
  url.searchParams.set("type",     type);

  console.log("[idea-stream-client] fetching", {
    url:      url.toString(),
    platform,
    type,
    has_key:  !!apiKey,
    base_url: baseUrl,
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method:  "GET",
      headers: {
        [AUTH_HEADER]: apiKey,
        "Accept":      "application/json",
      },
      signal: ctrl.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let code    = "IDEA_STREAM_ERROR";
      let message = `Idea Stream returned HTTP ${res.status}`;
      try {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = await res.json();
          code    = String(body.code    ?? code);
          message = String(body.message ?? message);
        } else {
          // Non-JSON (HTML error page, proxy error, etc.) — don't try to parse
          message = `Idea Stream returned HTTP ${res.status} (non-JSON response — check IDEA_STREAM_BASE_URL)`;
        }
      } catch { /* ignore parse failure */ }

      console.warn("[idea-stream-client] HTTP error", { platform, type, status: res.status, code });
      return { ok: false, code, message, status: res.status };
    }

    // Guard: reject HTML responses before attempting JSON parse
    // (happens when IDEA_STREAM_BASE_URL points at a frontend SPA)
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const preview = await res.text().then(t => t.slice(0, 120)).catch(() => "");
      console.error("[idea-stream-client] received non-JSON response", {
        platform, type,
        content_type: contentType,
        body_preview: preview,
        hint: "IDEA_STREAM_BASE_URL may be pointing at a frontend app, not the Idea Stream API service",
      });
      return {
        ok:      false,
        code:    "IDEA_STREAM_INVALID_RESPONSE",
        message: "Idea Stream returned a non-JSON response. Ensure IDEA_STREAM_BASE_URL points to the Idea Stream API service, not a frontend app.",
        status:  502,
      };
    }

    const data = await res.json() as IdeaStreamResult;

    // Schema version mismatch — warn but don't fail (forward-compatible)
    const version = data._meta?.schema_version;
    if (version && version !== "2.0") {
      console.warn(`[idea-stream-client] schema version mismatch: expected 2.0, got ${version}`);
    }

    console.log("[idea-stream-client] ok", { platform, type, count: data.count, cached: data.cached });

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
    const code    = isTimeout ? "IDEA_STREAM_TIMEOUT" : "IDEA_STREAM_FETCH_FAILED";
    const message = isTimeout
      ? `Idea Stream did not respond within ${TIMEOUT_MS / 1000}s`
      : (err instanceof Error ? err.message : "Unknown network error");

    console.warn("[idea-stream-client] fetch error", { platform, type, code, message });
    return { ok: false, code, message, status: 503 };
  }
}

/**
 * Triggers a cache refresh on the Idea Stream service.
 * Fire-and-forget safe — errors are logged, not thrown.
 */
export async function triggerRefresh(): Promise<boolean> {
  const baseUrl = Deno.env.get("IDEA_STREAM_BASE_URL");
  const apiKey  = Deno.env.get("IDEA_STREAM_API_KEY");
  if (!baseUrl || !apiKey) return false;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000); // refresh can take up to 60s
    const res   = await fetch(`${baseUrl.replace(/\/$/, "")}/refresh`, {
      method:  "POST",
      headers: { [AUTH_HEADER]: apiKey, "Content-Type": "application/json" },
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    console.log("[idea-stream-client] refresh triggered", { status: res.status });
    return res.ok;
  } catch (err) {
    console.warn("[idea-stream-client] refresh failed", { error: String(err) });
    return false;
  }
}

/**
 * Lightweight health ping — no auth required.
 * Use from monitoring or cron-safety checks.
 */
export async function pingIdeaStream(): Promise<boolean> {
  const baseUrl = Deno.env.get("IDEA_STREAM_BASE_URL");
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
