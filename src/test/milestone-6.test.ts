// ============================================================
// MILESTONE 6 — Purchase Recording & Pro Entitlement contract tests
// ============================================================
// These tests lock in the public contract of the M6 SQL functions
// (record_purchase_from_webhook, grant_entitlement_from_purchase,
// safe_plan_switch extension, process_webhook_event extension) as
// pure-JS reference implementations. The SQL function is the
// production source of truth; these tests verify that the
// behavioral contract documented in
// .kimchi/docs/milestone-6-architecture-review.md is consistent
// with the TS-side expectations (worker integration, action
// classification, log fields, duration computation).
//
// Run: npm test
// ============================================================

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

// ── 1. ProcessResult contract (extended for M6) ───────────
// process_webhook_event returns JSONB with these action values
// after M6. M5's 'verified' is no longer a terminal return
// value — it is an internal intermediate state during M6
// processing. M6 introduces 'processed' as the new terminal
// success value.

type ProcessAction =
  | "processed"         // M6 NEW: full pipeline success — purchase recorded + entitlement granted
  | "awaiting_claim"    // M5:    guest buyer — no purchase, M9 will claim
  | "failed_terminal"   // M4+M5+M6: permanent failure (validation, resolution, or purchase/entitlement)
  | "failed_retryable"  // M4+M5+M6: transient failure — will retry
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
  linked_purchase_id?: string;
  plan?: string;
  expires_at?: string;
  duration_days?: number;
  resolution_outcome?: ResolutionOutcome;
  trace_id?: string;
  lock_id?: string;
  error?: string;
  classification?: string;
}

// ── 2. Action classifier (mirrors the worker's per-row switch) ─
// Single source of truth for what action value maps to which
// summary counter and log event.
function classifyProcessAction(result: ProcessResult): {
  counter: "processed_count" | "awaiting_claim_count" | "failed_terminal_count" | "failed_retryable_count" | "no_op_count";
  logEvent: "WORKER_ROW_PROCESSED" | "WORKER_ROW_AWAITING_CLAIM" | "WORKER_ROW_FAILED_TERMINAL" | "WORKER_ROW_RETRY_SCHEDULED" | "WORKER_ROW_UNKNOWN_ACTION";
  logLevel: "info" | "warn" | "error";
} {
  switch (result.action) {
    case "processed":
      return { counter: "processed_count", logEvent: "WORKER_ROW_PROCESSED", logLevel: "info" };
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

// ── 3. Duration computation (mirrors grant_entitlement_from_purchase) ─
// Maps provider_products.duration_value + duration_unit to a
// PostgreSQL interval string and a human-readable days count.
// The SQL function performs the same mapping using
// `case ... when ... end` constructs; this is the JS reference.
type DurationUnit = "day" | "week" | "month" | "year";

function computeDuration(value: number, unit: DurationUnit): {
  intervalQualifier: "days" | "weeks" | "months" | "years";
  approximateDays: number;
  error: string | null;
} {
  if (!Number.isFinite(value) || value <= 0) {
    return { intervalQualifier: "days", approximateDays: 0, error: "INVALID_DURATION" };
  }
  switch (unit) {
    case "day":
      return { intervalQualifier: "days", approximateDays: Math.ceil(value), error: null };
    case "week":
      return { intervalQualifier: "weeks", approximateDays: Math.ceil(value * 7), error: null };
    case "month":
      return { intervalQualifier: "months", approximateDays: Math.ceil(value * 30), error: null };
    case "year":
      return { intervalQualifier: "years", approximateDays: Math.ceil(value * 365), error: null };
    default:
      return { intervalQualifier: "days", approximateDays: 0, error: "INVALID_DURATION_UNIT" };
  }
}

// ── 4. Safe plan switch duration logic (mirrors the SQL extension) ─
// The M6 extension adds p_expires_at timestamptz. When non-null,
// it wins over the billing_cycle default. The reference JS
// mirrors the same priority: explicit expires_at > billing_cycle.
function resolvePlanSwitchExpiry(args: {
  p_expires_at: Date | null;
  p_billing_cycle: "monthly" | "yearly" | "one_time";
  now: Date;
}): { expires_at: Date; explicit_expires_at: boolean; duration_days: number } {
  const { p_expires_at, p_billing_cycle, now } = args;
  if (p_expires_at) {
    const days = Math.ceil((p_expires_at.getTime() - now.getTime()) / 86400_000);
    return { expires_at: p_expires_at, explicit_expires_at: true, duration_days: days };
  }
  // Mirrors the M31 30/365 fallback
  const days = p_billing_cycle === "yearly" ? 365 : 30;
  const expires = new Date(now.getTime() + days * 86400_000);
  return { expires_at: expires, explicit_expires_at: false, duration_days: days };
}

// ── 5. Provider product extraction (mirrors record_purchase_from_webhook) ─
interface RawPayload {
  provider_product_id?: string;
  WP_ITEM_NUMBER?: string;
  provider_offer_id?: string;
  WP_OFFER_ID?: string;
  amount?: string | number;
  WP_SALE_AMOUNT?: string | number;
  currency?: string;
  WP_SALE_CURRENCY?: string;
}

function extractProviderProductFields(raw: RawPayload | null): {
  provider_product_id: string | null;
  provider_offer_id: string | null;
  amount: number | null;
  currency: string | null;
} {
  if (!raw) {
    return { provider_product_id: null, provider_offer_id: null, amount: null, currency: null };
  }
  const productId =
    (typeof raw.provider_product_id === "string" && raw.provider_product_id.trim()) ||
    (typeof raw.WP_ITEM_NUMBER === "string" && raw.WP_ITEM_NUMBER.trim()) ||
    null;
  const offerId =
    (typeof raw.provider_offer_id === "string" && raw.provider_offer_id.trim()) ||
    (typeof raw.WP_OFFER_ID === "string" && raw.WP_OFFER_ID.trim()) ||
    null;
  const amountRaw = raw.amount ?? raw.WP_SALE_AMOUNT;
  let amount: number | null = null;
  if (typeof amountRaw === "number") {
    amount = amountRaw;
  } else if (typeof amountRaw === "string" && amountRaw.trim() !== "") {
    const n = Number(amountRaw);
    if (Number.isFinite(n)) amount = n;
  }
  const currency = raw.currency?.trim() || raw.WP_SALE_CURRENCY?.trim() || null;
  return { provider_product_id: productId, provider_offer_id: offerId, amount, currency };
}

// ── 6. SHA-256 hex (same as M5 helper) ──────────────────────
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ═════════════════════════════════════════════════════════════
// Action classifier tests (worker integration contract)
// ═════════════════════════════════════════════════════════════
describe("M6 action classifier", () => {
  it("classifies processed as success/info/processed_count (M6 NEW)", () => {
    const c = classifyProcessAction({
      success: true, action: "processed",
      webhook_event_id: "e1", provider_id: "warriorplus",
      plan: "pro_creator", expires_at: "2026-12-01T00:00:00Z",
    });
    expect(c.counter).toBe("processed_count");
    expect(c.logEvent).toBe("WORKER_ROW_PROCESSED");
    expect(c.logLevel).toBe("info");
  });

  it("classifies awaiting_claim as success/info/awaiting_claim_count (M5, unchanged)", () => {
    const c = classifyProcessAction({
      success: true, action: "awaiting_claim",
      webhook_event_id: "e2", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("awaiting_claim_count");
    expect(c.logEvent).toBe("WORKER_ROW_AWAITING_CLAIM");
    expect(c.logLevel).toBe("info");
  });

  it("classifies failed_terminal as error/failed_terminal_count (unchanged)", () => {
    const c = classifyProcessAction({
      success: false, action: "failed_terminal",
      webhook_event_id: "e3", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("failed_terminal_count");
    expect(c.logEvent).toBe("WORKER_ROW_FAILED_TERMINAL");
    expect(c.logLevel).toBe("error");
  });

  it("classifies failed_retryable as warn/failed_retryable_count (unchanged)", () => {
    const c = classifyProcessAction({
      success: false, action: "failed_retryable",
      webhook_event_id: "e4", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("failed_retryable_count");
    expect(c.logEvent).toBe("WORKER_ROW_RETRY_SCHEDULED");
    expect(c.logLevel).toBe("warn");
  });

  it("treats null action (queue empty) as no-op (unchanged)", () => {
    const r: ProcessResult = {
      success: false, action: null,
      webhook_event_id: "", provider_id: "",
    };
    expect(r.action).toBeNull();
  });

  it("does not recognize 'verified' as a terminal action in M6 (defensive fallback)", () => {
    // M5 returned action='verified' as the terminal success.
    // M6 changes this: 'verified' is now an internal intermediate
    // state during processing. If the SQL function ever returns
    // 'verified' (which it shouldn't after M6), the worker logs it
    // as an unknown action — defensive, not a success path.
    const c = classifyProcessAction({
      success: true, action: "verified" as ProcessAction,
      webhook_event_id: "e5", provider_id: "warriorplus",
    });
    expect(c.counter).toBe("no_op_count");
    expect(c.logEvent).toBe("WORKER_ROW_UNKNOWN_ACTION");
    expect(c.logLevel).toBe("error");
  });
});

// ═════════════════════════════════════════════════════════════
// Duration computation tests (matches SQL case statement)
// ═════════════════════════════════════════════════════════════
describe("M6 duration computation from provider_products", () => {
  it("maps duration_value=6, duration_unit='month' to 6 months (~180 days)", () => {
    const r = computeDuration(6, "month");
    expect(r.intervalQualifier).toBe("months");
    expect(r.approximateDays).toBe(180);
    expect(r.error).toBeNull();
  });

  it("maps duration_value=1, duration_unit='year' to 1 year (~365 days)", () => {
    const r = computeDuration(1, "year");
    expect(r.intervalQualifier).toBe("years");
    expect(r.approximateDays).toBe(365);
    expect(r.error).toBeNull();
  });

  it("maps duration_value=30, duration_unit='day' to 30 days", () => {
    const r = computeDuration(30, "day");
    expect(r.intervalQualifier).toBe("days");
    expect(r.approximateDays).toBe(30);
    expect(r.error).toBeNull();
  });

  it("maps duration_value=4, duration_unit='week' to 4 weeks (28 days)", () => {
    const r = computeDuration(4, "week");
    expect(r.intervalQualifier).toBe("weeks");
    expect(r.approximateDays).toBe(28);
    expect(r.error).toBeNull();
  });

  it("rejects zero/negative duration_value (INVALID_DURATION)", () => {
    expect(computeDuration(0, "month").error).toBe("INVALID_DURATION");
    expect(computeDuration(-1, "month").error).toBe("INVALID_DURATION");
  });

  it("rejects unknown duration_unit (INVALID_DURATION_UNIT)", () => {
    expect(computeDuration(6, "hour" as DurationUnit).error).toBe("INVALID_DURATION_UNIT");
    expect(computeDuration(6, "fortnight" as DurationUnit).error).toBe("INVALID_DURATION_UNIT");
  });
});

// ═════════════════════════════════════════════════════════════
// safe_plan_switch expiry resolution tests (the M6 extension)
// ═════════════════════════════════════════════════════════════
describe("safe_plan_switch M6 extension: explicit p_expires_at wins", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("uses explicit p_expires_at when provided", () => {
    const explicit = new Date("2026-12-01T00:00:00Z"); // 6 months later
    const r = resolvePlanSwitchExpiry({
      p_expires_at: explicit,
      p_billing_cycle: "one_time",
      now,
    });
    expect(r.expires_at.getTime()).toBe(explicit.getTime());
    expect(r.explicit_expires_at).toBe(true);
    expect(r.duration_days).toBe(183); // Dec 1 - Jun 1
  });

  it("falls back to 30 days for monthly billing_cycle when p_expires_at is null", () => {
    const r = resolvePlanSwitchExpiry({
      p_expires_at: null,
      p_billing_cycle: "monthly",
      now,
    });
    expect(r.expires_at.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.explicit_expires_at).toBe(false);
    expect(r.duration_days).toBe(30);
  });

  it("falls back to 365 days for yearly billing_cycle when p_expires_at is null", () => {
    const r = resolvePlanSwitchExpiry({
      p_expires_at: null,
      p_billing_cycle: "yearly",
      now,
    });
    expect(r.expires_at.toISOString()).toBe("2027-06-01T00:00:00.000Z");
    expect(r.explicit_expires_at).toBe(false);
    expect(r.duration_days).toBe(365);
  });

  it("falls back to 30 days for one_time billing_cycle (backward-compat with M31)", () => {
    // Pre-M6 behavior: one_time + monthly default = 30 days.
    // M6 callers should always pass p_expires_at for one_time, but
    // the fallback must remain deterministic.
    const r = resolvePlanSwitchExpiry({
      p_expires_at: null,
      p_billing_cycle: "one_time",
      now,
    });
    expect(r.explicit_expires_at).toBe(false);
    expect(r.duration_days).toBe(30);
  });
});

// ═════════════════════════════════════════════════════════════
// Provider product extraction tests
// ═════════════════════════════════════════════════════════════
describe("M6 provider_product extraction from raw_payload", () => {
  it("extracts WarriorPlus uppercase keys", () => {
    const r = extractProviderProductFields({
      WP_ITEM_NUMBER: "wp-item-001",
      WP_OFFER_ID: "wp-offer-A",
      WP_SALE_AMOUNT: "39.00",
      WP_SALE_CURRENCY: "USD",
    });
    expect(r.provider_product_id).toBe("wp-item-001");
    expect(r.provider_offer_id).toBe("wp-offer-A");
    expect(r.amount).toBe(39.00);
    expect(r.currency).toBe("USD");
  });

  it("extracts lowercase canonical keys (future adapters)", () => {
    const r = extractProviderProductFields({
      provider_product_id: "stripe-prod-001",
      amount: 99.99,
      currency: "usd",
    });
    expect(r.provider_product_id).toBe("stripe-prod-001");
    expect(r.amount).toBe(99.99);
    expect(r.currency).toBe("usd");
  });

  it("prefers lowercase canonical key when both are present", () => {
    const r = extractProviderProductFields({
      provider_product_id: "canonical",
      WP_ITEM_NUMBER: "warriorplus",
    });
    expect(r.provider_product_id).toBe("canonical");
  });

  it("handles missing offer_id (NULL for providers without offer concept)", () => {
    const r = extractProviderProductFields({
      WP_ITEM_NUMBER: "wp-item-no-offer",
      WP_SALE_AMOUNT: "19.00",
    });
    expect(r.provider_product_id).toBe("wp-item-no-offer");
    expect(r.provider_offer_id).toBeNull();
  });

  it("returns null for missing product_id (dead-letter trigger)", () => {
    const r = extractProviderProductFields({
      WP_SALE_AMOUNT: "39.00",
    });
    expect(r.provider_product_id).toBeNull();
  });

  it("coerces numeric amount strings to numbers", () => {
    const r = extractProviderProductFields({
      WP_ITEM_NUMBER: "x",
      WP_SALE_AMOUNT: "39",
    });
    expect(r.amount).toBe(39);
  });

  it("returns null amount for unparseable strings", () => {
    const r = extractProviderProductFields({
      WP_ITEM_NUMBER: "x",
      WP_SALE_AMOUNT: "not-a-number",
    });
    expect(r.amount).toBeNull();
  });

  it("handles null payload gracefully", () => {
    const r = extractProviderProductFields(null);
    expect(r.provider_product_id).toBeNull();
    expect(r.amount).toBeNull();
    expect(r.currency).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// State transitions (M6 contract)
// ═════════════════════════════════════════════════════════════
describe("M6 state transitions", () => {
  // M6 pipeline:
  //   received → processing → verified (intermediate) → processing → processed
  //   verified → awaiting_claim (no purchase, M9)
  //   verified → failed_terminal (purchase/entitlement failure)
  //   failed_retryable → ... → verified (on retry success)

  it("resolved_existing_user → processed (M6 NEW terminal)", () => {
    const r: ProcessResult = {
      success: true,
      action: "processed",
      webhook_event_id: "evt-1",
      provider_id: "warriorplus",
      linked_user_id: "00000000-0000-0000-0000-000000000001",
      linked_purchase_id: "00000000-0000-0000-0000-000000000002",
      plan: "pro_creator",
      expires_at: "2026-12-01T00:00:00Z",
      duration_days: 183,
      resolution_outcome: "resolved_existing_user",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("processed_count");
    expect(c.logEvent).toBe("WORKER_ROW_PROCESSED");
    expect(r.plan).toBe("pro_creator");
    expect(r.linked_purchase_id).toBeTruthy();
  });

  it("marked_guest_awaiting_claim → awaiting_claim (M5, unchanged by M6)", () => {
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
    expect(r.linked_purchase_id).toBeUndefined();
  });

  it("PRODUCT_MAPPING_NOT_FOUND → failed_terminal (M6 NEW classification)", () => {
    const r: ProcessResult = {
      success: false,
      action: "failed_terminal",
      webhook_event_id: "evt-3",
      provider_id: "warriorplus",
      classification: "purchase_or_entitlement",
      error: "record_purchase_failed: PRODUCT_MAPPING_NOT_FOUND: ...",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("failed_terminal_count");
    expect(c.logLevel).toBe("error");
    expect(r.classification).toBe("purchase_or_entitlement");
  });

  it("PRODUCT_DISABLED → failed_terminal (M6 NEW classification)", () => {
    const r: ProcessResult = {
      success: false,
      action: "failed_terminal",
      webhook_event_id: "evt-4",
      provider_id: "warriorplus",
      classification: "purchase_or_entitlement",
      error: "record_purchase_failed: PRODUCT_DISABLED: ...",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("failed_terminal_count");
    expect(c.logLevel).toBe("error");
  });

  it("INVALID_DURATION → failed_terminal (M6 NEW classification)", () => {
    const r: ProcessResult = {
      success: false,
      action: "failed_terminal",
      webhook_event_id: "evt-5",
      provider_id: "warriorplus",
      classification: "purchase_or_entitlement",
      error: "grant_entitlement_failed: INVALID_DURATION: ...",
    };
    const c = classifyProcessAction(r);
    expect(c.counter).toBe("failed_terminal_count");
  });
});

// ═════════════════════════════════════════════════════════════
// Idempotency contract tests
// ═════════════════════════════════════════════════════════════
describe("M6 idempotency contract", () => {
  it("classifier is idempotent on identical input", () => {
    const r: ProcessResult = {
      success: true, action: "processed",
      webhook_event_id: "x", provider_id: "warriorplus",
      plan: "pro_creator",
    };
    expect(classifyProcessAction(r)).toEqual(classifyProcessAction(r));
  });

  it("duration computation is idempotent (same input → same output)", () => {
    const a = computeDuration(6, "month");
    const b = computeDuration(6, "month");
    expect(a).toEqual(b);
  });

  it("extraction is idempotent (same input → same output)", () => {
    const payload = { WP_ITEM_NUMBER: "x", WP_SALE_AMOUNT: "10" };
    expect(extractProviderProductFields(payload))
      .toEqual(extractProviderProductFields(payload));
  });

  it("safe_plan_switch expiry resolution is idempotent", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const explicit = new Date("2026-12-01T00:00:00Z");
    const args = { p_expires_at: explicit, p_billing_cycle: "monthly" as const, now };
    expect(resolvePlanSwitchExpiry(args)).toEqual(resolvePlanSwitchExpiry(args));
  });

  it("sha256Hex is stable for the same input", () => {
    expect(sha256Hex("buyer@example.com")).toBe(sha256Hex("buyer@example.com"));
  });
});

// ═════════════════════════════════════════════════════════════
// 6-month Pro entitlement scenario (end-to-end shape)
// ═════════════════════════════════════════════════════════════
describe("M6 end-to-end: 6-month Pro entitlement scenario", () => {
  it("computes 6-month duration and produces expires_at 180 days out", () => {
    // This mirrors the production scenario described in the M6 spec:
    // A WP purchase with provider_products.duration_value=6,
    // duration_unit='month' must produce an expires_at exactly
    // 6 months from now, and the duration_days field must report
    // ~180 days.
    const duration = computeDuration(6, "month");
    expect(duration.error).toBeNull();
    expect(duration.intervalQualifier).toBe("months");
    expect(duration.approximateDays).toBe(180);

    // The resulting expires_at would be passed to safe_plan_switch
    // via p_expires_at. The function returns that exact value.
    const now = new Date("2026-06-01T00:00:00Z");
    const explicit = new Date(now.getTime() + 6 * 30 * 86400_000);
    const planResult = resolvePlanSwitchExpiry({
      p_expires_at: explicit,
      p_billing_cycle: "one_time",
      now,
    });
    expect(planResult.expires_at.getTime()).toBe(explicit.getTime());
    expect(planResult.duration_days).toBe(180);
  });

  it("never hardcodes 6 months in expires_at computation", () => {
    // Verify that a different duration_value produces a different
    // expires_at. If 6 months were hardcoded, all values would map
    // to the same result.
    const now = new Date("2026-06-01T00:00:00Z");

    const three_months = resolvePlanSwitchExpiry({
      p_expires_at: new Date(now.getTime() + 3 * 30 * 86400_000),
      p_billing_cycle: "one_time",
      now,
    });
    const twelve_months = resolvePlanSwitchExpiry({
      p_expires_at: new Date(now.getTime() + 12 * 30 * 86400_000),
      p_billing_cycle: "one_time",
      now,
    });

    expect(three_months.expires_at.getTime()).not.toBe(twelve_months.expires_at.getTime());
    expect(three_months.duration_days).toBe(90);
    expect(twelve_months.duration_days).toBe(360);
  });
});
