// ============================================================
// TREND RADAR — Normalization, Clustering & Scoring Pipeline
// ============================================================

import type { RawSignal } from "./sources";

// ── Stop words to strip from phrases ──────────────────────
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","shall","can",
  "not","no","nor","so","yet","both","either","neither","this","that","these",
  "those","i","me","my","we","our","you","your","he","she","it","they","their",
  "what","which","who","whom","when","where","why","how","all","any","each",
  "more","most","other","such","only","also","just","than","then","about",
  "into","through","during","before","after","above","below","between",
  "out","off","over","under","again","further","once","here","there","very",
  "s","t","re","ve","ll","d","m","news","update","latest","new","top","best",
]);

const JUNK_PATTERNS = [
  /\b(reddit|r\/\w+|u\/\w+)\b/gi,
  /http[s]?:\/\/\S+/g,
  /\[[^\]]*\]/g,        // [removed], [deleted], etc.
  /\([^)]{0,6}\)/g,     // short parens like (1), (US)
  /[^\w\s\-']/g,        // non-alphanumeric except dash/apostrophe
  /\s{2,}/g,            // multiple spaces
];

// ── 1. Normalize a single raw phrase ──────────────────────
export function normalizePhrase(raw: string): string {
  let s = raw.toLowerCase();
  for (const pattern of JUNK_PATTERNS) {
    s = s.replace(pattern, " ");
  }
  s = s.trim();
  // Remove pure stop-word phrases
  const words = s.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return words.join(" ").trim();
}

// ── 2. Convert normalized key → readable hook title ───────
export function toReadableTitle(normalized: string): string {
  if (!normalized) return "";
  // Title-case each meaningful word
  return normalized
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── 3. Semantic grouping via bigram/trigram overlap ────────
// Simple but effective: two phrases share a cluster if they
// share ≥2 significant words OR one contains the other as substring.

interface Cluster {
  key: string;          // canonical normalized form
  variants: string[];   // all normalized phrases in this cluster
  signals: RawSignal[];
}

function significantWords(phrase: string): Set<string> {
  return new Set(phrase.split(" ").filter((w) => w.length >= 4 && !STOP_WORDS.has(w)));
}

function overlapScore(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

export function clusterSignals(signals: RawSignal[]): Cluster[] {
  // Normalize + index
  type IndexedSignal = { norm: string; original: RawSignal };
  const indexed: IndexedSignal[] = signals
    .map((s) => ({ norm: normalizePhrase(s.text), original: s }))
    .filter((s) => s.norm.length > 3);

  const clusters: Cluster[] = [];

  for (const item of indexed) {
    // Try to find an existing cluster with overlap ≥ 0.5
    let placed = false;
    for (const cluster of clusters) {
      if (overlapScore(cluster.key, item.norm) >= 0.5 || cluster.key.includes(item.norm) || item.norm.includes(cluster.key)) {
        cluster.variants.push(item.norm);
        cluster.signals.push(item.original);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ key: item.norm, variants: [item.norm], signals: [item.original] });
    }
  }

  return clusters;
}

// ── 4. Momentum scoring (0-100) ───────────────────────────
// Signals: mention count, cross-source diversity, score sum, freshness

function recentCount(signals: RawSignal[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return signals.filter((s) => {
    if (!s.publishedAt) return true; // assume recent if no date
    return new Date(s.publishedAt).getTime() >= cutoff;
  }).length;
}

const WINDOW_6H  = 6  * 60 * 60 * 1000;
const WINDOW_24H = 24 * 60 * 60 * 1000;
const WINDOW_48H = 48 * 60 * 60 * 1000;

export function scoreMomentum(cluster: Cluster): number {
  const total      = cluster.signals.length;
  const sources    = new Set(cluster.signals.map((s) => s.source)).size;
  const scoreSum   = cluster.signals.reduce((acc, s) => acc + (s.score ?? 0), 0);
  const recent6h   = recentCount(cluster.signals, WINDOW_6H);
  const recent24h  = recentCount(cluster.signals, WINDOW_24H);
  const recent48h  = recentCount(cluster.signals, WINDOW_48H);

  // Velocity: mentions in recent windows vs total
  const velocity6h  = total > 0 ? recent6h  / total : 0;
  const velocity24h = total > 0 ? recent24h / total : 0;
  const velocity48h = total > 0 ? recent48h / total : 0;

  let score = 0;

  // Base mention count (0-30)
  score += Math.min(total * 4, 30);

  // Cross-source diversity (0-20) — appearing on multiple sources = more real
  score += (sources - 1) * 10;

  // Velocity boost (0-30)
  score += velocity6h  * 30;
  score += velocity24h * 15;
  score += velocity48h * 5;

  // Engagement score sum (reddit upvotes etc.) (0-20)
  score += Math.min(scoreSum / 1000, 20);

  return Math.min(Math.round(score), 100);
}

// ── 5. Freshness label ────────────────────────────────────
export function deriveFreshness(cluster: Cluster): "6h" | "12h" | "24h" | "48h" | "7d" {
  const recent6h  = recentCount(cluster.signals, WINDOW_6H);
  const recent24h = recentCount(cluster.signals, WINDOW_24H);
  const recent48h = recentCount(cluster.signals, WINDOW_48H);

  if (recent6h  >= 1) return "6h";
  if (recent24h >= 1) return "24h";
  if (recent48h >= 1) return "48h";
  return "7d";
}

// ── 6. Maturity stage ─────────────────────────────────────
export function deriveMaturity(
  momentumScore: number,
  freshness: string,
  sources: number,
): "Early" | "Rising" | "Hot" | "Saturated" | "Dying" {
  if (momentumScore >= 75 && sources >= 3)           return "Hot";
  if (momentumScore >= 55 && freshness === "6h")     return "Rising";
  if (momentumScore >= 45 && freshness === "24h")    return "Rising";
  if (momentumScore >= 30 && sources >= 2)           return "Early";
  if (momentumScore >= 20)                           return "Early";
  if (freshness === "7d" && momentumScore < 20)      return "Dying";
  return "Saturated";
}

// ── 7. Opportunity type classification ────────────────────
const HOOK_PATTERNS: Record<string, RegExp[]> = {
  Tutorial:     [/how\s+to/i, /guide/i, /tutorial/i, /step[s]?/i, /learn/i, /beginner/i],
  Explainer:    [/what\s+is/i, /why\s+is/i, /explained/i, /meaning/i, /understand/i],
  Reaction:     [/react/i, /reaction/i, /response/i, /responding/i, /review/i],
  Storytelling: [/story/i, /experience/i, /journey/i, /happened/i, /when\s+i/i],
  Commentary:   [/opinion/i, /think/i, /honest/i, /controversial/i, /unpopular/i, /disagree/i],
  Breakdown:    [/breakdown/i, /analysis/i, /deep\s+dive/i, /look\s+at/i, /inside/i],
};

export function classifyOpportunity(
  title: string,
): "Storytelling" | "Tutorial" | "Reaction" | "Explainer" | "Breakdown" | "Commentary" {
  for (const [type, patterns] of Object.entries(HOOK_PATTERNS)) {
    if (patterns.some((p) => p.test(title))) {
      return type as ReturnType<typeof classifyOpportunity>;
    }
  }
  // Default based on title length and structure
  if (title.split(" ").length <= 4) return "Breakdown";
  return "Commentary";
}

// ── 8. Creator value signals ──────────────────────────────
export function deriveCreatorAngle(title: string, sources: string[]): string {
  const t = title.toLowerCase();

  if (t.includes("ai") || t.includes("artificial intelligence")) {
    return `Show your audience how to use ${title} in your workflow — AI tool content is high-CTR right now.`;
  }
  if (t.includes("how to") || t.includes("tutorial")) {
    return `Step-by-step breakdown format performs well — nail the hook in the first 3 seconds.`;
  }
  if (sources.includes("reddit") && sources.includes("youtube")) {
    return `Cross-platform momentum — community discussion + video demand = high creator opportunity. Make an explainer before saturation.`;
  }
  if (sources.includes("google_news")) {
    return `News-cycle trend — ride it with a fast hot-take or reaction within 24h for maximum algorithmic reach.`;
  }
  return `Create a quick ${title}-focused short that ties this trend to your niche before it peaks.`;
}

export function deriveWhyTrending(cluster: Cluster, momentumScore: number): string {
  const total   = cluster.signals.length;
  const sources = [...new Set(cluster.signals.map((s) => s.source))];
  const src     = sources.slice(0, 2).join(" and ");

  if (momentumScore >= 70) {
    return `Exploding across ${src} with ${total} signals in a short window — high velocity cross-source spread.`;
  }
  if (sources.length >= 3) {
    return `Appearing simultaneously on ${src} and more — multi-platform signal convergence suggests real momentum.`;
  }
  if (total >= 5) {
    return `Repeated ${total} times across ${src} — clustering suggests a viral angle is forming.`;
  }
  return `Emerging signal on ${src} — early-stage trend with growing creator interest.`;
}

// ── 9. Signal platform list ───────────────────────────────
const SOURCE_TO_PLATFORM: Record<string, string> = {
  youtube:       "youtube",
  reddit:        "instagram", // Reddit engagement often correlates with Instagram content
  google_news:   "youtube",
  google_trends: "tiktok",
};

export function derivePlatforms(sources: string[]): string[] {
  const platforms = new Set<string>();
  for (const s of sources) {
    const p = SOURCE_TO_PLATFORM[s];
    if (p) platforms.add(p);
  }
  if (platforms.size === 0) platforms.add("instagram");
  return [...platforms];
}

// ── 10. Confidence score ──────────────────────────────────
export function deriveConfidence(momentumScore: number, sourcesCount: number, signalCount: number): number {
  let c = 40;
  c += Math.min(momentumScore * 0.3, 30);
  c += (sourcesCount - 1) * 8;
  c += Math.min(signalCount * 2, 20);
  return Math.min(Math.round(c), 95);
}
