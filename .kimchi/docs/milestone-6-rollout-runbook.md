# Milestone 6 — Purchase Recording & Pro Entitlement Production Runbook

**Status:** Implementation complete. Operator-facing guide.
**Companion to:**
- `.kimchi/docs/milestone-6-architecture-review.md` (design justification)
- `.kimchi/docs/milestone-6-testing-checklist.md` (operator + automated tests)
- `.kimchi/docs/milestone-5-rollout-runbook.md` (predecessor; M6 extends M5)

This runbook covers deployment, the **new** `process_subscription_expiry` cron registration, operator procedures for the M6 pipeline, monitoring, and rollback. M6 completes the core WarriorPlus purchase flow: after M5 resolves buyer identity, M6 records the purchase in `public.payments`, grants the RobinOS plan entitlement via `safe_plan_switch`, and marks the webhook as processed.

---

## 1. What M6 Changes

| Surface | Before M6 (M5) | After M6 |
|---|---|---|
| `record_purchase_from_webhook` | M53 stub (raises) | Real implementation: idempotent INSERT into `public.payments` |
| `grant_entitlement_from_purchase` | M53 stub (raises) | Real implementation: calls `safe_plan_switch` with computed `expires_at` |
| `safe_plan_switch` signature | 7 parameters (M31) | 8 parameters: + `p_expires_at timestamptz default null` |
| `safe_plan_switch` duration | 30/365 days from `billing_cycle` | Honors `p_expires_at` when non-NULL; falls back to 30/365 when NULL |
| `process_webhook_event` action values | `verified`, `awaiting_claim`, `failed_terminal`, `failed_retryable` | Same values, but `verified` is no longer returned as terminal (it's an internal intermediate state during M6); new `processed` value returned for terminal success |
| `webhook_events.status` flow | `received → processing → verified` (existing user) | `received → processing → verified → processing → processed` |
| `user_subscriptions.expires_at` | 30/365 days for all purchases | `provider_products.duration_value + duration_unit` (e.g. 6 months for RobinOS Pro) |
| `payments.subscription_id` | NULL until M6 | Populated by M6 after `grant_entitlement_from_purchase` |
| `profiles.primary_payment_provider` | NULL until M6 | Set to `'warriorplus'` on first purchase (preserves first-provider attribution) |
| `process_subscription_expiry` cron | **NOT REGISTERED** (pre-existing gap) | Registered via M6 rollout (see §5) |

---

## 2. Pre-Deployment Checklist

Before deploying M6, confirm:

- [ ] Migrations 51–57 are applied (M1–M5 complete).
- [ ] `provider_products` table has at least one enabled row for the RobinOS Pro plan with `duration_value=6, duration_unit='month'`:
  ```sql
  select provider_id, provider_product_id, plan_key, billing_cycle,
         duration_value, duration_unit, amount, currency, is_enabled
  from public.provider_products
  where is_enabled = true
  order by provider_id, plan_key;
  ```
  Expected: at least one row with `provider_id='warriorplus'`, `plan_key='pro_creator'`, `duration_value=6`, `duration_unit='month'`.
- [ ] `auth.users` table is in a known state (no duplicate emails — M5 enforces this):
  ```sql
  select count(*) as duplicate_emails
  from (
    select lower(email) as normalized
    from auth.users
    where email is not null and deleted_at is null
    group by lower(email)
    having count(*) > 1
  ) d;
  ```
  Expected: 0.
- [ ] M5 worker has been running successfully. Check the M5 queue health:
  ```sql
  select status, count(*) from public.webhook_events
  where provider_event_id not like 'M6_TEST_%'
  group by status;
  ```
  Expected: no row stuck at `processing` for >5 minutes; queue is draining.
- [ ] M4 worker (`process-webhook-worker` Edge Function) is deployed and reachable.
- [ ] Local Supabase CLI is logged in (`supabase status` succeeds).
- [ ] Database backup taken immediately before applying migration 58.

If any of the above is incomplete, **stop and resolve before proceeding**.

---

## 3. Apply Migration 58

```bash
supabase db push --db-url <staging-url> --include-only 58
```

**Expected output:**
- Migration applies without error.
- 2 functions replaced: `record_purchase_from_webhook`, `grant_entitlement_from_purchase`.
- 1 function signature extended: `safe_plan_switch` (now 8 parameters).
- 1 function replaced: `process_webhook_event` (M5 → M5+M6).
- Zero new tables, columns, indexes, or status values.

**Verify the function signatures:**
```sql
select proname, pronargs
from pg_proc
where proname in (
  'record_purchase_from_webhook',
  'grant_entitlement_from_purchase',
  'safe_plan_switch',
  'process_webhook_event'
) and pronamespace = (select oid from pg_namespace where nspname = 'public')
order by proname;
```

Expected:
- [ ] `record_purchase_from_webhook`: 1 argument (uuid)
- [ ] `grant_entitlement_from_purchase`: 1 argument (uuid)
- [ ] `safe_plan_switch`: **8 arguments** (was 7; M6 added `p_expires_at`)
- [ ] `process_webhook_event`: 1 argument (uuid default null)

**Verify security definer + search_path pinned:**
```sql
select proname, prosecdef, proconfig
from pg_proc
where proname in (
  'record_purchase_from_webhook',
  'grant_entitlement_from_purchase',
  'safe_plan_switch',
  'process_webhook_event'
) and pronamespace = (select oid from pg_namespace where nspname = 'public');
```

- [ ] All 4 are `prosecdef = true` (SECURITY DEFINER)
- [ ] All 4 have `proconfig` containing `'search_path=public'`

---

## 4. Deploy the Worker

The M6 changes to the worker are limited to one new action branch (`processed`) in `process-webhook-worker/index.ts`.

```bash
supabase functions deploy process-webhook-worker --project-ref <staging-ref>
```

**Verify:**
- [ ] Deploy succeeds
- [ ] Function URL unchanged: `https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker`

---

## 5. Register the `process_subscription_expiry` Cron (CRITICAL — NEW)

**This is the single most important operational step in M6.** The existing codebase never had a cron registered for the subscription expiry job (a pre-existing gap discovered during the M6 architecture review). M6 ships a `process_subscription_expiry` RPC in migration 31, but until now it was never invoked.

Without this cron, **6-month Pro entitlements will NOT auto-revert to free after expiry**. Profiles will keep reporting `subscription_tier='pro_creator'` indefinitely. Register this cron BEFORE allowing real purchases to accumulate.

### 5.1 Recommended: hourly cadence

```sql
select cron.schedule(
  'process-subscription-expiry-hourly',
  '0 * * * *',  -- every hour at minute 0
  $$ select public.process_subscription_expiry(); $$
);
```

**Verify:**
```sql
select * from cron.job where jobname = 'process-subscription-expiry-hourly';
```

- [ ] Job is active
- [ ] Schedule is `0 * * * *`

### 5.2 Volume tuning

| Daily active subscriptions | Recommended cadence |
|---|---|
| < 100 | Every 6 hours (`0 */6 * * *`) |
| 100–1,000 | Every 1 hour (default) |
| 1,000–10,000 | Every 15 minutes (`*/15 * * * *`) |
| > 10,000 | Every 5 minutes (`*/5 * * * *`) |

The function uses `pg_try_advisory_xact_lock` so concurrent runs are safe (the second invocation returns `LOCK_CONTENTION` immediately).

### 5.3 First-run verification

Manually invoke the function once to confirm it works:

```sql
select public.process_subscription_expiry();
```

**Expected response:**
```json
{
  "success": true,
  "expiring_marked": 0,
  "grace_activated": 0,
  "downgraded": 0,
  "processed_at": "..."
}
```

For a staging database with no expiring subscriptions, all counters are 0. In production with live data, `downgraded` will be > 0 for any users whose `expires_at <= now()`.

### 5.4 Monitor cron execution

After 90 minutes (1 hour + buffer), verify the cron has fired:

```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'process-subscription-expiry-hourly')
order by start_time desc
limit 3;
```

- [ ] At least 1 successful run
- [ ] `status = 'succeeded'`

### 5.5 What if cron registration fails?

If Supabase hosted doesn't expose `pg_cron`, schedule via an Edge Function cron instead:

```sql
-- Supabase pg_cron with net.http_post alternative
select cron.schedule(
  'process-subscription-expiry-edge-fn',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<staging-ref>.supabase.co/functions/v1/process-subscription-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

If neither pg_cron nor net.http_post is available, create a dedicated Edge Function `process-subscription-expiry` that invokes the SQL function, and schedule it via Supabase scheduled functions or an external cron (e.g., GitHub Actions).

---

## 6. First-Run Verification

After migration + worker deploy + cron registration, manually invoke the worker to confirm M6 works end-to-end.

### 6.1 Run the SQL integration tests

```bash
psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-6-integration-tests.sql
```

**Expected output:** 15+ PASS messages + 1 PASS for the cleanup summary + a final banner "MILESTONE 6 — ALL TESTS PASSED".

**Verify:**
- [ ] All 15 test sections print `PASS`
- [ ] No `FAIL` lines
- [ ] The cleanup block runs without error

### 6.2 Run the Vitest suite

```bash
npm test -- src/test/milestone-6.test.ts
```

**Expected:** All 30+ tests pass.

### 6.3 Seed real webhook events

Use the M4 simulation script to seed events:
```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>" \
  node scripts/test-webhook-worker.cjs seed --count 5
```

For M6 verification, ensure at least 2 events use a `WP_BUYER_EMAIL` matching a known `auth.users` row (so the M5+M6 path runs) and at least 2 use a fresh email (guest path).

### 6.4 Invoke the worker

```bash
curl -X POST 'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker'
```

**Expected response (HTTP 200):**
```json
{
  "worker_id": "<uuid>",
  "iterations": 5,
  "processed_count": <N>,            // M6 NEW: full pipeline success
  "awaiting_claim_count": <M>,
  "failed_terminal_count": 0,
  "failed_retryable_count": 0,
  "no_op_count": 0,
  "queue_empty_at_iteration": 5,
  "rpc_failure": null
}
```

**Verify:**
- [ ] `processed_count + awaiting_claim_count + failed_terminal_count + failed_retryable_count + no_op_count = iterations`
- [ ] At least 1 row in `processed_count` (if you seeded with a known email)
- [ ] At least 1 row in `awaiting_claim_count` (if you seeded with a fresh email)
- [ ] `failed_terminal_count = 0` (assuming no malformed payloads)

### 6.5 Confirm row transitions

```sql
-- Distribution of M6 terminal states for the seeded rows
select
  status,
  resolution_outcome,
  count(*),
  avg(extract(epoch from (processed_at - received_at))) as avg_processing_seconds
from public.webhook_events
where provider_event_id like 'TEST_M4_%'  -- or whatever prefix the seeder uses
group by status, resolution_outcome
order by status;
```

Expected:
- [ ] Some rows at `status='processed'` with `linked_purchase_id` set
- [ ] Some rows at `status='awaiting_claim'` (guest path)
- [ ] Average processing time < 2 seconds per row

### 6.6 Inspect a fully-processed row

```sql
select
  we.id as webhook_event_id,
  we.status as webhook_status,
  we.linked_user_id,
  we.linked_purchase_id,
  we.resolution_outcome,
  we.processed_at,
  p.id as payment_id,
  p.status as payment_status,
  p.plan_key,
  p.amount,
  p.subscription_id,
  s.plan as subscription_plan,
  s.status as subscription_status,
  s.expires_at as subscription_expires_at,
  s.provider,
  pr.subscription_tier as profile_tier,
  pr.primary_payment_provider
from public.webhook_events we
left join public.payments p on p.id = we.linked_purchase_id
left join public.user_subscriptions s on s.id = p.subscription_id
left join public.profiles pr on pr.user_id = we.linked_user_id
where we.status = 'processed'
limit 1;
```

**Verify:**
- [ ] `webhook_status = 'processed'`, `processed_at` populated
- [ ] `linked_purchase_id` matches a row in `payments`
- [ ] `payments.status = 'completed'`, `payments.plan_key = 'pro_creator'`
- [ ] `user_subscriptions.plan = 'pro_creator'`, `status = 'active'`
- [ ] `user_subscriptions.expires_at` is ~180 days from `processed_at` (6 months)
- [ ] `profiles.subscription_tier = 'pro_creator'`, `current_plan = 'pro_creator'`
- [ ] `profiles.primary_payment_provider = 'warriorplus'`

### 6.7 Verify the subscription_audit_log entry

```sql
select
  user_id,
  event_type,
  old_plan,
  new_plan,
  old_status,
  new_status,
  triggered_by,
  metadata
from public.subscription_audit_log
where triggered_by = 'warriorplus_webhook'
order by created_at desc
limit 5;
```

**Verify:**
- [ ] Each processed webhook produced exactly one `plan_switch` audit log entry
- [ ] `metadata.explicit_expires_at = true` (proves the M6 extension was used)
- [ ] `metadata.expires_at` matches the row's `expires_at`

---

## 7. M6 Operational Procedures

### 7.1 Reading M6-specific queue health

**M6 outcome distribution (last 24 hours):**
```sql
select
  resolution_outcome,
  count(*) as rows,
  avg(extract(epoch from (processed_at - received_at))) as avg_seconds_to_process
from public.webhook_events
where processed_at > now() - interval '24 hours'
  and resolution_outcome = 'resolved_existing_user'
group by resolution_outcome;
```

Healthy: most rows resolve in <2 seconds.

**M6 terminal failures (last 24 hours):**
```sql
select
  status,
  count(*),
  max(last_error)
from public.webhook_events
where status = 'failed_terminal'
  and last_error_at > now() - interval '24 hours'
  and last_error like '%PRODUCT_MAPPING_NOT_FOUND%'
     or last_error like '%PRODUCT_DISABLED%'
     or last_error like '%INVALID_DURATION%'
     or last_error like '%UNSUPPORTED_EVENT_TYPE%'
group by status;
```

Healthy: 0 or known low count. Any row requires investigation:
```sql
select id, provider_id, provider_event_type, last_error, received_at
from public.webhook_events
where status = 'failed_terminal'
  and last_error like '%purchase_or_entitlement_failed%'
order by received_at desc
limit 50;
```

### 7.2 Inspecting a single processed purchase

For any row in `processed` status:

```sql
select
  we.id as webhook_event_id,
  we.processed_at,
  we.linked_user_id,
  au.email as user_email,
  we.linked_purchase_id,
  p.id as payment_id,
  p.amount,
  p.currency,
  p.billing_cycle,
  p.plan_key,
  p.provider_payment_id,
  p.subscription_id,
  s.plan as sub_plan,
  s.status as sub_status,
  s.expires_at as sub_expires_at,
  s.provider as sub_provider,
  s.amount as sub_amount
from public.webhook_events we
left join auth.users au on au.id = we.linked_user_id
left join public.payments p on p.id = we.linked_purchase_id
left join public.user_subscriptions s on s.id = p.subscription_id
where we.id = '<event_id>';
```

### 7.3 Inspecting expiry state

**Users expiring in the next 7 days:**
```sql
select
  s.user_id,
  au.email,
  s.plan,
  s.expires_at,
  s.status
from public.user_subscriptions s
left join auth.users au on au.id = s.user_id
where s.expires_at between now() and now() + interval '7 days'
  and s.status in ('active', 'expiring', 'grace_period')
order by s.expires_at;
```

**Users currently in grace period:**
```sql
select
  s.user_id,
  au.email,
  s.plan,
  s.expires_at,
  s.grace_period_ends_at,
  extract(day from (s.grace_period_ends_at - now())) as grace_days_remaining
from public.user_subscriptions s
left join auth.users au on au.id = s.user_id
where s.status = 'grace_period'
order by s.grace_period_ends_at;
```

**Manually invoke the expiry job (rare; usually the cron handles it):**
```sql
select public.process_subscription_expiry();
```

### 7.4 Re-running a failed M6 purchase

For rows in `failed_terminal` with `purchase_or_entitlement` classification:

1. Identify and fix the root cause (enable the disabled product, fix the missing mapping, etc.).
2. `select public.retry_webhook_event('<event_id>');` — resets the row to `status='received'`.
3. The next worker tick re-runs the full M4+M5+M6 pipeline.
4. Verify the resolution succeeds.

### 7.5 What M6 does NOT do (escalation guidance)

If an admin needs:
- **Refund processing** → that's M7, not M6.
- **Subscription renewal webhooks** → out of M6 scope. Renewals will be added post-M6.
- **Affiliate commission** → M10.
- **Email confirmation to buyer** → M9.

---

## 8. Monitoring and Alerting

### 8.1 Key metrics to track

| Metric | Query | Healthy range |
|---|---|---|
| M6 success rate | `select count(*) from webhook_events where status='processed' and processed_at > now() - interval '1 day'` / total | > 95% (excluding awaiting_claim which is also success) |
| M6 latency p99 | `select extract(epoch from (processed_at - received_at)) from webhook_events where processed_at is not null order by 1 desc limit 100` | < 5s |
| M6 terminal failures | `select count(*) from webhook_events where status='failed_terminal' and last_error like '%purchase_or_entitlement%' and last_error_at > now() - interval '1 day'` | 0 |
| Active Pro subscriptions | `select count(*) from user_subscriptions where plan='pro_creator' and status='active'` | Tracks purchase volume |
| Expiring within 7 days | `select count(*) from user_subscriptions where status='expiring'` | Variable; ramp as M6 ages |
| Grace period users | `select count(*) from user_subscriptions where status='grace_period'` | Variable |
| Downgraded today | `select count(*) from subscription_audit_log where event_type='auto_downgrade' and created_at > now() - interval '1 day'` | Tracks expiry volume |

### 8.2 Suggested alerts

| Condition | Severity | Action |
|---|---|---|
| `purchase_or_entitlement` failures > 0 in last hour | Page admin | Check `provider_products` mapping; expected near-zero |
| M6 latency p99 > 10s for > 15 min | Warn | Check DB performance; safe_plan_switch is heavy |
| Active Pro subscriptions grew > 5x daily average | Warn (positive) | Possibly indicates a marketing spike |
| `process-subscription-expiry-hourly` cron not fired in 2 hours | Page admin | 6-month entitlements will not auto-revert |
| `downgraded` count > 0 when expected 0 (after a major price change) | Info | Expected; confirm no admin actions |

### 8.3 Logging

Worker logs flow through Supabase Edge Function Logs. M6 adds this new log event:

| Event | When emitted | Fields |
|---|---|---|
| `WORKER_ROW_PROCESSED` | M6 terminal success | `webhook_event_id`, `provider_id`, `trace_id`, `lock_id`, `provider_event_type`, `standardized_event_type`, `event_mapping_confidence`, `resolution_outcome`, `linked_user_id`, `linked_purchase_id`, `plan`, `expires_at`, `duration_days` |

Existing M4/M5 events continue to fire unchanged:
- `WORKER_START`, `WORKER_DONE`, `WORKER_HEARTBEAT`
- `WORKER_ROW_AWAITING_CLAIM` (M5)
- `WORKER_ROW_FAILED_TERMINAL`, `WORKER_ROW_RETRY_SCHEDULED`
- `WORKER_QUEUE_EMPTY`, `WORKER_RPC_FAILED`

To query M6 logs:
```bash
supabase functions logs process-webhook-worker --project-ref <ref> | grep -E 'PROCESSED|purchase_or_entitlement'
```

---

## 9. Rollback Procedures

### 9.1 When to roll back

Consider rollback if:
- M6 dead-letters all incoming webhooks with `PRODUCT_MAPPING_NOT_FOUND` (likely a missing provider_products row).
- M6 latency exceeds 10s p99 (DB performance regression or safe_plan_switch regression).
- `safe_plan_switch` extension breaks an existing caller (would have been caught in Tests 2, 15 of the SQL integration tests).
- The expiry cron registration fails and you cannot proceed without it.

### 9.2 Standard rollback (recommended)

The rollback section at the bottom of `supabase/migrations/58_purchase_and_entitlement.sql` restores:
- M5 `process_webhook_event` (no M6 step)
- M53 stubs for `record_purchase_from_webhook` and `grant_entitlement_from_purchase`
- M31 7-parameter `safe_plan_switch` (drops `p_expires_at`)

**Apply:**
```bash
psql "$STAGING_DATABASE_URL" -c "$(awk '/^\/\*$/,/^\*\/$/{print}' supabase/migrations/58_purchase_and_entitlement.sql | sed '1d;$d')"
```

**After rollback, also redeploy the worker with the M5 code:**
```bash
git checkout <m5-commit> -- supabase/functions/process-webhook-worker/index.ts
supabase functions deploy process-webhook-worker --project-ref <ref>
```

### 9.3 Data integrity check after rollback

```sql
select status, count(*) from public.webhook_events group by status;
select count(*) as processed_rows_remaining from public.webhook_events where status='processed';
select count(*) as pro_users from public.user_subscriptions where plan='pro_creator';
```

Expected after rollback:
- [ ] Existing `processed` rows stay in `processed` state (worker no longer touches them — idempotency holds)
- [ ] Existing `pro_creator` subscriptions stay active
- [ ] New webhooks will land at `verified` (M5 behavior) but will NOT trigger M6 steps
- [ ] `record_purchase_from_webhook` and `grant_entitlement_from_purchase` raise exceptions

### 9.4 IMPORTANT: expiry cron after rollback

**The `process_subscription_expiry` cron SHOULD STAY REGISTERED even after M6 rollback.** It is a pre-existing operational gap fix — M6's rollback reverts the SQL additions, but the cron job itself is harmless and operates on the M31 function which is unchanged by M6. Keep it running so the 6-month entitlements from the M6 lifetime still expire correctly.

### 9.5 Re-running after rollback

1. Identify the root cause (DB performance? missing provider_products? admin error?).
2. Fix the root cause.
3. Re-apply migration 58.
4. Re-deploy the worker (M6 version).
5. Manually trigger a worker tick to verify.
6. The cron remains registered throughout.

---

## 10. Common Issues

### 10.1 All purchases dead-letter with `PRODUCT_MAPPING_NOT_FOUND`

**Symptom:** Every webhook results in `failed_terminal` with `purchase_or_entitlement_failed: record_purchase_failed: PRODUCT_MAPPING_NOT_FOUND`.

**Cause:** The `provider_products` row for the buyer's `WP_ITEM_NUMBER` doesn't exist or is disabled.

**Fix:**
```sql
-- Find the failing provider_product_id
select distinct raw_payload->>'WP_ITEM_NUMBER' as product_id
from public.webhook_events
where status = 'failed_terminal'
  and last_error like '%PRODUCT_MAPPING_NOT_FOUND%'
order by product_id;

-- For each missing product, insert the mapping (admin decision)
insert into public.provider_products (
  provider_id, provider_product_id, plan_key, billing_cycle,
  duration_value, duration_unit, amount, currency,
  is_subscription, is_enabled, display_name
) values (
  'warriorplus', '<product_id>', 'pro_creator', 'one_time',
  6, 'month', 39.00, 'USD', false, true, 'RobinOS Pro — 6-month'
) on conflict (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
  do update set is_enabled = true;

-- Retry the failed rows
select id from public.webhook_events
where status = 'failed_terminal'
  and last_error like '%PRODUCT_MAPPING_NOT_FOUND%';
-- Then call retry_webhook_event for each.
```

### 10.2 `INVALID_DURATION` errors

**Symptom:** `last_error = '...INVALID_DURATION: ...'`.

**Cause:** `provider_products.duration_value` is NULL, 0, or negative.

**Fix:**
```sql
update public.provider_products
set duration_value = 6, duration_unit = 'month'
where provider_id = 'warriorplus' and duration_value is null or duration_value <= 0;
```

### 10.3 Expiry cron not firing

**Symptom:** Active Pro subscriptions are NOT transitioning through grace_period after `expires_at`. Users keep reporting Pro access.

**Diagnosis:**
```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'process-subscription-expiry-hourly')
order by start_time desc limit 5;
```

**Possible causes:**
1. Cron job not registered (re-run §5.1).
2. Cron job registered but failing (check `status='failed'` rows; inspect `return_message`).
3. `process_subscription_expiry` is failing internally (advisory lock contention is the most common cause; check for stuck transactions).

**Fix:** Follow the registration steps in §5; if failing, manually invoke `select public.process_subscription_expiry();` to surface the error.

### 10.4 `safe_plan_switch` callers break after M6

**Symptom:** Other RPCs (e.g., M17 `admin_grant_subscription`) that internally use `safe_plan_switch` start raising errors.

**Cause:** Migration 58 was applied but the existing caller is passing positional arguments and the new 8th parameter is being misinterpreted.

**Fix:** Verify the call site. If using positional args:
```sql
-- WRONG (after M6, this now passes NULL for p_expires_at and may shift semantics)
select safe_plan_switch(user_id, 'creator', 'monthly', null, null, 0, 'admin');

-- RIGHT (always works; p_expires_at defaults to NULL → backcompat 30-day behavior)
select safe_plan_switch(
  p_user_id => user_id,
  p_new_plan => 'creator',
  p_billing_cycle => 'monthly',
  p_provider => null,
  p_provider_sub_id => null,
  p_amount => 0,
  p_triggered_by => 'admin'
);
```

### 10.5 Profile.subscription_tier is correct but UI shows 'free'

**Cause:** Frontend caches the plan from a previous request. M6 updates the profile atomically, but the frontend may need to refetch.

**Fix:** Not a backend issue. Clear the frontend cache or trigger a re-fetch via `await supabase.rpc('get_user_entitlements')`.

---

## 11. Performance and Scaling

### 11.1 Single-worker M6 overhead

Per-row M6 cost on top of M4+M5:
- 1 SQL query against `provider_products` (lookup by provider_id + provider_product_id).
- 1 INSERT INTO `public.payments` (with ON CONFLICT for idempotency).
- 1 SELECT + 1 INSERT/UPDATE on `user_subscriptions` via `safe_plan_switch`.
- 1 UPDATE on `public.profiles`.
- 1 INSERT INTO `subscription_audit_log` (via `log_subscription_event`).
- 2 UPDATEs on `public.webhook_events` (status transitions).
- 1 SHA-256 computation for buyer_email_hash.

Estimated overhead: ~30-100ms per row. M5 baseline was ~60-70ms; M6 brings it to ~90-170ms.

### 11.2 Indexes used by M6

M6 relies on existing indexes:
- `idx_provider_products_unique` (M52) — on `(provider_id, provider_product_id, coalesce(provider_offer_id, ''))`.
- `idx_payments_provider_event` (M53) — on `(provider, provider_payment_id)`.
- `idx_user_subscriptions_user_id` (M01) — UNIQUE on `user_id`.
- `idx_sub_audit_user_id` (M31) — on `(user_id, created_at desc)`.

No new indexes are needed for M6.

### 11.3 Concurrency

M6 inherits M4+M5's `FOR UPDATE SKIP LOCKED` concurrency safety. Multiple workers cannot double-process the same row.

`process_subscription_expiry` uses `pg_try_advisory_xact_lock(hashtext('process_subscription_expiry'))` to prevent concurrent expiry runs.

---

## 12. Change Log

| Date | Change | Operator |
|---|---|---|
| YYYY-MM-DD | Initial rollout to staging | <name> |
| YYYY-MM-DD | Registered `process_subscription_expiry-hourly` cron | <name> |
| YYYY-MM-DD | First real WP purchase processed end-to-end | <name> |
| YYYY-MM-DD | Promoted to production | <name> |

---

## 13. References

- Architecture review: `.kimchi/docs/milestone-6-architecture-review.md`
- Migration: `supabase/migrations/58_purchase_and_entitlement.sql`
- SQL integration tests: `scripts/sql/milestone-6-integration-tests.sql`
- Vitest tests: `src/test/milestone-6.test.ts`
- Worker: `supabase/functions/process-webhook-worker/index.ts`
- Predecessor: `.kimchi/docs/milestone-5-rollout-runbook.md`
- Subsystem: M31 `process_subscription_expiry`, M31 `safe_plan_switch`
