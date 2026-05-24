// ============================================================
// TREND RADAR — IP-only Rate Limiter
// No API key required — internal platform capability.
// ============================================================

import type { IncomingMessage } from "http";

const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WINDOW = 60_000;
const store             = new Map<string, { count: number; windowStart: number }>();

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (req.socket?.remoteAddress) || "unknown";
}

/** Returns null on success, or seconds until window resets on rate-limit */
export function checkRateLimit(ip: string): number | null {
  const now  = Date.now();
  const slot = store.get(ip);
  if (!slot || now - slot.windowStart >= RATE_LIMIT_WINDOW) {
    store.set(ip, { count: 1, windowStart: now });
    return null;
  }
  if (slot.count >= RATE_LIMIT_MAX) {
    return Math.ceil((RATE_LIMIT_WINDOW - (now - slot.windowStart)) / 1000);
  }
  slot.count++;
  return null;
}
