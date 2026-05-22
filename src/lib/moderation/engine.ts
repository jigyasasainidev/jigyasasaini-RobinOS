// ============================================================
// ROBINOS AI MODERATION ENGINE
// Centralized content safety layer for all AI generation pipelines
// ============================================================
// Architecture:
//   1. moderatePrompt()  — pre-generation safety check
//   2. moderateOutput()  — post-generation output validation
//   3. detectUnsafeContent() — classify content risk
//   4. logModerationEvent() — audit trail persistence
//
// All AI generation flows MUST call moderatePrompt() before
// sending to the AI provider. moderateOutput() should be called
// on the returned content before displaying to the user.
//
// This module is provider-agnostic. It uses a tiered approach:
//   Tier 1: local keyword/pattern classifier (zero latency)
//   Tier 2: Groq-based content classification (low latency)
//   Tier 3: edge function moderation hook (async, audit only)
// ============================================================

import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────

export type ModerationCategory =
  | "NSFW"
  | "SEXUAL"
  | "MINORS"
  | "HATE_SPEECH"
  | "VIOLENCE"
  | "SELF_HARM"
  | "EXTREMISM"
  | "ILLEGAL_ACTIVITY"
  | "DEEPFAKE_ABUSE"
  | "IMPERSONATION"
  | "COPYRIGHT_ABUSE"
  | "HARASSMENT"
  | "GRAPHIC_GORE"
  | "SCAM_FRAUD"
  | "SPAM";

export type ModerationSeverity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export interface ModerationResult {
  safe: boolean;
  severity: ModerationSeverity;
  categories: ModerationCategory[];
  score: number;           // 0.0 – 1.0 (higher = more unsafe)
  reason: string;          // Human-readable explanation
  blockedAt: "PROMPT" | "OUTPUT" | "NONE";
  timestamp: string;
}

export interface ModerationEvent {
  userId: string | null;
  featureKey: string;
  contentType: "PROMPT" | "OUTPUT";
  severity: ModerationSeverity;
  categories: ModerationCategory[];
  score: number;
  truncatedContent: string;  // First 120 chars only — never store full prompts
  action: "ALLOWED" | "WARNED" | "BLOCKED";
  timestamp: string;
}

// ── Safe result (pass-through) ────────────────────────────

const SAFE_RESULT: ModerationResult = {
  safe: true,
  severity: "NONE",
  categories: [],
  score: 0,
  reason: "Content cleared safety checks",
  blockedAt: "NONE",
  timestamp: new Date().toISOString(),
};

// ── Tier 1: Local keyword/pattern classifier ──────────────
// Runs instantly, zero network calls.
// Catches obvious violations before AI call.

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; categories: ModerationCategory[]; severity: ModerationSeverity }> = [
  // Sexual / NSFW
  {
    pattern: /\b(porn|xxx|nsfw|nude|naked|sex tape|explicit sexual|adult content|onlyfans script|erotic)\b/i,
    categories: ["NSFW", "SEXUAL"],
    severity: "BLOCKED",
  },
  // Minors
  {
    pattern: /\b(child pornography|csam|underage sexual|minor explicit|lolita|jailbait)\b/i,
    categories: ["MINORS", "NSFW"],
    severity: "BLOCKED",
  },
  // Hate speech
  {
    pattern: /\b(racial slur|white supremac|neo.?nazi|ethnic cleansing|genocide script|holocaust denial)\b/i,
    categories: ["HATE_SPEECH"],
    severity: "BLOCKED",
  },
  // Violence
  {
    pattern: /\b(how to kill|mass shooting script|bomb making|torture guide|murder manual)\b/i,
    categories: ["VIOLENCE", "ILLEGAL_ACTIVITY"],
    severity: "BLOCKED",
  },
  // Self-harm
  {
    pattern: /\b(suicide method|self harm guide|how to cut yourself|overdose instructions)\b/i,
    categories: ["SELF_HARM"],
    severity: "BLOCKED",
  },
  // Extremism
  {
    pattern: /\b(terrorist recruitment|jihad propaganda|isis content|radicalization script)\b/i,
    categories: ["EXTREMISM", "ILLEGAL_ACTIVITY"],
    severity: "BLOCKED",
  },
  // Deepfake / impersonation
  {
    pattern: /\b(deepfake script|fake video of \w+|impersonate celebrity|fake news about)\b/i,
    categories: ["DEEPFAKE_ABUSE", "IMPERSONATION"],
    severity: "HIGH",
  },
  // Scam / fraud
  {
    pattern: /\b(phishing script|scam people|fraud scheme|pyramid scheme script|ponzi)\b/i,
    categories: ["SCAM_FRAUD"],
    severity: "BLOCKED",
  },
  // Harassment
  {
    pattern: /\b(harassment campaign|doxing|swatting|bully \w+ script|stalking content)\b/i,
    categories: ["HARASSMENT"],
    severity: "HIGH",
  },
];

// Medium severity — warn but allow with logging
const WARN_PATTERNS: Array<{ pattern: RegExp; categories: ModerationCategory[] }> = [
  {
    pattern: /\b(controversial|graphic|disturbing|violent content|dark humor|offensive)\b/i,
    categories: ["VIOLENCE"],
  },
  {
    pattern: /\b(copyright|trademark|brand script|replica of|knockoff)\b/i,
    categories: ["COPYRIGHT_ABUSE"],
  },
];

function runLocalClassifier(content: string): ModerationResult {
  const text = content.toLowerCase();

  // Check blocked patterns first
  for (const rule of BLOCKED_PATTERNS) {
    if (rule.pattern.test(text)) {
      return {
        safe: false,
        severity: rule.severity,
        categories: rule.categories,
        score: rule.severity === "BLOCKED" ? 1.0 : 0.8,
        reason: `Content matches prohibited pattern: ${rule.categories.join(", ")}`,
        blockedAt: "PROMPT",
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Check warn patterns
  for (const rule of WARN_PATTERNS) {
    if (rule.pattern.test(text)) {
      return {
        safe: true,
        severity: "LOW",
        categories: rule.categories,
        score: 0.3,
        reason: `Content flagged for review: ${rule.categories.join(", ")}`,
        blockedAt: "NONE",
        timestamp: new Date().toISOString(),
      };
    }
  }

  return { ...SAFE_RESULT, timestamp: new Date().toISOString() };
}

// ── Public API ─────────────────────────────────────────────

/**
 * moderatePrompt()
 * Call BEFORE sending any user input to an AI provider.
 * Returns immediately (uses local classifier only in client context).
 */
export function moderatePrompt(prompt: string): ModerationResult {
  if (!prompt || prompt.trim().length === 0) {
    return { ...SAFE_RESULT, timestamp: new Date().toISOString() };
  }

  const result = runLocalClassifier(prompt);

  // Log asynchronously — never block generation on logging
  if (result.severity !== "NONE" && result.severity !== "LOW") {
    void logModerationEvent({
      userId: null, // populated by callers that have user context
      featureKey: "prompt_moderation",
      contentType: "PROMPT",
      severity: result.severity,
      categories: result.categories,
      score: result.score,
      truncatedContent: prompt.slice(0, 120),
      action: result.safe ? "WARNED" : "BLOCKED",
      timestamp: result.timestamp,
    });
  }

  return result;
}

/**
 * moderateOutput()
 * Call AFTER receiving AI-generated content, before displaying.
 * Catches jailbreak outputs that bypassed prompt filtering.
 */
export function moderateOutput(output: string): ModerationResult {
  if (!output || output.trim().length === 0) {
    return { ...SAFE_RESULT, timestamp: new Date().toISOString() };
  }

  const result = runLocalClassifier(output);
  const finalResult = { ...result, blockedAt: result.safe ? "NONE" : "OUTPUT" } as ModerationResult;

  if (finalResult.severity !== "NONE" && finalResult.severity !== "LOW") {
    void logModerationEvent({
      userId: null,
      featureKey: "output_moderation",
      contentType: "OUTPUT",
      severity: finalResult.severity,
      categories: finalResult.categories,
      score: finalResult.score,
      truncatedContent: output.slice(0, 120),
      action: finalResult.safe ? "WARNED" : "BLOCKED",
      timestamp: finalResult.timestamp,
    });
  }

  return finalResult;
}

/**
 * detectUnsafeContent()
 * Classify content risk without blocking. Use for analytics.
 */
export function detectUnsafeContent(content: string): {
  unsafe: boolean;
  categories: ModerationCategory[];
  score: number;
} {
  const result = runLocalClassifier(content);
  return {
    unsafe: !result.safe || result.severity === "HIGH" || result.severity === "BLOCKED",
    categories: result.categories,
    score: result.score,
  };
}

/**
 * logModerationEvent()
 * Persist moderation events to the database for audit trail.
 * Non-blocking — fires and forgets.
 */
export async function logModerationEvent(event: ModerationEvent): Promise<void> {
  try {
    await (supabase as any).from("moderation_events").insert({
      user_id: event.userId,
      feature_key: event.featureKey,
      content_type: event.contentType,
      severity: event.severity,
      categories: event.categories,
      score: event.score,
      truncated_content: event.truncatedContent,
      action: event.action,
      created_at: event.timestamp,
    });
  } catch {
    // Moderation logging is non-fatal — never block generation
    if (import.meta.env.DEV) {
      console.debug("[Moderation] Log write skipped (table may not exist yet)");
    }
  }
}

/**
 * getModerationBlockMessage()
 * Returns the user-facing message when content is blocked.
 */
export function getModerationBlockMessage(categories: ModerationCategory[]): string {
  if (categories.includes("MINORS")) {
    return "This request cannot be processed. Content involving minors violates our platform policies.";
  }
  if (categories.includes("NSFW") || categories.includes("SEXUAL")) {
    return "This request was blocked. RobinOS does not generate NSFW or sexually explicit content.";
  }
  if (categories.includes("HATE_SPEECH")) {
    return "This request was blocked. Hateful, discriminatory, or extremist content is prohibited.";
  }
  if (categories.includes("SELF_HARM")) {
    return "This request was blocked. Content that promotes or facilitates self-harm is prohibited.";
  }
  if (categories.includes("VIOLENCE") || categories.includes("EXTREMISM")) {
    return "This request was blocked. Violent, threatening, or extremist content is not permitted.";
  }
  if (categories.includes("SCAM_FRAUD")) {
    return "This request was blocked. Fraudulent, deceptive, or scam-related content is prohibited.";
  }
  if (categories.includes("ILLEGAL_ACTIVITY")) {
    return "This request was blocked. Content that facilitates illegal activity violates our policies.";
  }
  return "This request was blocked by our content safety system. Please review our Acceptable Use Policy.";
}
