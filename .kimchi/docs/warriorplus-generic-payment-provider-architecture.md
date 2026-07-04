# RobinOS — Generic Payment Provider Architecture (WarriorPlus First Adapter)

**Architecture-only document. No code, no SQL, no implementation.**

**Critical framing:** This is **NOT** a WarriorPlus-specific integration. It is the design of a **Generic Payment Provider Layer** whose first adapter is WarriorPlus. Future providers (JVZoo, Digistore24, Stripe, Razorpay, PayPal) plug in by implementing a single adapter interface — the subscription engine, entitlement engine, affiliate engine, and admin tooling all remain unchanged.

**Stack confirmed:**
- Frontend: React + TanStack Start
- Backend: Supabase (PostgreSQL + Edge Functions + Auth)
- Auth: already exists

**Source documents consulted:**
- `warriorplus-preimplementation-audit.md` — current state
- `warriorplus-architecture-v2.md` — WP-specific architecture (now generalized)
- `warriorplus-architecture-review.md` — review findings (incorporated)

**Date:** 2026-07-03

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Phase 1: Current State Audit](#phase-1-current-state-audit)
- [Phase 2: Generic Provider Architecture](#phase-2-generic-provider-architecture)
- [Phase 3: Database Changes](#phase-3-database-changes)
- [Phase 4: Webhook Flow](#phase-4-webhook-flow)
- [Phase 5: User Creation & Linking](#phase-5-user-creation--linking)
- [Phase 6: Refund Handling](#phase-6-refund-handling)
- [Phase 7: Recurring Billing Readiness](#phase-7-recurring-billing-readiness)
- [Phase 8: Observability](#phase-8-observability)
- [Phase 9: API Verification Strategy](#phase-9-api-verification-strategy)
- [Phase 10: Implementation Plan](#phase-10-implementation-plan)
- [Provider Adapter Specification](#provider-adapter-specification)
- [Future Provider Onboarding Checklist](#future-provider-onboarding-checklist)
- [Why This Beats WP-Specific Design](#why-this-beats-wp-specific-design)

---

## Executive Summary

The most important decision in this document is **NOT** "how do we integrate WarriorPlus?" — it is **"how do we build a payment provider abstraction so WarriorPlus is just one adapter?"**

A WP-specific design would:
- Add 8 `warriorplus_*` tables (V2 approach)
- Couple subscription logic to WP event types
- Require rewrites when JVZoo is added
- Mix provider-specific concerns into core systems

The generic provider layer design in this document:
- Adds **6 provider-agnostic tables** (works for any provider)
- Keeps subscription/entitlement/affiliate engines unchanged
- Adds a new provider by writing **one adapter** (~500 lines)
- Preserves full audit trail across all providers

**WarriorPlus is the first adapter.** Everything in the architecture is designed to support it AND every future provider.

### Headline numbers

| Component | Count |
|-----------|-------|
| New tables (provider-agnostic) | 6 |
| New RPCs | 18 |
| New Edge Functions | 4 (generic dispatcher + 1 first adapter) |
| Modified existing tables | 2 (`platform_settings`, `profiles`) |
| Modified existing RPCs | 0 |
| Provider adapter interfaces | 1 (with 8 required methods) |
| Lines of code to add new provider | ~500-800 |

---

## Phase 1: Current State Audit

### 1.1 Authentication

**Current state:**
- Supabase Auth manages `auth.users` (managed table, contains `id`, `email`, `encrypted_password`, etc.)
- `public.profiles` extends auth.users via `user_id UUID UNIQUE FK → auth.users(id)`
- Auto-creation trigger initializes profile on signup
- 2FA via `admin_2fa` system (admin-only)
- Session management via Supabase JWT
- TanStack Start uses Supabase client for auth state

**Key fields on profiles:**
- `subscription_tier` (text, default `free`) — cached plan
- `current_plan` (text, default `free`) — cached plan
- `subscription_expires_at` (timestamptz, nullable)
- `referred_by_code` (text, nullable) — for affiliate attribution
- `is_suspended` (boolean, default false) — admin can suspend

**How users are created today:**
1. User signs up via email/password or OAuth
2. Supabase Auth creates `auth.users` row
3. Trigger creates `public.profiles` row with `subscription_tier='free'`
4. Optional: admin can create users via `admin-create-user` Edge Function

**Premium access is currently NOT automatic from payment.** RobinOS has Dodo Payments and Whop integrations, but the audit reveals a critical gap: **manual payment is still the assumed path in many places.** The `admin_grant_subscription` RPC is the primary mechanism for granting premium access — it's used for beta testers, promotions, comp accounts, and admin overrides. This must change.

### 1.2 Subscription Storage

**Single source of truth:** `public.user_subscriptions`

**Already provider-agnostic at the column level** (key insight):
- `provider` is `text`, not an enum — accepts `dodo`, `whop`, `manual_admin`, `warriorplus`, or any string
- `provider_subscription_id` is `text`
- `provider_customer_id` is `text`

**Critical columns (from migration 31):**
- `id` (uuid PK), `user_id` (uuid, unique FK)
- `plan` (text — `creator`, `pro_creator`, `agency`)
- `status` (text — canonical states: `active`, `trialing`, `expiring`, `grace_period`, `expired`, `cancelled`, `payment_failed`, `past_due`, `suspended`, `paused`)
- `billing_cycle` (text — `monthly`, `yearly`, `one_time`)
- `amount`, `currency`
- `starts_at`, `expires_at`, `grace_period_ends_at`
- `last_plan_change_at`, `cooldown_until` (14-day cooldown)
- `last_payment_at`, `next_billing_at`, `auto_renew`
- `provider`, `provider_subscription_id`, `provider_customer_id`
- `canceled_at`, `cancel_at_period_end`
- `granted_by_admin`, `granted_reason`
- `subscription_source` (`manual_admin`, `dodo`, `whop`, etc.)
- `is_revenue_eligible` (boolean — admin grants don't count as revenue)
- `metadata` (jsonb)
- `created_at`, `updated_at`

**Unique constraint:** `unique (user_id)` — one subscription row per user. This is a constraint that must be relaxed to support stacking (already addressed in V2 §10 — `user_product_grants` is the stacking mechanism).

### 1.3 Plan Storage

**Source of truth:** `public.plan_entitlements` (migration 04)

**Schema:**
- `plan_key` (text — `free`, `creator`, `pro_creator`, `agency`)
- `feature_key` (text — `script_generation`, `caption_generation`, etc.)
- `limit_value` (numeric — `0` disabled, `-1` unlimited, `>0` capped)
- `limit_period` (text — `day`, `24h`, `month`, `lifetime`, `fair_usage`)
- `enabled` (boolean)
- `metadata` (jsonb)

**Plan tier resolution:** `resolve_user_plan(user_id)` RPC
- Checks `user_subscriptions.plan` if `status IN ('active', 'trialing', 'expiring')` AND `expires_at > now()`
- Falls back to `profiles.subscription_tier`
- Normalizes legacy aliases (`starter` → `creator`, `pro` → `pro_creator`, `scale_agency` → `agency`)

### 1.4 Premium Access Granting

**Current mechanism (pre-V2 audit, still relevant):**

```
Manual admin grant (primary):  admin_grant_subscription(user_id, plan, ...)
Dodo webhook (production):     dodo-webhook → safe_plan_switch
Whop webhook (phase 2B):       whop-webhook → safe_plan_switch
```

**The `safe_plan_switch` RPC (migration 31) is the canonical atomic grant.** It:
- Validates and normalizes plan key
- UPSERTs `user_subscriptions`
- Updates `profiles.subscription_tier`, `current_plan`, `subscription_expires_at`
- Logs to `subscription_audit_log`
- Clears grace period on renewal

**Critical observation:** This RPC is already provider-agnostic. It takes `p_provider` as a parameter. We don't need to modify it. We just need to call it from any new provider's webhook handler.

### 1.5 Existing Payment History

**Currently a mess** (per V2 audit):
- `public.payments` table exists but is **underused** — Dodo and Whop don't write to it
- `public.payment_events` exists, also underused
- The actual payment history is scattered across:
  - `user_subscriptions.last_payment_at`
  - `subscription_audit_log` (immutable audit trail)
  - Stripe-style detailed records missing

**This is the gap `purchases` table fills** (Phase 3 below).

### 1.6 Feature Limits

**Already in place:** `plan_entitlements` + `usage_tracking` engine (migration 04/29)

**Enforcement:** `check_and_increment_usage(user_id, feature_key, increment, idempotency_key)` RPC
- Atomic UPSERT on `usage_tracking` with `FOR UPDATE` lock
- Idempotency via `feature_usage_events` table
- Returns `{success, code, used, limit, remaining, reset_at}`

**Reusable as-is for any provider.** No changes needed.

### 1.7 Database Audit Summary

**Tables that already exist and are reusable:**
- `auth.users` (managed by Supabase)
- `profiles` (extends auth.users)
- `user_subscriptions` (provider-agnostic schema, but unique constraint blocks stacking)
- `plan_entitlements` (source of truth for limits)
- `usage_tracking` (atomic usage counters)
- `feature_usage_events` (idempotency for usage)
- `subscription_audit_log` (immutable audit trail, provider-agnostic)
- `subscription_webhook_events` (idempotency for webhooks — but limited scope)
- `affiliate_profiles`, `affiliate_commissions`, etc.
- `platform_settings` (runtime config)
- `admin_audit_logs`, `admin_logs`

**Tables that need to be created:**
- `payment_providers` — registry of configured providers (NEW)
- `provider_products` — provider-specific product → RobinOS plan mapping (NEW)
- `purchases` — universal purchase ledger (NEW)
- `webhook_events` — universal webhook log (NEW, supersedes subscription_webhook_events for new providers)
- `provider_customer_links` — link RobinOS users to provider customer IDs (NEW)
- `payment_provider_secrets` — encrypted secrets storage (NEW)

**Tables that need modification:**
- `platform_settings` — add columns for new feature flags
- `profiles` — add column for tracking primary payment provider

**Tables that exist but are underused (consider repurposing):**
- `payments` — could be merged into `purchases`
- `payment_events` — could be merged into `webhook_events`
- `subscription_webhook_events` — keep as legacy idempotency, use `webhook_events` for new providers

### 1.8 Security Audit

**RLS posture:** Strong. All sensitive tables have RLS. Service role is the only writer for payment-related tables.

**Edge Function security:**
- `verify_jwt = false` on webhook functions (required — webhooks don't carry user JWTs)
- Dodo webhook: HMAC SHA256 + idempotency + standardwebhooks library
- Whop webhook: HMAC declared but NOT enforced (gap)

**Service role usage:** Bounded to webhook handlers, admin operations, and cron jobs. No client-side service role usage.

**Replay attack prevention:** Via `subscription_webhook_events` unique constraint on `(provider, provider_event_id)`.

**Duplicate webhook prevention:** Same mechanism as replay.

**Idempotency:** Idempotent across all writes via:
- `record_webhook_event` RPC (migration 31)
- `safe_plan_switch` UPSERT pattern
- Unique constraints throughout

**Logging:** Multi-layer — Edge Function logs (Supabase stream), database audit log, commission events. Adequate but needs enhancement for generic provider model.

### 1.9 Current Payment Flow Assumptions

**Critical assumption made by current code:** "Someone manually grants access, then the system maintains it via cron."

**Where this assumption lives:**
- `admin_grant_subscription` is the only path that's truly tested
- `process_subscription_expiry` cron is documented but not scheduled (per V2 audit)
- Webhook flows (Dodo/Whop) are best-effort, not the assumed primary path

**For WarriorPlus + future providers, we must invert this assumption:** "Payment events are the primary path; admin grants are exceptions."

---

## Phase 2: Generic Provider Architecture

### 2.1 The Core Abstraction

Every payment provider, regardless of API differences, does these things:

1. **Receives money** from a buyer
2. **Sends a webhook** to notify us
3. **Has an event taxonomy** (sale, refund, chargeback, etc.)
4. **Identifies buyers** somehow (email, customer ID, etc.)
5. **Has products/offers** with IDs
6. **Supports some form of account portal** (optional)

The generic provider layer abstracts these into:

```
Provider Adapter Interface
        ↓
Generic Webhook Dispatcher
        ↓
Provider-Agnostic Event Handlers
        ↓
Existing Subscription / Entitlement / Affiliate Engines
```

### 2.2 Provider Adapter Interface

```typescript
interface PaymentProviderAdapter {
  // Identity
  readonly id: string                          // 'warriorplus', 'jvzoo', etc.
  readonly displayName: string
  readonly version: string                     // adapter version
  
  // Webhook verification
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    secret: string
  ): VerificationResult
  
  // Payload normalization
  parseWebhookPayload(
    rawBody: string,
    contentType: string
  ): ProviderRawEvent
  
  // Event mapping (provider-specific → standardized)
  mapEventType(rawEvent: ProviderRawEvent): StandardizedEventType | null
  
  // Information extraction
  extractTransactionInfo(rawEvent: ProviderRawEvent): TransactionInfo
  extractBuyerInfo(rawEvent: ProviderRawEvent): BuyerInfo
  extractProductInfo(rawEvent: ProviderRawEvent): ProviderProductInfo
  
  // Optional: API verification (after webhook, before processing)
  verifyTransactionViaAPI?(
    providerTransactionId: string,
    credentials: ProviderCredentials
  ): Promise<APIVerificationResult>
  
  // Optional: account portal redirect
  getAccountPortalUrl?(
    providerCustomerId: string,
    returnUrl: string,
    credentials: ProviderCredentials
  ): string
}
```

### 2.3 Standardized Event Types

**The canonical event taxonomy.** Every provider's events map to these:

| Standardized Event | Meaning | Maps from WP | Maps from Stripe | Maps from PayPal |
|---|---|---|---|---|
| `purchase.created` | Initial sale | `SALE` | `charge.succeeded` (one-time) | `PAYMENT.SALE.COMPLETED` |
| `purchase.refunded` | Refund issued | `RFND` | `charge.refunded` | `PAYMENT.SALE.REFUNDED` |
| `purchase.charged_back` | Chargeback | `CGBK` | `charge.dispute.created` | `PAYMENT.SALE.REVERSED` |
| `subscription.activated` | Sub became active | n/a | `customer.subscription.created` | `BILLING.SUBSCRIPTION.CREATED` |
| `subscription.renewed` | Recurring payment | `BILL` | `invoice.payment_succeeded` | `PAYMENT.SALE.COMPLETED` (recurring) |
| `subscription.cancelled` | User cancelled | `CANCEL` | `customer.subscription.deleted` | `BILLING.SUBSCRIPTION.CANCELLED` |
| `subscription.expired` | Term ended | n/a | `customer.subscription.updated` (status=expired) | `BILLING.SUBSCRIPTION.EXPIRED` |
| `subscription.payment_failed` | Payment retry failed | `INSF` | `invoice.payment_failed` | `PAYMENT.SALE.DENIED` |
| `dispute.opened` | Dispute started | (vendor-only) | `charge.dispute.created` | `CUSTOMER.DISPUTE.CREATED` |
| `dispute.won` | Vendor won | (vendor-only) | `charge.dispute.closed` (won) | `CUSTOMER.DISPUTE.RESOLVED` (seller) |
| `dispute.lost` | Vendor lost | (vendor-only) | `charge.dispute.closed` (lost) | `CUSTOMER.DISPUTE.RESOLVED` (buyer) |
| `unknown` | Unmapped | (any unknown) | (any unknown) | (any unknown) |

**Future providers add rows to this table** by implementing `mapEventType` in their adapter.

### 2.4 Provider Registry (Database-Backed)

```sql
-- Conceptual schema (architecture only, no SQL generated)

payment_providers {
  id: text (PK)             -- 'warriorplus'
  display_name: text         -- 'WarriorPlus'
  adapter_version: text      -- '1.0.0'
  is_enabled: boolean        -- admin toggle
  is_test_mode: boolean      -- for sandbox/test IPs
  config: jsonb              -- adapter-specific config
  allowed_ip_ranges: cidr[]  -- optional IP whitelist
  webhook_url: text          -- generated at registration
  created_at, updated_at
}

provider_products {
  id: uuid (PK)
  provider_id: text (FK)     -- 'warriorplus'
  provider_product_id: text  -- 'wp_xxx'
  provider_offer_id: text    -- optional: 'wp_xxx_offer_1'
  plan_key: text             -- 'creator' | 'pro_creator' | 'agency'
  billing_cycle: text        -- 'monthly' | 'yearly' | 'one_time'
  amount: numeric
  currency: text
  is_subscription: boolean
  is_enabled: boolean
  display_name: text         -- admin-friendly
  metadata: jsonb
  created_at, updated_at
  UNIQUE (provider_id, provider_product_id, provider_offer_id)
}
```

**Admin can map any provider's product to any RobinOS plan via this table.** No code changes needed to add new product mappings.

### 2.5 Generic Webhook Dispatcher

**One Edge Function** handles all provider webhooks:

```
POST /functions/v1/payment-webhook/{provider_id}
```

URL pattern includes the provider ID. The dispatcher:
1. Loads the provider adapter by ID
2. Verifies webhook signature using adapter
3. Parses payload using adapter
4. Inserts into `webhook_events` table (idempotent)
5. Enqueues for async processing
6. Returns 200 immediately

The dispatcher is **~100 lines**. All complexity lives in adapter modules.

### 2.6 Event-Driven Async Processor

**Background worker** processes events from `webhook_events` queue:

```
For each unprocessed event:
  1. Acquire lock (FOR UPDATE SKIP LOCKED)
  2. Load provider adapter
  3. Extract transaction, buyer, product info via adapter
  4. Resolve RobinOS user (link or create)
  5. Resolve RobinOS plan via provider_products
  6. Apply effect (subscription change, purchase record, commission)
  7. Log to audit
  8. Mark processed
```

The processor is **~300 lines, provider-agnostic**. All provider-specific code is in the adapter.

### 2.7 Component Inventory

```
supabase/functions/
├── payment-webhook/                    [DEPLOYABLE — entry point]
│   └── index.ts                        (~120 lines — dispatcher)
├── payment-webhook/_adapters/
│   ├── base.ts                         (PaymentProviderAdapter interface)
│   ├── warriorplus/index.ts            [ADAPTER 1 — ~500 lines]
│   ├── jvzoo/index.ts                  [ADAPTER 2 — future, ~400 lines]
│   ├── digistore24/index.ts            [ADAPTER 3 — future, ~500 lines]
│   ├── stripe/index.ts                 [ADAPTER 4 — future, ~600 lines]
│   └── razorpay/index.ts               [ADAPTER 5 — future, ~500 lines]
├── process-payment-events/             [DEPLOYABLE — async worker]
│   └── index.ts                        (~250 lines)
├── admin-payment-providers/            [DEPLOYABLE — admin RPCs]
│   └── index.ts                        (~300 lines)
├── _shared/payment/
│   ├── identity-resolver.ts            (~150 lines)
│   ├── purchase-recorder.ts            (~100 lines)
│   ├── subscription-grantor.ts         (~120 lines)
│   ├── refund-handler.ts               (~100 lines)
│   ├── commission-handler.ts           (~150 lines)
│   ├── notifier.ts                     (~80 lines)
│   └── evidence-builder.ts             (~80 lines)
```

### 2.8 The Provider Layer's Mental Model

Think of it as a **Unix pipe**:

```
WP Webhook → [WP Adapter] → Generic Event → [Provider-Agnostic Handler] → Subscription State Change
                       ↓
                  Webhook Log
                       ↓
                  Purchase Record
                       ↓
                  Commission (if applicable)
                       ↓
                  Admin Notification
```

Adding JVZoo later:

```
JVZoo Webhook → [JVZoo Adapter] → SAME Generic Event → SAME Handler → SAME State Change
```

**Zero changes to handler. Zero changes to subscription engine. Zero changes to admin tools.** Only the adapter is new.

---

## Phase 3: Database Changes

### 3.1 Migration Strategy

**6 new tables across 4 migrations:**

| Migration # | Tables | Purpose |
|---|---|---|
| 56 | `payment_providers`, `payment_provider_secrets` | Provider registry + secrets |
| 57 | `provider_products`, `provider_customer_links` | Product mapping + user linking |
| 58 | `webhook_events` | Universal webhook log |
| 59 | `purchases`, RPCs, triggers | Purchase ledger + all RPCs |

**Total: 4 new migrations.**

### 3.2 Table 1: `payment_providers`

```sql
-- ARCHITECTURE ONLY — schema documented, not generated

payment_providers {
  -- Identity
  id: text PRIMARY KEY              -- 'warriorplus', 'jvzoo', etc.
  display_name: text NOT NULL       -- 'WarriorPlus'
  adapter_version: text NOT NULL    -- '1.0.0'
  is_enabled: boolean NOT NULL DEFAULT false
  
  -- Configuration
  config: jsonb NOT NULL DEFAULT '{}'::jsonb
    -- Adapter-specific config (e.g., timeout, retry policy)
  
  -- Security
  allowed_ip_ranges: cidr[]         -- Optional IP whitelist
  require_signature_verification: boolean DEFAULT true
  
  -- Mode
  is_test_mode: boolean NOT NULL DEFAULT false
    -- When true, only accepts test-mode events from provider
  
  -- Webhook endpoint (generated)
  webhook_url: text NOT NULL        -- 'https://..../functions/v1/payment-webhook/warriorplus'
  webhook_secret_name: text         -- Reference to secrets table
  
  -- Metadata
  notes: text
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  created_by: uuid
  updated_by: uuid
}

INDEXES:
  - PRIMARY KEY on id
  - idx on (is_enabled) WHERE is_enabled = true

RLS:
  - Admin (super_admin, admin): full access
  - Service role: full access (for adapters)
  - Anon/authenticated: no access

TRIGGERS:
  - trg_payment_providers_updated_at (BEFORE UPDATE)
```

### 3.3 Table 2: `payment_provider_secrets`

```sql
-- ARCHITECTURE ONLY

payment_provider_secrets {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id: text NOT NULL REFERENCES payment_providers(id)
  
  secret_name: text NOT NULL        -- 'webhook_secret' | 'api_key' | 'signing_key'
  secret_value_encrypted: text NOT NULL  -- Encrypted at rest (pgsodium)
  
  description: text
  is_active: boolean NOT NULL DEFAULT true
  rotated_at: timestamptz
  expires_at: timestamptz           -- Optional expiration
  
  created_at: timestamptz NOT NULL DEFAULT now()
  created_by: uuid
  
  UNIQUE (provider_id, secret_name) WHERE is_active
}

INDEXES:
  - PRIMARY KEY
  - idx on (provider_id, secret_name)

RLS:
  - Super admin only for SELECT
  - Service role for read/write (during webhook processing)

SECURITY:
  - All secret values encrypted at rest using pgsodium
  - Decryption happens only in Edge Functions with service role
  - Audit log of all secret reads
```

### 3.4 Table 3: `provider_products`

```sql
-- ARCHITECTURE ONLY

provider_products {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id: text NOT NULL REFERENCES payment_providers(id)
  
  -- Provider's identification
  provider_product_id: text NOT NULL    -- 'wp_xxx'
  provider_offer_id: text               -- Optional: variant/offer ID
  
  -- RobinOS mapping
  plan_key: text NOT NULL
    CHECK (plan_key IN ('free', 'creator', 'pro_creator', 'agency'))
  billing_cycle: text NOT NULL
    CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time'))
  
  -- Pricing
  amount: numeric NOT NULL CHECK (amount >= 0)
  currency: text NOT NULL DEFAULT 'USD'
  
  -- Type
  is_subscription: boolean NOT NULL DEFAULT false
  is_enabled: boolean NOT NULL DEFAULT true
  
  -- Display
  display_name: text                    -- 'Pro Creator (Monthly)'
  description: text
  metadata: jsonb NOT NULL DEFAULT '{}'::jsonb
  
  -- Audit
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  created_by: uuid
  updated_by: uuid
  
  UNIQUE (provider_id, provider_product_id, COALESCE(provider_offer_id, ''))
}

INDEXES:
  - PRIMARY KEY
  - idx on (provider_id, provider_product_id) WHERE is_enabled = true
  - idx on (provider_id, provider_offer_id) WHERE is_enabled = true AND provider_offer_id IS NOT NULL

RLS:
  - Admin: full access
  - Service role: SELECT for adapter lookups
  - No user access

TRIGGERS:
  - trg_provider_products_updated_at (BEFORE UPDATE)
```

### 3.5 Table 4: `webhook_events`

**The universal webhook log. Every webhook from every provider lands here. Nothing is ever discarded.**

```sql
-- ARCHITECTURE ONLY

webhook_events {
  -- Identity
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id: text NOT NULL REFERENCES payment_providers(id)
  
  -- Provider's identification of this event
  provider_event_id: text NOT NULL      -- Provider's webhook/event ID
  provider_transaction_id: text        -- Associated transaction/sale ID (if any)
  provider_event_type: text NOT NULL   -- Provider's raw event type string
  
  -- Standardized event (after adapter mapping)
  standardized_event_type: text         -- 'purchase.created' | etc.
  event_mapping_confidence: text       -- 'exact' | 'inferred' | 'unknown'
  
  -- Idempotency
  payload_hash: text NOT NULL          -- SHA-256 of raw body
  
  -- Raw payload (preserved forever for audit/debugging)
  raw_payload: jsonb NOT NULL
  raw_headers: jsonb                   -- HTTP headers at receipt
  
  -- Processing status
  status: text NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received',           -- Just arrived, not yet processed
      'validating',         -- Signature/payload being validated
      'verified',           -- Signature OK, awaiting processing
      'processing',         -- Async worker picked it up
      'processed',          -- Successfully processed
      'duplicate',          -- Idempotency hit
      'failed_retryable',   -- Failed, will retry
      'failed_terminal',    -- Failed, moved to dead letter
      'blocked',            -- Signature failure or validation failure
      'awaiting_claim',     -- Needs user to claim purchase
      'awaiting_admin'      -- Needs admin intervention
    ))
  
  retry_count: integer NOT NULL DEFAULT 0
  max_retries: integer NOT NULL DEFAULT 5
  next_retry_at: timestamptz
  
  -- Locking (for async processing)
  locked_by: text                      -- Worker ID
  locked_at: timestamptz
  
  -- Error tracking
  last_error: text
  last_error_at: timestamptz
  error_history: jsonb                 -- Array of error objects
  
  -- Resolution
  linked_purchase_id: uuid             -- FK to purchases.id when processed
  linked_user_id: uuid                 -- RobinOS user involved
  
  -- Tracing
  trace_id: uuid NOT NULL              -- UUID v7 for distributed tracing
  
  -- Timestamps
  received_at: timestamptz NOT NULL DEFAULT now()
  verified_at: timestamptz
  processing_started_at: timestamptz
  processed_at: timestamptz
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  
  UNIQUE (provider_id, provider_event_id)
}

INDEXES:
  - PRIMARY KEY
  - idx_webhook_provider_txn (provider_id, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL
  - idx_webhook_status (status, received_at) WHERE status IN ('received', 'verified', 'failed_retryable')
  - idx_webhook_user (linked_user_id, received_at DESC) WHERE linked_user_id IS NOT NULL
  - idx_webhook_retry (next_retry_at) WHERE status = 'failed_retryable'
  - idx_webhook_trace (trace_id)
  - idx_webhook_search_purchase (provider_transaction_id, provider_id) WHERE provider_transaction_id IS NOT NULL

RLS:
  - Admin: SELECT all
  - Service role: full access
  - Authenticated: no direct access (admin via RPCs only)

TRIGGERS:
  - trg_webhook_events_updated_at (BEFORE UPDATE)
```

### 3.6 Table 5: `purchases`

**The universal purchase ledger. Detailed transaction history.**

```sql
-- ARCHITECTURE ONLY

purchases {
  -- Identity
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id: text NOT NULL REFERENCES payment_providers(id)
  
  -- Provider's identifiers
  provider_transaction_id: text NOT NULL     -- Sale/transaction ID
  provider_order_id: text                   -- Optional order ID
  provider_invoice_id: text                 -- Optional invoice ID
  provider_subscription_id: text            -- For recurring purchases
  
  -- Buyer (links to RobinOS user when resolved)
  buyer_email: text NOT NULL                -- Lowercased + trimmed
  buyer_email_hash: text NOT NULL           -- SHA-256 (for PII redaction in logs)
  buyer_name: text
  buyer_country: text                       -- ISO country code
  user_id: uuid REFERENCES auth.users(id)   -- RobinOS user (when resolved)
  
  -- Product
  provider_product_id: text NOT NULL
  provider_offer_id: text
  plan_key: text                            -- Resolved RobinOS plan
  billing_cycle: text                       -- 'monthly' | 'yearly' | 'one_time'
  is_subscription: boolean NOT NULL
  
  -- Money
  amount: numeric NOT NULL                  -- In major units
  currency: text NOT NULL DEFAULT 'USD'
  amount_refunded: numeric NOT NULL DEFAULT 0
  fee_amount: numeric NOT NULL DEFAULT 0    -- Platform fee deducted by provider
  
  -- Status (provider-agnostic canonical statuses)
  payment_status: text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN (
      'pending',           -- Awaiting provider confirmation
      'succeeded',         -- Payment confirmed
      'failed',            -- Payment failed
      'refunded',          -- Fully refunded
      'partially_refunded', -- Partially refunded
      'charged_back',      -- Chargeback received
      'disputed',          -- In dispute
      'cancelled'          -- Cancelled before completion
    ))
  
  -- Lifecycle timestamps (from provider)
  purchased_at: timestamptz NOT NULL        -- When provider recorded the purchase
  refunded_at: timestamptz
  charged_back_at: timestamptz
  disputed_at: timestamptz
  resolved_at: timestamptz                  -- When dispute/chargeback resolved
  
  -- Affiliate tracking
  affiliate_user_id: uuid                   -- RobinOS affiliate who referred
  referral_code: text                       -- Their referral code
  affiliate_commission_amount: numeric      -- Commission earned (if any)
  affiliate_commission_status: text         -- 'pending' | 'paid' | 'reversed' | 'skipped'
  
  -- Subscription relationship
  user_subscription_id: uuid                -- FK to user_subscriptions when applicable
  is_subscription_creating_event: boolean   -- True if this event created/updated the subscription
  
  -- Audit
  source_webhook_event_id: uuid             -- FK to webhook_events.id
  raw_provider_payload: jsonb               -- Provider's original data (preserved)
  metadata: jsonb NOT NULL DEFAULT '{}'::jsonb
  
  -- RobinOS audit
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  
  UNIQUE (provider_id, provider_transaction_id)
}

INDEXES:
  - PRIMARY KEY
  - idx_purchases_user (user_id, created_at DESC) WHERE user_id IS NOT NULL
  - idx_purchases_buyer_email (buyer_email_hash, created_at DESC)
  - idx_purchases_status (payment_status, created_at DESC)
  - idx_purchases_provider_txn (provider_id, provider_transaction_id)
  - idx_purchases_affiliate (affiliate_user_id, created_at DESC) WHERE affiliate_user_id IS NOT NULL
  - idx_purchases_subscription (user_subscription_id) WHERE user_subscription_id IS NOT NULL
  - idx_purchases_plan (plan_key, created_at DESC)
  - idx_purchases_date_range (created_at DESC)  -- for analytics

RLS:
  - Admin: SELECT all
  - Users: SELECT own (WHERE user_id = auth.uid())
  - Service role: full access

TRIGGERS:
  - trg_purchases_updated_at (BEFORE UPDATE)
```

### 3.7 Table 6: `provider_customer_links`

```sql
-- ARCHITECTURE ONLY

provider_customer_links {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
  provider_id: text NOT NULL REFERENCES payment_providers(id)
  
  provider_customer_id: text NOT NULL     -- Provider's customer ID
  provider_email: text                    -- Email on file with provider
  
  is_primary: boolean NOT NULL DEFAULT false
  verified_at: timestamptz                -- When we verified the link
  
  metadata: jsonb NOT NULL DEFAULT '{}'::jsonb
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  
  UNIQUE (user_id, provider_id)
  UNIQUE (provider_id, provider_customer_id)
}

INDEXES:
  - PRIMARY KEY
  - idx_pcl_user (user_id)
  - idx_pcl_provider_customer (provider_id, provider_customer_id)

RLS:
  - Users: SELECT own
  - Service role: full access

TRIGGERS:
  - trg_pcl_updated_at (BEFORE UPDATE)
```

### 3.8 Modifications to Existing Tables

#### `platform_settings` — Add 3 columns

```sql
-- ARCHITECTURE ONLY

ALTER TABLE platform_settings ADD COLUMN:
  - payment_provider_default text DEFAULT 'warriorplus'
      -- Which provider to use for new signups by default
  - payment_provider_allow_new_signups boolean DEFAULT true
      -- Master toggle for payment-driven signup
  - payment_provider_require_email_verification boolean DEFAULT true
      -- For new user creation from purchase
```

#### `profiles` — Add 1 column

```sql
-- ARCHITECTURE ONLY

ALTER TABLE profiles ADD COLUMN:
  - primary_payment_provider text
      -- Tracks which provider the user came from
      -- Used for support routing
```

**No changes to `user_subscriptions`** — V2 already designed `user_product_grants` for stacking.

### 3.9 New RPCs (18 total)

#### Subscription / Entitlement RPCs

| RPC | Purpose | Security |
|---|---|---|
| `grant_purchase_entitlement(p_user_id, p_purchase_id, p_plan_key, p_billing_cycle, p_provider_id, p_amount)` | Atomic grant from purchase | service_role |
| `revoke_purchase_entitlement(p_purchase_id, p_reason)` | Atomic revoke (for refunds) | service_role |
| `link_purchase_to_user(p_purchase_id, p_user_id, p_method)` | Manual/admin linking | admin |
| `recalculate_effective_plan_from_purchases(p_user_id)` | Re-derive plan from active purchases | service_role |

#### Webhook Processing RPCs

| RPC | Purpose | Security |
|---|---|---|
| `enqueue_webhook_event(p_provider_id, p_provider_event_id, p_provider_event_type, p_payload, p_headers, p_trace_id)` | Idempotent insert into webhook_events | service_role |
| `process_webhook_event(p_webhook_event_id)` | Process single event (atomic) | service_role |
| `process_pending_webhook_events(p_batch_size, p_max_runtime_ms)` | Worker batch | service_role |
| `retry_failed_webhook_event(p_webhook_event_id)` | Manual retry | admin |
| `mark_webhook_dead_letter(p_webhook_event_id, p_reason)` | Move to dead letter | service_role |
| `cleanup_old_webhook_events(p_retention_days)` | Cron cleanup | service_role |

#### Provider Configuration RPCs

| RPC | Purpose | Security |
|---|---|---|
| `register_payment_provider(p_id, p_display_name, p_adapter_version, p_config)` | Admin: register new provider | super_admin |
| `update_payment_provider(p_id, p_config, p_is_enabled)` | Admin: update config | super_admin |
| `rotate_payment_provider_secret(p_provider_id, p_secret_name, p_new_value)` | Admin: rotate secret | super_admin |
| `register_provider_product(p_provider_id, p_product_id, p_offer_id, p_plan_key, p_billing_cycle, p_amount, p_currency, p_is_subscription)` | Admin: map product | admin |
| `update_provider_product(p_id, p_is_enabled, p_amount, ...)` | Admin: update mapping | admin |
| `disable_provider_product(p_id)` | Admin: disable | admin |

#### User Resolution RPCs

| RPC | Purpose | Security |
|---|---|---|
| `resolve_or_create_user_from_purchase(p_buyer_email, p_buyer_name, p_provider_id, p_provider_customer_id, p_create_if_missing)` | Core identity resolution | service_role |
| `send_purchase_claim_email(p_purchase_id, p_buyer_email)` | Send claim magic link | service_role |
| `complete_purchase_claim(p_claim_token, p_account_data)` | User claims purchase | service_role |

### 3.10 New Triggers

| Trigger | Table | When | Action |
|---|---|---|---|
| `trg_payment_providers_updated_at` | `payment_providers` | BEFORE UPDATE | Set `updated_at` |
| `trg_provider_products_updated_at` | `provider_products` | BEFORE UPDATE | Set `updated_at` |
| `trg_webhook_events_updated_at` | `webhook_events` | BEFORE UPDATE | Set `updated_at` |
| `trg_purchases_updated_at` | `purchases` | BEFORE UPDATE | Set `updated_at` |
| `trg_pcl_updated_at` | `provider_customer_links` | BEFORE UPDATE | Set `updated_at` |
| `trg_purchases_set_buyer_hash` | `purchases` | BEFORE INSERT | Compute `buyer_email_hash` from `buyer_email` |

### 3.11 Migration Deployment Order

```
Migration 56: payment_providers + payment_provider_secrets
  ↓ (independent tables)
Migration 57: provider_products + provider_customer_links
  ↓ (FK to migration 56)
Migration 58: webhook_events
  ↓ (independent table)
Migration 59: purchases + all RPCs + triggers
  ↓ (FK to all prior)
```

---

## Phase 4: Webhook Flow

### 4.1 Complete Lifecycle

```
Incoming POST
   ↓
[1] Route Resolution
   ↓ Extract provider_id from URL path
[2] Provider Lookup
   ↓ Load provider adapter + check is_enabled
[3] Rate Limit Check
   ↓ Per-IP, per-provider
[4] Signature Verification
   ↓ Adapter.verifyWebhookSignature(rawBody, headers, secret)
[5] Payload Parsing
   ↓ Adapter.parseWebhookPayload(rawBody, contentType)
[6] Event ID Extraction
   ↓ Adapter extracts provider_event_id
[7] Idempotent Insert
   ↓ enqueue_webhook_event() — unique constraint catches dupes
[8] ACK to Provider
   ↓ Return 200 immediately (provider stops retrying)
   ↓
   ───────── ASYNC BOUNDARY ─────────
   ↓
[9] Worker Picks Up Event
   ↓ SELECT FOR UPDATE SKIP LOCKED from webhook_events
[10] Standardized Event Mapping
   ↓ Adapter.mapEventType(raw_event)
[11] Information Extraction
   ↓ Adapter.extractTransactionInfo, extractBuyerInfo, extractProductInfo
[12] User Resolution
   ↓ resolve_or_create_user_from_purchase()
[13] Product Resolution
   ↓ Lookup provider_products
[14] Effect Application
   ↓ INSERT/UPDATE purchases
   ↓ grant/revoke subscription entitlement
   ↓ record commission
[15] Audit Logging
   ↓ subscription_audit_log + webhook_events update
[16] Admin Notification
   ↓ For significant events
[17] Mark Processed
   ↓ UPDATE webhook_events SET status = 'processed'
```

### 4.2 Failure Modes

| Failure Point | Handling |
|---|---|
| Provider not found (bad URL) | 404 returned (no enqueue) |
| Provider disabled | 503 returned (provider should retry later) |
| Rate limit exceeded | 429 returned (provider should back off) |
| Signature verification fails | 401 returned (no enqueue, admin alerted) |
| Payload parse fails | 400 returned (no enqueue) |
| Idempotency duplicate | 200 returned with `{duplicate: true}` |
| DB unavailable | 503 returned (provider retries) |
| Worker processing fails (retryable) | `failed_retryable`, exponential backoff |
| Worker processing fails (terminal) | `failed_terminal`, dead letter, admin notified |
| User resolution ambiguous | `awaiting_claim` (claim email sent) |
| Product not in registry | `blocked`, admin notified |
| Admin intervention required | `awaiting_admin`, admin notified |

### 4.3 Async Processing Guarantees

- **Per-event ordering** — A specific `provider_event_id` is never processed twice (unique constraint)
- **Per-user ordering** — Events for the same user_id are processed serially via advisory lock
- **Crash recovery** — Worker crashes release row locks automatically; cron retries
- **Bounded runtime** — Worker invocation max 25s; remaining events retry on next cron
- **Dead letter** — Events that fail 5x move to `webhook_events.status = 'failed_terminal'` and trigger admin notification

### 4.4 Request Validation Order (Defense in Depth)

```
1. URL routing (provider must be valid + enabled)
2. Rate limit (per IP, per provider)
3. Signature verification (HMAC/SHA256/etc. per provider)
4. Schema validation (required fields present)
5. Business validation (amounts reasonable, etc.)
6. Idempotency check (unique constraint)
7. Enqueue (if all checks pass)
8. Return 200
```

Any check failure short-circuits with appropriate response code.

### 4.5 Generic Webhook Dispatcher (Pseudocode)

```
async function handleWebhook(providerId: string, req: Request):
    // [1] Route resolution — providerId from URL
    
    // [2] Provider lookup
    provider = await loadProvider(providerId)
    if not provider: return 404
    if not provider.is_enabled: return 503
    
    // [3] Rate limit
    if await isRateLimited(req.ip, providerId): return 429
    
    // [4-5] Read + parse
    rawBody = await req.text()
    if not adapter.verifyWebhookSignature(rawBody, req.headers, secret):
        await logSecurityEvent(...)
        return 401
    
    parsed = adapter.parseWebhookPayload(rawBody, req.contentType)
    
    // [6] Extract event ID
    providerEventId = parsed.provider_event_id
    if not providerEventId: return 400
    
    // [7] Idempotent enqueue
    traceId = generateUUIDv7()
    result = await enqueueWebhookEvent(
        providerId, providerEventId, parsed.event_type,
        parsed, req.headers, traceId
    )
    if result.is_duplicate:
        return 200 with { duplicate: true }
    
    // [8] ACK to provider
    return 200 with { received: true, queued: true }
```

This dispatcher is **~120 lines** of actual code. All provider complexity is in adapters.

---

## Phase 5: User Creation & Linking

### 5.1 Identity Resolution Priority

When a webhook arrives, we resolve the RobinOS user via this priority chain:

```
Priority 1: provider_customer_links (if we have a provider customer ID)
Priority 2: email match against auth.users.email
Priority 3: email match against profiles.email (fallback if needed)
Priority 4: create new user (if email doesn't exist)
```

### 5.2 Existing User Linking

When a buyer email matches an existing RobinOS user:

```
1. Find auth.users by email (case-insensitive)
2. Create or update provider_customer_links row
3. Proceed with purchase recording + subscription grant
4. Never create a duplicate user
5. Never update the existing user's email (use provider's email for reference only)
```

### 5.3 New User Creation

When buyer email does NOT match any existing user:

**Two options** (admin-configurable via `platform_settings.payment_provider_require_email_verification`):

#### Option A: Magic-link Verification (Secure, Recommended Default)

```
1. Purchase recorded with user_id = NULL, status = 'awaiting_claim'
2. claim_token generated (UUID v4)
3. magic_link_token generated (separate UUID v4)
4. Email sent to buyer with magic link
5. Magic link expires in 24 hours
6. User clicks link → /claim/verify?token=...
7. User confirms email + sets password
8. Account created (auth.users + profiles)
9. Purchase linked to new user_id
10. Subscription granted
```

#### Option B: Auto-Create (Frictionless, Lower Security)

```
1. Purchase recorded with user_id = NULL
2. auth.users row created with random password
3. profiles row created with buyer_email
4. Email sent: "Your account is ready — set your password here"
5. Purchase linked to new user_id
6. Subscription granted immediately
7. User must reset password before full access
```

**Recommendation:** Default to Option A. Option B is opt-in for admin if friction reduction is critical.

### 5.4 Email Collision Handling

What if two RobinOS accounts have similar emails?

- All email comparisons are case-insensitive (lowercase + trim)
- If multiple auth.users match: log warning, take the oldest account
- If buyer_email differs only in case from existing email: treat as same user

### 5.5 Multi-Account Prevention

- Provider's customer ID is linked to ONE RobinOS user
- If provider sends customer ID that already links to user A, but email matches user B: log warning, prefer customer ID link
- Admin can manually re-link via admin RPC (with audit log)

### 5.6 Race Conditions

Two webhooks for same buyer arriving simultaneously:

```
1. Both try resolve_or_create_user_from_purchase()
2. First call: SELECT ... FOR UPDATE on provider_customer_links (locked)
3. First call: creates user + link
4. Second call: was waiting on lock; now sees existing link, returns same user_id
5. Both purchases linked to same user
```

User creation is serialized via `SELECT FOR UPDATE` on `provider_customer_links`.

---

## Phase 6: Refund Handling

### 6.1 Refund Event Reception

When a provider sends a refund event:

```
1. Webhook arrives → enqueued
2. Worker processes event
3. Adapter extracts:
   - provider_transaction_id
   - refund_amount (for partial vs full detection)
4. Locate original purchase (via provider_transaction_id)
5. If purchase not found: log warning, admin notification, mark webhook as 'failed_admin_review'
6. If purchase found: proceed with refund handling
```

### 6.2 Full Refund Flow

```
1. UPDATE purchases SET:
   - payment_status = 'refunded'
   - amount_refunded = amount
   - refunded_at = now()
2. Call revoke_purchase_entitlement(purchase_id, reason='refund')
   - Determines billing_cycle from original purchase
   - For subscription purchases:
     - status = 'cancelled' (preserve access until current period end)
     - auto_renew = false
   - For one-time purchases:
     - IMMEDIATE downgrade to free
     - profiles.subscription_tier = 'free'
     - Remove from user_product_grants (set revoked_at)
3. Reverse any associated affiliate commission:
   - Call reverse_commission(...) if commission was created
4. Audit log entry
5. Admin notification (info priority)
```

### 6.3 Partial Refund Flow

```
1. UPDATE purchases SET:
   - payment_status = 'partially_refunded'
   - amount_refunded = amount_refunded + refund_amount
2. DO NOT modify subscription (user keeps access)
3. DO NOT reverse commission
4. Audit log entry (with refund amount)
5. Admin notification (info priority)
```

### 6.4 Billing Cycle Branching

Critical for one-time purchases (fixes V1 Bug #4):

| Billing Cycle | Refund Type | Action |
|---|---|---|
| `monthly` | Full | `status = cancelled`, preserve until `expires_at` |
| `monthly` | Partial | No change |
| `yearly` | Full | `status = cancelled`, preserve until `expires_at` |
| `yearly` | Partial | No change |
| `one_time` | Full | IMMEDIATE downgrade, revoke grant |
| `one_time` | Partial | No change |

### 6.5 Purchase History Preservation

**Rule: Never delete purchase history.**

- All purchases remain in `purchases` table
- Refunded purchases retain `payment_status = 'refunded'`
- Refunded purchases are visible in user account history with refund indicator
- Admin can view full refund history per user

---

## Phase 7: Recurring Billing Readiness

### 7.1 Current State

RobinOS does NOT currently sell recurring plans via WarriorPlus. The architecture must be ready for it.

### 7.2 Recurring Event Types

Standardized events that the architecture already supports:

- `subscription.activated` — Initial activation
- `subscription.renewed` — Recurring payment received
- `subscription.cancelled` — User cancelled (preserve access)
- `subscription.expired` — Term ended
- `subscription.payment_failed` — Recurring payment failed

### 7.3 Recurring Subscription Data Model

When a provider_product has `is_subscription = true`:

```
purchases table receives:
  - Multiple rows for same user_subscription_id (one per billing period)
  - Each row represents one billing cycle's payment
  - provider_subscription_id links them all together

user_subscriptions table:
  - Same row, updated each billing cycle
  - expires_at extended on each renewal
  - last_payment_at updated
  - next_billing_at updated
```

### 7.4 Recurring Cancellation

When user cancels subscription at provider:

```
1. Webhook arrives (subscription.cancelled)
2. Adapter extracts provider_subscription_id
3. UPDATE user_subscriptions SET:
   - status = 'cancelled'
   - auto_renew = false
   - canceled_at = now()
4. User retains access until current expires_at
5. When expires_at passes: process_subscription_expiry cron handles downgrade
```

### 7.5 Recurring Expiration

When subscription naturally expires (no renewal):

```
1. Webhook arrives (subscription.expired)
2. UPDATE user_subscriptions SET status = 'expired'
3. UPDATE profiles.subscription_tier = 'free'
4. Activate grace period if applicable
5. Audit log entry
```

### 7.6 Recurring Payment Failure

When recurring payment fails (insufficient funds, expired card, etc.):

```
1. Webhook arrives (subscription.payment_failed)
2. UPDATE user_subscriptions SET status = 'payment_failed'
3. Reverse any commission for this period (if previously attributed)
4. Notify user (email)
5. Admin notification (warning)
6. After grace period (provider-specific): subscription expires
```

### 7.7 Retry Handling

Many providers retry failed recurring payments:

```
- Provider handles retry logic on their end
- Each retry attempt may send a new webhook (subscription.payment_failed or subscription.renewed)
- Architecture handles each independently
- If retry succeeds: subscription.renewed → extends expires_at
- If retry exhausts: subscription.expired → user downgraded
```

---

## Phase 8: Observability

### 8.1 Required Logging Surfaces

| Surface | Purpose | Retention |
|---|---|---|
| Edge Function logs (Supabase stream) | Real-time debugging | 7 days |
| `webhook_events` table | Every webhook ever received | Forever |
| `purchases` table | Every purchase ever made | Forever |
| `subscription_audit_log` | Subscription state changes | Forever |
| `admin_audit_logs` | Admin actions | Forever |
| `push_admin_notification` | Real-time admin alerts | 90 days |

### 8.2 Search Capabilities

**Admin diagnostic interface must support searching by:**

- **Email** — Find all purchases/webhooks for a given buyer email
- **Sale ID** — Find the purchase + all related events for a specific transaction
- **Product ID** — Find all purchases of a specific provider product
- **Webhook ID** — Find the exact webhook + its processing history
- **User ID** — Find all purchases/webhooks for a RobinOS user
- **Trace ID** — Find all logs/events for a single request across systems
- **Date range** — Find events within a time window
- **Status** — Find events by processing status (failed, blocked, etc.)

### 8.3 Webhook Event Search RPC

```sql
-- ARCHITECTURE ONLY

search_webhook_events(
  p_provider_id text DEFAULT NULL,
  p_provider_transaction_id text DEFAULT NULL,
  p_provider_event_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_buyer_email text DEFAULT NULL,        -- Hashed before query
  p_user_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id, provider_id, provider_event_type, status, trace_id,
  received_at, processed_at, retry_count, last_error,
  linked_purchase_id, linked_user_id
)
```

### 8.4 Purchase Search RPC

```sql
-- ARCHITECTURE ONLY

search_purchases(
  p_provider_id text DEFAULT NULL,
  p_provider_transaction_id text DEFAULT NULL,
  p_buyer_email text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_plan_key text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id, provider_id, provider_transaction_id, buyer_email_masked,
  user_id, plan_key, billing_cycle, amount, currency,
  payment_status, purchased_at, refunded_at, source_webhook_event_id
)
```

### 8.5 Admin Diagnostic Page

**New page: `/admin/payments/diagnostics`**

Sections:
1. **Recent webhooks** — Last 100 events, filterable by status/provider
2. **Failed events** — Events in `failed_retryable` or `failed_terminal`
3. **Dead letter** — Events that exhausted retries
4. **Awaiting claim** — Purchases awaiting user claim
5. **Awaiting admin** — Events needing manual intervention
6. **Processing latency** — p50, p95, p99 by provider
7. **Queue depth** — Current backlog by status

### 8.6 Metrics

Track these via structured logs (exportable to monitoring):

- `webhook.received.count` — by provider, by event type
- `webhook.processed.count` — by provider, by outcome
- `webhook.failed.count` — by provider, by error category
- `webhook.processing.duration_ms` — p50, p95, p99
- `purchase.created.count` — by provider, by plan
- `purchase.refunded.count` — by provider, by reason
- `claim.completed.count` — by provider
- `claim.expired.count` — by provider
- `queue.depth` — by status

### 8.7 Alerting Rules

| Alert | Condition | Priority |
|---|---|---|
| Signature failures spike | > 5 signature failures in 5 min from same provider | CRITICAL |
| Queue backlog growing | > 1000 pending events for > 5 min | WARNING |
| Failed events accumulating | > 50 failed_retryable events | WARNING |
| Dead letter events | > 0 dead letter events | CRITICAL |
| Unknown product | New item_id seen, not in provider_products | WARNING |
| Claim expiry | Claim pending for > 7 days | WARNING |
| Processing latency high | p95 > 30 seconds for > 10 min | WARNING |
| Provider disabled | Provider webhook URL hit but provider.is_enabled = false | WARNING |

---

## Phase 9: API Verification Strategy

### 9.1 Webhook-Only vs API Verification

**Two security postures for payment webhooks:**

| Approach | Description | Security | Complexity |
|---|---|---|---|
| Webhook-only | Trust webhook + signature verification | Medium | Low |
| Webhook + API | Webhook triggers, then API call to provider to verify | High | Medium |

### 9.2 Recommendation: Layered Approach

**Default: Webhook-only with strict signature verification.**

**For high-value transactions (>$100): API verification after webhook.**

The `verifyTransactionViaAPI()` optional method in the adapter allows per-provider API verification.

### 9.3 When to Use API Verification

Decision matrix:

```
IF amount > $100
    AND provider supports API verification
    AND provider.is_high_value_verification_enabled
THEN
    Call adapter.verifyTransactionViaAPI()
    IF API confirms transaction: proceed with processing
    IF API denies or times out: block event, admin notification
ELSE
    Process based on webhook alone
```

### 9.4 Per-Provider API Verification Implementation

Each adapter can implement `verifyTransactionViaAPI` differently:

**WarriorPlus** (if available):
- Call WP API to verify transaction ID exists
- Compare amount, buyer email, status

**Stripe** (future):
- Call `stripe.charges.retrieve(charge_id)`
- Compare amount, status, customer

**PayPal** (future):
- Call PayPal API to verify transaction
- Compare amount, status, payer

### 9.5 Implementation Recommendation

For WarriorPlus specifically:
- **Skip API verification for MVP** unless WP offers a free verification endpoint
- Document that signature verification is the security boundary
- Add API verification as a future enhancement when WP API access is confirmed

---

## Phase 10: Implementation Plan

### 10.1 Implementation Phases

**Total: 8 phases, sequential dependencies**

```
Phase A: Database (4 migrations)
   ↓
Phase B: Generic Webhook Dispatcher (1 Edge Function)
   ↓
Phase C: Adapter Interface + Base Module (shared code)
   ↓
Phase D: WarriorPlus Adapter (first concrete adapter)
   ↓
Phase E: Generic Event Processor (1 Edge Function + RPCs)
   ↓
Phase F: User Resolution + Claim Workflow
   ↓
Phase G: Admin Panel
   ↓
Phase H: Frontend (claim flow, success page, admin pages)
   ↓
Phase I: Testing + Deployment
```

### 10.2 Required SQL Migrations

**4 new migrations** (numbered 56-59, continuing from existing 50):

1. **Migration 56**: `payment_providers` + `payment_provider_secrets`
2. **Migration 57**: `provider_products` + `provider_customer_links`
3. **Migration 58**: `webhook_events`
4. **Migration 59**: `purchases` + all 18 RPCs + 6 triggers

### 10.3 Required Supabase Changes

#### Edge Functions (4 new)

1. `payment-webhook` — Generic dispatcher (URL: `/functions/v1/payment-webhook/{provider_id}`)
2. `process-payment-events` — Async worker (cron-invoked)
3. `admin-payment-providers` — Admin RPCs
4. (WarriorPlus adapter is internal, not directly deployable)

#### Shared Modules

- `_shared/payment/base-adapter.ts` — Adapter interface
- `_shared/payment/identity-resolver.ts` — User resolution
- `_shared/payment/purchase-recorder.ts` — Purchase write logic
- `_shared/payment/subscription-grantor.ts` — Entitlement grant logic
- `_shared/payment/refund-handler.ts` — Refund logic
- `_shared/payment/commission-handler.ts` — Affiliate commission logic
- `_shared/payment/notifier.ts` — Admin notifications
- `_shared/payment/evidence-builder.ts` — Dispute evidence

#### Adapter Modules

- `_shared/payment/adapters/warriorplus/` — First adapter

### 10.4 Required Environment Variables

| Variable | Purpose | Set In |
|---|---|---|
| `WARRIORPLUS_WEBHOOK_SECRET` | HMAC verification secret | Supabase Dashboard |
| `WARRIORPLUS_SIGNING_KEY` | RobinOS-side signing for redirect URLs | Supabase Dashboard |
| `WARRIORPLUS_API_KEY` | (Future) API verification | Supabase Dashboard |
| `PAYMENT_WEBHOOK_ENCRYPTION_KEY` | Encrypt provider secrets at rest | Supabase Dashboard |
| `PAYMENT_WEBHOOK_ALLOWED_IPS` | (Optional) IP whitelist override | Supabase Dashboard |

### 10.5 Required API Routes

**Frontend (TanStack Start):**

| Route | Purpose |
|---|---|
| `/claim/verify` | Magic link verification page |
| `/claim/setup` | Account setup after verification |
| `/claim/complete` | Post-claim success page |
| `/purchase/error` | Error page for failed purchases |
| `/purchase/pending` | Loading page while webhook processes |
| `/admin/payments/providers` | Admin: provider registry |
| `/admin/payments/products` | Admin: product mapping |
| `/admin/payments/diagnostics` | Admin: webhook search |
| `/admin/payments/purchases` | Admin: purchase search |
| `/admin/payments/claims` | Admin: pending claims |
| `/admin/payments/dead-letter` | Admin: failed event recovery |

### 10.6 Required Admin Changes

**New admin pages:**
1. Provider Registry (`/admin/payments/providers`)
2. Product Mapping (`/admin/payments/products`)
3. Diagnostic Search (`/admin/payments/diagnostics`)
4. Purchase History (`/admin/payments/purchases`)
5. Pending Claims (`/admin/payments/claims`)
6. Dead Letter Recovery (`/admin/payments/dead-letter`)

**Modified admin pages:**
1. Admin Dashboard — Add payment provider health widgets
2. User Detail — Show payment history per user
3. Settings — Add provider enable/disable toggles

**Admin permissions:**
- super_admin: all payment operations
- admin: view + product mapping
- support: view only (no modifications)

### 10.7 Required Security Improvements

1. **Secret encryption at rest** — All `payment_provider_secrets.secret_value_encrypted` encrypted via pgsodium
2. **IP whitelisting** — Optional per-provider IP range restriction
3. **Rate limiting** — Per-IP, per-provider rate limits in dispatcher
4. **Constant-time signature comparison** — Use `crypto.timingSafeEqual` always
5. **Audit logging** — Every secret read logged
6. **No raw payloads in client logs** — Frontend never sees webhook payloads
7. **Service role scoping** — Service role only used in webhook handlers + admin RPCs
8. **Replay prevention** — Unique constraint on `(provider_id, provider_event_id)` in webhook_events
9. **Dead letter alerting** — Admin notified immediately on dead letter events

### 10.8 Required Testing Strategy

#### Unit Tests

- Adapter interface compliance (mock implementations)
- Event type mapping (provider-specific → standardized)
- Information extraction (transaction, buyer, product)
- User resolution priority chain
- Idempotency edge cases
- Refund flow with all billing_cycle branches

#### Integration Tests

- Webhook → enqueue → process → grant (full happy path)
- Webhook signature failure → 401 (no enqueue)
- Webhook duplicate → 200 with duplicate flag (no reprocessing)
- Webhook for unknown product → blocked, admin notified
- Webhook for unknown user → claim email sent
- Refund for monthly sub → status cancelled, preserve access
- Refund for one-time → immediate downgrade
- Recurring billing cycle renewal → expires_at extended

#### End-to-End Tests

- User buys via WP → account created → subscription active
- User refunds via WP → access revoked
- Admin manually links purchase → user linked
- Admin reprocesses dead letter event → success
- Admin maps new product → next purchase uses new mapping

#### Load Tests

- 1000 webhooks/minute sustained for 1 hour
- Burst of 100 webhooks in 1 second
- Worker recovers from crash mid-batch

#### Security Tests

- Forged signature → rejected
- Replayed webhook → rejected
- Tampered payload → rejected
- SQL injection attempts in payload fields → rejected
- Rate limit exceeded → 429

### 10.9 Production Rollout Checklist

#### Pre-Launch (must complete)

- [ ] All migrations tested on staging
- [ ] All Edge Functions deployed
- [ ] WarriorPlus adapter configured and tested
- [ ] Admin pages functional
- [ ] Worker cron configured
- [ ] Monitoring/alerting configured
- [ ] Secret rotation procedure documented
- [ ] Rollback procedure tested
- [ ] Load test passed
- [ ] Security review passed
- [ ] WP vendor documentation validated (signature algorithm, event types)

#### Rollout Stages

```
Stage 1: Internal testing (test mode, internal users only)
Stage 2: Beta (5-10 external users, manual monitoring)
Stage 3: Limited release (100 users, daily review)
Stage 4: General availability (full public)
```

Each stage: minimum 7 days with no critical incidents before advancing.

---

## Provider Adapter Specification

### A.1 Full Interface

```typescript
interface PaymentProviderAdapter {
  // === Identity ===
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  
  // === Webhook Verification ===
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    secret: string
  ): VerificationResult;
  
  // === Payload Parsing ===
  parseWebhookPayload(
    rawBody: string,
    contentType: string
  ): ProviderRawEvent;
  
  // === Event Mapping ===
  mapEventType(rawEvent: ProviderRawEvent): StandardizedEventType | null;
  
  // === Information Extraction ===
  extractTransactionInfo(rawEvent: ProviderRawEvent): TransactionInfo;
  extractBuyerInfo(rawEvent: ProviderRawEvent): BuyerInfo;
  extractProductInfo(rawEvent: ProviderRawEvent): ProviderProductInfo;
  
  // === Optional: API Verification ===
  verifyTransactionViaAPI?(
    providerTransactionId: string,
    credentials: ProviderCredentials
  ): Promise<APIVerificationResult>;
  
  // === Optional: Account Portal ===
  getAccountPortalUrl?(
    providerCustomerId: string,
    returnUrl: string,
    credentials: ProviderCredentials
  ): string;
}

// Supporting types
type VerificationResult = 
  | { valid: true }
  | { valid: false, reason: string };

type ProviderRawEvent = {
  provider_event_id: string;
  provider_event_type: string;
  raw_data: Record<string, unknown>;
};

type StandardizedEventType =
  | 'purchase.created'
  | 'purchase.refunded'
  | 'purchase.charged_back'
  | 'subscription.activated'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.expired'
  | 'subscription.payment_failed'
  | 'dispute.opened'
  | 'dispute.won'
  | 'dispute.lost'
  | 'unknown';

type TransactionInfo = {
  provider_transaction_id: string;
  provider_order_id?: string;
  provider_invoice_id?: string;
  provider_subscription_id?: string;
  amount: number;
  currency: string;
  refunded_amount?: number;
  fee_amount?: number;
  purchased_at: Date;
};

type BuyerInfo = {
  email: string;
  name?: string;
  country?: string;
  provider_customer_id?: string;
};

type ProviderProductInfo = {
  provider_product_id: string;
  provider_offer_id?: string;
};
```

### A.2 WarriorPlus Adapter Implementation Outline

```typescript
// Conceptual — shows what the WP adapter must do, not implementation

class WarriorPlusAdapter implements PaymentProviderAdapter {
  id = 'warriorplus';
  displayName = 'WarriorPlus';
  version = '1.0.0';
  
  verifyWebhookSignature(rawBody, headers, secret): VerificationResult {
    // WP uses 'cverify' header or field
    // Algorithm: SHA256(secret + ':' + txn_id + ':' + amount) — [EXT-DEP]
    // Use constant-time comparison
  }
  
  parseWebhookPayload(rawBody, contentType): ProviderRawEvent {
    // Parse WP's payload format
    // Extract: txn_id, event type, all WP-specific fields
  }
  
  mapEventType(rawEvent): StandardizedEventType {
    // Map WP events to standardized events:
    // SALE → purchase.created
    // BILL → subscription.renewed
    // RFND → purchase.refunded
    // CGBK → purchase.charged_back
    // CANCEL → subscription.cancelled
    // INSF → subscription.payment_failed
    // Unknown → null (will be marked as 'blocked')
  }
  
  extractTransactionInfo(rawEvent): TransactionInfo {
    // Extract from WP payload
    // Normalize amount (WP may send in cents or dollars — [EXT-DEP])
  }
  
  extractBuyerInfo(rawEvent): BuyerInfo {
    // Extract buyer_email (lowercase + trim)
    // Extract buyer name + country if present
  }
  
  extractProductInfo(rawEvent): ProviderProductInfo {
    // Extract item_id + offer_id
  }
  
  // Optional: getAccountPortalUrl not implemented for WP (no portal)
}
```

### A.3 Future Provider Adapter Skeletons

**JVZooAdapter** (future):
- Similar to WarriorPlus but with JVZoo-specific event names
- Different signature verification (JVZoo uses different hash)
- ~400 lines of code

**Digistore24Adapter** (future):
- IPN format similar to WarriorPlus
- Signature verification via Digistore24-specific algorithm
- ~500 lines of code

**StripeAdapter** (future):
- Uses Stripe's official SDK
- Map Stripe events to standardized events
- Subscription lifecycle via Stripe Subscriptions API
- ~600 lines of code

**RazorpayAdapter** (future):
- Uses Razorpay's webhook signature verification
- Map Razorpay events to standardized events
- ~500 lines of code

---

## Future Provider Onboarding Checklist

Adding a new provider (after architecture is built):

- [ ] Implement `PaymentProviderAdapter` interface (~500-800 lines)
- [ ] Register provider in `payment_providers` table
- [ ] Set provider secrets in `payment_provider_secrets` table
- [ ] Map provider's products to RobinOS plans in `provider_products` table
- [ ] Test signature verification with provider's documentation
- [ ] Test event mapping with provider's webhook examples
- [ ] Verify webhook URL routing works
- [ ] Load test with provider's expected volume
- [ ] Document provider-specific quirks in adapter README
- [ ] Add provider to admin UI
- [ ] Train support team on provider-specific behaviors

**Total effort per new provider: 1-2 weeks for an experienced developer.**

---

## Why This Beats WP-Specific Design

### Comparison Table

| Concern | WP-Specific Design (V2) | Generic Provider Design (This Doc) |
|---|---|---|
| Tables for new provider | 8 new tables per provider | 0 new tables (reuse 6 generic tables) |
| RPCs for new provider | ~10 new RPCs per provider | 0 new RPCs (reuse generic ones) |
| Edge Functions for new provider | 4 new functions per provider | 0 new functions (reuse dispatcher + worker) |
| Subscription logic | Coupled to provider events | Provider-agnostic (uses standardized events) |
| Admin tooling | New admin pages per provider | Same admin pages work for all providers |
| Affiliate logic | Provider-specific handling | Generic (commission rate configurable) |
| Refund handling | Different per provider | Same logic, billing_cycle branch is the only variation |
| Recurring billing | Different per provider | Same logic |
| User creation | Provider-specific | Generic (magic-link or auto-create) |
| Dispute handling | Provider-specific | Generic (chargeback + dispute events) |
| Audit trail | Per provider | Universal (searchable across all providers) |

### Cost of Adding JVZoo Later

**WP-Specific approach:**
- 8 new tables (`jvzoo_*`)
- 10+ new RPCs (`jvzoo_*`)
- 4 new Edge Functions
- Modify subscription_audit_log calls to handle JVZoo events
- Modify refund handler to handle JVZoo refund format
- Build new admin pages for JVZoo
- Build new affiliate handling for JVZoo
- Test entire payment flow again
- **Total: 6-8 weeks of work**

**Generic Provider approach:**
- 1 new adapter file (~500-800 lines)
- 1 INSERT into `payment_providers` table
- N INSERTs into `provider_products` table (one per product mapping)
- Test adapter implementation
- **Total: 1-2 weeks of work**

**Savings: 4-6 weeks per additional provider.**

### Total Cost of Ownership

For 5 providers (WP, JVZoo, Stripe, Razorpay, PayPal):

| Approach | Total Effort |
|---|---|
| WP-Specific design × 5 | 30-40 weeks |
| Generic Provider design (1 + 4 adapters) | 8-10 weeks |

**Savings: 20-30 weeks.**

---

## Final Recommendation

**Build the Generic Payment Provider Layer.** WarriorPlus is the first adapter but not the design center. The design center is the abstraction.

**Investment:** ~16-20 weeks for the first provider (architecture + WP adapter + all shared infrastructure).

**Return:** Each subsequent provider is 1-2 weeks. The architecture pays for itself after 2-3 providers.

**Risk of not doing this:** Every new payment provider requires 6-8 weeks of refactoring. After 3 providers, the team has spent more time than if they had built the abstraction upfront.

**Risk of doing this:** Initial investment is larger. But the abstraction is well-understood software engineering — there's no novel research here, just disciplined design.

---

**End of Architecture Document.**
