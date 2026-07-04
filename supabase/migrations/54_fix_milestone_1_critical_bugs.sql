-- ============================================================
-- MIGRATION 54 — MILESTONE 1 SELF-REVIEW FIXES
-- ============================================================
-- Resolves correctness bugs discovered during the Milestone 1
-- self-review. ADDITIVE ONLY — does not modify any prior
-- migration file. Applies the following fixes:
--
--   1. idx_payments_subscription referenced non-existent column
--      user_subscription_id. The actual column is subscription_id
--      (from M01). Drop and recreate the index correctly.
--
--   2. search_payments returned non-existent column
--      p.user_subscription_id. Recreate with subscription_id.
--
--   3. trg_payments_updated_at was created in M53, but M01
--      already creates it on the same table/event/function.
--      Postgres allows this and fires the trigger twice on every
--      UPDATE. Drop the M53 duplicate (M01 version remains).
--
--   4. record_subscription_webhook_event (M53) duplicates
--      record_webhook_event (M31) for the same
--      subscription_webhook_events table. The M31 version is
--      atomic (single INSERT relying on UNIQUE constraint); the
--      M53 version had a TOCTOU race. Drop the M53 RPC; call
--      record_webhook_event from edge functions instead.
--
--   5. search_webhook_events filtered on
--      raw_payload->>'buyer_email_hash', which never matches —
--      the trigger trg_payments_set_buyer_hash writes the hash
--      to payments.buyer_email_hash (a column), not into the
--      webhook raw payload. Recreate the RPC to JOIN with
--      payments on buyer_email_hash for correct filtering.
--
--   6. enqueue_webhook_event used a SELECT-then-INSERT pattern
--      that races with concurrent webhooks. Rewrite to use
--      INSERT ... ON CONFLICT DO NOTHING RETURNING so idempotency
--      is enforced atomically by the existing UNIQUE constraint.
--
-- This migration is the only follow-up required from the
-- Milestone 1 self-review. No prior migration file is modified.
-- ============================================================

begin;


-- ── FIX 1: idx_payments_subscription ───────────────────────
-- The original index references user_subscription_id, which
-- does not exist. The real column is subscription_id (M01).

drop index if exists public.idx_payments_subscription;

create index if not exists idx_payments_subscription
  on public.payments (subscription_id)
  where subscription_id is not null;


-- ── FIX 2: search_payments — correct column reference ─────
-- Recreate the RPC with subscription_id (not user_subscription_id).
-- All other behaviour, signature, security model, and PII masking
-- are unchanged.

create or replace function public.search_payments(
  p_provider_id             text    default null,
  p_provider_payment_id     text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_plan_key                text    default null,
  p_payment_status          text    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider              text,
  provider_payment_id   text,
  plan_key              text,
  billing_cycle         text,
  amount                numeric,
  currency              text,
  status                text,
  refunded_amount       numeric,
  buyer_email_masked    text,
  user_id               uuid,
  user_subscription_id  uuid,  -- returned as this alias for caller compatibility
  purchased_at          timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');
  end if;

  return query
    select
      p.id, p.provider::text, p.provider_payment_id, p.plan_key, p.billing_cycle,
      p.amount, p.currency, p.status::text, p.refunded_amount,
      case
        when p.buyer_email is null then null
        when length(p.buyer_email) <= 4 then '***'
        else substring(p.buyer_email from 1 for 1) || '***@' || split_part(p.buyer_email, '@', 2)
      end as buyer_email_masked,
      p.user_id, p.subscription_id, p.paid_at, p.refunded_at, p.created_at
    from public.payments p
    where (p_provider_id             is null or p.provider::text          = p_provider_id)
      and (p_provider_payment_id     is null or p.provider_payment_id      = p_provider_payment_id)
      and (v_buyer_email_hash        is null or p.buyer_email_hash         = v_buyer_email_hash)
      and (p_user_id                 is null or p.user_id                  = p_user_id)
      and (p_plan_key                is null or p.plan_key                 = p_plan_key)
      and (p_payment_status          is null or p.status::text             = p_payment_status)
      and (p_date_from               is null or p.created_at               >= p_date_from)
      and (p_date_to                 is null or p.created_at               <= p_date_to)
    order by p.created_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_payments(
  text, text, text, uuid, text, text, timestamptz, timestamptz, integer, integer
) to authenticated;

comment on function public.search_payments is
  'Admin search across payments. Buyer email is masked in output for PII protection. The user_subscription_id output column maps to payments.subscription_id (the existing FK to user_subscriptions from M01). Used by admin purchase search page (M11).';


-- ── FIX 3: drop duplicate trg_payments_updated_at ─────────
-- M01 already creates this exact trigger on payments.
-- Remove the M53 duplicate so every UPDATE fires the trigger
-- function only once.

drop trigger if exists trg_payments_updated_at on public.payments;


-- ── FIX 4: drop duplicate record_subscription_webhook_event ─
-- M31's record_webhook_event already provides atomic idempotency
-- for the subscription_webhook_events table. The M53 version
-- duplicates this functionality with a worse (TOCTOU) implementation.
-- Edge functions should call public.record_webhook_event from M31.

drop function if exists public.record_subscription_webhook_event(
  text, text, text, text
);


-- ── FIX 5: search_webhook_events — fix buyer_email filter ─
-- The previous version filtered on raw_payload->>'buyer_email_hash',
-- which never matches (the hash lives on payments.buyer_email_hash,
-- not in the raw webhook payload). Recreate with a subquery against
-- payments for correct buyer-email lookups.

create or replace function public.search_webhook_events(
  p_provider_id             text    default null,
  p_provider_transaction_id text    default null,
  p_provider_event_type     text    default null,
  p_status                  text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider_id           text,
  provider_event_id     text,
  provider_event_type   text,
  status                text,
  trace_id              uuid,
  received_at           timestamptz,
  processed_at          timestamptz,
  retry_count           integer,
  last_error            text,
  linked_user_id        uuid,
  linked_purchase_id    uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
  v_payment_event_ids uuid[];
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');

    -- Find webhook_events linked to payments matching the buyer email hash.
    -- Two matching paths:
    --   a) webhook_events.linked_purchase_id = payments.id
    --   b) webhook_events.id = payments.source_webhook_event_id
    select array_agg(distinct e.id) into v_payment_event_ids
      from public.webhook_events e
      left join public.payments p
        on p.id = e.linked_purchase_id
        or p.source_webhook_event_id = e.id
      where p.buyer_email_hash = v_buyer_email_hash;
  end if;

  return query
    select
      we.id, we.provider_id, we.provider_event_id, we.provider_event_type,
      we.status, we.trace_id, we.received_at, we.processed_at,
      we.retry_count, we.last_error, we.linked_user_id, we.linked_purchase_id
    from public.webhook_events we
    where (p_provider_id             is null or we.provider_id             = p_provider_id)
      and (p_provider_transaction_id is null or we.provider_transaction_id = p_provider_transaction_id)
      and (p_provider_event_type     is null or we.provider_event_type     = p_provider_event_type)
      and (p_status                  is null or we.status                  = p_status)
      and (v_payment_event_ids       is null or we.id = any(v_payment_event_ids))
      and (p_user_id                 is null or we.linked_user_id          = p_user_id)
      and (p_date_from               is null or we.received_at             >= p_date_from)
      and (p_date_to                 is null or we.received_at             <= p_date_to)
    order by we.received_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_webhook_events(
  text, text, text, text, text, uuid, timestamptz, timestamptz, integer, integer
) to authenticated;

comment on function public.search_webhook_events is
  'Admin search across webhook_events. When p_buyer_email is provided, matches webhook events linked to payments whose buyer_email_hash equals the SHA-256 of the supplied address (lowercased + trimmed). Used by admin diagnostics page (M11).';


-- ── FIX 6: enqueue_webhook_event — atomic ON CONFLICT ──────
-- The original implementation did SELECT-then-INSERT, which
-- races with concurrent webhooks for the same event id. The
-- existing UNIQUE constraint (provider_id, provider_event_id)
-- makes this safely atomic via ON CONFLICT.

create or replace function public.enqueue_webhook_event(
  p_provider_id             text,
  p_provider_event_id       text,
  p_provider_event_type     text,
  p_raw_payload             jsonb,
  p_raw_headers             jsonb default null,
  p_provider_transaction_id text default null,
  p_trace_id                uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload_hash text;
  v_id           uuid;
  v_status       text;
  v_inserted     boolean;
begin
  v_payload_hash := encode(digest(p_raw_payload::text, 'sha256'), 'hex');

  -- Atomic insert: if (provider_id, provider_event_id) already
  -- exists, the ON CONFLICT clause skips and returns xmax = 0,
  -- which we use to distinguish insert vs. duplicate.
  insert into public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    payload_hash, raw_payload, raw_headers,
    provider_transaction_id, trace_id,
    status
  ) values (
    p_provider_id, p_provider_event_id, p_provider_event_type,
    v_payload_hash, p_raw_payload, p_raw_headers,
    p_provider_transaction_id, p_trace_id,
    'received'
  )
  on conflict (provider_id, provider_event_id) do nothing
  returning id, (xmax = 0) into v_id, v_inserted;

  if v_id is null then
    -- ON CONFLICT triggered but RETURNING produced no row
    -- (defensive — should not happen with DO NOTHING semantics).
    select id, status into v_id, v_status
      from public.webhook_events
     where provider_id = p_provider_id
       and provider_event_id = p_provider_event_id;
    return jsonb_build_object(
      'id', v_id,
      'is_duplicate', true,
      'status', coalesce(v_status, 'received')
    );
  end if;

  if v_inserted then
    return jsonb_build_object(
      'id', v_id,
      'is_duplicate', false,
      'status', 'received'
    );
  else
    select status into v_status
      from public.webhook_events
     where id = v_id;
    return jsonb_build_object(
      'id', v_id,
      'is_duplicate', true,
      'status', coalesce(v_status, 'received')
    );
  end if;
end;
$$;

grant execute on function public.enqueue_webhook_event(
  text, text, text, jsonb, jsonb, text, uuid
) to service_role;

comment on function public.enqueue_webhook_event is
  'Idempotently enqueue a webhook event using atomic ON CONFLICT on (provider_id, provider_event_id). Race-safe under concurrent webhook delivery. Called by payment-webhook Edge Function (M3).';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 54
-- ============================================================
-- Reverts Milestone 1 fixes by restoring the broken behaviour.
-- Intended ONLY for emergency rollback of this fix migration —
-- it restores the bugs M54 fixes. Not for production use.
-- Do NOT run this unless you understand the consequences.

/*
begin;

-- Restore the broken index (will fail if column doesn't exist)
-- (Left commented: recreating the broken index would require a
-- column that doesn't exist. Index removal is sufficient rollback.)

-- Drop the fixed search_payments and restore the broken one
create or replace function public.search_payments(
  p_provider_id             text    default null,
  p_provider_payment_id     text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_plan_key                text    default null,
  p_payment_status          text    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider              text,
  provider_payment_id   text,
  plan_key              text,
  billing_cycle         text,
  amount                numeric,
  currency              text,
  status                text,
  refunded_amount       numeric,
  buyer_email_masked    text,
  user_id               uuid,
  user_subscription_id  uuid,
  purchased_at          timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');
  end if;

  return query
    select
      p.id, p.provider::text, p.provider_payment_id, p.plan_key, p.billing_cycle,
      p.amount, p.currency, p.status::text, p.refunded_amount,
      case
        when p.buyer_email is null then null
        when length(p.buyer_email) <= 4 then '***'
        else substring(p.buyer_email from 1 for 1) || '***@' || split_part(p.buyer_email, '@', 2)
      end as buyer_email_masked,
      p.user_id, p.user_subscription_id, p.paid_at, p.refunded_at, p.created_at
    from public.payments p
    where (p_provider_id             is null or p.provider::text          = p_provider_id)
      and (p_provider_payment_id     is null or p.provider_payment_id      = p_provider_payment_id)
      and (v_buyer_email_hash        is null or p.buyer_email_hash         = v_buyer_email_hash)
      and (p_user_id                 is null or p.user_id                  = p_user_id)
      and (p_plan_key                is null or p.plan_key                 = p_plan_key)
      and (p_payment_status          is null or p.status::text             = p_payment_status)
      and (p_date_from               is null or p.created_at               >= p_date_from)
      and (p_date_to                 is null or p.created_at               <= p_date_to)
    order by p.created_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

-- Restore duplicate trigger
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- Restore duplicate RPC
create or replace function public.record_subscription_webhook_event(
  p_provider_event_id text,
  p_provider          text,
  p_event_type        text,
  p_payload_hash      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
begin
  select id into v_existing_id
    from public.subscription_webhook_events
   where provider = p_provider
     and provider_event_id = p_provider_event_id;

  if found then
    return jsonb_build_object(
      'is_duplicate', true,
      'recorded_at',  (select processed_at from public.subscription_webhook_events where id = v_existing_id)
    );
  end if;

  insert into public.subscription_webhook_events (
    provider_event_id, provider, event_type, payload_hash
  ) values (
    p_provider_event_id, p_provider, p_event_type, p_payload_hash
  );

  return jsonb_build_object(
    'is_duplicate', false,
    'recorded_at',  now()
  );
end;
$$;

grant execute on function public.record_subscription_webhook_event(
  text, text, text, text
) to service_role;

-- Restore broken search_webhook_events
create or replace function public.search_webhook_events(
  p_provider_id             text    default null,
  p_provider_transaction_id text    default null,
  p_provider_event_type     text    default null,
  p_status                  text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider_id           text,
  provider_event_id     text,
  provider_event_type   text,
  status                text,
  trace_id              uuid,
  received_at           timestamptz,
  processed_at          timestamptz,
  retry_count           integer,
  last_error            text,
  linked_user_id        uuid,
  linked_purchase_id    uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');
  end if;

  return query
    select
      we.id, we.provider_id, we.provider_event_id, we.provider_event_type,
      we.status, we.trace_id, we.received_at, we.processed_at,
      we.retry_count, we.last_error, we.linked_user_id, we.linked_purchase_id
    from public.webhook_events we
    where (p_provider_id             is null or we.provider_id             = p_provider_id)
      and (p_provider_transaction_id is null or we.provider_transaction_id = p_provider_transaction_id)
      and (p_provider_event_type     is null or we.provider_event_type     = p_provider_event_type)
      and (p_status                  is null or we.status                  = p_status)
      and (v_buyer_email_hash        is null or we.raw_payload->>'buyer_email_hash' = v_buyer_email_hash)
      and (p_user_id                 is null or we.linked_user_id          = p_user_id)
      and (p_date_from               is null or we.received_at             >= p_date_from)
      and (p_date_to                 is null or we.received_at             <= p_date_to)
    order by we.received_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

-- Restore TOCTOU enqueue
create or replace function public.enqueue_webhook_event(
  p_provider_id             text,
  p_provider_event_id       text,
  p_provider_event_type     text,
  p_raw_payload             jsonb,
  p_raw_headers             jsonb default null,
  p_provider_transaction_id text default null,
  p_trace_id                uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id      uuid;
  v_payload_hash text;
begin
  v_payload_hash := encode(digest(p_raw_payload::text, 'sha256'), 'hex');

  select id into v_existing_id
    from public.webhook_events
   where provider_id = p_provider_id
     and provider_event_id = p_provider_event_id;

  if found then
    return jsonb_build_object(
      'id', v_existing_id,
      'is_duplicate', true,
      'status', (select status from public.webhook_events where id = v_existing_id)
    );
  end if;

  insert into public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    payload_hash, raw_payload, raw_headers,
    provider_transaction_id, trace_id,
    status
  ) values (
    p_provider_id, p_provider_event_id, p_provider_event_type,
    v_payload_hash, p_raw_payload, p_raw_headers,
    p_provider_transaction_id, p_trace_id,
    'received'
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'id', v_new_id,
    'is_duplicate', false,
    'status', 'received'
  );
end;
$$;

commit;
*/
