// ============================================================
// TREND RADAR — Hardened Fetch with Timeout + Retry
// ============================================================

const DEFAULT_TIMEOUT_MS = 7_000;
const MAX_RETRIES        = 2;
const BASE_BACKOFF_MS    = 400;

export interface FetchResult<T> {
  ok: true;
  data: T;
} | {
  ok: false;
  reason: "timeout" | "network" | "non_json" | "non_ok" | "parse_error";
  status?: number;
  message: string;
};

/** Fetch JSON with timeout + retry on transient failures */
export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl    = new AbortController();
    const timer   = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);

      if (!res.ok) {
        // Don't retry 4xx (client errors) — only 5xx / network
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, reason: "non_ok", status: res.status, message: `HTTP ${res.status}` };
        }
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        return { ok: false, reason: "non_ok", status: res.status, message: `HTTP ${res.status} after ${attempt + 1} attempts` };
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json") && !ct.includes("text/javascript") && !ct.includes("application/javascript")) {
        // For XML/RSS sources, fetch as text instead
        const text = await res.text();
        return { ok: true, data: text as unknown as T };
      }

      try {
        const data = await res.json() as T;
        return { ok: true, data };
      } catch {
        return { ok: false, reason: "parse_error", message: "JSON parse failed" };
      }

    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        return { ok: false, reason: "timeout", message: `Timed out after ${timeoutMs}ms` };
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "network", message: msg };
    }
  }

  return { ok: false, reason: "network", message: "Max retries exceeded" };
}

/** Fetch XML/RSS text (plain text, no JSON parse) */
export async function fetchText(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult<string>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (TrendRadar/1.0)" } });
      clearTimeout(timer);
      if (!res.ok) {
        if (attempt < MAX_RETRIES) { await sleep(BASE_BACKOFF_MS * 2 ** attempt); continue; }
        return { ok: false, reason: "non_ok", status: res.status, message: `HTTP ${res.status}` };
      }
      const text = await res.text();
      return { ok: true, data: text };
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_RETRIES) { await sleep(BASE_BACKOFF_MS * 2 ** attempt); continue; }
      return { ok: false, reason: isAbort ? "timeout" : "network", message: String(err) };
    }
  }
  return { ok: false, reason: "network", message: "Max retries exceeded" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
