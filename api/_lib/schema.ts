// ============================================================
// TREND RADAR — Zod Request Schema + Stable Response Types
// ============================================================

import { z } from "zod";

export const VALID_PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"] as const;
export type  PlatformId      = typeof VALID_PLATFORMS[number];

// ── Inbound request schema ─────────────────────────────────
// Accepts "topic" (canonical) OR "query" (legacy alias — keeps backward compat)
export const ScanRequestSchema = z.object({
  topic: z
    .string({ required_error: "topic is required" })
    .min(2,   "topic must be at least 2 characters")
    .max(120, "topic must be 120 characters or fewer")
    .transform((s) => s.trim())
    .optional(),
  // legacy alias — maps to topic if topic is absent
  query: z
    .string()
    .min(2)
    .max(120)
    .transform((s) => s.trim())
    .optional(),
  platforms: z
    .array(z.enum(VALID_PLATFORMS))
    .optional()
    .default(["youtube", "instagram", "facebook", "tiktok"]),
}).transform((data, ctx) => {
  const topic = data.topic ?? data.query;
  if (!topic || topic.trim().length < 2) {
    ctx.addIssue({ code: "custom", message: "topic is required and must be at least 2 characters", path: ["topic"] });
    return z.NEVER;
  }
  return { topic: topic.trim(), platforms: data.platforms };
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

// ── Opportunity shape (internal + external) ────────────────
export interface TrendOpportunity {
  cleanTitle:       string;
  momentumScore:    number;
  freshness:        "6h" | "12h" | "24h" | "48h" | "7d";
  maturityStage:    "Early" | "Rising" | "Hot" | "Saturated" | "Dying";
  confidenceScore:  number;
  whyTrending:      string;
  creatorAngle:     string;
  opportunityType:  "Storytelling" | "Tutorial" | "Reaction" | "Explainer" | "Breakdown" | "Commentary";
  signalPlatforms:  string[];
  firstSeen:        string;
  sourcesCount:     number;
}

// ── Stable external response envelope ─────────────────────
export interface ScanResponse {
  success:     true;
  requestId:   string;
  data: {
    topic:         string;
    opportunities: TrendOpportunity[];
    metadata: {
      scanWindows:  string[];
      sourceSpread: number;
      confidence:   number;
      generatedAt:  string;
      rateLimit:    string;
    };
  };
}

// ── GET response (service metadata + schema docs) ──────────
export const GET_METADATA = {
  success:     true,
  service:     "Trend Radar Public API",
  version:     "1.1.0",
  description: "Returns creator-ready trend opportunities for any topic using multi-window free source scanning.",
  auth: {
    method:  "API key required on POST. GET with topic param also requires key.",
    headers: [
      "x-api-key: <your-key>",
      "Authorization: Bearer <your-key>",
    ],
  },
  endpoints: {
    "GET /api/public/trends/scan":          "Service metadata (no auth required)",
    "GET /api/public/trends/scan?topic=...":"Run a scan via query param (auth required)",
    "POST /api/public/trends/scan":         "Run a trend scan via JSON body (auth required)",
  },
  requestSchema: {
    topic:     "string (2-120 chars, required) — topic to scan",
    query:     "string (alias for topic, for backward compatibility)",
    platforms: "string[] optional — [youtube, instagram, facebook, tiktok] — default: all",
  },
  responseEnvelope: {
    success:      "boolean",
    requestId:    "string — unique per request",
    data: {
      topic:         "string",
      opportunities: "TrendOpportunity[]",
      metadata: {
        scanWindows:  "string[] — windows scanned e.g. ['6h','24h','7d']",
        sourceSpread: "number — unique sources that returned data",
        confidence:   "number — average confidence across opportunities",
        generatedAt:  "ISO 8601 timestamp",
        rateLimit:    "string",
      },
    },
  },
  errorEnvelope: {
    success: false,
    error: {
      code:               "UNAUTHORIZED | INVALID_PAYLOAD | RATE_LIMITED | TEMPORARY_UNAVAILABLE",
      message:            "string",
      retryAfterSeconds:  "number (only on RATE_LIMITED)",
    },
  },
  rateLimit: "20 requests per 60 seconds per API key + IP combination",
  scanMode:  "Automatically scans 6h → 12h → 24h → 48h → 7d windows internally.",
} as const;
