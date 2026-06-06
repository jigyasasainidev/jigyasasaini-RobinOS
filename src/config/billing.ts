// ============================================================
// ROBINOS BILLING CONFIGURATION — Monthly only
// ============================================================
// Product IDs are hardcoded here and also set as Supabase secrets.
// The edge functions read from Supabase secrets (server-side).
// This file is frontend-only display config.
// ============================================================

export type PlanKey = "creator" | "pro_creator" | "agency";

// ── Monthly plan prices ────────────────────────────────────
export const PLAN_PRICES: Record<PlanKey, number> = {
  creator:     19,
  pro_creator: 39,
  agency:      99,
};

// ── Plan display names ─────────────────────────────────────
export const PLAN_NAMES: Record<PlanKey, string> = {
  creator:     "Creator",
  pro_creator: "Pro Creator",
  agency:      "Agency",
};

// ── Dodo environment ───────────────────────────────────────
export const DODO_ENVIRONMENT = (import.meta.env.VITE_DODO_ENVIRONMENT ?? "live_mode") as
  | "test_mode"
  | "live_mode";

// ── Checkout return URL ────────────────────────────────────
export function getCheckoutReturnUrl(planKey: string): string {
  return `${window.location.origin}/dashboard/settings?checkout=success&plan=${planKey}`;
}

// ── Dodo subscription_source value ────────────────────────
export const DODO_SOURCE = "dodo" as const;

// ── Whop subscription_source value ──────────────────────
export const WHOP_SOURCE = "whop" as const;
