// ============================================================
// ROBINOS BILLING CONFIGURATION
// Single source of truth for Dodo Payments product IDs and plan mapping.
//
// HOW TO USE:
//   1. Create products in your Dodo Payments dashboard
//   2. Copy the product IDs (format: pdt_xxxx) into DODO_PRODUCT_IDS below
//   3. Set VITE_DODO_PUBLIC_KEY in your .env file
//   4. Set DODO_SECRET_KEY and DODO_WEBHOOK_SECRET in Supabase secrets
// ============================================================

// ── Plan → Dodo Product ID mapping ────────────────────────
// Replace placeholder values with real product IDs from your
// Dodo Payments dashboard (Products → View Details → Product ID)
export const DODO_PRODUCT_IDS: Record<string, string> = {
  creator_monthly:     import.meta.env.VITE_DODO_PRODUCT_CREATOR_MONTHLY     ?? "",
  pro_creator_monthly: import.meta.env.VITE_DODO_PRODUCT_PRO_CREATOR_MONTHLY ?? "",
  agency_monthly:      import.meta.env.VITE_DODO_PRODUCT_AGENCY_MONTHLY      ?? "",
  creator_yearly:      import.meta.env.VITE_DODO_PRODUCT_CREATOR_YEARLY      ?? "",
  pro_creator_yearly:  import.meta.env.VITE_DODO_PRODUCT_PRO_CREATOR_YEARLY  ?? "",
  agency_yearly:       import.meta.env.VITE_DODO_PRODUCT_AGENCY_YEARLY       ?? "",
};

// ── Plan prices (must match Dodo dashboard) ────────────────
export const PLAN_PRICES = {
  creator:     { monthly: 19, yearly: 190 },
  pro_creator: { monthly: 39, yearly: 390 },
  agency:      { monthly: 99, yearly: 990 },
} as const;

// ── Dodo environment ───────────────────────────────────────
// "test_mode" for development, "live_mode" for production
export const DODO_ENVIRONMENT = (import.meta.env.VITE_DODO_ENVIRONMENT ?? "test_mode") as
  | "test_mode"
  | "live_mode";

// ── Checkout return URLs ───────────────────────────────────
export const CHECKOUT_RETURN_URL = `${window.location.origin}/dashboard/settings?checkout=success`;
export const CHECKOUT_CANCEL_URL = `${window.location.origin}/dashboard/settings?checkout=cancelled`;

// ── Plan key → product ID helper ──────────────────────────
export function getDodoProductId(planKey: string, billingCycle: "monthly" | "yearly"): string | null {
  const key = `${planKey}_${billingCycle}`;
  return DODO_PRODUCT_IDS[key] || null;
}

// ── Dodo subscription_source value ────────────────────────
export const DODO_SOURCE = "dodo" as const;
