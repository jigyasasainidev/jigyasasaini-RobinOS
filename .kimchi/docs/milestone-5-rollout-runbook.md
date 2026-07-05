# Milestone 5 — User Resolution Production Runbook

**Status:** Implementation complete. Operator-facing guide.
**Companion to:**
- `.kimchi/docs/milestone-5-architecture-review.md` (design justification)
- `.kimchi/docs/milestone-5-testing-checklist.md` (operator + automated tests)
- `.kimchi/docs/milestone-4-worker-runbook.md` (predecessor; M5 builds on it)

This runbook covers deployment, operational procedures, monitoring, and rollback for the M5 user-resolution layer. M5 takes rows that the M4 worker has transitioned to `verified` and resolves the buyer identity to either an existing `auth.users` row (→ `verified` with `linked_user_id` set) or a guest marker (→ `awaiting_claim`). M5 does NOT create purchases, subscriptions, or entitlements — that work belongs to M6.

---

## 1. What M5 Changes

| Surface | Before M5 | After M5 |
|---|---|---|
| `webhook_events.status` flow | `received → processing → verified` | `received → processing → verified` (existing user) **or** `awaiting_claim` (guest) |
| `webhook_events.linked_user_id` | Always NULL | Set when buyer email matches an `auth.users` row |
| `webhook_events.resolution_*` columns | Absent | 4 new columns: `provider_customer_id`, `resolution_attempted_at`, `resolution_outcome`, `resolution_buyer_email_hash` |
| `resolve_or_create_user_from_purchase` | M1 stub (raises exception) | Real M5 implementation |
| `process_webhook_event` body | M4: validate + transition to `verified` | M4+M5: validate + resolve + transition |
| Worker TS (`process-webhook-worker`) | M4: 3 action branches | M4+M5: 4 action branches (added `awaiting_claim`) |

---

## 2. Pre-Deployment Checklist

Before deploying M5, confirm:

- [ ] Migrations 51–56 are applied (M1–M4 complete).
- [ ] Migration 53's stub for `resolve_or_create_user_from_purchase` is still in place (it gets replaced by M5).
- [ ] Migration 56's `process_webhook_event` implementation is in place (M5 replaces it).
- [ ] `webhook_events` table has no rows in unexpected states:
  ```sql
  select status, count(*) from public.webhook_events group by status;
  ```
  Healthy pre-M5 state: only `received`, `verified`, `processing`, `failed_retryable`, `failed_terminal`, `awaiting_admin` (no `awaiting_claim` yet, since M5 introduces that transition).
- [ ] `auth.users` table is in a known state (no duplicates, no NULL emails on active accounts):
  ```sql
  select count(*) from auth.users
  where email is not null and deleted_at is null
    and lower(email) in (
      select lower(email) from auth.users
      where email is not null and deleted_at is null
      group by lower(email) having count(*) > 1
    );
  ```
  Expected: 0. If non-zero, resolve the duplicates before deploying M5 (ambiguous matches dead-letter).
- [ ] M4 worker is running and the cron job (`webhook-worker-5min`) is active.
- [ ] Local Supabase CLI is logged in (`supabase status` succeeds).
- [ ] Database backup taken immediately before applying migration 57.

If any of the above is incomplete, **stop and resolve before proceeding**.

---

## 3. Apply Migration 57

```bash
supabase db push --db-url <staging-url> --include-only 57
```

**Expected output:**
- Migration applies without error.
- 4 new columns on `webhook_events`.
- 2 new indexes on `webhook_events`.
- 2 functions replaced: `resolve_or_create_user_from_purchase`, `process_webhook_event`.

**Verify the schema additions:**
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='webhook_events'
  and column_name in (
    'provider_customer_id',
    'resolution_attempted_at',
    'resolution_outcome',
    'resolution_buyer_email_hash'
  )
order by column_name;
```

- [ ] All 4 columns exist
- [ ] `provider_customer_id`, `resolution_attempted_at`, `resolution_outcome`, `resolution_buyer_email_hash` are all `YES` nullable

**Verify the indexes:**
```sql
select indexname from pg_indexes
where schemaname='public' and tablename='webhook_events'
  and indexname in (
    'idx_webhook_events_resolution_outcome',
    'idx_webhook_events_resolution_email_hash'
  );
```

- [ ] Both indexes exist

**Verify the RPC signatures:**
```sql
select proname, prosecdef, proconfig
from pg_proc
where proname in (
  'resolve_or_create_user_from_purchase',
  'process_webhook_event'
)
order by proname;
```

- [ ] Both are `prosecdef = true` (SECURITY DEFINER)
- [ ] Both have `proconfig` containing `'search_path=public'`
- [ ] Both are granted to `service_role` only (NOT `anon` or `authenticated`)

---

## 4. Deploy the Worker

The M5 changes to the worker are limited to a new `awaiting_claim` action branch in `process-webhook-worker/index.ts`. Deploy:

```bash
supabase functions deploy process-webhook-worker --project-ref <staging-ref>
```

**Verify:**
- [ ] Deploy succeeds
- [ ] Function URL unchanged: `https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker`

---

## 5. First-Run Verification

Before wiring up changes to monitoring, manually invoke the worker once to confirm M5 works end-to-end.

### 5.1 Run the SQL integration tests

```bash
psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-5-integration-tests.sql
```

**Expected output:** 11 PASS messages + 1 PASS for the cleanup summary + a final banner "MILESTONE 5 — ALL TESTS PASSED".

**Verify:**
- [ ] All 11 test sections print `PASS`
- [ ] No `FAIL` lines
- [ ] The cleanup block runs without error

### 5.2 Seed a few real webhook events

Use the M4 simulation script to seed events with both existing-user and guest emails:
```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>" \
  node scripts/test-webhook-worker.cjs seed --count 5
```

For M5 verification, ensure at least 2 of the seeded events use the email of an existing `auth.users` row (existing-user path) and at least 2 use a fresh email (guest path).

### 5.3 Invoke the worker

```bash
curl -X POST 'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker'
```

**Expected response (HTTP 200):**
```json
{
  "worker_id": "<uuid>",
  "batch_size_requested": 50,
  "max_runtime_ms": 25000,
  "started_at": "...",
  "finished_at": "...",
  "elapsed_ms": <small>,
  "timed_out": false,
  "iterations": 5,
  "processed_count": <N>,            // existing-user resolutions
  "awaiting_claim_count": <M>,        // M5 NEW: guest resolutions
  "failed_terminal_count": 0,
  "failed_retryable_count": 0,
  "no_op_count": 0,
  "queue_empty_at_iteration": 5,
  "rpc_failure": null
}
```

**Verify:**
- [ ] `processed_count + awaiting_claim_count + failed_terminal_count + failed_retryable_count + no_op_count = iterations`
- [ ] At least 1 row in `processed_count` (existing-user resolution) if you seeded with a known email
- [ ] At least 1 row in `awaiting_claim_count` (guest resolution) if you seeded with a fresh email
- [ ] `failed_terminal_count = 0` (no malformed payloads in this seed)
- [ ] `failed_retryable_count = 0`

### 5.4 Confirm row transitions

```sql
-- Distribution of M5 outcomes for the seeded rows
select
  status,
  resolution_outcome,
  count(*)
from public.webhook_events
where provider_event_id like 'TEST_M4_%'  -- or whatever prefix the seeder uses
group by status, resolution_outcome
order by status;
```

Expected:
- [ ] Some rows at `status='verified'` with `resolution_outcome='resolved_existing_user'`
- [ ] Some rows at `status='awaiting_claim'` with `resolution_outcome='marked_guest_awaiting_claim'`
- [ ] All seeded rows have `resolution_attempted_at` populated
- [ ] All seeded rows have `resolution_buyer_email_hash` populated (NOT NULL)
- [ ] No rows at `status='failed_terminal'` (unless you intentionally seeded malformed ones)

### 5.5 Test the health endpoint

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  node scripts/test-webhook-worker.cjs health
```

- [ ] HTTP 200
- [ ] JSON returned with all expected fields
- [ ] `queue_depth = 0` (all test rows drained)

### 5.6 Inspect a single resolved row

```sql
select
  id,
  status,
  resolution_outcome,
  linked_user_id,
  resolution_attempted_at,
  provider_customer_id,
  resolution_buyer_email_hash
from public.webhook_events
where resolution_outcome = 'resolved_existing_user'
limit 1;
```

**Verify:**
- [ ] `linked_user_id` matches the `auth.users` row you expected (if seeding with a known email)
- [ ] `resolution_attempted_at` is recent (within last few minutes)
- [ ] `resolution_buyer_email_hash` is a 64-char hex string (SHA-256)
- [ ] `provider_customer_id` is NULL (WarriorPlus doesn't send one)

### 5.7 Clean up

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  node scripts/test-webhook-worker.cjs clear
```

---

## 6. M5 Operational Procedures

### 6.1 Reading M5-specific queue health

**Resolution outcome distribution (last 24 hours):**
```sql
select
  resolution_outcome,
  count(*),
  avg(extract(epoch from (now() - resolution_attempted_at))) as avg_age_seconds
from public.webhook_events
where resolution_attempted_at > now() - interval '24 hours'
group by resolution_outcome
order by resolution_outcome;
```

Expected distribution in healthy state:
- `resolved_existing_user`: majority (most buyers are existing users)
- `marked_guest_awaiting_claim`: minority (M9 will eventually claim these)
- `resolution_failed`: 0 or near-zero (ambiguous matches should be rare)

**Guest claim backlog (M9 input):**
```sql
select count(*) as guest_backlog
from public.webhook_events
where status = 'awaiting_claim';
```

Healthy: small (each guest eventually claims via M9 or stays as a guest pending). Watch for growth.

**Admin intervention queue (resolution failures):**
```sql
select id, last_error, received_at, provider_id
from public.webhook_events
where resolution_outcome = 'resolution_failed'
order by received_at desc
limit 50;
```

**Each row requires manual review via M11 diagnostics.** Ambiguous matches indicate duplicate `auth.users` rows — investigate via:
```sql
-- Find the duplicate auth.users rows
select id, email, created_at
from auth.users
where lower(email) in (
  select lower(email) from auth.users
  where email is not null and deleted_at is null
  group by lower(email) having count(*) > 1
)
order by lower(email), created_at;
```

### 6.2 Inspecting a single resolution

For any row in `verified` or `awaiting_claim` status:

```sql
select
  we.id,
  we.status,
  we.resolution_outcome,
  we.resolution_attempted_at,
  we.linked_user_id,
  au.email as resolved_user_email,
  we.provider_customer_id,
  we.resolution_buyer_email_hash,
  encode(digest(we.resolution_buyer_email_hash, 'sha256'), 'hex') as rehash_check
from public.webhook_events we
left join auth.users au on au.id = we.linked_user_id
where we.id = '<event_id>';
```

**Decoding the buyer email from the hash:**
```sql
-- admin search: "show me all webhooks for buyer@example.com"
select id, status, resolution_outcome, linked_user_id
from public.webhook_events
where resolution_buyer_email_hash = encode(digest('buyer@example.com', 'sha256'), 'hex');
```

### 6.3 Manually retrying a failed row

If a row is in `failed_terminal` due to `resolution_failed: ambiguous_match`, you can retry after resolving the duplicate:

1. Identify and merge the duplicate `auth.users` rows (manual SQL, not in M5 scope).
2. `select public.retry_webhook_event('<event_id>');`  -- resets the row to `status='received'`.
3. The next worker tick re-runs validation + resolution.
4. Verify the resolution succeeds:
   ```sql
   select status, resolution_outcome, linked_user_id
   from public.webhook_events where id = '<event_id>';
   ```

### 6.4 What M5 does NOT do (escalation guidance)

If an admin or operator needs:
- **Account creation from a guest purchase** → that's M9, not M5. M5 only marks `awaiting_claim`.
- **Entitlement granting** → M6, not M5.
- **Refund / dispute handling** → M7/M8, not M5.

Do NOT ask the M5 worker to perform these. The worker is intentionally limited to identity resolution.

---

## 7. Monitoring and Alerting

### 7.1 Key metrics to track

| Metric | Query | Healthy range |
|---|---|---|
| M5 success rate | `select count(*) where resolution_outcome in ('resolved_existing_user', 'marked_guest_awaiting_claim') and resolution_attempted_at > now() - interval '1 day'` / total | > 99% |
| Guest backlog growth | `select count(*) from webhook_events where status='awaiting_claim'` (over time) | Flat or slow growth; rapid growth = M9 not keeping up |
| Resolution failures (24h) | `select count(*) from webhook_events where resolution_outcome='resolution_failed' and resolution_attempted_at > now() - interval '1 day'` | 0 or known low count |
| M5 latency (p99) | `select extract(epoch from (resolution_attempted_at - verified_at)) from webhook_events where resolution_attempted_at is not null order by 1 desc limit 100` | < 1s |
| `awaiting_claim` stale rows | `select count(*) from webhook_events where status='awaiting_claim' and received_at < now() - interval '7 days'` | 0 (M9 should claim or admin should investigate) |

### 7.2 Suggested alerts

| Condition | Severity | Action |
|---|---|---|
| `resolution_failed` count > 0 in last hour | Page admin | Investigate duplicates; expected near-zero |
| Guest backlog grows by > 50/hour | Warn | Check M9 cron / claim flow health |
| M5 latency p99 > 5s for > 15 min | Warn | Check DB performance; auth.users query may be slow |
| `awaiting_claim` stale (received > 7 days) > 10 | Page admin | These buyers never claimed; admin outreach needed |

### 7.3 Logging

Worker logs flow through Supabase Edge Function Logs. M5 adds these new log events:

| Event | When emitted | Fields |
|---|---|---|
| `WORKER_ROW_AWAITING_CLAIM` | M5 resolved a guest buyer | `webhook_event_id`, `provider_id`, `trace_id`, `lock_id`, `provider_event_type`, `standardized_event_type`, `event_mapping_confidence`, `resolution_outcome` |
| `WORKER_ROW_VERIFIED` (extended) | M4+M5 resolved an existing user | Same as M4 + `resolution_outcome`, `linked_user_id` (when present) |

Existing M4 events (`WORKER_START`, `WORKER_DONE`, `WORKER_HEARTBEAT`, `WORKER_ROW_FAILED_TERMINAL`, `WORKER_ROW_RETRY_SCHEDULED`, `WORKER_QUEUE_EMPTY`) continue to fire unchanged.

To query M5 logs:
```bash
supabase functions logs process-webhook-worker --project-ref <ref> | grep -E 'AWAITING_CLAIM|resolution_outcome'
```

---

## 8. Rollback Procedures

### 8.1 When to roll back

Consider rollback if:
- M5 dead-letters all incoming webhooks (e.g., resolution always returns `ambiguous_match` due to a data corruption issue).
- M5 latency exceeds 5s p99 and is starving the worker.
- The worker enters an error loop after deploying M5 (rare; would show up as `WORKER_RPC_FAILED` repeatedly).

### 8.2 Standard rollback (recommended)

The rollback section at the bottom of `supabase/migrations/57_user_resolution.sql` restores the M4 implementation of `process_webhook_event` and the M1 stub of `resolve_or_create_user_from_purchase`. After this rollback:

- The M4 worker resumes the M4 behavior: rows transition `received → processing → verified` without any M5 resolution step.
- Resolution outcome columns on `webhook_events` become inert (no code writes to them) but remain queryable.
- Rows already in `status='awaiting_claim'` (set during the M5 lifetime) stay in that state. **They are NOT moved back to `verified`** because that would lose information about which rows M5 classified as guests.

**Apply:**
```bash
psql "$STAGING_DATABASE_URL" -c "$(awk '/^\/\*$/,/^\*\/$/{print}' supabase/migrations/57_user_resolution.sql | sed '1d;$d')"
```

Or paste the rollback block (between the comment markers) into a psql session.

**After rollback, also redeploy the worker with the M4 code:**
```bash
git checkout <m4-commit> -- supabase/functions/process-webhook-worker/index.ts
supabase functions deploy process-webhook-worker --project-ref <ref>
```

### 8.3 Data integrity check after rollback

```sql
select status, count(*) from public.webhook_events group by status;
```

Compare to pre-rollback state. The only expected changes:
- New rows after rollback will land at `verified` (M4 behavior), NOT `awaiting_claim`.
- Existing `awaiting_claim` rows remain.
- Existing `resolution_*` column values remain unchanged (inert).

### 8.4 Full rollback (drops the 4 new columns too)

Only run if you need to fully reverse M5 schema changes. This drops any resolution outcome data accumulated during the M5 lifetime.

**WARNING:** Take a database backup before running.

The optional FULL ROLLBACK section at the bottom of `57_user_resolution.sql` (inside the inner comment block) does this:
1. Applies the standard rollback (restores M4 RPCs).
2. Drops the 2 new indexes.
3. Drops the 4 new columns.

After full rollback, the schema is identical to pre-M5 state. All M5 data is lost.

### 8.5 Re-running after rollback

1. Identify the root cause of the rollback (DB performance? data corruption? auth.users duplicate?).
2. Fix the root cause.
3. Re-apply migration 57.
4. Re-deploy the worker (M5 version).
5. Manually trigger a worker tick to verify.
6. Resume the cron schedule.

---

## 9. Common Issues

### 9.1 All rows going to `failed_terminal` with `resolution_failed: ambiguous_match`

**Symptom:** Every webhook for a specific buyer is dead-lettered.

**Diagnosis:**
```sql
select lower(email), count(*)
from auth.users
where email is not null and deleted_at is null
group by lower(email)
having count(*) > 1;
```

**Cause:** Two or more `auth.users` rows share the same email (case-insensitive). M5 deliberately refuses to silently merge.

**Fix:**
1. Identify the legitimate account (usually the older one with verified email).
2. Either delete the duplicate OR change its email (e.g., `+stale@example.com` suffix).
3. `select public.retry_webhook_event('<event_id>');` for the affected rows.
4. Worker re-processes successfully.

**Prevention:** Investigate how the duplicates were created (manual SQL import? admin tooling bug?) and fix the upstream cause.

### 9.2 All rows going to `failed_terminal` with `missing_buyer_email_field`

**Symptom:** Every webhook is dead-lettered with this exact error.

**Diagnosis:**
```sql
select id, raw_payload, last_error
from public.webhook_events
where last_error like '%missing_buyer_email_field%'
order by received_at desc
limit 5;
```

**Cause:** The provider is sending webhooks without a buyer email field. Either:
1. The provider changed their IPN format.
2. The dispatcher / adapter is stripping the field.

**Fix:**
1. Inspect `raw_payload` for the missing field. Does it have any email-like key (e.g., `email`, `EMAIL`, `customer_email`)?
2. If yes, update `process_webhook_event` step 3c to also check that key (see migration 57 §3c for the current lookup pattern).
3. If no, the provider is genuinely not sending email; this is a provider-side issue requiring their support.

### 9.3 M5 latency spikes

**Symptom:** `resolution_attempted_at - verified_at` exceeds 5s p99.

**Diagnosis:**
```sql
-- Resolution latency percentiles (last 1000 rows)
with latencies as (
  select
    extract(epoch from (resolution_attempted_at - coalesce(verified_at, processing_started_at))) * 1000 as latency_ms
  from public.webhook_events
  where resolution_attempted_at is not null
  order by resolution_attempted_at desc
  limit 1000
)
select
  percentile_cont(0.50) within group (order by latency_ms) as p50_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
  percentile_cont(0.99) within group (order by latency_ms) as p99_ms
from latencies;
```

**Cause:** Likely auth.users query is slow. Check:
- `auth.users` table size and index health: `select count(*) from auth.users;`
- DB CPU/memory: Supabase dashboard → Database → Metrics.
- Lock contention: `select * from pg_stat_activity where state='active';`

**Fix:** If `auth.users` is genuinely large (> 1M rows), consider adding a functional index:
```sql
create index concurrently if not exists idx_auth_users_email_lower
  on auth.users (lower(email))
  where email is not null and deleted_at is null;
```
Note: this requires superuser; may not be available in hosted Supabase. Coordinate with Supabase support if needed.

### 9.4 Worker returns `WORKER_ROW_UNKNOWN_ACTION` for `awaiting_claim`

**Symptom:** Worker logs show `WORKER_ROW_UNKNOWN_ACTION` instead of `WORKER_ROW_AWAITING_CLAIM`, and `no_op_count` is high.

**Cause:** The TS worker wasn't redeployed with the M5 changes, or the deploy picked up a stale build.

**Fix:**
```bash
git status
git log --oneline -5  # verify the M5 commit is HEAD
supabase functions deploy process-webhook-worker --project-ref <ref> --no-verify-jwt
```

Verify the deployed version has the `awaiting_claim` branch:
```bash
curl -s -X POST 'https://<ref>.supabase.co/functions/v1/process-webhook-worker?action=health' | jq .
# ... then check Edge Function logs for WORKER_ROW_AWAITING_CLAIM
```

### 9.5 `awaiting_claim` rows accumulating

**Symptom:** Guest backlog grows over time without being claimed.

**Cause:** M9 (claim flow) is not yet implemented or is failing.

**Fix (interim):**
1. Verify M9 cron / claim flow is active (not in M5 scope; check M9 docs).
2. For rows older than 30 days with no claim activity, consider reaching out to buyers via your normal support channel.
3. M5 itself does NOT expire `awaiting_claim` rows — that's M9's responsibility.

---

## 10. Performance and Scaling

### 10.1 Single-worker M5 overhead

Per-row M5 cost on top of M4:
- 1 SQL query against `auth.users` (lowercased email lookup).
- 4 column updates on `webhook_events`.
- 1 SHA-256 computation (already done by M4 for payload hash; M5 reuses the email hash).

Estimated overhead: ~5-20ms per row. M4 baseline was ~50ms; M5 brings it to ~60-70ms.

### 10.2 Indexes

M5 adds 2 indexes on `webhook_events`:
- `idx_webhook_events_resolution_outcome` (partial, on `resolution_outcome IS NOT NULL`).
- `idx_webhook_events_resolution_email_hash` (partial, on `resolution_buyer_email_hash IS NOT NULL`).

Both are partial indexes, so they cost minimal storage for the typical case (most rows have NULL resolution columns until M5 runs).

`auth.users` queries use the existing `auth.users_email_key` UNIQUE index on `email`. For case-insensitive lookups via `lower(email)`, Supabase's hosted Postgres may not have a functional index on `lower(email)`. If M5 latency becomes a problem at scale, coordinate with Supabase support to add one.

### 10.3 Concurrency

M5 inherits M4's `FOR UPDATE SKIP LOCKED` concurrency safety. Multiple worker invocations cannot claim the same row, and resolution is atomic (validation + resolution + status transition all in one transaction).

---

## 11. Change Log

| Date | Change | Operator |
|---|---|---|
| YYYY-MM-DD | Initial rollout to staging | <name> |
| YYYY-MM-DD | Promoted to production | <name> |

---

## 12. References

- Architecture review: `.kimchi/docs/milestone-5-architecture-review.md`
- Migration: `supabase/migrations/57_user_resolution.sql`
- SQL integration tests: `scripts/sql/milestone-5-integration-tests.sql`
- Vitest tests: `src/test/milestone-5.test.ts`
- Worker: `supabase/functions/process-webhook-worker/index.ts`
- Predecessor: `.kimchi/docs/milestone-4-worker-runbook.md`
