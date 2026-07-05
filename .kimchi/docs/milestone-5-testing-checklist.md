# Milestone 5 — User Resolution Testing Checklist

**Status:** Implementation complete. Operator + automated test coverage guide.
**Companion to:**
- `.kimchi/docs/milestone-5-architecture-review.md`
- `.kimchi/docs/milestone-5-rollout-runbook.md`

This checklist covers:
1. **Pre-deployment verification** (what to run BEFORE applying migration 57).
2. **Automated test suite** (Vitest + SQL integration tests).
3. **Operator test plan** (manual scenarios for staging verification).
4. **Acceptance criteria** (the M5 spec's verification requirements).

Mark each item as you complete it. Do NOT promote M5 to production until all acceptance criteria pass.

---

## 1. Pre-Deployment Verification

Before applying migration 57, run these checks.

### 1.1 Database prerequisites

- [ ] Migrations 51–56 are applied (verify via `supabase db remote commit-list` or `select migration_name from supabase_migrations.schema_migrations`).
- [ ] `webhook_events` table exists and is queryable.
- [ ] `auth.users` table is queryable.
- [ ] M4 worker (`process-webhook-event` function) is in place.

```sql
-- Verify migration 56 RPCs exist
select proname from pg_proc
where proname in ('process_webhook_event', 'schedule_webhook_retry', 'mark_webhook_dead_letter')
order by proname;
```

Expected: 3 rows.

### 1.2 Pre-flight data integrity

- [ ] No duplicate auth.users emails (would cause ambiguous matches):

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

Expected: only `received`, `processing`, `verified`, `failed_retryable`, `failed_terminal`, `awaiting_admin`. No `awaiting_claim` yet (M5 introduces it).

### 1.3 Database backup

- [ ] Database backup taken immediately before applying migration 57.

```bash
# Adjust to your backup tool of choice (pg_dump, Supabase point-in-time, etc.)
pg_dump "$STAGING_DATABASE_URL" -Fc -f /tmp/robinos-pre-migration-57.dump
```

---

## 2. Automated Test Suite

M5 ships with two automated test suites:

### 2.1 Vitest unit tests

**Location:** `src/test/milestone-5.test.ts`

**Run:**
```bash
npm test -- src/test/milestone-5.test.ts
```

**Expected:** All tests pass.

**Coverage:**
- [ ] Action classifier: `verified`, `awaiting_claim`, `failed_terminal`, `failed_retryable`, null, unknown — 6 tests
- [ ] Raw payload extraction: WarriorPlus uppercase keys — 1 test
- [ ] Raw payload extraction: lowercase canonical keys — 1 test
- [ ] Raw payload extraction: key precedence — 1 test
- [ ] Raw payload extraction: missing email — 1 test
- [ ] Raw payload extraction: null payload — 1 test
- [ ] Raw payload extraction: empty-string fields — 1 test
- [ ] Raw payload extraction: non-string values — 1 test
- [ ] Email normalization: lowercasing — 1 test
- [ ] Email normalization: trimming — 1 test
- [ ] Email normalization: + aliases — 1 test
- [ ] Email normalization: null/empty input — 1 test
- [ ] Email hash: 64-char hex SHA-256 — 1 test
- [ ] Email hash: stability — 1 test
- [ ] Email hash: normalized input — 1 test
- [ ] Email hash: distinct inputs — 1 test
- [ ] State transitions: existing user — 1 test
- [ ] State transitions: guest — 1 test
- [ ] State transitions: ambiguous match — 1 test
- [ ] Idempotency: classifier — 1 test
- [ ] Idempotency: normalization — 1 test
- [ ] Idempotency: extraction — 1 test

**Total: 22 unit tests.**

### 2.2 SQL integration tests

**Location:** `scripts/sql/milestone-5-integration-tests.sql`

**Run:**
```bash
psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-5-integration-tests.sql
```

**Expected output (last lines):**
```
═══════════════════════════════════════════════════════════
  MILESTONE 5 — ALL TESTS PASSED
═══════════════════════════════════════════════════════════
```

**Coverage:**
- [ ] **Test 1**: Schema columns + indexes present (4 columns, 2 indexes)
- [ ] **Test 2**: `resolve_or_create_user_from_purchase` — existing user by email (case-insensitive, whitespace-trimmed)
- [ ] **Test 3**: `resolve_or_create_user_from_purchase` — guest path (no match → `marked_guest_awaiting_claim`, no auth.users row created)
- [ ] **Test 4**: `resolve_or_create_user_from_purchase` — ambiguous match → `resolution_failed` (no silent merge)
- [ ] **Test 5**: Error paths (null/empty email, missing provider) all raise correctly
- [ ] **Test 6**: `process_webhook_event` — existing user full pipeline → `verified` with `linked_user_id`
- [ ] **Test 7**: `process_webhook_event` — guest full pipeline → `awaiting_claim` (no user created)
- [ ] **Test 8**: `process_webhook_event` — malformed payload → `failed_terminal` (atomicity preserved)
- [ ] **Test 9**: Idempotency — re-processing verified row returns null
- [ ] **Test 10**: Retry safety — `failed_retryable` row recovers on retry
- [ ] **Test 11**: Security — M5 is read-only against `auth.users` (count unchanged)
- [ ] **Test 12**: Cleanup (test rows removed)

**Total: 12 integration tests.**

### 2.3 Lint and build

```bash
npm run lint
npm run build
```

**Expected:**
- [ ] Lint passes with no new warnings or errors
- [ ] Build completes successfully

---

## 3. Operator Test Plan (Manual Staging Verification)

Run these AFTER automated tests pass. Each scenario exercises one specific M5 contract end-to-end.

### 3.1 Scenario: Existing user purchase (happy path)

**Setup:**
1. Identify or create an `auth.users` row in staging:
   ```sql
   select id, email from auth.users
   where deleted_at is null
   order by created_at desc
   limit 1;
   ```
   Note the `email` value (e.g., `existing-buyer@example.com`).
2. Send a real (or simulated) WarriorPlus IPN with `WP_BUYER_EMAIL=existing-buyer@example.com`.

**Verify:**
- [ ] HTTP 200 from `payment-webhook` (existing M3 behavior)
- [ ] Row appears in `webhook_events` with `status='received'`
- [ ] Within 5 minutes (cron cadence), row transitions to `status='verified'`
- [ ] `linked_user_id` matches the `auth.users.id` you identified
- [ ] `resolution_outcome='resolved_existing_user'`
- [ ] `resolution_buyer_email_hash` is SHA-256(lower(email))
- [ ] `provider_customer_id` is NULL (WarriorPlus doesn't send one)
- [ ] Worker log shows `WORKER_ROW_VERIFIED` with `resolution_outcome=resolved_existing_user` and `linked_user_id=<uuid>`

### 3.2 Scenario: Guest purchase (new buyer)

**Setup:**
1. Pick an email that does NOT exist in `auth.users` (e.g., `totally-new-buyer-{{timestamp}}@example.com`).
2. Send a real (or simulated) WarriorPlus IPN with that email.

**Verify:**
- [ ] HTTP 200 from `payment-webhook`
- [ ] Row transitions to `status='awaiting_claim'`
- [ ] `linked_user_id` is NULL
- [ ] `resolution_outcome='marked_guest_awaiting_claim'`
- [ ] `resolution_buyer_email_hash` is SHA-256(lower(email))
- [ ] NO new row appears in `auth.users` (M5 must not create accounts)
- [ ] Worker log shows `WORKER_ROW_AWAITING_CLAIM`

### 3.3 Scenario: Email case insensitivity

**Setup:**
1. Take an existing user's email (e.g., `MixedCase@Example.COM` in DB).
2. Send a webhook with `WP_BUYER_EMAIL=mixedcase@example.com`.

**Verify:**
- [ ] Resolution succeeds and matches the existing user
- [ ] `resolution_buyer_email_hash` equals SHA-256 of the normalized (lowercase) email

### 3.4 Scenario: Email whitespace tolerance

**Setup:**
1. Send a webhook with `WP_BUYER_EMAIL="  buyer@example.com  "` (leading/trailing whitespace).

**Verify:**
- [ ] Resolution succeeds (whitespace is trimmed)
- [ ] `resolution_buyer_email_hash` equals SHA-256 of the trimmed/lowercased email

### 3.5 Scenario: Ambiguous match (security guard)

**Setup:**
1. Manually create two `auth.users` rows with the same email (different case):
   ```sql
   -- DO NOT run this in production. Staging only.
   insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
   values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'ambiguous@example.com', '', now(), '{}', '{}', now(), now(), '', '', '', '');

   insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
   values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'AMBIGUOUS@example.com', '', now(), '{}', '{}', now(), now(), '', '', '', '');
   ```
2. Send a webhook with `WP_BUYER_EMAIL=ambiguous@example.com`.

**Verify:**
- [ ] Row transitions to `status='failed_terminal'`
- [ ] `last_error` contains `resolution_failed: ambiguous_match (match_count=2)`
- [ ] NO user_id is silently picked (the `linked_user_id` is NULL)
- [ ] Worker log shows `WORKER_ROW_FAILED_TERMINAL` with `classification=resolution`
- [ ] After resolving the duplicate (e.g., delete one row), calling `retry_webhook_event` recovers the row

### 3.6 Scenario: Malformed payload (missing buyer_email)

**Setup:**
1. Send a webhook with all required WarriorPlus fields EXCEPT `WP_BUYER_EMAIL`.

**Verify:**
- [ ] Row transitions to `status='failed_terminal'`
- [ ] `last_error` contains `missing_buyer_email_field`
- [ ] `classification='validation'`
- [ ] `resolution_outcome` is NULL (resolution never ran)
- [ ] `linked_user_id` is NULL
- [ ] Worker log shows `WORKER_ROW_FAILED_TERMINAL` with `classification=validation`

### 3.7 Scenario: Transient failure → retry → success

**Setup:**
1. Simulate a transient DB error during resolution (e.g., briefly lock `auth.users` from another session):
   ```sql
   -- Session A: lock auth.users to simulate contention
   begin;
   lock table auth.users in access exclusive mode;
   -- (then immediately commit in another session)
   ```
2. Send a webhook during the lock window.

**Verify:**
- [ ] First attempt: row transitions to `status='failed_retryable'` with `next_retry_at` set
- [ ] After lock releases, next worker tick: row recovers and transitions to `verified` or `awaiting_claim`
- [ ] `retry_count` increments by 1 per failed attempt

### 3.8 Scenario: Idempotency under repeated invocation

**Setup:**
1. Process a webhook to resolution (status `verified` or `awaiting_claim`).
2. Manually call `process_webhook_event(<event_id>)` again.

**Verify:**
- [ ] Returns `null` (row is no longer claimable)
- [ ] Row state is unchanged (no duplicate side-effects)

### 3.9 Scenario: Health endpoint includes M5 metrics

**Setup:**
1. Send 5 webhooks (mix of existing-user and guest).
2. Wait for worker to process.
3. Call the health endpoint.

**Verify:**
```bash
curl -X POST 'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker?action=health' | jq .
```

- [ ] `verified_count` includes the resolved-existing-user rows
- [ ] No explicit `awaiting_claim_count` in health endpoint (it reports `verified_count` which is the M4 set; awaiting_claim rows are tracked separately by status)

**Note:** The M5 queue-health metric `awaiting_claim_count` is available via direct SQL:
```sql
select count(*) from public.webhook_events where status = 'awaiting_claim';
```

A future enhancement could add `awaiting_claim_count` to `get_webhook_queue_stats`; this is M9 scope (since M9 is the primary consumer of that queue).

---

## 4. Acceptance Criteria (M5 Spec Verification)

These map directly to the verification requirements in the M5 spec.

### 4.1 Build passes

- [ ] `npm run build` exits 0
- [ ] `npm run lint` exits 0 with no new errors
- [ ] No TypeScript errors in `supabase/functions/process-webhook-worker/index.ts`

### 4.2 Existing functionality remains unaffected

- [ ] M3 receiver (`payment-webhook`) still returns 200 to valid webhooks
- [ ] M4 worker still processes rows from `received` to `verified`
- [ ] M4 retry mechanism (`schedule_webhook_retry`, `mark_webhook_dead_letter`) still works
- [ ] All M1 RPCs (`enqueue_webhook_event`, `retry_webhook_event`, `search_webhook_events`, etc.) still work
- [ ] All M2 admin RPCs (payment provider management) still work

### 4.3 Idempotency is preserved

- [ ] Re-processing a `verified` row returns null (no double-execution)
- [ ] Re-processing an `awaiting_claim` row returns null
- [ ] Re-processing a `failed_terminal` row returns null unless `retry_webhook_event` is called
- [ ] Re-running `resolve_or_create_user_from_purchase` with the same input returns the same output (read-only against `auth.users`)

### 4.4 Retry behavior continues to work correctly

- [ ] Transient errors during M5 resolution transition the row to `failed_retryable` (not `failed_terminal`)
- [ ] `next_retry_at` is set with exponential backoff + jitter (1m, 5m, 30m, 2h, 12h)
- [ ] After `max_retries` exhausted, the row transitions to `failed_terminal`
- [ ] Worker reclaims and re-processes the row when `next_retry_at` is due
- [ ] Stale locks (>5 min) are recovered by the next worker tick

### 4.5 Guest buyers transition to `awaiting_claim`

- [ ] Webhook with no matching `auth.users` email transitions to `status='awaiting_claim'`
- [ ] `resolution_outcome='marked_guest_awaiting_claim'`
- [ ] `linked_user_id` is NULL
- [ ] NO new `auth.users` row is created (M5 never creates accounts)
- [ ] `resolution_buyer_email_hash` is set (so M9 can find this row by email hash later)

### 4.6 Existing RobinOS users resolve successfully

- [ ] Webhook with matching `auth.users` email (case-insensitive, whitespace-trimmed) transitions to `status='verified'`
- [ ] `linked_user_id` is set to the matched user's `id`
- [ ] `resolution_outcome='resolved_existing_user'`
- [ ] `resolution_attempted_at` is populated
- [ ] `resolution_buyer_email_hash` is set

### 4.7 The worker hands off cleanly to Milestone 6

- [ ] Rows with `status='verified'` AND `linked_user_id IS NOT NULL` are ready for M6 (purchase creation)
- [ ] Rows with `status='awaiting_claim'` are NOT ready for M6 (they bypass M6 until M9 claims them)
- [ ] M5 does NOT create any rows in `public.payments` (verified by `select count(*) from payments where source_webhook_event_id is not null;` returning 0 after M5-only deployment)
- [ ] M5 does NOT modify `public.profiles` (verified by no `UPDATE profiles` SQL in migration 57)
- [ ] M5 does NOT modify `public.user_subscriptions` (verified by no `UPDATE user_subscriptions` SQL in migration 57)

### 4.8 Security

- [ ] `auth.users` row count is unchanged before vs. after M5 processing (M5 is read-only on auth.users)
- [ ] Ambiguous matches are dead-lettered, NEVER silently merged
- [ ] Webhook signature verification (M3) still gates M5 — there is no path where M5 is reachable without M3's signature check
- [ ] `resolution_buyer_email_hash` is the ONLY buyer-identity field persisted; raw emails are NOT logged, NOT written to plaintext columns, NOT included in any log output

---

## 5. Sign-Off

Before promoting M5 to production, ALL of the following must be true:

- [ ] All 22 Vitest unit tests pass
- [ ] All 12 SQL integration tests pass
- [ ] `npm run build` and `npm run lint` succeed
- [ ] All 9 operator scenarios in §3 pass
- [ ] All 8 acceptance criteria in §4 pass
- [ ] Rollback script reviewed and understood by at least one operator
- [ ] Monitoring/alerting rules from the rollout runbook §7.2 are configured

Once all items are checked, M5 is ready for production promotion. Follow `.kimchi/docs/milestone-5-rollout-runbook.md` §8 for the production deployment procedure.

---

## 6. Test Maintenance

### 6.1 Adding new tests

When extending M5 (e.g., new resolution strategies, new providers):
- Add unit tests to `src/test/milestone-5.test.ts` for any new pure logic.
- Add integration tests to `scripts/sql/milestone-5-integration-tests.sql` for any new RPC behavior.
- Update this checklist with new operator scenarios.

### 6.2 Flaky test triage

The Vitest tests are pure JS — no flakiness expected. If they fail intermittently, suspect:
- Environment-specific JS engine quirks (e.g., V8 update changing sort order).
- Test isolation issues (unlikely given the design — no shared state).

The SQL integration tests require a clean staging database. If they fail:
- Verify the cleanup block at the end of the previous run completed.
- Check for stale `auth.users` test rows from prior interrupted runs:
  ```sql
  select id, email from auth.users where email like 'm5-%@example.com';
  ```
- Manually clean up if needed:
  ```sql
  delete from auth.users where email like 'm5-%@example.com';
  delete from webhook_events where provider_event_id like 'M5_TEST_%';
  ```

### 6.3 Test coverage gaps (intentional)

The following are NOT tested in M5 because they belong to other milestones:
- M6: purchase row creation, entitlement grant
- M7/M8: refund, dispute
- M9: account creation, claim flow
- M10: affiliate commissions
- M11: admin diagnostics UI

These will get their own test suites when those milestones ship.
