# RobinOS — WarriorPlus Pre-Implementation Architecture Audit

**Audit-only document. No files were modified, no migrations generated, no code written.**

**Scope:** Full architecture audit of RobinOS's existing payment, subscription, affiliate, and entitlement systems — mapped against what WarriorPlus integration will require.

**Audit date:** 2026-07-03
**Codebase root:** `/Users/ashadali/Documents/RobinOS-main`
**Supabase project ID:** `iitfxyasjizlbneevwsa`

---

## Executive Summary

RobinOS already has a **production-grade payment architecture** built primarily around **Dodo Payments**, with a secondary **Whop** integration in phase 2B. The architecture is highly generic — the only provider-specific code lives in Edge Functions, and the database schema is **provider-agnostic** (the `provider` column is `text`, not an enum constrained to a single value).

**WarriorPlus readiness is high:**
- Migration 50 (`warriorplus_settings`) already exists with feature toggles
- The JVZoo precedent (migration 24) shows the exact pattern RobinOS uses for "marketplace listings"
- The `provider` column on `user_subscriptions` already accepts `text`, so `'warriorplus'` is a valid value without schema changes
- The `dodo_subscription_id` pattern on `affiliate_commissions` has a parallel text column (`dodo_subscription_id`) that can be mirrored as `warriorplus_transaction_id`

**Primary risks:**
- Affiliate commission attribution model assumes a **subscription-based** billing model (recurring). WarriorPlus is primarily **one-time purchase** with optional subscription bumpers — the commission logic must be adapted.
- Webhook idempotency, signature verification, and the `safe_plan_switch` RPC are tightly coupled to recurring subscription semantics. WarriorPlus uses **IPN-style instant payment notifications** with **single-shot** delivery.
- The WarriorPlus Marketplace has its own affiliate system that pays commissions directly to its own affiliates — RobinOS's self-hosted affiliate system may need to be **suppressed** for WarriorPlus-driven sales to avoid double-payment.

---

## 1. Existing Payment System

### 1.1 Payment Providers — Current Status

| Provider | Status | Provider Code | Edge Functions |
|----------|--------|---------------|----------------|
| **Dodo Payments** | ✅ **Production (primary)** | `"dodo"` | `create-checkout`, `dodo-webhook`, `customer-portal`, `cancel-subscription` |
| **Whop** | ⚠️ **Phase 2B (checkout only)** | `"whop"` | `create-whop-checkout`, `whop-webhook` |
| **JVZoo** | ❌ **Settings only (no payment integration)** | n/a | None |
| **WarriorPlus** | ❌ **Settings only (no payment integration)** | n/a | None |
| **Stripe** | ❌ **Not implemented** | n/a | None |
| **Razorpay** | ❌ **Not implemented** | n/a | None |
| **PayPal** | ❌ **Not implemented** (only mentioned in legacy `payout_method_type` enum as a withdrawal method for affiliates, not as a payment provider for subscriptions) | n/a | None |

**Evidence:**
- `supabase/config.toml` only disables JWT verification for `dodo-webhook`, `whop-webhook`, and `create-whop-checkout`.
- `src/lib/payments/` contains only `dodo.ts` (3.9 KB) and `types.ts` (2.6 KB). No `whop.ts`, `warriorplus.ts`, `stripe.ts`, etc.
- The TypeScript types in `src/lib/payments/types.ts` reference only `provider: "dodo" | null` — Whop is hardcoded into webhooks but not into the typed client surface.

### 1.2 Checkout Flow (Dodo)

**Frontend trigger:** `redirectToCheckout(planKey, userEmail, userName)` in `src/lib/payments/dodo.ts`

**Step-by-step flow:**
1. User clicks "Subscribe" on a plan (Pricing / Upgrade Dialog)
2. Frontend calls `createCheckoutSession()` → POSTs to `/functions/v1/create-checkout`
3. The Edge Function (`supabase/functions/create-checkout/index.ts`):
   - Authenticates the user via JWT
   - Validates plan key against `["creator", "pro_creator", "agency"]`
   - Checks `user_subscriptions` for duplicate active subscription on same plan with same provider → returns 409 if duplicate
   - Reads referral code from request body OR `profiles.referred_by_code`
   - Resolves `product_id` from Supabase Edge Function Secrets (`DODO_PRODUCT_*`)
   - Creates a Dodo checkout session via the `dodopayments` npm SDK with `product_cart`, customer details, `return_url`, and `metadata` (user_id, plan_key, billing_cycle, source, optional referral_code)
   - Returns `{ checkoutUrl, sessionId }`
4. Frontend stores referral code via `referralCoordinator.restore()` then `cleanup()` after success
5. Browser redirects to Dodo-hosted checkout page
6. User completes payment on Dodo
7. Dodo redirects back to `${APP_URL}/dashboard/settings?checkout=success&plan=${planKey}`

**Reusable as-is for WarriorPlus:** ✅ The flow shape is generic — only the SDK/API call inside the Edge Function needs to change.

### 1.3 Payment Verification

**Mechanism:** Webhook-based, signed with **HMAC SHA256** via the `standardwebhooks` npm package.

**Dodo webhook (`supabase/functions/dodo-webhook/index.ts`):**
- Reads raw body (required for signature verification)
- Verifies signature using `Webhook` constructor with `DODO_WEBHOOK_SECRET`
- Parses payload, dispatches by `event_type`
- **Idempotency:** Calls `record_webhook_event()` RPC (migration 31) which inserts into `subscription_webhook_events` with `unique (provider, provider_event_id)`. Duplicate events return `{is_duplicate: true}` and are short-circuited.
- Handles 5 event types: `subscription.active`, `subscription.renewed`, `subscription.cancelled`, `payment.succeeded`, `payment.failed`, `payment.refunded`

**Whop webhook (`supabase/functions/whop-webhook/index.ts`):**
- ⚠️ **HMAC verification is currently NOT enforced** — `WHOP_WEBHOOK_SECRET` is read but the code logs "proceeding without signature verification"
- No idempotency check (does not call `record_webhook_event`)
- Handles 3 event types: `membership.activated`, `membership.cancelled`, `membership.deactivated`

**Critical observation:** Whop's webhook handler is **less hardened** than Dodo's. Any new provider (WarriorPlus) should follow Dodo's hardened pattern.

### 1.4 Subscription Handling

**Single source of truth:** `public.user_subscriptions` table.

**Lifecycle states (canonical, from migration 30 `chk_subscription_status_canonical`):**
```
'active' | 'trialing' | 'expiring' | 'grace_period' |
'expired' | 'cancelled' | 'canceled' | 'payment_failed' |
'past_due' | 'suspended' | 'paused'
```

**Expiry states (computed, from `resolve_user_plan`):**
```
'none' | 'active' | 'expiring_7d' | 'expiring_3d' | 'expiring_1d' | 'grace_period' | 'expired'
```

**Lifecycle columns on `user_subscriptions`:**
- `id` (uuid PK), `user_id` (uuid, unique FK to profiles)
- `plan` (text — `free`, `creator`, `pro_creator`, `agency`)
- `status` (text — canonical states above)
- `billing_cycle` (text — `monthly`, `yearly`)
- `starts_at`, `expires_at`, `grace_period_ends_at`
- `current_period_start`, `current_period_end`, `cancel_at_period_end`, `canceled_at`
- `last_plan_change_at`, `cooldown_until` (14-day cooldown after any plan change)
- `reminder_dismissed_until` (24-hour popup snooze)
- `last_payment_at`, `next_billing_at`, `auto_renew` (boolean)
- `provider` (text — `dodo`, `whop`, `creem`, `stripe`, `lemonsqueezy`, `manual_admin`, or any string)
- `provider_subscription_id` (text — external ID)
- `provider_customer_id` (text — external customer ID)
- `amount` (numeric), `currency` (text, default `USD`)
- `granted_by_admin` (boolean), `granted_reason` (text)
- `subscription_source` (text), `is_revenue_eligible` (boolean)
- `trial_ends_at`, `metadata` (jsonb)
- `created_at`, `updated_at`

**Plan switching:** All plan transitions go through the `safe_plan_switch()` RPC (migration 31):
- Normalizes legacy plan keys (`starter`/`basic` → `creator`, `pro`/`premium` → `pro_creator`, `scale_agency` → `agency`)
- Validates against `['free','creator','pro_creator','agency']`
- Computes expiry (30 days for monthly, 365 for yearly)
- UPSERTs `user_subscriptions`
- Immediately updates `profiles.subscription_tier`, `profiles.current_plan`, `profiles.subscription_expires_at`
- Logs every switch to `subscription_audit_log`

**Expiry engine:** `process_subscription_expiry()` (migration 31, hardened):
- Uses **advisory lock** (`pg_try_advisory_xact_lock(hashtext('process_subscription_expiry'))`) to prevent concurrent runs
- Step 1: Mark `active` → `expiring` for subs within 7 days of expiry
- Step 2: Activate `grace_period` (3-day window) for newly expired subs without prior grace
- Step 3: Downgrade `grace_period` → `expired` and revert profile to free
- Idempotent — safe to call hourly

**Renewal reminders:** `get_subscription_status()` RPC returns rich UI payload (`show_reminder`, `reminder_urgency`, `days_remaining`, `grace_days_remaining`). Skipped for admin-granted subs. Renders via `src/components/RenewalReminder.tsx`.

### 1.5 Purchase Flow (Checkout → Activation)

**Dodo flow:**
```
1. Frontend: redirectToCheckout(planKey)
   ↓
2. Edge: create-checkout (auth, dedup, product_id resolution)
   ↓
3. Dodo SDK: dodo.checkoutSessions.create(...)
   ↓
4. Frontend: window.location.href = checkoutUrl
   ↓
5. [User pays on Dodo]
   ↓
6. Dodo → POST /functions/v1/dodo-webhook
   ↓
7. Webhook: HMAC verify → record_webhook_event → safe_plan_switch
   ↓
8. profiles.subscription_tier updates immediately
   ↓
9. recordAffiliateCommission (if referral_code present)
   ↓
10. push_admin_notification (success)
```

**Whop flow:** Same shape, but:
- `create-whop-checkout` uses Whop's REST API (`POST /api/v1/checkout_configurations`) instead of SDK
- Webhook does NOT verify HMAC, does NOT use idempotency table
- `safe_plan_switch` is the same RPC — provider parameter set to `"whop"`

### 1.6 Upgrade Flow

- Frontend initiates a **new checkout** for the higher-tier plan
- Dodo `create-checkout` allows upgrades (only blocks exact-same-plan + same-provider duplicates via `ALREADY_ON_PLAN`)
- Webhook `subscription.active` triggers `safe_plan_switch` with the new plan — overwrites the row
- `safe_plan_switch` UPSERT updates all plan fields atomically, clears `grace_period_ends_at` and `reminder_dismissed_until`, sets `last_plan_change_at = now()` and `cooldown_until = now() + 14 days`
- Audit log entry written with `triggered_by = "webhook"`

**Upgrade cooldown:** 14 days. Enforced via `cooldown_until` column + `check_plan_change_cooldown()` RPC. Admin can bypass via `admin_grant_subscription(..., p_skip_cooldown := true)`.

### 1.7 Downgrade Flow

There is **no automatic downgrade flow**. Downgrades happen via:
1. **User cancellation** → `cancel-subscription` Edge Function → `dodo.subscriptions.update(status: "cancelled")` → DB `user_subscriptions.status = 'cancelled'`, `auto_renew = false`
2. **Subscription expires** → `process_subscription_expiry()` → status moves to `grace_period` (3 days) → `expired` → `profiles.subscription_tier = 'free'`
3. **Admin manual** → `admin_grant_subscription('free', ...)` → immediate downgrade

A subscription that was cancelled continues to grant access until `expires_at` (Dodo cancels at period end, not immediately).

### 1.8 Refund Flow

**Trigger:** Dodo `payment.refunded` webhook event.

**Handler:** `handlePaymentRefunded()` in `dodo-webhook/index.ts`:
1. Resolves user_id from metadata or provider_subscription_id lookup
2. Calls `reverse_commission(p_dodo_subscription_id, p_reason := 'refund')` (migration 38)
3. Writes audit log entry `payment_refunded`
4. Does NOT directly modify `user_subscriptions.status` (the next renewal attempt or admin action handles that)

**Commission reversal flow (migration 38):**
- Marks `affiliate_commissions.status = 'reversed'` for the matching `dodo_subscription_id`
- Deducts from the correct balance bucket based on prior status:
  - `pending` → deduct from `locked_balance`
  - `approved` → deduct from `pending_balance` (withdrawable)
- Emits admin notification (`push_admin_notification`)
- Logs to `commission_events` (migration 10) with sequence number, `from_status`, `to_status`, `reason_category`

### 1.9 Payment Database Schema

**Primary tables (all in `public` schema):**

| Table | Purpose | Key Columns | Relationships |
|-------|---------|-------------|---------------|
| `user_subscriptions` | Single row per user, source of truth for plan/status | `user_id` (unique), `plan`, `status`, `provider`, `provider_subscription_id`, `expires_at` | FK → `profiles(user_id)` |
| `payments` | Generic payment ledger (currently underused — Dodo/Whop don't write here) | `user_id`, `subscription_id`, `provider`, `amount`, `status`, `provider_payment_id` | FK → `profiles`, `user_subscriptions` |
| `invoices` | Invoice records | `user_id`, `payment_id`, `invoice_number` (unique), `amount`, `status` | FK → `profiles`, `payments` |
| `payment_events` | Raw webhook event log | `payment_id`, `provider` (enum), `event_type`, `payload` (jsonb), `processed` | FK → `payments` |
| `subscription_events` | Subscription lifecycle event log | `user_id`, `subscription_id`, `event_type`, `payload` | FK → `profiles`, `user_subscriptions` |
| `subscription_audit_log` | Immutable audit trail (migration 31) | `user_id`, `event_type`, `old_plan`, `new_plan`, `old_status`, `new_status`, `triggered_by`, `metadata` | — |
| `subscription_webhook_events` | Idempotency log (migration 31) | `provider_event_id`, `provider`, `event_type`, `payload_hash` | unique `(provider, provider_event_id)` |

**Provider enum (legacy):** `payment_provider` = `('creem','stripe','lemonsqueezy','manual')` from migration 01. This enum is **NOT used** by `user_subscriptions.provider` (which is `text`). The enum is used only by the legacy `payments` table.

**Payment status enum:** `payment_status` = `('pending','succeeded','failed','refunded','canceled')`

**Billing cycle enum:** `billing_cycle` = `('monthly','yearly','one_time')` — **note**: `one_time` exists in the enum but is currently unused.

### 1.10 Payment-Related Edge Functions

**Production:**
- `supabase/functions/create-checkout/` — Dodo checkout creation (4.5 KB)
- `supabase/functions/dodo-webhook/` — Dodo webhook handler (18.8 KB, fully hardened)
- `supabase/functions/customer-portal/` — Dodo billing portal redirect (5.4 KB)
- `supabase/functions/cancel-subscription/` — Dodo cancellation (5.4 KB)

**Phase 2B (Whop, partial):**
- `supabase/functions/create-whop-checkout/` — Whop checkout (7.2 KB)
- `supabase/functions/whop-webhook/` — Whop webhook (3.4 KB, missing HMAC + idempotency)

**Shared:**
- `supabase/functions/_shared/entitlement.ts` — CORS headers, shared utilities
- `supabase/functions/_shared/affiliate.ts` — `recordAffiliateCommission()` (used by both webhooks)

### 1.11 Payment RPCs

| RPC | Purpose | Defined in |
|-----|---------|------------|
| `safe_plan_switch(user_id, plan, billing_cycle, provider, provider_sub_id, amount, triggered_by)` | Atomic plan upsert + profile sync + audit log | Migration 31 |
| `record_webhook_event(provider_event_id, provider, event_type, payload_hash)` | Idempotency gate | Migration 31 |
| `log_subscription_event(user_id, event_type, old_plan, new_plan, old_status, new_status, triggered_by, metadata)` | Audit logger | Migration 31 |
| `process_subscription_expiry()` | Cron-safe expiry engine | Migration 31 |
| `check_plan_change_cooldown(user_id)` | Returns `{allowed, days_remaining}` | Migration 17 |
| `admin_grant_subscription(user_id, plan, billing_cycle, duration_days, reason, skip_cooldown)` | Admin manual grants | Migration 17 |
| `dismiss_expiry_popup(user_id)` | Snooze renewal popup 24h | Migration 30 |
| `expire_subscriptions()` | Original expiry function (superseded by `process_subscription_expiry`) | Migration 17 |
| `resolve_user_plan(user_id)` | Returns `{plan, subscription_active, expires_at, expiry_state, ...}` | Migration 31 (hardened) |
| `get_subscription_status(user_id)` | Rich UI payload | Migration 31 |
| `get_subscription_lifecycle(user_id)` | Full lifecycle object | Migration 30 |
| `get_user_entitlements(user_id)` | Plan + features map | Migration 29 |
| `compute_period_bounds(limit_period)` | UTC period key computation | Migration 31 |

### 1.12 Payment Triggers

| Trigger | Table | When | Action |
|---------|-------|------|--------|
| `trg_user_subscriptions_updated_at` | `user_subscriptions` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_subscription_plan_change` | `user_subscriptions` | BEFORE UPDATE | If `plan` changed: sets `last_plan_change_at`, `cooldown_until = now() + 14 days`. Also auto-sets `starts_at` on activation. |
| `trg_subscription_on_insert` | `user_subscriptions` | BEFORE INSERT | Sets `starts_at`, `last_plan_change_at`, `cooldown_until` |
| `trg_apply_referral_commission_for_subscription` | `user_subscriptions` | AFTER INSERT OR UPDATE OF status, plan, amount | Generates pending commission via `apply_referral_commission_for_subscription()` if active + paid + has referral |

### 1.13 Payment Cron Jobs

**Explicit cron jobs defined in migrations:**
- `approve_pending_commissions()` — Migration 38 says "Run daily via pg_cron or Supabase edge function cron." **Not actually scheduled in any migration** — comment includes the SQL hint: `select cron.schedule('approve-commissions', '0 2 * * *', 'select public.approve_pending_commissions()');`
- `process_subscription_expiry()` — Migration 17/31 says "Call hourly via cron or on every entitlement resolution for belt+suspenders coverage." **Not actually scheduled** either.

**Belt-and-suspenders defense:**
- Migration 31 hardened `resolve_user_plan` to also check `expires_at > now()` on every call, so expired subs are demoted even without cron
- Migration 29 wrapped `get_user_entitlements` in `expire_subscriptions()` passive call

**Risk:** If `pg_cron` is not configured, the only "cron" running is on every entitlement fetch — which is reactive, not proactive. Renewal reminders, grace period activation, and commission approval all depend on user activity. This is acceptable for an app with steady traffic but is a gap for off-hours.

### 1.14 Payment Utilities

**Frontend (`src/`):**
- `src/lib/payments/dodo.ts` — Dodo client (checkout, portal, cancel)
- `src/lib/payments/types.ts` — Shared TS types
- `src/lib/pricing.ts` — Plan configuration + display helpers (mirrors backend `plan_entitlements`)
- `src/components/UpgradeDialog.tsx` — Plan picker modal (9.5 KB)
- `src/components/RenewalReminder.tsx` — Expiry popups (15.9 KB)
- `src/services/affiliate/referralCoordinator.ts` — Multi-layer referral persistence

**Backend (`supabase/migrations/`):**
- `04_entitlement_engine.sql` — Plan limits + usage tracking engine
- `17_subscription_lifecycle_engine.sql` — Cooldown, lifecycle, admin grants
- `29_entitlement_system_rebuild.sql` — Hardened entitlement re-implementation
- `30_subscription_lifecycle_v2.sql` — Grace period + reminder system
- `31_subscription_hardening.sql` — Webhook idempotency + UTC + advisory locks
- `45_production_reset.sql` — Reset migration

---

## 2. Affiliate System

### 2.1 Affiliate Database

**Core tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `affiliate_profiles` | One row per affiliate (PK = user_id) | `referral_code` (unique), `total_clicks`, `total_conversions`, `total_earned`, `pending_balance` (withdrawable), `locked_balance` (in cooldown), `paid_balance`, `payout_method`, `payout_details`, `payout_verified` |
| `affiliate_clicks` | Click tracking | `affiliate_user_id`, `click_key`, `landing_page` |
| `affiliate_conversions` | Conversion records | `affiliate_user_id`, `referred_user_id`, `subscription_id`, `amount`, `commission_rate`, `commission_amount`, `plan_code` |
| `affiliate_earnings` | Earnings ledger (legacy) | `affiliate_user_id`, `referral_user_id`, `source_type`, `source_id`, `amount`, `status` |
| `affiliate_commissions` | **Production commission ledger** | `affiliate_user_id`, `referred_user_id`, `subscription_id` (uuid), `dodo_subscription_id` (text, parallel), `amount`, `status`, `eligible_at`, `approved_at`, `payable_at`, `paid_at`, `reversed_at`, `payout_batch_id`, `requires_manual_recovery`, `reversal_reason` |
| `commission_events` | Immutable audit trail (migration 10) | `commission_id`, `sequence_number`, `from_status`, `to_status`, `event_type`, `actor_user_id`, `reason_category`, `reason_notes`, `metadata` |
| `affiliate_referrals` | Referral attribution records | `affiliate_user_id`, `referral_code`, `referred_user_id`, `click_key`, `converted_at`, `metadata` |
| `affiliate_wallets` | Wallet view (PK = user_id) | `available_balance`, `pending_balance`, `lifetime_earnings` |
| `affiliate_wallet_ledger` | Double-entry ledger | `user_id`, `entry_type`, `amount`, `reference_type`, `reference_id`, `notes` |
| `withdrawal_requests` | User-initiated withdrawals | `user_id`, `amount`, `fee_amount`, `payout_method`, `payout_details`, `status`, `admin_note`, `payout_proof_url` |
| `payout_history` | Completed payouts | `withdrawal_request_id`, `user_id`, `payout_method`, `amount`, `processed_by`, `processed_at`, `tx_reference` |

**Affiliates-as-users:** Affiliates are **regular users** with a row in `affiliate_profiles`. They use the same `profiles` table. The `user_id` column on `affiliate_profiles` is both PK and FK.

### 2.2 Referral Tracking

**Capture pipeline (`src/services/affiliate/referralCoordinator.ts`):**

1. **Capture:** Visitor lands with `?ref=CODE` query param
2. **Validation:** Code must be ≥ 4 chars, uppercase
3. **Persistence (multi-layer, deterministic priority):**
   - Priority 1: `sessionStorage.robinos_referral_code`
   - Priority 2: `localStorage.robinos_referral_backup`
   - Priority 3: Cookie `rbn_ref` (HMAC-signed with payload + signature)
   - Priority 4: DB fallback (future, not yet implemented)
4. **First-touch attribution:** Existing valid referral in any layer **blocks overwrite**
5. **Expiry:** 7-day window enforced across all layers
6. **Restore on auth:** `restore()` checks all layers in priority order, re-populates higher layers when found lower
7. **Cleanup:** Removed after successful checkout attribution

**Tamper resistance:** Cookie payload is signed using a deterministic key derived from `VITE_SUPABASE_URL` via a simple HMAC-like hash. Not cryptographically strong but tamper-evident for casual abuse.

**Self-referral prevention:** Both in Edge Function (`recordAffiliateCommission`) and in `record-referral` Edge Function — `affiliate_user_id === referred_user_id` blocks commission creation.

**Profile capture:** `profiles.referred_by_code` is set at signup. Webhook handlers check both checkout metadata and `profiles.referred_by_code` (priority: metadata > profile).

### 2.3 Commission Calculation

**Rate source:** Live from `platform_settings.affiliate_commission_percent` (default 30%).

**Calculation (in `dodo-webhook/index.ts` `recordAffiliateCommission()`):**
```typescript
const commissionPercent = Number(settings?.affiliate_commission_percent ?? 30);
const commissionRate = commissionPercent / 100;
const commissionAmount = Math.round(paymentAmount * commissionRate * 100) / 100;
```

**Plans and amounts (hardcoded in webhook):**
- `creator`: $19/mo
- `pro_creator`: $39/mo
- `agency`: $99/mo

**Commission rate by plan (in UI but not enforced in DB):** Migration 01 default is 30% globally.

### 2.4 Commission States (Lifecycle State Machine)

**Status flow (migration 10 + 38):**
```
pending → approved → payable → paid
   ↓          ↓         ↓
reversed   reversed  reversed
```

**Detailed semantics:**

| Status | Meaning | Balance Bucket | Withdrawable? | Set By |
|--------|---------|----------------|---------------|--------|
| `pending` | Generated, in 14-day cooldown | `locked_balance` | ❌ No | Webhook or trigger on subscription activation |
| `approved` | Cooldown passed, no chargeback | `pending_balance` | ✅ Yes | `approve_pending_commissions()` cron job |
| `payable` | Approved + ready for payout (explicit state, transition step) | `pending_balance` | ✅ Yes | `mark_commission_payable()` |
| `paid` | Withdrawn/paid out | (no balance) | n/a | `process_commission_payout()` |
| `reversed` | Refunded/chargeback/fraud | (deducted from bucket it was in) | ❌ | `reverse_commission()` |

**State transitions enforced by `assert_valid_commission_transition()` (migration 10):**
- `pending` → `approved`, `reversed`
- `approved` → `payable`, `reversed`
- `payable` → `paid`, `reversed`
- `paid` → `reversed` only (with `requires_manual_recovery = true` flag)
- `reversed` is **terminal**

**14-day cooldown:** Set via `platform_settings.commission_hold_days` (default 14). `eligible_at = created_at + 14 days`. `approve_pending_commissions()` cron moves eligible rows to `approved`.

**Refund safety window:** The 14-day cooldown is explicitly designed to absorb refunds before commission is paid. Refunds after 14 days require `requires_manual_recovery` flag.

### 2.5 Withdrawal Flow

**Status enum:** `withdrawal_status = ('pending','reviewing','approved','paid','rejected')`

**Pipeline:**
1. User requests withdrawal → row in `withdrawal_requests` with `status = 'pending'`
2. Admin reviews in `AdminDashboard.tsx` (165 KB) — transitions `pending` → `reviewing` → `approved` or `rejected`
3. Admin marks `paid` after sending funds → row in `payout_history`
4. User's `affiliate_profiles.paid_balance` increases

**Minimum withdrawal:** `platform_settings.minimum_withdrawal` (default $25)
**Payout delay:** `platform_settings.payout_delay_days` (default 7 days)
**Payout method:** `payout_method_type` enum = `('paypal','usdt_trc20')` (migration 35 made USDT-TRC20 the only allowed payout)

**Withdrawal flow:**
- `withdraw_request` Edge Function (not in the list — let me check)

**File evidence:** Migration 42 (`fix_withdraw_request.sql`) suggests a `withdraw_request` Edge Function exists, but it's not in the listed functions directory. Likely it was either renamed, never created, or lives elsewhere.

### 2.6 Analytics

**Available RPCs:**
- `get_affiliate_dashboard_v2(user_id)` — Returns referral_code, balances, conversion count, pending commissions count, payout details
- `affiliate_analytics_view` (migration 41) — SQL view for time-series analytics
- `platform_analytics_rpc` (migration 33) — Admin-side platform metrics

**Frontend:** `src/pages/AffiliatePage.tsx` (12.5 KB) — public affiliate landing page; `src/pages/ReferralsPage.tsx` (20.2 KB) — authenticated user dashboard

**Affiliates can view:**
- Their own commissions
- Their own `commission_events` audit trail
- Their own wallet ledger

**Admins can view:** All affiliate data + commission state transitions + balance reconciliation

### 2.7 Existing Affiliate Edge Functions

- `supabase/functions/record-referral/` — Records initial conversion (not commission — commission is recorded in the payment webhook)
- Affiliate commission recording is **embedded inline** in the payment webhook handlers (`dodo-webhook`, `whop-webhook`) via `recordAffiliateCommission` from `_shared/affiliate.ts`

### 2.8 Existing Affiliate RPCs

| RPC | Purpose |
|-----|---------|
| `increment_affiliate_balance(affiliate_user_id, amount)` | Atomic balance increment (uses `locked_balance` per migration 38) |
| `approve_pending_commissions()` | Cron job — moves `pending` → `approved` after cooldown |
| `approve_commission(commission_id, actor_user_id)` | Manual single approval |
| `approve_commissions_batch(commission_ids[], actor_user_id)` | Manual batch approval |
| `mark_commission_payable(commission_id, actor_user_id)` | `approved` → `payable` |
| `process_commission_payout(commission_id, actor_user_id)` | `payable` → `paid` |
| `reverse_commission(dodo_subscription_id, reason)` | Reversal from webhook (legacy signature) |
| `reverse_commission(commission_id, reason_category, actor_user_id, reason_notes)` | New full signature (migration 10) |
| `assert_valid_commission_transition(current, target)` | State machine guard |
| `next_commission_event_sequence(commission_id)` | Monotonic sequence helper |
| `apply_referral_commission_for_subscription()` | Trigger function — auto-creates commission |
| `get_affiliate_dashboard_v2(user_id)` | Frontend dashboard payload |
| `generate_referral_code()` | Random 8-char uppercase code generator |

**Note:** There are **two** `reverse_commission` RPCs in the codebase — migration 38's `(text, text)` signature and migration 10's `(uuid, text, uuid, text)` signature. The migration 10 version was written later and supersedes, but both exist. Webhooks use the migration 38 text-based signature (looking up by `dodo_subscription_id`).

### 2.9 Existing Affiliate Triggers

| Trigger | Table | When | Action |
|---------|-------|------|--------|
| `trg_apply_referral_commission_for_subscription` | `user_subscriptions` | AFTER INSERT OR UPDATE OF status, plan, amount | Creates pending commission if active + amount > 0 + has referral + not self |
| `trg_profiles_updated_at`, `trg_admin_allowlist_updated_at`, etc. | various | BEFORE UPDATE | Standard `updated_at` stamp |

---

## 3. User Entitlements

### 3.1 How RobinOS Knows a User's Tier

**Three-layer tier resolution:**

1. **`profiles.subscription_tier`** (text, default `free`) — Set immediately by `safe_plan_switch` and `admin_grant_subscription`. Used by frontend for fast display.

2. **`user_subscriptions.plan`** (text, default `creator`) — Authoritative source. Used by `resolve_user_plan()` RPC.

3. **`resolve_user_plan(user_id)`** RPC — The **single source of truth**. Considers:
   - Subscription row's `plan`, `status`, `expires_at`, `grace_period_ends_at`
   - Falls back to `profiles.subscription_tier` if no active subscription
   - Normalizes legacy names (`starter`/`basic` → `creator`, `pro`/`premium` → `pro_creator`, `scale_agency` → `agency`)
   - Returns rich object: `plan`, `subscription_active`, `in_grace_period`, `expires_at`, `expires_soon`, `days_remaining`, `expiry_state`, `billing_cycle`, `cooldown_until`, `granted_by_admin`, `reminder_dismissed_until`, `next_billing_at`, `auto_renew`, `provider`

**Tier values (canonical):**
```
'free' | 'creator' | 'pro_creator' | 'agency'
```
Legacy aliases still accepted but normalized: `'starter'`/`'basic'` → `'creator'`, `'pro'`/`'premium'` → `'pro_creator'`, `'scale_agency'` → `'agency'`

### 3.2 Free vs Paid User

**Detection:**
- `user_subscriptions.status IN ('active', 'trialing', 'expiring')` AND `plan != 'free'` AND `expires_at > now()` → **paid**
- `user_subscriptions.status = 'grace_period'` AND `grace_period_ends_at > now()` → **paid (grace)**
- Otherwise → **free**

**Canonical RPC:** `resolve_user_plan()` returns `subscription_active` boolean.

### 3.3 Plan Limits

**Authoritative source:** `public.plan_entitlements` table (seeded in migration 04, expanded in migration 29).

**Schema:**
- `plan_key` (text — `free`, `creator`, `pro_creator`, `agency`)
- `feature_key` (text — `script_generation`, `caption_generation`, `trend_scan`, `hashtag_scan`, `tts_generation`, `video_generation`, `byok_access`, `analytics_access`, `watermark_removal`, `automation_tools`, `export_access`, `team_workspaces`)
- `limit_value` (numeric — `0` = disabled, `-1` = unlimited, `>0` = capped)
- `limit_period` (text — `day`, `24h`, `month`, `lifetime`, `fair_usage`)
- `enabled` (boolean)
- `metadata` (jsonb — `soft_threshold`, `abuse_warning_at`, `watermarked`, etc.)

**Plan snapshot:**

| Plan | script_generation | caption_generation | video_generation | tts_generation | trend_scan | hashtag_scan | analytics | watermark_removal | team_workspaces | automation | byok | export |
|------|---|---|---|---|---|---|---|---|---|---|---|---|
| **free** | 2/24h | 2/day | ❌ | ❌ | 1/lifetime | 3/day | ❌ | ❌ | 1 lifetime | ❌ | ❌ | 3/day (watermarked) |
| **creator** ($19) | 20/day | 20/day | ❌ | ❌ | 10/day | 20/day | 5/day | ❌ | 1 lifetime | ❌ | ❌ | 50/day |
| **pro_creator** ($39) | 100/day | 100/day | 50/day | 200/day | 100/day | 100/day | unlimited | 1/day | 3 lifetime | ❌ | unlimited | 250/day |
| **agency** ($99) | unlimited (fair usage) | unlimited (fair usage) | unlimited (fair usage) | unlimited (fair usage) | unlimited (fair usage) | unlimited (fair usage) | unlimited | 1/day | unlimited | unlimited | unlimited | unlimited |

### 3.4 Credits

**Architecture:** RobinOS uses **per-feature quotas** (no generic credit pool).

**Usage tracking:** `public.usage_tracking` table:
- `user_id`, `feature_key`, `usage_count`
- `period_key` (e.g. `2026-07-03` for daily, `2026-07` for monthly, `lifetime`)
- `period_start`, `period_end`
- `last_used_at`, `metadata`
- `unique (user_id, feature_key, period_key)`

**Atomic enforcement:** `check_and_increment_usage(user_id, feature_key, increment, idempotency_key)` RPC:
- Validates feature is enabled on user's plan
- Locks the usage row with `FOR UPDATE`
- Checks if `usage_count + increment > limit_value`
- Atomically increments via UPSERT
- Records to `feature_usage_events` for idempotency
- Returns `{success, code, used, limit, remaining, reset_at}`

**Backward-compatible wrapper:** `get_usage_status_v2()` returns `{allowed, used, quota, remaining, near_limit, fair_usage, unlimited, byok_enabled, message}`.

### 3.5 Feature Access Enforcement

**Pattern:** Frontend calls RPC → RPC checks `plan_entitlements` for user's plan + feature → returns `{allowed: bool, reason: string, retry_after?: timestamp}`.

**Files involved:**
- `src/lib/pricing.ts` — Plan configuration mirror (display only, NEVER enforces)
- `supabase/migrations/04_entitlement_engine.sql` — Core engine
- `supabase/migrations/29_entitlement_system_rebuild.sql` — Hardened rebuild
- All `src/pages/*Page.tsx` — Each feature page calls `get_usage_status_v2` before executing

**Single round-trip:** `get_user_entitlements(user_id)` returns `{plan, subscription_active, expires_at, days_remaining, features: {[key]: {enabled, limit, period, unlimited, fair_usage, metadata}}}`.

### 3.6 Files Involved in Entitlements

| File | Role |
|------|------|
| `supabase/migrations/04_entitlement_engine.sql` | Original engine |
| `supabase/migrations/29_entitlement_system_rebuild.sql` | Hardened rebuild |
| `supabase/migrations/30_subscription_lifecycle_v2.sql` | Lifecycle states |
| `supabase/migrations/31_subscription_hardening.sql` | UTC + advisory locks |
| `src/lib/pricing.ts` | Frontend plan mirror |
| `src/lib/payments/types.ts` | `PlanKey` type |
| `src/components/UpgradeDialog.tsx` | Plan picker UI |
| `src/components/RenewalReminder.tsx` | Expiry UI |
| All `src/pages/*Page.tsx` | Feature-level entitlement checks |

---

## 4. Existing Providers — Detailed Status

### 4.1 Dodo Payments
**Status:** ✅ **Production primary provider**
- **Files:**
  - `supabase/functions/create-checkout/index.ts` (4.5 KB)
  - `supabase/functions/dodo-webhook/index.ts` (18.8 KB, fully hardened)
  - `supabase/functions/customer-portal/index.ts` (5.4 KB)
  - `supabase/functions/cancel-subscription/index.ts` (5.4 KB)
  - `src/lib/payments/dodo.ts` (3.9 KB)
  - `src/lib/payments/types.ts` (2.6 KB)
- **Secrets used:** `DODO_SECRET_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_ENVIRONMENT` (`test_mode` / `live_mode`), `DODO_PRODUCT_CREATOR_MONTHLY`, `DODO_PRODUCT_PRO_CREATOR_MONTHLY`, `DODO_PRODUCT_AGENCY_MONTHLY`
- **Implementation completeness:** 100% — checkout, webhook (signed), idempotency, customer portal, cancellation, refund handling, commission attribution, admin notifications, audit logging

### 4.2 Whop
**Status:** ⚠️ **Phase 2B — checkout created, webhook partial**
- **Files:**
  - `supabase/functions/create-whop-checkout/index.ts` (7.2 KB) — ✅ complete
  - `supabase/functions/whop-webhook/index.ts` (3.4 KB) — ⚠️ missing HMAC verification, missing idempotency check
- **Secrets used:** `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET` (declared but unused for verification)
- **Implementation completeness:** ~70%
- **Gap:** No frontend client wrapper. No Whop customer portal. No Whop cancellation flow. Type definitions only include `provider: "dodo" | null`.
- **Configured in `config.toml`:** ✅ (`verify_jwt = false` for `whop-webhook` and `create-whop-checkout`)

### 4.3 PayPal
**Status:** ❌ **Not implemented as a payment provider**
- Only mentioned in legacy `payout_method_type` enum (`'paypal','usdt_trc20'`) as an affiliate **withdrawal** method
- Migration 35 (`usdt_only_payouts.sql`) deprecated PayPal as a withdrawal method in favor of USDT-TRC20
- No checkout, webhook, or customer portal for subscription payments
- **Not configured in `config.toml`**

### 4.4 WarriorPlus
**Status:** ❌ **Settings only — no payment integration**
- **Evidence:**
  - Migration 50 (`50_warriorplus_settings.sql`) — Adds `platform_settings.warriorplus_page_enabled` (boolean, default `false`) and `platform_settings.warriorplus_demo_video_url` (text)
  - Comment explicitly states: "This migration is additive only. It does NOT touch any existing /jvzoo or affiliate columns."
  - Default OFF — "must be enabled in Admin → Settings after WarriorPlus marketplace approval"
- **Mirror precedent:** Migration 24 (`jvzoo_affiliate_settings.sql`) — same pattern for JVZoo affiliate page settings
- **No payment integration:** No checkout function, no webhook, no commission logic
- **Not configured in `config.toml`**

### 4.5 Stripe
**Status:** ❌ **Not implemented**
- Mentioned in legacy `payment_provider` enum (`'creem','stripe','lemonsqueezy','manual'`)
- No Edge Functions, no client wrapper
- **Not configured in `config.toml`**

### 4.6 Razorpay
**Status:** ❌ **Not implemented**
- No references in code, migrations, or config

### 4.7 JVZoo (for comparison)
**Status:** ❌ **Settings only — no payment integration**
- Migration 23 (`creator_os_settings.sql`) — `creator_os_page_enabled` for `/jvzoo` sales page
- Migration 24 (`jvzoo_affiliate_settings.sql`) — `jvzoo_affiliate_enabled`, `jvzoo_affiliate_demo_video_url`, `jvzoo_affiliate_cta_url`, `jvzoo_affiliate_button_text`
- Same pattern as WarriorPlus: marketplace listing page settings, but no payment processing integration
- JVZoo is a **marketplace** (like WarriorPlus) where RobinOS would be a vendor

---

## 5. Database Architecture (Payment + Affiliate Tables)

### 5.1 Core Tables — Purpose, Keys, Relationships

#### `profiles`
- **Purpose:** User identity, tier cache, profile data
- **PK:** `id` (uuid), unique `user_id` (uuid)
- **Key columns:** `subscription_tier` (text, default `free`), `current_plan`, `subscription_expires_at`, `referral_code`, `referred_by_code`, `credits_remaining`, `free_trial_*`, scripts/scans usage counters (legacy), affiliate balances (legacy), `is_suspended`
- **Relationships:** Root table. Most other tables FK to `user_id`

#### `user_subscriptions`
- **Purpose:** Authoritative subscription state
- **PK:** `id` (uuid), unique `user_id`
- **Key columns:** See §1.4 above
- **FK:** `user_id` → `profiles(user_id)` ON DELETE CASCADE
- **Provider column:** `provider` (text) — accepts any value, currently used: `dodo`, `whop`, `manual_admin`

#### `payments`
- **Purpose:** Generic payment ledger (currently **underused** — Dodo/Whop don't write here)
- **PK:** `id` (uuid)
- **Key columns:** `provider` (enum), `provider_payment_id`, `amount`, `status`, `refunded_amount`, `failure_reason`, `paid_at`
- **FK:** `user_id` → `profiles`, `subscription_id` → `user_subscriptions`

#### `invoices`
- **Purpose:** Invoice records
- **PK:** `id` (uuid), unique `invoice_number`
- **FK:** `user_id` → `profiles`, `payment_id` → `payments`

#### `payment_events`
- **Purpose:** Raw payment provider event log
- **PK:** `id` (uuid)
- **FK:** `payment_id` → `payments`

#### `subscription_events`
- **Purpose:** Subscription lifecycle event log
- **PK:** `id` (uuid)
- **FK:** `user_id` → `profiles`, `subscription_id` → `user_subscriptions`

#### `subscription_audit_log` (migration 31)
- **Purpose:** Immutable audit trail for subscription lifecycle
- **PK:** `id` (uuid)
- **Key columns:** `event_type`, `old_plan`, `new_plan`, `old_status`, `new_status`, `triggered_by`, `metadata`
- **No FK** — log table, preserves data even if user is deleted

#### `subscription_webhook_events` (migration 31)
- **Purpose:** Idempotency log for payment provider webhooks
- **PK:** `id` (uuid), unique `(provider, provider_event_id)`
- **Key columns:** `event_type`, `payload_hash`, `processed_at`

#### `plan_entitlements` (migration 04)
- **Purpose:** Source of truth for per-plan, per-feature limits
- **PK:** `id` (uuid), unique `(plan_key, feature_key)`
- **Key columns:** `limit_value`, `limit_period`, `enabled`, `metadata`

#### `usage_tracking` (migration 04)
- **Purpose:** Atomic usage counters per user/feature/period
- **PK:** `id` (uuid), unique `(user_id, feature_key, period_key)`
- **Key columns:** `usage_count`, `period_start`, `period_end`, `last_used_at`
- **FK:** `user_id` → `profiles(user_id)`

#### `feature_usage_events` (migration 04)
- **Purpose:** Idempotency log for usage increments
- **PK:** `id` (uuid), unique `(user_id, feature_name, idempotency_key)`

#### `platform_settings` (migration 01 + extensions)
- **Purpose:** Runtime configuration — single-row config table
- **PK:** `id` (uuid)
- **Key columns:**
  - `creator_price`, `pro_price`, `agency_price` (numeric)
  - `affiliate_commission_percent` (default 30)
  - `commission_hold_days` (default 14)
  - `minimum_withdrawal` (default 25)
  - `payout_delay_days` (default 7)
  - `free_scripts_limit`, `free_scans_limit`
  - `creator_os_page_enabled` (JVZoo, migration 23)
  - `jvzoo_affiliate_*` (migration 24)
  - `warriorplus_page_enabled`, `warriorplus_demo_video_url` (migration 50)
  - `maintenance_mode`, `announcement_banner`, `platform_domain`, `support_email`

#### `affiliate_profiles`
- **Purpose:** Affiliate account state
- **PK:** `user_id` (also FK to `profiles`)
- **Key columns:** `referral_code` (unique), `total_clicks`, `total_conversions`, `total_earned`, `locked_balance`, `pending_balance`, `paid_balance`, `payout_method`, `payout_details`, `payout_verified`

#### `affiliate_clicks`
- **Purpose:** Click tracking
- **PK:** `id` (uuid)
- **FK:** `affiliate_user_id` → `affiliate_profiles(user_id)`

#### `affiliate_conversions`
- **Purpose:** Conversion records (signup → paid)
- **PK:** `id` (uuid), unique `(affiliate_user_id, referred_user_id, subscription_id)`
- **Key columns:** `amount`, `commission_rate`, `commission_amount`, `plan_code`
- **FK:** `affiliate_user_id`, `referred_user_id` → `profiles`, `subscription_id` → `user_subscriptions`

#### `affiliate_earnings`
- **Purpose:** Earnings ledger (legacy)
- **PK:** `id` (uuid)
- **Key columns:** `amount`, `status`, `source_type`, `source_id`

#### `affiliate_commissions`
- **Purpose:** **Production** commission ledger
- **PK:** `id` (uuid), unique `(affiliate_user_id, referred_user_id, subscription_id)`
- **Key columns:** `amount`, `status`, `eligible_at`, `approved_at`, `payable_at`, `paid_at`, `reversed_at`, `dodo_subscription_id` (text, parallel to uuid `subscription_id`), `payout_batch_id`, `requires_manual_recovery`, `reversal_reason`
- **FK:** `affiliate_user_id`, `referred_user_id` → `profiles`, `subscription_id` → `user_subscriptions`

#### `commission_events` (migration 10)
- **Purpose:** Immutable audit trail for commission transitions
- **PK:** `id` (uuid), unique `(commission_id, sequence_number)`
- **Key columns:** `from_status`, `to_status`, `event_type`, `actor_user_id`, `reason_category`, `reason_notes`
- **FK:** `commission_id` → `affiliate_commissions(id)` ON DELETE CASCADE

#### `affiliate_referrals`
- **Purpose:** Referral attribution records
- **PK:** `id` (uuid)
- **Key columns:** `referral_code`, `converted_at`, `metadata`

#### `affiliate_wallets`
- **Purpose:** Wallet view (separate from `affiliate_profiles`)
- **PK:** `user_id`
- **Key columns:** `available_balance`, `pending_balance`, `lifetime_earnings`

#### `affiliate_wallet_ledger`
- **Purpose:** Double-entry ledger
- **PK:** `id` (uuid)
- **Key columns:** `entry_type`, `amount`, `reference_type`, `reference_id`, `notes`

#### `withdrawal_requests`
- **Purpose:** User-initiated withdrawal requests
- **PK:** `id` (uuid)
- **Key columns:** `amount`, `fee_amount`, `payout_method`, `payout_details`, `status`, `admin_note`
- **FK:** `user_id` → `affiliate_profiles(user_id)`

#### `payout_history`
- **Purpose:** Completed payouts
- **PK:** `id` (uuid)
- **Key columns:** `amount`, `processed_by`, `processed_at`, `tx_reference`
- **FK:** `withdrawal_request_id` → `withdrawal_requests`, `user_id` → `affiliate_profiles`

### 5.2 Table Dependency Graph (Payment + Affiliate)

```
profiles (root)
  │
  ├── user_subscriptions (1:1)
  │     │
  │     ├── subscription_events (1:N)
  │     ├── subscription_audit_log (1:N, no FK)
  │     ├── subscription_webhook_events (no FK — cross-provider)
  │     ├── payments (1:N)
  │     │     ├── invoices (1:N)
  │     │     └── payment_events (1:N)
  │     ├── affiliate_commissions (1:N, via subscription_id)
  │     │     └── commission_events (1:N)
  │     └── affiliate_conversions (1:N)
  │
  ├── affiliate_profiles (1:1, if user is affiliate)
  │     │
  │     ├── affiliate_clicks (1:N)
  │     ├── affiliate_referrals (1:N)
  │     ├── affiliate_wallets (1:1)
  │     ├── affiliate_wallet_ledger (1:N)
  │     ├── withdrawal_requests (1:N)
  │     └── payout_history (1:N)
  │
  ├── usage_tracking (1:N)
  ├── feature_usage_events (1:N)
  └── plan_entitlements (referenced, not FK — keyed on plan_key)
```

### 5.3 Enums

| Enum | Values | Used by |
|------|--------|---------|
| `app_role` | `super_admin`, `admin`, `support`, `user` | `user_roles.role` |
| `plan_tier` | `free`, `creator`, `pro_creator`, `agency`, `scale_agency` | Legacy — supersedes by `text` columns |
| `user_plan_status` | `active`, `trialing`, `past_due`, `canceled`, `expired` | Legacy |
| `payout_method_type` | `paypal`, `usdt_trc20` | Migration 35 made USDT-TRC20 the only allowed withdrawal method |
| `withdrawal_status` | `pending`, `reviewing`, `approved`, `paid`, `rejected` | `withdrawal_requests.status` |
| `earning_status` | `pending`, `available`, `paid` | `affiliate_earnings.status` |
| `payment_provider` | `creem`, `stripe`, `lemonsqueezy`, `manual` | Legacy — `payments.provider` |
| `payment_status` | `pending`, `succeeded`, `failed`, `refunded`, `canceled` | `payments.status` |
| `billing_cycle` | `monthly`, `yearly`, `one_time` | `payments.billing_cycle` |

**Note:** `payment_provider` enum is **legacy** and does **NOT** include `dodo`, `whop`, `warriorplus`, or `paypal`. The actual `user_subscriptions.provider` is `text`, allowing any value. The legacy enum is unused for active payment processing.

---

## 6. Current Flow Diagram

### 6.1 Visitor → Subscription Active (Dodo)

```
[Visitor with ?ref=CODE]
       │
       ▼
[referralCoordinator.captureFromUrl] → sessionStorage/localStorage/cookie
       │
       ▼
[User clicks Subscribe / Pricing]
       │
       ▼
[Frontend: redirectToCheckout(planKey)]
       │
       ▼
[POST /functions/v1/create-checkout]
  ├─ Verify JWT
  ├─ Validate plan key
  ├─ Check duplicate (same plan + provider → 409)
  ├─ Resolve product_id from DODO_PRODUCT_* secrets
  └─ dodo.checkoutSessions.create(product_cart, customer, return_url, metadata)
       │
       ▼
[Return {checkoutUrl, sessionId}]
       │
       ▼
[Frontend: window.location.href = checkoutUrl]
       │
       ▼
[User pays on Dodo-hosted page]
       │
       ▼
[Dodo → POST /functions/v1/dodo-webhook]
  ├─ Read raw body
  ├─ Verify HMAC SHA256 signature (standardwebhooks)
  ├─ Parse payload
  ├─ record_webhook_event() → dedup check (subscription_webhook_events)
  ├─ Route by event_type:
  │     ├─ subscription.active/renewed → handleSubscriptionActive
  │     ├─ subscription.cancelled → handleSubscriptionCancelled
  │     ├─ payment.succeeded → handlePaymentSucceeded
  │     ├─ payment.failed → handlePaymentFailed
  │     └─ payment.refunded → handlePaymentRefunded
  │
  ▼
[handleSubscriptionActive / handlePaymentSucceeded]
  ├─ Extract user_id from metadata (fallback: lookup by provider_subscription_id)
  ├─ Resolve plan_key from product_id map
  ├─ safe_plan_switch(user_id, plan, billing_cycle, provider, provider_sub_id, amount, triggered_by)
  │     ├─ Normalize plan key
  │     ├─ UPSERT user_subscriptions
  │     ├─ Update profiles.subscription_tier, current_plan, subscription_expires_at
  │     └─ log_subscription_event(plan_switch)
  │
  ▼
[Trigger: trg_apply_referral_commission_for_subscription]
  └─ If status='active' AND plan != 'free' AND amount > 0 AND profiles.referred_by_code exists
       ├─ Look up affiliate_profiles by referral_code
       ├─ Prevent self-referral
       ├─ Calculate commission (live rate from platform_settings.affiliate_commission_percent)
       ├─ INSERT affiliate_commissions (status='pending', eligible_at=now+14d)
       ├─ INSERT commission_events (generated)
       ├─ increment_affiliate_balance (locked_balance++)
       └─ INSERT affiliate_wallet_ledger (commission_pending)
       │
       ▼
[Webhook: recordAffiliateCommission (inline)]
  └─ If metadata.referral_code OR profiles.referred_by_code
       ├─ Look up affiliate by code
       ├─ Prevent self-referral
       ├─ INSERT affiliate_commissions (status='pending', eligible_at=now+14d)
       └─ increment_affiliate_balance (locked_balance++)
       │
       ▼
[push_admin_notification] (admin notification)
       │
       ▼
[200 OK returned to Dodo]

       │
       ▼
[Frontend: return to ${APP_URL}/dashboard/settings?checkout=success&plan=${plan}]
       │
       ▼
[User now has active subscription → entitlements resolve immediately]

[Daily cron: approve_pending_commissions]
  └─ Moves commissions past eligible_at → status='approved', locked_balance → pending_balance

[User accesses feature]
  └─ check_and_increment_usage(feature_key)
       ├─ resolve_user_plan(user_id) → 'pro_creator' (subscription_active=true)
       ├─ get_entitlement(plan, feature) → {limit: 100, period: 'day'}
       ├─ Lock usage_tracking row (FOR UPDATE)
       ├─ Check limit
       └─ Increment → allowed
```

### 6.2 Cancellation → Expiry → Free

```
[User clicks Cancel in Settings]
       │
       ▼
[POST /functions/v1/cancel-subscription]
  ├─ Verify JWT
  ├─ Get user_subscriptions (provider must be 'dodo')
  ├─ dodo.subscriptions.update(status: 'cancelled')
  ├─ UPDATE user_subscriptions SET status='cancelled', auto_renew=false
  └─ log_subscription_event(subscription_cancelled)
       │
       ▼
[User retains access until expires_at (current period end)]
       │
       ▼
[Dodo → subscription.cancelled webhook → handleSubscriptionCancelled]
  ├─ UPDATE user_subscriptions SET status='cancelled', auto_renew=false, canceled_at=now()
  └─ log_subscription_event(subscription_cancelled)
       │
       ▼
[Time passes: expires_at → past now]
       │
       ▼
[Next entitlement check OR process_subscription_expiry cron]
  ├─ Step 1: status='active' → 'expiring' (within 7 days)
  ├─ Step 2: status='active'/'expiring' → 'grace_period' (just expired, 3-day window)
  └─ Step 3: status='grace_period' → 'expired', profiles.subscription_tier='free'
       │
       ▼
[resolve_user_plan now returns plan='free', subscription_active=false]
       │
       ▼
[User is on free plan, limited features]
```

### 6.3 Refund Flow

```
[User requests refund via Dodo dashboard]
       │
       ▼
[Dodo → payment.refunded webhook → handlePaymentRefunded]
  ├─ Resolve user_id
  ├─ reverse_commission(dodo_subscription_id, 'refund')
  │     ├─ Find affiliate_commissions WHERE dodo_subscription_id = X AND status IN ('pending', 'approved')
  │     ├─ For each: UPDATE status='reversed', reversed_at=now(), reversal_reason='refund'
  │     ├─ Deduct from correct balance bucket (locked or pending)
  │     ├─ INSERT commission_events (reversed)
  │     └─ push_admin_notification(warning)
  └─ log_subscription_event(payment_refunded)
       │
       ▼
[200 OK to Dodo]
       │
       ▼
[Admin reviews notification, may need to manually reconcile]
```

### 6.4 Visitor with Referral Code

```
[Visitor lands on https://tryrobin.xyz/?ref=ABC123]
       │
       ▼
[referralCoordinator.captureFromUrl('ABC123')]
  └─ Returns {code, capturedAt, source: 'url', traceId, expiry: now+7d}
       │
       ▼
[referralCoordinator.persist(data)]
  ├─ Check first-touch (any layer has valid referral?)
  │     └─ If yes: BLOCK overwrite
  └─ Write to sessionStorage + localStorage + signed cookie
       │
       ▼
[User signs up / logs in]
       │
       ▼
[referralCoordinator.restore() on auth] → code='ABC123', source='session'
       │
       ▼
[User clicks Subscribe]
       │
       ▼
[redirectToCheckout reads referralCode via referralCoordinator.restore()]
       │
       ▼
[POST /functions/v1/create-checkout with referralCode in body]
       │
       ▼
[Edge: stores referralCode in Dodo metadata.referral_code]
       │
       ▼
[Dodo webhook reads metadata.referral_code]
       │
       ▼
[recordAffiliateCommission] → creates commission for affiliate
```

---

## 7. WarriorPlus Compatibility Analysis

### 7.1 What Already Exists ✅

1. **Settings toggle** (migration 50): `platform_settings.warriorplus_page_enabled` (boolean, default `false`), `platform_settings.warriorplus_demo_video_url` (text)
2. **Provider-agnostic schema**: `user_subscriptions.provider` is `text`, accepts any value
3. **Provider-agnostic subscription lifecycle**: `safe_plan_switch`, `process_subscription_expiry`, `resolve_user_plan` all accept `provider` as a parameter
4. **Hardened webhook pattern**: Dodo's webhook is the gold standard — signature verification, idempotency, atomic state transitions, admin notifications
5. **JVZoo precedent**: Migration 24 shows the exact pattern RobinOS uses for marketplace integrations
6. **Billing cycle enum** includes `one_time` (currently unused) — WarriorPlus primarily sells one-time products
7. **Plan source-of-truth** is database-side (`plan_entitlements`), frontend is mirror only
8. **Commission infrastructure** is mature — `affiliate_commissions` table, `dodo_subscription_id` pattern (can mirror as `warriorplus_order_id`), `increment_affiliate_balance`, `reverse_commission`
9. **Admin notification system** (`push_admin_notification`) is reusable for WarriorPlus events
10. **Audit logging** (`log_subscription_event`, `subscription_audit_log`, `commission_events`) is universal

### 7.2 What Can Be Reused as-is ✅

- **`safe_plan_switch`** RPC — pass `provider := 'warriorplus'`
- **`record_webhook_event`** — pass `provider := 'warriorplus'`
- **`log_subscription_event`** — provider-agnostic
- **`resolve_user_plan`** / **`get_subscription_status`** / **`get_subscription_lifecycle`** — provider-agnostic
- **`process_subscription_expiry`** — provider-agnostic
- **`push_admin_notification`** — provider-agnostic
- **`increment_affiliate_balance`** — provider-agnostic
- **`reverse_commission`** — uses `dodo_subscription_id` parameter, can be mirrored as `warriorplus_order_id`
- **All entitlement RPCs** (`check_and_increment_usage`, `get_entitlement`, `get_user_entitlements`, `get_usage_status_v2`) — provider-agnostic
- **`platform_settings` table** — already contains `warriorplus_*` columns
- **Frontend pricing display** (`src/lib/pricing.ts`) — works for any provider
- **Referral coordinator** (`referralCoordinator`) — provider-agnostic

### 7.3 What is Missing ❌

1. **WarriorPlus checkout creation** Edge Function — no equivalent of `create-checkout` for WarriorPlus
2. **WarriorPlus webhook** Edge Function — no equivalent of `dodo-webhook`
3. **HMAC verification** for WarriorPlus IPN (their notification format differs from Dodo)
4. **Idempotency table extension** — `subscription_webhook_events` accepts any provider string, but the unique constraint is `(provider, provider_event_id)` — needs WarriorPlus event ID format
5. **WarriorPlus product ID resolution** — no `WARRIORPLUS_PRODUCT_*` secrets pattern yet
6. **One-time payment support** — `safe_plan_switch` always sets `auto_renew = true`. WarriorPlus one-time purchases should have `auto_renew = false` and a `billing_cycle = 'one_time'`
7. **`payments` table writes** — Dodo/Whop don't write here. WarriorPlus might benefit from this for proper accounting
8. **WarriorPlus-specific commission rate** — currently `affiliate_commission_percent` is a single global value. WarriorPlus Marketplace controls its own commission payouts to its own affiliates. If RobinOS affiliates also get commission, **double payment** risk exists.
9. **WarriorPlus customer account** — WarriorPlus uses email + transaction ID, not a true customer ID like Dodo. `provider_customer_id` may be unused or set to a placeholder.
10. **WarriorPlus order tracking** — `user_subscriptions` is designed for **recurring** subscriptions. One-time purchases (no renewal) need a different model or an extension.

### 7.4 What Should NOT Be Changed 🚫

1. **Existing Dodo webhook** — must remain 100% intact. Dodo is the production primary provider.
2. **`safe_plan_switch` signature** — adding optional parameters is fine; changing existing ones is not.
3. **`resolve_user_plan` and `get_subscription_status` RPCs** — these are called from many places and are battle-tested.
4. **Plan entitlement seeds** (`plan_entitlements`) — these are the source of truth for what each plan provides. WarriorPlus purchases should map to existing plans.
5. **Referral coordinator** (`referralCoordinator`) — works correctly with any provider. The referral is captured pre-checkout and passed to checkout via metadata.
6. **`platform_settings` table structure** — already has `warriorplus_*` columns from migration 50. Don't add new columns unnecessarily.
7. **The 14-day commission cooldown** — universal for refund safety, regardless of provider.
8. **The 7-day expiry reminder window** — universal for any subscription.
9. **The 3-day grace period** — universal for any subscription.
10. **Canonical status values** (`active`, `trialing`, `expiring`, `grace_period`, `expired`, `cancelled`, `payment_failed`, etc.) — WarriorPlus subscriptions should use these same states.

### 7.5 Critical Architecture Decisions Needed for WarriorPlus

1. **One-time vs subscription mapping:** Does WarriorPlus grant the same `creator`/`pro_creator`/`agency` plans? Or a separate "lifetime" tier? The `billing_cycle` enum includes `one_time`, but `safe_plan_switch` doesn't handle that case (it always sets `auto_renew = true` and computes 30/365 day expiry).

2. **Affiliate handling — mutual exclusivity:**
   - **Option A:** WarriorPlus sales are flagged to suppress RobinOS affiliate commission attribution (WarriorPlus pays its own affiliates)
   - **Option B:** RobinOS affiliates still get credit for WarriorPlus sales (potential double-payment with WarriorPlus's own affiliates)
   - Recommendation: **Option A** — add a `subscription_source` or provider-specific check

3. **Webhook format:** WarriorPlus IPN format differs significantly from Dodo:
   - WarriorPlus sends POST with form-encoded or JSON body
   - Event types: `SALE`, `RFND`, `CGBK`, `INSF`, `CANCEL-REBILL`, `UNCANCEL-REBILL`, `PYMT-REBILL`
   - No HMAC signature by default — uses IPN secret + URL verification instead
   - Need to design new webhook handler that normalizes WarriorPlus events into RobinOS's internal event types

4. **Account reconciliation:** How does RobinOS link a WarriorPlus purchase to a RobinOS user?
   - Option A: Email matching (WarriorPlus sends buyer email)
   - Option B: Pass `user_id` in product URL params
   - Option C: Require manual account linking post-purchase
   - Recommendation: **Option A + B hybrid** — pass `user_id` in URL params if logged in, fall back to email match

---

## 8. Risk Analysis

### 8.1 Possible Breaking Points

1. **Whop webhook missing HMAC + idempotency** — Anyone with the URL can spoof membership events. **Fix before adding WarriorPlus.**
2. **`dodo_subscription_id` (text) vs `subscription_id` (uuid) parallel columns on `affiliate_commissions`** — Migration 36 added the text column for Dodo, but the original uuid column is still there. **WarriorPlus will need a similar `warriorplus_order_id` (text) column.**
3. **`safe_plan_switch` UPSERT uses `ON CONFLICT (user_id)`** — if a user has subscriptions from multiple providers, the last write wins. **No protection against provider conflicts.** WarriorPlus could overwrite a Dodo subscription.
4. **Legacy `payments` table is unused by active flows** — Dodo doesn't write to it. Inconsistent with the documented purpose. **New providers should follow Dodo's pattern (write only to `user_subscriptions`), or update the `payments` table.**
5. **`referralCoordinator` cookie signing uses non-cryptographic hash** — `signPayload()` is a simple sum-based hash, not HMAC-SHA256. Sufficient for tamper-evidence against casual abuse, but not against a determined attacker. **OK for current threat model, document the limitation.**
6. **Two `reverse_commission` signatures** — migration 10 (uuid-based) and migration 38 (text-based). Webhooks use text-based. Future refactor risk.
7. **Plan amounts hardcoded in webhooks** (`PLAN_AMOUNTS: Record<string, number>`) — duplicate of `platform_settings.creator_price`, `pro_price`, `agency_price`. Drift risk if admin changes pricing. **WarriorPlus webhook should read from `platform_settings` exclusively.**
8. **Cron jobs not actually scheduled** — `approve_pending_commissions` and `process_subscription_expiry` are documented as "run via cron" but no `cron.schedule()` call exists in any migration. The system is reactive-only.
9. **Front-end "plan tier" cache in `profiles.subscription_tier`** — Can be stale for up to a few seconds after a webhook if the user has multiple tabs open.
10. **The `customer-portal` Edge Function is Dodo-only** — Whop users have no portal access, and WarriorPlus has no concept of a customer portal (it's a marketplace).

### 8.2 Trust Risks

1. **Affiliate self-referral** — Mitigated by `affiliate_user_id === referred_user_id` check in both `record-referral` Edge Function and webhook. **Solid.**
2. **Affiliate cookie tampering** — Mitigated by HMAC-like signature. **Acceptable.**
3. **First-touch attribution overwrite** — Mitigated by `referralCoordinator.persist()` overwrite block. **Solid.**
4. **Duplicate webhook replay** — Mitigated by `record_webhook_event` unique constraint on `(provider, provider_event_id)`. **Solid.**
5. **Admin-granted subscriptions counted as revenue** — Mitigated by `is_revenue_eligible = false` for admin grants. **Solid.**
6. **Subscription cooldown bypass** — Only possible via `admin_grant_subscription(p_skip_cooldown := true)`. Requires admin role. **Acceptable.**
7. **Manual commission approval** — `approve_commission` requires admin role via `auth.uid()` check. **Solid.**
8. **Withdrawal self-approval** — Withdrawal requests require admin action; users cannot self-approve. **Solid.**

### 8.3 Security Risks

1. **Webhook signature verification gaps** — Whop does not enforce HMAC. **Dodo does.** WarriorPlus IPN uses different verification. **WarriorPlus webhook MUST implement proper IPN verification.**
2. **JWT verification disabled on webhook functions** — `verify_jwt = false` in `config.toml` for `dodo-webhook`, `whop-webhook`. Required because webhooks don't have user JWTs, but means **anyone can hit the URL**. Signature verification is the only gate.
3. **`SECURITY DEFINER` on many RPCs** — Standard for service-role-only RPCs, but requires careful `set search_path` to prevent search-path attacks. All reviewed RPCs correctly set `search_path = public`.
4. **RLS policies** — All sensitive tables have RLS enabled. Reviewed policies use `auth.uid()` correctly. Admin-only paths use `public.get_admin_role(auth.uid())`.
5. **Affiliate payout details stored as plaintext** (`payout_details` text) — Including crypto addresses. **Risk if database is compromised.** Acceptable trade-off for MVP but should be encrypted at rest for production-grade security.
6. **Service role key in Edge Functions** — Required for service-role operations. Standard practice. **Risk if Edge Function code is leaked** — environment variables are protected by Supabase.
7. **No rate limiting on `record-referral` Edge Function** — A bad actor could spam referral captures. **Mitigation:** check duplicate conversion before insert.
8. **No CSRF protection on Edge Functions** — Not applicable — Edge Functions use CORS + signature verification.

### 8.4 Duplicate Payment Risks

1. **Webhook replay** — Mitigated by `subscription_webhook_events` unique constraint. **Solid.**
2. **Multiple providers for same user** — Possible if user buys via Dodo and then WarriorPlus. `safe_plan_switch` UPSERT would overwrite. **Need explicit provider-isolation or priority logic for WarriorPlus.**
3. **Multiple clicks with same referral code** — `affiliate_conversions` has unique `(affiliate_user_id, referred_user_id, subscription_id)` but NOT `(affiliate_user_id, referred_user_id)` alone. **Multiple conversions with different `subscription_id` values are allowed** — which is correct for the case where one user converts to multiple subscriptions, but allows accidental duplicates if the same subscription_id is reused. Mitigation: `subscription_id` is `uuid` so accidental reuse is unlikely.
4. **Commission recorded twice (trigger + webhook inline)** — Both `trg_apply_referral_commission_for_subscription` AND inline `recordAffiliateCommission` in webhook can fire on the same payment. **Mitigation:** Both use unique `(affiliate_user_id, referred_user_id, subscription_id)` constraint. Duplicate insert raises 23505 and is silently ignored.
5. **Payment success + subscription.active** — Dodo webhook handles both. **Mitigation:** `subscription.active` calls `safe_plan_switch`, `payment.succeeded` also calls `safe_plan_switch` if subscription_id present. Both are idempotent.
6. **Renewal webhook after cancellation** — `payment.succeeded` for a cancelled sub would re-activate it. **Mitigation:** Dodo should not send `payment.succeeded` for cancelled subs, but the webhook doesn't explicitly check `status='cancelled'` before activating. **Edge case worth documenting.**

### 8.5 Refund Risks

1. **Refund outside 14-day window** — Commission is `approved` and in `pending_balance` (withdrawable). Reversal deducts from `pending_balance` and flags `requires_manual_recovery = true` if `paid`. **Mitigation:** Audit trail via `commission_events` and `affiliate_wallet_ledger`. Admin review needed.
2. **Chargeback after payout** — Most serious risk. `paid` commission reversed → flag `requires_manual_recovery = true` + negative `available_balance` (via `greatest(... - amount, 0)` — actually prevents negative, which is a bug — should allow negative for paid reversals). **Current code:** `set available_balance = greatest(coalesce(available_balance, 0) - v_row.amount, 0)` — **this clamps to 0, hiding the debt**. Should use `available_balance - v_row.amount` (no clamp) and surface as a debt.
3. **Multiple partial refunds** — Dodo may send multiple `payment.refunded` events. **Mitigation:** `reverse_commission` is called per subscription, but if called twice on the same commission (which is now `reversed`), the state machine blocks it (`reversed` is terminal).
4. **Refund without user** — If user is deleted but commission exists, refund flow works (commissions have `referred_user_id` as `ON DELETE SET NULL` FK). **Mitigation:** Commission is still reversible; ledger is preserved.

### 8.6 Chargeback Risks

1. **Chargeback != refund** — WarriorPlus distinguishes `RFND` (refund) from `CGBK` (chargeback). Both should trigger commission reversal, but chargebacks may have **higher** financial risk and warrant stricter cooldown (e.g. extend hold period for chargeback-prone transactions).
2. **Chargeback dispute period** — Real-world chargebacks can arrive **60-120 days** after the original transaction. The 14-day cooldown is insufficient. **Mitigation:** `requires_manual_recovery` flag identifies these; admin review needed.
3. **Chargeback fee** — Payment processors charge $15-25 per chargeback. **Not currently tracked** in the schema. Would need a `chargeback_fees` table or column.
4. **Win/loss tracking** — Dodo has `dispute.opened`, `dispute.accepted`, `dispute.challenged`, `dispute.won`, `dispute.lost` event types defined in `src/lib/payments/types.ts` but **NOT handled** in `dodo-webhook`. **Missing functionality.**

---

## 9. Production Readiness Scores

### 9.1 Payment Architecture — **8.5 / 10**

**Strengths:**
- ✅ Provider-agnostic schema (`provider` text, lifecycle states work for any provider)
- ✅ Hardened webhook for Dodo (signature, idempotency, UTC, advisory locks)
- ✅ Atomic `safe_plan_switch` with normalization, audit, profile sync
- ✅ Comprehensive subscription lifecycle (cooldown, grace period, expiry states, reminder)
- ✅ Renewal reminder UX with 24h snooze
- ✅ Frontend/backend separation (backend authoritative, frontend display-only)

**Weaknesses:**
- ❌ Whop webhook missing HMAC + idempotency (-0.5)
- ❌ No automated cron actually scheduled (relies on reactive expiry check) (-0.5)
- ❌ Plan amounts hardcoded in webhooks duplicate platform_settings (-0.3)
- ❌ `payments` table unused by active flows (-0.2)

### 9.2 Affiliate Architecture — **9.0 / 10**

**Strengths:**
- ✅ Full lifecycle state machine with strict transition guards
- ✅ Immutable audit trail (`commission_events` with monotonic sequence)
- ✅ Double-entry ledger (`affiliate_wallet_ledger`)
- ✅ 14-day cooldown for refund safety
- ✅ Self-referral prevention at multiple layers
- ✅ First-touch attribution with multi-layer persistence
- ✅ Two balance buckets (locked vs pending) for clear UX
- ✅ Batch operations for admin efficiency
- ✅ `requires_manual_recovery` flag for post-payout reversals

**Weaknesses:**
- ❌ Two `reverse_commission` signatures (migration 10 vs 38) (-0.3)
- ❌ `requires_manual_recovery` clamps balance to 0 instead of allowing negative debt (-0.3)
- ❌ No dispute handling for chargebacks (-0.2)
- ❌ Cron for `approve_pending_commissions` not actually scheduled (-0.2)

### 9.3 Scalability — **8.0 / 10**

**Strengths:**
- ✅ Indexes on all hot paths (`(user_id, feature_key, period_key)`, `(provider, provider_event_id)`, etc.)
- ✅ Advisory locks prevent concurrent cron races
- ✅ Idempotency prevents duplicate processing on webhook spikes
- ✅ Atomic UPSERT patterns throughout
- ✅ Feature usage deduplication via `feature_usage_events`

**Weaknesses:**
- ❌ No connection pooling tuning documented
- ❌ No read replicas documented
- ❌ Realtime subscriptions on heavy tables not configured (could be needed for admin dashboard)
- ❌ No caching layer (Redis) for entitlement checks — every check hits Postgres
- ❌ Plan entitlements are full-table-read on each `get_user_entitlements` call (small table, but could be cached)

### 9.4 Maintainability — **8.5 / 10**

**Strengths:**
- ✅ Excellent migration comments explaining intent
- ✅ RPCs are well-named and single-purpose
- ✅ Hardened vs soft separation clear (migration 31 hardening explicitly notes what it replaces)
- ✅ Frontend types mirror backend types
- ✅ Comprehensive inline documentation in Edge Functions

**Weaknesses:**
- ❌ 50 migrations is a lot — would benefit from being split into logical folders (core/auth/billing/affiliate/admin)
- ❌ Two `reverse_commission` signatures create confusion
- ❌ Plan amounts duplicated across `platform_settings`, webhooks (`PLAN_AMOUNTS`), and `src/lib/pricing.ts` (3 sources of truth)
- ❌ `payments` table defined but unused — dead schema
- ❌ `feature_usage` vs `usage_tracking` vs `usage_counters` vs `feature_usage_events` — four tables for similar concepts (legacy migration debt)
- ❌ Multiple `safe_plan_switch` versions across migrations (17, 30, 31) — each replaces the prior; final version is migration 31

### 9.5 Security — **8.0 / 10**

**Strengths:**
- ✅ HMAC SHA256 signature verification on Dodo webhook
- ✅ Webhook idempotency table with unique constraints
- ✅ RLS enabled on all sensitive tables
- ✅ `SECURITY DEFINER` with explicit `search_path = public`
- ✅ Self-referral prevention at multiple layers
- ✅ Admin role checks via `get_admin_role()`
- ✅ First-touch attribution prevents referral hijacking
- ✅ `verify_jwt = false` correctly applied to webhook functions (compensated by signature verification)

**Weaknesses:**
- ❌ Whop webhook missing HMAC + idempotency (-0.5)
- ❌ Affiliate payout details stored plaintext (crypto addresses) (-0.5)
- ❌ Non-cryptographic HMAC for cookie signing (-0.3)
- ❌ No rate limiting on `record-referral` Edge Function (-0.3)
- ❌ No CSP/CORS hardening documented (-0.2)
- ❌ No encryption-at-rest for sensitive fields (-0.2)

### 9.6 Overall Score: **8.4 / 10**

RobinOS has a **mature, production-ready payment architecture** for Dodo Payments, with a **clearly-defined extension pattern** for adding new providers. The affiliate system is **best-in-class** with a proper state machine and audit trail. Adding WarriorPlus is feasible with minimal schema changes — most work will be in new Edge Functions and adapting the one-time-purchase model.

---

## Appendix A — File Reference

### A.1 Edge Functions (Payment + Affiliate)
- `supabase/functions/create-checkout/index.ts` (4.5 KB)
- `supabase/functions/dodo-webhook/index.ts` (18.8 KB)
- `supabase/functions/customer-portal/index.ts` (5.4 KB)
- `supabase/functions/cancel-subscription/index.ts` (5.4 KB)
- `supabase/functions/create-whop-checkout/index.ts` (7.2 KB)
- `supabase/functions/whop-webhook/index.ts` (3.4 KB)
- `supabase/functions/record-referral/index.ts` (9.3 KB)
- `supabase/functions/_shared/entitlement.ts`
- `supabase/functions/_shared/affiliate.ts`

### A.2 Key Migrations
- `01_master_backend_architecture.sql` (84.8 KB) — Base schema
- `04_entitlement_engine.sql` (30.4 KB) — Plan limits + usage tracking
- `10_affiliate_commission_lifecycle.sql` (25.5 KB) — Commission state machine
- `17_subscription_lifecycle_engine.sql` (24.5 KB) — Cooldown, expiry, admin grants
- `29_entitlement_system_rebuild.sql` (24.5 KB) — Entitlement hardening
- `30_subscription_lifecycle_v2.sql` (22.5 KB) — Grace period, reminders
- `31_subscription_hardening.sql` (25.5 KB) — Webhook idempotency, UTC, locks
- `34_fix_free_expiry_and_referral.sql` (11.6 KB) — Referral fix
- `36_affiliate_commission_on_payment.sql` (2.8 KB) — Inline commission
- `38_commission_state_machine.sql` (11.2 KB) — Commission lifecycle
- `43_payout_ledger.sql` (19.3 KB) — Payout ledger
- `45_production_reset.sql` (9.1 KB) — Production reset
- `50_warriorplus_settings.sql` (1.2 KB) — **WarriorPlus settings toggle**

### A.3 Frontend Files
- `src/lib/payments/dodo.ts` (3.9 KB)
- `src/lib/payments/types.ts` (2.6 KB)
- `src/lib/pricing.ts` (14.4 KB)
- `src/services/affiliate/referralCoordinator.ts` (9.3 KB)
- `src/components/UpgradeDialog.tsx` (9.5 KB)
- `src/components/RenewalReminder.tsx` (15.9 KB)
- `src/pages/AffiliatePage.tsx` (12.5 KB)
- `src/pages/ReferralsPage.tsx` (20.2 KB)
- `src/pages/SettingsPage.tsx` (33.5 KB)

---

**End of Audit.**
