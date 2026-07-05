# RobinOS — WarriorPlus Staging Validation Plan

**Version:** 1.0  
**Date:** 2026-07-05  
**Scope:** Validate the entire WarriorPlus production flow in staging before enabling live sales or implementing refunds (Milestone 7).  
**Target Project:** `iitfxyasjizlbneevwsa`  
**Target Provider:** `warriorplus`  
**Webhook Endpoint:** `POST https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/payment-webhook/warriorplus`

---

## 1. Environment Preparation Checklist

| # | Task | Verification Command / Location | Owner | Done |
|---|------|--------------------------------|-------|------|
| 1.1 | Confirm staging Supabase project is isolated from production and contains no live customer data. | Dashboard → Project Settings → General | Infra | ☐ |
| 1.2 | Confirm `supabase` CLI is authenticated to the staging project. | `supabase status` | Infra | ☐ |
| 1.3 | Confirm staging database is on a plan that supports Edge Functions, pg_cron, and pgcrypto. | `select version();` + Extensions list | Infra | ☐ |
| 1.4 | Verify `pgcrypto` extension is enabled (used for SHA-256 hashing). | `select * from pg_extension where extname = 'pgcrypto';` | Infra | ☐ |
| 1.5 | Confirm staging Auth is configured and at least one admin test account exists with `super_admin` or `admin` role. | `select public.get_admin_role('<uid>');` | QA | ☐ |
| 1.6 | Confirm existing Dodo/Whop webhooks and subscriptions are unaffected by the WarriorPlus rollout. | Regression smoke tests for `/functions/v1/dodo-webhook` and `/functions/v1/whop-webhook` | QA | ☐ |
| 1.7 | Set staging `platform_settings.payment_provider_default` to `'warriorplus'` **only during this test**; revert afterward if another provider is preferred. | `select * from public.platform_settings;` | QA | ☐ |
| 1.8 | Confirm log drains / Logflare / Supabase Logs Explorer are accessible for `payment-webhook` and `process-webhook-worker`. | Supabase Logs → Edge Functions | QA | ☐ |

**Notes:**
- Do **not** run this plan against the production project.
- The staging project must have a distinct `payment_providers` row for `warriorplus` with `is_test_mode = true` until promotion.

---

## 2. Database Migration Order

Apply migrations sequentially. Each migration is additive and backward-compatible with existing data, but order matters because of foreign-key dependencies.

| Order | Migration File | Purpose | Verify |
|-------|----------------|---------|--------|
| 1 | `50_warriorplus_settings.sql` | Adds `warriorplus_page_enabled` and `warriorplus_demo_video_url` to `platform_settings`. | `\d public.platform_settings` |
| 2 | `51_payment_providers.sql` | Creates `payment_providers`, `payment_provider_secrets`, seed row for `warriorplus` (disabled). | `select * from public.payment_providers where id = 'warriorplus';` |
| 3 | `52_provider_products_and_webhook_events.sql` | Creates `provider_products` and `webhook_events` tables. | `\d public.provider_products` `\d public.webhook_events` |
| 4 | `53_payments_extension_and_rpcs.sql` | Extends `payments`, `affiliate_commissions`, `platform_settings`, `profiles`; adds enum values and 15 RPCs (6 implemented, 9 stubs). | `\d public.payments` `select proname from pg_proc where proname like 'enqueue_webhook_event%';` |
| 5 | `55_admin_payment_provider_rpcs.sql` | Admin RPCs for provider/product CRUD and toggling. | `select proname from pg_proc where proname like 'admin_%_provider%';` |
| 6 | `56_webhook_worker_rpcs.sql` | Replaces stubs with `process_webhook_event`, `process_pending_webhook_events`, `schedule_webhook_retry`, plus retry helper. | `select proname from pg_proc where proname in ('process_webhook_event','process_pending_webhook_events','schedule_webhook_retry','get_webhook_queue_stats');` |
| 7 | `58_purchase_and_entitlement.sql` | Replaces stubs with purchase recording, entitlement grant, extends `safe_plan_switch` with `p_expires_at`. | `select proname from pg_proc where proname in ('record_purchase_from_webhook','grant_entitlement_from_purchase','resolve_or_create_user_from_purchase','recalculate_user_effective_plan');` |

**Post-migration sanity SQL:**

```sql
select
  (select count(*) from public.payment_providers where id = 'warriorplus') as provider_row,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'webhook_events') as webhook_events_exists,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'provider_products') as provider_products_exists,
  (select count(*) from pg_enum e join pg_type t on e.enumtypid = t.oid where t.typname = 'payment_provider' and e.enumlabel = 'warriorplus') as enum_value_exists;
```

Expected: `provider_row = 1`, both tables exist, enum value exists.

---

## 3. Edge Function Deployment Order

Deploy in this order. Each function depends on RPCs that must already be installed.

| Order | Function | `verify_jwt` | Why This Order |
|-------|----------|--------------|----------------|
| 1 | `admin-payment-providers` | `false` | Configure provider + products + secrets before receiving webhooks. |
| 2 | `payment-webhook` | `false` | Ingests webhooks; depends on `payment_providers` row and `enqueue_webhook_event` RPC. |
| 3 | `process-webhook-worker` | `false` | Processes queued events; depends on M56 RPCs and M58 purchase/entitlement RPCs. |

**Deployment commands:**

```bash
supabase functions deploy admin-payment-providers
supabase functions deploy payment-webhook
supabase functions deploy process-webhook-worker
```

**Verify deployment:**

```bash
# Each should return a 401/403/405 (not 404) confirming the function is live.
curl -i -X POST https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/payment-webhook/warriorplus
curl -i -X POST https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=health
curl -i -X POST https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/admin-payment-providers
```

**Post-deploy verification in Supabase Dashboard:**
- Edge Functions → All three functions listed as `Enabled`.
- `supabase/config.toml` contains:
  ```toml
  [functions.payment-webhook]
  verify_jwt = false

  [functions.process-webhook-worker]
  verify_jwt = false
  ```

---

## 4. Secret Provisioning Checklist

Secrets are split into two categories:
- **Supabase Edge Function Secrets** (env vars available inside Deno functions).
- **Database-stored secrets** (admin-managed, encrypted at rest in `payment_provider_secrets`).

### 4.1 Edge Function Secrets (via `supabase secrets set`)

| Secret Name | Required By | How to Verify | Value Source |
|-------------|-------------|---------------|--------------|
| `SUPABASE_URL` | `payment-webhook`, `process-webhook-worker`, `admin-payment-providers` | `supabase secrets list` | Staging project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `payment-webhook`, `process-webhook-worker`, `admin-payment-providers` | `supabase secrets list` | Staging service role key |
| `ENCRYPTION_KEY` (or project-specific name) | `payment-webhook` decryption of `payment_provider_secrets.secret_value_encrypted` | Confirm in `../_shared/crypto.ts` | Staging-only 32-byte key |

**Set commands:**

```bash
supabase secrets set --env-file ./supabase/.env.staging
# or individually:
supabase secrets set SUPABASE_URL="https://iitfxyasjizlbneevwsa.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>"
supabase secrets set ENCRYPTION_KEY="<staging-encryption-key>"
```

### 4.2 Database-Stored Secret

| Field | Value | How to Set |
|-------|-------|------------|
| `provider_id` | `warriorplus` | Hard-coded |
| `secret_name` | `ipn_security_key` | Hard-coded in `WarriorPlusAdapter.signatureSecretName()` |
| `secret_value_encrypted` | AES-256-GCM ciphertext of the WP IPN shared secret | Use admin UI or a bootstrap SQL script that encrypts with the Edge Function key |

**Verify row exists:**

```sql
select provider_id, secret_name, is_active, created_at
from public.payment_provider_secrets
where provider_id = 'warriorplus' and secret_name = 'ipn_security_key' and is_active = true;
```

### 4.3 WarriorPlus Account Secret

| Item | Value | Source |
|------|-------|--------|
| WP Vendor Security Key (IPN secret) | Raw shared secret string | WarriorPlus seller account → My Account → IPN Settings |
| Sandbox/Test Secret (recommended for staging) | Separate from live secret | WarriorPlus test/sandbox environment |

**Critical:** The value stored in `payment_provider_secrets` must match the secret WarriorPlus sends in the `WP_SECURITYKEY` POST field.

---

## 5. Cron Registration Checklist

The worker must be invoked on a schedule. In Supabase, this is typically done via `pg_cron` (database cron) or an external scheduler calling the Edge Function URL.

| # | Task | Verification |
|---|------|--------------|
| 5.1 | Confirm `pg_cron` extension is enabled. | `select * from pg_extension where extname = 'pg_cron';` |
| 5.2 | Create a cron job that calls `process-webhook-worker` every minute (or desired interval). | `select * from cron.job;` |
| 5.3 | Ensure the cron invocation uses `service_role` and the correct Edge Function URL. | Review `cron.job` command column. |
| 5.4 | Confirm the cron runs and produces `WORKER_START` / `WORKER_DONE` logs. | Supabase Logs → Edge Functions → `process-webhook-worker` |
| 5.5 | Optionally register a second cron that calls `process_subscription_expiry` to enforce 6-month expiration. | `select * from cron.job where command ilike '%process_subscription_expiry%';` |

**Example cron SQL:**

```sql
select cron.schedule(
  'process-webhook-worker-every-minute',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=process',
       headers := '{"Authorization": "Bearer <staging-service-role-key>", "Content-Type": "application/json"}'::jsonb
     ); $$
);
```

**Alternative:** Use a Supabase Database Webhook or an external cron service (e.g., GitHub Actions, Vercel Cron) if `pg_cron` is unavailable.

---

## 6. WarriorPlus Configuration Checklist

Complete these steps in the WarriorPlus seller dashboard **and** the RobinOS admin UI.

### 6.1 WarriorPlus Seller Dashboard

| # | Task | Expected Setting |
|---|------|------------------|
| 6.1.1 | Log in to WarriorPlus seller account. | Access to IPN settings. |
| 6.1.2 | Navigate to IPN / Notification URL settings. | Location varies; typically under **My Account → IPN**. |
| 6.1.3 | Set the IPN URL to the staging webhook endpoint. | `https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/payment-webhook/warriorplus` |
| 6.1.4 | Set the IPN security key to a strong, unique value. | Minimum 32 random characters; note this value. |
| 6.1.5 | Enable IPN for the test product(s). | Checkbox enabled. |
| 6.1.6 | Confirm WarriorPlus sends `application/x-www-form-urlencoded` POSTs. | Default for WarriorPlus IPN. |
| 6.1.7 | For sandbox testing, confirm the sandbox IPN URL and secret are configured separately from production. | Avoid using live secret in staging. |

### 6.2 RobinOS Admin UI / Admin Edge Function

| # | Task | Verification |
|---|------|--------------|
| 6.2.1 | Update the `warriorplus` provider row with the staging webhook URL. | `admin_upsert_provider(p_id := 'warriorplus', p_webhook_url := 'https://...')` |
| 6.2.2 | Keep `is_test_mode = true` in staging. | `select is_test_mode from public.payment_providers where id = 'warriorplus';` → `true` |
| 6.2.3 | Keep `require_signature_verification = true`. | `select require_signature_verification from public.payment_providers where id = 'warriorplus';` → `true` |
| 6.2.4 | Leave `allowed_ip_ranges` as `NULL` unless WarriorPlus publishes stable egress IPs. | `select allowed_ip_ranges from public.payment_providers where id = 'warriorplus';` → `NULL` or documented CIDRs |
| 6.2.5 | Store the WP IPN security key in `payment_provider_secrets` under `secret_name = 'ipn_security_key'`. | Row exists with `is_active = true`. |
| 6.2.6 | **Do not enable the provider yet.** `is_enabled` must remain `false` until Section 8. | `select is_enabled from public.payment_providers where id = 'warriorplus';` → `false` |

---

## 7. Test Product Configuration

Create at least one test product mapping before sending webhooks.

### 7.1 Required Product Mapping Fields

| Field | Example Value | Notes |
|-------|---------------|-------|
| `provider_id` | `warriorplus` | — |
| `provider_product_id` | `wp_test_item_001` | Matches `WP_ITEM_NUMBER` in the IPN. |
| `provider_offer_id` | `NULL` or `wp_test_offer_001` | Matches `WP_OFFER_ID` if used. |
| `plan_key` | `pro_creator` | One of `free`, `creator`, `pro_creator`, `agency`. |
| `billing_cycle` | `one_time` | For a 6-month license, use `one_time`. |
| `duration_value` | `6` | Numeric quantity. |
| `duration_unit` | `month` | One of `day`, `week`, `month`, `year`. |
| `amount` | `39.00` | Price in major units. |
| `currency` | `USD` | 3-letter ISO code. |
| `is_subscription` | `false` | `true` only for recurring billing. |
| `is_enabled` | `true` | Must be enabled to be matched. |

### 7.2 Create via Admin RPC

```sql
select public.admin_upsert_provider_product(
  p_provider_id         := 'warriorplus',
  p_provider_product_id := 'wp_test_item_001',
  p_provider_offer_id   := null,
  p_plan_key            := 'pro_creator',
  p_billing_cycle       := 'one_time',
  p_duration_value      := 6,
  p_duration_unit       := 'month',
  p_amount              := 39.00,
  p_currency            := 'USD',
  p_is_subscription     := false,
  p_is_enabled          := true,
  p_display_name        := 'RobinOS Pro — Staging Test',
  p_description         := '6-month Pro Creator access for staging validation.'
);
```

### 7.3 Verify Mapping

```sql
select * from public.provider_products
where provider_id = 'warriorplus' and provider_product_id = 'wp_test_item_001';
```

Expected: exactly one row, `is_enabled = true`, `plan_key = 'pro_creator'`, `duration_value = 6`, `duration_unit = 'month'`.

---

## 8. End-to-End Validation Steps

Perform these steps in order. Each step builds on the previous one.

### Step 0 — Pre-Flight

1. Confirm `payment_providers.is_enabled = false` for `warriorplus`.
2. Confirm product mapping exists and is enabled.
3. Confirm secrets are provisioned.
4. Confirm Edge Functions are deployed and healthy.
5. Confirm cron is registered.

### Step 1 — Send a Valid Simulated Sale

Use the provided test script or a manual `curl`:

```bash
SUPABASE_URL="https://iitfxyasjizlbneevwsa.supabase.co" \
WP_SHARED_SECRET="<staging-secret>" \
node scripts/test-webhook-warriorplus.cjs valid
```

**Expected result:** HTTP 200, `received: true`, `id` present, no `duplicate` flag.

### Step 2 — Verify Webhook Event Row

```sql
select id, status, provider_event_id, standardized_event_type, trace_id
from public.webhook_events
order by received_at desc
limit 1;
```

Expected: `status = 'received'` immediately after Step 1.

### Step 3 — Trigger Worker Processing

Wait for the cron to fire, or invoke manually:

```bash
curl -X POST "https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=process"
```

### Step 4 — Verify Worker Outcome

For an **unknown buyer**, expect `status = 'awaiting_claim'` (M9 not yet implemented).  
For an **existing RobinOS user**, expect `status = 'processed'`, `linked_user_id` set, and a new `payments` row + active `user_subscriptions` row.

```sql
select id, status, linked_user_id, linked_purchase_id, error_history
from public.webhook_events
order by received_at desc
limit 1;
```

### Step 5 — Repeat for Each Test Case

Run the test matrix cases from Section 14, verifying expected HTTP codes, database states, and logs.

### Step 6 — Regression Check

1. Send a Dodo test webhook; confirm existing Dodo flow is unaffected.
2. Send a Whop test webhook; confirm existing Whop flow is unaffected.
3. Verify existing paid users retain their subscriptions.

### Step 7 — Sign-Off

When all test cases pass and the subscription lifecycle matches Section 11, the staging validation is complete.

---

## 9. Expected Database Changes After Each Step

| Step | Table(s) | Expected Change |
|------|----------|-----------------|
| Migration applied | `payment_providers`, `payment_provider_secrets`, `provider_products`, `webhook_events`, `payments`, `platform_settings`, `profiles` | New tables/columns/triggers/RPCs created; `warriorplus` provider row seeded as disabled. |
| Secret stored | `payment_provider_secrets` | One active row: `provider_id='warriorplus'`, `secret_name='ipn_security_key'`. |
| Product mapping created | `provider_products` | One row mapping `WP_ITEM_NUMBER` to plan + duration. |
| Provider enabled | `payment_providers` | `is_enabled` toggled from `false` to `true`. |
| Valid webhook received | `webhook_events` | New row: `status='received'`, `provider_event_id=IPN_ID`, `provider_event_type='sale'`, `standardized_event_type='purchase.created'`. |
| Duplicate webhook received | `webhook_events` | No new row; dispatcher returns existing `id` with `duplicate=true`. |
| Invalid signature webhook | `webhook_events` | **No row inserted**; dispatcher returns 401. |
| Disabled provider webhook | `webhook_events` | **No row inserted**; dispatcher returns 503. |
| Worker processes valid sale for existing user | `webhook_events`, `payments`, `user_subscriptions`, `profiles` | `webhook_events.status='processed'`, `linked_user_id` set; `payments` row inserted; `user_subscriptions.status='active'`; `profiles.subscription_tier` updated. |
| Worker processes valid sale for unknown buyer | `webhook_events` only | `status='awaiting_claim'` (M9 guest claim flow not yet implemented). |
| Worker retry on transient failure | `webhook_events` | `status='failed_retryable'`, `retry_count` incremented, `next_retry_at` set. |
| Worker exhausts retries | `webhook_events` | `status='failed_terminal'`, `error_history` appended. |
| Subscription expires | `user_subscriptions`, `profiles` | `status` becomes `expired` or `canceled` (per existing `process_subscription_expiry` logic); `profiles.subscription_expires_at` reflects expiry. |

---

## 10. Expected Webhook Lifecycle

This section describes the state machine a single WarriorPlus `sale` event should traverse.

```
[WP sends IPN]
       │
       ▼
[Edge Function: payment-webhook]
   ├─ Method/Content-Type/Provider checks
   ├─ Signature verification (WP_SECURITYKEY vs stored secret)
   ├─ enqueue_webhook_event() RPC (idempotent)
   └─ Response: 200 { received: true, id }  (or 200 { duplicate: true })
       │
       ▼
[DB: webhook_events.status = 'received']
       │
       ▼
[Cron invokes process-webhook-worker]
       │
       ▼
[Edge Function: process-webhook-worker]
   ├─ Calls process_webhook_event() RPC
   ├─ Locks row (FOR UPDATE SKIP LOCKED)
   ├─ Validates payload hash + provider enabled
   ├─ Transitions status → 'verified'
   └─ Returns { action: 'verified', ... }
       │
       ▼
[DB: webhook_events.status = 'verified']
       │
       ▼
[M5/M6 downstream processing inside worker/SQL]
   ├─ Resolve user by email (existing or guest)
   ├─ record_purchase_from_webhook()
   ├─ grant_entitlement_from_purchase()
   └─ Transitions status → 'processed'
       │
       ▼
[DB: webhook_events.status = 'processed']
[DB: payments row created]
[DB: user_subscriptions.status = 'active']
```

**Terminal failure path:**

```
[Transient error]
       │
       ▼
[status = 'failed_retryable', retry_count < max_retries]
       │
       ▼
[Retries exhausted]
       │
       ▼
[status = 'failed_terminal']
```

**Duplicate path:**

```
[Same IPN_ID received again]
       │
       ▼
[enqueue_webhook_event detects ON CONFLICT]
       │
       ▼
[Response 200 { received: true, duplicate: true, id }]
[No status change on existing row]
```

---

## 11. Expected Subscription Lifecycle

For a successful one-time 6-month Pro Creator purchase:

| Stage | Table | State | Notes |
|-------|-------|-------|-------|
| Before purchase | `user_subscriptions` | No row OR existing row with previous plan. | Baseline. |
| Webhook received | `webhook_events` | `received` | Event captured, not yet processed. |
| Worker verified | `webhook_events` | `verified` | Payload + provider validated. |
| User resolved | `webhook_events` | `verified` or `awaiting_claim` | Existing user → `linked_user_id` set. Guest → `awaiting_claim`. |
| Purchase recorded | `payments` | New row with `status='completed'`, `plan_key='pro_creator'`, `provider='warriorplus'`. | Linked to `webhook_events.id`. |
| Entitlement granted | `user_subscriptions` | `status='active'`, `plan='pro_creator'`, `billing_cycle='one_time'`, `expires_at = now() + 6 months`. | Uses `provider_products.duration_value=6`, `duration_unit='month'`. |
| Profile updated | `profiles` | `subscription_tier='pro_creator'`, `current_plan='pro_creator'`, `subscription_expires_at` set. | Denormalized for fast reads. |
| Audit log | `subscription_audit_log` | New `plan_switch` event. | Old plan → new plan. |
| Near expiry | `user_subscriptions` | Reminder flags may be set by existing lifecycle engine. | Out of scope for this validation. |
| Expiry | `user_subscriptions` | `status='expired'` (or `canceled` per existing engine). | Driven by `process_subscription_expiry` cron. |
| Post-expiry profile | `profiles` | `subscription_tier` reverts to `free` (per existing engine). | Verify entitlement API reflects free plan. |

**Recurring subscription note:** If `is_subscription = true`, expect `billing_cycle = 'monthly'` or `'yearly'`, `auto_renew = true`, and `next_billing_at` populated. Renewal webhooks (`subscr_completed`) should extend `expires_at` and `current_period_end`. This validation plan focuses on the one-time 6-month flow; recurring flows may be validated separately after M6/M7.

---

## 12. Rollback Procedure if Validation Fails

If any critical test fails, stop validation and execute rollback in reverse order.

### 12.1 Immediate Toggles (Fastest)

| Priority | Action | Command / UI |
|----------|--------|--------------|
| 1 | Disable the WarriorPlus provider immediately. | `update public.payment_providers set is_enabled = false where id = 'warriorplus';` |
| 2 | Disable the `/warriorplus` sales page. | `update public.platform_settings set warriorplus_page_enabled = false;` |
| 3 | Remove the WarriorPlus IPN URL from the WarriorPlus dashboard. | Manual in WP seller settings. |
| 4 | Deregister the worker cron. | `select cron.unschedule('process-webhook-worker-every-minute');` |

### 12.2 Code / Schema Rollback

| Order | Action | Notes |
|-------|--------|-------|
| 1 | Undeploy Edge Functions. | `supabase functions remove payment-webhook process-webhook-worker admin-payment-providers` |
| 2 | Roll back migration 58. | Run rollback block from `58_purchase_and_entitlement.sql`. |
| 3 | Roll back migration 56. | Run rollback block from `56_webhook_worker_rpcs.sql`. |
| 4 | Roll back migration 55. | Run rollback block from `55_admin_payment_provider_rpcs.sql`. |
| 5 | Roll back migration 53. | Run rollback block from `53_payments_extension_and_rpcs.sql`. **Note:** enum values cannot be dropped. |
| 6 | Roll back migration 52. | Drops `provider_products` and `webhook_events`. **Data loss for test events.** |
| 7 | Roll back migration 51. | Drops `payment_providers` and `payment_provider_secrets`. |
| 8 | Roll back migration 50. | Drops `warriorplus_page_enabled` and `warriorplus_demo_video_url` columns. |

### 12.3 Validation After Rollback

| Check | Expected Result |
|-------|-----------------|
| `select * from public.payment_providers where id = 'warriorplus';` | No rows. |
| `\d public.webhook_events` | Table does not exist. |
| `\d public.provider_products` | Table does not exist. |
| Dodo webhook smoke test | Passes. |
| Whop webhook smoke test | Passes. |
| Existing paid subscriptions | Unchanged. |

### 12.4 When to Roll Back vs. Fix Forward

| Scenario | Action |
|----------|--------|
| Signature verification fails due to wrong secret | Fix secret, retry; no rollback needed. |
| Product mapping missing or wrong | Update `provider_products`; no rollback needed. |
| Webhook returns 500 due to RPC error | Investigate logs, fix RPC, retry; no rollback needed. |
| Existing Dodo/Whop flow broken | **Rollback immediately.** |
| Existing user subscriptions corrupted | **Rollback immediately.** |
| Worker dead-letters all events | Diagnose; if root cause is schema-level, roll back. |

---

## 13. Production Promotion Checklist

Promote to production **only after** staging validation is fully signed off.

| # | Task | Verification | Owner |
|---|------|--------------|-------|
| 13.1 | All test cases in Section 14 pass in staging. | Test matrix signed off by QA. | QA |
| 13.2 | Rollback procedure (Section 12) was rehearsed successfully. | Documented evidence of rollback + re-deploy. | Infra |
| 13.3 | Production migrations are identical to staging migrations and applied in the same order. | Migration hashes match; `supabase migration list` shows all applied. | Infra |
| 13.4 | Production Edge Functions deployed in the same order. | `supabase functions list` shows all three. | Infra |
| 13.5 | Production secrets provisioned with production values. | `supabase secrets list` + DB secret row verified. | Infra |
| 13.6 | Production `payment_providers` row for `warriorplus` created with `is_test_mode = false`. | `select is_test_mode from public.payment_providers where id = 'warriorplus';` → `false` | Infra |
| 13.7 | Production WarriorPlus IPN URL set to production endpoint. | URL matches production project. | Infra |
| 13.8 | Production product mappings created and verified. | `provider_products` rows match live WP products. | Admin |
| 13.9 | Production cron registered. | `cron.job` row exists in production. | Infra |
| 13.10 | Monitoring and alerting configured. | Logs, queue depth alert, dead-letter alert in place. | Infra |
| 13.11 | `/warriorplus` sales page enabled only after provider is live. | `warriorplus_page_enabled = true` set as final step. | Admin |
| 13.12 | Provider enabled as the final action. | `update public.payment_providers set is_enabled = true where id = 'warriorplus';` | Admin |
| 13.13 | Post-launch smoke test: make a $0.01 or test purchase through WarriorPlus. | End-to-end flow produces `payments` + `user_subscriptions` rows. | QA |
| 13.14 | Confirm refund handling is **not** enabled yet. | `revoke_entitlement_from_purchase` remains unimplemented (M7). | QA |

---

## 14. Comprehensive Test Matrix

### Legend

- **Input:** How the test is triggered.
- **Precondition:** Required state before the test.
- **Expected HTTP:** Response from `payment-webhook` Edge Function.
- **Expected DB State:** Changes (or lack thereof) in the database.
- **Expected Logs:** Key log events to look for.
- **Pass Criteria:** How to mark the test as passed.

---

### 14.1 Successful Purchase

| Field | Value |
|-------|-------|
| **Objective** | Verify a valid WarriorPlus sale creates a purchase and entitlement for an existing user. |
| **Input** | Simulated WP IPN with `WP_ACTION=sale`, valid `WP_SECURITYKEY`, unique `IPN_ID`, `WP_ITEM_NUMBER=wp_test_item_001`, and buyer email matching an existing `auth.users` row. |
| **Precondition** | Provider enabled; product mapping exists; worker cron active; test user exists with `email='buyer@example.com'` and `plan='free'`. |
| **Expected HTTP** | `200 { received: true, id: '<uuid>' }` |
| **Expected DB State** | 1. `webhook_events` row: `status='received'`, then `processed` after worker. 2. `payments` row created with `plan_key='pro_creator'`, `status='completed'`, `user_id` set. 3. `user_subscriptions` row: `status='active'`, `plan='pro_creator'`, `expires_at ≈ now() + 6 months`. 4. `profiles.subscription_tier='pro_creator'`. |
| **Expected Logs** | `SIGNATURE_VERIFIED`, `ENQUEUED`, `WORKER_ROW_PROCESSED` with `plan` and `expires_at`. |
| **Pass Criteria** | All DB checks pass; buyer can access Pro Creator features. |

---

### 14.2 Duplicate Webhook

| Field | Value |
|-------|-------|
| **Objective** | Verify idempotency: same `IPN_ID` does not create duplicate records. |
| **Input** | Send the exact same IPN body twice. |
| **Precondition** | Provider enabled; valid test payload. |
| **Expected HTTP (1st)** | `200 { received: true, id: '<uuid1>' }` |
| **Expected HTTP (2nd)** | `200 { received: true, duplicate: true, id: '<uuid1>' }` |
| **Expected DB State** | Only one `webhook_events` row; only one `payments` row; only one `user_subscriptions` row. |
| **Expected Logs** | 1st: `ENQUEUED`. 2nd: `DUPLICATE_DETECTED`. |
| **Pass Criteria** | Second response contains `duplicate: true` and the same `id`; no duplicate purchase/subscription rows. |

---

### 14.3 Invalid Signature

| Field | Value |
|-------|-------|
| **Objective** | Verify malformed `WP_SECURITYKEY` is rejected and no data is recorded. |
| **Input** | Valid IPN but with `WP_SECURITYKEY=wrong-secret`. |
| **Precondition** | Provider enabled; correct secret stored. |
| **Expected HTTP** | `401 { received: false, code: 'SIGNATURE_INVALID' }` |
| **Expected DB State** | **No** `webhook_events` row inserted. |
| **Expected Logs** | `SIGNATURE_INVALID` with `reason='mismatch'`. |
| **Pass Criteria** | HTTP 401; no DB rows; logs show signature failure. |

---

### 14.4 Disabled Provider

| Field | Value |
|-------|-------|
| **Objective** | Verify webhooks are rejected when the provider is disabled. |
| **Input** | Valid IPN sent while `payment_providers.is_enabled = false`. |
| **Precondition** | Provider configured but disabled. |
| **Expected HTTP** | `503 { received: false, code: 'PROVIDER_DISABLED' }` |
| **Expected DB State** | No `webhook_events` row inserted. |
| **Expected Logs** | `PROVIDER_DISABLED`. |
| **Pass Criteria** | HTTP 503; no DB rows. |

---

### 14.5 Existing RobinOS User

| Field | Value |
|-------|-------|
| **Objective** | Verify a buyer with an existing RobinOS account is linked immediately. |
| **Input** | Valid sale IPN where `WP_BUYER_EMAIL` matches an existing `auth.users.email`. |
| **Precondition** | User exists with matching email; provider and product enabled. |
| **Expected HTTP** | `200 { received: true, id: '<uuid>' }` |
| **Expected DB State** | `webhook_events.linked_user_id` set to existing user; `payments.user_id` set; `user_subscriptions` updated for that user. |
| **Expected Logs** | `WORKER_ROW_PROCESSED` with `linked_user_id`. |
| **Pass Criteria** | No new `auth.users` row created; existing user's subscription upgraded. |

---

### 14.6 Unknown Buyer

| Field | Value |
|-------|-------|
| **Objective** | Verify an unknown buyer is handled gracefully (guest/pending claim). |
| **Input** | Valid sale IPN where `WP_BUYER_EMAIL` does not exist in `auth.users`. |
| **Precondition** | No user with the test email exists; M9 guest claim flow not yet implemented. |
| **Expected HTTP** | `200 { received: true, id: '<uuid>' }` |
| **Expected DB State** | `webhook_events.status='awaiting_claim'`; `linked_user_id` is `NULL`; no `payments` row; no `user_subscriptions` row. |
| **Expected Logs** | `WORKER_ROW_AWAITING_CLAIM`. |
| **Pass Criteria** | Row lands in `awaiting_claim`; no entitlement granted; no orphan user created. |

---

### 14.7 Worker Retry

| Field | Value |
|-------|-------|
| **Objective** | Verify transient worker failures are retried with backoff. |
| **Input** | Force a transient failure (e.g., temporarily disable `provider_products.is_enabled` after webhook is received but before worker processes it, or inject a DB lock timeout). |
| **Precondition** | Webhook already enqueued. |
| **Expected HTTP** | N/A (worker-driven). |
| **Expected DB State** | `webhook_events.status='failed_retryable'`, `retry_count` increments, `next_retry_at` is in the future. After root cause fixed, worker eventually transitions to `processed`. |
| **Expected Logs** | `WORKER_ROW_RETRY_SCHEDULED`, then later `WORKER_ROW_PROCESSED`. |
| **Pass Criteria** | Retry schedule is set; retry eventually succeeds; no dead-letter without exhaustion. |

---

### 14.8 Expired Subscription

| Field | Value |
|-------|-------|
| **Objective** | Verify the existing subscription expiry engine downgrades the user after the provider-defined duration. |
| **Input** | Create a test purchase with a very short duration (e.g., `duration_value=1`, `duration_unit='minute'`), then wait or advance clock, then run `process_subscription_expiry`. |
| **Precondition** | Purchase succeeded; subscription active. |
| **Expected DB State** | After expiry: `user_subscriptions.status='expired'` (or `canceled` per engine), `profiles.subscription_tier` reverts to `free`. |
| **Expected Logs** | Existing expiry cron logs. |
| **Pass Criteria** | User's effective plan reverts to free after expiry. |

---

### 14.9 Replay Attack

| Field | Value |
|-------|-------|
| **Objective** | Verify that replaying an old valid IPN with a new `IPN_ID` is rejected or does not grant duplicate entitlement. |
| **Input** | Capture a valid IPN payload, change `IPN_ID` to a new value, and resend. |
| **Precondition** | Original purchase already processed. |
| **Expected HTTP** | `200 { received: true, id: '<new-uuid>' }` if IPN_ID is new, but downstream idempotency must prevent duplicate entitlement. |
| **Expected DB State** | A new `webhook_events` row may be created (because `IPN_ID` is new), but `payments` and `user_subscriptions` must **not** duplicate because `payments` is idempotent on `(provider, provider_payment_id)` where `provider_payment_id = WP_SALE/WP_TXNID`. |
| **Expected Logs** | `ENQUEUED` then downstream idempotency hit. |
| **Pass Criteria** | No duplicate `payments` or `user_subscriptions` rows; no additional entitlement granted. |

---

### 14.10 Provider Misconfiguration

| Field | Value |
|-------|-------|
| **Objective** | Verify graceful failure when `provider_products` mapping is missing or disabled. |
| **Input** | Valid IPN with `WP_ITEM_NUMBER` that has no matching `provider_products` row. |
| **Precondition** | Provider enabled; no mapping for the sent `WP_ITEM_NUMBER`. |
| **Expected HTTP** | `200 { received: true, id: '<uuid>' }` (webhook is accepted). |
| **Expected DB State** | `webhook_events.status='failed_terminal'` (or `failed_retryable` depending on classification); `error_history` contains `product_mapping_missing` or similar. No `payments` or `user_subscriptions` changes. |
| **Expected Logs** | Worker logs show terminal failure with classification. |
| **Pass Criteria** | Webhook accepted but not processed; error clearly indicates missing/disabled product mapping. |

---

## 15. Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Engineering Lead | | | |
| QA Lead | | | |
| Infrastructure Lead | | | |

**Final state required before M7 begins:**
- [ ] Staging validation complete.
- [ ] All test cases in Section 14 pass.
- [ ] Rollback procedure rehearsed.
- [ ] Production promotion checklist ready.
- [ ] No live WarriorPlus sales enabled until Section 13 is complete.
