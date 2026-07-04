# Milestone 1 — Database Foundation — Testing Checklist

**Test-only document. No code, no SQL changes.**

**Covers:** Milestones 1 migrations 51, 52, 53
**Goal:** Verify Milestone 1 is complete and production-safe before approval to proceed to Milestone 2.

---

## Pre-Test Setup

Before running tests, ensure:

- [ ] Staging database is up and current with production schema (migrations 1-50 applied)
- [ ] Database backup taken immediately before applying M1 migrations
- [ ] Restore procedure tested and verified working
- [ ] Supabase CLI installed and authenticated
- [ ] Connection strings for staging + production available
- [ ] Team members notified of maintenance window (if applying to production)
- [ ] On-call rotation aware of the test schedule

---

## Test 1: Apply Migrations to Staging (Clean Database)

### 1.1 Apply migration 51

```bash
supabase db push --db-url <staging-url>
```

**Verify:**
- [ ] Migration applies without error
- [ ] `public.payment_providers` table exists in Supabase Studio
- [ ] `public.payment_provider_secrets` table exists in Supabase Studio
- [ ] Seed row exists: `SELECT * FROM public.payment_providers WHERE id = 'warriorplus';`
- [ ] Seed row shows `is_enabled = false`, `display_name = 'WarriorPlus'`, `adapter_version = '1.0.0'`
- [ ] `idx_payment_providers_enabled` index exists
- [ ] `idx_payment_provider_secrets_provider` index exists
- [ ] `idx_payment_provider_secrets_active` index exists
- [ ] RLS is enabled on both tables (`\d+ public.payment_providers`)
- [ ] RLS policies are present:
  - `Admins manage payment_providers`
  - `Service role reads payment_providers`
  - `Service role manages payment_provider_secrets`
  - `payment_provider_secrets_deny_authenticated`
- [ ] Trigger `trg_payment_providers_updated_at` exists
- [ ] No existing data was modified (count rows in `profiles`, `payments`, `user_subscriptions` — same as before)

### 1.2 Apply migration 52

```bash
supabase db push --db-url <staging-url>
```

**Verify:**
- [ ] Migration applies without error
- [ ] `public.provider_products` table exists
- [ ] `public.webhook_events` table exists
- [ ] All constraints on `provider_products` work:
  - `plan_key` CHECK rejects invalid values (try `'invalid_plan'`)
  - `billing_cycle` CHECK rejects invalid values
  - `duration_value` CHECK rejects 0 or negative
  - `duration_unit` CHECK rejects invalid values
  - `amount` CHECK rejects negative
- [ ] Unique constraint on `provider_products(provider_id, provider_product_id, provider_offer_id)` enforced
- [ ] Partial unique index `idx_provider_products_unique` enforced (handles NULL offer_id)
- [ ] `webhook_events` status CHECK enforces all 11 allowed values
- [ ] `webhook_events.unique(provider_id, provider_event_id)` enforced (try duplicate insert)
- [ ] Indexes on webhook_events:
  - `idx_webhook_events_queue` (queue scan)
  - `idx_webhook_events_provider_txn`
  - `idx_webhook_events_user`
  - `idx_webhook_events_retry`
  - `idx_webhook_events_trace`
  - `idx_webhook_events_status_received`
- [ ] RLS policies on both tables correct
- [ ] Triggers `trg_provider_products_updated_at` and `trg_webhook_events_updated_at` exist

### 1.3 Apply migration 53

```bash
supabase db push --db-url <staging-url>
```

**Verify:**
- [ ] Migration applies without error
- [ ] `ALTER TYPE payment_provider` now includes 'warriorplus' (verify with `\dT+ payment_provider`)
- [ ] `ALTER TYPE payment_status` now includes 'partially_refunded', 'charged_back', 'disputed' (`\dT+ payment_status`)
- [ ] `payments` table has 13 new columns (verify with `\d public.payments`)
- [ ] All new `payments` columns are nullable
- [ ] Existing `payments` rows have NULL in new columns (verify no existing rows broken)
- [ ] New indexes on payments exist:
  - `idx_payments_buyer_hash`
  - `idx_payments_provider_event`
  - `idx_payments_subscription`
  - `idx_payments_affiliate`
  - `idx_payments_status_date`
  - `idx_payments_plan_key`
- [ ] `affiliate_commissions.provider_payment_id` column exists
- [ ] `idx_affiliate_commissions_provider_payment` index exists
- [ ] `platform_settings` has `payment_provider_default = 'warriorplus'`
- [ ] `platform_settings` has `payment_provider_require_email_verification = true`
- [ ] `profiles` has `primary_payment_provider` column (nullable)
- [ ] Trigger `trg_payments_set_buyer_hash` exists and fires correctly:
  - INSERT a test row with `buyer_email = 'TEST@EXAMPLE.COM'`
  - Verify `buyer_email_hash` is auto-populated with SHA-256 of `test@example.com`
- [ ] Trigger `trg_payments_updated_at` exists
- [ ] All 15 new RPCs created (verify with `\df public.enqueue_webhook_event` etc.)
- [ ] All 6 implemented RPCs callable from service_role
- [ ] All 9 stub RPCs raise exception with correct message

---

## Test 2: Verify No Regression in Existing Functionality

### 2.1 Existing RPCs still callable

```sql
-- Test each of these RPCs that they still work
SELECT public.resolve_user_plan('<existing-user-id>');
SELECT public.get_user_entitlements('<existing-user-id>');
SELECT public.get_subscription_status('<existing-user-id>');
SELECT public.get_subscription_lifecycle('<existing-user-id>');
SELECT public.check_plan_change_cooldown('<existing-user-id>');
SELECT public.get_usage_status_v2('<existing-user-id>', 'script_generation');
```

**Verify:**
- [ ] `resolve_user_plan` returns valid JSON for existing users
- [ ] `get_user_entitlements` returns feature map for existing users
- [ ] `get_subscription_status` returns subscription state
- [ ] `get_subscription_lifecycle` returns full lifecycle
- [ ] `check_plan_change_cooldown` returns cooldown state
- [ ] `get_usage_status_v2` returns usage status
- [ ] All other existing RPCs in public schema still callable

### 2.2 Existing Dodo/Whop flows

**Verify:**
- [ ] Dodo webhook endpoint still works (if test purchase available)
- [ ] Whop webhook endpoint still works (if test purchase available)
- [ ] Existing payment_provider enum values still work ('creem', 'stripe', 'lemonsqueezy', 'manual')
- [ ] Existing payment_status enum values still work ('pending', 'succeeded', 'failed', 'refunded', 'canceled')

### 2.3 Existing cron jobs

```sql
-- Check cron jobs are still scheduled
SELECT * FROM cron.job;
```

**Verify:**
- [ ] `process_subscription_expiry` cron still scheduled (if was scheduled before)
- [ ] All other existing cron jobs unchanged

### 2.4 Existing RLS policies

**Verify (using Supabase Studio or SQL):**
- [ ] RLS still enabled on `profiles`, `payments`, `user_subscriptions`, `plan_entitlements`, `usage_tracking`
- [ ] Existing RLS policies unchanged
- [ ] No new RLS policies conflict with existing ones
- [ ] Anon role still has correct access patterns

### 2.5 Existing triggers

```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

**Verify:**
- [ ] All pre-existing triggers still present
- [ ] `trg_user_subscriptions_updated_at` still fires
- [ ] `trg_profile_updated_at` still fires
- [ ] `trg_payments_set_buyer_hash` is the only NEW trigger on payments
- [ ] `trg_payments_updated_at` was NOT previously on payments table (verify it's new — not a duplicate)

### 2.6 Application-level regression

- [ ] Log into RobinOS as a free user → dashboard works
- [ ] Log into RobinOS as a paid Dodo user → subscription shows correctly
- [ ] Log into RobinOS as admin → admin dashboard loads
- [ ] Run a script generation as a paid user → works (uses existing RPCs)
- [ ] View affiliate dashboard → works
- [ ] View subscription settings → shows existing subscription correctly

### 2.7 Build verification

- [ ] `npm run build` succeeds (already verified locally)
- [ ] `npm test` passes (already verified locally — 28 tests passing)
- [ ] No new TypeScript errors introduced (existing errors are pre-existing)
- [ ] No new lint warnings introduced (existing warnings are pre-existing)

---

## Test 3: Verify New Functionality is Inert (No Behavior Change)

### 3.1 New tables queryable but not written to

**Verify:**
- [ ] `webhook_events` table is empty (no rows)
- [ ] `provider_products` table is empty (no rows)
- [ ] `payments` table: existing rows have NULL in new columns
- [ ] `payment_providers` table has only the seeded 'warriorplus' row with `is_enabled = false`
- [ ] `payment_provider_secrets` table is empty

### 3.2 New RPCs callable but raise exceptions on stubs

```sql
-- These should all return 200/success
SELECT public.enqueue_webhook_event(
  'warriorplus', 'test-event-1', 'SALE',
  '{"test": "payload"}'::jsonb, null, null, gen_random_uuid()
);
SELECT public.record_subscription_webhook_event(
  'test-event-1', 'warriorplus', 'SALE', 'test-hash'
);
SELECT public.retry_webhook_event('00000000-0000-0000-0000-000000000000'::uuid);
SELECT public.mark_webhook_dead_letter('00000000-0000-0000-0000-000000000000'::uuid, 'test');

-- These should all raise exceptions with TODO messages
SELECT public.process_webhook_event('00000000-0000-0000-0000-000000000000'::uuid);
SELECT public.process_pending_webhook_events(50, 25000);
SELECT public.record_purchase_from_webhook('00000000-0000-0000-0000-000000000000'::uuid);
SELECT public.grant_entitlement_from_purchase('00000000-0000-0000-0000-000000000000'::uuid);
SELECT public.revoke_entitlement_from_purchase('00000000-0000-0000-0000-000000000000'::uuid, 'test');
SELECT public.recalculate_user_effective_plan('00000000-0000-0000-0000-000000000000'::uuid);
SELECT public.resolve_or_create_user_from_purchase('test@example.com', 'Test', 'warriorplus');
SELECT public.send_purchase_claim_email('00000000-0000-0000-0000-000000000000'::uuid, 'test@example.com');
SELECT public.complete_purchase_claim('00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb);
```

**Verify:**
- [ ] `enqueue_webhook_event` returns `{id, is_duplicate: false, status: 'received'}`
- [ ] `record_subscription_webhook_event` returns `{is_duplicate: false, recorded_at: ...}`
- [ ] `retry_webhook_event` returns `{success: false, error: 'webhook_event_not_found'}`
- [ ] `mark_webhook_dead_letter` returns `{success: false, error: 'webhook_event_not_found'}`
- [ ] All 9 stub RPCs raise exception with message matching `not yet implemented (scheduled for Milestone N)`

### 3.3 Idempotency test

```sql
-- Call enqueue twice with same event ID
SELECT public.enqueue_webhook_event(
  'warriorplus', 'duplicate-test-1', 'SALE',
  '{"test": "payload"}'::jsonb, null, null, gen_random_uuid()
) AS first_call;

SELECT public.enqueue_webhook_event(
  'warriorplus', 'duplicate-test-1', 'SALE',
  '{"test": "payload"}'::jsonb, null, null, gen_random_uuid()
) AS second_call;
```

**Verify:**
- [ ] First call returns `{is_duplicate: false}`
- [ ] Second call returns `{is_duplicate: true}` with same `id`
- [ ] Only one row exists in `webhook_events` table
- [ ] Same idempotency works for `record_subscription_webhook_event`

### 3.4 Trigger test for buyer_email_hash

```sql
-- Insert a payment row with buyer_email, verify hash is computed
INSERT INTO public.payments (
  user_id, provider, provider_payment_id, amount, currency, status,
  buyer_email, buyer_name
) VALUES (
  '<existing-user-id>', 'manual', 'test-buyer-hash-1', 10.00, 'USD', 'pending',
  'Test@Example.COM', 'Test Buyer'
);

-- Verify the hash
SELECT id, buyer_email, buyer_email_hash,
  encode(digest('test@example.com', 'sha256'), 'hex') AS expected_hash
FROM public.payments
WHERE provider_payment_id = 'test-buyer-hash-1';
```

**Verify:**
- [ ] `buyer_email` stored as `'Test@Example.COM'` (preserved as-is in column)
- [ ] `buyer_email_hash` is SHA-256 of `'test@example.com'` (lowercased + trimmed)
- [ ] Hash matches `digest('test@example.com', 'sha256')` value

```sql
-- Cleanup test row
DELETE FROM public.payments WHERE provider_payment_id = 'test-buyer-hash-1';
```

### 3.5 Search RPCs

```sql
-- After inserting test webhook events, search should work
SELECT * FROM public.search_webhook_events(
  p_provider_id := 'warriorplus',
  p_limit := 10
);

SELECT * FROM public.search_payments(
  p_provider_id := 'manual',
  p_limit := 10
);
```

**Verify:**
- [ ] `search_webhook_events` returns table structure as documented
- [ ] `search_payments` returns table structure as documented
- [ ] `search_payments` masks buyer_email correctly (e.g. `'t***@example.com'`)

---

## Test 4: Verify Admin Access Patterns

### 4.1 RLS — admin access to payment_providers

```sql
-- As authenticated admin user
SELECT * FROM public.payment_providers; -- should succeed
INSERT INTO public.payment_providers (id, display_name, adapter_version)
VALUES ('test_provider', 'Test', '1.0.0'); -- should succeed

-- As authenticated non-admin user
SELECT * FROM public.payment_providers; -- should return 0 rows
INSERT INTO public.payment_providers (id, display_name, adapter_version)
VALUES ('test_provider2', 'Test2', '1.0.0'); -- should fail
```

**Verify:**
- [ ] Admin can SELECT from payment_providers
- [ ] Admin can INSERT into payment_providers
- [ ] Admin can UPDATE payment_providers
- [ ] Admin can DELETE payment_providers
- [ ] Non-admin authenticated users get 0 rows from SELECT
- [ ] Non-admin authenticated users cannot INSERT/UPDATE/DELETE
- [ ] Anon role gets 0 rows

### 4.2 RLS — provider_products

```sql
-- As authenticated admin user
SELECT * FROM public.provider_products; -- should succeed
INSERT INTO public.provider_products (
  provider_id, provider_product_id, plan_key, billing_cycle,
  duration_value, duration_unit, amount, currency
) VALUES (
  'warriorplus', 'wp_test_1', 'creator', 'one_time',
  6, 'month', 19.00, 'USD'
); -- should succeed
```

**Verify:**
- [ ] Admin can manage provider_products
- [ ] Non-admin cannot SELECT (RLS denied)
- [ ] Service role can SELECT (for adapter lookups)

### 4.3 RLS — webhook_events

```sql
-- As authenticated admin user
SELECT * FROM public.webhook_events; -- should succeed
INSERT INTO public.webhook_events (...) VALUES (...); -- should FAIL (service_role only for writes)

-- As anon user
SELECT * FROM public.webhook_events; -- should FAIL (denied)
```

**Verify:**
- [ ] Admin can SELECT webhook_events (for diagnostics)
- [ ] Admin cannot INSERT webhook_events directly (must go through Edge Function)
- [ ] Non-admin cannot SELECT
- [ ] Anon cannot SELECT
- [ ] Service role can do all operations

### 4.4 RLS — payment_provider_secrets

```sql
-- As authenticated admin user
SELECT * FROM public.payment_provider_secrets; -- should FAIL (deny policy)

-- As service_role
SELECT * FROM public.payment_provider_secrets; -- should succeed
```

**Verify:**
- [ ] Even super_admin cannot SELECT via SQL (must use Edge Function)
- [ ] Service role can manage all operations

---

## Test 5: Verify Enum Additions

```sql
-- Verify enum values
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'public.payment_provider'::regtype
ORDER BY enumsortorder;
-- Expected: creem, stripe, lemonsqueezy, manual, warriorplus

SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'public.payment_status'::regtype
ORDER BY enumsortorder;
-- Expected: pending, succeeded, failed, refunded, canceled, partially_refunded, charged_back, disputed
```

**Verify:**
- [ ] `payment_provider` enum has new value 'warriorplus'
- [ ] `payment_status` enum has new values 'partially_refunded', 'charged_back', 'disputed'
- [ ] All existing enum values still present
- [ ] Existing code that references enum values still works (regression check)

```sql
-- Test that 'warriorplus' can be used as provider value in a NEW transaction
BEGIN;
INSERT INTO public.payments (
  user_id, provider, provider_payment_id, amount, currency, status
) VALUES (
  '<existing-user-id>', 'warriorplus'::public.payment_provider, 'test-warriorplus-1', 39.00, 'USD', 'pending'
);
ROLLBACK;
```

**Verify:**
- [ ] Insert with `'warriorplus'::public.payment_provider` succeeds in a NEW transaction
- [ ] Insert with `'partially_refunded'::public.payment_status` succeeds
- [ ] Insert with `'charged_back'::public.payment_status` succeeds
- [ ] Insert with `'disputed'::public.payment_status` succeeds

---

## Test 6: Rollback Testing

### 6.1 Rollback migration 52 on staging

Use the rollback script in the migration file (commented out):

```sql
-- Uncomment and run the rollback section
BEGIN;
DROP TRIGGER IF EXISTS trg_provider_products_updated_at ON public.provider_products;
DROP TRIGGER IF EXISTS trg_webhook_events_updated_at ON public.webhook_events;
DROP TABLE IF EXISTS public.webhook_events CASCADE;
DROP TABLE IF EXISTS public.provider_products CASCADE;
COMMIT;
```

**Verify:**
- [ ] Both tables dropped successfully
- [ ] No errors during rollback
- [ ] Existing functionality unaffected
- [ ] Other migration 51 tables still present

### 6.2 Rollback migration 51 on staging

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_payment_providers_updated_at ON public.payment_providers;
DROP TABLE IF EXISTS public.payment_provider_secrets CASCADE;
DROP TABLE IF EXISTS public.payment_providers CASCADE;
COMMIT;
```

**Verify:**
- [ ] Both tables dropped
- [ ] No errors

### 6.3 Rollback migration 53 on staging

Note: enum values CANNOT be rolled back.

```sql
-- Use the rollback script in migration 53 file
-- Drop all 15 RPCs, 2 triggers, all new columns
-- Enum values remain (PG limitation)
```

**Verify:**
- [ ] All 15 RPCs dropped
- [ ] 2 triggers on payments dropped
- [ ] 13 columns on payments dropped (existing data preserved)
- [ ] 1 column on affiliate_commissions dropped
- [ ] 2 columns on platform_settings dropped
- [ ] 1 column on profiles dropped
- [ ] Enum values remain (expected, cannot be dropped in PG)

### 6.4 Verify rollback leaves no orphans

```sql
-- Check no references to dropped tables/RPCs remain
SELECT * FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('payment_providers', 'payment_provider_secrets',
                     'provider_products', 'webhook_events');
-- Expected: 0 rows

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'enqueue_webhook_event', 'record_subscription_webhook_event',
    'retry_webhook_event', 'mark_webhook_dead_letter',
    'search_webhook_events', 'search_payments',
    'process_webhook_event', 'process_pending_webhook_events',
    'record_purchase_from_webhook', 'grant_entitlement_from_purchase',
    'revoke_entitlement_from_purchase', 'recalculate_user_effective_plan',
    'resolve_or_create_user_from_purchase', 'send_purchase_claim_email',
    'complete_purchase_claim'
  );
-- Expected: 0 rows
```

**Verify:**
- [ ] All 4 new tables dropped
- [ ] All 15 new RPCs dropped
- [ ] No orphaned references

### 6.5 Restore from backup (optional but recommended)

If rollback tests passed, also test full restore from backup:

- [ ] Take fresh backup
- [ ] Apply migrations 51, 52, 53
- [ ] Drop database, restore from pre-migration backup
- [ ] Verify schema is back to pre-M1 state
- [ ] Verify all data restored correctly

---

## Test 7: Apply to Production

### 7.1 Pre-production checklist

- [ ] All staging tests passed
- [ ] Rollback tested and verified on staging
- [ ] Database backup taken immediately before migration
- [ ] Maintenance window scheduled (low-traffic)
- [ ] On-call rotation aware
- [ ] Communication sent to team

### 7.2 Apply migrations in order

```bash
# Apply each migration one at a time
supabase db push --db-url <production-url> --include-only 51
# Verify
supabase db push --db-url <production-url> --include-only 52
# Verify
supabase db push --db-url <production-url> --include-only 53
# Verify
```

**Verify after each migration:**
- [ ] Migration applies successfully
- [ ] No errors in application logs
- [ ] Database CPU/memory normal
- [ ] Existing user flows still work (smoke test in production)
- [ ] No new errors in error tracking

### 7.3 Post-production smoke tests

- [ ] Free user can log in
- [ ] Paid user can log in
- [ ] Admin can log in
- [ ] Dashboard loads
- [ ] Subscription status shows correctly
- [ ] Script generation works
- [ ] No 500 errors in production logs
- [ ] No webhook delivery failures for Dodo/Whop

---

## Test 8: Documentation Verification

- [ ] All 3 migration files have clear header comments
- [ ] All new tables have `comment on table` documentation
- [ ] All new columns have `comment on column` documentation
- [ ] All new RPCs have `comment on function` documentation
- [ ] Rollback scripts are clearly marked and commented
- [ ] Milestone 1 review document accurately describes what was implemented

---

## Test 9: Milestone 1 Self-Review Fixes (Migration 54)

**Required because migration 54 fixes 5 critical bugs and 1 race discovered during the pre-Milestone-2 self-review. Apply migrations 51 → 52 → 53 → 54 as a single batch and run these tests in addition to Tests 1-8.**

### 9.1 Apply migration 54

```bash
supabase db push --db-url <staging-url> --include-only 54
```

**Verify:**
- [ ] Migration applies without error
- [ ] `idx_payments_subscription` now exists on `subscription_id` (not `user_subscription_id`)
- [ ] `trg_payments_updated_at` exists on `payments` exactly ONCE (M01 version only; M53 duplicate removed)
- [ ] `record_subscription_webhook_event(text, text, text, text)` RPC is DROPPED
- [ ] `search_payments` recompiled successfully
- [ ] `search_webhook_events` recompiled successfully
- [ ] `enqueue_webhook_event` recompiled successfully

### 9.2 Fix 1 — index column reference

```sql
\d+ public.idx_payments_subscription
-- Should show: payments (subscription_id) WHERE subscription_id IS NOT NULL
```

**Verify:**
- [ ] Index targets `subscription_id` (not `user_subscription_id`)
- [ ] Index is partial: `WHERE subscription_id IS NOT NULL`
- [ ] Index is valid and usable: `SET enable_seqscan = off; EXPLAIN SELECT * FROM payments WHERE subscription_id = '<uuid>';` uses the index

### 9.3 Fix 2 — search_payments output column

```sql
SELECT user_subscription_id FROM public.search_payments(p_limit := 1);
-- Should succeed (output column is aliased to user_subscription_id but reads from payments.subscription_id)
```

**Verify:**
- [ ] Output column `user_subscription_id` is populated
- [ ] The value matches `payments.subscription_id` for the same row (verify with join)
- [ ] No "column user_subscription_id does not exist" error

### 9.4 Fix 3 — duplicate trigger removed

```sql
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'payments'
  AND trigger_name = 'trg_payments_updated_at';
-- Expected: exactly 1 row
```

**Verify:**
- [ ] Exactly ONE `trg_payments_updated_at` trigger on `payments` (M01 version only)
- [ ] Updating a payment row updates `updated_at` exactly once (no double-update)

### 9.5 Fix 4 — duplicate RPC removed

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'record_subscription_webhook_event';
-- Expected: 0 rows

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'record_webhook_event';
-- Expected: 1 row (the M31 atomic version is still present)
```

**Verify:**
- [ ] `record_subscription_webhook_event` is DROPPED
- [ ] `record_webhook_event` (M31) still exists and is callable
- [ ] Edge functions must call `record_webhook_event` going forward

### 9.6 Fix 5 — search_webhook_events buyer-email filter

```sql
-- Setup: insert a webhook event, link it to a payment with a known email
WITH new_event AS (
  INSERT INTO public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    payload_hash, raw_payload
  ) VALUES (
    'warriorplus', 'm54-test-event-1', 'SALE',
    encode(digest('{"buyer_email":"Buyer@Example.COM"}'::text, 'sha256'), 'hex'),
    '{"buyer_email":"buyer@example.com","amount":39}'::jsonb
  ) RETURNING id
), new_payment AS (
  INSERT INTO public.payments (
    user_id, provider, provider_payment_id, amount, currency, status,
    buyer_email
  ) VALUES (
    '<existing-user-id>', 'manual', 'm54-test-payment-1', 39.00, 'USD', 'pending',
    'Buyer@Example.COM'
  )
  RETURNING id, source_webhook_event_id
)
UPDATE public.webhook_events
   SET linked_purchase_id = (SELECT id FROM new_payment)
 WHERE id = (SELECT id FROM new_event);

-- Test: search by the original (case-mixed) email
SELECT count(*) FROM public.search_webhook_events(p_buyer_email := 'Buyer@Example.COM');
-- Expected: 1 (the event we just inserted)

-- Cleanup
DELETE FROM public.payments WHERE provider_payment_id = 'm54-test-payment-1';
DELETE FROM public.webhook_events WHERE provider_event_id = 'm54-test-event-1';
```

**Verify:**
- [ ] `search_webhook_events` with case-mixed email returns ≥1 row
- [ ] Filter uses `payments.buyer_email_hash` (not `raw_payload->>'buyer_email_hash'`)
- [ ] The raw payload itself does NOT contain a `buyer_email_hash` key (sanity check on original M53 bug)

### 9.7 Fix 6 — atomic enqueue_webhook_event under concurrency

```sql
-- Setup: use a fixed trace_id and provider_event_id for this test
-- Insert one event via enqueue_webhook_event
SELECT public.enqueue_webhook_event(
  'warriorplus', 'm54-concurrent-test-1', 'SALE',
  '{"test":"payload"}'::jsonb, null, null, '11111111-1111-1111-1111-111111111111'::uuid
) AS first_call;

-- In a separate transaction, call again with same args
BEGIN;
SELECT public.enqueue_webhook_event(
  'warriorplus', 'm54-concurrent-test-1', 'SALE',
  '{"test":"payload"}'::jsonb, null, null, '11111111-1111-1111-1111-111111111111'::uuid
) AS second_call;
COMMIT;
```

**Verify:**
- [ ] First call returns `{is_duplicate: false, status: 'received'}`
- [ ] Second call returns `{is_duplicate: true, status: 'received'}` with SAME `id`
- [ ] Only ONE row in `webhook_events` with `provider_event_id = 'm54-concurrent-test-1'`
- [ ] (Optional but recommended) Run 50 concurrent `enqueue_webhook_event` calls with the same args via `psql -c "SELECT enqueue_webhook_event(...)" &` × 50 — exactly 1 row in table, 1 `{is_duplicate: false}` and 49 `{is_duplicate: true}` responses.

### 9.8 Idempotency of migration 54

```bash
supabase db push --db-url <staging-url> --include-only 54
# Run again — should be a no-op
supabase db push --db-url <staging-url> --include-only 54
```

**Verify:**
- [ ] First apply succeeds
- [ ] Second apply is a no-op (no errors, no duplicate triggers/RPCs/indexes)

---

## Test Results Summary

After running all tests, document results:

| Test Category | Pass/Fail | Notes |
|---------------|-----------|-------|
| 1. Apply migrations to staging | ☐ | |
| 2. No regression in existing functionality | ☐ | |
| 3. New functionality is inert | ☐ | |
| 4. Admin access patterns | ☐ | |
| 5. Enum additions | ☐ | |
| 6. Rollback testing | ☐ | |
| 7. Production deployment | ☐ | |
| 8. Documentation | ☐ | |

---

## Sign-Off

Milestone 1 is complete when:

- [ ] All tests above pass
- [ ] Rollback verified on staging
- [ ] Production deployment successful with no regressions
- [ ] All deliverables in `.kimchi/docs/warriorplus-production-readiness-review.md` § Milestone 1 are met:
  - [ ] All 3 migrations applied
  - [ ] Database backup verified restorable
  - [ ] Zero regression in existing functionality
  - [ ] Tables queryable via Supabase Studio
  - [ ] New RPCs callable (smoke test each)
  - [ ] Triggers firing on insert/update
  - [ ] RLS policies blocking unauthorized access
  - [ ] No application code reads/writes new tables yet (verified via code search)
  - [ ] Rollback scripts tested on staging
  - [ ] Production monitoring shows no errors
- [ ] Engineering Lead approval
- [ ] Product Manager approval (if applicable)
- [ ] Security review (RLS policies, enum values)

**After all sign-offs, Milestone 1 is APPROVED and Milestone 2 can begin.**

---

## Implementation Summary

### Files Created

| File | Size | Purpose |
|------|------|---------|
| `supabase/migrations/51_payment_providers.sql` | ~10.6 KB | payment_providers + payment_provider_secrets tables, RLS, triggers, seed row |
| `supabase/migrations/52_provider_products_and_webhook_events.sql` | ~15.3 KB | provider_products + webhook_events tables, RLS, triggers, indexes |
| `supabase/migrations/53_payments_extension_and_rpcs.sql` | ~35.5 KB | payments extension (13 cols), enum extensions, 2 triggers, 15 RPCs |
| `.kimchi/docs/milestone-1-testing-checklist.md` | (this file) | Testing checklist |

### Files Modified

None. The build still succeeds with the same pre-existing TypeScript and lint warnings as before.

### Schema Changes Summary

**New tables (4):**
1. `payment_providers`
2. `payment_provider_secrets`
3. `provider_products` (with `duration_value` + `duration_unit` for the 6-month rule)
4. `webhook_events`

**Extended tables (4):**
1. `payments` (+13 columns)
2. `platform_settings` (+2 columns)
3. `profiles` (+1 column)
4. `affiliate_commissions` (+1 column)

**Extended enums (2):**
1. `payment_provider` (+1 value: 'warriorplus')
2. `payment_status` (+3 values: 'partially_refunded', 'charged_back', 'disputed')

**New RPCs (15):**
- 6 implemented: `enqueue_webhook_event`, `record_subscription_webhook_event`, `retry_webhook_event`, `mark_webhook_dead_letter`, `search_webhook_events`, `search_payments`
- 9 stubbed for future milestones: `process_webhook_event`, `process_pending_webhook_events`, `record_purchase_from_webhook`, `grant_entitlement_from_purchase`, `revoke_entitlement_from_purchase`, `recalculate_user_effective_plan`, `resolve_or_create_user_from_purchase`, `send_purchase_claim_email`, `complete_purchase_claim`

**New triggers (2):**
1. `trg_payments_set_buyer_hash` (BEFORE INSERT on payments)
2. `trg_payments_updated_at` (BEFORE UPDATE on payments)

**New indexes (11+):**
- 3 on payment_providers + payment_provider_secrets
- 8 on provider_products + webhook_events
- 6 on payments extensions
- 1 on affiliate_commissions extension

### What Is NOT Implemented (Defer to Later Milestones)

Per Milestone 1 scope:
- ❌ No Edge Functions (M3+)
- ❌ No admin UI (M2)
- ❌ No frontend changes (M12)
- ❌ No webhook processing (M4)
- ❌ No user resolution (M5)
- ❌ No entitlement granting (M6)
- ❌ No refund/chargeback logic (M7, M8)
- ❌ No guest creation (M9)
- ❌ No affiliate commission logic (M10)

These are explicitly stubbed in the 9 stubbed RPCs which will be implemented in their respective milestones.

---

**Milestone 1 complete. Awaiting approval before proceeding to Milestone 2.**
