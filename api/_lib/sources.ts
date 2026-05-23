// ============================================================
// TREND RADAR — Free Source Adapters
// Sources: YouTube RSS, Reddit JSON, Google News RSS
// All are truly public — no API keys required.
// ============================================================

import { fetchText, fetchJson } from "./fetch.js";

export interface RawSignal {
  text: string;        // raw phrase / title
  source: string;      // "youtube" | "reddit" | "google_news"
  url?: string;
  publishedAt?: string;
  score?: number;      // upvotes, views estimate, etc.
}

export interface SourceResult {
  signals: RawSignal[];
  healthy: boolean;    // true = fetched OK, false = failed/partial
  source: string;
}

// ── XML helpers ────────────────────────────────────────────

function extractXmlTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  // Handle CDATA and plain text content
  const regex = new RegExp(`<${tag}[^>]*>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const val = match[1].trim();
    if (val) results.push(val);
  }
  return results;
}

function extractXmlAttr(xml: string, tag: string, attr: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

// ── YouTube RSS (no key needed) ────────────────────────────
// Uses YouTube search via RSS/Atom feed — fully public.
// Limited to ~15 results but zero auth required.

const YT_SEARCH_RSS = (q: string) =>
  `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(q)}`;

export async function fetchYouTube(query: string): Promise<SourceResult> {
  const result = await fetchText(YT_SEARCH_RSS(query), 7000);
  if (!result.ok) return { signals: [], healthy: false, source: "youtube" };

  const titles   = extractXmlTags(result.data, "title");
  const pubDates = extractXmlTags(result.data, "published");

  const signals: RawSignal[] = titles
    .slice(1) // skip feed title
    .slice(0, 20)
    .map((title, i) => ({
      text:        title,
      source:      "youtube",
      publishedAt: pubDates[i + 1] ?? undefined,
    }))
    .filter((s) => s.text.length > 4);

  return { signals, healthy: signals.length > 0, source: "youtube" };
}

// ── Reddit JSON API (no key needed) ───────────────────────
// Uses Reddit's public .json endpoint — no auth for read.

const REDDIT_SEARCH = (q: string) =>
  `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=hot&t=week&limit=25`;

interface RedditPost {
  title: string;
  url: string;
  score: number;
  subreddit: string;
  created_utc: number;
  num_comments: number;
}

interface RedditResponse {
  data?: {
    children?: Array<{ data: RedditPost }>;
  };
}

export async function fetchReddit(query: string): Promise<SourceResult> {
  const result = await fetchJson<RedditResponse>(REDDIT_SEARCH(query), {
    headers: { "User-Agent": "TrendRadar/1.0 (research bot)" },
  }, 7000);

  if (!result.ok) return { signals: [], healthy: false, source: "reddit" };

  const posts = result.data?.data?.children ?? [];
  const signals: RawSignal[] = posts
    .filter((c) => c.data?.title)
    .map((c) => ({
      text:        c.data.title,
      source:      "reddit",
      url:         `https://reddit.com${c.data.url}`,
      publishedAt: c.data.created_utc
        ? new Date(c.data.created_utc * 1000).toISOString()
        : undefined,
      score: (c.data.score ?? 0) + (c.data.num_comments ?? 0) * 2,
    }));

  return { signals, healthy: signals.length > 0, source: "reddit" };
}

// ── Google News RSS (no key needed) ───────────────────────
// Uses Google News RSS feed — fully public.

const GOOGLE_NEWS_RSS = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export async function fetchGoogleNews(query: string): Promise<SourceResult> {
  const result = await fetchText(GOOGLE_NEWS_RSS(query), 7000);
  if (!result.ok) return { signals: [], healthy: false, source: "google_news" };

  const titles   = extractXmlTags(result.data, "title");
  const pubDates = extractXmlTags(result.data, "pubDate");

  const signals: RawSignal[] = titles
    .slice(1) // skip channel title
    .slice(0, 20)
    .map((title, i) => ({
      text:        title,
      source:      "google_news",
      publishedAt: pubDates[i] ?? undefined,
    }))
    .filter((s) => s.text.length > 4 && !s.text.toLowerCase().includes("google news"));

  return { signals, healthy: signals.length > 0, source: "google_news" };
}

// ── Google Trends RSS (no key needed) ─────────────────────
// Broader trending context — not query-specific, but signals what's hot globally.
// Used to boost confidence when query terms appear here too.

const GOOGLE_TRENDS_RSS = `https://trends.google.com/trending/rss?geo=US`;

export async function fetchGoogleTrends(): Promise<SourceResult> {
  const result = await fetchText(GOOGLE_TRENDS_RSS, 6000);
  if (!result.ok) return { signals: [], healthy: false, source: "google_trends" };

  const titles = extractXmlTags(result.data, "title");

  const signals: RawSignal[] = titles
    .slice(1)
    .slice(0, 30)
    .map((title) => ({ text: title, source: "google_trends" }))
    .filter((s) => s.text.length > 2);

  return { signals, healthy: signals.length > 0, source: "google_trends" };
}

// ── Run all sources in parallel ────────────────────────────
export async function fetchAllSources(query: string): Promise<{
  results: SourceResult[];
  sourcesHealthy: number;
  sourcesPartial: number;
}> {
  const [yt, reddit, gnews, gtrends] = await Promise.allSettled([
    fetchYouTube(query),
    fetchReddit(query),
    fetchGoogleNews(query),
    fetchGoogleTrends(),
  ]);

  const results: SourceResult[] = [yt, reddit, gnews, gtrends].map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { signals: [], healthy: false, source: "unknown" }
  );

  const sourcesHealthy = results.filter((r) => r.healthy).length;
  const sourcesPartial = results.filter((r) => !r.healthy).length;

  return { results, sourcesHealthy, sourcesPartial };
}
