// ============================================================
// TREND RADAR — Main Scan Engine
// Orchestrates: fetch → cluster → score → format → sort
// ============================================================

import { fetchAllSources } from "./sources.js";
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
  normalizePhrase,
} from "./pipeline.js";
import type { ScanRequest, TrendOpportunity, ScanResponse } from "./schema.js";

const MIN_CLUSTER_SIGNALS = 1; // include single-signal trends (for niche queries)
const MAX_TRENDS_RETURNED = 12;

// Fallback trends when query is too niche or all sources fail
function buildFallbackTrends(query: string): TrendOpportunity[] {
  const now = new Date().toISOString();
  const titleized = query.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  return [
    {
      cleanTitle:      `${titleized} Content Opportunities`,
      momentumScore:   35,
      freshness:       "24h",
      maturityStage:   "Early",
      confidenceScore: 30,
      whyTrending:     `Limited live signals found for "${query}" — this is an emerging or niche topic with early-mover advantage.`,
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
      whyTrending:     `Search-driven steady demand — evergreen education format works well for niche topics.`,
      creatorAngle:    `Tutorial-style breakdown for beginners — break down "${query}" into 3 clear steps. Strong SEO pull.`,
      opportunityType: "Tutorial",
      signalPlatforms: ["youtube"],
      firstSeen:       now,
      sourcesCount:    0,
    },
  ];
}

export async function runScan(request: ScanRequest): Promise<ScanResponse> {
  const { query } = request;
  const now        = new Date();

  // ── 1. Fetch all sources in parallel ──────────────────────
  const { results, sourcesHealthy, sourcesPartial } = await fetchAllSources(query);

  // Flatten all signals
  const allSignals = results.flatMap((r) => r.signals);

  // ── 2. Cluster signals into trend groups ──────────────────
  const clusters = clusterSignals(allSignals);

  // ── 3. Score + rank clusters ──────────────────────────────
  const scored = clusters
    .filter((c) => c.signals.length >= MIN_CLUSTER_SIGNALS)
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

      // First seen = earliest publishedAt across signals
      const dates = cluster.signals
        .map((s) => s.publishedAt ? new Date(s.publishedAt).getTime() : Date.now())
        .filter((d) => !isNaN(d));
      const firstSeen = dates.length > 0
        ? new Date(Math.min(...dates)).toISOString()
        : now.toISOString();

      return {
        cleanTitle:      readableTitle || query,
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

  // ── 4. Use fallback if no meaningful trends found ──────────
  const trends: TrendOpportunity[] = scored.length >= 1
    ? scored
    : buildFallbackTrends(query);

  return {
    ok:          true,
    query,
    scanMode:    "auto_6h_to_7d",
    generatedAt: now.toISOString(),
    trends,
    meta: {
      sourcesHealthy,
      sourcesPartial,
      rateLimit: "20/60s",
    },
  };
}
