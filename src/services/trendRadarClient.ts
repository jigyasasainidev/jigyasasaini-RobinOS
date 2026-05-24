// ============================================================
// TREND RADAR CLIENT — Frontend adapter for Script Engine
// ============================================================
// Calls the deployed Trend Radar API and returns structured
// TrendIntelligence ready to inject into AI script prompts.
//
// Architecture:
//   StudioPage → scanTrendTopic() → /api/public/trends/scan
//                                 → TrendIntelligence
//
// Fallback: on any failure, returns isFallback: true.
// Script Engine always continues — never blocked.
// ============================================================

import type { TrendScanResult, TrendIntelligence, TrendOpportunity } from "@/types/trendRadar";

// ── Config ────────────────────────────────────────────────
// VITE_TREND_RADAR_API_KEY — set in Vercel env vars (production)
// Falls back to hardcoded key so the feature works even if env var
// is not yet configured. This key is safe to be here — it's the
// public-facing API protection key, not a Supabase service secret.
const TREND_RADAR_URL = "/api/public/trends/scan";
const TREND_RADAR_KEY =
  (import.meta.env.VITE_TREND_RADAR_API_KEY as string | undefined) ||
  "trd_live_IGHlFFcIPPYryvyVv_-j2kqqkalj1c_ZrRroh8yftob8sbvD5yjQOA";
const TIMEOUT_MS      = 8_000;

// In-memory scan cache — prevents duplicate scans within 5 min
const scanCache = new Map<string, { result: TrendIntelligence; at: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Active abort controller per topic — cancels stale requests
const activeControllers = new Map<string, AbortController>();

// ── Dev logging ────────────────────────────────────────────
const isDev = import.meta.env.DEV;

function log(msg: string, data?: unknown) {
  if (!isDev) return;
  if (data !== undefined) {
    console.debug(`[TrendRadar] ${msg}`, data);
  } else {
    console.debug(`[TrendRadar] ${msg}`);
  }
}

// ── Fallback intelligence (when API unavailable) ───────────
function buildFallback(topic: string): TrendIntelligence {
  return {
    requestId:        "fallback",
    topic,
    topOpportunities: [],
    risingAngles:     [],
    viralHooks:       [],
    lowCompetition:   [],
    sourceSpread:     0,
    confidence:       0,
    isFallback:       true,
  };
}

// ── Derive TrendIntelligence from raw API response ─────────
function buildIntelligence(topic: string, requestId: string, ops: TrendOpportunity[], meta: { sourceSpread: number; confidence: number }): TrendIntelligence {
  const sorted = [...ops].sort((a, b) => b.momentumScore - a.momentumScore);

  const lowComp = sorted.filter(o =>
    o.maturityStage === "Early" || o.maturityStage === "Rising"
  );

  const risingAngles = lowComp
    .map(o => o.creatorAngle)
    .filter(Boolean)
    .slice(0, 3);

  const viralHooks = sorted
    .map(o => o.whyTrending)
    .filter(Boolean)
    .slice(0, 4);

  return {
    requestId,
    topic,
    topOpportunities: sorted.slice(0, 3),
    risingAngles,
    viralHooks,
    lowCompetition:   lowComp.slice(0, 3),
    sourceSpread:     meta.sourceSpread,
    confidence:       meta.confidence,
    isFallback:       ops.length === 0,
  };
}

// ── Main export ────────────────────────────────────────────

/**
 * Scan a topic for live trend intelligence.
 * Always resolves — never throws. Returns isFallback:true on failure.
 */
export async function scanTrendTopic(topic: string): Promise<TrendIntelligence> {
  const key = topic.trim().toLowerCase();
  if (!key) return buildFallback(topic);

  // Cache hit
  const cached = scanCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    log(`cache hit for "${topic}"`, { requestId: cached.result.requestId });
    return cached.result;
  }

  // Abort any stale request for the same topic
  activeControllers.get(key)?.abort();
  const ctrl = new AbortController();
  activeControllers.set(key, ctrl);

  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();

  log(`scanning "${topic}"...`);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key":    TREND_RADAR_KEY,
    };

    const res = await fetch(TREND_RADAR_URL, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ topic }),
      signal:  ctrl.signal,
    });

    clearTimeout(timer);
    activeControllers.delete(key);

    const elapsed = Date.now() - start;

    if (!res.ok) {
      log(`API error ${res.status} for "${topic}"`, { elapsed });
      return buildFallback(topic);
    }

    const json = await res.json() as TrendScanResult;

    if (!json.success) {
      log(`API returned failure for "${topic}"`, { error: json.error });
      return buildFallback(topic);
    }

    const intel = buildIntelligence(
      topic,
      json.requestId,
      json.data.opportunities,
      json.data.metadata,
    );

    log(`scan complete for "${topic}"`, {
      requestId:   json.requestId,
      ops:         json.data.opportunities.length,
      sourceSpread: json.data.metadata.sourceSpread,
      confidence:  json.data.metadata.confidence,
      elapsed_ms:  elapsed,
      isFallback:  intel.isFallback,
    });

    // Cache result
    scanCache.set(key, { result: intel, at: Date.now() });

    return intel;

  } catch (err) {
    clearTimeout(timer);
    activeControllers.delete(key);

    const isAbort = err instanceof Error && err.name === "AbortError";
    log(`${isAbort ? "timeout" : "network error"} for "${topic}"`, { elapsed: Date.now() - start });

    return buildFallback(topic);
  }
}

// ── Build enriched AI prompt from intelligence ─────────────

/**
 * Constructs the intelligence injection block for the AI prompt.
 * Returns empty string on fallback — no hallucinated intelligence.
 */
export function buildTrendAwareContext(intel: TrendIntelligence): string {
  if (intel.isFallback || intel.topOpportunities.length === 0) return "";

  const lines: string[] = [];

  lines.push("=== LIVE TREND INTELLIGENCE (use this to shape the script) ===");

  if (intel.topOpportunities.length > 0) {
    lines.push("\n🔥 TOP CREATOR OPPORTUNITIES RIGHT NOW:");
    for (const op of intel.topOpportunities) {
      lines.push(`  • ${op.cleanTitle}`);
      lines.push(`    Why: ${op.whyTrending}`);
      lines.push(`    Angle: ${op.creatorAngle}`);
      lines.push(`    Stage: ${op.maturityStage} | Momentum: ${op.momentumScore}/100`);
    }
  }

  if (intel.lowCompetition.length > 0) {
    lines.push("\n🎯 LOW COMPETITION ANGLES (Early/Rising — act now):");
    for (const op of intel.lowCompetition) {
      lines.push(`  • ${op.cleanTitle} (${op.opportunityType})`);
    }
  }

  if (intel.viralHooks.length > 0) {
    lines.push("\n🧠 VIRAL SIGNAL PATTERNS DETECTED:");
    for (const hook of intel.viralHooks) {
      lines.push(`  • ${hook}`);
    }
  }

  if (intel.risingAngles.length > 0) {
    lines.push("\n⚡ RISING CREATOR ANGLES:");
    for (const angle of intel.risingAngles) {
      lines.push(`  • ${angle}`);
    }
  }

  lines.push(`\nSignal confidence: ${intel.confidence}/100 | Source spread: ${intel.sourceSpread} sources`);
  lines.push("=== USE THE ABOVE INTELLIGENCE — reference real trends, not generic advice ===\n");

  return lines.join("\n");
}
