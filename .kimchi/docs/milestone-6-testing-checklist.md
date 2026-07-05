# Milestone 6 — Purchase Recording & Pro Entitlement Testing Checklist

**Status:** Implementation complete. Operator + automated test coverage guide.
**Companion to:**
- `.kimchi/docs/milestone-6-architecture-review.md`
- `.kimchi/docs/milestone-6-rollout-runbook.md`

This checklist covers:
1. **Pre-deployment verification** (BEFORE applying migration 58).
2. **Automated test suite** (Vitest + SQL integration tests).
3. **Operator test plan** (manual scenarios for staging).
4. **Acceptance criteria** (M6 spec verification).
5. **Sign-off** (production promotion gate).

Mark each item as completed. Do NOT promote M6 to production until all acceptance criteria pass.

---

## 1. Pre-Deployment Verification

### 1.1 Database prerequisites

- [ ] Migrations 51–57 are applied (verify via `select migration_name from supabase_migrations.schema_migrations`).
- [ ] `provider_products` table exists and is queryable.
- [ ] `payments` table exists with M53 extension columns (`provider_payment_id`, `source_webhook_event_id`, `plan_key`, `buyer_email_hash`, etc.).
- [ ] `user_subscriptions` table exists with M17 lifecycle columns.
- [ ] `safe_plan_switch` exists (M31).
- [ ] `log_subscription_event`, `process_subscription_expiry` exist (M31).
- [ ] `process_webhook_event` is at M5 implementation (validation + M5 resolution).

```sql
-- Verify M5 RPCs exist
select proname, pronargs from pg_proc
where proname in (
  'process_webhook_event',
  'resolve_or_create_user_from_purchase',
  'safe_plan_switch',
  'log_subscription_event',
  'process_subscription_expiry'
) and pronamespace = (select oid from pg_namespace where nspname = 'public')
order by proname;
```

Expected: 5 rows. `safe_plan_switch` should have **7 arguments** (pre-M6).

### 1.2 Pre-flight data integrity

- [ ] `provider_products` has at least one enabled row for the RobinOS Pro plan:

```sql
select provider_id, provider_product_id, plan_key, duration_value, duration_unit, amount, is_enabled
from public.provider_products
where is_enabled = true
order by provider_id, plan_key;
```

Expected: at least one row with `provider_id='warriorplus'`, `plan_key='pro_creator'`, `duration_value=6`, `duration_unit='month'`. If missing, insert via admin UI or SQL bootstrap before deploying M6.

- [ ] No duplicate `auth.users` emails (M5's `ambiguous_match` dead-letter condition):

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

- [ ] No webhook_events rows stuck in unexpected states:

```sql
select status, count(*)
from public.webhook_events
group by status
order by status;
```

Expected: only `received`, `processing`, `verified`, `awaiting_claim`, `failed_retryable`, `failed_terminal`. No rows at `processed` (M6 introduces this state).

### 1.3 Database backup

- [ ] Database backup taken immediately before applying migration 58.

```bash
pg_dump "$STAGING_DATABASE_URL" -Fc -f /tmp/robinos-pre-migration-58.dump
```

---

## 2. Automated Test Suite

M6 ships with two automated test suites:

### 2.1 Vitest unit tests

**Location:** `src/test/milestone-6.test.ts`

**Run:**
```bash
npm test -- src/test/milestone-6.test.ts
```

**Expected:** All tests pass.

**Coverage:**
- [ ] Action classifier: `processed` (M6 NEW) — 1 test
- [ ] Action classifier: `awaiting_claim` (M5 unchanged) — 1 test
- [ ] Action classifier: `failed_terminal` (extended for purchase_or_entitlement) — 1 test
- [ ] Action classifier: `failed_retryable` — 1 test
- [ ] Action classifier: null action (queue empty) — 1 test
- [ ] Action classifier: defensive fallback for legacy `verified` — 1 test
- [ ] Duration computation: 6 months / 1 year / 30 days / 4 weeks — 4 tests
- [ ] Duration computation: invalid duration / unit — 2 tests
- [ ] `safe_plan_switch` expiry resolution: explicit wins — 1 test
- [ ] `safe_plan_switch` expiry resolution: monthly fallback — 1 test
- [ ] `safe_plan_switch` expiry resolution: yearly fallback — 1 test
- [ ] `safe_plan_switch` expiry resolution: one_time fallback — 1 test
- [ ] Provider product extraction: WP uppercase keys — 1 test
- [ ] Provider product extraction: lowercase canonical keys — 1 test
- [ ] Provider product extraction: key precedence — 1 test
- [ ] Provider product extraction: missing offer_id — 1 test
- [ ] Provider product extraction: missing product_id — 1 test
- [ ] Provider product extraction: numeric string coercion — 1 test
- [ ] Provider product extraction: unparseable amount — 1 test
- [ ] Provider product extraction: null payload — 1 test
- [ ] State transitions: `processed` (M6 NEW) — 1 test
- [ ] State transitions: `awaiting_claim` (M5 unchanged) — 1 test
- [ ] State transitions: `PRODUCT_MAPPING_NOT_FOUND` → `failed_terminal` — 1 test
- [ ] State transitions: `PRODUCT_DISABLED` → `failed_terminal` — 1 test
- [ ] State transitions: `INVALID_DURATION` → `failed_terminal` — 1 test
- [ ] Idempotency: classifier — 1 test
- [ ] Idempotency: duration computation — 1 test
- [ ] Idempotency: extraction — 1 test
- [ ] Idempotency: safe_plan_switch expiry resolution — 1 test
- [ ] Idempotency: sha256Hex — 1 test
- [ ] End-to-end: 6-month Pro scenario — 1 test
- [ ] End-to-end: never hardcode 6 months — 1 test

**Total: 30+ unit tests.**

### 2.2 SQL integration tests

**Location:** `scripts/sql/milestone-6-integration-tests.sql`

**Run:**
```bash
psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-6-integration-tests.sql
```

**Expected output (last lines):**
```
═══════════════════════════════════════════════════════════
  MILESTONE 6 — ALL TESTS PASSED
═══════════════════════════════════════════════════════════
```

**Coverage:**
- [ ] **Test 1**: `safe_plan_switch` signature has 8 arguments (M6 extension verified)
- [ ] **Test 2**: `safe_plan_switch` NULL `p_expires_at` preserves M31 30-day behavior (backward compat)
- [ ] **Test 3**: `safe_plan_switch` explicit `p_expires_at` overrides billing_cycle (M6 NEW)
- [ ] **Setup**: provider_products row seeded for 6-month Pro
- [ ] **Test 4**: `record_purchase_from_webhook` happy path (pro_creator, $39, completed)
- [ ] **Test 5**: `record_purchase_from_webhook` idempotency (replay returns existing)
- [ ] **Test 6**: `record_purchase_from_webhook` PRODUCT_MAPPING_NOT_FOUND (terminal)
- [ ] **Test 7**: `record_purchase_from_webhook` PRODUCT_DISABLED (terminal)
- [ ] **Test 8**: `record_purchase_from_webhook` INVALID_DURATION (terminal)
- [ ] **Test 9**: `grant_entitlement_from_purchase` happy path → 6-month Pro (duration_days=180)
- [ ] **Test 10**: `grant_entitlement_from_purchase` idempotency (replay returns already_granted=true)
- [ ] **Test 11**: `process_webhook_event` full pipeline → `processed` (M4+M5+M6 end-to-end)
- [ ] **Test 12**: `process_webhook_event` guest path → `awaiting_claim` (M5 unchanged; M6 NOT invoked for guests)
- [ ] **Test 13**: `process_webhook_event` PRODUCT_MAPPING_NOT_FOUND → `failed_terminal` with classification `purchase_or_entitlement`
- [ ] **Test 14**: `subscription_audit_log` records the plan switch with `explicit_expires_at=true`
- [ ] **Test 15**: `admin_grant_subscription` (M17, pre-existing safe_plan_switch caller) still works
- [ ] **Test 16**: Cleanup

**Total: 15 integration tests + 1 setup.**

### 2.3 Lint and build

```bash
npm run lint
npm run build
```

**Expected:**
- [ ] Lint passes with no new warnings or errors
- [ ] Build completes successfully
- [ ] Vitest passes for milestone-5.test.ts (no M5 regression)
- [ ] Vitest passes for milestone-6.test.ts

---

## 3. Operator Test Plan (Manual Staging Verification)

Run these AFTER automated tests pass. Each scenario exercises one specific M6 contract end-to-end.

### 3.1 Scenario: Real WP purchase → 6-month Pro entitlement

**Setup:**
1. Pick or create a known `auth.users` row with email `existing-buyer@example.com`.
2. Pick or create an enabled `provider_products` row for `pro_creator` with `duration_value=6, duration_unit='month'`.
3. Send a real (or simulated) WarriorPlus IPN with `WP_BUYER_EMAIL=existing-buyer@example.com` and `WP_ITEM_NUMBER=<your-product-id>`.

**Verify:**
- [ ] HTTP 200 from `payment-webhook` (existing M3 behavior)
- [ ] Row appears in `webhook_events` with `status='received'`
- [ ] Within 5 minutes (cron cadence), row transitions to `status='processed'`
- [ ] `linked_user_id` matches the `auth.users.id`
- [ ] `linked_purchase_id` matches a row in `public.payments`
- [ ] `payments.status='completed'`, `payments.plan_key='pro_creator'`, `payments.amount=39.00`
- [ ] `payments.subscription_id` matches the `user_subscriptions.id`
- [ ] `user_subscriptions.plan='pro_creator'`, `status='active'`
- [ ] `user_subscriptions.expires_at` is ~180 days from `processed_at`
- [ ] `user_subscriptions.provider='warriorplus'`
- [ ] `profiles.subscription_tier='pro_creator'`, `current_plan='pro_creator'`
- [ ] `profiles.subscription_expires_at` is ~180 days from now
- [ ] `profiles.primary_payment_provider='warriorplus'`
- [ ] `subscription_audit_log` has a new `plan_switch` entry with `triggered_by='warriorplus_webhook'` and `metadata.explicit_expires_at=true`
- [ ] Worker log shows `WORKER_ROW_PROCESSED` with all M6 fields (`plan`, `expires_at`, `duration_days`, `linked_purchase_id`)

### 3.2 Scenario: Idempotent webhook replay

**Setup:**
1. Replay the webhook from §3.1 (same `IPN_ID`).

**Verify:**
- [ ] HTTP 200 from `payment-webhook` with `duplicate: true` (M3 idempotency)
- [ ] No second row in `webhook_events`
- [ ] No second row in `public.payments`
- [ ] No second `user_subscriptions` row
- [ ] No second `subscription_audit_log` entry
- [ ] Row state is unchanged

### 3.3 Scenario: Guest purchase (no auth.users match)

**Setup:**
1. Send a webhook with `WP_BUYER_EMAIL=totally-unknown-{{timestamp}}@example.com` (no matching `auth.users` row).

**Verify:**
- [ ] Row transitions to `status='awaiting_claim'`
- [ ] `linked_user_id` is NULL
- [ ] `linked_purchase_id` is NULL (M6 NOT invoked for guests)
- [ ] NO new row in `public.payments`
- [ ] NO new row in `public.user_subscriptions`
- [ ] Worker's `awaiting_claim_count` increments (not `processed_count`)

### 3.4 Scenario: Unknown product ID (terminal failure)

**Setup:**
1. Send a webhook with `WP_ITEM_NUMBER=M6_NONEXISTENT` (no `provider_products` mapping).

**Verify:**
- [ ] Row transitions to `status='failed_terminal'`
- [ ] `last_error` contains `PRODUCT_MAPPING_NOT_FOUND`
- [ ] `classification='purchase_or_entitlement'`
- [ ] NO new row in `public.payments`
- [ ] Worker's `failed_terminal_count` increments
- [ ] Worker log shows `WORKER_ROW_FAILED_TERMINAL`

### 3.5 Scenario: Disabled product (terminal failure)

**Setup:**
1. Set `is_enabled=false` on a `provider_products` row.
2. Send a webhook with `WP_ITEM_NUMBER=<the-disabled-product>`.

**Verify:**
- [ ] Row transitions to `status='failed_terminal'`
- [ ] `last_error` contains `PRODUCT_DISABLED`
- [ ] `classification='purchase_or_entitlement'`

### 3.6 Scenario: 6-month expiry → grace_period → expired

**Setup:**
1. Pick a user with an existing `user_subscriptions` row at `plan='pro_creator'`, `expires_at < now()`.
2. Manually invoke `select public.process_subscription_expiry();`

**Verify:**
- [ ] Returns `{success: true, grace_activated: <N>, downgraded: <N>}`
- [ ] The user's `user_subscriptions.status` transitions to `grace_period`
- [ ] `grace_period_ends_at` is set to `now() + interval '3 days'`
- [ ] `subscription_audit_log` has a new `grace_activated` entry
- [ ] `profiles.subscription_tier` is STILL `pro_creator` (grace period preserves access)

**Then:**
1. Manually set `grace_period_ends_at = now() - interval '1 hour'` (simulate grace ending).
2. Manually invoke `select public.process_subscription_expiry();` again.

**Verify:**
- [ ] Returns `{success: true, downgraded: <N+1>}`
- [ ] The user's `user_subscriptions.status` transitions to `expired`
- [ ] `profiles.subscription_tier` is now `free`
- [ ] `profiles.subscription_expires_at` is NULL
- [ ] `subscription_audit_log` has a new `auto_downgrade` entry

### 3.7 Scenario: Expiry cron is actually running

**Setup:**
1. After §5.4 of the rollout runbook, wait 90 minutes.

**Verify:**
- [ ] `cron.job_run_details` has at least 1 successful run for `process-subscription-expiry-hourly`
- [ ] `status='succeeded'`
- [ ] `return_message` contains the expected JSON shape

### 3.8 Scenario: Backward-compat for existing safe_plan_switch callers

**Setup:**
1. Via the admin UI or via SQL, call `admin_grant_subscription(user_id, 'creator', 'monthly', 30, 'Test')` for a test user.

**Verify:**
- [ ] Returns `{success: true, plan: 'creator', expires_at: ...}`
- [ ] `user_subscriptions` row is created/updated
- [ ] `subscription_audit_log` has the entry
- [ ] `profiles.subscription_tier='creator'`

This proves the M6 extension did NOT break the M17 admin_grant_subscription caller.

### 3.9 Scenario: Plan downgrade (pre-existing user with cooldown)

**Setup:**
1. Pick a user who already has a `user_subscriptions` row at `plan='pro_creator'` with `cooldown_until > now()` (within the 14-day cooldown).
2. Send a webhook for the same user with `WP_ITEM_NUMBER=<a-creator-product>` (downgrade from pro to creator).

**Verify:**
- [ ] `safe_plan_switch` either:
  - Rejects the downgrade (cooldown check), OR
  - Bypasses cooldown (admin_grant_subscription allows this; safe_plan_switch does not check cooldown — it relies on trg_subscription_plan_change to auto-set cooldown)

This documents the existing behavior. M6 does NOT change it. If a problem is observed, file a separate ticket for post-M6 review.

---

## 4. Acceptance Criteria (M6 Spec Verification)

These map directly to the verification requirements in the M6 spec.

### 4.1 Build passes

- [ ] `npm run build` exits 0
- [ ] `npm run lint` exits 0 with no new errors
- [ ] No TypeScript errors in `supabase/functions/process-webhook-worker/index.ts`
- [ ] Vitest passes for both `milestone-5.test.ts` and `milestone-6.test.ts`

### 4.2 Existing subscriptions remain unaffected

- [ ] All M31 `safe_plan_switch` callers (`admin_grant_subscription`, `process_subscription_expiry`) continue to work (verified by SQL Test 15).
- [ ] No change in `resolve_user_plan` behavior (verified by Vitest Test "M5 unchanged").
- [ ] No change in `plan_entitlements` (verified by `select count(*) from plan_entitlements` before/after = same).
- [ ] No change in `usage_tracking` structure (verified by SQL Test 11 not writing to usage_tracking).

### 4.3 Existing safe_plan_switch behavior remains backward-compatible

- [ ] `safe_plan_switch` with `p_expires_at=null` (or omitted) returns `explicit_expires_at=false` and `duration_days=30` for `billing_cycle='monthly'` (verified by SQL Test 2).
- [ ] `safe_plan_switch` with `p_expires_at=null` and `billing_cycle='yearly'` returns `duration_days=365` (Vitest test).
- [ ] All existing M17 callers continue to function without modification (verified by SQL Test 15).

### 4.4 Existing RobinOS users receive Pro correctly

- [ ] Webhook with matching `auth.users` email transitions to `status='processed'` (SQL Test 11).
- [ ] `user_subscriptions.plan='pro_creator'`, `status='active'`.
- [ ] `expires_at` is ~180 days from `processed_at` (6 months).
- [ ] `profiles.subscription_tier='pro_creator'`, `current_plan='pro_creator'`.
- [ ] `subscription_audit_log` has the entry.

### 4.5 Expiration date is calculated from provider_products configuration

- [ ] `expires_at` is NOT hardcoded; it is computed from `provider_products.duration_value` + `duration_unit` (SQL Test 9, Vitest "End-to-end: 6-month Pro scenario").
- [ ] Different `duration_value` values produce different `expires_at` (Vitest "never hardcode 6 months").
- [ ] `duration_unit` mapping: `day → days, week → weeks, month → months, year → years` (Vitest "duration computation").

### 4.6 Duplicate webhook deliveries remain idempotent

- [ ] Replaying the same `IPN_ID` does NOT create a second `payments` row (SQL Test 5).
- [ ] Replaying the same purchase_id to `grant_entitlement_from_purchase` returns `already_granted=true` (SQL Test 10).
- [ ] Re-running `process_webhook_event` on an already-processed row returns `null` (idempotent at the row-claim level, inherited from M4).
- [ ] `safe_plan_switch` is idempotent via `ON CONFLICT (user_id) DO UPDATE` (inherited from M31).

### 4.7 Complete end-to-end WarriorPlus purchase flow passes in staging

- [ ] §3.1 passes (real WP purchase → 6-month Pro)
- [ ] §3.6 passes (expiry → grace_period → expired)
- [ ] §3.7 passes (cron is actually running)
- [ ] All M6 SQL integration tests pass
- [ ] All M6 Vitest tests pass

---

## 5. Sign-Off

Before promoting M6 to production, ALL of the following must be true:

- [ ] All 30+ Vitest unit tests pass
- [ ] All 15 SQL integration tests pass
- [ ] `npm run build` and `npm run lint` succeed
- [ ] All 9 operator scenarios in §3 pass
- [ ] All 7 acceptance criteria in §4 pass
- [ ] `process_subscription_expiry` cron is registered and verified running (rollout runbook §5)
- [ ] Rollback script reviewed and understood by at least one operator
- [ ] Monitoring/alerting rules from the rollout runbook §8.2 are configured

Once all items are checked, M6 is ready for production promotion. Follow `.kimchi/docs/milestone-6-rollout-runbook.md` §3-5 for the production deployment procedure.

---

## 6. Test Maintenance

### 6.1 Adding new tests

When extending M6 (e.g., adding renewal handling, supporting a new provider):
- Add unit tests to `src/test/milestone-6.test.ts` for any new pure logic (duration computations, field extraction).
- Add integration tests to `scripts/sql/milestone-6-integration-tests.sql` for any new RPC behavior or terminal failure modes.
- Update this checklist with new operator scenarios.

### 6.2 Flaky test triage

The Vitest tests are pure JS — no flakiness expected. If they fail intermittently, suspect:
- Timezone-related drift in the duration computation tests. The tests use `Date` objects with explicit UTC; verify your test runner is configured for UTC.
- Environment-specific JS engine quirks.

The SQL integration tests require a clean staging database. If they fail:
- Verify the cleanup block at the end of the previous run completed.
- Check for stale `auth.users` test rows from prior interrupted runs:
  ```sql
  select id, email from auth.users where email like 'm6-test-%@example.com';
  ```
- Manually clean up if needed:
  ```sql
  delete from auth.users where email like 'm6-test-%@example.com';
  delete from webhook_events where provider_event_id like 'M6_TEST_%';
  delete from provider_products where provider_id = 'warriorplus' and provider_product_id like 'M6_%';
  ```

### 6.3 Test coverage gaps (intentional)

The following are NOT tested in M6 because they belong to other milestones:
- M7: refund handling, subscription cancellation
- M8: dispute / chargeback handling
- M9: account creation, claim flow (the M5 `awaiting_claim` rows will be picked up here)
- M10: affiliate commissions
- M11: admin diagnostics UI for M6 rows

These will get their own test suites when those milestones ship.
