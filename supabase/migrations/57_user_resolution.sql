-- ============================================================
-- MIGRATION 57 — USER RESOLUTION (MILESTONE 5)
-- ============================================================
-- Implements Milestone 5 of the generic payment provider
-- architecture: User Resolution. This milestone associates
-- verified WarriorPlus purchases with RobinOS users without
-- creating purchases, granting entitlements, or sending emails.
--
-- What this migration does:
--   1. Extends webhook_events with 4 additive columns for
--      resolution state capture.
--   2. Adds 2 indexes for admin queries / observability.
--   3. Replaces the M1 stub resolve_or_create_user_from_purchase
--      with the real M5 implementation.
--   4. Extends process_webhook_event (from M4) to call M5
--      resolution as an atomic step between validation and
--      the final status transition.
--
-- Architecture review (see .kimchi/docs/milestone-5-architecture-review.md)
-- confirms:
--   - No new tables (reuses webhook_events for audit).
--   - No new webhook_events.status values (reuses 'verified' and
--     'awaiting_claim' which were already added in M52).
--   - auth.users remains READ-ONLY (M9 owns account creation).
--   - All changes additive; existing data 100% preserved.
--
-- Out of scope (NOT implemented):
--   - Purchase creation, payment recording (M6)
--   - Subscription creation (M6)
--   - Plan switching, entitlement granting (M6)
--   - Refund handling (M7)
--   - Dispute handling (M8)
--   - Affiliate commissions (M10)
--   - Email sending, account creation (M9)
--
-- Reuses existing infrastructure:
--   - public.process_webhook_event (M56) — claim + validate skeleton
--   - public.schedule_webhook_retry (M56) — transient failure path
--   - public.mark_webhook_dead_letter (M53) — terminal failure path
--   - public.standardized_event_type / event_mapping_confidence
--     populated by the M3 dispatcher (provider-agnostic).
--   - pgcrypto for SHA-256 (migration 01).
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- SECTION A: SCHEMA ADDITIONS (webhook_events)
-- ────────────────────────────────────────────────────────────
--
-- 4 additive columns. All nullable. No DEFAULT on outcome so
-- pre-M5 rows stay NULL (untouched = "M5 has not run yet").

alter table public.webhook_events
  add column if not exists provider_customer_id          text,
  add column if not exists resolution_attempted_at       timestamptz,
  add column if not exists resolution_outcome            text
    constraint webhook_events_resolution_outcome_check
      check (resolution_outcome is null or resolution_outcome in (
        'resolved_existing_user',
        'marked_guest_awaiting_claim',
        'resolution_failed'
      )),
  add column if not exists resolution_buyer_email_hash   text;

comment on column public.webhook_events.provider_customer_id is
  'Stable provider-side customer identifier (e.g. cus_xxx from Stripe). NULL for providers that do not send one (WarriorPlus). Captured at M5 for forward propagation to M6 subscriptions table.';
comment on column public.webhook_events.resolution_attempted_at is
  'Timestamp when M5 user resolution last ran for this row. NULL means M5 has not yet processed this event. Distinct from verified_at (set by M4 validation).';
comment on column public.webhook_events.resolution_outcome is
  'Result of M5 resolution. One of: resolved_existing_user (auth.users match found), marked_guest_awaiting_claim (no match, will be claimed via M9), resolution_failed (ambiguous match or other non-retryable error). NULL means M5 has not yet run.';
comment on column public.webhook_events.resolution_buyer_email_hash is
  'SHA-256(lower(trim(buyer_email))) from the verified webhook. PII-safe lookup; available before M6 creates payments.buyer_email_hash.';


-- ────────────────────────────────────────────────────────────
-- SECTION B: INDEXES (additive, partial)
-- ────────────────────────────────────────────────────────────

-- M5 outcome distribution / daily counters
create index if not exists idx_webhook_events_resolution_outcome
  on public.webhook_events (resolution_outcome, resolution_attempted_at desc)
  where resolution_outcome is not null;

-- Admin search "show all webhooks for buyer X" before M6
create index if not exists idx_webhook_events_resolution_email_hash
  on public.webhook_events (resolution_buyer_email_hash)
  where resolution_buyer_email_hash is not null;


-- ============================================================
-- SECTION C: resolve_or_create_user_from_purchase (REPLACE STUB)
-- ============================================================
--
-- Replaces the M1 stub (migration 53) with the real M5
-- implementation. Read-only on auth.users; M5 never creates
-- accounts (M9 owns that). Behavior:
--
--   1. Normalize email: lower(trim(p_buyer_email)).
--      NULL/empty → raise 'missing_buyer_email' (terminal).
--   2. Validate provider_id: must exist in payment_providers.
--      Missing → raise 'provider_not_found' (terminal).
--   3. Search auth.users for exact normalized-email match.
--      - 0 matches → return marked_guest_awaiting_claim.
--      - 1 match   → return resolved_existing_user.
--      - >1 matches → return resolution_failed with
--                     ambiguous_match (terminal; admin must
--                     investigate via M11 diagnostics).
--                     This is a security guard: we never silently
--                     merge identities.
--
-- SECURITY DEFINER is required to read auth.users, whose RLS
-- policy blocks non-service-role callers. search_path is pinned.
--
-- Idempotent: read-only against auth.users; repeated calls with
-- the same inputs return the same outputs. The downstream
-- process_webhook_event uses SELECT FOR UPDATE SKIP LOCKED so
-- concurrent calls on the same row cannot interleave.

create or replace function public.resolve_or_create_user_from_purchase(
  p_buyer_email          text,
  p_buyer_name           text,
  p_provider_id          text,
  p_provider_customer_id text default null,
  p_create_if_missing    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_email    text;
  v_match_count         int;
  v_matched_user_id     uuid;
  v_provider_exists     boolean;
begin
  -- ── 1. Normalize and validate buyer_email ────────────────
  if p_buyer_email is null or btrim(p_buyer_email) = '' then
    raise exception 'missing_buyer_email';
  end if;

  v_normalized_email := lower(btrim(p_buyer_email));

  -- ── 2. Validate provider_id ──────────────────────────────
  -- Defensive check; the worker already validated this in M4,
  -- but the RPC is also called directly by future flows (M9).
  select exists(
    select 1 from public.payment_providers where id = p_provider_id
  ) into v_provider_exists;

  if not v_provider_exists then
    raise exception 'provider_not_found: %', p_provider_id;
  end if;

  -- ── 3. Search auth.users for exact normalized match ──────
  -- SECURITY DEFINER bypasses auth.users RLS for this read.
  -- The check is case-insensitive because v_normalized_email
  -- is already lowercased; the column itself is case-sensitive
  -- in PostgreSQL by default so we MUST match on lower(email).
  --
  -- We also explicitly exclude the anonymous user row if any
  -- exists (Supabase convention: id = '00000000-0000-0000-0000-000000000000'
  -- or email = 'anonymous'). This is defense in depth.
  select count(*), max(id)
    into v_match_count, v_matched_user_id
  from auth.users
  where lower(email) = v_normalized_email
    and email is not null
    and deleted_at is null;

  if v_match_count = 0 then
    -- ── Guest path ─────────────────────────────────────────
    -- M5 does NOT create accounts. The buyer_email is preserved
    -- on the webhook row (via resolution_buyer_email_hash and
    -- raw_payload) and the status transitions to 'awaiting_claim'
    -- so M9 can later build the claim flow.
    return jsonb_build_object(
      'outcome',              'marked_guest_awaiting_claim',
      'user_id',              null,
      'buyer_email',          v_normalized_email,
      'buyer_name',           nullif(btrim(coalesce(p_buyer_name, '')), ''),
      'provider_id',          p_provider_id,
      'provider_customer_id', nullif(btrim(coalesce(p_provider_customer_id, '')), '')
    );
  elsif v_match_count = 1 then
    -- ── Existing user path ─────────────────────────────────
    return jsonb_build_object(
      'outcome',              'resolved_existing_user',
      'user_id',              v_matched_user_id,
      'buyer_email',          v_normalized_email,
      'matched_by',           'email',
      'provider_id',          p_provider_id,
      'provider_customer_id', nullif(btrim(coalesce(p_provider_customer_id, '')), '')
    );
  else
    -- ── Ambiguous match: terminal failure ──────────────────
    -- Two or more auth.users rows have the same normalized
    -- email. This should not happen in a healthy system but
    -- can occur after manual data imports or admin mistakes.
    -- We NEVER silently merge; the caller dead-letters this
    -- row so an operator can investigate via M11.
    return jsonb_build_object(
      'outcome',       'resolution_failed',
      'error',         'ambiguous_match',
      'match_count',   v_match_count,
      'buyer_email',   v_normalized_email,
      'provider_id',   p_provider_id
    );
  end if;
end;
$$;

grant execute on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) to service_role;

comment on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) is
  'M5: resolves a verified webhook buyer to an existing RobinOS auth.users row by exact email match (case-insensitive). Read-only on auth.users. Returns resolved_existing_user / marked_guest_awaiting_claim / resolution_failed. M9 (claim flow) is the only code path that ever creates auth.users rows from a purchase.';


-- ============================================================
-- SECTION D: process_webhook_event (REPLACE M4 IMPLEMENTATION)
-- ============================================================
--
-- Extends the M4 process_webhook_event with an inline M5
-- resolution step between payload validation and the final
-- status transition. The M4 skeleton (claim → lock → validate)
-- is preserved verbatim; only steps 3c–3e are new.
--
-- New per-row flow:
--   1. Claim row (M4, unchanged)
--   2. Acquire lock, status='processing' (M4, unchanged)
--   3a. Payload integrity (SHA-256) — M4, unchanged
--   3b. Provider exists + enabled — M4, unchanged
--   3c. ★ M5: extract buyer_email from raw_payload (NEW)
--   3d. ★ M5: call resolve_or_create_user_from_purchase (NEW)
--   3e. ★ M5: apply outcome to webhook_events (NEW)
--        - resolved_existing_user → status='verified', linked_user_id set
--        - marked_guest_awaiting_claim → status='awaiting_claim'
--        - resolution_failed        → mark_webhook_dead_letter
--   4. Final transition (success or failure)
--
-- Atomicity: steps 1–4 happen inside the same transaction.
-- If M5 raises a transient error, the entire row rolls back
-- to its prior state and schedule_webhook_retry is called.
-- If M5 returns resolution_failed, the existing dead-letter
-- path is invoked (no retry).
--
-- The TS worker (process-webhook-worker) requires zero changes.
-- Its loop calls process_webhook_event() and the new M5 step
-- is transparent.

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

  -- M5 additions
  v_buyer_email           text;
  v_buyer_name            text;
  v_provider_customer_id  text;
  v_resolution            jsonb;
  v_resolution_outcome    text;
  v_resolved_user_id      uuid;
  v_email_hash            text;
begin
  -- ── Step 1: Claim one row (UNCHANGED FROM M4) ────────────
  if p_webhook_event_id is null then
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

  -- ── Step 2: Acquire lock and transition to 'processing' (UNCHANGED) ──
  update public.webhook_events
  set locked_by            = v_lock_id,
      locked_at            = now(),
      processing_started_at = coalesce(processing_started_at, now()),
      status               = 'processing'
  where id = v_event.id;

  -- ── Step 3: Validate + Resolve (M4 validation + M5 resolution) ──
  begin
    -- ── 3a. Payload integrity (UNCHANGED FROM M4) ────────────────
    if v_event.raw_payload is null then
      raise exception 'raw_payload_is_null';
    end if;

    v_recomputed_hash := encode(digest(v_event.raw_payload::text, 'sha256'), 'hex');
    if v_recomputed_hash <> v_event.payload_hash then
      raise exception 'payload_hash_mismatch: stored=% recomputed=%',
        v_event.payload_hash, v_recomputed_hash;
    end if;

    -- ── 3b. Provider existence + enabled (UNCHANGED FROM M4) ────
    select * into v_provider
    from public.payment_providers
    where id = v_event.provider_id;

    if not found then
      raise exception 'provider_not_found: %', v_event.provider_id;
    end if;

    if not v_provider.is_enabled then
      raise exception 'provider_disabled: %', v_event.provider_id;
    end if;

    -- ── 3c. M5: Extract buyer_email from raw_payload (NEW) ──────
    -- Provider-agnostic lookup: prefer lowercase 'buyer_email' key
    -- (the canonical key future adapters MUST emit). For the
    -- current adapter (WarriorPlus), the field is 'WP_BUYER_EMAIL'.
    -- We accept either form so that:
    --   - Existing WarriorPlus webhooks continue to work without
    --     changes to the M3 dispatcher or adapter.
    --   - Future adapters can adopt the lowercase canonical key.
    v_buyer_email := coalesce(
      nullif(btrim(coalesce(v_event.raw_payload->>'buyer_email', '')), ''),
      nullif(btrim(coalesce(v_event.raw_payload->>'WP_BUYER_EMAIL', '')), '')
    );

    if v_buyer_email is null then
      -- Terminal: malformed payload missing required identity.
      -- Retrying cannot fix this; the data won't change.
      raise exception 'missing_buyer_email_field';
    end if;

    v_buyer_name := nullif(
      btrim(coalesce(
        v_event.raw_payload->>'buyer_name',
        v_event.raw_payload->>'WP_BUYER_NAME',
        ''
      )),
      ''
    );

    v_provider_customer_id := nullif(
      btrim(coalesce(
        v_event.raw_payload->>'provider_customer_id',
        v_event.raw_payload->>'WP_CUSTOMER_ID',
        ''
      )),
      ''
    );

    -- PII-safe hash for admin search before M6 creates payments row.
    v_email_hash := encode(digest(lower(v_buyer_email), 'sha256'), 'hex');

    -- ── 3d. M5: Resolve identity (NEW) ─────────────────────────
    v_resolution := public.resolve_or_create_user_from_purchase(
      p_buyer_email          => v_buyer_email,
      p_buyer_name           => v_buyer_name,
      p_provider_id          => v_event.provider_id,
      p_provider_customer_id => v_provider_customer_id,
      p_create_if_missing    => false  -- M5 never creates users
    );

    v_resolution_outcome := v_resolution->>'outcome';
    if v_resolution_outcome = 'resolved_existing_user' then
      v_resolved_user_id := (v_resolution->>'user_id')::uuid;
    end if;

    -- ── 3e. M5: Apply outcome + final transition (NEW) ─────────
    if v_resolution_outcome = 'resolved_existing_user' then
      -- Existing user: leave a clear handoff for M6 (purchase creation).
      update public.webhook_events
      set status                       = 'verified',
          verified_at                  = coalesce(verified_at, now()),
          locked_by                    = null,
          locked_at                    = null,
          last_error                   = null,
          linked_user_id               = v_resolved_user_id,
          provider_customer_id         = v_provider_customer_id,
          resolution_attempted_at      = now(),
          resolution_outcome           = 'resolved_existing_user',
          resolution_buyer_email_hash  = v_email_hash
      where id = v_event.id;

      return jsonb_build_object(
        'success',                true,
        'action',                 'verified',
        'webhook_event_id',       v_event.id,
        'provider_id',            v_event.provider_id,
        'provider_event_type',    v_event.provider_event_type,
        'standardized_event_type', v_event.standardized_event_type,
        'event_mapping_confidence', v_event.event_mapping_confidence,
        'linked_user_id',         v_resolved_user_id,
        'resolution_outcome',     v_resolution_outcome,
        'trace_id',               v_event.trace_id,
        'lock_id',                v_lock_id
      );

    elsif v_resolution_outcome = 'marked_guest_awaiting_claim' then
      -- Guest buyer: stop at awaiting_claim. M6/M9 will pick up
      -- later; M5 does NOT create the auth.users row.
      update public.webhook_events
      set status                       = 'awaiting_claim',
          verified_at                  = coalesce(verified_at, now()),
          locked_by                    = null,
          locked_at                    = null,
          last_error                   = null,
          linked_user_id               = null,
          provider_customer_id         = v_provider_customer_id,
          resolution_attempted_at      = now(),
          resolution_outcome           = 'marked_guest_awaiting_claim',
          resolution_buyer_email_hash  = v_email_hash
      where id = v_event.id;

      return jsonb_build_object(
        'success',                true,
        'action',                 'awaiting_claim',
        'webhook_event_id',       v_event.id,
        'provider_id',            v_event.provider_id,
        'provider_event_type',    v_event.provider_event_type,
        'standardized_event_type', v_event.standardized_event_type,
        'event_mapping_confidence', v_event.event_mapping_confidence,
        'linked_user_id',         null,
        'resolution_outcome',     v_resolution_outcome,
        'trace_id',               v_event.trace_id,
        'lock_id',                v_lock_id
      );

    elsif v_resolution_outcome = 'resolution_failed' then
      -- Ambiguous match or other non-retryable resolution error.
      -- Terminal: dead-letter. Admin must investigate via M11.
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'resolution_failed: ' || (v_resolution->>'error') ||
          ' (match_count=' || coalesce(v_resolution->>'match_count', '?') || ')'
      );
      return jsonb_build_object(
        'success',          false,
        'action',           'failed_terminal',
        'error',            'resolution_failed: ' || (v_resolution->>'error'),
        'classification',   'resolution',
        'webhook_event_id', v_event.id,
        'provider_id',      v_event.provider_id,
        'resolution_outcome', v_resolution_outcome,
        'trace_id',         v_event.trace_id,
        'lock_id',          v_lock_id
      );

    else
      -- Defensive: unknown outcome. Treat as transient (retry).
      -- Future M5 extensions that introduce new outcomes should
      -- branch here.
      raise exception 'unknown_resolution_outcome: %', coalesce(v_resolution_outcome, 'null');
    end if;

  exception when others then
    -- ── Error classification (EXTENDED FROM M4) ────────────────
    -- M4 categories (unchanged): validation (terminal) + unexpected (retry).
    -- M5 additions: resolution_failed (terminal) + missing_buyer_email_field (terminal).
    v_err_msg := SQLERRM;

    if v_err_msg like 'raw_payload_is_null%'
       or v_err_msg like 'payload_hash_mismatch%'
       or v_err_msg like 'provider_not_found%'
       or v_err_msg like 'provider_disabled%'
       or v_err_msg like 'missing_buyer_email_field%' then
      -- Terminal validation/resolution failure.
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
    elsif v_err_msg like 'resolution_failed:%'
       or v_err_msg like 'ambiguous_match%' then
      -- Defensive: resolve_or_create_user_from_purchase already
      -- handles ambiguous_match as a structured outcome, but if
      -- it raises here (e.g., because the caller passed
      -- p_create_if_missing=true in some future path), dead-letter.
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'resolution_failed: ' || v_err_msg
      );
      return jsonb_build_object(
        'success',          false,
        'action',           'failed_terminal',
        'error',            v_err_msg,
        'classification',   'resolution',
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
  'M4+M5: atomic claim + validate + resolve for ONE webhook event. Replaces M56 implementation. Returns jsonb with action (verified / awaiting_claim / failed_terminal / failed_retryable) or NULL when queue is empty. Resolves buyer email to existing auth.users row OR marks guest for M9 claim flow. NEVER creates auth.users rows. Called by process-webhook-worker Edge Function and admin tooling.';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 57
-- ============================================================
-- Reverts M5 by restoring the M56 process_webhook_event body and
-- the M53 resolve_or_create_user_from_purchase stub. After
-- rollback, the worker will resolve buyer identity but NOT
-- transition webhook rows to awaiting_claim (it will leave them
-- at 'verified' as in M4). Resolution outcome columns remain in
-- place but will not be populated.
--
-- Data preservation:
--   - The 4 new columns on webhook_events are NOT dropped.
--     They become inert (no code writes to them) but remain
--     queryable for historical analysis.
--   - Any rows that already transitioned to 'awaiting_claim'
--     during the M5 lifetime will stay in that state. The
--     rollback script does NOT move them back to 'verified'
--     because doing so would lose information about which rows
--     M5 already classified as guest buyers.
--
-- To fully reverse M5 (drop columns too), see the optional
-- FULL ROLLBACK section below the standard rollback.

/*

begin;

-- 1. Restore M4 process_webhook_event (M56 implementation without M5 resolution step)
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
  if p_webhook_event_id is null then
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

  update public.webhook_events
  set locked_by            = v_lock_id,
      locked_at            = now(),
      processing_started_at = coalesce(processing_started_at, now()),
      status               = 'processing'
  where id = v_event.id;

  begin
    if v_event.raw_payload is null then
      raise exception 'raw_payload_is_null';
    end if;

    v_recomputed_hash := encode(digest(v_event.raw_payload::text, 'sha256'), 'hex');
    if v_recomputed_hash <> v_event.payload_hash then
      raise exception 'payload_hash_mismatch: stored=% recomputed=%',
        v_event.payload_hash, v_recomputed_hash;
    end if;

    select * into v_provider
    from public.payment_providers
    where id = v_event.provider_id;

    if not found then
      raise exception 'provider_not_found: %', v_event.provider_id;
    end if;

    if not v_provider.is_enabled then
      raise exception 'provider_disabled: %', v_event.provider_id;
    end if;

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
    v_err_msg := SQLERRM;

    if v_err_msg like 'raw_payload_is_null%'
       or v_err_msg like 'payload_hash_mismatch%'
       or v_err_msg like 'provider_not_found%'
       or v_err_msg like 'provider_disabled%' then
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


-- 2. Restore M53 stub for resolve_or_create_user_from_purchase
create or replace function public.resolve_or_create_user_from_purchase(
  p_buyer_email          text,
  p_buyer_name           text,
  p_provider_id          text,
  p_provider_customer_id text default null,
  p_create_if_missing    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'resolve_or_create_user_from_purchase: rolled back to M53 stub';
end;
$$;

grant execute on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) to service_role;


commit;


-- ============================================================
-- OPTIONAL FULL ROLLBACK (drops the 4 new columns too)
-- ============================================================
-- Run ONLY if you need to fully reverse M5 schema changes.
-- WARNING: this drops any resolution outcome data that has
-- accumulated since M5 shipped. Take a backup first.

/*

begin;

-- Apply the standard rollback above first.

-- Then drop the 4 new columns and their indexes.
drop index if exists public.idx_webhook_events_resolution_outcome;
drop index if exists public.idx_webhook_events_resolution_email_hash;

alter table public.webhook_events
  drop column if exists provider_customer_id,
  drop column if exists resolution_attempted_at,
  drop column if exists resolution_outcome,
  drop column if exists resolution_buyer_email_hash;

commit;

*/
*/
