// ============================================================
// TREND RADAR — Pipeline Unit Tests
// Run: npm test (vitest)
// ============================================================

import { describe, it, expect } from "vitest";
import {
  normalizePhrase,
  toReadableTitle,
  clusterSignals,
  scoreMomentum,
  deriveFreshness,
  deriveMaturity,
  classifyOpportunity,
} from "../pipeline.js";
import type { RawSignal } from "../sources.js";

// ── normalizePhrase ────────────────────────────────────────
describe("normalizePhrase", () => {
  it("strips URLs", () => {
    expect(normalizePhrase("Check https://example.com now")).not.toContain("http");
  });

  it("strips Reddit handles", () => {
    expect(normalizePhrase("r/fitness posted this")).not.toContain("r/fitness");
  });

  it("removes stop words", () => {
    const result = normalizePhrase("the best way to learn ai tools");
    expect(result).not.toContain(" the ");
    expect(result).toContain("learn");
    expect(result).toContain("tools");
  });

  it("handles empty string", () => {
    expect(normalizePhrase("")).toBe("");
  });
});

// ── toReadableTitle ────────────────────────────────────────
describe("toReadableTitle", () => {
  it("title-cases each word", () => {
    expect(toReadableTitle("ai generated football edits")).toBe("Ai Generated Football Edits");
  });

  it("handles single word", () => {
    expect(toReadableTitle("viral")).toBe("Viral");
  });
});

// ── clusterSignals ─────────────────────────────────────────
describe("clusterSignals", () => {
  it("groups semantically similar signals", () => {
    const signals: RawSignal[] = [
      { text: "ai tools for content creators workflow",  source: "youtube" },
      { text: "best ai tools content workflow 2025",     source: "reddit" },
      { text: "Python tutorial for beginners",           source: "google_news" },
    ];
    const clusters = clusterSignals(signals);
    // The two AI tools signals should cluster together
    const aiCluster = clusters.find((c) =>
      c.signals.some((s) => s.text.includes("ai tools"))
    );
    expect(aiCluster).toBeDefined();
    expect(aiCluster!.signals.length).toBe(2);
  });

  it("keeps distinct topics separate", () => {
    const signals: RawSignal[] = [
      { text: "yoga morning routine stretching",   source: "youtube" },
      { text: "bitcoin price crash market 2025",   source: "reddit" },
    ];
    const clusters = clusterSignals(signals);
    expect(clusters.length).toBe(2);
  });
});

// ── scoreMomentum ──────────────────────────────────────────
describe("scoreMomentum", () => {
  it("returns 0-100", () => {
    const now = new Date().toISOString();
    const cluster = {
      key: "viral trend",
      variants: ["viral trend"],
      signals: [
        { text: "viral trend", source: "youtube", publishedAt: now, score: 500 },
        { text: "viral trend", source: "reddit",  publishedAt: now, score: 200 },
        { text: "viral trend", source: "google_news", publishedAt: now },
      ],
    };
    const score = scoreMomentum(cluster);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("gives higher score for more sources", () => {
    const now = new Date().toISOString();
    const oneSource  = { key: "trend", variants: ["trend"], signals: [{ text: "trend", source: "youtube", publishedAt: now }] };
    const threeSources = {
      key: "trend", variants: ["trend"],
      signals: [
        { text: "trend", source: "youtube",      publishedAt: now },
        { text: "trend", source: "reddit",       publishedAt: now },
        { text: "trend", source: "google_news",  publishedAt: now },
      ],
    };
    expect(scoreMomentum(threeSources)).toBeGreaterThan(scoreMomentum(oneSource));
  });
});

// ── deriveFreshness ────────────────────────────────────────
describe("deriveFreshness", () => {
  it("returns 6h for very recent signals", () => {
    const recent = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1h ago
    const cluster = { key: "test", variants: ["test"], signals: [{ text: "test", source: "youtube", publishedAt: recent }] };
    expect(deriveFreshness(cluster)).toBe("6h");
  });

  it("returns 7d for old signals", () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(); // 3 days ago
    const cluster = { key: "test", variants: ["test"], signals: [{ text: "test", source: "youtube", publishedAt: old }] };
    expect(deriveFreshness(cluster)).toBe("7d");
  });
});

// ── deriveMaturity ─────────────────────────────────────────
describe("deriveMaturity", () => {
  it("classifies Hot correctly", () => {
    expect(deriveMaturity(80, "6h", 4)).toBe("Hot");
  });

  it("classifies Early for low momentum", () => {
    expect(deriveMaturity(25, "24h", 1)).toBe("Early");
  });

  it("classifies Dying for old low-momentum", () => {
    expect(deriveMaturity(15, "7d", 1)).toBe("Dying");
  });
});

// ── classifyOpportunity ────────────────────────────────────
describe("classifyOpportunity", () => {
  it("detects Tutorial", () => {
    expect(classifyOpportunity("How to start investing in 2025")).toBe("Tutorial");
  });

  it("detects Explainer", () => {
    expect(classifyOpportunity("What is AI-generated content explained")).toBe("Explainer");
  });

  it("detects Reaction", () => {
    expect(classifyOpportunity("My reaction to viral football edit")).toBe("Reaction");
  });

  it("detects Breakdown", () => {
    expect(classifyOpportunity("Full breakdown of the crypto crash")).toBe("Breakdown");
  });
});

// ── Auth + Schema validation ───────────────────────────────
import { ScanRequestSchema } from "../schema.js";

describe("ScanRequestSchema", () => {
  it("rejects empty query", () => {
    const result = ScanRequestSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("validates correct request", () => {
    const result = ScanRequestSchema.safeParse({ query: "AI tools", platforms: ["youtube", "tiktok"] });
    expect(result.success).toBe(true);
  });

  it("rejects query over 120 chars", () => {
    const result = ScanRequestSchema.safeParse({ query: "a".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("defaults platforms to all when omitted", () => {
    const result = ScanRequestSchema.safeParse({ query: "fitness" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platforms).toEqual(["youtube", "instagram", "facebook", "tiktok"]);
    }
  });

  it("rejects invalid platform name", () => {
    const result = ScanRequestSchema.safeParse({ query: "test", platforms: ["snapchat"] });
    expect(result.success).toBe(false);
  });
});
