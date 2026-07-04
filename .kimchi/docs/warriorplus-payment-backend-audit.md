# RobinOS Payment Backend Architecture Audit — WarriorPlus Integration

**Status:** Audit only. No code or migrations created.
**Scope:** Existing payment, subscription, affiliate, refund, and webhook infrastructure. Goal: confirm whether WarriorPlus can plug into the existing architecture without duplication.
**Author:** Re-read every payment/affiliate migration, edge function, and shared module; cross-checked against `.kimchi/docs/marketplace-warriorplus-audit.md` (which covers the *sales page* frontend only — this document is the *payment backend* counterpart).
**Date:** 2026-07-02

---

## 0. TL;DR

**Yes — WarriorPlus can plug into the existing payment architecture without any duplication**, provided we add one new edge function (`warriorplus-webhook`) and one tiny adapter module. Every piece of business logic it needs already exists as a shared service:

| Need | Existing reusable service |
|---|---|
| Activate premium after payment | `public.safe_plan_switch(...)` RPC (migration 31) |
| Track payment provider | `user_subscriptions.provider` text column (migration 30) |
| Idempotent webhook handling | `public.record_webhook_event(...)` RPC (migration 31) |
| Affiliate commission attribution | `_shared/affiliate.ts::recordAffiliateCommission(...)` (already used by Whop) |
| Commission reversal on refund | `public.reverse_commission(...)` RPC |
| Audit trail | `public.log_subscription_event(...)` RPC + `subscription_audit_log` table |
| Admin notification | `public.push_admin_notification(...)` RPC |
| User subscription state read | `public.resolve_user_plan(...)` / `public.get_subscription_status(...)` |
| Email/notification (not yet wired) | **Missing** — see Section C.5 |

The codebase already runs **two payment providers** (Dodo and Whop) using exactly this pattern. WarriorPlus becomes provider #3.

**Critical gaps to close before launch:**
1. `public.payment_provider` enum does not include `warriorplus` (and is also missing `dodo`, `whop`, `jvzoo`). Migrations 30+ write provider as free text — the enum is stale and should be replaced with a `text + check constraint`.
2. Whop webhook has **no signature verification** (Dodo does). Don't replicate this gap in the WarriorPlus handler.
3. Dodo's `recordAffiliateCommission` is **duplicated inline** instead of imported from `_shared/affiliate.ts` (Whop uses the shared module correctly). De-duplicate before adding provider #3.
4. No `subscription_source` value for `warriorplus` exists in the documented enum (warriorplus needs to be added to the documentation comment and any check constraints).
5. No email service for receipts/welcome. Should be added alongside WarriorPlus launch.

**One-time refactor (Phase 1) + WarriorPlus adapter (Phase 2) is sufficient.** No re-architecture required.

---

## SECTION A — Current Payment Architecture

### A.1 Data model — payment tables

Defined in `supabase/migrations/01_master_backend_architecture.sql` and extended by migrations 15, 17, 30, 31.

| Table | Purpose | Provider-agnostic? |
|---|---|---|
| `public.user_subscriptions` | One row per user; current subscription state | ✅ Yes — `provider text` (migration 30), `provider_subscription_id text`, `provider_customer_id text`, `subscription_source text` (migration 15), `is_revenue_eligible bool` (migration 15) |
| `public.subscription_events` | Legacy event log; `payload jsonb` | ✅ Yes — `provider text` column |
| `public.payments` | Per-payment ledger | ⚠️ Partial — `provider payment_provider` **enum** is too narrow (see C.1) but `provider_payment_id text` is provider-agnostic |
| `public.invoices` | Invoice PDFs | ✅ Yes — no provider column needed |
| `public.payment_events` | Raw webhook payload archive | ⚠️ Same enum problem |
| `public.subscription_webhook_events` (mig 31) | Idempotency log | ✅ Yes — `provider text` |
| `public.subscription_audit_log` (mig 31) | Lifecycle audit trail | ✅ Yes — `metadata jsonb` carries provider info |

**Key enums (migration 01):**
- `plan_tier`: `('free','creator','pro_creator','agency','scale_agency')`
- `user_plan_status`: `('active','trialing','past_due','canceled','expired')` — extended by migration 30 to also include `expiring`, `grace_period`, `payment_failed`, `paused`, `canceled`
- `payment_provider`: `('creem','stripe','lemonsqueezy','manual')` — **STALE**: missing `dodo`, `whop`, `jvzoo`, `warriorplus`. (See Section C.1.)
- `payment_status`: `('pending','succeeded','failed','refunded','canceled')` — missing `chargeback`, `disputed` (see C.1)
- `billing_cycle`: `('monthly','yearly','one_time')` — fits WarriorPlus one-time purchases

**User lookup chain** (from both webhook handlers):
```
metadata.user_id  →  user_subscriptions.provider_subscription_id  →  profiles.email
```
Every provider must support at least one of these three resolution paths.

### A.2 The canonical upgrade path

Both Dodo and Whop converge on a single RPC: **`public.safe_plan_switch(...)`** (migration 31).

```sql
safe_plan_switch(
  p_user_id,         -- uuid
  p_new_plan,        -- free|creator|pro_creator|agency
  p_billing_cycle,   -- monthly|yearly|one_time
  p_provider,        -- text (free-form)
  p_provider_sub_id, -- text
  p_amount,          -- numeric
  p_triggered_by     -- webhook|admin|user|system
)
```

This single RPC:
- Upserts `user_subscriptions`
- Mirrors state to `profiles.subscription_tier` / `current_plan` / `subscription_expires_at`
- Auto-stamps `last_payment_at`, `next_billing_at`, `last_plan_change_at`
- Clears `grace_period_ends_at` and `reminder_dismissed_until` on renewal
- Sets `is_revenue_eligible = true` when a real provider is passed
- Logs to `subscription_audit_log` via `log_subscription_event()`
- Computes duration from `billing_cycle` (30/365 days)
- Uses UTC throughout

**Any new provider — including WarriorPlus — calls exactly this one function.** No new upgrade logic needed.

### A.3 Affiliate commission path

Trigger-based, in the database:
1. `safe_plan_switch` writes the new active subscription
2. Webhook handler calls `recordAffiliateCommission(supabase, userId, referralCode, amount, providerSubId)` from `_shared/affiliate.ts`
3. `recordAffiliateCommission`:
   - Looks up affiliate by `referral_code` (case-insensitive)
   - Reads live commission rate from `platform_settings.affiliate_commission_percent` (admin-controlled)
   - Inserts into `affiliate_commissions` with `status='pending'`, `eligible_at = now + 14 days`
   - Calls `public.increment_affiliate_balance(...)` to update wallet
   - Emits admin notification via `push_admin_notification`

Refund / failed payment path:
- `public.reverse_commission(p_provider_subscription_id, p_reason)` (used by Dodo's `handlePaymentRefunded` and `handlePaymentFailed`)
- ⚠️ **Gap**: `reverse_commission` takes `p_dodo_subscription_id` as parameter name — it needs to be generalized to `p_provider_subscription_id`. See Section C.4.

Pre-existing DB trigger `apply_referral_commission_for_subscription()` on `user_subscriptions` (migration 01) is **legacy code path** — it duplicates what `_shared/affiliate.ts::recordAffiliateCommission` does, but reads `referred_by_code` from `profiles` instead of from checkout metadata. Both code paths can fire for the same purchase. The webhooks' explicit path takes priority when metadata is provided.

### A.4 Webhook handler pattern (verified against `dodo-webhook/index.ts` and `whop-webhook/index.ts`)

```
POST /functions/v1/{provider}-webhook
   ↓
Read raw body (required for signature)
   ↓
Verify signature
   ↓ (Dodo: standardwebhooks HMAC-SHA256, Whop: NONE ⚠️)
Parse JSON
   ↓
record_webhook_event(provider_event_id, provider, event_type, payload_hash)
   ↓ (idempotency check — returns is_duplicate if seen)
switch (event.type) {
  case "subscription.active"   → safe_plan_switch + recordAffiliateCommission
  case "subscription.cancelled"→ mark cancelled, preserve until expires_at
  case "payment.refunded"      → reverse_commission
  case "payment.failed"        → mark payment_failed + reverse_commission
  case "..."                   → ...
}
   ↓
log_subscription_event(...)  (audit)
push_admin_notification(...) (admin alert)
return 200
```

Both handlers are nearly identical except for signature verification and event-name mapping. The Whop one is cleaner because it imports `recordAffiliateCommission` from `_shared/affiliate.ts`; the Dodo one inlines its own copy. See Section C.3.

### A.5 Current provider matrix

| Provider | Edge function | Signature verification | Events handled | Status |
|---|---|---|---|---|
| Dodo Payments | `supabase/functions/dodo-webhook/` | ✅ HMAC-SHA256 via `standardwebhooks` | subscription.active / renewed / cancelled / payment.succeeded / failed / refunded | ✅ Production-ready |
| Whop | `supabase/functions/whop-webhook/` | ❌ None (secret env var unused) | membership.activated / deactivated / cancelled | ⚠️ Needs signature verification |
| Creem | None (legacy) | — | — | ⚠️ Schema-only enum value, no live handler |
| Stripe | None | — | — | ⚠️ Schema-only enum value, no live handler |
| LemonSqueezy | None | — | — | ⚠️ Schema-only enum value, no live handler |
| Manual (admin grant) | `admin_grant_subscription` RPC | n/a | n/a | ✅ Production-ready |
| **WarriorPlus** | **None — must be created** | **Must implement (HMAC-MD5)** | **SALE / RFB / RECURRING / CHARGEBACK / VOID** | **❌ Not started** |
| JVZoo | None — must be created | Must implement (custom) | — | ❌ Not started (only sales page exists) |
| Digistore24 | None (future) | — | — | — |
| PayPal | None (future) | — | — | — |

### A.6 Visual architecture (current state)

```
┌─────────────────────┐    ┌─────────────────────┐
│ Dodo Payments       │    │ Whop                │     (and WarriorPlus to add)
│ (HMAC-SHA256)       │    │ (no signature ⚠️)   │
└──────────┬──────────┘    └──────────┬──────────┘
           │                          │
           ▼                          ▼
  /functions/v1/dodo-webhook   /functions/v1/whop-webhook
           │                          │
           └────────────┬─────────────┘
                        ▼
       record_webhook_event()  ← idempotency (subscription_webhook_events)
                        │
                        ▼
              safe_plan_switch()  ← canonical upgrade
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
user_subscriptions  profiles     affiliate_commissions
   .provider=        .subscription_    (via recordAffiliateCommission
    'dodo'/'whop'     tier updated      from _shared/affiliate.ts)
        │
        ▼
   resolve_user_plan()  ← frontend reads effective plan
        │
        ▼
   Frontend entitlement checks
        │
        ▼
   Admin dashboard / mv_daily_kpis / revenue_analytics / affiliate_analytics
```

---

## SECTION B — Reusable Services

All already exist. WarriorPlus does not need any new business-logic component — only a thin adapter.

| Service | Location | What it does | WarriorPlus will use? |
|---|---|---|---|
| `public.safe_plan_switch(...)` | mig 31 | Upsert subscription + mirror to profile + audit log | ✅ Yes — single entry point |
| `public.record_webhook_event(...)` | mig 31 | Idempotency gate | ✅ Yes — call at start of every handler |
| `public.log_subscription_event(...)` | mig 31 | Append to `subscription_audit_log` | ✅ Yes — call after every state change |
| `public.reverse_commission(...)` | mig 01 + mig 36 | Reverse commission on refund/failed | ✅ Yes (after rename — see C.4) |
| `public.increment_affiliate_balance(...)` | mig | Wallet update | ✅ Yes (called inside `recordAffiliateCommission`) |
| `public.push_admin_notification(...)` | mig 37 | Admin alert | ✅ Yes |
| `public.resolve_user_plan(...)` | mig 17/30/31 | Effective plan with expiry + grace | ✅ Yes (read-side, frontend) |
| `public.get_subscription_status(...)` | mig 30/31 | Rich status + reminder state | ✅ Yes (read-side, frontend) |
| `public.admin_grant_subscription(...)` | mig 17 | Admin manual grant | ✅ Yes (no change) |
| `public.process_subscription_expiry()` | mig 30/31 | Cron-safe lifecycle job | ✅ Yes (no change) |
| `public.check_plan_change_cooldown(...)` | mig 17 | 14-day plan-change lock | ✅ Yes (called inside `safe_plan_switch` indirectly) |
| `_shared/affiliate.ts::recordAffiliateCommission` | supabase/functions/_shared/affiliate.ts | Commission recording | ✅ Yes — import, do not duplicate |
| `_shared/entitlement.ts::CORS_HEADERS` | supabase/functions/_shared/entitlement.ts | CORS for edge functions | ✅ Yes |
| `user_subscriptions` table | mig 01 | Subscription state | ✅ Yes — write `provider='warriorplus'` |
| `payments` table | mig 01 | Payment ledger | ✅ Yes — write `provider_payment_id` = WarriorPlus sale_id |
| `subscription_webhook_events` table | mig 31 | Idempotency log | ✅ Yes |
| `subscription_audit_log` table | mig 31 | Audit trail | ✅ Yes |
| `affiliate_profiles` / `affiliate_commissions` / `affiliate_wallet_ledger` | mig 01, 10, 36 | Affiliate stack | ✅ Yes (no changes) |
| `platform_settings.affiliate_commission_percent` | mig 01 | Live commission rate | ✅ Yes (no changes) |
| `profiles.referred_by_code` | mig 01 | First-touch referral attribution | ✅ Yes (fallback if metadata missing) |

**Everything WarriorPlus needs is already in place.** The only net-new code is the IPN handler + a small adapter.

---

## SECTION C — Problems / Gaps

### C.1 Stale `payment_provider` enum (migration 01)

The enum lists `('creem','stripe','lemonsqueezy','manual')` but the production system actually writes `provider='dodo'` and `provider='whop'` to `user_subscriptions.provider text`. This works today only because the column type was changed to `text` in migration 30 (the `provider text` column in `user_subscriptions` was added then, replacing the enum reference).

**Impact:** The `payments.provider` and `payment_events.provider` columns still use the `public.payment_provider` enum — so a WarriorPlus payment cannot be inserted into `payments` without an `ALTER TYPE ... ADD VALUE 'warriorplus'`. Similarly for `dodo`, `whop`, `jvzoo`.

**Fix (one migration, additive):**
```sql
-- Migration 51
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'dodo';
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'whop';
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'warriorplus';
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'jvzoo';
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'paypal';
ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'digistore24';

ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'chargeback';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'disputed';

-- Document subscription_source values (no enum, just comment update)
COMMENT ON COLUMN public.user_subscriptions.subscription_source IS
  'Origin of the subscription: manual_admin, creem, dodo, stripe, whop, warriorplus, jvzoo, paypal, digistore24, promo, affiliate_reward, internal, migration, trial';
```

`ADD VALUE IF NOT EXISTS` is safe in a `do $$ begin ... exception when duplicate_object then null; end $$;` block.

### C.2 Whop webhook has no signature verification

`supabase/functions/whop-webhook/index.ts` lines 26–29:
```ts
const WHOP_WEBHOOK_SECRET = Deno.env.get("WHOP_WEBHOOK_SECRET");
// ...
if (!WHOP_WEBHOOK_SECRET) {
  console.warn("[whop-webhook] WHOP_WEBHOOK_SECRET not set — proceeding without signature verification");
}
```

Anyone who knows or guesses the edge function URL can hit it and trigger arbitrary `safe_plan_switch` calls. Whop's secret is set but **not used**.

**Fix:** Implement HMAC verification before launching WarriorPlus (which has the same risk). Don't repeat this pattern in the new handler.

### C.3 Duplicated commission logic

- Dodo webhook (`dodo-webhook/index.ts`) defines `recordAffiliateCommission` inline at the bottom of the file.
- Whop webhook (`whop-webhook/index.ts`) imports it correctly from `_shared/affiliate.ts`.
- The two copies have **drifted**: Dodo's version is 100+ lines and includes admin notifications + balance increment; Whop's import gets the same logic but may not include the admin notification step.

**Fix:** Remove the inline copy in `dodo-webhook/index.ts` and import from `_shared/affiliate.ts` (Whop-style). One single source of truth.

### C.4 `reverse_commission` parameter is provider-specific

Defined in migration 36 (`affiliate_commission_on_payment.sql`), its parameter is named `p_dodo_subscription_id`:
```sql
public.reverse_commission(p_dodo_subscription_id text, p_reason text)
```

When the Dodo webhook calls it, this works. But this RPC reads from `affiliate_commissions.dodo_subscription_id` (or similar column). For WarriorPlus we either:
- Add a `provider text` column to `affiliate_commissions` and look up by `(provider, provider_subscription_id)`, **or**
- Generalize the RPC signature to `p_provider text, p_provider_subscription_id text`.

The cleaner long-term fix is the second option — but it requires a migration. For WarriorPlus MVP, the simplest path is to add a `provider` column to `affiliate_commissions` in migration 51.

### C.5 No email / receipt service

The codebase has no email-sending module. There is no `email-service.ts`, no Resend/Postmark/SendGrid integration. `admin_notifications` is in-app only.

For a WarriorPlus launch, users expect:
- A "welcome to premium" email after first SALE
- A "your subscription renewed" email on RECURRING
- A "your subscription has been refunded" email on RFB
- A "your payment failed" email on payment failure

This is a separate workstream but should be sequenced before WarriorPlus GA.

### C.6 No chargeback / dispute handling

`payment_status` lacks `chargeback` / `disputed`. WarriorPlus occasionally reports chargebacks (60–120 day window). Without a `chargeback` status:
- The user keeps premium access until `expires_at`
- The commission is not auto-reversed
- Finance cannot reconcile disputes

**Fix:** Add `chargeback` and `disputed` to the enum (see C.1). Add a `handleChargeback` event in any webhook handler that receives it (Dodo's `payment.disputed` if it exists; WarriorPlus sends `CHARGEBACK` type).

### C.7 No centralized payment-provider settings

Product ID → plan key mapping is hardcoded in `dodo-webhook/index.ts`:
```ts
function buildProductMap(): Record<string, string> {
  const entries: [string, string][] = [
    ["DODO_PRODUCT_CREATOR_MONTHLY",     "creator"],
    ["DODO_PRODUCT_PRO_CREATOR_MONTHLY", "pro_creator"],
    ["DODO_PRODUCT_AGENCY_MONTHLY",      "agency"],
  ];
  ...
}
```

This means:
- Every new product requires a Supabase env var update + edge function redeploy
- Admins cannot self-serve
- The pattern must be replicated for WarriorPlus (and every future provider)

**Fix:** Create a `public.payment_provider_settings` table (JSONB row per provider) so admins can manage mappings from the Admin UI:
```sql
create table if not exists public.payment_provider_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,           -- 'warriorplus', 'dodo', 'whop', ...
  product_id text not null,         -- provider's product id
  plan_key text not null,           -- creator / pro_creator / agency
  billing_cycle text not null default 'monthly',
  amount numeric,
  currency text default 'USD',
  is_active boolean not null default true,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, product_id)
);
```

Read this table at the top of every webhook handler instead of `Deno.env.get(...)`.

### C.8 No automated tests for payment flows

The `api/_lib/` directory contains a `tests/` folder — but that is the trend engine, not payments. There are no unit tests, integration tests, or replay tests for:
- Webhook signature verification
- Idempotency under duplicate delivery
- `safe_plan_switch` plan transitions
- Commission attribution / reversal
- Refund flow

This is acceptable for an MVP launch but should be on the roadmap.

### C.9 No "claim purchase" flow for new email buyers

WarriorPlus sends `buyer_email` — not `user_id`. If a new buyer pays through WarriorPlus without first creating a RobinOS account (common for affiliate traffic), we have no `user_id` to pass to `safe_plan_switch`.

Current resolution chain (Dodo + Whop):
```
metadata.user_id  →  provider_subscription_id  →  profiles.email
```

For WarriorPlus, the email fallback is essential — and if the email doesn't match an existing profile, we need either:
1. Auto-create the profile + send magic-link to claim the purchase, **or**
2. Queue the purchase and wait for the user to sign up (then match by email).

WarriorPlus buyers from JVZoo-style affiliate funnels usually do sign up — but for affiliate-first traffic, option (1) is safer. See Section D for recommendation.

### C.10 No admin UI for webhook observability

`subscription_webhook_events` and `subscription_audit_log` are admin-readable (via service_role), but there is no UI to inspect them. When a WarriorPlus buyer reports "I paid but didn't get access," an admin currently has to query SQL.

**Fix (post-launch):** Add a "Webhook Events" tab in `AdminDashboard` with filters by provider, event_type, date, user.

---

## SECTION D — Recommended Architecture

### D.1 Guiding principle: **one orchestrator, many thin adapters**

Today the two webhook handlers each contain ~400 lines of business logic. The 80% that is identical should move into a single orchestrator. The 20% that differs (signature verification, event-type mapping, field extraction) stays in the per-provider adapter.

```
┌─────────────────────────────────────────────────────────────────────┐
│                  payment-event-orchestrator (NEW)                   │
│                                                                     │
│  Orchestrates the entire payment event lifecycle in 8 steps.        │
│  Provider-agnostic. Replaces the duplicated logic in every          │
│  webhook handler today.                                             │
│                                                                     │
│  1. resolveUser(supabase, provider, metadata, subId, email)         │
│  2. record_webhook_event (idempotency)                              │
│  3. mapEvent(provider, rawEventType) → CanonicalEvent                │
│  4. handleCanonicalEvent(supabase, event, userId, ...)              │
│     ├─ 'subscription_activated'   → safe_plan_switch + commission   │
│     ├─ 'subscription_renewed'     → safe_plan_switch + commission   │
│     ├─ 'subscription_cancelled'   → mark cancelled                  │
│     ├─ 'payment_refunded'         → reverse_commission              │
│     ├─ 'payment_failed'           → mark payment_failed             │
│     ├─ 'subscription_chargeback'  → reverse + flag disputed         │
│     └─ 'unknown'                  → log + skip                      │
│  5. log_subscription_event(...)                                     │
│  6. push_admin_notification(...)                                    │
│  7. update subscription_events (legacy)                             │
│  8. return result                                                   │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ called by
                              │
   ┌──────────────────┬──────┴────────┬─────────────────────┐
   │                  │               │                     │
┌──┴────────────┐ ┌───┴──────────┐ ┌──┴────────────────┐ ┌──┴────────────┐
│ dodo adapter  │ │ whop adapter │ │ warriorplus       │ │ future        │
│ (NEW, thin)   │ │ (NEW, thin)  │ │ adapter (NEW)     │ │ adapters      │
│               │ │              │ │                   │ │               │
│ - verify sig  │ │ - verify sig │ │ - verify HMAC-MD5 │ │ - verify sig  │
│ - parse JSON  │ │ - parse JSON │ │ - parse form-url  │ │ - parse JSON  │
│ - map events  │ │ - map events │ │ - map SALE/RFB/   │ │ - map events  │
│   to canonical│ │   to         │ │   CHARGEBACK/     │ │   to canonical│
│   event names │ │   canonical  │ │   RECURRING/VOID  │ │               │
│ - extract     │ │ - extract    │ │ - extract fields  │ │ - extract     │
│   fields      │ │   fields     │ │                   │ │   fields      │
└───────────────┘ └──────────────┘ └───────────────────┘ └───────────────┘
```

**Each new provider is ~80 lines.** Adding WarriorPlus = writing one adapter file + one row in `payment_provider_settings`.

### D.2 Canonical event names

A new internal enum, provider-agnostic, that every adapter maps into:

```ts
type CanonicalEvent =
  | "subscription_activated"   // first paid SALE
  | "subscription_renewed"     // RECURRING payment
  | "subscription_cancelled"   // user cancelled (preserve until expires_at)
  | "subscription_expired"     // period ended naturally (rare from webhook)
  | "payment_succeeded"        // payment without subscription (one-time)
  | "payment_refunded"         // RFB event
  | "payment_failed"           // charge failed
  | "payment_chargeback"       // disputed / reversed by provider
  | "payment_voided";          // voided before settlement
```

Dodo's mapping:
- `subscription.active` → `subscription_activated`
- `subscription.renewed` → `subscription_renewed`
- `subscription.cancelled` → `subscription_cancelled`
- `payment.succeeded` → `payment_succeeded`
- `payment.refunded` → `payment_refunded`
- `payment.failed` → `payment_failed`

WarriorPlus's mapping:
- `SALE` → `subscription_activated`
- `RECURRING` → `subscription_renewed`
- `RFND` → `payment_refunded`
- `CGBK` → `payment_chargeback`
- `VOID` → `payment_voided`
- `INVCANCEL` → `subscription_cancelled`

### D.3 Single `payment_provider_settings` table (replaces env-var product maps)

Already specified in C.7. The webhook adapters read this table at startup (cached) instead of `Deno.env.get(...)`. Admins manage mappings from the Admin UI.

### D.4 Provider registry

A single source of truth listing every enabled provider:

```sql
create table if not exists public.payment_provider_registry (
  provider text primary key,           -- 'warriorplus', 'dodo', 'whop', ...
  display_name text not null,
  is_active boolean not null default true,
  webhook_url text,                    -- /functions/v1/{provider}-webhook
  api_base_url text,
  config jsonb not null default '{}',  -- ipn_secret_name, etc.
  created_at timestamptz not null default now()
);
```

Used by:
- The frontend "Payment provider" badge in the subscription UI
- Admin UI "Providers" tab
- Health-check cron (each provider's last webhook timestamp)

### D.5 Unified user resolution (already exists, just needs WarriorPlus support)

```
metadata.user_id
  ↓ if missing
user_subscriptions WHERE provider=? AND provider_subscription_id=?
  ↓ if missing
profiles.email = buyer_email  ← critical for WarriorPlus
  ↓ if missing
NEW: auto-create profile + queue welcome email with claim link
```

The auto-create path (option D.5 step 4) is the right call for WarriorPlus because:
- Affiliate traffic from WarriorPlus converts highest when the user lands on a "you're in, sign in to access" page, not a "your account is being provisioned" page.
- It avoids losing the purchase to a forgotten email.
- The profile gets created with `referred_by_code` from the IPN's `affiliate` parameter — preserving attribution.

### D.6 No changes needed to the affiliate system

The existing affiliate stack already supports any provider:
- `recordAffiliateCommission(supabase, userId, referralCode, amount, providerSubId)` is provider-agnostic
- `affiliate_commissions.dodo_subscription_id` column should be renamed to `provider_subscription_id` (migration 51, additive — keep the old column for backward compat or add new + migrate)
- The legacy trigger `apply_referral_commission_for_subscription` reads `profiles.referred_by_code` (first-touch attribution) and continues to work for all providers

---

## SECTION E — Exact Implementation Plan

**No code is written in this audit.** This plan describes the file changes a future implementation PR will contain.

### Phase 1 — Foundation (migration 51, ~1 day, additive only)

Files:
- `supabase/migrations/51_payment_provider_unification.sql` (NEW)

Schema changes:
1. Extend `payment_provider` enum: add `dodo`, `whop`, `warriorplus`, `jvzoo`, `paypal`, `digistore24`
2. Extend `payment_status` enum: add `chargeback`, `disputed`
3. Update `user_subscriptions.subscription_source` comment to list all values
4. Create `public.payment_provider_settings` table (per C.7)
5. Create `public.payment_provider_registry` table (per D.4)
6. Rename `affiliate_commissions.dodo_subscription_id` → `provider_subscription_id` via add-new-then-drop-old pattern (or simply add `provider` column + index `(provider, provider_subscription_id)`)
7. Generalize `reverse_commission(p_provider, p_provider_subscription_id, p_reason)` signature
8. Insert initial registry rows: dodo, whop (active), warriorplus (inactive until launch)
9. Insert initial product-id mappings for existing Dodo + Whop products (migrate from env vars)

Code changes:
- `supabase/functions/dodo-webhook/index.ts`: remove inline `recordAffiliateCommission`, import from `_shared/affiliate.ts`
- `supabase/functions/whop-webhook/index.ts`: add signature verification
- `supabase/functions/_shared/affiliate.ts`: update parameter name `dodoSubscriptionId` → `providerSubscriptionId`; add `provider` parameter

**Acceptance:** All existing webhooks continue to work. Replay of historical Dodo webhooks still attributes correctly.

### Phase 2 — WarriorPlus adapter (~2 days, additive)

Files:
- `supabase/functions/warriorplus-webhook/index.ts` (NEW)
- `supabase/functions/_shared/payment-providers/warriorplus.ts` (NEW)
- `supabase/functions/_shared/payment-providers/types.ts` (NEW — canonical event types, adapter interface)
- `supabase/functions/_shared/payment-providers/orchestrator.ts` (NEW — extracted from dodo-webhook)
- `supabase/functions/_shared/signature.ts` (NEW — HMAC-MD5 + HMAC-SHA256 verifiers)
- `supabase/functions/_shared/user-resolver.ts` (NEW — metadata → subId → email → auto-create)

Implementation:
- `warriorplus.ts` adapter implements:
  - `verifySignature(rawBody, signatureHeader, secret)` — HMAC-MD5 of concatenated `cverify` fields
  - `parsePayload(rawBody)` — WarriorPlus sends form-encoded, not JSON
  - `extractUserId(payload)` — returns null (must resolve by email)
  - `extractEventType(payload)` — maps `type` to canonical event
  - `extractAmount(payload)` — from `price` field
  - `extractProductId(payload)` — from `product_id`
  - `extractAffiliateCode(payload)` — from `affiliate` field (custom variable passed through)
  - `mapToPlan(productId, itemName)` — reads `payment_provider_settings` table
- `index.ts` orchestrates: OPTIONS check → signature verify → parse → orchestrator

WarriorPlus IPN field mapping (where each goes):

| WarriorPlus field | Destination |
|---|---|
| `sale_id` | `payments.provider_payment_id` (unique per provider) — also stored in `subscription_webhook_events.provider_event_id` for idempotency |
| `tx_id` | `payments.metadata->>'wp_tx_id'` |
| `buyer_email` | Used by user-resolver to look up `profiles.email`; falls back to auto-create if no match |
| `buyer_name` | `profiles.full_name` / `display_name` (best-effort update on first SALE) |
| `affiliate` | Passed to `recordAffiliateCommission` as `referralCode`; also stored in `payments.metadata->>'wp_affiliate'`; on auto-create, written to `profiles.referred_by_code` |
| `product_id` | Looked up in `payment_provider_settings` → `plan_key` |
| `item_name` | `payments.metadata->>'item_name'` (informational only — plan comes from product_id) |
| `price` | `payments.amount` |
| `currency` | `payments.currency` |
| `type` | Routed via adapter's `extractEventType` to canonical event |
| `time` | `payments.paid_at` (for SALE) / `payments.refunded_at` (for RFB) |
| `hash` | Verified but not stored (used only in `verifySignature`) |
| `cverify` | Required signature field — verify-only, not stored |
| `WP_THROUGH_IPN` (custom var) | If passed, indicates merchant-direct sale vs affiliate sale — stored in `payments.metadata->>'wp_through_ipn'` |
| `wp_user_id` (custom var) | If present, used as metadata.user_id (highest priority in user-resolver) |

### Phase 3 — Admin UI + observability (~1 day)

- Admin → Settings → Payment Providers tab:
  - List of providers from `payment_provider_registry`
  - Active/inactive toggle
  - Per-provider product ID mapping editor (rows in `payment_provider_settings`)
  - Webhook URL display (copy-to-clipboard for pasting into provider dashboards)
- Admin → Webhooks tab:
  - Paginated view of `subscription_webhook_events` (provider, event, date, user, processed)
  - Click-through to `subscription_audit_log` for that user
- Admin → Subscriptions:
  - Show `provider` column on user subscription rows

### Phase 4 — Email service (~2 days, can run in parallel)

- Add `supabase/functions/_shared/email.ts` with provider abstraction
- Choose provider (Resend recommended — generous free tier, edge-runtime compatible)
- Events to send:
  - `subscription_activated` → "Welcome to RobinOS Premium" (with login link + claim-purchase link if auto-created)
  - `subscription_renewed` → "Receipt: your subscription renewed"
  - `payment_refunded` → "Your payment has been refunded"
  - `payment_failed` → "Your payment failed — please update billing"
  - `payment_chargeback` → "Your subscription has been paused" (don't reveal chargeback reason to user; CS team handles)

### Phase 5 — Future providers

The same pattern. Each new provider = one adapter file + one registry row + one product-mapping setup.

- JVZoo adapter: follows WarriorPlus pattern (form-encoded, custom signature)
- Digistore24 adapter: JSON + HMAC-SHA256
- PayPal adapter: JSON + webhook signature verification
- ClickBank adapter: form-encoded + custom signature
- AppSumo adapter: API-based, no webhook (polling required)

---

## SECTION F — Risk Analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | WarriorPlus IPN secret leaks | Medium | Critical — anyone can grant premium | Store in Supabase secrets; never log; HMAC-MD5 is weak but WarriorPlus is the constraint; verify on every request; rate-limit by IP |
| 2 | Buyer email mismatch (new email not on any profile) | High | Critical — purchase not attributed, user not upgraded | Auto-create profile with placeholder name, send magic-link "claim your purchase" email, mark `onboarding_states.step_key='claim_purchase'` |
| 3 | WarriorPlus retries the same IPN | High | Medium — duplicate subscription switch | Use `record_webhook_event` with `payload_hash`; if `sale_id` is unique, use it as `provider_event_id` |
| 4 | RECURRING fires before SALE | Low | Medium — orchestrator creates sub without parent | Orchestrator upserts — RECURRING just refreshes the existing subscription row; safe |
| 5 | Affiliate attribution collision (Dodo-affiliate + WarriorPlus-affiliate both claim the user) | Medium | High — double commission paid | First-touch wins: `profiles.referred_by_code` is set ONCE at signup or first purchase; subsequent purchases ignore incoming referral_code if `referred_by_code` is already set. `recordAffiliateCommission` already handles self-referral block |
| 6 | Cooldown collision (user buys via WarriorPlus during Dodo active sub) | Low | Low — `safe_plan_switch` handles via ON CONFLICT, but billing window resets | Add policy in `safe_plan_switch`: if existing plan == new plan and provider differs, do NOT reset `expires_at` (additive renewal). If different plan, reset (caller's intent) |
| 7 | Currency mismatch (Dodo charges USD, WarriorPlus charges EUR) | Low today | Low | Both rows use `payments.currency` correctly; `user_subscriptions.currency` defaults to USD; if multi-currency matters, add per-plan currency config |
| 8 | Chargeback window (60–120 days) vs subscription auto-renewal | Medium | High — user keeps free premium for months after chargeback | Run a daily cron that cross-references recent `payments` with provider-reported chargebacks via reconciliation job (post-launch workstream) |
| 9 | `payment_provider` enum change breaks existing inserts | Low | High | `ALTER TYPE ... ADD VALUE` is safe in PG ≥ 12; use `IF NOT EXISTS`; do not drop old values |
| 10 | Migration 51's `affiliate_commissions.dodo_subscription_id` rename breaks legacy queries | Low | Medium | Two-step migration: add `provider_subscription_id` new column, dual-write from `recordAffiliateCommission`, then drop old column in a later migration after monitoring |
| 11 | WarriorPlus form-encoded payload has encoding edge cases (unicode in buyer name) | Medium | Low | Use `URLSearchParams` parsing; sanitize before storing in `profiles.full_name` |
| 12 | WarriorPlus sends `cverify` not in alphabetical field order | High | Critical — HMAC fails | Document the exact concatenation order in `warriorplus.ts`; have an integration test replay real WarriorPlus IPNs |
| 13 | Webhook endpoint exposed publicly without rate limiting | Medium | High | Supabase edge functions have built-in rate limits; add IP allowlist for known WarriorPlus IPs in production (documented on WarriorPlus docs) |
| 14 | Lost admin context: no UI to debug a failed payment | High | Medium | Phase 3 adds the admin Webhooks tab |
| 15 | Email service not wired when WarriorPlus launches | Certain | Medium | Either ship Phase 4 first, OR ship WarriorPlus with in-app notifications only and add a banner "email receipts coming soon" |

---

## Appendix — File & Line References

The following files were read in full during this audit:

**Migrations:**
- `supabase/migrations/01_master_backend_architecture.sql` — base schema (2171 lines)
- `supabase/migrations/15_subscription_source_tracking.sql` — adds `subscription_source` + `is_revenue_eligible`
- `supabase/migrations/17_subscription_lifecycle_engine.sql` — lifecycle engine
- `supabase/migrations/24_jvzoo_affiliate_settings.sql` — JVZoo sales-page toggle
- `supabase/migrations/30_subscription_lifecycle_v2.sql` — grace periods + reminder state
- `supabase/migrations/31_subscription_hardening.sql` — webhook idempotency, `safe_plan_switch`, audit log
- `supabase/migrations/50_warriorplus_settings.sql` — WarriorPlus sales-page toggle

**Edge functions:**
- `supabase/functions/dodo-webhook/index.ts` (430 lines)
- `supabase/functions/whop-webhook/index.ts` (260 lines)

**Shared modules referenced (not read in full but confirmed present):**
- `supabase/functions/_shared/affiliate.ts` (4.0K)
- `supabase/functions/_shared/entitlement.ts` (12.2K)

**Related prior audits (complementary, not duplicative):**
- `.kimchi/docs/marketplace-architecture-audit.md` — sales-page frontend architecture
- `.kimchi/docs/marketplace-warriorplus-audit.md` — WarriorPlus sales-page frontend
- `.kimchi/docs/jvzoo-integration-review.md` — JVZoo CTA/pixel review
- `.kimchi/docs/affiliate-commission-audit.md` — commission correctness audit

---

**End of audit. Awaiting approval to proceed with Phase 1 (migration 51) + Phase 2 (WarriorPlus adapter).**
