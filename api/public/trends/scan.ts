// ============================================================
// TREND RADAR — /api/public/trends/scan
// Vercel serverless function (Node.js runtime)
//
// GET  (no topic)   → service metadata (public, no auth)
// GET  (?topic=...) → trend scan       (auth required)
// POST              → trend scan       (auth required)
//
// Auth: x-api-key header OR Authorization: Bearer <key>
// ============================================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticate }                        from "../../_lib/auth.js";
import { runScan }                             from "../../_lib/engine.js";
import { ScanRequestSchema, GET_METADATA }     from "../../_lib/schema.js";
import {
  errUnauthorized,
  errInvalidPayload,
  errRateLimited,
  errUnavailable,
  errMethodNotAllowed,
  statusForCode,
} from "../../_lib/errors.js";

// ── Security + CORS headers ────────────────────────────────
function setHeaders(res: VercelResponse): void {
  res.setHeader("Content-Type",                 "application/json");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("X-Frame-Options",              "DENY");
  res.setHeader("Cache-Control",                "no-store, no-cache");
  // Allow server-side consumption from any origin (no browser cookies involved)
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
  res.setHeader("X-Robots-Tag",                 "noindex");
}

// ── Unique request ID ──────────────────────────────────────
function makeRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `tr_${Date.now()}_${rand}`;
}

// ── Main handler ───────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setHeaders(res);

  // ── CORS preflight ─────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ── Reject unsupported methods ─────────────────────────
  if (req.method !== "GET" && req.method !== "POST") {
    const err = errMethodNotAllowed();
    res.status(statusForCode(err.error.code)).json(err);
    return;
  }

  // ── GET without topic → public metadata (no auth) ─────
  if (req.method === "GET") {
    const rawTopic = req.query.topic ?? req.query.query;
    const topicStr = typeof rawTopic === "string" ? rawTopic.trim() : "";

    if (!topicStr) {
      // No topic — return public service metadata
      res.status(200).json(GET_METADATA);
      return;
    }

    // GET with ?topic — auth required, run a full scan
    const auth = authenticate(req);
    if (!auth.ok) {
      if (auth.code === "rate_limited") {
        const err = errRateLimited(auth.retryAfterSeconds ?? 60);
        res
          .status(429)
          .setHeader("Retry-After", String(auth.retryAfterSeconds ?? 60))
          .json(err);
        return;
      }
      res.status(401).json(errUnauthorized());
      return;
    }

    const parsed = ScanRequestSchema.safeParse({ topic: topicStr });
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      res
        .status(400)
        .json(errInvalidPayload(first ? `${first.path.join(".")}: ${first.message}` : "Invalid topic"));
      return;
    }

    try {
      const result = await runScan(parsed.data, makeRequestId());
      res.status(200).json(result);
    } catch (err) {
      console.error("[trend-radar] GET scan error:", err instanceof Error ? err.message : err);
      res.status(503).json(errUnavailable());
    }
    return;
  }

  // ── POST — auth + body scan ────────────────────────────
  const auth = authenticate(req);
  if (!auth.ok) {
    if (auth.code === "rate_limited") {
      const err = errRateLimited(auth.retryAfterSeconds ?? 60);
      res
        .status(429)
        .setHeader("Retry-After", String(auth.retryAfterSeconds ?? 60))
        .json(err);
      return;
    }
    res.status(401).json(errUnauthorized());
    return;
  }

  // ── Content-Type guard for POST ────────────────────────
  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (!ct.includes("application/json")) {
    res.status(400).json(errInvalidPayload("Content-Type must be application/json"));
    return;
  }

  // ── Parse + validate body ──────────────────────────────
  let body: unknown;
  try {
    body = req.body ?? {};
  } catch {
    res.status(400).json(errInvalidPayload("Request body is not valid JSON"));
    return;
  }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    res
      .status(400)
      .json(errInvalidPayload(first ? `${first.path.join(".")}: ${first.message}` : "Validation failed"));
    return;
  }

  // ── Run scan ───────────────────────────────────────────
  try {
    const result = await runScan(parsed.data, makeRequestId());
    res.status(200).json(result);
  } catch (err) {
    console.error("[trend-radar] POST scan error:", err instanceof Error ? err.message : err);
    res.status(503).json(errUnavailable());
  }
}
