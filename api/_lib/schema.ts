// ============================================================
// TREND RADAR — Zod Request Schema + Response Types
// ============================================================

import { z } from "zod";

export const VALID_PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"] as const;
export type  PlatformId      = typeof VALID_PLATFORMS[number];

export const ScanRequestSchema = z.object({
  query: z
    .string({ required_error: "query is required" })
    .min(1, "query must not be empty")
    .max(120, "query must be 120 characters or fewer")
    .transform((s) => s.trim()),
  platforms: z
    .array(z.enum(VALID_PLATFORMS))
    .optional()
    .default(["youtube", "instagram", "facebook", "tiktok"]),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

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
  firstSeen:        string;   // ISO timestamp
  sourcesCount:     number;
}

export interface ScanResponse {
  ok:           true;
  query:        string;
  scanMode:     "auto_6h_to_7d";
  generatedAt:  string;
  trends:       TrendOpportunity[];
  meta: {
    sourcesHealthy: number;
    sourcesPartial: number;
    rateLimit:      string;
  };
}

// ── GET response (service metadata) ───────────────────────
export const GET_RESPONSE = {
  ok:          true,
  service:     "Trend Radar Public API",
  version:     "1.0.0",
  description: "Returns creator-ready trend opportunities for any topic using multi-window free source scanning.",
  auth: {
    method:  "API key required",
    headers: ["x-api-key: <your-key>", "Authorization: Bearer <your-key>"],
  },
  endpoints: {
    "GET /api/public/trends/scan":  "Service metadata and request schema",
    "POST /api/public/trends/scan": "Run a trend scan for the given query",
  },
  requestSchema: {
    query:     "string (1-120 chars) — topic to scan",
    platforms: "string[] optional — [youtube, instagram, facebook, tiktok] — default: all",
  },
  responseShape: {
    ok:          "boolean",
    query:       "string",
    scanMode:    "auto_6h_to_7d",
    generatedAt: "ISO 8601 timestamp",
    trends:      "TrendOpportunity[]",
    meta:        "{ sourcesHealthy, sourcesPartial, rateLimit }",
  },
  rateLimit: "20 requests per 60 seconds per API key + IP",
  scanMode:  "Automatically scans 6h → 12h → 24h → 48h → 7d windows.",
} as const;
