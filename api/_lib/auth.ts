// ============================================================
// TREND RADAR — API Key Auth + In-Memory Rate Limiter
// ============================================================
// Auth: x-api-key header OR Authorization: Bearer <key>
// Rate limit: 20 requests / 60 seconds per (IP + key fingerprint)
// ============================================================

import type { IncomingMessage } from "http";

const RATE_LIMIT_MAX     = 20;
const RATE_LIMIT_WINDOW  = 60_000; // 60 seconds

// In-memory rate limit store — resets on cold start
// Good enough for serverless with Vercel Edge isolation
const store = new Map<string, { count: number; windowStart: number }>();

function getApiKey(req: IncomingMessage): string | null {
  // Check x-api-key header
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();

  // Check Authorization: Bearer <key>
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  return null;
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (req.socket?.remoteAddress) || "unknown";
}

/** Returns null on success, or seconds until window resets on rate-limit */
function checkRateLimit(fingerprint: string): number | null {
  const now  = Date.now();
  const slot = store.get(fingerprint);

  if (!slot || now - slot.windowStart >= RATE_LIMIT_WINDOW) {
    store.set(fingerprint, { count: 1, windowStart: now });
    return null;
  }

  if (slot.count >= RATE_LIMIT_MAX) {
    const secondsLeft = Math.ceil((RATE_LIMIT_WINDOW - (now - slot.windowStart)) / 1000);
    return secondsLeft;
  }

  slot.count++;
  return null;
}

export interface AuthResult {
  ok: true;
} | {
  ok: false;
  code: "unauthorized" | "rate_limited";
  retryAfterSeconds?: number;
};

export function authenticate(req: IncomingMessage): { ok: true } | { ok: false; code: "unauthorized" | "rate_limited"; retryAfterSeconds?: number } {
  const expectedKey = process.env.TREND_RADAR_API_KEY;
  if (!expectedKey) {
    // Misconfigured server — treat as unavailable rather than open
    return { ok: false, code: "unauthorized" };
  }

  const providedKey = getApiKey(req);
  if (!providedKey || providedKey !== expectedKey) {
    return { ok: false, code: "unauthorized" };
  }

  const ip          = getClientIp(req);
  // Key fingerprint: first 8 chars (not the full key — avoids leaking it in logs)
  const keySnippet  = providedKey.slice(0, 8);
  const fingerprint = `${ip}::${keySnippet}`;

  const retryAfter = checkRateLimit(fingerprint);
  if (retryAfter !== null) {
    return { ok: false, code: "rate_limited", retryAfterSeconds: retryAfter };
  }

  return { ok: true };
}
