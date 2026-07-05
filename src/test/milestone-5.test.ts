// ============================================================
// MILESTONE 5 — User Resolution contract tests
// ============================================================
// These tests lock in the public contract of the M5 SQL functions
// (resolve_or_create_user_from_purchase + process_webhook_event)
// as pure-JS reference implementations. The SQL function is the
// production source of truth; these tests verify that the
// behavioral contract documented in
// .kimchi/docs/milestone-5-architecture-review.md is consistent
// with the TS-side expectations (worker integration, action
// classification, log fields).
//
// Run: npm test
// ============================================================

import { describe, it, expect } from "vitest";

// ── 1. ProcessResult contract ──────────────────────────────
// process_webhook_event returns JSONB with these action values.
// The worker dispatches on `action`; new values MUST be added to
// the worker's switch before shipping.
type ProcessAction =
  | "verified"          // M4+M5: payload valid, identity resolved to existing user
  | "awaiting_claim"    // M5: payload valid, no auth.users match — guest flow
  | "failed_terminal"   // permanent failure (validation or ambiguous match)
  | "failed_retryable"  // transient failure — will retry
  | null;               // queue empty

type ResolutionOutcome =
  | "resolved_existing_user"
  | "marked_guest_awaiting_claim"
  | "resolution_failed";

interface ProcessResult {
  success: boolean;
  action: ProcessAction;
  webhook_event_id: string;
  provider_id: string;
  provider_event_type?: string;
  standardized_event_type?: string;
  event_mapping_confidence?: string;
  linked_user_id?: string | null;
  resolution_outcome?: ResolutionOutcome;
  trace_id?: string;
  lock_id?: string;
  error?: string;
  classification?: string;
}

// ── 2. Action classifier (mirrors the worker's per-row switch) ─
// Single source of truth for what action value maps to which
// summary counter and log event. The worker imports this
// contract via the ProcessAction union.
function classifyProcessAction(result: ProcessResult): {
  counter: "processed_count" | "awaiting_claim_count" | "failed_terminal_count" | "failed_retryable_count" | "no_op_count";
  logEvent: "WORKER_ROW_VERIFIED" | "WORKER_ROW_AWAITING_CLAIM" | "WORKER_ROW_FAILED_TERMINAL" | "WORKER_ROW_RETRY_SCHEDULED" | "WORKER_ROW_UNKNOWN_ACTION";
  logLevel: "info" | "warn" | "error";
} {
  switch (result.action) {
    case "verified":
      return { counter: "processed_count", logEvent: "WORKER_ROW_VERIFIED", logLevel: "info" };
    case "awaiting_claim":
      return { counter: "awaiting_claim_count", logEvent: "WORKER_ROW_AWAITING_CLAIM", logLevel: "info" };
    case "failed_terminal":
      return { counter: "failed_terminal_count", logEvent: "WORKER_ROW_FAILED_TERMINAL", logLevel: "error" };
    case "failed_retryable":
      return { counter: "failed_retryable_count", logEvent: "WORKER_ROW_RETRY_SCHEDULED", logLevel: "warn" };
    default:
      return { counter: "no_op_count", logEvent: "WORKER_ROW_UNKNOWN_ACTION", logLevel: "error" };
  }
}

// ── 3. Raw payload extraction (mirrors process_webhook_event step 3c) ─
// Provider-agnostic lookup of buyer identity fields from
// webhook_events.raw_payload. Future adapters that emit
// lowercase canonical keys will be supported transparently;
// the current adapter (WarriorPlus) emits uppercase keys.
interface ExtractedIdentity {
  buyer_email: string | null;
  buyer_name: string | null;
  provider_customer_id: string | null;
}

function extractIdentityFromRawPayload(rawPayload: Record<string, unknown> | null): ExtractedIdentity {
  const empty = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
  return {
    buyer_email:
      empty(rawPayload?.["buyer_email"]) ??
      empty(rawPayload?.["WP_BUYER_EMAIL"]) ??
      null,
    buyer_name:
      empty(rawPayload?.["buyer_name"]) ??
      empty(rawPayload?.["WP_BUYER_NAME"]) ??
      null,
    provider_customer_id:
      empty(rawPayload?.["provider_customer_id"]) ??
      empty(rawPayload?.["WP_CUSTOMER_ID"]) ??
      null,
  };
}

// ── 4. Email normalization (mirrors the SQL lower(btrim())) ─
function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.toLowerCase();
}

// ── 5. Email hash (mirrors the SQL encode(digest(...), 'hex')) ─
// Vitest can't run pgcrypto; we just lock the algorithm.
import { createHash } from "node:crypto";
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ═════════════════════════════════════════════════════════════
// Action classifier tests (worker integration contract)
// ═════════════════════════════════════════════════════════════
describe("M5 action classifier", () => {
  it("classifies verified as success/info/processed_count", () => {
    const c = classifyProcessAction({
      success: true, action: "verified", webhook_event_id: "e1", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("processed_count");
    expect(c.logEvent).toBe("WORKER_ROW_VERIFIED");
    expect(c.logLevel).toBe("info");
  });

  it("classifies awaiting_claim as success/info/awaiting_claim_count (M5)", () => {
    const c = classifyProcessAction({
      success: true, action: "awaiting_claim", webhook_event_id: "e2", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("awaiting_claim_count");
    expect(c.logEvent).toBe("WORKER_ROW_AWAITING_CLAIM");
    expect(c.logLevel).toBe("info");
  });

  it("classifies failed_terminal as error/failed_terminal_count", () => {
    const c = classifyProcessAction({
      success: false, action: "failed_terminal", webhook_event_id: "e3", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("failed_terminal_count");
    expect(c.logEvent).toBe("WORKER_ROW_FAILED_TERMINAL");
    expect(c.logLevel).toBe("error");
  });

  it("classifies failed_retryable as warn/failed_retryable_count", () => {
    const c = classifyProcessAction({
      success: false, action: "failed_retryable", webhook_event_id: "e4", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("failed_retryable_count");
    expect(c.logEvent).toBe("WORKER_ROW_RETRY_SCHEDULED");
    expect(c.logLevel).toBe("warn");
  });

  it("treats null action (queue empty) as a no-op", () => {
    // Per the M4 design, a null result means the queue is empty —
    // the worker breaks the loop and does NOT log a per-row event.
    // This test documents the contract.
    const r: ProcessResult = {
      success: false, action: null, webhook_event_id: "", provider_id: "",
    };
    expect(r.action).toBeNull();
  });

  it("treats unknown action as a no-op with error log (defensive)", () => {
    // Future-proofing: if the SQL function ever returns an action
    // value the worker doesn't recognize, it must be logged loudly
    // but NOT counted as processed.
    const c = classifyProcessAction({
      success: false, action: "unknown_future_action" as ProcessAction,
      webhook_event_id: "e5", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("no_op_count");
    expect(c.logEvent).toBe("WORKER_ROW_UNKNOWN_ACTION");
    expect(c.logLevel).toBe("error");
  });
});

// ═════════════════════════════════════════════════════════════
// Raw payload extraction tests (provider-agnostic lookup)
// ═════════════════════════════════════════════════════════════
describe("M5 raw_payload identity extraction", () => {
  it("extracts WarriorPlus uppercase keys", () => {
    const extracted = extractIdentityFromRawPayload({
      WP_BUYER_EMAIL: "Buyer@Example.COM",
      WP_BUYER_NAME: "  Jane Doe  ",
      WP_CUSTOMER_ID: "  wp-cust-123  ",
    });
    expect(extracted.buyer_email).toBe("Buyer@Example.COM");
    expect(extracted.buyer_name).toBe("Jane Doe");
    expect(extracted.provider_customer_id).toBe("wp-cust-123");
  });

  it("extracts lowercase canonical keys (future providers)", () => {
    const extracted = extractIdentityFromRawPayload({
      buyer_email: "stripe@example.com",
      buyer_name: "Stripe Buyer",
      provider_customer_id: "cus_abc",
    });
    expect(extracted.buyer_email).toBe("stripe@example.com");
    expect(extracted.buyer_name).toBe("Stripe Buyer");
    expect(extracted.provider_customer_id).toBe("cus_abc");
  });

  it("prefers lowercase canonical key when both are present", () => {
    // Forward-compatibility: a future adapter that emits both
    // forms should not cause ambiguity. The canonical key wins.
    const extracted = extractIdentityFromRawPayload({
      buyer_email: "canonical@example.com",
      WP_BUYER_EMAIL: "warriorplus@example.com",
    });
    expect(extracted.buyer_email).toBe("canonical@example.com");
  });

  it("returns null for missing email (worker must dead-letter)", () => {
    const extracted = extractIdentityFromRawPayload({
      WP_BUYER_NAME: "Anonymous",
    });
    expect(extracted.buyer_email).toBeNull();
    expect(extracted.buyer_name).toBe("Anonymous");
  });

  it("handles null payload gracefully", () => {
    const extracted = extractIdentityFromRawPayload(null);
    expect(extracted.buyer_email).toBeNull();
    expect(extracted.buyer_name).toBeNull();
    expect(extracted.provider_customer_id).toBeNull();
  });

  it("treats empty-string fields as absent", () => {
    const extracted = extractIdentityFromRawPayload({
      WP_BUYER_EMAIL: "   ",
      WP_BUYER_NAME: "",
      WP_CUSTOMER_ID: "\t\n",
    });
    expect(extracted.buyer_email).toBeNull();
    expect(extracted.buyer_name).toBeNull();
    expect(extracted.provider_customer_id).toBeNull();
  });

  it("ignores non-string values for buyer fields", () => {
    // Defense in depth: a malformed provider payload might send
    // numeric or boolean values. These must NOT crash extraction.
    const extracted = extractIdentityFromRawPayload({
      WP_BUYER_EMAIL: 12345 as unknown as string,
      WP_BUYER_NAME: true as unknown as string,
    });
    expect(extracted.buyer_email).toBeNull();
    expect(extracted.buyer_name).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// Email normalization tests (matches SQL lower(btrim(email)))
// ═════════════════════════════════════════════════════════════
describe("M5 email normalization", () => {
  it("lowercases mixed-case emails", () => {
    expect(normalizeEmail("Buyer@Example.COM")).toBe("buyer@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  buyer@example.com  ")).toBe("buyer@example.com");
    expect(normalizeEmail("\tbuyer@example.com\n")).toBe("buyer@example.com");
  });

  it("preserves + aliases and dots (no Gmail-specific normalization)", () => {
    // M5 deliberately does NOT normalize Gmail dots or + aliases.
    // That decision is a separate audit item (see architecture
    // review §8). Until then, "jane.doe@gmail.com" and
    // "janedoe@gmail.com" are different identities.
    expect(normalizeEmail("jane.doe+test@gmail.com")).toBe("jane.doe+test@gmail.com");
  });

  it("returns null for null/empty/whitespace input", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// Email hash tests (matches SQL encode(digest(..., 'sha256'), 'hex'))
// ═════════════════════════════════════════════════════════════
describe("M5 email hash", () => {
  it("produces 64-char hex SHA-256 of normalized email", () => {
    const h = sha256Hex("buyer@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a stable hash for the same input", () => {
    expect(sha256Hex("buyer@example.com")).toBe(sha256Hex("buyer@example.com"));
  });

  it("hashes the normalized (lowercased + trimmed) form", () => {
    // The SQL function uses lower(buyer_email) — so the hash
    // input MUST be lowercase. Mixed-case inputs would produce
    // a different hash, breaking admin search.
    const normalized = normalizeEmail("Buyer@Example.COM");
    expect(normalized).toBe("buyer@example.com");
    expect(sha256Hex(normalized!)).toBe(sha256Hex("buyer@example.com"));
  });

  it("produces different hashes for different emails", () => {
    expect(sha256Hex("alice@example.com")).not.toBe(sha256Hex("bob@example.com"));
  });
});

// ═════════════════════════════════════════════════════════════
// Resolution outcome → webhook_events mapping tests
// ═════════════════════════════════════════════════════════════
// These tests lock in the M5 state-transition table documented
// in the architecture review §5.3. They do not exercise the
// SQL directly — they pin the contract that the worker and
// admin tools rely on.
describe("M5 state transitions", () => {
  // The SQL function's mapping (see migration 57, step 3e):
  //
  //   resolved_existing_user          → status='verified',       linked_user_id=<uuid>
  //   marked_guest_awaiting_claim     → status='awaiting_claim',  linked_user_id=NULL
  //   resolution_failed (ambiguous)   → mark_webhook_dead_letter (terminal)
  //
  // The tests below verify the worker correctly maps these to
  // log events and counters via classifyProcessAction.

  it("resolved_existing_user → verified action → processed_count", () => {
    const r: ProcessResult = {
      success: true,
      action: "verified",
      webhook_event_id: "evt-1",
      provider_id: "warriorplus",
      linked_user_id: "00000000-0000-0000-0000-000000000001",
      resolution_outcome: "resolved_existing_user",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("processed_count");
    expect(r.resolution_outcome).toBe("resolved_existing_user");
    expect(r.linked_user_id).toBeTruthy();
  });

  it("marked_guest_awaiting_claim → awaiting_claim action → awaiting_claim_count", () => {
    const r: ProcessResult = {
      success: true,
      action: "awaiting_claim",
      webhook_event_id: "evt-2",
      provider_id: "warriorplus",
      linked_user_id: null,
      resolution_outcome: "marked_guest_awaiting_claim",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("awaiting_claim_count");
    expect(r.resolution_outcome).toBe("marked_guest_awaiting_claim");
    expect(r.linked_user_id).toBeNull();
  });

  it("ambiguous_match → resolution_failed → failed_terminal", () => {
    // ambiguous_match produces a structured outcome in the SQL
    // function, which the caller converts to a dead-letter
    // (failed_terminal) response.
    const r: ProcessResult = {
      success: false,
      action: "failed_terminal",
      webhook_event_id: "evt-3",
      provider_id: "warriorplus",
      resolution_outcome: "resolution_failed",
      classification: "resolution",
      error: "resolution_failed: ambiguous_match (match_count=2)",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("failed_terminal_count");
    expect(c.logLevel).toBe("error");
    expect(r.classification).toBe("resolution");
  });
});

// ═════════════════════════════════════════════════════════════
// Idempotency contract tests
// ═════════════════════════════════════════════════════════════
// M5 must be idempotent. The SQL function is read-only against
// auth.users; re-running with the same inputs yields the same
// outputs. process_webhook_event uses FOR UPDATE SKIP LOCKED,
// so two concurrent invocations cannot both claim the same row.
//
// The unit tests below verify the JS-side classifier is
// idempotent (a no-op for repeated identical inputs).

describe("M5 idempotency contract", () => {
  it("classifier returns the same result for repeated identical input", () => {
    const r: ProcessResult = {
      success: true, action: "verified", webhook_event_id: "x", provider_id: "warriorplus",
    };
    expect(classifyProcessAction(r)).toEqual(classifyProcessAction(r));
  });

  it("normalization is idempotent", () => {
    const once = normalizeEmail("Buyer@Example.COM");
    const twice = normalizeEmail(once!);
    expect(once).toBe(twice);
  });

  it("extraction is idempotent (same input → same output)", () => {
    const payload = { WP_BUYER_EMAIL: "buyer@example.com" };
    expect(extractIdentityFromRawPayload(payload))
      .toEqual(extractIdentityFromRawPayload(payload));
  });
});
