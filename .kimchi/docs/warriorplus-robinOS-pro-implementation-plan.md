# RobinOS — WarriorPlus Implementation Plan (RobinOS Pro Plan, $39 / 6 Months)

**Planning document. No SQL, no code, no implementation.**

**Final plan.** Supersedes `warriorplus-implementation-plan.md`. Incorporates final database audit + RobinOS-specific business rule + maximum reuse strategy.

**Source architecture:** `warriorplus-generic-payment-provider-architecture.md` (approved)
**Source audit:** `warriorplus-preimplementation-audit.md`
**Source review:** `warriorplus-architecture-review.md`
**Source V2:** `warriorplus-architecture-v2.md`
**Date:** 2026-07-03

---

## Table of Contents

1. [Product Specification: RobinOS Pro Plan](#1-product-specification-robinos-pro-plan)
2. [Final Database Audit & Reuse Strategy](#2-final-database-audit--reuse-strategy)
3. [Schema Changes Required](#3-schema-changes-required)
4. [Generic Provider Architecture (Condensed)](#4-generic-provider-architecture-condensed)
5. [Webhook Flow](#5-webhook-flow)
6. [Entitlement Grant Logic (6-Month Configurable)](#6-entitlement-grant-logic-6-month-configurable)
7. [Refund & Dispute Handling](#7-refund--dispute-handling)
8. [User Creation Flow](#8-user-creation-flow)
9. [Affiliate Handling](#9-affiliate-handling)
10. [Edge Functions Inventory](#10-edge-functions-inventory)
11. [Frontend Changes](#11-frontend-changes)
12. [Admin Panel](#12-admin-panel)
13. [Background Jobs](#13-background-jobs)
14. [Observability](#14-observability)
15. [Testing Strategy](#15-testing-strategy)
16. [Deployment Plan](#16-deployment-plan)
17. [Rollback Strategy](#17-rollback-strategy)
18. [Launch Checklist](#18-launch-checklist)
19. [Future Product Templates](#19-future-product-templates)
20. [Summary](#20-summary)

---

## 1. Product Specification: RobinOS Pro Plan

### 1.1 Product Definition

| Field | Value |
|-------|-------|
| Product Name | RobinOS Pro Plan |
| Price | $39 USD |
| Payment Type | One-Time |
| Access Duration | 6 Months (180 days) |
| Recurring Billing | None |
| Maps to RobinOS Plan | `pro_creator` |
| Payment Provider | WarriorPlus (Marketplace) |
| Estimated Provider Commission | ~$20 to WP affiliate (if any) |

### 1.2 Business Rules

1. **Every successful WarriorPlus purchase of this product grants the RobinOS Pro Plan.**
2. **The entitlement must expire automatically exactly 6 months after purchase** — computed from `provider_products.duration_value × duration_unit`, NOT hardcoded.
3. **After expiry:**
   - Premium access revoked (downgrade to `free`)
   - User account remains active
   - Purchase history preserved forever
   - Webhook history preserved forever
4. **Re-purchase after expiry** grants another 6-month entitlement (starts a new term).
5. **Re-purchase while active** — per V2 stacking matrix, allowed via `user_product_grants` (additive).
6. **The 6-month duration must NOT be hardcoded anywhere in code or RPCs.** It must be configurable via `provider_products` mapping so future products (30 days, 12 months, lifetime, etc.) work without backend changes.

### 1.3 Configurable Duration Model

The duration is expressed as **value + unit** in `provider_products`:

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `duration_value` | `numeric` | 6 | Numeric quantity |
| `duration_unit` | `text` | `'month'` | `'day' \| 'week' \| 'month' \| 'year'` |

For RobinOS Pro Plan: `duration_value = 6`, `duration_unit = 'month'`.

Future products (no code changes required):

| Product | duration_value | duration_unit | Maps to Plan |
|---------|----------------|---------------|--------------|
| RobinOS Pro Plan | 6 | month | pro_creator |
| RobinOS 30-Day Pass | 30 | day | creator |
| RobinOS Annual | 12 | month | pro_creator |
| RobinOS Lifetime | 100 | year | agency |
| RobinOS Trial | 7 | day | creator |

The worker computes `expires_at = purchased_at + INTERVAL '1 day' * duration_value_in_days`, where duration is normalized to days internally.

### 1.4 What "Pro Plan" Means at RobinOS

Looking at `plan_entitlements` (migration 04, 29), the `pro_creator` plan provides:

| Feature | Limit |
|---------|-------|
| `script_generation` | 100/day |
| `caption_generation` | 100/day |
| `trend_scan` | 100/day |
| `hashtag_scan` | 100/day |
| `tts_generation` | 200/day |
| `video_generation` | 50/day |
| `byok_access` | unlimited |
| `analytics_access` | unlimited |
| `watermark_removal` | 1/day |
| `automation_tools` | disabled |
| `export_access` | 250/day |
| `team_workspaces` | 3 lifetime |

The $39 RobinOS Pro Plan therefore maps to `plan_key = 'pro_creator'` in `provider_products`.

---

## 2. Final Database Audit & Reuse Strategy

This is the definitive audit. Goal: **maximum reuse, minimum new tables.**

### 2.1 Existing Tables — Reusable As-Is

These tables need **ZERO changes** for the WP integration:

| Table | Why It's Reusable |
|-------|-------------------|
| `auth.users` | Managed by Supabase. New WP users created here. |
| `profiles` | Has `subscription_tier`, `current_plan`, `subscription_expires_at` — auto-updated by `safe_plan_switch`. |
| `user_subscriptions` | **Provider-agnostic schema** — `provider` text accepts 'warriorplus'. Has `billing_cycle`, `expires_at`, `auto_renew`, `amount`. **This is where the WP subscription lives.** |
| `plan_entitlements` | Already has `pro_creator` row with full limits. No changes. |
| `usage_tracking` | Atomic usage counters — already provider-agnostic. |
| `feature_usage_events` | Idempotency for usage — already provider-agnostic. |
| `feature_usage` | Used by existing flows — provider-agnostic. |
| `subscription_audit_log` | Immutable audit — already provider-agnostic. **WP events log here.** |
| `subscription_webhook_events` | Has `unique(provider, provider_event_id)` — **use for idempotency.** |
| `affiliate_profiles` | Affiliate account state — provider-agnostic. |
| `affiliate_commissions` | Commission ledger with full state machine. |
| `commission_events` | Audit trail for commissions. |
| `affiliate_wallet_ledger` | Double-entry ledger. |
| `affiliate_wallets` | Available/pending balances. |
| `withdrawal_requests` | Withdrawal requests. |
| `payout_history` | Payout history. |
| `platform_settings` | Runtime config — add columns only as needed. |
| `feature_flags` | Feature flag system. |
| `admin_allowlist` | Admin email allowlist. |
| `admin_audit_logs` | Admin actions audit. |
| `admin_logs` | Admin action log. |
| `moderation_actions` | Moderation audit. |

**21 existing tables fully reused.**

### 2.2 Existing Tables — Extend (Additive Migrations)

These tables need **additive migrations** (new columns) but no replacement:

#### `payments` (existing, currently underused)

Current schema:
```
payments {
  id, user_id, subscription_id,
  provider (enum: creem/stripe/lemonsqueezy/manual),
  provider_payment_id, amount, currency,
  status (enum: pending/succeeded/failed/refunded/canceled),
  billing_cycle (enum: monthly/yearly/one_time),
  refunded_amount, failure_reason, metadata,
  paid_at, created_at, updated_at
}
```

**Gaps vs. WP needs:**
- `provider` enum doesn't include 'warriorplus' (only creem/stripe/lemonsqueezy/manual)
- No `provider_subscription_id` (only `provider_payment_id`)
- No `provider_order_id`, `provider_invoice_id`
- No `buyer_email` / `buyer_email_hash` (only via user_id lookup)
- No `plan_key` (only via subscription_id)
- No `source_webhook_event_id` (no FK to webhook log)
- No `affiliate_user_id`, `referral_code`, `affiliate_commission_amount`

**Decision:** EXTEND `payments` with additive migration. Don't create a new `purchases` table.

**New columns to add:**
```
ALTER TABLE payments ADD COLUMN:
  - provider_subscription_id text               -- WP subscription ID
  - provider_order_id text                       -- Optional order ID
  - provider_invoice_id text                     -- Optional invoice ID
  - buyer_email text                             -- Lowercased + trimmed
  - buyer_email_hash text                        -- SHA-256 for PII redaction
  - buyer_name text
  - buyer_country text
  - plan_key text                                -- Resolved RobinOS plan
  - provider_event_id text                       -- Provider's event ID (for linking)
  - source_webhook_event_id uuid                 -- FK to webhook_events
  - affiliate_user_id uuid                       -- FK to auth.users (affiliate)
  - referral_code text                           -- Affiliate referral code
  - affiliate_commission_amount numeric
  - affiliate_commission_status text             -- 'pending'|'paid'|'reversed'|'skipped'
  - raw_provider_payload jsonb                   -- Original provider data
  - updated_at already exists
```

**Indexes to add:**
```
CREATE INDEX idx_payments_buyer_hash ON payments(buyer_email_hash);
CREATE INDEX idx_payments_provider_event ON payments(provider, provider_event_id);
CREATE INDEX idx_payments_affiliate ON payments(affiliate_user_id) WHERE affiliate_user_id IS NOT NULL;
CREATE INDEX idx_payments_subscription ON payments(user_subscription_id) WHERE user_subscription_id IS NOT NULL;
CREATE INDEX idx_payments_status_date ON payments(status, created_at DESC);
CREATE INDEX idx_payments_provider_txn ON payments(provider, provider_payment_id);
```

#### `platform_settings` (existing)

Add 2 columns:

```
ALTER TABLE platform_settings ADD COLUMN:
  - payment_provider_default text DEFAULT 'warriorplus'
      -- Which provider is preferred for new signups
  - payment_provider_require_email_verification boolean DEFAULT true
      -- Magic-link verification required for new accounts?
```

#### `profiles` (existing)

Add 1 column:

```
ALTER TABLE profiles ADD COLUMN:
  - primary_payment_provider text
      -- Tracks which provider the user came from (for support routing)
```

#### `payment_provider` enum (existing)

Add 'warriorplus' to the enum:

```
ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'warriorplus';
```

#### `payment_status` enum (existing)

Add 'partially_refunded', 'charged_back', 'disputed':

```
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'partially_refunded';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'charged_back';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'disputed';
```

### 2.3 Existing Tables — Repurpose

#### `subscription_webhook_events` (existing, migration 31)

Current schema:
```
subscription_webhook_events {
  id, provider_event_id, provider, event_type,
  payload_hash, processed_at, created_at
  UNIQUE (provider, provider_event_id)
}
```

**Used for:** Idempotency only (did we see this event?).

**Verdict:** **REUSE as-is.** The idempotency table doesn't need to be replaced. The new `webhook_events` table (richer) can be a different table, OR we extend `subscription_webhook_events` to be richer.

After audit, the cleaner choice is:

**Option A (chosen):** Keep `subscription_webhook_events` as idempotency table. Add new `webhook_events` table for the rich webhook log.

**Why:** Separation of concerns. Idempotency is hot-path (every webhook checks it). Rich log is admin/debug path.

**Decision:** Both tables exist. `subscription_webhook_events` for idempotency check (existing), `webhook_events` for full audit trail (new).

#### `payment_events` (existing, underused)

Current schema:
```
payment_events {
  id, payment_id, provider, event_type,
  payload, processed, created_at
}
```

**Verdict:** **DEPRECATE.** Replace usage with new `webhook_events` table. Do not extend.

(Existing rows stay; new code never writes to it.)

### 2.4 New Tables Required (3 only)

After maximum reuse, only **3 new tables** are needed:

#### New Table 1: `payment_providers`

Registry of configured payment providers.

```
payment_providers {
  id text PRIMARY KEY                  -- 'warriorplus'
  display_name text NOT NULL           -- 'WarriorPlus'
  adapter_version text NOT NULL        -- '1.0.0'
  is_enabled boolean NOT NULL DEFAULT false
  
  config jsonb NOT NULL DEFAULT '{}'::jsonb
  allowed_ip_ranges cidr[]             -- Optional IP whitelist
  require_signature_verification boolean DEFAULT true
  is_test_mode boolean NOT NULL DEFAULT false
  
  webhook_url text NOT NULL            -- Generated endpoint
  notes text
  created_at, updated_at
  created_by uuid, updated_by uuid
}
```

#### New Table 2: `payment_provider_secrets`

Encrypted secrets per provider.

```
payment_provider_secrets {
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id text NOT NULL REFERENCES payment_providers(id)
  
  secret_name text NOT NULL            -- 'webhook_secret' | 'api_key'
  secret_value_encrypted text NOT NULL -- pgsodium-encrypted
  description text
  is_active boolean NOT NULL DEFAULT true
  rotated_at, expires_at timestamptz
  created_at, created_by uuid
  
  UNIQUE (provider_id, secret_name) WHERE is_active
}
```

#### New Table 3: `provider_products`

**This is the critical table for the RobinOS Pro Plan business rule.**

Admin-configurable product mapping with configurable duration. This is where the "6-month" lives.

```
provider_products {
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  provider_id text NOT NULL REFERENCES payment_providers(id)
  
  -- Provider's identification
  provider_product_id text NOT NULL    -- WP item_id
  provider_offer_id text               -- Optional: variant ID
  
  -- RobinOS mapping
  plan_key text NOT NULL               -- 'creator' | 'pro_creator' | 'agency'
    CHECK (plan_key IN ('free', 'creator', 'pro_creator', 'agency'))
  billing_cycle text NOT NULL
    CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time'))
  
  -- Duration (configurable — NOT hardcoded)
  duration_value numeric NOT NULL CHECK (duration_value > 0)
  duration_unit text NOT NULL
    CHECK (duration_unit IN ('day', 'week', 'month', 'year'))
  
  -- Pricing
  amount numeric NOT NULL CHECK (amount >= 0)
  currency text NOT NULL DEFAULT 'USD'
  
  -- Type
  is_subscription boolean NOT NULL DEFAULT false
  is_enabled boolean NOT NULL DEFAULT true
  
  -- Display
  display_name text                    -- 'RobinOS Pro Plan'
  description text
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  
  -- Audit
  created_at, updated_at
  created_by uuid, updated_by uuid
  
  UNIQUE (provider_id, provider_product_id, COALESCE(provider_offer_id, ''))
}
```

**For RobinOS Pro Plan:**
```
INSERT INTO provider_products (
  provider_id, provider_product_id,
  plan_key, billing_cycle,
  duration_value, duration_unit,
  amount, currency,
  is_subscription,
  display_name, description
) VALUES (
  'warriorplus', 'wp_robinOS_pro',
  'pro_creator', 'one_time',
  6, 'month',
  39, 'USD',
  false,
  'RobinOS Pro Plan', '6-month Pro Creator access'
);
```

**For future products** (no code changes — admin adds rows):
- `30, 'day'` → 30-day pass
- `12, 'month'` → annual
- `100, 'year'` → lifetime

### 2.5 Tables NOT Needed (Confirmed by Audit)

These were proposed in earlier architecture drafts but are NOT needed after audit:

| Table | Reason Not Needed |
|-------|-------------------|
| `purchases` (new) | Reuse `payments` table with additive migration |
| `webhook_events` (new) | **WAIT — keep this.** It's needed for the universal webhook log. |
| `user_product_grants` | **NOT NEEDED for this product.** Use `user_subscriptions` directly with `expires_at` set to `now + 6 months`. Stacking via V2 `user_product_grants` is a future consideration but not required for RobinOS Pro Plan MVP. |
| `provider_customer_links` | **NOT NEEDED for MVP.** User lookup via email match is sufficient. Customer linking becomes relevant for recurring billing (Phase 2). |
| `webhook_dead_letter` (separate) | **NOT NEEDED.** Use existing `subscription_webhook_events.status` extension OR add to `webhook_events`. |

**Wait — reconsidering `webhook_events`.** Yes, we do need this. The existing `subscription_webhook_events` is idempotency-only. For admin search and observability we need a richer log. So:

**Keep `webhook_events` as new table #4.**

**Final new tables: 4** (not 6 from the previous generic architecture):

1. `payment_providers`
2. `payment_provider_secrets`
3. `provider_products` ← **critical for 6-month duration rule**
4. `webhook_events` ← for admin search + observability

### 2.6 Final Table Reuse Summary

| Category | Count |
|----------|-------|
| Existing tables reused as-is | 21 |
| Existing tables extended additively | 4 (`payments`, `platform_settings`, `profiles`, `payment_provider` enum) |
| Existing tables deprecated | 1 (`payment_events`) |
| New tables required | 4 |
| **Total migrations required** | **3** (was 6 in generic architecture) |

---

## 3. Schema Changes Required

### 3.1 Migration Inventory

**Total: 3 new migrations** (numbered 56-58, continuing from existing 50):

| Migration # | Tables | Type |
|---|---|---|
| 56 | `payment_providers`, `payment_provider_secrets` | New tables |
| 57 | `provider_products`, `webhook_events` | New tables |
| 58 | All RPCs + triggers + `payments` extension + enums | Extension + RPCs |

### 3.2 Migration 56: Provider Registry

**Creates:**
- Table `payment_providers`
- Table `payment_provider_secrets`
- Indexes for both
- RLS policies for both
- Triggers for `updated_at`

**Dependencies:** None (root migration)

**Seeds:** Initial row for 'warriorplus' with `is_enabled = false` (admin enables after config)

**Deployment order:** 1st

### 3.3 Migration 57: Product Mapping + Webhook Log

**Creates:**
- Table `provider_products` (with `duration_value` + `duration_unit`)
- Table `webhook_events`
- Indexes for both
- RLS policies for both
- Triggers for `updated_at`

**Dependencies:** Requires Migration 56 (FK to payment_providers)

**Seeds:** No automatic seeds (admin creates products via admin UI after WP setup)

**Deployment order:** 2nd

### 3.4 Migration 58: Extensions + RPCs

**Extends existing tables:**
- ALTER TABLE `payments` — add 13 new columns (see §2.2)
- ALTER TABLE `platform_settings` — add 2 columns
- ALTER TABLE `profiles` — add 1 column
- ALTER TYPE `payment_provider` — add 'warriorplus'
- ALTER TYPE `payment_status` — add 'partially_refunded', 'charged_back', 'disputed'

**Creates new RPCs (15 total):**

#### Idempotency / Webhook Processing

| RPC | Purpose |
|-----|---------|
| `enqueue_webhook_event(p_provider_id, p_provider_event_id, p_provider_event_type, p_payload, p_headers, p_trace_id)` | Insert into webhook_events idempotently |
| `record_subscription_webhook_event(p_provider_event_id, p_provider, p_event_type, p_payload_hash)` | Insert into subscription_webhook_events (reuses existing migration 31 logic) |
| `process_webhook_event(p_webhook_event_id)` | Atomic processing of single webhook event |
| `process_pending_webhook_events(p_batch_size, p_max_runtime_ms)` | Worker batch entry point |
| `retry_webhook_event(p_webhook_event_id)` | Manual retry |
| `mark_webhook_dead_letter(p_webhook_event_id, p_reason)` | Move to dead letter state |

#### Purchase & Subscription

| RPC | Purpose |
|-----|---------|
| `record_purchase_from_webhook(p_webhook_event_id)` | Insert/update `payments` row from webhook |
| `grant_entitlement_from_purchase(p_purchase_id)` | Call safe_plan_switch with provider='warriorplus' + duration from provider_products |
| `revoke_entitlement_from_purchase(p_purchase_id, p_reason)` | Atomic revocation (for refunds) |
| `recalculate_user_effective_plan(p_user_id)` | Re-derive effective plan after changes |

#### User Resolution

| RPC | Purpose |
|-----|---------|
| `resolve_or_create_user_from_purchase(p_buyer_email, p_buyer_name, p_provider_id, p_create_if_missing)` | Link or create user |
| `send_purchase_claim_email(p_purchase_id, p_buyer_email)` | Magic-link email |
| `complete_purchase_claim(p_claim_token, p_account_data)` | User claims purchase |

#### Admin / Search

| RPC | Purpose |
|-----|---------|
| `search_webhook_events(p_provider_id, p_status, p_buyer_email, p_date_from, p_date_to, p_limit, p_offset)` | Admin search |
| `search_payments(p_provider_id, p_buyer_email, p_user_id, p_payment_status, p_date_from, p_date_to, p_limit, p_offset)` | Admin search |

**Creates new triggers:**

| Trigger | Table | When | Action |
|---------|-------|------|--------|
| `trg_payment_providers_updated_at` | `payment_providers` | BEFORE UPDATE | Set `updated_at` |
| `trg_provider_products_updated_at` | `provider_products` | BEFORE UPDATE | Set `updated_at` |
| `trg_webhook_events_updated_at` | `webhook_events` | BEFORE UPDATE | Set `updated_at` |
| `trg_payments_set_buyer_hash` | `payments` | BEFORE INSERT | Compute `buyer_email_hash` from `buyer_email` |
| `trg_payments_updated_at` | `payments` | BEFORE UPDATE | Set `updated_at` |

**Modifies existing functions:**
- `safe_plan_switch(...)` — **NO CHANGES** (V2 approach: wrapper RPC, not modification)
- New wrapper RPC `safe_plan_grant_for_purchase(p_user_id, p_purchase_id)` that:
  - Reads `provider_products` for the purchase
  - Computes `expires_at = now() + duration` from `duration_value` × `duration_unit`
  - Calls existing `safe_plan_switch` internally
  - This is the entire mechanism for the 6-month business rule

**Dependencies:** Requires Migrations 56 and 57

**Deployment order:** 3rd

### 3.5 Migration Deployment Order

```
Migration 56 (provider registry)
        ↓
Migration 57 (product mapping + webhook log)
        ↓
Migration 58 (RPCs + extensions)
```

---

## 4. Generic Provider Architecture (Condensed)

The full architecture is in `warriorplus-generic-payment-provider-architecture.md`. This plan uses that as the foundation.

### 4.1 Provider Adapter Interface (Recap)

```
PaymentProviderAdapter {
  id, displayName, version
  verifyWebhookSignature(rawBody, headers, secret): VerificationResult
  parseWebhookPayload(rawBody, contentType): ProviderRawEvent
  mapEventType(rawEvent): StandardizedEventType
  extractTransactionInfo(rawEvent): TransactionInfo
  extractBuyerInfo(rawEvent): BuyerInfo
  extractProductInfo(rawEvent): ProviderProductInfo
}
```

### 4.2 Standardized Event Types (Recap)

WP events map to:

| WP Event | Standardized Event |
|----------|-------------------|
| `SALE` | `purchase.created` |
| `RFND` | `purchase.refunded` |
| `CGBK` | `purchase.charged_back` |
| `BILL` | `subscription.renewed` |
| `CANCEL` | `subscription.cancelled` |
| `INSF` | `subscription.payment_failed` |
| `dispute.won` | `dispute.won` |
| `dispute.lost` | `dispute.lost` |
| Unknown | `unknown` |

### 4.3 Component Layout (Condensed)

```
supabase/functions/
├── payment-webhook/                  (URL: /functions/v1/payment-webhook/{provider_id})
├── process-payment-events/           (cron-invoked worker)
├── admin-payment-providers/          (admin RPCs)
├── _shared/payment/
│   ├── base-adapter.ts               (PaymentProviderAdapter interface)
│   ├── adapters/warriorplus/         (First concrete adapter)
│   ├── identity-resolver.ts
│   ├── purchase-recorder.ts
│   ├── subscription-grantor.ts
│   ├── refund-handler.ts
│   ├── commission-handler.ts
│   ├── notifier.ts
│   └── evidence-builder.ts
```

---

## 5. Webhook Flow

### 5.1 Complete Lifecycle

```
POST /functions/v1/payment-webhook/warriorplus
   ↓
[1] Route resolution (provider_id = 'warriorplus' from URL)
   ↓
[2] Provider lookup (load from payment_providers; check is_enabled)
   ↓
[3] Rate limit check (per-IP, per-provider)
   ↓
[4] Read raw body (preserve for signature verification)
   ↓
[5] Signature verification via WP adapter
   ↓ (constant-time comparison)
[6] Parse payload via WP adapter
   ↓
[7] Extract provider_event_id
   ↓
[8] Idempotency check via subscription_webhook_events (existing)
   ↓ (UNIQUE constraint catches duplicates)
[9] Insert into webhook_events (rich log, never discarded)
   ↓
[10] Insert into subscription_webhook_events (idempotency record)
   ↓
[11] Return 200 ACK to WP
   ↓
   ════════ ASYNC BOUNDARY ════════
   ↓
[12] Worker cron picks up webhook_events row
   ↓ (SELECT FOR UPDATE SKIP LOCKED)
[13] Load WP adapter
   ↓
[14] Map event type via adapter
   ↓
[15] Extract transaction, buyer, product info via adapter
   ↓
[16] Resolve RobinOS user via email match
   ↓
[17] Lookup provider_products for plan mapping
   ↓
[18] Insert/update payments row
   ↓
[19] Call grant_entitlement_from_purchase(purchase_id)
   ↓
[20] RPC reads provider_products.duration_value + duration_unit
   ↓
[21] Computes expires_at = purchased_at + duration_in_days
   ↓
[22] Calls safe_plan_switch(user_id, 'pro_creator', 'one_time',
                              'warriorplus', txn_id, $39, 'warriorplus_webhook')
   ↓
[23] safe_plan_switch UPSERTs user_subscriptions with computed expires_at
   ↓
[24] Updates profiles.subscription_tier, current_plan, subscription_expires_at
   ↓
[25] Records subscription_audit_log
   ↓
[26] Records affiliate commission (per §9)
   ↓
[27] Updates webhook_events status='processed', linked_purchase_id, linked_user_id
   ↓
[28] Emits admin notification (info)
```

### 5.2 Failure Modes

Same as generic architecture:

| Failure | Response |
|---------|----------|
| Provider not found | 404 |
| Provider disabled | 503 |
| Rate limit | 429 |
| Signature fail | 401 (no enqueue) |
| Parse fail | 400 (no enqueue) |
| Duplicate (idempotency hit) | 200 with `{duplicate: true}` |
| DB unavailable | 503 |
| Worker fails (retryable) | retry with backoff |
| Worker fails (terminal) | dead letter, admin notify |
| Unknown product | `webhook_events.status = 'blocked'` |
| Unknown user | create pending claim |
| Admin intervention | `webhook_events.status = 'awaiting_admin'` |

---

## 6. Entitlement Grant Logic (6-Month Configurable)

### 6.1 The Core Logic

This is the most important piece — the 6-month business rule.

**The duration comes from `provider_products`, NEVER from code.**

```
SafePlanGrantForPurchase(p_user_id, p_purchase_id) {
  // 1. Load purchase
  purchase = SELECT * FROM payments WHERE id = p_purchase_id
  
  // 2. Load provider product (admin-configurable mapping)
  product = SELECT * FROM provider_products 
            WHERE provider_id = purchase.provider 
              AND provider_product_id = purchase.provider_payment_id
              AND is_enabled = true
  
  // 3. Compute expires_at from configurable duration
  //     For RobinOS Pro Plan: duration_value=6, duration_unit='month'
  //     For future products: any value/unit combo
  duration_in_days = compute_duration_in_days(
    product.duration_value,  -- e.g., 6
    product.duration_unit    -- e.g., 'month'
  )
  expires_at = purchase.paid_at + INTERVAL '1 day' * duration_in_days
  
  // 4. Call existing safe_plan_switch (no modifications)
  safe_plan_switch(
    p_user_id         = purchase.user_id,
    p_new_plan        = product.plan_key,             -- 'pro_creator'
    p_billing_cycle   = product.billing_cycle,       -- 'one_time'
    p_provider        = purchase.provider,           -- 'warriorplus'
    p_provider_sub_id = purchase.provider_payment_id,
    p_amount          = purchase.amount,             -- 39
    p_triggered_by    = 'warriorplus_webhook'
  )
  
  // 5. Override expires_at with computed duration (because safe_plan_switch
  //    defaults to 30 days for monthly or 365 for yearly)
  UPDATE user_subscriptions
     SET expires_at = computed_expires_at,
         auto_renew = false,                          -- one-time
         billing_cycle = 'one_time',
         amount = purchase.amount,
         currency = purchase.currency,
         provider = 'warriorplus',
         provider_subscription_id = purchase.provider_payment_id,
         subscription_source = 'warriorplus',
         is_revenue_eligible = true,                  -- real revenue
         last_payment_at = purchase.paid_at,
         next_billing_at = NULL                       -- no recurring
   WHERE user_id = purchase.user_id
}
```

**The duration logic:**

```
compute_duration_in_days(value, unit) {
  CASE unit
    WHEN 'day'   THEN value
    WHEN 'week'  THEN value * 7
    WHEN 'month' THEN value * 30        -- Approximate; calendar-aware via SQL date math
    WHEN 'year'  THEN value * 365
  END
}
```

For calendar-accurate months/years, use PostgreSQL's `INTERVAL`:

```
duration_interval = make_interval(
  days  = CASE unit WHEN 'day'   THEN value ELSE 0 END,
  weeks = CASE unit WHEN 'week'  THEN value ELSE 0 END,
  months= CASE unit WHEN 'month' THEN value ELSE 0 END,
  years = CASE unit WHEN 'year'  THEN value ELSE 0 END
)
expires_at = purchased_at + duration_interval
```

**For RobinOS Pro Plan:** `make_interval(months => 6)` → expires exactly 6 calendar months from purchase.

### 6.2 Expiry Processing

The existing `process_subscription_expiry` cron (from migration 31) handles expiry:

```
process_subscription_expiry() {
  // Finds subscriptions with expires_at <= now()
  // Sets status = 'expired'
  // Reverts profiles.subscription_tier = 'free'
}
```

**No changes needed.** The existing cron handles the 6-month expiry automatically because `safe_plan_switch` sets `expires_at` correctly.

For the 6-month business rule to work:
1. WP purchase arrives
2. Worker calls `grant_entitlement_from_purchase`
3. RPC reads `provider_products.duration_value=6, duration_unit='month'`
4. Sets `user_subscriptions.expires_at = now() + 6 months`
5. `process_subscription_expiry` cron fires later
6. When `expires_at <= now()`, user is downgraded to free

### 6.3 Re-Purchase After Expiry

Scenario: User's 6-month access expires. They buy again via WP.

```
1. New SALE event arrives
2. Worker resolves user (already exists from previous purchase)
3. Looks up provider_products (still mapped to 'pro_creator' 6-month)
4. Calls grant_entitlement_from_purchase
5. safe_plan_switch UPSERTs user_subscriptions (overwrites)
6. New expires_at = now() + 6 months (full new term)
7. profiles.subscription_tier = 'pro_creator' again
```

The UPSERT in `safe_plan_switch` correctly handles re-purchase. The user's plan is restored for another 6 months.

### 6.4 Re-Purchase While Active

If user buys again while their first 6-month term is still active:

**Per V2 stacking matrix:**
- Same provider + same plan + same item → REJECT (true duplicate)

So duplicate purchases of the same product while active are rejected. If user wants to "extend" their access, they need to wait for expiry.

**Admin override** possible via admin RPC.

---

## 7. Refund & Dispute Handling

### 7.1 Refund Flow

When WP sends `RFND` event:

```
1. Worker processes webhook_events row
2. Adapter extracts: provider_transaction_id, refund_amount
3. Locate original purchase via provider_transaction_id
4. Determine refund type (full vs partial):
   - Full: refund_amount == purchase.amount
   - Partial: refund_amount < purchase.amount
5. Branch on billing_cycle:
   - 'one_time' + full refund → IMMEDIATE downgrade
   - 'one_time' + partial refund → no entitlement change
   - 'monthly/yearly' + full → preserve until expires_at (future-proofing)
   - 'monthly/yearly' + partial → no entitlement change
6. UPDATE payments:
   - status = 'refunded' or 'partially_refunded'
   - refunded_amount += refund_amount
   - refunded_at = now()
7. For full refund of one-time:
   - UPDATE user_subscriptions SET status = 'cancelled', auto_renew = false
   - UPDATE profiles SET subscription_tier = 'free', subscription_expires_at = NULL
8. Reverse commission (if any)
9. Audit log
10. Admin notification
```

### 7.2 Chargeback Flow

When WP sends `CGBK`:

```
1. Worker processes webhook_events row
2. Locate original purchase
3. UPDATE payments: status = 'charged_back', charged_back_at = now()
4. IMMEDIATE downgrade:
   - user_subscriptions.status = 'cancelled'
   - profiles.subscription_tier = 'free'
   - auto_renew = false
5. Reverse commission with requires_manual_recovery flag if paid
6. Insert into dispute tracking
7. Generate dispute evidence
8. Admin notification (CRITICAL)
```

### 7.3 Dispute Resolution

```
dispute.won:
  - Restore subscription (call safe_plan_switch with original params)
  - Re-grant entitlement
  - payments.status = 'succeeded'

dispute.lost:
  - Subscription stays cancelled
  - payments.status = 'charged_back' remains
  - Commission reversal stands
```

---

## 8. User Creation Flow

### 8.1 Decision Matrix

| Existing User? | Action |
|----------------|--------|
| Yes (email match) | Link purchase, grant entitlement immediately |
| No + admin setting `require_email_verification = true` | Create pending claim, send magic-link email |
| No + admin setting `require_email_verification = false` | Auto-create account, grant entitlement |

### 8.2 Existing User Linking

```
1. Find auth.users by email (case-insensitive)
2. Link purchase.user_id to existing user
3. Insert payment row with user_id set
4. Grant entitlement (call safe_plan_switch)
5. No new auth.users row created
```

### 8.3 New User Creation (Magic-Link)

```
1. Payment recorded with user_id = NULL, status = 'pending'
2. claim_token generated
3. magic_link_token generated (separate)
4. magic_link_expires_at = now() + 24 hours
5. claim_expires_at = now() + 30 days
6. Insert into webhook_events.pending_claim_token
7. Email sent to buyer_email
8. User clicks magic link → /claim/verify?token=...
9. User confirms email + sets password
10. auth.users + profiles created
11. Payment linked to new user_id
12. Worker re-processes → entitlement granted
```

### 8.4 New User Creation (Auto-Create)

```
1. auth.users row created with random password + email_verified = true
2. profiles row created with buyer_email
3. Payment linked to user_id
4. Entitlement granted immediately
5. Email sent: "Set your password to access RobinOS"
```

---

## 9. Affiliate Handling

### 9.1 Commission Suppression

**Default behavior:** WP sales do NOT trigger RobinOS affiliate commission.

**Rationale:** WarriorPlus has its own affiliate system that pays its affiliates from the vendor's share. RobinOS should not double-pay.

**Exception:** If the buyer came via a RobinOS affiliate link (signed `rbin_ref` in URL), RobinOS affiliate earns commission at a reduced rate.

### 9.2 Commission Recording

When commission IS earned (rbin_ref present):

```
1. Locate affiliate_user_id via referral_code in profiles.affiliate_profiles
2. Look up platform_settings.affiliate_commission_percent (default 30%)
3. Calculate: commission_amount = $39 * 0.30 = $11.70
4. Insert into affiliate_commissions:
   - affiliate_user_id
   - referred_user_id
   - subscription_id (FK to user_subscriptions)
   - dodo_subscription_id / provider_payment_id (use provider_payment_id field)
   - amount = $11.70
   - status = 'pending'
   - eligible_at = now() + 14 days
5. Call increment_affiliate_balance (existing RPC, reused)
6. Emit commission_events entry
7. Admin notification
```

### 9.3 Reuse of Existing Affiliate Tables

- `affiliate_profiles` — reused as-is
- `affiliate_commissions` — reused, may need `provider_payment_id` column added
- `commission_events` — reused
- `affiliate_wallet_ledger` — reused
- All existing RPCs (approve_commission, reverse_commission, etc.) — reused

**One additive change:**
```
ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS
  provider_payment_id text;
```

This allows the commission to be linked to the WP transaction ID for reversal purposes.

---

## 10. Edge Functions Inventory

### 10.1 Entry Point Functions

**1. `payment-webhook`** (URL-routed dispatcher)
- Path: `/functions/v1/payment-webhook/{provider_id}`
- verify_jwt: false
- Size: ~150 lines
- Purpose: Receive webhooks from any provider, route to adapter, enqueue

**2. `process-payment-events`** (async worker)
- Cron-invoked
- verify_jwt: false
- Size: ~250 lines
- Purpose: Process queued webhook_events

**3. `admin-payment-providers`** (admin RPCs)
- Path: `/functions/v1/admin-payment-providers`
- verify_jwt: true (admin only)
- Size: ~300 lines
- Purpose: Provider registration, product mapping, secret rotation, search

**4. `verify-purchase-claim`** (claim workflow)
- Path: `/functions/v1/verify-purchase-claim`
- verify_jwt: false (token-based auth)
- Size: ~200 lines
- Purpose: Magic-link verification, account creation, claim completion

### 10.2 Shared Modules

In `_shared/payment/`:

| Module | Purpose | Size |
|--------|---------|------|
| `base-adapter.ts` | PaymentProviderAdapter interface | ~150 lines |
| `adapters/warriorplus/index.ts` | First concrete adapter | ~600 lines |
| `adapters/warriorplus/signature.ts` | WP HMAC verification | ~80 lines |
| `adapters/warriorplus/normalize.ts` | WP payload parsing | ~200 lines |
| `adapters/warriorplus/event-map.ts` | WP → standardized events | ~100 lines |
| `identity-resolver.ts` | User resolution priority | ~150 lines |
| `purchase-recorder.ts` | Insert/update payments | ~120 lines |
| `subscription-grantor.ts` | Grant entitlement with duration | ~120 lines |
| `refund-handler.ts` | Refund with billing_cycle branch | ~120 lines |
| `commission-handler.ts` | Affiliate commission logic | ~150 lines |
| `notifier.ts` | Admin notifications | ~80 lines |
| `evidence-builder.ts` | Dispute evidence | ~80 lines |

**Total estimated code: ~2,700 lines across all Edge Functions.**

---

## 11. Frontend Changes

### 11.1 New Pages

| Route | Purpose |
|-------|---------|
| `/claim/verify` | Magic link verification |
| `/claim/setup` | Password setup after verification |
| `/claim/complete` | Success page |
| `/purchase/error` | Error page |
| `/purchase/pending` | Processing page (polls status) |

### 11.2 Modified Pages

| File | Change |
|------|--------|
| `src/pages/Pricing.tsx` | Add "Buy via WarriorPlus" CTA |
| `src/components/UpgradeDialog.tsx` | Add WP as payment option |
| `src/pages/AffiliatePage.tsx` | Add disclosure about WP commission |
| `src/pages/SettingsPage.tsx` | Show WP-sourced subscriptions |
| `src/lib/payments/types.ts` | Add `warriorplus` provider type |

### 11.3 New Client Files

| File | Purpose |
|------|---------|
| `src/lib/payments/warriorplus.ts` | Client wrapper for build-link RPC |
| `src/lib/payments/generic.ts` | Generic provider client (provider-agnostic) |

### 11.4 Admin Pages (New)

| Route | Purpose |
|-------|---------|
| `/admin/payments/providers` | Provider registry |
| `/admin/payments/products` | Product mapping (CRITICAL for 6-month rule) |
| `/admin/payments/diagnostics` | Webhook search |
| `/admin/payments/purchases` | Purchase search |
| `/admin/payments/claims` | Pending claims |

---

## 12. Admin Panel

### 12.1 Provider Registry (`/admin/payments/providers`)

**Capabilities:**
- View registered providers (initially: WarriorPlus)
- Enable/disable provider
- View webhook URL (to configure in provider dashboard)
- Rotate secrets
- View provider health (recent webhook activity, error rate)

### 12.2 Product Mapping (`/admin/payments/products`) — **CRITICAL**

**This page is where the 6-month business rule is configured.**

**Capabilities:**
- List all provider_products mappings
- Add new mapping: form with provider, product_id, plan_key, billing_cycle, **duration_value**, **duration_unit**, amount, is_subscription
- Edit existing mapping
- Enable/disable mapping
- View products by status

**Form fields:**
```
- Provider: [dropdown: warriorplus, ...]
- Provider Product ID: [text input: wp_xxx]
- Provider Offer ID: [text input: optional]
- RobinOS Plan: [dropdown: creator, pro_creator, agency]
- Billing Cycle: [dropdown: monthly, yearly, one_time]
- Duration Value: [numeric input]
- Duration Unit: [dropdown: day, week, month, year]
- Amount: [numeric input]
- Currency: [dropdown: USD, EUR, GBP]
- Is Subscription: [checkbox]
- Display Name: [text input]
- Description: [textarea]
- Enabled: [checkbox]
```

**Example for RobinOS Pro Plan:**
```
Provider: warriorplus
Provider Product ID: wp_robinOS_pro
RobinOS Plan: pro_creator
Billing Cycle: one_time
Duration Value: 6
Duration Unit: month
Amount: 39
Currency: USD
Is Subscription: false
Display Name: RobinOS Pro Plan
Enabled: true
```

### 12.3 Diagnostics (`/admin/payments/diagnostics`)

**Search by:**
- Email (hashed)
- Provider transaction ID
- Provider event ID
- Webhook event ID
- User ID
- Date range
- Status

**Tabs:**
- Recent webhooks (last 100)
- Failed events
- Awaiting claim
- Awaiting admin
- Processing latency stats

### 12.4 Purchases (`/admin/payments/purchases`)

**Search by:**
- Email
- Transaction ID
- User ID
- Plan
- Payment status
- Date range

**Columns:**
- Date, Provider, Product, Plan, Amount, Status, Buyer (masked), User

### 12.5 Pending Claims (`/admin/payments/claims`)

**Capabilities:**
- List pending claims
- Resend magic link
- Manually link to user (super_admin)
- Mark as abandoned

---

## 13. Background Jobs

### 13.1 Cron Jobs

| Cron | Schedule | Purpose |
|------|----------|---------|
| `process-payment-events` | Every 30s | Process webhook_events queue |
| `cleanup-expired-magic-links` | Every hour | Mark expired magic links |
| `cleanup-expired-claims` | Every 6h | Mark unclaimed purchases (30-day window) |
| `process-subscription-expiry` | Hourly | Existing — handles 6-month expiry |
| `cleanup-old-webhook-events` | Daily | Archive events > 90 days (optional) |

### 13.2 The Existing Subscription Expiry Cron Does the Heavy Lifting

**No new expiry cron needed.** The existing `process_subscription_expiry()` (migration 31) already:
- Finds subscriptions with `expires_at <= now()`
- Sets `status = 'expired'`
- Reverts `profiles.subscription_tier = 'free'`

This means: When WP purchase sets `expires_at = now() + 6 months`, the existing cron handles the 6-month expiry automatically. **No new code needed for the core business rule.**

### 13.3 Queue Types

| Queue | Type | Backed By |
|-------|------|-----------|
| Webhook events | Database | `webhook_events` table |
| Magic-link retry | Database | Same table (failed_retryable) |
| Admin notifications | Existing | `push_admin_notification` RPC |

---

## 14. Observability

### 14.1 Search Capabilities

**The system must support searching by:**
- Email (buyer)
- Provider transaction ID (sale ID)
- Provider product ID
- Webhook event ID
- User ID
- Date range
- Status

### 14.2 Webhook Events Search

Query via `search_webhook_events` RPC:
```
SELECT id, provider_id, provider_event_id, provider_event_type,
       status, trace_id, received_at, processed_at,
       linked_purchase_id, linked_user_id, retry_count, last_error
FROM webhook_events
WHERE provider_id = $1
  AND status = $2
  AND received_at BETWEEN $3 AND $4
ORDER BY received_at DESC
LIMIT 100
```

### 14.3 Purchase Search

Query via `search_payments` RPC:
```
SELECT id, provider, provider_payment_id, plan_key, billing_cycle,
       amount, currency, status, refunded_amount,
       buyer_email_hash, buyer_email_masked, user_id,
       purchased_at, refunded_at
FROM payments
WHERE provider = $1
  AND (status = $2 OR $2 IS NULL)
  AND buyer_email_hash = $3  -- hashed before query
  AND created_at BETWEEN $4 AND $5
ORDER BY created_at DESC
LIMIT 100
```

### 14.4 Metrics

Track via structured logs:
- `webhook.received.count` by provider, event type
- `webhook.processed.count` by provider, outcome
- `webhook.failed.count` by provider, error category
- `webhook.processing.duration_ms` p50, p95, p99
- `purchase.created.count` by provider, plan
- `purchase.refunded.count` by provider
- `claim.completed.count` by provider
- `claim.expired.count` by provider
- `queue.depth` by status

### 14.5 Alerting Rules

| Alert | Condition | Priority |
|-------|-----------|----------|
| Signature failures | > 5 in 5 min from same provider | CRITICAL |
| Queue backlog | > 1000 pending for > 5 min | WARNING |
| Failed events | > 50 failed_retryable | WARNING |
| Unknown product | New item_id, not in provider_products | WARNING |
| Claim expiry | Pending > 7 days | WARNING |
| Processing latency | p95 > 30s for > 10 min | WARNING |

---

## 15. Testing Strategy

### 15.1 Test Scenarios for RobinOS Pro Plan Specifically

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | First-time WP purchase of RobinOS Pro Plan | pro_creator granted, expires_at = now + 6 months |
| 2 | Purchase for existing free user | pro_creator granted, expires_at = now + 6 months |
| 3 | Purchase for existing pro_creator user (active) | REJECT (same provider + same plan) |
| 4 | Purchase for expired user | New 6-month term starts |
| 5 | Duplicate webhook for same SALE | Idempotent — only one grant |
| 6 | Full refund of RobinOS Pro Plan | Immediate downgrade to free |
| 7 | Partial refund of RobinOS Pro Plan | No entitlement change |
| 8 | 6-month term expires naturally | User downgraded to free by existing cron |
| 9 | Re-purchase after 6-month expiry | New 6-month term starts |
| 10 | Admin changes duration_value to 3 (months) | Next purchase gets 3-month duration |
| 11 | Admin changes plan mapping to creator | Next purchase gets creator plan |
| 12 | Admin disables product | New purchases blocked, admin notified |
| 13 | Unknown item_id | Webhook blocked, admin notified |
| 14 | Invalid signature | 401 returned, no enqueue |
| 15 | Replayed webhook | Idempotency catches |
| 16 | Guest purchase (no existing user) | Magic-link email sent |
| 17 | Magic link verification + account creation | Account created, entitlement granted |
| 18 | Expired magic link (after 24h) | Verification fails, user must request new |
| 19 | Affiliate attribution via rbin_ref | Commission recorded (if rbin_ref present) |
| 20 | No affiliate attribution | No commission recorded (suppression default) |

### 15.2 General Webhook Tests

- Successful purchase (covered above)
- Duplicate webhook (covered above)
- Invalid hash / signature failure (covered above)
- Unknown product (covered above)
- Unknown user (covered above)
- Retry behavior
- Timeout scenarios
- Race conditions (two webhooks simultaneously)

### 15.3 Load Tests

- 1000 webhooks/minute sustained for 1 hour
- Burst of 100 webhooks in 1 second
- Worker recovery from crash mid-batch

---

## 16. Deployment Plan

### 16.1 Pre-Deployment Validation

**Must complete before deployment:**

- [ ] WP vendor validation complete (signature algorithm confirmed)
- [ ] All migrations tested on staging
- [ ] All Edge Functions deployed and tested on staging
- [ ] Worker cron tested on staging
- [ ] Admin pages functional
- [ ] Load test passed (1000/min for 1h)
- [ ] Rollback procedure tested
- [ ] Monitoring configured

### 16.2 Deployment Stages

```
Day 1: Deploy Migration 56 (provider registry) + Migration 57 (product mapping + webhook log)
       Verify on production
       
Day 2: Deploy Migration 58 (RPCs + payments extension)
       Verify on production
       Smoke test RPCs callable
       
Day 3: Deploy Edge Functions (payment-webhook, process-payment-events, admin-payment-providers)
       With is_enabled = false for warriorplus provider
       Verify functions deployable
       
Day 4: Deploy worker cron
       Test with empty queue
       Insert test event, verify processed
       
Day 5: Admin creates the RobinOS Pro Plan mapping via admin UI
       duration_value=6, duration_unit=month, plan_key=pro_creator
       
Day 6: Enable warriorplus provider (is_enabled = true)
       Internal team tests with test WP product
       
Day 7-14: Internal testing with test WP products
       
Day 15: Enable for 10-50 beta users (manual allowlist)
         Monitor every 15 minutes
         
Day 16-30: Beta testing, daily review
           
Day 31: Enable for general public
```

### 16.3 Configuration in WarriorPlus Dashboard

Once Edge Functions are deployed, admin must:

1. Log into WarriorPlus vendor dashboard
2. Configure product "RobinOS Pro Plan"
3. Set IPN/notification URL: `https://<supabase-url>/functions/v1/payment-webhook/warriorplus`
4. Note the WP product ID (will be added to `provider_products`)
5. Configure IPN events: SALE, RFND, CGBK, CANCEL, INSF, dispute events

### 16.4 Provider Product Registration

Via admin UI at `/admin/payments/products`:

```
Provider: warriorplus
Provider Product ID: <from WP dashboard>
RobinOS Plan: pro_creator
Billing Cycle: one_time
Duration Value: 6
Duration Unit: month
Amount: 39
Currency: USD
Is Subscription: false
Display Name: RobinOS Pro Plan
Enabled: true
```

---

## 17. Rollback Strategy

### 17.1 Rollback Levels

**Level 1: Disable Provider (Immediate, < 1 min)**
- Set `payment_providers.is_enabled = false` for warriorplus
- Public CTAs hidden
- Existing WP purchases continue working
- Use case: Marketing issue, UI bug

**Level 2: Stop Worker (< 5 min)**
- Disable `process-payment-events` cron
- Events accumulate in queue
- Existing entitlements preserved
- Use case: Worker bug

**Level 3: Reject Webhooks (< 5 min)**
- Update `payment-webhook` to return 503 for all
- WP retries (eventually fails after 7 days)
- Use case: Critical bug

**Level 4: Full Database Rollback (Destructive)**
- Reverse migrations: drop new tables, drop new columns, revert enums
- Disables WP integration entirely
- Use case: Catastrophic failure
- WARNING: Data loss for any WP purchases made

### 17.2 Data Preservation

For Levels 1-3, data preserved:
- webhook_events rows stay (with status reflecting actual state)
- payments rows stay
- subscriptions remain granted

For Level 4, data preservation:
- Backup taken before rollback
- `user_subscriptions` rows preserved (not dropped)
- WP-specific `payments` rows preserved if not dropped
- `webhook_events` preserved if not dropped

### 17.3 Reverse Migration Order

If Level 4 rollback required:

```
1. Backup all new tables (payment_providers, payment_provider_secrets, provider_products, webhook_events)
2. Reverse Migration 58:
   - Drop new RPCs
   - Drop new triggers
   - Drop new columns on payments, platform_settings, profiles
   - Cannot drop enum values once added (PG limitation — leave as-is)
3. Reverse Migration 57:
   - DROP webhook_events
   - DROP provider_products
4. Reverse Migration 56:
   - DROP payment_provider_secrets
   - DROP payment_providers
5. Notify users if any active WP subscriptions
6. Plan remediation
```

---

## 18. Launch Checklist

### 18.1 Pre-Launch (Must Pass)

#### Database
- [ ] All 3 migrations applied to production
- [ ] All RPCs callable
- [ ] All triggers firing
- [ ] RLS policies verified
- [ ] Indexes created and used
- [ ] No existing data affected
- [ ] Backup verified

#### Edge Functions
- [ ] All 4 entry points deployed
- [ ] All shared modules deployed
- [ ] verify_jwt settings correct
- [ ] Secrets set in Supabase Dashboard
- [ ] HMAC algorithm validated
- [ ] WP-specific signature test passed

#### WarriorPlus Configuration
- [ ] IPN URL configured in WP vendor dashboard
- [ ] WP product ID captured
- [ ] Test purchase completed via WP sandbox
- [ ] IPN signature verified by dispatcher

#### Provider Product Mapping
- [ ] RobinOS Pro Plan registered in provider_products
- [ ] duration_value=6, duration_unit='month verified
- [ ] plan_key=pro_creator verified
- [ ] billing_cycle=one_time verified
- [ ] amount=39, currency=USD verified
- [ ] is_enabled=true verified

#### Admin
- [ ] Admin pages accessible
- [ ] Permission boundaries verified
- [ ] Audit logging working

#### Background Jobs
- [ ] Worker cron configured
- [ ] Existing subscription expiry cron confirmed working
- [ ] Magic link cleanup cron configured

#### Monitoring
- [ ] Queue depth alerts configured
- [ ] Signature failure alerts configured
- [ ] Unknown product alerts configured
- [ ] Claim expiry alerts configured
- [ ] On-call rotation established

#### Security
- [ ] HMAC algorithm verified
- [ ] Rate limiting configured
- [ ] Secrets rotated for production
- [ ] Admin actions audit-logged
- [ ] RLS policies tested

#### Documentation
- [ ] Architecture docs published
- [ ] Admin user guide written
- [ ] Customer FAQ updated
- [ ] Support runbook created

#### Legal & Compliance
- [ ] Terms of Service updated
- [ ] Refund policy disclosed
- [ ] Affiliate TOS updated
- [ ] GDPR compliance verified
- [ ] PCI scope confirmed

### 18.2 Launch Day Procedure

```
T-24h: Final dry-run
T-12h: Verify all monitoring active
T-4h:  Confirm provider product mapping exists
T-2h:  Internal team uses WP test product
T-0:   Enable for beta users (10-50)
T+2h:  Monitor for issues
T+24h: Beta metrics reviewed
T+7d:  Expand to 100-500 users
T+14d: Expand to 1000-5000 users
T+30d: Full public enable
```

### 18.3 Success Metrics (KPIs)

| Metric | Target |
|--------|--------|
| WP sales successfully processed | ≥ 99% |
| Magic-link claim completion | ≥ 85% |
| 6-month expiry accuracy | 100% |
| Refund processing accuracy | 100% |
| Chargeback response time | < 24 hours |
| Worker p95 processing time | < 5 seconds |
| Dead letter events | < 5 per week |
| Admin interventions | < 10 per 1000 sales |

### 18.4 Launch Approval

Required sign-offs:
- [ ] Engineering Lead
- [ ] Product Manager
- [ ] Customer Support Lead
- [ ] Security Reviewer
- [ ] Legal/Compliance
- [ ] Executive Sponsor

---

## 19. Future Product Templates

After RobinOS Pro Plan is live, admin can add new products via UI only. No code changes.

### 19.1 Template Configurations

| Product Name | plan_key | billing_cycle | duration_value | duration_unit | amount | is_subscription |
|---|---|---|---|---|---|---|
| RobinOS Pro Plan | pro_creator | one_time | 6 | month | 39 | false |
| RobinOS 30-Day Pass | creator | one_time | 30 | day | 19 | false |
| RobinOS 90-Day Pass | creator | one_time | 3 | month | 29 | false |
| RobinOS Annual | pro_creator | one_time | 12 | month | 99 | false |
| RobinOS Lifetime | agency | one_time | 100 | year | 299 | false |
| RobinOS Agency Lifetime | agency | one_time | 100 | year | 999 | false |
| RobinOS Monthly Pro | pro_creator | monthly | 1 | month | 39 | true |
| RobinOS Annual Pro | pro_creator | yearly | 12 | month | 299 | true |

**Each row is added via admin UI.** No code changes. No deployments.

### 19.2 Cross-Provider Mapping

Same plan can be sold via different providers with different pricing:

| Plan | Provider | Product ID | Amount | Duration |
|------|----------|------------|--------|----------|
| Pro Creator | WarriorPlus | wp_pro_6mo | $39 | 6 months |
| Pro Creator | WarriorPlus | wp_pro_annual | $99 | 12 months |
| Pro Creator | Dodo | dodo_pro_monthly | $39 | 1 month (recurring) |
| Pro Creator | JVZoo | jv_pro_lifetime | $199 | lifetime |
| Pro Creator | Stripe | stripe_pro_monthly | $39 | 1 month (recurring) |

All map to the same `plan_key = 'pro_creator'`. The user gets `pro_creator` features regardless of which provider they used.

---

## 20. Summary

### 20.1 What This Plan Delivers

1. **Generic Payment Provider Architecture** — WarriorPlus is the first adapter; future providers plug in by implementing one adapter interface
2. **RobinOS Pro Plan (6 Months, $39, One-Time)** — Configurable via `provider_products` table, NOT hardcoded
3. **Maximum reuse of existing tables** — 21 existing tables reused as-is, 4 extended additively, only 4 new tables
4. **Automatic 6-month expiry** — Leverages existing `process_subscription_expiry` cron
5. **Full audit trail** — Every webhook, every purchase preserved forever
6. **Future-proof for recurring billing** — Schema supports `is_subscription = true` for future monthly/annual plans
7. **Multiple products per provider** — Admin can add unlimited products without code changes
8. **Multiple providers per plan** — Same RobinOS plan sold via multiple providers

### 20.2 The 6-Month Rule — How It Works

```
1. Admin configures provider_products:
   - provider_id = 'warriorplus'
   - provider_product_id = 'wp_xxx'  (WP's ID)
   - plan_key = 'pro_creator'
   - billing_cycle = 'one_time'
   - duration_value = 6              ← NOT hardcoded
   - duration_unit = 'month'         ← NOT hardcoded
   - amount = 39

2. WP sends SALE webhook

3. Worker processes webhook:
   - Reads provider_products
   - Computes: expires_at = now() + INTERVAL '6 months'
   - Calls safe_plan_switch(user, 'pro_creator', 'one_time', 'warriorplus', ...)

4. user_subscriptions.expires_at = now() + 6 months (exact)

5. process_subscription_expiry cron (existing) handles expiry automatically:
   - When expires_at <= now()
   - Status = 'expired'
   - profiles.subscription_tier = 'free'

No code changes needed for the 6-month expiry to work.
```

### 20.3 Database Changes — Summary

| Change Type | Count |
|-------------|-------|
| New tables | 4 |
| Extended tables (additive) | 3 |
| Extended enums | 2 (added values) |
| New RPCs | 15 |
| New triggers | 5 |
| Total migrations | 3 |

### 20.4 Deployment Timeline

| Phase | Duration |
|-------|----------|
| Pre-implementation validation | 1-2 weeks |
| Database migrations (3) | 1 week |
| Edge Functions (4 + shared) | 2 weeks |
| Admin panel | 1 week |
| Frontend | 1 week |
| Testing | 2 weeks |
| Staged deployment | 2 weeks |
| **Total** | **10-12 weeks** |

### 20.5 Future Provider Cost

After this implementation, adding a new provider (e.g. Stripe):
- **~1-2 weeks** of work
- Just implement the `PaymentProviderAdapter` interface
- All subscription/entitlement/affiliate logic unchanged
- Add provider-specific product mappings via admin UI

### 20.6 The Critical Insight

**The 6-month rule lives in data, not code.** The `duration_value` and `duration_unit` columns in `provider_products` are the entire mechanism. The worker reads these values and computes the expiry. Changing the duration is a one-row UPDATE in the admin UI.

This is the senior-architect approach: configuration over hardcoding, data over code, abstraction over specificity.

---

**No SQL, no code, no migrations, no implementation.** This is the final implementation plan awaiting approval.

Once approved, implementation proceeds in the order specified in §16.2.
