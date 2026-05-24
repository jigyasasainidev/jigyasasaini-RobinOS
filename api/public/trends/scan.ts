// ============================================================
// TREND RADAR — /api/public/trends/scan  (self-contained)
// GET  (no topic)   → service metadata (public, no auth)
// GET  (?topic=...) → trend scan (auth required)
// POST              → trend scan (auth required)
// ============================================================
// Single-file to avoid ESM/module resolution issues on Vercel.
// "type":"module" in package.json + multi-file relative imports
// causes ERR_MODULE_NOT_FOUND regardless of .js extension usage.
// ============================================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════
// AUTH + RATE LIMITER
// ════════════════════════════════════════════════════════════

const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WINDOW = 60_000;
const rateLimitStore    = new Map<string, { count: number; windowStart: number }>();

function extractApiKey(req: VercelRequest): string | null {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  return null;
}

function getClientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return "unknown";
}

function checkRateLimit(fingerprint: string): number | null {
  const now  = Date.now();
  const slot = rateLimitStore.get(fingerprint);
  if (!slot || now - slot.windowStart >= RATE_LIMIT_WINDOW) {
    rateLimitStore.set(fingerprint, { count: 1, windowStart: now });
    return null;
  }
  if (slot.count >= RATE_LIMIT_MAX) {
    return Math.ceil((RATE_LIMIT_WINDOW - (now - slot.windowStart)) / 1000);
  }
  slot.count++;
  return null;
}

function authenticate(req: VercelRequest):
  | { ok: true }
  | { ok: false; code: "unauthorized" | "rate_limited"; retryAfterSeconds?: number } {
  const expected = process.env.TREND_RADAR_API_KEY;
  if (!expected) return { ok: false, code: "unauthorized" };
  const provided = extractApiKey(req);
  if (!provided || provided !== expected) return { ok: false, code: "unauthorized" };
  const retryAfter = checkRateLimit(`${getClientIp(req)}::${provided.slice(0, 8)}`);
  if (retryAfter !== null) return { ok: false, code: "rate_limited", retryAfterSeconds: retryAfter };
  return { ok: true };
}

// ════════════════════════════════════════════════════════════
// ZOD SCHEMA
// ════════════════════════════════════════════════════════════

const VALID_PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"] as const;

const ScanRequestSchema = z.object({
  topic: z.string().min(2).max(120).transform(s => s.trim()).optional(),
  query: z.string().min(2).max(120).transform(s => s.trim()).optional(),
  platforms: z.array(z.enum(VALID_PLATFORMS)).optional().default(["youtube","instagram","facebook","tiktok"]),
}).transform((data, ctx) => {
  const topic = data.topic ?? data.query;
  if (!topic || topic.trim().length < 2) {
    ctx.addIssue({ code: "custom", message: "topic is required (min 2 chars)", path: ["topic"] });
    return z.NEVER;
  }
  return { topic: topic.trim(), platforms: data.platforms };
});

// ════════════════════════════════════════════════════════════
// ERROR HELPERS — always include requestId
// ════════════════════════════════════════════════════════════

function err(code: string, message: string, requestId: string, extra?: Record<string, unknown>) {
  return { success: false, requestId, error: { code, message, ...extra } };
}

// ════════════════════════════════════════════════════════════
// FREE SOURCE FETCHERS
// ════════════════════════════════════════════════════════════

interface RawSignal {
  text:        string;
  source:      string;
  publishedAt?: string;
  score?:      number;
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res   = await fetch(url, {
      signal:  ctrl.signal,
      headers: { "User-Agent": "TrendRadar/1.1 (research)" },
    });
    clearTimeout(timer);
    return res.ok ? res.text() : null;
  } catch { return null; }
}

async function safeFetchJson(url: string): Promise<unknown | null> {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res   = await fetch(url, {
      signal:  ctrl.signal,
      headers: { "User-Agent": "TrendRadar/1.1 (research)" },
    });
    clearTimeout(timer);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function xmlTags(xml: string, tag: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}[^>]*>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, "gi");
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

async function fetchYouTube(q: string): Promise<RawSignal[]> {
  const xml = await safeFetchText(`https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(q)}`);
  if (!xml) return [];
  const titles = xmlTags(xml, "title").slice(1, 21);
  const dates  = xmlTags(xml, "published").slice(1);
  return titles.map((text, i) => ({ text, source: "youtube", publishedAt: dates[i] })).filter(s => s.text.length > 4);
}

async function fetchReddit(q: string): Promise<RawSignal[]> {
  const data = await safeFetchJson(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=hot&t=week&limit=25`) as any;
  return (data?.data?.children ?? [])
    .filter((c: any) => c?.data?.title)
    .map((c: any) => ({
      text:        c.data.title,
      source:      "reddit",
      publishedAt: c.data.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : undefined,
      score:       (c.data.score ?? 0) + (c.data.num_comments ?? 0) * 2,
    }));
}

async function fetchGoogleNews(q: string): Promise<RawSignal[]> {
  const xml = await safeFetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
  if (!xml) return [];
  const titles = xmlTags(xml, "title").slice(1, 21);
  const dates  = xmlTags(xml, "pubDate");
  return titles
    .filter(t => !t.toLowerCase().includes("google news"))
    .map((text, i) => ({ text, source: "google_news", publishedAt: dates[i] }));
}

// ════════════════════════════════════════════════════════════
// NORMALIZATION + CLUSTERING
// ════════════════════════════════════════════════════════════

const STOP = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","have","has","do","does","will","would","could","should","not","this","that",
  "these","those","i","we","you","he","she","it","they","what","how","all","any","just","also","news",
  "update","latest","new","top","best","s","t","re","ve","ll"]);

function normalize(raw: string): string {
  let s = raw.toLowerCase()
    .replace(/http\S+/g, " ").replace(/r\/\w+/g, " ").replace(/u\/\w+/g, " ")
    .replace(/\[[^\]]*\]/g, " ").replace(/[^\w\s\-']/g, " ").replace(/\s{2,}/g, " ").trim();
  return s.split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).join(" ").trim();
}

function sigWords(phrase: string): Set<string> {
  return new Set(phrase.split(" ").filter(w => w.length >= 4 && !STOP.has(w)));
}

function overlap(a: string, b: string): number {
  const wa = sigWords(a), wb = sigWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

interface Cluster { key: string; variants: string[]; signals: RawSignal[] }

function cluster(signals: RawSignal[]): Cluster[] {
  const indexed = signals.map(s => ({ norm: normalize(s.text), s })).filter(x => x.norm.length > 3);
  const clusters: Cluster[] = [];
  for (const { norm, s } of indexed) {
    let placed = false;
    for (const c of clusters) {
      if (overlap(c.key, norm) >= 0.5 || c.key.includes(norm) || norm.includes(c.key)) {
        c.variants.push(norm); c.signals.push(s); placed = true; break;
      }
    }
    if (!placed) clusters.push({ key: norm, variants: [norm], signals: [s] });
  }
  return clusters;
}

// ════════════════════════════════════════════════════════════
// SCORING + CLASSIFICATION
// ════════════════════════════════════════════════════════════

const W6H  = 6  * 3600000;
const W24H = 24 * 3600000;
const W48H = 48 * 3600000;

function recentCount(sigs: RawSignal[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return sigs.filter(s => !s.publishedAt || new Date(s.publishedAt).getTime() >= cutoff).length;
}

function scoreMomentum(c: Cluster): number {
  const total   = c.signals.length;
  const sources = new Set(c.signals.map(s => s.source)).size;
  const scoreSum = c.signals.reduce((a, s) => a + (s.score ?? 0), 0);
  const r6  = recentCount(c.signals, W6H);
  const r24 = recentCount(c.signals, W24H);
  const r48 = recentCount(c.signals, W48H);
  let score = Math.min(total * 4, 30);
  score += (sources - 1) * 10;
  score += (total > 0 ? r6  / total : 0) * 30;
  score += (total > 0 ? r24 / total : 0) * 15;
  score += (total > 0 ? r48 / total : 0) * 5;
  score += Math.min(scoreSum / 1000, 20);
  return Math.min(Math.round(score), 100);
}

function freshness(c: Cluster): "6h"|"12h"|"24h"|"48h"|"7d" {
  if (recentCount(c.signals, W6H)  >= 1) return "6h";
  if (recentCount(c.signals, W24H) >= 1) return "24h";
  if (recentCount(c.signals, W48H) >= 1) return "48h";
  return "7d";
}

function maturity(score: number, fresh: string, srcCount: number): string {
  if (score >= 75 && srcCount >= 3) return "Hot";
  if (score >= 55 && fresh === "6h") return "Rising";
  if (score >= 45) return "Rising";
  if (score >= 20) return "Early";
  if (fresh === "7d") return "Dying";
  return "Saturated";
}

function confidence(score: number, srcCount: number, sigCount: number): number {
  return Math.min(Math.round(40 + score * 0.3 + (srcCount - 1) * 8 + Math.min(sigCount * 2, 20)), 95);
}

const HOOK_PATTERNS: Record<string, RegExp[]> = {
  Tutorial:     [/how\s+to/i, /guide/i, /tutorial/i, /step/i, /learn/i],
  Explainer:    [/what\s+is/i, /why\s+is/i, /explained/i, /meaning/i],
  Reaction:     [/react/i, /reaction/i, /review/i, /response/i],
  Storytelling: [/story/i, /experience/i, /journey/i, /happened/i],
  Commentary:   [/opinion/i, /think/i, /honest/i, /controversial/i],
  Breakdown:    [/breakdown/i, /analysis/i, /deep\s+dive/i, /inside/i],
};

function opportunityType(title: string): string {
  for (const [type, patterns] of Object.entries(HOOK_PATTERNS)) {
    if (patterns.some(p => p.test(title))) return type;
  }
  return title.split(" ").length <= 4 ? "Breakdown" : "Commentary";
}

const SOURCE_PLATFORM: Record<string, string> = {
  youtube: "youtube", reddit: "instagram", google_news: "youtube", google_trends: "tiktok",
};

function signalPlatforms(sources: string[]): string[] {
  const p = new Set(sources.map(s => SOURCE_PLATFORM[s]).filter(Boolean));
  if (!p.size) p.add("instagram");
  return [...p];
}

function titleCase(s: string): string {
  return s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function whyTrending(c: Cluster, score: number): string {
  const total   = c.signals.length;
  const sources = [...new Set(c.signals.map(s => s.source))];
  const src     = sources.slice(0, 2).join(" and ");
  if (score >= 70) return `Exploding across ${src} with ${total} signals in a short window — high velocity cross-source spread.`;
  if (sources.length >= 3) return `Appearing simultaneously on multiple platforms — signal convergence suggests real momentum.`;
  if (total >= 5) return `Repeated ${total} times across ${src} — clustering suggests a viral angle is forming.`;
  return `Emerging signal on ${src} — early-stage trend with growing creator interest.`;
}

function creatorAngle(title: string, sources: string[]): string {
  const t = title.toLowerCase();
  if (t.includes("ai") || t.includes("artificial")) return `Show your audience how to use ${title} in their workflow — AI tool content is high-CTR right now.`;
  if (t.includes("how to") || t.includes("tutorial")) return `Step-by-step breakdown performs well — nail the hook in the first 3 seconds.`;
  if (sources.includes("reddit") && sources.includes("youtube")) return `Cross-platform momentum — community discussion + video demand = high creator opportunity.`;
  if (sources.includes("google_news")) return `News-cycle trend — ride it with a fast hot-take or reaction within 24h for maximum reach.`;
  return `Create a quick ${title}-focused short that ties this trend to your niche before it peaks.`;
}

// ════════════════════════════════════════════════════════════
// FALLBACK TRENDS
// ════════════════════════════════════════════════════════════

function fallbackTrends(topic: string) {
  const now = new Date().toISOString();
  const T   = titleCase(topic);
  return [
    {
      cleanTitle: `${T} Content Opportunities`, momentumScore: 35, freshness: "24h",
      maturityStage: "Early", confidenceScore: 30,
      whyTrending: `Limited live signals for "${topic}" — emerging niche with early-mover advantage.`,
      creatorAngle: `Be the first to create authoritative ${T} content — low competition + high search intent.`,
      opportunityType: "Explainer", signalPlatforms: ["youtube","instagram"],
      firstSeen: now, sourcesCount: 0,
    },
    {
      cleanTitle: `How to Understand ${T}`, momentumScore: 28, freshness: "7d",
      maturityStage: "Early", confidenceScore: 25,
      whyTrending: `Steady evergreen demand — tutorial format works well for niche topics.`,
      creatorAngle: `Break down "${topic}" into 3 clear steps for beginners. Strong SEO pull on YouTube.`,
      opportunityType: "Tutorial", signalPlatforms: ["youtube"],
      firstSeen: now, sourcesCount: 0,
    },
  ];
}

// ════════════════════════════════════════════════════════════
// SUPABASE TREND MEMORY — non-fatal write after scan
// Upserts each opportunity into trend_topics (niche_key = topic).
// Uses service role — bypasses RLS. Non-fatal: never throws.
// ════════════════════════════════════════════════════════════

interface TrendOpportunity {
  cleanTitle:      string;
  momentumScore:   number;
  freshness:       string;
  maturityStage:   string;
  confidenceScore: number;
  whyTrending:     string;
  creatorAngle:    string;
  opportunityType: string;
  signalPlatforms: string[];
  firstSeen:       string;
  sourcesCount:    number;
}

async function persistTrendMemory(topic: string, opportunities: TrendOpportunity[], requestId: string, isFallback: boolean, sourceSpread: number, avgConf: number): Promise<void> {
  const url     = process.env.SUPABASE_URL;
  // Accepts service_role key (preferred) OR publishable/anon key as fallback.
  // If using anon key, ensure INSERT policies exist for anon role on both tables.
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

  // Silently skip if Supabase is not configured — keeps endpoint functional
  if (!url || !roleKey) return;

  try {
    const supabase = createClient(url, roleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nicheKey  = topic.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80);
    const now       = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 6 * 3600_000).toISOString();

    // ── 1. Upsert each opportunity into trend_topics ───────
    const records = opportunities.map((o) => ({
      niche_key:      nicheKey,
      title:          o.cleanTitle,
      description:    o.whyTrending,
      platforms:      o.signalPlatforms.join(", "),
      heat:           Math.min(Math.round(o.momentumScore * 0.99), 99),
      hook_types:     JSON.stringify([o.opportunityType]),
      volume:         o.momentumScore >= 65 ? "High" : o.momentumScore >= 40 ? "Medium" : "Emerging",
      virality_score: o.momentumScore,
      trend_velocity: o.confidenceScore / 10,
      source:         "trend_radar_api",
      expires_at:     expiresAt,
      collected_at:   now,
    }));

    await Promise.allSettled(
      records.map((record) =>
        supabase
          .from("trend_topics")
          .upsert(record, { onConflict: "niche_key, title", ignoreDuplicates: false })
      )
    );

    // ── 2. Write scan audit row ────────────────────────────
    await supabase.from("trend_radar_scans").upsert({
      request_id:        requestId,
      topic,
      source_spread:     sourceSpread,
      confidence:        avgConf,
      opportunity_count: opportunities.length,
      is_fallback:       isFallback,
      scanned_at:        now,
    }, { onConflict: "request_id", ignoreDuplicates: true });

    console.log(`[trend-radar] persisted ${records.length} trend memories + scan audit for "${topic}"`);
  } catch (e) {
    console.warn("[trend-radar] persistTrendMemory failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

async function runScan(topic: string, _platforms: string[], requestId: string) {
  const now = new Date();

  const [yt, reddit, gnews] = await Promise.allSettled([
    fetchYouTube(topic),
    fetchReddit(topic),
    fetchGoogleNews(topic),
  ]);

  const allSignals: RawSignal[] = [
    ...(yt.status      === "fulfilled" ? yt.value      : []),
    ...(reddit.status  === "fulfilled" ? reddit.value  : []),
    ...(gnews.status   === "fulfilled" ? gnews.value   : []),
  ];

  const sourcesHealthy = [yt, reddit, gnews].filter(r => r.status === "fulfilled" && (r.value as RawSignal[]).length > 0).length;

  const clusters = cluster(allSignals);

  const scored = clusters
    .map(c => {
      const ms  = scoreMomentum(c);
      const fr  = freshness(c);
      const srcs = [...new Set(c.signals.map(s => s.source))];
      const cf  = confidence(ms, srcs.length, c.signals.length);
      const rt  = titleCase(c.key);
      const dates = c.signals.map(s => s.publishedAt ? new Date(s.publishedAt).getTime() : Date.now()).filter(d => !isNaN(d));
      return {
        cleanTitle:      rt || topic,
        momentumScore:   ms,
        freshness:       fr,
        maturityStage:   maturity(ms, fr, srcs.length),
        confidenceScore: cf,
        whyTrending:     whyTrending(c, ms),
        creatorAngle:    creatorAngle(rt, srcs),
        opportunityType: opportunityType(rt + " " + c.variants.join(" ")),
        signalPlatforms: signalPlatforms(srcs),
        firstSeen:       dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : now.toISOString(),
        sourcesCount:    srcs.length,
        _rank:           ms + cf,
      };
    })
    .filter(t => t.cleanTitle.length > 2)
    .sort((a, b) => b._rank - a._rank)
    .slice(0, 12)
    .map(({ _rank, ...t }) => t);

  const opportunities = scored.length >= 1 ? scored : fallbackTrends(topic);
  const isFallback = scored.length < 1;
  const avgConf = Math.round(opportunities.reduce((a, o) => a + o.confidenceScore, 0) / opportunities.length);

  // Persist to Supabase — awaited with 4s timeout so serverless context
  // does not terminate before the write completes (void/fire-and-forget
  // is silently dropped in Vercel serverless environments).
  await Promise.race([
    persistTrendMemory(topic, opportunities, requestId, isFallback, sourcesHealthy, avgConf),
    new Promise<void>(resolve => setTimeout(resolve, 4000)),
  ]);

  return {
    success:   true,
    requestId,
    data: {
      topic,
      opportunities,
      metadata: {
        scanWindows:  ["6h", "12h", "24h", "48h", "7d"],
        sourceSpread: sourcesHealthy,
        confidence:   avgConf,
        generatedAt:  now.toISOString(),
        rateLimit:    "20/60s",
      },
    },
  };
}

// ════════════════════════════════════════════════════════════
// SERVICE METADATA (GET, no auth)
// ════════════════════════════════════════════════════════════

const GET_METADATA = {
  success:     true,
  service:     "Trend Radar Public API",
  version:     "1.1.0",
  description: "Creator-ready trend opportunities from multi-window free source scanning.",
  auth: {
    method:  "API key required for scan requests",
    headers: ["x-api-key: <your-key>", "Authorization: Bearer <your-key>"],
  },
  endpoints: {
    "GET  /api/public/trends/scan":           "Service metadata (no auth)",
    "GET  /api/public/trends/scan?topic=...": "Trend scan via query param (auth required)",
    "POST /api/public/trends/scan":           "Trend scan via JSON body (auth required)",
  },
  requestBody: {
    topic:     "string, 2-120 chars, required",
    platforms: "string[], optional, default: [youtube, instagram, facebook, tiktok]",
  },
  successEnvelope: { success: true, requestId: "string", data: { topic: "string", opportunities: "TrendOpportunity[]", metadata: "object" } },
  errorEnvelope:   { success: false, error: { code: "string", message: "string" } },
  rateLimit:       "20 requests / 60s per IP + key",
};

// ════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════

function makeRequestId(): string {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function setHeaders(res: VercelResponse): void {
  res.setHeader("Content-Type",                  "application/json");
  res.setHeader("Cache-Control",                 "no-store");
  res.setHeader("X-Content-Type-Options",        "nosniff");
  res.setHeader("X-Robots-Tag",                  "noindex");
  res.setHeader("Access-Control-Allow-Origin",   "*");
  res.setHeader("Access-Control-Allow-Methods",  "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",  "Content-Type, x-api-key, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setHeaders(res);

  // Generate once — used in both success and error responses
  const requestId = makeRequestId();

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json(err("METHOD_NOT_ALLOWED", "Only GET and POST are supported.", requestId));
  }

  // ── GET ──────────────────────────────────────────────────
  if (req.method === "GET") {
    const rawTopic = req.query.topic ?? req.query.query;
    const topicStr = typeof rawTopic === "string" ? rawTopic.trim() : "";

    if (!topicStr) return res.status(200).json(GET_METADATA);

    const auth = authenticate(req);
    if (!auth.ok) {
      if (auth.code === "rate_limited") {
        return res.status(429)
          .setHeader("Retry-After", String(auth.retryAfterSeconds ?? 60))
          .json(err("RATE_LIMITED", "Rate limit exceeded.", requestId, { retryAfterSeconds: auth.retryAfterSeconds }));
      }
      return res.status(401).json(err("UNAUTHORIZED", "Invalid or missing API key.", requestId));
    }

    const parsed = ScanRequestSchema.safeParse({ topic: topicStr });
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "Invalid topic";
      return res.status(400).json(err("INVALID_PAYLOAD", msg, requestId));
    }

    try {
      return res.status(200).json(await runScan(parsed.data.topic, parsed.data.platforms, requestId));
    } catch (e) {
      console.error("[trend-radar] GET error:", e);
      return res.status(503).json(err("TEMPORARY_UNAVAILABLE", "Scan failed. Please retry.", requestId));
    }
  }

  // ── POST ─────────────────────────────────────────────────
  const auth = authenticate(req);
  if (!auth.ok) {
    if (auth.code === "rate_limited") {
      return res.status(429)
        .setHeader("Retry-After", String(auth.retryAfterSeconds ?? 60))
        .json(err("RATE_LIMITED", "Rate limit exceeded.", requestId, { retryAfterSeconds: auth.retryAfterSeconds }));
    }
    return res.status(401).json(err("UNAUTHORIZED", "Invalid or missing API key.", requestId));
  }

  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (!ct.includes("application/json")) {
    return res.status(400).json(err("INVALID_PAYLOAD", "Content-Type must be application/json.", requestId));
  }

  let body: unknown;
  try { body = req.body ?? {}; }
  catch { return res.status(400).json(err("INVALID_PAYLOAD", "Request body is not valid JSON.", requestId)); }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "Validation failed";
    return res.status(400).json(err("INVALID_PAYLOAD", msg, requestId));
  }

  try {
    return res.status(200).json(await runScan(parsed.data.topic, parsed.data.platforms, requestId));
  } catch (e) {
    console.error("[trend-radar] POST error:", e);
    return res.status(503).json(err("TEMPORARY_UNAVAILABLE", "Scan failed. Please retry.", requestId));
  }
}
