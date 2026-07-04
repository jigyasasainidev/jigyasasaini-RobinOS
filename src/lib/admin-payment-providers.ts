// ============================================================
// ADMIN PAYMENT PROVIDERS — Types + Zod Schemas
// ============================================================
// Shared types and validation schemas for the admin payment
// providers UI. Mirrors the M55 SQL RPC contracts 1:1.
//
// Validation runs in two layers:
//   1. Client (this file) — fast feedback on input
//   2. Server (M55 RPCs)   — authoritative, runs in same txn
// Both layers must pass for a write to succeed.
// ============================================================

import { z } from "zod";

// ── Enums (mirror M52 CHECK constraints) ────────────────────
export const PLAN_KEYS = ["free", "creator", "pro_creator", "agency"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const BILLING_CYCLES = ["monthly", "yearly", "one_time"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const DURATION_UNITS = ["day", "week", "month", "year"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

// ── Wire types ──────────────────────────────────────────────
export type Provider = {
  id: string;
  display_name: string;
  adapter_version: string;
  is_enabled: boolean;
  is_test_mode: boolean;
  require_signature_verification: boolean;
  webhook_url: string | null;
  notes: string | null;
  product_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type ProviderFull = Provider & {
  config: Record<string, unknown>;
  allowed_ip_ranges: string[] | null;
};

export type ProviderProduct = {
  id: string;
  provider_id: string;
  provider_product_id: string;
  provider_offer_id: string | null;
  plan_key: PlanKey;
  billing_cycle: BillingCycle;
  duration_value: number;
  duration_unit: DurationUnit;
  amount: number;
  currency: string;
  is_subscription: boolean;
  is_enabled: boolean;
  display_name: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProviderSummary = {
  provider_count: number;
  enabled_count: number;
  product_count: number;
  active_product_count: number;
};

// ── Zod schemas (client-side validation) ────────────────────

const trimmed = (s: unknown) => (typeof s === "string" ? s.trim() : s);

/**
 * Provider settings form schema.
 * Matches admin_upsert_provider parameters.
 */
export const providerSchema = z.object({
  id: z
    .string()
    .min(1, "Provider ID is required")
    .max(64, "Provider ID must be 64 characters or fewer")
    .regex(/^[a-z0-9_-]+$/, "Only lowercase letters, digits, underscores, and hyphens are allowed"),
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(120, "Display name must be 120 characters or fewer"),
  is_enabled: z.boolean().default(false),
  is_test_mode: z.boolean().default(false),
  require_signature_verification: z.boolean().default(true),
  webhook_url: z
    .string()
    .trim()
    .max(2048, "Webhook URL is too long")
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "Webhook URL must start with http:// or https://"
    )
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .trim()
    .max(2000, "Notes must be 2000 characters or fewer")
    .optional()
    .or(z.literal("")),
});

export type ProviderFormValues = z.infer<typeof providerSchema>;

/**
 * Provider product form schema.
 * Matches admin_upsert_provider_product parameters.
 */
export const providerProductSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal("")),
    provider_id: z
      .string()
      .min(1, "Provider is required")
      .max(64, "Provider ID must be 64 characters or fewer"),
    provider_product_id: z
      .string()
      .trim()
      .min(1, "Product ID is required")
      .max(64, "Product ID must be 64 characters or fewer")
      .regex(/^[A-Za-z0-9._-]+$/, "Only letters, digits, dots, underscores, and hyphens are allowed"),
    provider_offer_id: z
      .string()
      .trim()
      .max(64, "Offer ID must be 64 characters or fewer")
      .regex(/^[A-Za-z0-9._-]*$/, "Only letters, digits, dots, underscores, and hyphens are allowed")
      .optional()
      .or(z.literal("")),
    plan_key: z.enum(PLAN_KEYS, {
      errorMap: () => ({ message: "Choose a RobinOS plan" }),
    }),
    billing_cycle: z.enum(BILLING_CYCLES, {
      errorMap: () => ({ message: "Choose a billing cycle" }),
    }),
    duration_value: z.coerce
      .number({ invalid_type_error: "Duration must be a number" })
      .positive("Duration must be greater than 0")
      .max(120, "Duration must be 120 or fewer")
      .finite("Duration must be a finite number"),
    duration_unit: z.enum(DURATION_UNITS, {
      errorMap: () => ({ message: "Choose a duration unit" }),
    }),
    amount: z.coerce
      .number({ invalid_type_error: "Price must be a number" })
      .nonnegative("Price cannot be negative")
      .max(1_000_000, "Price is unrealistically large")
      .finite("Price must be a finite number"),
    currency: z
      .string()
      .trim()
      .length(3, "Currency must be a 3-letter ISO code")
      .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters only"),
    is_subscription: z.boolean().default(false),
    is_enabled: z.boolean().default(true),
    display_name: z
      .string()
      .trim()
      .max(120, "Display name must be 120 characters or fewer")
      .optional()
      .or(z.literal("")),
    description: z
      .string()
      .trim()
      .max(2000, "Description must be 2000 characters or fewer")
      .optional()
      .or(z.literal("")),
  })
  .transform((v) => ({
    ...v,
    // Normalize empty strings to null where appropriate
    provider_offer_id: v.provider_offer_id === "" ? null : v.provider_offer_id ?? null,
    display_name:      v.display_name === "" ? null : v.display_name ?? null,
    description:       v.description === "" ? null : v.description ?? null,
    webhook_url:       v.provider_offer_id === "" ? null : v.provider_offer_id, // unused here
  }));

export type ProviderProductFormValues = z.infer<typeof providerProductSchema>;

// ── Friendly labels (used by Selects in the UI) ─────────────
export const PLAN_LABELS: Record<PlanKey, string> = {
  free: "Free",
  creator: "Creator",
  pro_creator: "Pro Creator",
  agency: "Agency",
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly (recurring)",
  yearly: "Yearly (recurring)",
  one_time: "One-time",
};

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  day: "Day(s)",
  week: "Week(s)",
  month: "Month(s)",
  year: "Year(s)",
};

/**
 * Format a duration (value + unit) as a human-readable string.
 * e.g. { value: 6, unit: "month" } → "6 months"
 */
export function formatDuration(value: number, unit: DurationUnit): string {
  const plural = value === 1 ? "" : "s";
  return `${value} ${unit}${plural}`;
}

/**
 * Format a price as a currency string.
 */
export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Convert Postgres numeric (string) to JS number safely.
 * JSON-over-http may return numeric as string to preserve precision.
 */
export const toNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
};
