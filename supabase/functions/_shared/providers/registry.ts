// ============================================================
// PROVIDER ADAPTER REGISTRY
// ============================================================
// Central lookup table: payment_providers.id → ProviderAdapter.
//
// The dispatcher calls getProviderAdapter(providerId) and
// receives either:
//   - a fully implemented adapter (today: warriorplus), or
//   - null (unknown provider, dispatcher returns 404)
//
// To add a new provider:
//   1. Implement the ProviderAdapter interface in
//      _shared/providers/<provider_id>.ts
//   2. Import + register below
//   3. Add a payment_providers row via admin UI
//   4. Store the provider's secret
//   5. Deploy — no schema changes required
//
// This file MUST stay small. Provider-specific logic belongs in
// the adapter file, not here.
// ============================================================

import type { ProviderAdapter } from "./types.ts";
import { WarriorPlusAdapter } from "./warriorplus.ts";

// ── Registered adapters ────────────────────────────────────
// Keys are payment_providers.id values (URL path segment).
// Adding/removing an entry here is the ONLY code change required
// to enable/disable a provider's webhook handling.

const ADAPTERS: Record<string, ProviderAdapter> = {
  warriorplus: new WarriorPlusAdapter(),
  // lemonsqueezy: new LemonSqueezyAdapter(),
  // stripe:      new StripeAdapter(),
  // dodo:        new DodoAdapter(),
};

/**
 * Resolve a provider adapter by id. Returns null if no adapter is
 * registered. The dispatcher maps null → 404 PROVIDER_NOT_FOUND.
 *
 * Important: this returns null for both "unknown id" and "id
 * exists but adapter not implemented yet". The 404 response is
 * correct in both cases — admin must register the adapter and
 * the row together.
 */
export function getProviderAdapter(providerId: string): ProviderAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

/**
 * Returns the list of registered provider ids. For diagnostics
 * / admin tooling only — not exposed on the webhook endpoint.
 */
export function listRegisteredProviderIds(): string[] {
  return Object.keys(ADAPTERS);
}
