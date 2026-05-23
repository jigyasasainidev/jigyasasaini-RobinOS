// ============================================================
// TREND RADAR — GET + POST /api/public/trends/scan
// Vercel serverless function (Node.js runtime)
// ============================================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z }                           from "zod";
import { authenticate }                from "../../_lib/auth.js";
import { runScan }                     from "../../_lib/engine.js";
import { ScanRequestSchema, GET_RESPONSE } from "../../_lib/schema.js";
import {
  errUnauthorized, errInvalidPayload, errRateLimited,
  errUnavailable, errMethodNotAllowed, statusForError,
} from "../../_lib/errors.js";

// ── CORS / security headers ────────────────────────────────
function setHeaders(res: VercelResponse): void {
  res.setHeader("Content-Type",                 "application/json");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("X-Frame-Options",              "DENY");
  res.setHeader("Cache-Control",                "no-store");
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
}

// ── Main handler ───────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ── GET — service metadata ─────────────────────────────
  if (req.method === "GET") {
    // GET doesn't require auth — it's the public documentation endpoint
    res.status(200).json(GET_RESPONSE);
    return;
  }

  // ── POST — trend scan ──────────────────────────────────
  if (req.method !== "POST") {
    const err = errMethodNotAllowed();
    res.status(statusForError(err.code)).json(err);
    return;
  }

  // ── Auth check ─────────────────────────────────────────
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

  // ── Content-Type guard ─────────────────────────────────
  const ct = req.headers["content-type"] ?? "";
  if (!ct.includes("application/json")) {
    res.status(400).json(errInvalidPayload("Content-Type must be application/json"));
    return;
  }

  // ── Parse + validate body ──────────────────────────────
  let body: unknown;
  try {
    // Vercel parses JSON body automatically when Content-Type is json
    body = req.body ?? {};
  } catch {
    res.status(400).json(errInvalidPayload("Request body is not valid JSON"));
    return;
  }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    res.status(400).json(errInvalidPayload(first ? `${first.path.join(".")}: ${first.message}` : "Validation failed"));
    return;
  }

  // ── Run scan ───────────────────────────────────────────
  try {
    const result = await runScan(parsed.data);
    res.status(200).json(result);
  } catch (err) {
    // Never leak stack traces
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[trend-radar] scan error:", msg);
    res.status(503).json(errUnavailable("Scan failed. Please retry."));
  }
}
