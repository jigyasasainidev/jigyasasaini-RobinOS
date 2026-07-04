# Milestone 4 — Worker Runbook

**Status:** Implementation complete. Operator-facing guide.
**Companion to:** `.kimchi/docs/milestone-3-rollout-runbook.md`, `.kimchi/docs/milestone-4-testing-checklist.md`.

This runbook covers deployment, cron integration, and operational procedures for the M4 async webhook worker. The worker drains the `webhook_events` queue populated by the M3 receiver and transitions rows to `verified` (the M5+ handoff point).

---

## 1. Pre-Deployment Checklist

Before deploying M4, confirm:

- [ ] Migrations 51–55 are applied (M1, M2, M3).
- [ ] Migration 53 stubs `process_webhook_event` and `process_pending_webhook_events` are present and currently raise `'not yet implemented (scheduled for Milestone 4)'`.
- [ ] `webhook_events` table exists with all required columns.
- [ ] `payment_providers` table has at least one enabled row.
- [ ] M3 `payment-webhook` function is deployed and receiving events.
- [ ] Local Supabase CLI is logged in (`supabase status` succeeds).
- [ ] Database backup taken immediately before applying migration 56.

If any of the above is incomplete, **stop and resolve before proceeding**.

---

## 2. Apply Migration 56

```bash
supabase db push --db-url <staging-url> --include-only 56
```

**Expected output:**
- Migration applies without error.
- 4 functions exist: `process_webhook_event`, `process_pending_webhook_events`, `schedule_webhook_retry`, `get_webhook_queue_stats` (plus internal `_webhook_retry_delay_seconds`).

**Verify:**
```sql
select proname, prosecdef, proconfig
from pg_proc
where proname in (
  'process_webhook_event', 'process_pending_webhook_events',
  'schedule_webhook_retry', 'get_webhook_queue_stats'
)
order by proname;
```

- [ ] All 4 are `prosecdef = true` (SECURITY DEFINER)
- [ ] All 4 have `proconfig` containing `'search_path=public'`
- [ ] None are granted to `anon` or `authenticated`

---

## 3. Deploy the Worker

```bash
supabase functions deploy process-webhook-worker --project-ref <staging-ref>
```

**Verify:**
- [ ] Deploy succeeds
- [ ] Function URL: `https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker`

---

## 4. First-Run Verification

Before wiring up the cron, manually invoke the worker once to confirm it works end-to-end.

### 4.1 Seed a few events

Use the M4 simulation script:
```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>" \
  node scripts/test-webhook-worker.cjs seed --count 5
```

### 4.2 Invoke the worker

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
  "processed_count": 5,
  "failed_terminal_count": 0,
  "failed_retryable_count": 0,
  "no_op_count": 0,
  "queue_empty_at_iteration": 5,
  "rpc_failure": null
}
```

**Verify:**
- [ ] `processed_count >= 5`
- [ ] `failed_terminal_count = 0`
- [ ] `failed_retryable_count = 0`

### 4.3 Confirm rows transitioned

```sql
select status, count(*) from public.webhook_events
where provider_event_id like 'TEST_M4_%'
group by status;
-- Expected: verified = 5, others = 0
```

### 4.4 Test the health endpoint

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  node scripts/test-webhook-worker.cjs health
```

- [ ] HTTP 200
- [ ] Returns JSON with all expected fields
- [ ] `queue_depth = 0` (all test rows verified)

### 4.5 Clean up

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  node scripts/test-webhook-worker.cjs clear
```

---

## 5. Configure the Cron Schedule

The M3 design doc §6.3 specifies:

> Run `process_pending_webhook_events(50, 25000)` every 5 minutes.

### 5.1 Set up via Supabase Cron (recommended)

If using Supabase's `pg_cron` extension, add a cron job:

```sql
select cron.schedule(
  'webhook-worker-5min',
  '*/5 * * * *',  -- every 5 minutes
  $$
  select net.http_post(
    url := 'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

Replace `<staging-ref>` with your actual project ref, and `service_role_key` with the actual key (stored via Supabase secrets; do not hardcode).

### 5.2 Verify the cron job

```sql
select * from cron.job where jobname = 'webhook-worker-5min';
```

- [ ] Job is active
- [ ] Schedule is `*/5 * * * *`

### 5.3 Monitor cron execution

After 10 minutes, verify the job has fired twice:

```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'webhook-worker-5min')
order by start_time desc
limit 5;
```

- [ ] At least 2 runs in the last 10 minutes
- [ ] `status = 'succeeded'`

### 5.4 Tune the schedule

Volume considerations:

| Daily events | Recommended cadence |
|---|---|
| < 100 | Every 15 min |
| 100–1,000 | Every 5 min (default) |
| 1,000–10,000 | Every 1–2 min |
| > 10,000 | Multiple concurrent workers or sub-minute cron |

For higher volume, increase `batch_size` (up to 500, the worker's hard cap) before increasing cadence.

---

## 6. Operational Procedures

### 6.1 Reading queue health

```bash
# Via simulation script:
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  node scripts/test-webhook-worker.cjs health
```

Or directly:
```bash
curl -X POST 'https://<ref>.supabase.co/functions/v1/process-webhook-worker?action=health'
```

Healthy state indicators:
- `received_count` is small (drained each tick)
- `failed_retryable_due_now` is small (drained as retries mature)
- `processing_count = 0` between ticks
- `oldest_pending_age_seconds` < 600 (under 10 minutes)

### 6.2 Inspecting a stuck event

```sql
select id, provider_id, provider_event_id, status, retry_count,
       max_retries, next_retry_at, last_error, locked_by, locked_at,
       error_history
from public.webhook_events
where id = '<event_id>';
```

**Decision matrix:**

| Symptom | Likely cause | Action |
|---|---|---|
| `status = 'received'` for >10 min | Worker not running, or batch full | Check cron. Run worker manually. |
| `status = 'processing'`, `locked_at > 10 min ago` | Worker crashed mid-row | Stale-lock recovery handles it; next worker reclaims. |
| `status = 'failed_retryable'`, `next_retry_at > now()` | Backoff in effect | Normal; will retry at scheduled time. |
| `status = 'failed_retryable'`, `retry_count = max_retries` | One more failure → dead letter | Investigate; consider manual retry. |
| `status = 'failed_terminal'` | Permanent failure (validation/data) | Inspect `last_error`. Manual retry only if data was fixed. |

### 6.3 Manually retry a failed event

For rows in `failed_terminal` or stuck `failed_retryable`:

```sql
select public.retry_webhook_event('<event_id>');
```

This resets the row to `status='received'`, `retry_count=0`, `next_retry_at=NULL`, `last_error=NULL`. The next worker tick picks it up.

The M2 admin UI surfaces this as a "Retry" button on each row in the diagnostics page (M11).

### 6.4 Manually mark a row dead-letter

For rows that should NOT be retried (admin decision):

```sql
select public.mark_webhook_dead_letter(
  '<event_id>',
  'manually dead-lettered: <reason>'
);
```

### 6.5 Re-enqueue a duplicate manually

If the worker accidentally dead-lettered a row that should be processed:

1. Inspect the row.
2. Fix the underlying data (e.g., enable a provider that was disabled).
3. `select public.retry_webhook_event('<event_id>');`
4. Worker re-processes on next tick.

### 6.6 Drain the queue manually

If you want to force a full drain (e.g., for cleanup):

```bash
# Run worker in a loop until queue is empty.
while true; do
  RESP=$(curl -s -X POST 'https://<ref>.supabase.co/functions/v1/process-webhook-worker?batch_size=500&max_runtime_ms=25000')
  PROCESSED=$(echo "$RESP" | jq -r '.processed_count + .failed_terminal_count + .failed_retryable_count')
  if [ "$PROCESSED" = "0" ]; then
    echo "Queue drained."
    break
  fi
  echo "Processed $PROCESSED rows; continuing..."
done
```

⚠️ Use with care. Forcing a full drain can starve the cron-driven worker.

---

## 7. Monitoring and Alerting

### 7.1 Key metrics to track

| Metric | Query | Healthy range |
|---|---|---|
| Queue depth | `health` endpoint → `queue_depth` | < 100 between ticks |
| Verified rows/day | `select count(*) from webhook_events where status='verified' and verified_at > now() - interval '1 day'` | Tracks purchase volume |
| Failed terminal/day | `select count(*) from webhook_events where status='failed_terminal' and last_error_at > now() - interval '1 day'` | 0 (or low, if known bad data) |
| Oldest pending age | `health` → `oldest_pending_age_seconds` | < 600s |
| Stale locks | `select count(*) from webhook_events where status='processing' and locked_at < now() - interval '5 minutes'` | 0 |

### 7.2 Suggested alerts

Set up alerts (PagerDuty, Opsgenie, or similar) on:

- `oldest_pending_age_seconds > 600` for > 15 minutes (worker stuck or behind)
- `processing_count > 10` between cron ticks (workers not finishing)
- `failed_terminal_count > 0` (notify admin, not necessarily page)
- Function error rate > 1% over 1 hour

### 7.3 Logging

Worker logs flow through Supabase Edge Function Logs. To query them:

```bash
supabase functions logs process-webhook-worker --project-ref <ref>
```

Or in the Supabase Dashboard → Edge Functions → process-webhook-worker → Logs.

Log events to look for:
- `WORKER_START`, `WORKER_DONE`: per-invocation summary
- `WORKER_HEARTBEAT`: long-running batch progress
- `WORKER_ROW_VERIFIED`: per-row success
- `WORKER_ROW_FAILED_TERMINAL`: per-row permanent failure (alert)
- `WORKER_ROW_RETRY_SCHEDULED`: per-row retry (info)
- `WORKER_QUEUE_EMPTY`: queue drained
- `WORKER_RPC_FAILED`: catastrophic RPC error (alert)

---

## 8. Rollback Procedures

### 8.1 Stop the cron (urgent)

If the worker is causing damage:

```sql
select cron.unschedule('webhook-worker-5min');
```

The worker stops being invoked. Already-running invocations complete; future ones don't start.

### 8.2 Restore the M53 stubs (full rollback)

If you must revert M4 (e.g., the migration is causing DB issues):

```bash
# Apply the rollback section of migration 56 (commented out).
psql <connection-string> -f supabase/migrations/56_webhook_worker_rpcs.sql --section-rollback
# Or run the rollback script manually.
```

After rollback:
- `process_webhook_event` and `process_pending_webhook_events` raise `'not yet implemented'`.
- Worker invocations return 500 with an error message.
- Existing `webhook_events` rows are NOT modified.

**Important:** If you rolled back because of a data-integrity issue, run a SQL audit first:

```sql
select status, count(*) from public.webhook_events group by status;
```

Compare to pre-rollback state to ensure no rows are stuck in unexpected states.

### 8.3 Restore the worker body

If only the worker body is the issue (not the SQL):

```bash
# Restore the M3 stub (the file the M3 PR delivered).
git checkout <m3-commit> -- supabase/functions/process-webhook-worker/index.ts
supabase functions deploy process-webhook-worker --project-ref <ref>
```

The worker becomes a stub again. The SQL functions are unaffected.

### 8.4 Re-running after rollback

After rollback and a fix:

1. Re-apply migration 56 (or the worker body, if only that was rolled back).
2. Re-deploy the worker.
3. Manually trigger a tick to verify.
4. Re-schedule the cron job.

---

## 9. Common Issues

### 9.1 Queue keeps growing

**Symptom:** `received_count` rises faster than the worker drains it.

**Causes:**
- Cron is misconfigured (not running, wrong URL).
- Worker batch_size is too small for the volume.
- DB performance regression (long processing times).

**Triage:**
```sql
select
  status,
  count(*),
  avg(extract(epoch from (now() - received_at))) as avg_age_seconds
from public.webhook_events
where status in ('received', 'failed_retryable', 'processing')
group by status;
```

If `processing` count is high and `locked_at` is recent, the worker is actively working. If `locked_at` is old, workers crashed and stale-lock recovery hasn't kicked in.

### 9.2 All rows going to failed_terminal

**Symptom:** `failed_terminal_count` is rising; `last_error` is consistent.

**Causes:**
- A provider was disabled but events are still flowing.
- `payment_provider_secrets` was rotated and the new secret doesn't decrypt.
- A migration broke the schema.

**Triage:**
```sql
select last_error, count(*) from public.webhook_events
where status = 'failed_terminal'
  and last_error_at > now() - interval '1 hour'
group by last_error
order by count desc
limit 10;
```

The most common error message identifies the root cause.

### 9.3 Stale locks accumulating

**Symptom:** `processing_count > 0` with `locked_at` > 5 minutes ago.

**Cause:** Workers crashed mid-row. Stale-lock recovery (in the claim query) handles this; the next worker tick reclaims and processes the row.

If the row is stuck indefinitely:
1. Inspect the row's `locked_by` value to identify the dead worker.
2. Manually clear the lock:
   ```sql
   update public.webhook_events
   set locked_by = null, locked_at = null, status = 'received'
   where id = '<event_id>';
   ```
3. Worker picks it up on next tick.

### 9.4 Worker takes >25s and times out

**Symptom:** `WORKER_DEADLINE_REACHED` fires; `timed_out: true`.

**Cause:** Database slowdown, network issues, or too-large batch.

**Triage:**
- Check `processed_count` and `failed_terminal_count` — if these are zero, the worker is stuck before processing (likely a single slow RPC call).
- Reduce `batch_size` to 10–20 and re-run.
- If consistently timing out, investigate DB performance.

### 9.5 RPC returns "permission denied for function"

**Symptom:** Worker invocation returns 500 with `permission denied for function process_webhook_event`.

**Cause:** Migration 56 grants `EXECUTE` to `service_role` only. The edge function uses `SUPABASE_SERVICE_ROLE_KEY`, which should be the service role. If someone deployed the function with `SUPABASE_ANON_KEY` instead, it fails.

**Fix:** Verify the edge function env vars include `SUPABASE_SERVICE_ROLE_KEY`. Redeploy if needed.

---

## 10. Performance and Scaling

### 10.1 Single worker throughput

On a typical Supabase project (medium DB instance):
- ~50–100 rows/sec for happy path (validate + transition)
- ~30–50 rows/sec with corrupt data (each goes through exception + dead-letter path)
- Hard cap per tick: `batch_size = 500` rows or `max_runtime_ms = 30000` (worker's hard cap)

### 10.2 Concurrency

The worker uses `FOR UPDATE SKIP LOCKED`, so multiple concurrent invocations are safe. To scale:

- Run the same cron entry point multiple times per minute (e.g., every minute instead of every 5).
- Or: deploy a second worker function with a different name and run two crons in parallel.

⚠️ Each worker creates its own Supabase client connection. Monitor DB connection pool size.

### 10.3 Indexes

M52 already provides indexes for the claim query:
- `idx_webhook_events_queue` on `(received_at)` where `status in ('received', 'verified', 'failed_retryable')` — partial; covers status filter.
- `idx_webhook_events_retry` on `(next_retry_at)` where `status = 'failed_retryable'` — partial; covers retry scheduling.

For very large queues (>1M pending rows), consider adding:
```sql
create index concurrently if not exists idx_webhook_events_claim
  on public.webhook_events (received_at)
  where status in ('received', 'failed_retryable');
```

Only add if `EXPLAIN` shows the existing indexes are insufficient.

---

## 11. Change Log

| Date | Change | Operator |
|---|---|---|
| YYYY-MM-DD | Initial rollout to staging | <name> |
| YYYY-MM-DD | Cron configured at `*/5 * * * *` | <name> |
| YYYY-MM-DD | Promoted to production | <name> |
