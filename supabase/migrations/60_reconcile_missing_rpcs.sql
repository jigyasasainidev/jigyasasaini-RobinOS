-- ============================================================
-- MIGRATION 60 — RECONCILE MISSING RPCs
-- ============================================================
-- Idempotent restoration of every required public RPC after the
-- final implementations defined in migrations 53–58. Uses
-- CREATE OR REPLACE FUNCTION for each function so the file is
-- safe to re-run.
--
-- Source of truth (latest migration that defines each function):
--   M58  safe_plan_switch, record_purchase_from_webhook,
--        grant_entitlement_from_purchase, process_webhook_event
--   M57  resolve_or_create_user_from_purchase
--   M56  _webhook_retry_delay_seconds, schedule_webhook_retry,
--        process_pending_webhook_events, get_webhook_queue_stats
--   M55  is_caller_admin, admin_list_providers, admin_get_provider,
--        admin_upsert_provider, admin_toggle_provider,
--        admin_list_provider_products, admin_upsert_provider_product,
--        admin_delete_provider_product, admin_get_payment_provider_summary
--   M54  search_payments, search_webhook_events, enqueue_webhook_event
--   M53  set_payments_buyer_hash (trigger fn), retry_webhook_event,
--        mark_webhook_dead_letter, revoke_entitlement_from_purchase,
--        recalculate_user_effective_plan, send_purchase_claim_email,
--        complete_purchase_claim
--
-- No DROP TABLE / DELETE / TRUNCATE / renames.
-- No INSERT / UPDATE / DELETE on user data tables.
-- All functions are CREATE OR REPLACE FUNCTION with public. qualifier.
-- ============================================================

begin;

-- ============================================================
-- M53 — set_payments_buyer_hash (trigger function)
-- ============================================================

create or replace function public.set_payments_buyer_hash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.buyer_email is not null and new.buyer_email_hash is null then
    new.buyer_email_hash := encode(
      digest(lower(trim(new.buyer_email)), 'sha256'),
      'hex'
    );
  end if;
  return new;
end;
$$;

-- ============================================================
-- M53 — retry_webhook_event
-- ============================================================

create or replace function public.retry_webhook_event(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.webhook_events
   where id = p_webhook_event_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'webhook_event_not_found');
  end if;

  if v_status not in ('failed_terminal', 'failed_retryable', 'blocked', 'awaiting_admin') then
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_status_for_retry',
      'current_status', v_status
    );
  end if;

  update public.webhook_events
     set status = 'received',
         retry_count = 0,
         next_retry_at = null,
         last_error = null,
         last_error_at = null,
         updated_at = now()
   where id = p_webhook_event_id;

  return jsonb_build_object('success', true, 'webhook_event_id', p_webhook_event_id);
end;
$$;

grant execute on function public.retry_webhook_event(uuid) to service_role;

-- ============================================================
-- M53 — mark_webhook_dead_letter
-- ============================================================

create or replace function public.mark_webhook_dead_letter(
  p_webhook_event_id uuid,
  p_reason           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.webhook_events
     set status = 'failed_terminal',
         last_error = p_reason,
         last_error_at = now(),
         error_history = error_history || jsonb_build_object(
           'error', p_reason,
           'timestamp', now()
         ),
         updated_at = now()
   where id = p_webhook_event_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'webhook_event_not_found');
  end if;

  return jsonb_build_object('success', true, 'webhook_event_id', p_webhook_event_id);
end;
$$;

grant execute on function public.mark_webhook_dead_letter(uuid, text) to service_role;

-- ============================================================
-- M53 — revoke_entitlement_from_purchase (stub)
-- ============================================================
-- Final implementation is the M53 stub (M7 did not ship). The
-- function still exists with the correct signature so callers
-- that already reference it continue to compile.

create or replace function public.revoke_entitlement_from_purchase(
  p_purchase_id uuid,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'revoke_entitlement_from_purchase: not yet implemented (scheduled for Milestone 7)';
end;
$$;

grant execute on function public.revoke_entitlement_from_purchase(uuid, text) to service_role;

-- ============================================================
-- M53 — recalculate_user_effective_plan (stub)
-- ============================================================
-- Final implementation is the M53 stub.

create or replace function public.recalculate_user_effective_plan(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'recalculate_user_effective_plan: not yet implemented (scheduled for Milestone 5)';
end;
$$;

grant execute on function public.recalculate_user_effective_plan(uuid) to service_role;

-- ============================================================
-- M53 — send_purchase_claim_email (stub)
-- ============================================================
-- Final implementation is the M53 stub.

create or replace function public.send_purchase_claim_email(
  p_purchase_id  uuid,
  p_buyer_email  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'send_purchase_claim_email: not yet implemented (scheduled for Milestone 9)';
end;
$$;

grant execute on function public.send_purchase_claim_email(uuid, text) to service_role;

-- ============================================================
-- M53 — complete_purchase_claim (stub)
-- ============================================================
-- Final implementation is the M53 stub.

create or replace function public.complete_purchase_claim(
  p_claim_token   uuid,
  p_account_data  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'complete_purchase_claim: not yet implemented (scheduled for Milestone 9)';
end;
$$;

grant execute on function public.complete_purchase_claim(uuid, jsonb) to service_role;

-- ============================================================
-- M54 — enqueue_webhook_event (FIX 6: atomic ON CONFLICT)
-- ============================================================

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

-- ============================================================
-- M54 — search_payments (FIX 2: subscription_id alias)
-- ============================================================

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

-- ============================================================
-- M54 — search_webhook_events (FIX 5: join through payments)
-- ============================================================

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

-- ============================================================
-- M55 — is_caller_admin
-- ============================================================

create or replace function public.is_caller_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'),
    false
  );
$$;

grant execute on function public.is_caller_admin() to service_role;

-- ============================================================
-- M55 — admin_list_providers
-- ============================================================

create or replace function public.admin_list_providers()
returns table (
  id                          text,
  display_name                text,
  adapter_version             text,
  is_enabled                  boolean,
  is_test_mode                boolean,
  require_signature_verification boolean,
  webhook_url                 text,
  notes                       text,
  product_count               bigint,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_list_providers: admin access required';
  end if;

  return query
    select
      pp.id,
      pp.display_name,
      pp.adapter_version,
      pp.is_enabled,
      pp.is_test_mode,
      pp.require_signature_verification,
      pp.webhook_url,
      pp.notes,
      coalesce(count(pr.id), 0) as product_count,
      pp.created_at,
      pp.updated_at
    from public.payment_providers pp
    left join public.provider_products pr on pr.provider_id = pp.id
    group by pp.id, pp.display_name, pp.adapter_version, pp.is_enabled,
             pp.is_test_mode, pp.require_signature_verification,
             pp.webhook_url, pp.notes, pp.created_at, pp.updated_at
    order by pp.id;
end;
$$;

grant execute on function public.admin_list_providers() to service_role;

-- ============================================================
-- M55 — admin_get_provider
-- ============================================================

create or replace function public.admin_get_provider(p_id text)
returns table (
  id                          text,
  display_name                text,
  adapter_version             text,
  is_enabled                  boolean,
  is_test_mode                boolean,
  require_signature_verification boolean,
  config                      jsonb,
  allowed_ip_ranges           cidr[],
  webhook_url                 text,
  notes                       text,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_get_provider: admin access required';
  end if;

  return query
    select
      pp.id, pp.display_name, pp.adapter_version, pp.is_enabled,
      pp.is_test_mode, pp.require_signature_verification,
      pp.config, pp.allowed_ip_ranges, pp.webhook_url, pp.notes,
      pp.created_at, pp.updated_at
    from public.payment_providers pp
    where pp.id = p_id;
end;
$$;

grant execute on function public.admin_get_provider(text) to service_role;

-- ============================================================
-- M55 — admin_upsert_provider
-- ============================================================

create or replace function public.admin_upsert_provider(
  p_id                          text,
  p_display_name                text,
  p_is_enabled                  boolean default false,
  p_is_test_mode                boolean default false,
  p_require_signature_verification boolean default true,
  p_webhook_url                 text default null,
  p_notes                       text default null,
  p_config                      jsonb default '{}'::jsonb,
  p_allowed_ip_ranges           cidr[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_result jsonb;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_upsert_provider: admin access required';
  end if;

  -- Validate inputs
  if p_id is null or length(trim(p_id)) = 0 then
    raise exception 'admin_upsert_provider: provider id is required';
  end if;
  if length(p_id) > 64 then
    raise exception 'admin_upsert_provider: provider id must be <= 64 chars';
  end if;
  if p_id !~ '^[a-z0-9_-]+$' then
    raise exception 'admin_upsert_provider: provider id must match ^[a-z0-9_-]+$';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'admin_upsert_provider: display_name is required';
  end if;
  if length(p_display_name) > 120 then
    raise exception 'admin_upsert_provider: display_name must be <= 120 chars';
  end if;
  if p_webhook_url is not null and length(p_webhook_url) > 0 then
    if p_webhook_url !~ '^https?://' then
      raise exception 'admin_upsert_provider: webhook_url must start with http(s)://';
    end if;
  end if;

  insert into public.payment_providers (
    id, display_name, is_enabled, is_test_mode,
    require_signature_verification, webhook_url, notes, config,
    allowed_ip_ranges
  ) values (
    p_id, p_display_name, p_is_enabled, p_is_test_mode,
    p_require_signature_verification, p_webhook_url, p_notes, p_config,
    p_allowed_ip_ranges
  )
  on conflict (id) do update set
    display_name                = excluded.display_name,
    is_enabled                  = excluded.is_enabled,
    is_test_mode                = excluded.is_test_mode,
    require_signature_verification = excluded.require_signature_verification,
    webhook_url                 = excluded.webhook_url,
    notes                       = excluded.notes,
    config                      = excluded.config,
    allowed_ip_ranges           = excluded.allowed_ip_ranges,
    updated_at                  = now()
  returning id into v_id;

  select jsonb_build_object(
    'id',          v_id,
    'is_enabled',  p_is_enabled,
    'updated',     true
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_upsert_provider(
  text, text, boolean, boolean, boolean, text, text, jsonb, cidr[]
) to service_role;

-- ============================================================
-- M55 — admin_toggle_provider
-- ============================================================

create or replace function public.admin_toggle_provider(
  p_id         text,
  p_is_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated timestamptz;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_toggle_provider: admin access required';
  end if;

  update public.payment_providers
     set is_enabled = p_is_enabled,
         updated_at = now()
   where id = p_id
   returning updated_at into v_updated;

  if v_updated is null then
    raise exception 'admin_toggle_provider: provider "%" not found', p_id;
  end if;

  return jsonb_build_object(
    'id',         p_id,
    'is_enabled', p_is_enabled,
    'updated_at', v_updated
  );
end;
$$;

grant execute on function public.admin_toggle_provider(text, boolean) to service_role;

-- ============================================================
-- M55 — admin_list_provider_products
-- ============================================================

create or replace function public.admin_list_provider_products(
  p_provider_id text
)
returns table (
  id                    uuid,
  provider_id           text,
  provider_product_id   text,
  provider_offer_id     text,
  plan_key              text,
  billing_cycle         text,
  duration_value        numeric,
  duration_unit         text,
  amount                numeric,
  currency              text,
  is_subscription       boolean,
  is_enabled            boolean,
  display_name          text,
  description           text,
  metadata              jsonb,
  created_at            timestamptz,
  updated_at            timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_list_provider_products: admin access required';
  end if;

  return query
    select
      pr.id, pr.provider_id, pr.provider_product_id, pr.provider_offer_id,
      pr.plan_key, pr.billing_cycle, pr.duration_value, pr.duration_unit,
      pr.amount, pr.currency, pr.is_subscription, pr.is_enabled,
      pr.display_name, pr.description, pr.metadata,
      pr.created_at, pr.updated_at
    from public.provider_products pr
    where pr.provider_id = p_provider_id
    order by pr.created_at desc;
end;
$$;

grant execute on function public.admin_list_provider_products(text) to service_role;

-- ============================================================
-- M55 — admin_upsert_provider_product
-- ============================================================

create or replace function public.admin_upsert_provider_product(
  p_id                  uuid    default null,
  p_provider_id         text    default null,
  p_provider_product_id text    default null,
  p_provider_offer_id   text    default null,
  p_plan_key            text    default null,
  p_billing_cycle       text    default null,
  p_duration_value      numeric default null,
  p_duration_unit       text    default null,
  p_amount              numeric default null,
  p_currency            text    default 'USD',
  p_is_subscription     boolean default false,
  p_is_enabled          boolean default true,
  p_display_name        text    default null,
  p_description         text    default null,
  p_metadata            jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id            uuid;
  v_provider_id   text;
  v_duplicate_id  uuid;
  v_is_update     boolean;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_upsert_provider_product: admin access required';
  end if;

  -- Branch on create vs update
  v_is_update := p_id is not null;

  if v_is_update then
    -- Update path: required fields may be absent; use existing values for nulls
    select provider_id into v_provider_id
      from public.provider_products
     where id = p_id;
    if v_provider_id is null then
      raise exception 'admin_upsert_provider_product: product id "%" not found', p_id;
    end if;
  else
    -- Insert path: all required fields must be present
    if p_provider_id is null or length(trim(p_provider_id)) = 0 then
      raise exception 'admin_upsert_provider_product: provider_id is required';
    end if;
    if p_provider_product_id is null or length(trim(p_provider_product_id)) = 0 then
      raise exception 'admin_upsert_provider_product: provider_product_id is required';
    end if;
    if p_plan_key is null then
      raise exception 'admin_upsert_provider_product: plan_key is required';
    end if;
    if p_billing_cycle is null then
      raise exception 'admin_upsert_provider_product: billing_cycle is required';
    end if;
    if p_duration_value is null then
      raise exception 'admin_upsert_provider_product: duration_value is required';
    end if;
    if p_duration_unit is null then
      raise exception 'admin_upsert_provider_product: duration_unit is required';
    end if;
    if p_amount is null then
      raise exception 'admin_upsert_provider_product: amount is required';
    end if;
    v_provider_id := p_provider_id;
  end if;

  -- Field-level validation (applies to both insert and update)
  if p_plan_key is not null and p_plan_key not in ('free', 'creator', 'pro_creator', 'agency') then
    raise exception 'admin_upsert_provider_product: plan_key "%" is not one of (free, creator, pro_creator, agency)', p_plan_key;
  end if;
  if p_billing_cycle is not null and p_billing_cycle not in ('monthly', 'yearly', 'one_time') then
    raise exception 'admin_upsert_provider_product: billing_cycle "%" is not one of (monthly, yearly, one_time)', p_billing_cycle;
  end if;
  if p_duration_unit is not null and p_duration_unit not in ('day', 'week', 'month', 'year') then
    raise exception 'admin_upsert_provider_product: duration_unit "%" is not one of (day, week, month, year)', p_duration_unit;
  end if;
  if p_duration_value is not null and p_duration_value <= 0 then
    raise exception 'admin_upsert_provider_product: duration_value must be > 0';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'admin_upsert_provider_product: amount must be >= 0';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'admin_upsert_provider_product: currency must be a 3-letter ISO code (uppercase)';
  end if;
  if p_provider_product_id is not null and length(p_provider_product_id) > 64 then
    raise exception 'admin_upsert_provider_product: provider_product_id must be <= 64 chars';
  end if;
  if p_provider_offer_id is not null and length(p_provider_offer_id) > 64 then
    raise exception 'admin_upsert_provider_product: provider_offer_id must be <= 64 chars';
  end if;
  if p_display_name is not null and length(p_display_name) > 120 then
    raise exception 'admin_upsert_provider_product: display_name must be <= 120 chars';
  end if;

  -- Duplicate detection on (provider_id, provider_product_id, provider_offer_id).
  -- The UNIQUE constraint exists, but we catch it explicitly to return a structured error.
  if v_is_update then
    select id into v_duplicate_id
      from public.provider_products
     where provider_id           = v_provider_id
       and provider_product_id   = coalesce(p_provider_product_id, provider_product_id)
       and coalesce(provider_offer_id, '') = coalesce(p_provider_offer_id, '')
       and id <> p_id
     limit 1;
  else
    select id into v_duplicate_id
      from public.provider_products
     where provider_id           = p_provider_id
       and provider_product_id   = p_provider_product_id
       and coalesce(provider_offer_id, '') = coalesce(p_provider_offer_id, '')
     limit 1;
  end if;

  if v_duplicate_id is not null then
    raise exception 'DUPLICATE_PRODUCT_MAPPING:%', v_duplicate_id
      using errcode = 'P0001';
  end if;

  if v_is_update then
    update public.provider_products
       set provider_product_id   = coalesce(p_provider_product_id, provider_product_id),
           provider_offer_id     = p_provider_offer_id,
           plan_key              = coalesce(p_plan_key, plan_key),
           billing_cycle         = coalesce(p_billing_cycle, billing_cycle),
           duration_value        = coalesce(p_duration_value, duration_value),
           duration_unit         = coalesce(p_duration_unit, duration_unit),
           amount                = coalesce(p_amount, amount),
           currency              = coalesce(p_currency, currency),
           is_subscription       = coalesce(p_is_subscription, is_subscription),
           is_enabled            = coalesce(p_is_enabled, is_enabled),
           display_name          = p_display_name,
           description           = p_description,
           metadata              = coalesce(p_metadata, metadata),
           updated_at            = now()
     where id = p_id
     returning id into v_id;
  else
    insert into public.provider_products (
      provider_id, provider_product_id, provider_offer_id,
      plan_key, billing_cycle, duration_value, duration_unit,
      amount, currency, is_subscription, is_enabled,
      display_name, description, metadata
    ) values (
      p_provider_id, p_provider_product_id, p_provider_offer_id,
      p_plan_key, p_billing_cycle, p_duration_value, p_duration_unit,
      p_amount, p_currency, p_is_subscription, p_is_enabled,
      p_display_name, p_description, p_metadata
    )
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'id',         v_id,
    'provider_id', v_provider_id,
    'is_update',  v_is_update
  );
end;
$$;

grant execute on function public.admin_upsert_provider_product(
  uuid, text, text, text, text, text, numeric, text,
  numeric, text, boolean, boolean, text, text, jsonb
) to service_role;

-- ============================================================
-- M55 — admin_delete_provider_product
-- ============================================================

create or replace function public.admin_delete_provider_product(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_id text;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_delete_provider_product: admin access required';
  end if;

  select provider_id into v_provider_id
    from public.provider_products
   where id = p_id;

  if v_provider_id is null then
    raise exception 'admin_delete_provider_product: product id "%" not found', p_id;
  end if;

  delete from public.provider_products where id = p_id;

  return jsonb_build_object(
    'id',          p_id,
    'provider_id', v_provider_id,
    'deleted',     true
  );
end;
$$;

grant execute on function public.admin_delete_provider_product(uuid) to service_role;

-- ============================================================
-- M55 — admin_get_payment_provider_summary
-- ============================================================

create or replace function public.admin_get_payment_provider_summary()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_provider_count      bigint;
  v_enabled_count       bigint;
  v_product_count       bigint;
  v_active_product_count bigint;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_get_payment_provider_summary: admin access required';
  end if;

  select count(*) into v_provider_count from public.payment_providers;
  select count(*) into v_enabled_count from public.payment_providers where is_enabled = true;
  select count(*) into v_product_count from public.provider_products;
  select count(*) into v_active_product_count from public.provider_products where is_enabled = true;

  return jsonb_build_object(
    'provider_count',       v_provider_count,
    'enabled_count',        v_enabled_count,
    'product_count',        v_product_count,
    'active_product_count', v_active_product_count
  );
end;
$$;

grant execute on function public.admin_get_payment_provider_summary() to service_role;

-- ============================================================
-- M56 — _webhook_retry_delay_seconds
-- ============================================================

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

-- ============================================================
-- M56 — schedule_webhook_retry
-- ============================================================

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

-- ============================================================
-- M56 — process_pending_webhook_events
-- ============================================================

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

-- ============================================================
-- M56 — get_webhook_queue_stats
-- ============================================================

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

-- ============================================================
-- M57 — resolve_or_create_user_from_purchase
-- ============================================================

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

-- ============================================================
-- M58 — safe_plan_switch (8-param form with p_expires_at)
-- ============================================================

create or replace function public.safe_plan_switch(
  p_user_id           uuid,
  p_new_plan          text,
  p_billing_cycle     text        default 'monthly',
  p_provider          text        default null,
  p_provider_sub_id   text        default null,
  p_amount            numeric     default 0,
  p_triggered_by      text        default 'webhook',
  p_expires_at        timestamptz default null   -- M6 NEW: explicit expiry override
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now              timestamptz := now() at time zone 'UTC';
  v_normalized       text;
  v_old_plan         text;
  v_old_status       text;
  v_expires_at       timestamptz;
  v_period_start     timestamptz;
  v_period_end       timestamptz;
  v_next_billing_at  timestamptz;
  v_duration         integer;
begin
  -- Normalize plan key
  v_normalized := lower(p_new_plan);
  case v_normalized
    when 'starter','basic'  then v_normalized := 'creator';
    when 'pro','premium'    then v_normalized := 'pro_creator';
    when 'scale_agency'     then v_normalized := 'agency';
    else null;
  end case;

  if v_normalized not in ('free','creator','pro_creator','agency') then
    return jsonb_build_object('success',false,'code','INVALID_PLAN',
      'message','Invalid plan: ' || p_new_plan);
  end if;

  -- Get current state
  select plan, status
    into v_old_plan, v_old_status
    from public.user_subscriptions
   where user_id = p_user_id
   limit 1;

  -- Compute duration: p_expires_at wins over billing_cycle default.
  -- This is the M6 extension point: provider-defined durations
  -- (e.g. 6 months from provider_products.duration_value) are honored.
  if p_expires_at is not null then
    v_expires_at      := p_expires_at;
    v_period_start    := v_now;
    v_period_end      := p_expires_at;
    v_next_billing_at := p_expires_at;  -- one-time purchases: informational
    v_duration        := ceil(extract(epoch from (p_expires_at - v_now)) / 86400)::integer;
  else
    v_duration := case lower(coalesce(p_billing_cycle,'monthly'))
      when 'yearly' then 365
      else 30
    end;
    v_expires_at      := v_now + (v_duration || ' days')::interval;
    v_period_start    := v_now;
    v_period_end      := v_expires_at;
    v_next_billing_at := v_expires_at;
  end if;

  -- Upsert subscription row
  insert into public.user_subscriptions
    (user_id, plan, status, billing_cycle, starts_at, expires_at,
     current_period_start, current_period_end,
     last_plan_change_at, last_payment_at, next_billing_at,
     provider, provider_subscription_id,
     subscription_source, is_revenue_eligible,
     amount, currency, auto_renew, granted_by_admin)
  values
    (p_user_id, v_normalized, 'active', p_billing_cycle,
     v_period_start, v_expires_at,
     v_period_start, v_period_end,
     v_now, v_now, v_next_billing_at,
     p_provider, p_provider_sub_id,
     coalesce(p_provider,'manual_admin'), (p_provider is not null),
     p_amount, 'USD', true, false)
  on conflict (user_id) do update set
    plan                  = v_normalized,
    status                = 'active',
    billing_cycle         = p_billing_cycle,
    starts_at             = v_period_start,
    expires_at            = v_expires_at,
    current_period_start  = v_period_start,
    current_period_end    = v_period_end,
    last_plan_change_at   = v_now,
    last_payment_at       = v_now,
    next_billing_at       = v_next_billing_at,
    grace_period_ends_at  = null,  -- clear grace on renewal
    reminder_dismissed_until = null,  -- reset reminder on renewal
    provider              = coalesce(p_provider, public.user_subscriptions.provider),
    provider_subscription_id = coalesce(p_provider_sub_id, public.user_subscriptions.provider_subscription_id),
    is_revenue_eligible   = (p_provider is not null),
    amount                = p_amount,
    auto_renew            = true,
    granted_by_admin      = false,
    updated_at            = v_now;

  -- Update profile immediately
  update public.profiles
     set subscription_tier       = v_normalized,
         current_plan            = v_normalized,
         subscription_expires_at = v_expires_at,
         updated_at              = v_now
   where user_id = p_user_id;

  -- Log the switch
  perform public.log_subscription_event(
    p_user_id, 'plan_switch',
    v_old_plan, v_normalized,
    v_old_status, 'active',
    p_triggered_by,
    jsonb_build_object(
      'billing_cycle', p_billing_cycle,
      'provider', p_provider,
      'amount', p_amount,
      'expires_at', v_expires_at,
      'explicit_expires_at', (p_expires_at is not null)
    )
  );

  return jsonb_build_object(
    'success',    true,
    'plan',       v_normalized,
    'expires_at', v_expires_at,
    'switched_at', v_now,
    'duration_days', v_duration,
    'explicit_expires_at', (p_expires_at is not null)
  );
end;
$$;

grant execute on function public.safe_plan_switch(
  uuid, text, text, text, text, numeric, text, timestamptz
) to service_role;

-- ============================================================
-- M58 — record_purchase_from_webhook
-- ============================================================

create or replace function public.record_purchase_from_webhook(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event              record;
  v_product            record;
  v_provider_product_id text;
  v_provider_offer_id  text;
  v_amount             numeric;
  v_currency           text;
  v_buyer_email        text;
  v_buyer_email_hash   text;
  v_buyer_name         text;
  v_buyer_country      text;
  v_purchase_id        uuid;
  v_existing_id        uuid;
  v_payment_status     text;
  v_billing_cycle      text;
  v_standardized_event text;
begin
  -- ── 1. Load webhook event (must be verified + linked_user_id set) ──
  select * into v_event
  from public.webhook_events
  where id = p_webhook_event_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'WEBHOOK_NOT_FOUND',
      'webhook_event_id', p_webhook_event_id);
  end if;

  if v_event.linked_user_id is null then
    -- M6 only acts on resolved-existing-user rows. Guests (awaiting_claim)
    -- and unverified rows are NOT processed here.
    return jsonb_build_object('success', false, 'code', 'USER_NOT_RESOLVED',
      'message', 'webhook has no linked_user_id (awaiting_claim or unverified)');
  end if;

  if v_event.status not in ('verified', 'processing') then
    return jsonb_build_object('success', false, 'code', 'WEBHOOK_NOT_READY',
      'status', v_event.status,
      'message', 'webhook must be in verified or processing state');
  end if;

  -- ── 2. Extract provider product identifiers from raw_payload ──
  -- WarriorPlus uses WP_ITEM_NUMBER; canonical key for future adapters
  -- is provider_product_id. Accept either.
  v_provider_product_id := coalesce(
    nullif(btrim(coalesce(v_event.raw_payload->>'provider_product_id', '')), ''),
    nullif(btrim(coalesce(v_event.raw_payload->>'WP_ITEM_NUMBER', '')), '')
  );

  if v_provider_product_id is null then
    return jsonb_build_object('success', false, 'code', 'MISSING_PRODUCT_ID',
      'message', 'raw_payload has no provider_product_id / WP_ITEM_NUMBER');
  end if;

  v_provider_offer_id := nullif(
    btrim(coalesce(
      v_event.raw_payload->>'provider_offer_id',
      v_event.raw_payload->>'WP_OFFER_ID',
      ''
    )),
    ''
  );

  -- ── 3. Look up provider_products mapping ──
  -- The UNIQUE INDEX on (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
  -- (M52) guarantees at most one row per (provider, product, offer).
  select * into v_product
  from public.provider_products
  where provider_id = v_event.provider_id
    and provider_product_id = v_provider_product_id
    and coalesce(provider_offer_id, '') = coalesce(v_provider_offer_id, '')
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_MAPPING_NOT_FOUND',
      'provider_id', v_event.provider_id,
      'provider_product_id', v_provider_product_id,
      'provider_offer_id', v_provider_offer_id);
  end if;

  if not v_product.is_enabled then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_DISABLED',
      'provider_product_id', v_provider_product_id,
      'plan_key', v_product.plan_key);
  end if;

  if v_product.duration_value is null or v_product.duration_value <= 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_DURATION',
      'message', 'provider_products.duration_value must be > 0',
      'duration_value', v_product.duration_value,
      'duration_unit', v_product.duration_unit);
  end if;

  -- ── 4. Determine payment_status from standardized_event_type ──
  -- For now, only 'purchase.created' and 'subscription.created'
  -- produce a completed payment. Refunds / disputes (M7/M8) will
  -- produce their own status. Other event types are ignored here.
  v_standardized_event := coalesce(v_event.standardized_event_type, '');

  if v_standardized_event in ('purchase.created', 'subscription.created', 'subscription.renewed') then
    v_payment_status := 'completed';
  else
    return jsonb_build_object('success', false, 'code', 'UNSUPPORTED_EVENT_TYPE',
      'standardized_event_type', v_standardized_event,
      'message', 'M6 only processes purchase.created / subscription.created / subscription.renewed');
  end if;

  -- ── 5. Extract buyer info + amount from raw_payload ──
  v_buyer_email := coalesce(
    nullif(btrim(coalesce(v_event.raw_payload->>'buyer_email', '')), ''),
    nullif(btrim(coalesce(v_event.raw_payload->>'WP_BUYER_EMAIL', '')), '')
  );

  if v_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(v_buyer_email), 'sha256'), 'hex');
  end if;

  v_buyer_name := nullif(
    btrim(coalesce(
      v_event.raw_payload->>'buyer_name',
      v_event.raw_payload->>'WP_BUYER_NAME',
      ''
    )),
    ''
  );

  v_buyer_country := nullif(
    btrim(coalesce(
      v_event.raw_payload->>'buyer_country',
      v_event.raw_payload->>'WP_BUYER_COUNTRY',
      ''
    )),
    ''
  );

  -- Amount: prefer provider_payload, fall back to product config
  v_amount := coalesce(
    nullif(btrim(coalesce(v_event.raw_payload->>'amount', '')), '')::numeric,
    nullif(btrim(coalesce(v_event.raw_payload->>'WP_SALE_AMOUNT', '')), '')::numeric,
    v_product.amount
  );

  v_currency := coalesce(
    nullif(btrim(coalesce(v_event.raw_payload->>'currency', '')), ''),
    nullif(btrim(coalesce(v_event.raw_payload->>'WP_SALE_CURRENCY', '')), ''),
    v_product.currency
  );

  v_billing_cycle := v_product.billing_cycle;

  -- ── 6. Idempotent INSERT into public.payments ──
  -- The UNIQUE INDEX idx_payments_provider_event on
  -- (provider, provider_payment_id) prevents duplicate rows.
  -- If a row already exists, we return its id with is_new=false.
  begin
    insert into public.payments (
      user_id, subscription_id, provider, provider_payment_id,
      amount, currency, status, billing_cycle,
      buyer_email, buyer_email_hash, buyer_name, buyer_country,
      plan_key, source_webhook_event_id,
      refunded_amount, metadata, paid_at
    )
    values (
      v_event.linked_user_id, null, v_event.provider_id::public.payment_provider,
      coalesce(v_event.provider_transaction_id, v_event.provider_event_id),
      v_amount, v_currency, v_payment_status::public.payment_status, v_billing_cycle::public.billing_cycle,
      v_buyer_email, v_buyer_email_hash, v_buyer_name, v_buyer_country,
      v_product.plan_key, v_event.id,
      0, jsonb_build_object('provider_event_type', v_event.provider_event_type), now()
    )
    returning id into v_purchase_id;

    -- Link the webhook row to the new purchase
    update public.webhook_events
       set linked_purchase_id = v_purchase_id
     where id = v_event.id;

    return jsonb_build_object(
      'success', true,
      'purchase_id', v_purchase_id,
      'is_new_purchase', true,
      'plan_key', v_product.plan_key,
      'billing_cycle', v_billing_cycle,
      'amount', v_amount,
      'currency', v_currency,
      'webhook_event_id', v_event.id
    );

  exception when unique_violation then
    -- Existing payment row; look it up and return its id.
    select id into v_existing_id
    from public.payments
    where provider = v_event.provider_id::public.payment_provider
      and provider_payment_id = coalesce(v_event.provider_transaction_id, v_event.provider_event_id)
    limit 1;

    if v_existing_id is not null then
      -- Still link the webhook row (idempotent)
      update public.webhook_events
         set linked_purchase_id = v_existing_id
       where id = v_event.id and linked_purchase_id is null;

      return jsonb_build_object(
        'success', true,
        'purchase_id', v_existing_id,
        'is_new_purchase', false,
        'plan_key', v_product.plan_key,
        'billing_cycle', v_billing_cycle,
        'amount', v_amount,
        'currency', v_currency,
        'webhook_event_id', v_event.id,
        'message', 'Purchase already recorded (idempotent)'
      );
    else
      -- Should not happen: unique violation but no row found.
      raise exception 'unique_violation_without_existing_row';
    end if;
  end;
end;
$$;

grant execute on function public.record_purchase_from_webhook(uuid) to service_role;

-- ============================================================
-- M58 — grant_entitlement_from_purchase
-- ============================================================

create or replace function public.grant_entitlement_from_purchase(
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase             record;
  v_event                record;
  v_product              record;
  v_provider_offer_id    text;
  v_expires_at           timestamptz;
  v_subscription_id      uuid;
  v_plan_switch_result   jsonb;
  v_duration_days        integer;
  v_interval_unit        text;
  v_already_granted      boolean := false;
begin
  -- ── 1. Load purchase row ──
  select * into v_purchase
  from public.payments
  where id = p_purchase_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'PURCHASE_NOT_FOUND',
      'purchase_id', p_purchase_id);
  end if;

  if v_purchase.user_id is null then
    return jsonb_build_object('success', false, 'code', 'USER_NOT_RESOLVED',
      'message', 'purchase has no user_id');
  end if;

  if v_purchase.source_webhook_event_id is null then
    return jsonb_build_object('success', false, 'code', 'NO_SOURCE_WEBHOOK',
      'message', 'purchase was not created from a webhook');
  end if;

  -- ── 2. Idempotency: if the purchase already has subscription_id,
  --       grant has already happened. Return success without re-running. ──
  if v_purchase.subscription_id is not null then
    -- Verify the subscription row still exists and is correct
    select * into v_event from public.webhook_events
    where id = v_purchase.source_webhook_event_id;

    select * into v_product
    from public.provider_products
    where provider_id = v_event.provider_id
      and provider_product_id = coalesce(
        nullif(btrim(coalesce(v_event.raw_payload->>'provider_product_id', '')), ''),
        nullif(btrim(coalesce(v_event.raw_payload->>'WP_ITEM_NUMBER', '')), '')
      )
    limit 1;

    v_duration_days := ceil(extract(epoch from (
      (select expires_at from public.user_subscriptions where id = v_purchase.subscription_id)
      - now()
    )) / 86400)::integer;

    return jsonb_build_object(
      'success', true,
      'already_granted', true,
      'user_id', v_purchase.user_id,
      'subscription_id', v_purchase.subscription_id,
      'plan', v_purchase.plan_key,
      'duration_days_remaining', v_duration_days,
      'message', 'Entitlement already granted (idempotent no-op)'
    );
  end if;

  -- ── 3. Load webhook + provider_products ──
  select * into v_event
  from public.webhook_events
  where id = v_purchase.source_webhook_event_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'WEBHOOK_NOT_FOUND',
      'source_webhook_event_id', v_purchase.source_webhook_event_id);
  end if;

  v_provider_offer_id := nullif(
    btrim(coalesce(
      v_event.raw_payload->>'provider_offer_id',
      v_event.raw_payload->>'WP_OFFER_ID',
      ''
    )),
    ''
  );

  select * into v_product
  from public.provider_products
  where provider_id = v_event.provider_id
    and provider_product_id = coalesce(
      nullif(btrim(coalesce(v_event.raw_payload->>'provider_product_id', '')), ''),
      nullif(btrim(coalesce(v_event.raw_payload->>'WP_ITEM_NUMBER', '')), '')
    )
    and coalesce(provider_offer_id, '') = coalesce(v_provider_offer_id, '')
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_MAPPING_NOT_FOUND',
      'webhook_event_id', v_event.id);
  end if;

  -- ── 4. Compute expires_at from duration_value + duration_unit ──
  if v_product.duration_value is null or v_product.duration_value <= 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_DURATION',
      'duration_value', v_product.duration_value,
      'duration_unit', v_product.duration_unit);
  end if;

  -- Map duration_unit to PostgreSQL interval qualifier.
  -- Validated values from provider_products.duration_unit CHECK
  -- constraint (M52): 'day' | 'week' | 'month' | 'year'.
  v_interval_unit := case lower(v_product.duration_unit)
    when 'day'   then 'days'
    when 'week'  then 'weeks'
    when 'month' then 'months'
    when 'year'  then 'years'
    else null
  end;

  if v_interval_unit is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_DURATION_UNIT',
      'duration_unit', v_product.duration_unit);
  end if;

  v_expires_at := now() + (v_product.duration_value || ' ' || v_interval_unit)::interval;
  v_duration_days := ceil(v_product.duration_value * case v_interval_unit
    when 'days'  then 1
    when 'weeks' then 7
    when 'months' then 30
    when 'years' then 365
    else 1
  end)::integer;

  -- ── 5. Call safe_plan_switch with the explicit expires_at ──
  v_plan_switch_result := public.safe_plan_switch(
    p_user_id         => v_purchase.user_id,
    p_new_plan        => v_product.plan_key,
    p_billing_cycle   => v_product.billing_cycle,
    p_provider        => v_purchase.provider::text,
    p_provider_sub_id => coalesce(v_purchase.provider_subscription_id, v_event.provider_transaction_id),
    p_amount          => v_purchase.amount,
    p_triggered_by    => 'warriorplus_webhook',
    p_expires_at      => v_expires_at
  );

  if coalesce((v_plan_switch_result->>'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'code',    coalesce(v_plan_switch_result->>'code', 'SAFE_PLAN_SWITCH_FAILED'),
      'message', coalesce(v_plan_switch_result->>'message', 'safe_plan_switch failed'),
      'plan_switch_result', v_plan_switch_result
    );
  end if;

  -- ── 6. Link payments.subscription_id to the new subscription row ──
  select id into v_subscription_id
  from public.user_subscriptions
  where user_id = v_purchase.user_id
  limit 1;

  update public.payments
     set subscription_id = v_subscription_id,
         updated_at = now()
   where id = p_purchase_id;

  -- ── 7. Set profiles.primary_payment_provider if not already set ──
  update public.profiles
     set primary_payment_provider = coalesce(primary_payment_provider, v_purchase.provider::text),
         updated_at = now()
   where user_id = v_purchase.user_id
     and primary_payment_provider is null;

  return jsonb_build_object(
    'success', true,
    'already_granted', false,
    'user_id', v_purchase.user_id,
    'subscription_id', v_subscription_id,
    'plan', v_product.plan_key,
    'billing_cycle', v_product.billing_cycle,
    'amount', v_purchase.amount,
    'currency', v_purchase.currency,
    'expires_at', v_expires_at,
    'duration_days', v_duration_days,
    'duration_value', v_product.duration_value,
    'duration_unit', v_product.duration_unit,
    'purchase_id', p_purchase_id
  );
end;
$$;

grant execute on function public.grant_entitlement_from_purchase(uuid) to service_role;

-- ============================================================
-- M58 — process_webhook_event
-- ============================================================

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

  -- M5 variables
  v_buyer_email           text;
  v_buyer_name            text;
  v_provider_customer_id  text;
  v_resolution            jsonb;
  v_resolution_outcome    text;
  v_resolved_user_id      uuid;
  v_email_hash            text;

  -- M6 variables
  v_purchase_result       jsonb;
  v_grant_result          jsonb;
  v_purchase_id           uuid;
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

  -- ── Step 3: Validate + Resolve + Grant (M4 + M5 + M6) ──
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

    -- ── 3c. M5: Extract buyer_email from raw_payload (UNCHANGED FROM M5) ──
    v_buyer_email := coalesce(
      nullif(btrim(coalesce(v_event.raw_payload->>'buyer_email', '')), ''),
      nullif(btrim(coalesce(v_event.raw_payload->>'WP_BUYER_EMAIL', '')), '')
    );

    if v_buyer_email is null then
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

    v_email_hash := encode(digest(lower(v_buyer_email), 'sha256'), 'hex');

    -- ── 3d. M5: Resolve identity (UNCHANGED FROM M5) ──────────────
    v_resolution := public.resolve_or_create_user_from_purchase(
      p_buyer_email          => v_buyer_email,
      p_buyer_name           => v_buyer_name,
      p_provider_id          => v_event.provider_id,
      p_provider_customer_id => v_provider_customer_id,
      p_create_if_missing    => false
    );

    v_resolution_outcome := v_resolution->>'outcome';
    if v_resolution_outcome = 'resolved_existing_user' then
      v_resolved_user_id := (v_resolution->>'user_id')::uuid;
    end if;

    -- ── 3e. M5: Apply outcome — GUEST path (UNCHANGED FROM M5) ─────
    if v_resolution_outcome = 'marked_guest_awaiting_claim' then
      -- Guest buyer: M5 stops here. M9 will pick up after claim.
      -- No purchase is recorded; M6 has nothing to do for guests.
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
      -- Ambiguous match — terminal (UNCHANGED FROM M5)
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
    end if;

    -- ── 3e-continuation. M6 NEW: Only reached when resolution_outcome = 'resolved_existing_user' ──
    -- We mutate the row to status='verified' FIRST so that record_purchase_from_webhook
    -- can find it in the expected state.
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

    -- ── Step 4 (M6 NEW): Record purchase row ──
    v_purchase_result := public.record_purchase_from_webhook(v_event.id);

    if coalesce((v_purchase_result->>'success')::boolean, false) = false then
      -- Terminal failures: PRODUCT_MAPPING_NOT_FOUND, PRODUCT_DISABLED,
      -- INVALID_DURATION, MISSING_PRODUCT_ID, UNSUPPORTED_EVENT_TYPE.
      -- The raise exception path below classifies them.
      raise exception 'record_purchase_failed: %: %',
        v_purchase_result->>'code',
        coalesce(v_purchase_result->>'message', '');
    end if;

    v_purchase_id := (v_purchase_result->>'purchase_id')::uuid;

    -- Re-acquire the lock (safe_plan_switch needs the row in 'verified')
    update public.webhook_events
    set locked_by = v_lock_id,
        locked_at = now(),
        status    = 'processing'
    where id = v_event.id;

    -- ── Step 5 (M6 NEW): Grant entitlement ──
    v_grant_result := public.grant_entitlement_from_purchase(v_purchase_id);

    if coalesce((v_grant_result->>'success')::boolean, false) = false then
      -- Terminal failures: PURCHASE_NOT_FOUND, USER_NOT_RESOLVED,
      -- PRODUCT_MAPPING_NOT_FOUND, INVALID_DURATION, INVALID_DURATION_UNIT.
      raise exception 'grant_entitlement_failed: %: %',
        v_grant_result->>'code',
        coalesce(v_grant_result->>'message', '');
    end if;

    -- ── Step 6 (M6 NEW): Transition to 'processed' (terminal success) ──
    update public.webhook_events
    set status              = 'processed',
        processed_at        = now(),
        locked_by           = null,
        locked_at           = null,
        last_error          = null,
        linked_purchase_id  = v_purchase_id
    where id = v_event.id;

    return jsonb_build_object(
      'success',                true,
      'action',                 'processed',
      'webhook_event_id',       v_event.id,
      'provider_id',            v_event.provider_id,
      'provider_event_type',    v_event.provider_event_type,
      'standardized_event_type', v_event.standardized_event_type,
      'event_mapping_confidence', v_event.event_mapping_confidence,
      'linked_user_id',         v_resolved_user_id,
      'linked_purchase_id',     v_purchase_id,
      'plan',                   v_grant_result->>'plan',
      'expires_at',             v_grant_result->>'expires_at',
      'duration_days',          (v_grant_result->>'duration_days')::integer,
      'resolution_outcome',     v_resolution_outcome,
      'trace_id',               v_event.trace_id,
      'lock_id',                v_lock_id
    );

  exception when others then
    -- ── Error classification (EXTENDED FROM M5) ────────────────
    -- M4+M5 categories: validation (terminal) + unexpected (retry) +
    -- resolution_failed (terminal).
    -- M6 additions:
    --   - record_purchase_failed:*  (terminal — product/validation issues)
    --   - grant_entitlement_failed:* (terminal — same)
    v_err_msg := SQLERRM;

    if v_err_msg like 'raw_payload_is_null%'
       or v_err_msg like 'payload_hash_mismatch%'
       or v_err_msg like 'provider_not_found%'
       or v_err_msg like 'provider_disabled%'
       or v_err_msg like 'missing_buyer_email_field%' then
      -- Terminal validation failure (UNCHANGED FROM M5).
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
      -- Terminal resolution failure (UNCHANGED FROM M5).
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
    elsif v_err_msg like 'record_purchase_failed:%'
       or v_err_msg like 'grant_entitlement_failed:%'
       or v_err_msg like 'PRODUCT_MAPPING_NOT_FOUND%'
       or v_err_msg like 'PRODUCT_DISABLED%'
       or v_err_msg like 'INVALID_DURATION%'
       or v_err_msg like 'INVALID_PLAN%'
       or v_err_msg like 'COOLDOWN_ACTIVE%'
       or v_err_msg like 'UNSUPPORTED_EVENT_TYPE%'
       or v_err_msg like 'MISSING_PRODUCT_ID%'
       or v_err_msg like 'PURCHASE_NOT_FOUND%'
       or v_err_msg like 'USER_NOT_RESOLVED%'
       or v_err_msg like 'NO_SOURCE_WEBHOOK%'
       or v_err_msg like 'WEBHOOK_NOT_FOUND%'
       or v_err_msg like 'WEBHOOK_NOT_READY%' then
      -- M6 NEW: Terminal purchase/entitlement failure.
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'purchase_or_entitlement_failed: ' || v_err_msg
      );
      return jsonb_build_object(
        'success',          false,
        'action',           'failed_terminal',
        'error',            v_err_msg,
        'classification',   'purchase_or_entitlement',
        'webhook_event_id', v_event.id,
        'provider_id',      v_event.provider_id,
        'lock_id',          v_lock_id
      );
    else
      -- Unexpected (transient) failure: schedule retry (UNCHANGED FROM M5).
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

-- ============================================================
-- M54 — record_subscription_webhook_event (FIX: duplicate RPC restored)
-- ============================================================
-- Restored verbatim from M54. The function deduplicates
-- subscription webhook events on (provider, provider_event_id)
-- and writes non-duplicates to public.subscription_webhook_events.

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

commit;
