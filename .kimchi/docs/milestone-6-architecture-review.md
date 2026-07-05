# Milestone 6 — Architecture Review (Pre-Implementation)

**Status:** Review complete. No code written yet.
**Goal:** Determine the minimal set of changes required to deliver M6 (Purchase Creation + Entitlement Grant) by **reusing** the existing RobinOS subscription engine, not duplicating it.
**Principle applied:** Reuse first. Extend only when reuse is impossible. Never introduce a second subscription system.

---

## 0. Executive Summary

After auditing every existing subscription component in RobinOS, **M6 requires only three changes**:

1. **Replace two M53 stubs** with real implementations:
   - `record_purchase_from_webhook(p_webhook_event_id)`
   - `grant_entitlement_from_purchase(p_purchase_id)`
2. **Extend one existing RPC** with an optional parameter:
   - `safe_plan_switch(...)` gains `p_expires_at timestamptz default null`
3. **Extend `process_webhook_event`** (M5) with two new steps that call the RPCs above after a successful M5 user resolution.

**Zero new tables. Zero new statuses. Zero new plan-engine code.** All subscription state writes flow through `safe_plan_switch` (M31). All entitlement reads flow through `resolve_user_plan` (M34) and `plan_entitlements` (M29). All audit events flow through `log_subscription_event` (M31) → `subscription_audit_log` (M31).

The 6-month duration rule lives in `provider_products.duration_value` + `duration_unit` (M52). M6 reads from there; nothing hardcodes 6 months anywhere in M6 code.

---

## 1. Component-by-Component Audit

### 1.1 `public.payments`

**Currently** (M01 + M53 extension):

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK to auth.users |
| `subscription_id` | uuid | FK to user_subscriptions (nullable) |
| `provider` | payment_provider enum | 'warriorplus', 'manual', etc. |
| `provider_payment_id` | text | Provider's transaction ID (e.g. WP_SALE) |
| `amount`, `currency` | numeric, text | Payment amount |
| `status` | payment_status enum | completed / pending / refunded / etc. |
| `billing_cycle` | billing_cycle enum | monthly / yearly / one_time |
| `refunded_amount` | numeric | For refunds (M7) |
| `failure_reason` | text | For declined payments |
| `paid_at` | timestamptz | When payment succeeded |
| `metadata` | jsonb | Provider-agnostic extras |
| `buyer_email`, `buyer_email_hash` | text | Set by M5 worker (populated from raw_payload) |
| `buyer_name`, `buyer_country` | text | From provider payload |
| `plan_key` | text | Resolved plan (denormalized for search) |
| `source_webhook_event_id` | uuid | FK to webhook_events.id (M53) |
| `affiliate_user_id`, `referral_code`, `affiliate_commission_amount`, `affiliate_commission_status` | various | M10 (affiliate commissions) |
| `raw_provider_payload` | jsonb | Preserved forever |
| `created_at`, `updated_at` | timestamptz | Audit |

**Indexes** (M53): `idx_payments_buyer_hash`, `idx_payments_provider_event` on `(provider, provider_payment_id)`, `idx_payments_subscription`, `idx_payments_affiliate`, `idx_payments_status_date`, `idx_payments_plan_key`.

**Existing RPCs:**
- `search_payments(...)` (M53) — admin search; READ ONLY.
- `enqueue_webhook_event(...)` (M53/M54) — used by M3 receiver.
- `retry_webhook_event(...)`, `mark_webhook_dead_letter(...)` — M2 admin RPCs.
- `record_purchase_from_webhook(...)` (M53 STUB) — **M6 owner.**
- `grant_entitlement_from_purchase(...)` (M53 STUB) — **M6 owner.**

**How M6 uses it:**
- `record_purchase_from_webhook` will INSERT a row into `public.payments` with all 17 columns populated from the verified webhook + provider_products mapping.
- Idempotency: leverage existing `idx_payments_provider_event` UNIQUE-ish lookup → INSERT with ON CONFLICT DO NOTHING. Re-running on the same webhook returns the existing row's id.
- `source_webhook_event_id` set to `p_webhook_event_id`. This is the linking column M11 will use for admin diagnostics.
- `subscription_id` set to NULL at INSERT time. `grant_entitlement_from_purchase` will populate it after creating the user_subscriptions row.

**Can it be reused without modification?** **Yes — schema is complete.** The M53 stub signature `record_purchase_from_webhook(uuid) → jsonb` is correct; M6 replaces the body.

**Changes required:** None. M6 only adds the missing INSERT logic.

**Justification if we did NOT do this:** Without a payments row, there is no audit trail of money received; refunds (M7) cannot be linked; affiliate commissions (M10) cannot compute.

---

### 1.2 `public.user_subscriptions`

**Currently** (M01 + M17/M30/M31 evolution):

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | UNIQUE — one subscription per user |
| `plan` | text | 'free', 'creator', 'pro_creator', 'agency' |
| `status` | text | 'active', 'trialing', 'expiring', 'grace_period', 'expired', 'canceled', etc. |
| `amount`, `currency` | numeric, text | Last billed amount |
| `provider` | text | 'manual_admin', 'warriorplus', etc. |
| `provider_customer_id` | text | Stable provider customer ID |
| `provider_subscription_id` | text | For recurring subscriptions |
| `billing_cycle` | text | monthly / yearly / one_time |
| `current_period_start`, `current_period_end` | timestamptz | Stripe-style period bounds |
| `cancel_at_period_end` | boolean | For scheduled cancellations |
| `canceled_at` | timestamptz | When canceled |
| `trial_ends_at` | timestamptz | Trial period end |
| `starts_at`, `expires_at` | timestamptz | Lifecycle bounds (M17) |
| `last_plan_change_at`, `cooldown_until` | timestamptz | 14-day cooldown (M17) |
| `granted_by_admin`, `granted_reason` | boolean, text | Distinguishes admin grants from purchases |
| `grace_period_ends_at`, `reminder_dismissed_until` | timestamptz | M31 grace-period machinery |
| `next_billing_at`, `last_payment_at`, `auto_renew` | timestamptz, timestamptz, boolean | M31 renewal tracking |
| `subscription_source`, `is_revenue_eligible` | text, boolean | 'webhook' vs 'manual_admin'; revenue flag |
| `metadata` | jsonb | Provider-agnostic extras |
| `created_at`, `updated_at` | timestamptz | Audit |

**Triggers:**
- `trg_subscription_plan_change` (M17): auto-stamps `last_plan_change_at` + sets `cooldown_until = now + 14 days` whenever `plan` changes.
- `trg_subscription_on_insert` (M17): sets `starts_at`, `last_plan_change_at`, and initial `cooldown_until` on INSERT.

**Existing RPCs (full implementation, M31):**
- `safe_plan_switch(uuid, text, text, text, text, numeric, text)` — **THE canonical plan transition RPC.** Inserts/updates user_subscriptions, propagates to profiles, logs to subscription_audit_log. Hardcodes 30/365-day duration from billing_cycle (limitation M6 will extend).
- `resolve_user_plan(uuid)` — M34 latest version. Reads subscription + profile, validates `expires_at > now()`, returns effective plan + expiry_state + days_remaining.
- `get_subscription_lifecycle(uuid)` (M17) — Full lifecycle object for Settings page.
- `get_subscription_status(uuid)` (M31) — Subscription status with reminder logic.
- `check_plan_change_cooldown(uuid)` (M17) — Cooldown gate.
- `admin_grant_subscription(...)` (M17) — Admin-only grant with cooldown enforcement.
- `expire_subscriptions()` (M17) — Older; superseded by `process_subscription_expiry()`.
- `process_subscription_expiry()` (M31) — Hardened cron-safe expiry job with advisory lock.
- `dismiss_expiry_popup(uuid)` (M31) — Snooze reminder 24h.

**How M6 uses it:**
- `grant_entitlement_from_purchase` calls `safe_plan_switch(...)` with the resolved plan_key, billing_cycle, provider='warriorplus', provider_subscription_id (if recurring), and amount.
- `safe_plan_switch` writes the row and propagates to `profiles.subscription_tier` and `profiles.current_plan`.
- The 6-month duration is computed from `provider_products.duration_value` + `duration_unit` and passed as a new optional `p_expires_at` parameter to `safe_plan_switch` (the only RPC change in M6).
- After safe_plan_switch, M6's grant_entitlement_from_purchase UPDATEs `payments.subscription_id` to the user_subscriptions.id (linking the two rows).
- No direct UPDATEs to user_subscriptions from M6 — all writes go through safe_plan_switch.

**Can it be reused without modification?** **Yes, with one minor extension.** The user_subscriptions table is complete; all the lifecycle machinery (cooldown, grace period, expiry) is in place. The only issue: `safe_plan_switch` hardcodes 30/365-day duration from `billing_cycle`. M6 needs to honor `provider_products.duration_value + duration_unit` (e.g. 6 months).

**Changes required:** Add ONE optional parameter to `safe_plan_switch`:
```sql
p_expires_at timestamptz default null
```
When non-NULL, use it for `expires_at`, `current_period_end`, `next_billing_at` instead of computing from `billing_cycle`. When NULL, existing behavior preserved (backward compatible — all current callers pass NULL).

**Justification if we did NOT do this:**
- A 6-month Pro plan via WP would expire after 30 days (one_time billing_cycle) or 365 days (yearly billing_cycle) — wrong.
- We would have to either bypass `safe_plan_switch` (re-implement cooldown handling, audit logging, profile propagation) — **rebuild the engine** — or hardcode 6 months somewhere — **violate the M52 design contract** (duration lives in provider_products, not in code).

---

### 1.3 `public.profiles`

**Currently** (M01):

Subscription-relevant columns:

| Column | Type | Purpose |
|---|---|---|
| `subscription_tier` | text | Mirror of `user_subscriptions.plan` (fallback source) |
| `current_plan` | text | Denormalized for fast queries |
| `subscription_expires_at` | timestamptz | Mirror of `user_subscriptions.expires_at` |
| `free_trial_started_at`, `free_trial_expired` | timestamptz, boolean | Free trial window |
| `primary_payment_provider` | text | M53: tracks which provider the user came from |

**Existing update paths:**
- `initialize_user_account` (M34) — sets tier/plan='free' on signup.
- `admin_grant_subscription` (M17) — UPDATEs tier/plan/expires_at on admin grant.
- `safe_plan_switch` (M31) — UPDATEs tier/plan/expires_at on every plan transition.
- `expire_subscriptions` (M17) — UPDATEs tier/plan to 'free' on expiry.
- `process_subscription_expiry` (M31) — same, in the hardened job.

**How M6 uses it:**
- **No direct UPDATEs from M6.** All profile writes flow through `safe_plan_switch` (already covers it) or `process_subscription_expiry` (already covers expiry).
- M6 will SET `profiles.primary_payment_provider = 'warriorplus'` only if currently NULL (to preserve first-provider attribution). Done via a small UPDATE at the end of `grant_entitlement_from_purchase`:
  ```sql
  update public.profiles
     set primary_payment_provider = coalesce(primary_payment_provider, p_provider_id)
   where user_id = p_user_id;
  ```

**Can it be reused without modification?** **Yes — schema is complete.** M6 does not change profiles.

**Justification if we did NOT do this:** Same as 1.2 — duplicating profile-write logic in M6 would create two sources of truth (safe_plan_switch vs grant_entitlement_from_purchase) for tier/plan.

---

### 1.4 `public.plan_entitlements`

**Currently** (M04 + M29 re-seed):

Source-of-truth table for all plan → feature limit mappings. 12 features × 4 plans = 48 rows seeded in M29 (final spec).

**Existing RPCs that read it:**
- `get_user_entitlements(uuid)` (M29) — joins user plan → plan_entitlements, returns full feature map.
- `consume_usage(...)` (M29) — atomic gate+increment, uses plan_entitlements to decide allow/deny.
- `can_access_feature(uuid, text)` (M29) — boolean gate.
- `get_usage_summary(uuid)` (M29) — full usage map per user.
- `get_usage_status_v2(uuid, text)` (M29) — read-only status for one feature.

**How M6 uses it:**
- M6 does NOT modify plan_entitlements.
- M6 does NOT call consume_usage or any usage RPC (those are called by feature-generation edge functions, not by the purchase pipeline).
- After M6 grants the plan, all subsequent entitlement reads automatically pick up the new plan via `resolve_user_plan` → `plan_entitlements`.

**Can it be reused without modification?** **Yes — schema is complete, no M6 changes needed.**

**Justification if we did NOT do this:** plan_entitlements is the canonical entitlement source. Bypassing it would break every existing entitlement check across the app.

---

### 1.5 `public.safe_plan_switch` (M31)

**Currently:** Inserts/updates user_subscriptions, propagates to profiles, logs to subscription_audit_log. Hardcodes duration: 30 days for monthly, 365 days for yearly.

**Signature:**
```sql
safe_plan_switch(
  p_user_id           uuid,
  p_new_plan          text,
  p_billing_cycle     text    default 'monthly',
  p_provider          text    default null,
  p_provider_sub_id   text    default null,
  p_amount            numeric default 0,
  p_triggered_by      text    default 'webhook'
) returns jsonb
```

**What it does (already correct):**
- Normalizes plan key (legacy names → canonical).
- Validates plan is in (free, creator, pro_creator, agency).
- UPSERT user_subscriptions with all lifecycle columns.
- UPDATEs profiles (subscription_tier, current_plan, subscription_expires_at).
- Calls log_subscription_event → writes subscription_audit_log row.
- Clears grace_period_ends_at and reminder_dismissed_until on renewal.

**How M6 uses it:** Called from `grant_entitlement_from_purchase` with provider='warriorplus' and the resolved plan_key + billing_cycle + amount.

**Can it be reused without modification?** **No — needs ONE parameter.** The hardcoded 30/365 duration is wrong for provider_products.duration_value=6 (months). M6 must honor provider-supplied duration.

**Changes required:** Add optional `p_expires_at timestamptz default null` parameter. When non-NULL, use it for `expires_at`, `current_period_end`, `next_billing_at`. When NULL, keep existing behavior.

**Diff size:** ~6 lines (one variable declaration + 3 conditional `coalesce` calls in the UPSERT + comment).

**Justification if we did NOT do this:**
- Option A: Bypass safe_plan_switch entirely → duplicate the UPSERT + profile propagation + audit log logic in M6 → two engines → eventual divergence.
- Option B: Hardcode 6 months in safe_plan_switch → violates M52 design ("duration lives in provider_products").
- Option C: Create a new RPC `safe_plan_switch_with_duration` → ~50 lines of duplicated logic → eventual divergence.
- Option D (chosen): One optional parameter. Smallest possible extension. Zero risk to existing callers (default NULL = existing behavior).

---

### 1.6 `public.subscription_audit_log`

**Currently** (M31):

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | Who |
| `event_type` | text | 'plan_switch', 'grace_activated', 'auto_downgrade', etc. |
| `old_plan`, `new_plan` | text | Plan transition |
| `old_status`, `new_status` | text | Status transition |
| `triggered_by` | text | 'system' / 'webhook' / 'admin' / 'user' |
| `metadata` | jsonb | Extras (expires_at, billing_cycle, etc.) |
| `created_at` | timestamptz | When |

**Existing writes:**
- `safe_plan_switch` → 'plan_switch' event
- `process_subscription_expiry` → 'grace_activated', 'auto_downgrade' events
- `log_subscription_event` (M31) — the writer; never raises (silently catches exceptions).

**How M6 uses it:**
- **M6 does NOT write directly.** All audit events flow through `safe_plan_switch` (which already calls `log_subscription_event` for plan transitions) and through `process_subscription_expiry` (already handles expiry).
- M6 may add ONE new event type to make purchase-driven grants distinguishable from manual grants: e.g. `'plan_switch'` with `metadata.triggered_by='warriorplus_webhook'` and `metadata.purchase_id=<uuid>`. This requires ZERO schema changes — only metadata enrichment in the safe_plan_switch call.

**Can it be reused without modification?** **Yes — schema is complete.**

**Justification if we did NOT do this:** The audit log is the immutable source of truth for subscription history. Bypassing it would break admin forensics, customer support, and dispute resolution.

---

### 1.7 `public.feature_usage` / `public.feature_usage_events` / `public.usage_tracking`

**Currently:**

| Table | Source | Purpose |
|---|---|---|
| `feature_usage` | M01 | Original counter table (superseded) |
| `feature_usage_events` | M01 + M29 | Append-only event log with idempotency_key |
| `usage_tracking` | M04 | Per-user/feature/period counter (the live one used by M29) |

**Existing writers (M29):**
- `consume_usage(...)` — atomic increment of usage_tracking + insert feature_usage_events (if idempotency_key).
- `check_and_increment_usage(...)` — alias for consume_usage.

**Existing readers (M29):**
- `get_user_entitlements`, `get_usage_summary`, `get_usage_status_v2`, `get_usage_status`, `can_access_feature`.

**How M6 uses it:**
- **M6 does NOT write to any usage table.** M6 only changes the user's plan; subsequent feature-generation calls will trigger `consume_usage` and increment the appropriate counters.
- M6 does NOT read usage either (irrelevant to grant decision).

**Can it be reused without modification?** **Yes — no M6 changes.**

**Justification if we did NOT do this:** Same as plan_entitlements — usage is the canonical consumption ledger. M6 is upstream of it.

---

### 1.8 Expiry Processing (`expire_subscriptions` vs `process_subscription_expiry`)

**Currently:**

Two functions exist; the M31 hardened version supersedes M17's:

| Function | Migration | State Machine |
|---|---|---|
| `expire_subscriptions()` | M17 | active/trialing → expired (single step) |
| `process_subscription_expiry()` | M31 | active → expiring (≤7d) → grace_period (≤3d grace) → expired → profile=free |

**State machine (M31):**

```
active → expiring (≤7 days remaining)
       → grace_period (just past expires_at, 3-day grace)
       → expired (grace ended, profile reverted to free)
```

**Key properties:**
- Advisory-locked (`pg_try_advisory_xact_lock(hashtext('process_subscription_expiry'))`) → safe to invoke from multiple cron workers concurrently.
- Idempotent: re-running produces no double-transitions.
- Logs every transition to `subscription_audit_log`.

**Cron registration:** **There is NO `pg_cron` entry for `process_subscription_expiry` in any migration.** Looking at M17's comment: *"Call this via pg_cron scheduled job (if available), Supabase edge function cron (call once per hour), or On every entitlement check (belt + suspenders)."* The existing M17 stale comment about "passively calls expire_subscriptions" was REMOVED in M31 — M31's `get_user_entitlements` does NOT call `process_subscription_expiry`. Expiry is purely cron-driven.

**How M6 uses it:**
- **M6 does NOT invoke expiry directly.** After M6 grants a subscription with `expires_at = now + 6 months`, the row sits at `status='active'`. When `now >= expires_at`, the cron job transitions through the state machine.
- M6's runbook will register the `process_subscription_expiry` cron (since the codebase has never had one registered — this is a pre-existing operational gap).

**Can it be reused without modification?** **Yes — function is complete.** Only the cron registration is missing.

**Justification if we did NOT do this:** Building a second expiry engine in M6 would be the most expensive duplication in the entire codebase. M31's machinery (state machine, grace period, audit logging, advisory lock) is battle-tested.

---

### 1.9 Existing Subscription Cron Jobs

**Audit result:**

| Cron Job | Source | Status |
|---|---|---|
| `webhook-worker-5min` | M4 runbook (manually registered) | Active. Drains webhook_events queue. |
| `trend_refresh_cron` | M26 | Active. Refreshes trend signals. |
| `approve-commissions` | M38 (commented out in code) | Not registered. M10 will register it. |
| `process_subscription_expiry` | **NEVER REGISTERED** | **M6 runbook will register this (hourly cadence).** |

The expiry cron registration is a pre-existing operational gap that the M6 rollout will close.

---

## 2. Complete Lifecycle Mapping

Trace a WarriorPlus purchase from IPN receipt to 6-month expiry, listing every component touched:

```
1. WarriorPlus sends IPN
   │
   ▼
2. payment-webhook Edge Function (M3, supabase/functions/payment-webhook/)
   - Verifies signature
   - Calls enqueue_webhook_event() → INSERT INTO webhook_events (status='received')
   - Returns 200 to WP
   │
   ▼
3. process-webhook-worker Edge Function (M4, cron-driven every 5 min)
   - Loop: process_webhook_event() RPC
   │
   ▼
4. process_webhook_event(p_webhook_event_id) RPC (M4+M5)
   - Claim row, lock, status='processing'
   - Validate payload (SHA-256) + provider enabled
   - ★ M5: resolve_or_create_user_from_purchase()
     - existing user → status='verified', linked_user_id set
     - guest → status='awaiting_claim' (M5 stops here)
   │
   ▼ (only if status='verified' AND linked_user_id IS NOT NULL)
5. ★ M6 NEW: record_purchase_from_webhook(p_webhook_event_id)
   - Resolve provider_products via (provider_id, provider_product_id, provider_offer_id)
   - Compute billing_cycle from provider_products
   - INSERT INTO public.payments (status='completed', source_webhook_event_id, plan_key, buyer_email_hash, etc.)
   - Idempotent: UNIQUE(provider, provider_payment_id) → ON CONFLICT DO NOTHING
   - Returns { success, purchase_id, plan_key, billing_cycle }
   │
   ▼
6. ★ M6 NEW: grant_entitlement_from_purchase(p_purchase_id)
   - Read provider_products.duration_value + duration_unit
   - Compute expires_at = now() + (duration_value || ' ' || duration_unit)
   - For 6-month Pro: expires_at = now() + interval '6 months'
   - Call safe_plan_switch(user_id, plan_key, billing_cycle, 'warriorplus', provider_sub_id, amount, 'webhook',
                           p_expires_at := expires_at)  ← NEW param
   - UPDATE payments SET subscription_id = (SELECT id FROM user_subscriptions WHERE user_id=...)
   - UPDATE profiles SET primary_payment_provider = 'warriorplus' WHERE NULL
   - Returns { success, user_id, plan, expires_at }
   │
   ▼
7. process_webhook_event (M6 extension to M5 body):
   - UPDATE webhook_events SET status='processed', processed_at=now(), linked_purchase_id=<id>
   - Release lock
   - Returns { action: 'processed', purchase_id, plan, expires_at }
   │
   ▼ (CRON-DRIVEN, every hour)
8. process_subscription_expiry() RPC (M31, NEW cron registration in M6 runbook)
   - Find active rows where expires_at <= now()
   - Transition: active → grace_period (3-day grace)
   - Later: grace_period → expired → profiles.subscription_tier='free'
   - All transitions logged to subscription_audit_log
   │
   ▼
9. (After 6 months) Buyer is back on 'free' plan; can purchase again.
```

**For the guest path (M5 `awaiting_claim`):**
- Steps 1-4 still happen.
- M5 stops at `status='awaiting_claim'`.
- Steps 5-9 deferred to M9 (claim flow). When the guest claims via M9, M9 invokes M6's RPCs with the verified claim token.

---

## 3. Final M6 Architecture (Approved)

### 3.1 Changes Required

| # | Change | Type | Risk |
|---|---|---|---|
| 1 | `record_purchase_from_webhook` body replaced | `CREATE OR REPLACE FUNCTION` | Low — replaces M53 stub. Idempotent via existing UNIQUE index. |
| 2 | `grant_entitlement_from_purchase` body replaced | `CREATE OR REPLACE FUNCTION` | Low — replaces M53 stub. Calls safe_plan_switch (already hardened). |
| 3 | `safe_plan_switch` gains `p_expires_at timestamptz default null` | `CREATE OR REPLACE FUNCTION` | Very low — additive optional parameter. All existing callers unaffected (NULL = existing behavior). |
| 4 | `process_webhook_event` extended with M6 step (steps 5-7 above) | `CREATE OR REPLACE FUNCTION` | Low — additive branch after M5 resolution. Reuses M4's failure-classification logic. |
| 5 | Cron registration for `process_subscription_expiry` | Operational (runbook only) | None — pre-existing operational gap. |

### 3.2 Schema Changes

**Zero new tables. Zero new columns. Zero new statuses. Zero new enums.**

The entire M6 footprint is one migration file replacing 4 RPC bodies + extending 1 RPC signature.

### 3.3 The One Extension: `safe_plan_switch`

```sql
create or replace function public.safe_plan_switch(
  p_user_id           uuid,
  p_new_plan          text,
  p_billing_cycle     text     default 'monthly',
  p_provider          text     default null,
  p_provider_sub_id   text     default null,
  p_amount            numeric  default 0,
  p_triggered_by      text     default 'webhook',
  p_expires_at        timestamptz default null   -- NEW
) returns jsonb ...
```

**Behavior when `p_expires_at` IS NOT NULL:**
- `expires_at = p_expires_at`
- `current_period_end = p_expires_at`
- `next_billing_at = p_expires_at` (for one-time purchases, this is informational)

**Behavior when `p_expires_at` IS NULL (default):**
- Existing 30/365-day calculation from `billing_cycle` (preserved verbatim).

**Why this is the right extension:**
- 1 parameter. 6 lines of diff (1 variable + 3 conditional coalesces + comment).
- Zero risk: every existing caller passes NULL (default), gets identical behavior.
- Unlocks M6's 6-month duration rule (read from provider_products).
- Unlocks any future provider with arbitrary durations (e.g. 1-year, 90-day trials).

### 3.4 New RPC Contracts

#### `record_purchase_from_webhook(p_webhook_event_id uuid) returns jsonb`

| Input | Treatment |
|---|---|
| `p_webhook_event_id` | Must exist in webhook_events; must have status='verified'; must have linked_user_id IS NOT NULL. |

| Output (jsonb) | |
|---|---|
| Existing user happy path | `{"success": true, "purchase_id": "<uuid>", "is_new_purchase": true, "plan_key": "pro_creator", "billing_cycle": "one_time", "amount": 39.00}` |
| Duplicate (already recorded) | `{"success": true, "purchase_id": "<existing-uuid>", "is_new_purchase": false, ...}` |
| Product mapping missing | `{"success": false, "code": "PRODUCT_MAPPING_NOT_FOUND", "provider_product_id": "..."}` (terminal — caller dead-letters) |
| Product disabled | `{"success": false, "code": "PRODUCT_DISABLED", "provider_product_id": "..."}` (terminal) |

**Side effects:**
- INSERT INTO public.payments (idempotent via `idx_payments_provider_event`)
- Sets `webhook_events.linked_purchase_id`

#### `grant_entitlement_from_purchase(p_purchase_id uuid) returns jsonb`

| Input | Treatment |
|---|---|
| `p_purchase_id` | Must exist in public.payments; must have user_id, plan_key, amount, source_webhook_event_id populated. |

| Output (jsonb) | |
|---|---|
| Happy path | `{"success": true, "user_id": "<uuid>", "plan": "pro_creator", "expires_at": "<timestamptz>", "subscription_id": "<uuid>", "duration_days": 180}` |
| Purchase not found | `{"success": false, "code": "PURCHASE_NOT_FOUND"}` |
| User not resolved | `{"success": false, "code": "USER_NOT_RESOLVED"}` (defensive — should not happen if M5 ran) |
| Already granted (idempotent no-op) | `{"success": true, "already_granted": true, "subscription_id": "<uuid>"}` |

**Side effects (all via safe_plan_switch — atomic):**
- user_subscriptions UPSERT (plan, status, expires_at, etc.)
- profiles subscription_tier, current_plan, subscription_expires_at
- subscription_audit_log entry (plan_switch event with triggered_by='warriorplus_webhook', metadata.purchase_id)
- payments.subscription_id updated to user_subscriptions.id
- profiles.primary_payment_provider = 'warriorplus' if NULL

### 3.5 Worker Integration

`process_webhook_event` (M5) gains an M6 step between M5's resolution (step 4 above) and the final status transition:

```
  ...
  Step 4 (M5): resolve user identity
    - resolved_existing_user → status='verified', linked_user_id set
    - marked_guest_awaiting_claim → status='awaiting_claim'
    - resolution_failed → dead-letter

  Step 5 (M6 NEW): only if status='verified'
    a. record_purchase_from_webhook(p_webhook_event_id)
       - on success → linked_purchase_id set
       - on PRODUCT_MAPPING_NOT_FOUND / PRODUCT_DISABLED → dead-letter (M6-specific classification)
       - on transient error → schedule_webhook_retry
    b. grant_entitlement_from_purchase(p_purchase_id)
       - on success → continue
       - on transient error → schedule_webhook_retry
       - on USER_NOT_RESOLVED → dead-letter (defensive)

  Step 6 (M6 NEW): transition
    - on success → status='processed', processed_at=now()
    - return { action: 'processed', purchase_id, plan, expires_at }
```

**New action value returned to worker:** `'processed'` (already in the M52 enum). The worker's existing `WORKER_ROW_VERIFIED` branch will NOT match — M6 adds a `WORKER_ROW_PROCESSED` branch and a `processed_count` counter. (Mirrors the M5 pattern of adding a new branch for each milestone.)

### 3.6 Idempotency

| Concern | Defense |
|---|---|
| Re-running `record_purchase_from_webhook` on same webhook | UNIQUE INDEX `(provider, provider_payment_id)` on payments → ON CONFLICT DO NOTHING → returns existing `purchase_id` |
| Re-running `grant_entitlement_from_purchase` on same purchase | `safe_plan_switch` uses `on conflict (user_id) do update` → idempotent |
| Re-running the whole worker on a processed row | Row is at `status='processed'`; not claimable; worker returns null |
| Two concurrent workers on the same row | M4's `FOR UPDATE SKIP LOCKED` prevents double-claim |
| Provider replay (same IPN_ID) | M3's `enqueue_webhook_event` rejects duplicates |
| Refund/replay after purchase | M7 (future) uses `payments.id` to find the linked `user_subscriptions.id` and calls `safe_plan_switch('free')` or admin_grant_subscription |

### 3.7 Failure Handling

| Failure | Classification | Path |
|---|---|---|
| `provider_product_id` not in `provider_products` | M6: `product_mapping_missing` | Terminal: `mark_webhook_dead_letter` |
| `provider_products.is_enabled = false` | M6: `product_disabled` | Terminal: `mark_webhook_dead_letter` |
| `provider_products.duration_value` missing/zero | M6: `invalid_duration` | Terminal: `mark_webhook_dead_letter` |
| DB error during INSERT into payments | Transient: `unexpected` | `schedule_webhook_retry` |
| DB error during safe_plan_switch | Transient: `unexpected` | `schedule_webhook_retry` |
| `safe_plan_switch` returns INVALID_PLAN | M6: `invalid_plan` | Terminal: `mark_webhook_dead_letter` |
| User's subscription has `cooldown_until > now()` and safe_plan_switch rejects | M6: `cooldown_active` | Terminal: `mark_webhook_dead_letter` (admin must investigate; webhook signature was valid so cooldown violation is suspicious) |

### 3.8 Security

| Threat | Defense |
|---|---|
| Attacker forges a webhook to grant themselves Pro | M3 signature verification + M4 payload hash + M6 record_purchase runs in service_role + safe_plan_switch runs in security definer |
| Attacker manipulates `provider_product_id` to map to Agency | `provider_products.is_enabled = false` is checked; admin must explicitly enable each product |
| Account hijacking via M6's purchase row creation | M6 only acts on rows with `status='verified' AND linked_user_id IS NOT NULL` — both gates are M5 outcomes, which are read-only on auth.users |
| Audit tampering | All writes to user_subscriptions go through safe_plan_switch → log_subscription_event → subscription_audit_log (immutable) |

### 3.9 Observability

- `select count(*), status, resolution_outcome from webhook_events where linked_purchase_id is not null group by 1, 2, 3;`
- `select count(*) from payments where status='completed' and created_at > now() - interval '1 day';`
- `select count(*) from user_subscriptions where granted_by_admin = false and created_at > now() - interval '1 day';`
- `select * from subscription_audit_log where event_type='plan_switch' and triggered_by='warriorplus_webhook' order by created_at desc limit 50;`
- `select count(*) from user_subscriptions where expires_at < now() + interval '7 days' and status='active';` (expiring soon)

---

## 4. What M6 Does NOT Do (Out of Scope)

- No subscription renewal logic (M9/M11+)
- No subscription cancellation (post-M6)
- No plan downgrade via webhook (M7/M8)
- No refund handling (M7)
- No affiliate commission (M10)
- No email sending (M9)
- No UI changes
- No plan_entitlements changes
- No usage_tracking writes

---

## 5. Open Decisions Deferred

These were considered and explicitly deferred:

| Decision | Owner | Why deferred |
|---|---|---|
| Should WP subscr_* events trigger renewal-grants? | M6+ (post-launch) | M6 spec scope is "purchase creation". Renewals need to be designed separately to avoid confusion with initial grants. |
| Should `safe_plan_switch` skip cooldown for webhook-triggered renewals? | Future fix to safe_plan_switch or trg_subscription_plan_change | Out of M6 scope; current behavior (cooldown applies) is acceptable for initial grants. |
| Should `process_subscription_expiry` be invoked from `get_user_entitlements` passively? | M6+ (post-launch) | M31 explicitly removed this. Belt-and-suspenders was deemed overkill. Cron-only is sufficient. |

---

## 6. Cron Registration Plan (Operational, No Code)

M6's rollout runbook will register:

```sql
select cron.schedule(
  'process-subscription-expiry-hourly',
  '0 * * * *',  -- every hour
  $$ select public.process_subscription_expiry(); $$
);
```

This closes the pre-existing operational gap. No new SQL or TS code; only a `pg_cron` registration via Supabase dashboard or a one-shot SQL command.

---

## 7. Deliverables Checklist (M6 Implementation)

- [ ] Migration 58: replace M53 stubs for `record_purchase_from_webhook`, `grant_entitlement_from_purchase`; extend `safe_plan_switch` with optional `p_expires_at`; extend `process_webhook_event` with M6 step.
- [ ] TS worker edit: add `WORKER_ROW_PROCESSED` branch and `processed_count` counter (mirrors the M5 awaiting_claim pattern).
- [ ] Vitest tests for the worker integration contract.
- [ ] SQL integration tests file.
- [ ] Rollback section appended to migration 58.
- [ ] Rollout runbook including the `process_subscription_expiry` cron registration.
- [ ] Testing checklist including operator scenarios.

---

## 8. Review Sign-Off

**Reuse-first audit complete.** M6 introduces:

| | Count |
|---|---|
| New tables | 0 |
| New columns | 0 |
| New enums / status values | 0 |
| New RPCs | 0 |
| Replaced RPCs (M53 stubs) | 2 |
| Extended RPCs | 1 (`safe_plan_switch` — 1 new optional parameter) |
| Extended RPCs (workflow addition) | 1 (`process_webhook_event` — adds M6 step) |

**The entire M6 schema footprint fits in one migration file.**

**Awaiting approval to proceed with implementation.**
