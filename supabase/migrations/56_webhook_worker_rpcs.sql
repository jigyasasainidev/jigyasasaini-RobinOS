-- ============================================================
-- MIGRATION 56 — WEBHOOK WORKER RPCS (MILESTONE 4)
-- ============================================================
-- Replaces the M53 stubs for process_webhook_event and
-- process_pending_webhook_events with real implementations,
-- and adds the supporting primitives the worker needs.
--
-- Scope of M4 (per the milestone-4 spec):
--   - Queue polling, batch processing, record locking
--   - Retry scheduling with exponential backoff + jitter
--   - Dead-letter handling
--   - Processing status updates
--   - Queue health reporting
--
-- Scope explicitly NOT in M4 (deferred to M5+):
--   - User creation, purchase creation, subscription updates
--   - Entitlement granting, refund handling
--   - Affiliate logic, email sending
--
-- What M4 DOES do per row (the "queue lifecycle"):
--   1. Claim the row (FOR UPDATE SKIP LOCKED; stale-lock recovery)
--   2. Acquire the lock (locked_by, locked_at, processing_started_at)
--   3. Validate payload integrity (recompute SHA-256, compare)
--   4. Validate provider existence + is_enabled
--   5. Transition to 'verified' (ready for M5+ downstream)
--   6. On validation failure: dead-letter (terminal, no retry)
--   7. On unexpected error: schedule retry with backoff
--
-- What M4 does NOT do:
--   - Resolve products (M5+ via worker product mapping RPC)
--   - Resolve users (M5)
--   - Record purchases (M6)
--   - Grant entitlements (M6)
--   - Send emails
--
-- The 'verified' status is the handoff point: M5+ reads rows in
-- status='verified' and runs its own pipeline. Rows in 'verified'
-- are NOT touched by the M4 worker (they're not in the eligible
-- claim set).
--
-- This migration is ADDITIVE to existing data. It does NOT
-- modify any table schema; it only replaces two RPCs and adds
-- three new ones.
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- HELPER: exponential-backoff schedule
-- ────────────────────────────────────────────────────────────
-- Same table used everywhere: index = retry_count (1-based).
-- 1m, 5m, 30m, 2h, 12h.
--
-- Applied with ±20% random jitter to prevent thundering herd.

create or replace function public._webhook_retry_delay_seconds(
  p_retry_count int
)
returns int
language plpgsql
immutable
as $$
declare
  v_base_table int[] := array[60, 300, 1800, 7200, 43200];
  v_idx int;
  v_base int;
  v_jitter int;
  v_total int;
begin
  v_idx := least(greatest(p_retry_count, 1), array_length(v_base_table, 1));
  v_base := v_base_table[v_idx];
  -- ±20% jitter, rounded.
  v_jitter := floor(random() * (v_base * 0.4) - (v_base * 0.2));
  v_total := greatest(1, v_base + v_jitter);
  return v_total;
end;
$$;

comment on function public._webhook_retry_delay_seconds is
  'Internal: returns backoff seconds for a given retry_count, with ±20% jitter. Index 1=1m, 2=5m, 3=30m, 4=2h, 5=12h.';


-- ────────────────────────────────────────────────────────────
-- RPC: schedule_webhook_retry (NEW)
-- ────────────────────────────────────────────────────────────
-- Transitions a webhook_events row to failed_retryable, bumps
-- retry_count, sets next_retry_at with backoff + jitter.
-- If retry_count would exceed max_retries, marks dead-letter
-- instead.
--
-- Called by:
--   - process_webhook_event when an unexpected error occurs
--     during validation (raw DB error, etc.)
--   - Admin tooling (M11 diagnostics) for manual retries with
--     custom error message

create or replace function public.schedule_webhook_retry(
  p_webhook_event_id uuid,
  p_error_message    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_new_retry_count int;
  v_delay_seconds int;
  v_next_retry_at timestamptz;
  v_truncated_err text;
begin
  select * into v_event
  from public.webhook_events
  where id = p_webhook_event_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'action', 'no_op',
      'error', 'webhook_event_not_found',
      'webhook_event_id', p_webhook_event_id
    );
  end if;

  v_new_retry_count := v_event.retry_count + 1;
  v_truncated_err := left(p_error_message, 500);

  -- If retry budget exhausted: dead-letter instead.
  if v_new_retry_count > v_event.max_retries then
    perform public.mark_webhook_dead_letter(
      p_webhook_event_id,
      'max_retries_exhausted: ' || v_truncated_err
    );
    return jsonb_build_object(
      'success', false,
      'action', 'failed_terminal',
      'error', 'max_retries_exhausted',
      'retry_count', v_new_retry_count,
      'webhook_event_id', p_webhook_event_id
    );
  end if;

  v_delay_seconds := public._webhook_retry_delay_seconds(v_new_retry_count);
  v_next_retry_at := now() + (v_delay_seconds || ' seconds')::interval;

  update public.webhook_events
  set status         = 'failed_retryable',
      retry_count    = v_new_retry_count,
      next_retry_at  = v_next_retry_at,
      last_error     = v_truncated_err,
      last_error_at  = now(),
      locked_by      = null,
      locked_at      = null,
      error_history  = coalesce(error_history, '[]'::jsonb) ||
                        jsonb_build_object(
                          'error',       v_truncated_err,
                          'timestamp',   now(),
                          'retry_count', v_new_retry_count
                        )
  where id = p_webhook_event_id;

  return jsonb_build_object(
    'success',       true,
    'action',        'failed_retryable',
    'retry_count',   v_new_retry_count,
    'next_retry_at', v_next_retry_at,
    'delay_seconds', v_delay_seconds,
    'webhook_event_id', p_webhook_event_id
  );
end;
$$;

grant execute on function public.schedule_webhook_retry(uuid, text) to service_role;

comment on function public.schedule_webhook_retry is
  'Schedule a webhook event for retry with exponential backoff + jitter. If retry_count would exceed max_retries, marks dead-letter instead. Called by process_webhook_event and admin tooling (M11).';


-- ────────────────────────────────────────────────────────────
-- RPC: process_webhook_event (REPLACE M53 STUB)
-- ────────────────────────────────────────────────────────────
-- Atomic claim + validate + transition for ONE webhook event.
--
-- Two call patterns:
--   - process_webhook_event() — auto-claim one eligible row
--   - process_webhook_event(p_webhook_event_id) — process a
--     specific row (used by M11 admin retry or test tools)
--
-- Returns jsonb or NULL:
--   NULL                              — queue empty (auto-claim) or
--                                       row not found / not claimable
--   { success: true, action: 'verified', ... }
--                                    — payload + provider valid;
--                                       row transitioned to 'verified'
--                                       (ready for M5+ downstream)
--   { success: false, action: 'failed_terminal', error, classification: 'validation' }
--                                    — payload corruption, provider
--                                       missing, or provider disabled
--                                       (no retry; data won't fix itself)
--   { success: false, action: 'failed_retryable', error, classification: 'unexpected' }
--                                    — DB error, etc. (transient)
--                                       Retry scheduled via
--                                       schedule_webhook_retry
--
-- Lock recovery:
--   A row whose lock is older than 5 minutes is treated as claimable
--   (assumes the previous holder crashed). This is the stale-lock
--   recovery mechanism.

create or replace function public.process_webhook_event(
  p_webhook_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_provider record;
  v_recomputed_hash text;
  v_lock_id text := gen_random_uuid()::text;
  v_err_msg text;
begin
  -- ── Step 1: Claim one row ────────────────────────────────
  if p_webhook_event_id is null then
    -- Auto-claim the oldest eligible row.
    select * into v_event
    from public.webhook_events
    where status in ('received', 'failed_retryable')
      and (next_retry_at is null or next_retry_at <= now())
      and (locked_by is null or locked_at < now() - interval '5 minutes')
    order by
      case status when 'received' then 0 when 'failed_retryable' then 1 end,
      next_retry_at nulls first,
      received_at
    limit 1
    for update skip locked;
  else
    -- Process a specific row (manual retry / admin tooling).
    -- Must be in a claimable state and not locked by another worker.
    select * into v_event
    from public.webhook_events
    where id = p_webhook_event_id
      and status in ('received', 'failed_retryable', 'failed_terminal')
      and (locked_by is null or locked_at < now() - interval '5 minutes')
    for update skip locked;
  end if;

  if not found then
    return null;
  end if;

  -- ── Step 2: Acquire lock and transition to 'processing' ──
  update public.webhook_events
  set locked_by            = v_lock_id,
      locked_at            = now(),
      processing_started_at = coalesce(processing_started_at, now()),
      status               = 'processing'
  where id = v_event.id;

  -- ── Step 3: Validate (each step may raise; caught below) ──
  begin
    -- 3a. Payload integrity: recompute SHA-256 of raw_payload,
    --     compare to stored payload_hash.
    if v_event.raw_payload is null then
      raise exception 'raw_payload_is_null';
    end if;

    v_recomputed_hash := encode(digest(v_event.raw_payload::text, 'sha256'), 'hex');
    if v_recomputed_hash <> v_event.payload_hash then
      raise exception 'payload_hash_mismatch: stored=% recomputed=%',
        v_event.payload_hash, v_recomputed_hash;
    end if;

    -- 3b. Provider existence + enabled.
    select * into v_provider
    from public.payment_providers
    where id = v_event.provider_id;

    if not found then
      raise exception 'provider_not_found: %', v_event.provider_id;
    end if;

    if not v_provider.is_enabled then
      raise exception 'provider_disabled: %', v_event.provider_id;
    end if;

    -- ── Step 4: Transition to 'verified' (ready for M5+) ────
    update public.webhook_events
    set status      = 'verified',
        verified_at = now(),
        locked_by   = null,
        locked_at   = null,
        last_error  = null
    where id = v_event.id;

    return jsonb_build_object(
      'success',                true,
      'action',                 'verified',
      'webhook_event_id',       v_event.id,
      'provider_id',            v_event.provider_id,
      'provider_event_type',    v_event.provider_event_type,
      'standardized_event_type', v_event.standardized_event_type,
      'event_mapping_confidence', v_event.event_mapping_confidence,
      'trace_id',               v_event.trace_id,
      'lock_id',                v_lock_id
    );

  exception when others then
    -- ── Error classification ────────────────────────────────
    -- Validation failures are deterministic (data is corrupt,
    -- provider missing/disabled) — no point retrying. Schedule
    -- them as dead-letter immediately.
    --
    -- Anything else is treated as transient (DB blip, OOM, etc.)
    — and scheduled for retry with backoff.
    v_err_msg := SQLERRM;

    if v_err_msg like 'raw_payload_is_null%'
       or v_err_msg like 'payload_hash_mismatch%'
       or v_err_msg like 'provider_not_found%'
       or v_err_msg like 'provider_disabled%' then
      -- Terminal validation failure.
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'validation_failed: ' || v_err_msg
      );
      return jsonb_build_object(
        'success',          false,
        'action',           'failed_terminal',
        'error',            v_err_msg,
        'classification',   'validation',
        'webhook_event_id', v_event.id,
        'provider_id',      v_event.provider_id,
        'lock_id',          v_lock_id
      );
    else
      -- Unexpected (transient) failure: schedule retry.
      perform public.schedule_webhook_retry(
        v_event.id,
        'unexpected_error: ' || v_err_msg
      );
      return jsonb_build_object(
        'success',          false,
        'action',           'failed_retryable',
        'error',            v_err_msg,
        'classification',   'unexpected',
        'webhook_event_id', v_event.id,
        'provider_id',      v_event.provider_id,
        'lock_id',          v_lock_id
      );
    end if;
  end;
end;
$$;

grant execute on function public.process_webhook_event(uuid) to service_role;

comment on function public.process_webhook_event is
  'Atomic claim + validate + transition for ONE webhook event. Returns jsonb with action (verified / failed_terminal / failed_retryable / no_op) or NULL when the queue is empty. Replaces M53 stub; called by process-webhook-worker Edge Function (M4) and admin tooling (M11).';


-- ────────────────────────────────────────────────────────────
-- RPC: process_pending_webhook_events (REPLACE M53 STUB)
-- ────────────────────────────────────────────────────────────
-- SQL-loop batch entry point. Calls process_webhook_event()
-- up to p_batch_size times, or until p_max_runtime_ms elapses.
--
-- The TS Edge Function process-webhook-worker also implements
-- this loop directly (for richer per-row structured logging);
-- this SQL wrapper exists for:
--   - Manual psql / testing
--   - Direct cron backup if the Edge Function is unavailable
--   - Other edge functions that want a synchronous batch call
--
-- Returns aggregate results including per-row details.

create or replace function public.process_pending_webhook_events(
  p_batch_size     integer default 50,
  p_max_runtime_ms integer default 25000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_time timestamptz := clock_timestamp();
  v_deadline   timestamptz := clock_timestamp() + (p_max_runtime_ms || ' milliseconds')::interval;
  v_processed int := 0;
  v_failed_terminal int := 0;
  v_failed_retryable int := 0;
  v_no_op int := 0;
  v_iterations int := 0;
  v_result jsonb;
  v_action text;
  v_results jsonb := '[]'::jsonb;
begin
  loop
    v_iterations := v_iterations + 1;

    -- Wall-clock budget.
    if clock_timestamp() >= v_deadline then
      exit;
    end if;

    -- Batch size.
    if v_processed + v_failed_terminal + v_failed_retryable + v_no_op >= p_batch_size then
      exit;
    end if;

    -- Process one event. Defensive: if the inner function raises
    -- an unexpected error (e.g., DB connection lost mid-call),
    -- log via RAISE NOTICE and continue. The stale-lock recovery
    -- mechanism reclaims stuck rows.
    begin
      v_result := public.process_webhook_event();
    exception when others then
      raise notice 'process_webhook_event raised unexpectedly: %', SQLERRM;
      v_no_op := v_no_op + 1;
      continue;
    end;

    if v_result is null then
      -- Queue empty.
      exit;
    end if;

    v_action := v_result->>'action';
    if v_action = 'verified' then
      v_processed := v_processed + 1;
    elsif v_action = 'failed_terminal' then
      v_failed_terminal := v_failed_terminal + 1;
    elsif v_action = 'failed_retryable' then
      v_failed_retryable := v_failed_retryable + 1;
    else
      v_no_op := v_no_op + 1;
    end if;

    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'batch_size_requested',  p_batch_size,
    'max_runtime_ms',        p_max_runtime_ms,
    'processed_count',       v_processed,
    'failed_terminal_count', v_failed_terminal,
    'failed_retryable_count', v_failed_retryable,
    'no_op_count',           v_no_op,
    'iterations',            v_iterations,
    'started_at',            v_start_time,
    'finished_at',           clock_timestamp(),
    'elapsed_ms',            extract(epoch from (clock_timestamp() - v_start_time)) * 1000,
    'timed_out',             clock_timestamp() >= v_deadline,
    'results',               v_results
  );
end;
$$;

grant execute on function public.process_pending_webhook_events(integer, integer) to service_role;

comment on function public.process_pending_webhook_events is
  'SQL-loop batch entry point. Calls process_webhook_event() up to p_batch_size times or until p_max_runtime_ms elapses. Returns aggregate + per-row results. Replaces M53 stub. The TS Edge Function (process-webhook-worker) is the primary orchestrator; this RPC is for testing and direct invocation.';


-- ────────────────────────────────────────────────────────────
-- RPC: get_webhook_queue_stats (NEW)
-- ────────────────────────────────────────────────────────────
-- Health snapshot for the queue. Used by:
--   - process-webhook-worker ?action=health
--   - External monitoring / dashboards (M11)
--
-- All counts are scoped to webhook_events. Cheap query; uses
-- partial indexes where possible.

create or replace function public.get_webhook_queue_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received int;
  v_failed_retryable int;
  v_failed_retryable_due int;
  v_processing int;
  v_verified int;
  v_failed_terminal int;
  v_awaiting_admin int;
  v_oldest_received_at timestamptz;
  v_oldest_pending_age_seconds int;
begin
  select count(*) into v_received
    from public.webhook_events where status = 'received';

  select count(*) into v_failed_retryable
    from public.webhook_events where status = 'failed_retryable';

  select count(*) into v_failed_retryable_due
    from public.webhook_events
    where status = 'failed_retryable' and next_retry_at <= now();

  select count(*) into v_processing
    from public.webhook_events where status = 'processing';

  select count(*) into v_verified
    from public.webhook_events where status = 'verified';

  select count(*) into v_failed_terminal
    from public.webhook_events where status = 'failed_terminal';

  select count(*) into v_awaiting_admin
    from public.webhook_events where status = 'awaiting_admin';

  select received_at into v_oldest_received_at
    from public.webhook_events
    where status in ('received', 'failed_retryable')
    order by received_at asc
    limit 1;

  if v_oldest_received_at is not null then
    v_oldest_pending_age_seconds :=
      extract(epoch from (now() - v_oldest_received_at))::int;
  else
    v_oldest_pending_age_seconds := null;
  end if;

  return jsonb_build_object(
    'received_count',                v_received,
    'failed_retryable_count',        v_failed_retryable,
    'failed_retryable_due_now',      v_failed_retryable_due,
    'processing_count',              v_processing,
    'verified_count',                v_verified,
    'failed_terminal_count',         v_failed_terminal,
    'awaiting_admin_count',          v_awaiting_admin,
    'queue_depth',                   v_received + v_failed_retryable_due,
    'oldest_pending_received_at',    v_oldest_received_at,
    'oldest_pending_age_seconds',    v_oldest_pending_age_seconds,
    'queried_at',                    now()
  );
end;
$$;

grant execute on function public.get_webhook_queue_stats() to service_role;

comment on function public.get_webhook_queue_stats is
  'Health snapshot of the webhook_events queue. Counts by status, queue depth (due now), oldest pending age. Used by process-webhook-worker ?action=health and M11 diagnostics UI.';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 56
-- ============================================================
-- Reverts M4 by restoring the M53 stub bodies. After rollback
-- the worker will return "not implemented" — same as before M4.
--
-- Data is not destroyed; the new status values stay where they
-- are. Subsequent worker invocations will fail to enqueue
-- (raise exception) until M4 is re-applied.
--
-- Do NOT run this in production unless absolutely necessary;
-- restoring stubs loses all M4 functionality.

/*
begin;

-- Restore the M53 stubs by overwriting the new implementations.
create or replace function public.process_webhook_event(p_webhook_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'process_webhook_event: not yet implemented (scheduled for Milestone 4)';
end;
$$;

create or replace function public.process_pending_webhook_events(
  p_batch_size     integer,
  p_max_runtime_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'process_pending_webhook_events: not yet implemented (scheduled for Milestone 4)';
end;
$$;

-- Drop new RPCs introduced in M4.
drop function if exists public.schedule_webhook_retry(uuid, text);
drop function if exists public.get_webhook_queue_stats();
drop function if exists public._webhook_retry_delay_seconds(int);

-- Re-grant execute on the restored stubs.
grant execute on function public.process_webhook_event(uuid) to service_role;
grant execute on function public.process_pending_webhook_events(integer, integer) to service_role;

commit;
*/
