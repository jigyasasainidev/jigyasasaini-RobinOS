// ============================================================
// TREND RADAR — Main Scan Engine
// Orchestrates: fetch → cluster → score → format → sort
// Returns stable ScanResponse envelope
// ============================================================

import { fetchAllSources }  from "./sources";
import {
  clusterSignals,
  scoreMomentum,
  deriveFreshness,
  deriveMaturity,
  deriveCreatorAngle,
  deriveWhyTrending,
  derivePlatforms,
  deriveConfidence,
  classifyOpportunity,
  toReadableTitle,
} from "./pipeline";
import type { ScanRequest, TrendOpportunity, ScanResponse } from "./schema";

const MAX_TRENDS_RETURNED = 12;
const SCAN_WINDOWS        = ["6h", "12h", "24h", "48h", "7d"];

// ── Fallback when topic is too niche or all sources fail ───
function buildFallbackTrends(topic: string): TrendOpportunity[] {
  const now        = new Date().toISOString();
  const titleized  = topic
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return [
    {
      cleanTitle:      `${titleized} Content Opportunities`,
      momentumScore:   35,
      freshness:       "24h",
      maturityStage:   "Early",
      confidenceScore: 30,
      whyTrending:     `Limited live signals found for "${topic}" — emerging or niche topic with early-mover advantage.`,
      creatorAngle:    `Be the first to create authoritative ${titleized} content — low competition + high search intent.`,
      opportunityType: "Explainer",
      signalPlatforms: ["youtube", "instagram"],
      firstSeen:       now,
      sourcesCount:    0,
    },
    {
      cleanTitle:      `How to Understand ${titleized}`,
      momentumScore:   28,
      freshness:       "7d",
      maturityStage:   "Early",
      confidenceScore: 25,
      whyTrending:     `Steady evergreen demand — tutorial format performs well for niche topics.`,
      creatorAngle:    `Break down "${topic}" into 3 clear steps for beginners. Strong SEO pull on YouTube.`,
      opportunityType: "Tutorial",
      signalPlatforms: ["youtube"],
      firstSeen:       now,
      sourcesCount:    0,
    },
  ];
}

export async function runScan(request: ScanRequest, requestId: string): Promise<ScanResponse> {
  const { topic } = request;
  const now        = new Date();

  // ── Fetch all sources in parallel ─────────────────────────
  const { results, sourcesHealthy, sourcesPartial } = await fetchAllSources(topic);
  const allSignals = results.flatMap((r) => r.signals);

  // ── Cluster → score → rank ─────────────────────────────────
  const clusters = clusterSignals(allSignals);

  const scored = clusters
    .filter((c) => c.signals.length >= 1)
    .map((cluster) => {
      const momentumScore   = scoreMomentum(cluster);
      const freshness       = deriveFreshness(cluster);
      const sources         = [...new Set(cluster.signals.map((s) => s.source))];
      const maturityStage   = deriveMaturity(momentumScore, freshness, sources.length);
      const signalPlatforms = derivePlatforms(sources);
      const confidenceScore = deriveConfidence(momentumScore, sources.length, cluster.signals.length);
      const readableTitle   = toReadableTitle(cluster.key);
      const opportunityType = classifyOpportunity(readableTitle + " " + cluster.variants.join(" "));
      const creatorAngle    = deriveCreatorAngle(readableTitle, sources);
      const whyTrending     = deriveWhyTrending(cluster, momentumScore);

      const dates = cluster.signals
        .map((s) => (s.publishedAt ? new Date(s.publishedAt).getTime() : Date.now()))
        .filter((d) => !isNaN(d));
      const firstSeen = dates.length > 0
        ? new Date(Math.min(...dates)).toISOString()
        : now.toISOString();

      return {
        cleanTitle:      readableTitle || topic,
        momentumScore,
        freshness,
        maturityStage,
        confidenceScore,
        whyTrending,
        creatorAngle,
        opportunityType,
        signalPlatforms,
        firstSeen,
        sourcesCount:    sources.length,
        _rank:           momentumScore + confidenceScore,
      } satisfies TrendOpportunity & { _rank: number };
    })
    .filter((t) => t.cleanTitle.length > 2)
    .sort((a, b) => b._rank - a._rank)
    .slice(0, MAX_TRENDS_RETURNED)
    .map(({ _rank, ...t }) => t);

  const opportunities: TrendOpportunity[] =
    scored.length >= 1 ? scored : buildFallbackTrends(topic);

  // Average confidence across returned opportunities
  const avgConfidence =
    opportunities.length > 0
      ? Math.round(
          opportunities.reduce((acc, o) => acc + o.confidenceScore, 0) / opportunities.length,
        )
      : 0;

  return {
    success:   true,
    requestId,
    data: {
      topic,
      opportunities,
      metadata: {
        scanWindows:  SCAN_WINDOWS,
        sourceSpread: sourcesHealthy,
        confidence:   avgConfidence,
        generatedAt:  now.toISOString(),
        rateLimit:    "20/60s",
      },
    },
  };
}
