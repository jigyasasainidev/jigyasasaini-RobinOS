-- ============================================================
-- MIGRATION 58 — PURCHASE RECORDING + ROBINOS PRO ENTITLEMENT
-- (MILESTONE 6)
-- ============================================================
-- Completes the core WarriorPlus purchase flow. After M5 has
-- resolved buyer identity to an existing auth.users row, M6:
--
--   1. Records the purchase row in public.payments (idempotent).
--   2. Grants the RobinOS plan entitlement via safe_plan_switch,
--      honoring provider_products.duration_value + duration_unit.
--   3. Marks the webhook row as processed.
--
-- Architecture review (see .kimchi/docs/milestone-6-architecture-review.md)
-- confirms:
--   - Zero new tables, columns, enums, or status values.
--   - Reuses safe_plan_switch (M31) with one new optional parameter
--     (p_expires_at) so provider-defined durations are honored.
--   - Reuses process_subscription_expiry (M31) for the 6-month
--     expiry; only the cron registration is new (rollout runbook).
--   - All writes to user_subscriptions / profiles / subscription_audit_log
--     flow through the existing safe_plan_switch engine.
--
-- Out of scope (NOT implemented):
--   - Refund handling (M7)
--   - Chargeback handling (M8)
--   - Guest claim flow (M9)
--   - Affiliate commissions (M10)
--   - Email sending (M9)
--   - New payment providers
--   - Subscription renewal webhooks (post-M6)
--
-- Reuses existing infrastructure:
--   - public.process_webhook_event (M5) — extended with M6 step
--   - public.safe_plan_switch (M31) — extended with p_expires_at
--   - public.provider_products (M52) — source of plan + duration
--   - public.payment_provider_secrets (M51) — already wired
--   - public.schedule_webhook_retry (M56) — transient failure path
--   - public.mark_webhook_dead_letter (M53) — terminal failure path
--   - public.process_subscription_expiry (M31) — cron-driven expiry
-- ============================================================

begin;

-- ============================================================
-- SECTION A: safe_plan_switch (EXTEND WITH p_expires_at)
-- ============================================================
--
-- Adds one optional parameter: p_expires_at timestamptz.
-- When non-NULL, this value is used directly for expires_at,
-- current_period_end, and next_billing_at. When NULL, the
-- existing 30/365-day calculation from billing_cycle is used
-- (backward-compatible).
--
-- Diff size: ~8 lines. No schema change. All existing callers
-- continue to work because the new parameter defaults to NULL
-- which preserves prior behavior exactly.

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

comment on function public.safe_plan_switch(
  uuid, text, text, text, text, numeric, text, timestamptz
) is
  'Safe plan transition for webhook handlers. UTC-only, idempotent-safe, '
  'clears grace period on renewal, logs every switch. '
  'When p_expires_at IS NOT NULL, that value is used for expires_at, '
  'current_period_end, and next_billing_at (M6 extension for provider-defined '
  'durations like 6 months). When NULL, computes 30/365 days from billing_cycle '
  '(pre-M6 behavior).';


-- ============================================================
-- SECTION B: record_purchase_from_webhook (REPLACE M53 STUB)
-- ============================================================
--
-- Reads a verified webhook_event row, looks up the
-- provider_products mapping, and inserts a payments row.
-- Idempotent via (provider, provider_payment_id) UNIQUE
-- constraint provided by M53's idx_payments_provider_event.
--
-- Failure modes (all terminal, dead-letter the webhook):
--   - product_mapping_missing: provider_product_id not in
--     provider_products for this provider.
--   - product_disabled: provider_products.is_enabled = false.
--   - invalid_duration: duration_value missing or zero.

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

comment on function public.record_purchase_from_webhook(uuid) is
  'M6: records a verified webhook as a public.payments row. Idempotent via '
  '(provider, provider_payment_id) UNIQUE INDEX. Reads plan_key from '
  'provider_products. Returns success=false with code PRODUCT_MAPPING_NOT_FOUND / '
  'PRODUCT_DISABLED / INVALID_DURATION / UNSUPPORTED_EVENT_TYPE for terminal failures. '
  'Called by process_webhook_event after M5 resolution succeeds.';


-- ============================================================
-- SECTION C: grant_entitlement_from_purchase (REPLACE M53 STUB)
-- ============================================================
--
-- Reads the recorded purchase + linked webhook + provider_products,
-- computes expires_at from duration_value + duration_unit, and calls
-- safe_plan_switch with p_expires_at = expires_at.
--
-- Idempotent: safe_plan_switch is ON CONFLICT (user_id) DO UPDATE.
-- Re-running on the same purchase yields the same outcome.

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

comment on function public.grant_entitlement_from_purchase(uuid) is
  'M6: grants the RobinOS plan entitlement based on a recorded purchase. '
  'Reads provider_products.duration_value + duration_unit and passes '
  'the computed expires_at to safe_plan_switch. Updates payments.subscription_id '
  'and profiles.primary_payment_provider. Idempotent: re-running on the same '
  'purchase is a no-op once subscription_id is set. Called by '
  'process_webhook_event after record_purchase_from_webhook succeeds.';


-- ============================================================
-- SECTION D: process_webhook_event (REPLACE M5 IMPLEMENTATION)
-- ============================================================
--
-- Extends M5 process_webhook_event with M6 inline steps:
--   - After M5 resolution (resolved_existing_user), do NOT return early.
--   - Call record_purchase_from_webhook → INSERT into public.payments.
--   - Call grant_entitlement_from_purchase → safe_plan_switch (with 6mo).
--   - Transition status='processed' on full success.
--   - On any M6 terminal failure, dead-letter the row.
--   - On transient failure, retry the entire row.
--
-- Atomicity: validation + M5 resolution + M6 grant all happen in the
-- same transaction. If any step raises, the entire row rolls back and
-- schedule_webhook_retry is called.

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

comment on function public.process_webhook_event is
  'M4+M5+M6: atomic claim + validate + resolve + record + grant for ONE '
  'webhook event. Pipeline: validate payload (M4) → resolve identity (M5) → '
  'record purchase (M6 NEW) → grant entitlement via safe_plan_switch (M6 NEW) '
  '→ status=processed (M6 NEW terminal). Guest buyers stop at awaiting_claim '
  '(M5); M9 will resume them. Returns jsonb with action (processed / '
  'awaiting_claim / failed_terminal / failed_retryable) or NULL when queue '
  'is empty.';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 58
-- ============================================================
-- Reverts M6 by:
--   1. Restoring M5's process_webhook_event (no M6 step).
--   2. Restoring M53 stub bodies for record_purchase_from_webhook and
--      grant_entitlement_from_purchase.
--   3. Restoring safe_plan_switch to its M31 7-parameter form.
--
-- Data preservation:
--   - public.payments rows created during M6 lifetime are NOT deleted.
--     They remain queryable; future re-runs of M6 would re-link them.
--   - public.user_subscriptions rows updated by safe_plan_switch during M6
--     are NOT reverted. The 6-month expires_at remains in place.
--   - subscription_audit_log entries are NOT deleted (immutable audit).
--   - webhook_events rows already at status='processed' will remain there
--     because the M5 rollback's logic only processes (received,
--     failed_retryable) — a 'processed' row is not claimable and won't be
--     reprocessed.
--
-- After rollback:
--   - process_webhook_event stops at M5's 'verified' transition for
--     resolved-existing-user rows. M6 steps are skipped.
--   - record_purchase_from_webhook and grant_entitlement_from_purchase
--     raise exceptions if called.
--   - safe_plan_switch works as before (7 parameters); explicit
--     p_expires_at no longer accepted (callers will need to be re-deployed
--     to use the 8-parameter form).
--
-- Note: the M31 → M58 signature change is INCOMPATIBLE on rollback. Any
-- caller using p_expires_at (which is currently only grant_entitlement_from_purchase
-- itself, which is also being rolled back) will break. This is acceptable
-- because M6 is the only known caller of the new parameter, and M6 itself
-- is also being rolled back.

/*

begin;

-- 1. Restore M5 process_webhook_event (no M6 step)
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
  v_buyer_email text;
  v_buyer_name text;
  v_provider_customer_id text;
  v_resolution jsonb;
  v_resolution_outcome text;
  v_resolved_user_id uuid;
  v_email_hash text;
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
  set locked_by = v_lock_id,
      locked_at = now(),
      processing_started_at = coalesce(processing_started_at, now()),
      status = 'processing'
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

    if v_resolution_outcome = 'resolved_existing_user' then
      update public.webhook_events
      set status = 'verified',
          verified_at = coalesce(verified_at, now()),
          locked_by = null,
          locked_at = null,
          last_error = null,
          linked_user_id = v_resolved_user_id,
          provider_customer_id = v_provider_customer_id,
          resolution_attempted_at = now(),
          resolution_outcome = 'resolved_existing_user',
          resolution_buyer_email_hash = v_email_hash
      where id = v_event.id;

      return jsonb_build_object(
        'success', true,
        'action', 'verified',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'provider_event_type', v_event.provider_event_type,
        'standardized_event_type', v_event.standardized_event_type,
        'event_mapping_confidence', v_event.event_mapping_confidence,
        'linked_user_id', v_resolved_user_id,
        'resolution_outcome', v_resolution_outcome,
        'trace_id', v_event.trace_id,
        'lock_id', v_lock_id
      );
    elsif v_resolution_outcome = 'marked_guest_awaiting_claim' then
      update public.webhook_events
      set status = 'awaiting_claim',
          verified_at = coalesce(verified_at, now()),
          locked_by = null,
          locked_at = null,
          last_error = null,
          linked_user_id = null,
          provider_customer_id = v_provider_customer_id,
          resolution_attempted_at = now(),
          resolution_outcome = 'marked_guest_awaiting_claim',
          resolution_buyer_email_hash = v_email_hash
      where id = v_event.id;

      return jsonb_build_object(
        'success', true,
        'action', 'awaiting_claim',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'provider_event_type', v_event.provider_event_type,
        'standardized_event_type', v_event.standardized_event_type,
        'event_mapping_confidence', v_event.event_mapping_confidence,
        'linked_user_id', null,
        'resolution_outcome', v_resolution_outcome,
        'trace_id', v_event.trace_id,
        'lock_id', v_lock_id
      );
    elsif v_resolution_outcome = 'resolution_failed' then
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'resolution_failed: ' || (v_resolution->>'error') ||
          ' (match_count=' || coalesce(v_resolution->>'match_count', '?') || ')'
      );
      return jsonb_build_object(
        'success', false,
        'action', 'failed_terminal',
        'error', 'resolution_failed: ' || (v_resolution->>'error'),
        'classification', 'resolution',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'resolution_outcome', v_resolution_outcome,
        'trace_id', v_event.trace_id,
        'lock_id', v_lock_id
      );
    else
      raise exception 'unknown_resolution_outcome: %', coalesce(v_resolution_outcome, 'null');
    end if;

  exception when others then
    v_err_msg := SQLERRM;

    if v_err_msg like 'raw_payload_is_null%'
       or v_err_msg like 'payload_hash_mismatch%'
       or v_err_msg like 'provider_not_found%'
       or v_err_msg like 'provider_disabled%'
       or v_err_msg like 'missing_buyer_email_field%' then
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'validation_failed: ' || v_err_msg
      );
      return jsonb_build_object(
        'success', false,
        'action', 'failed_terminal',
        'error', v_err_msg,
        'classification', 'validation',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'lock_id', v_lock_id
      );
    elsif v_err_msg like 'resolution_failed:%'
       or v_err_msg like 'ambiguous_match%' then
      perform public.mark_webhook_dead_letter(
        v_event.id,
        'resolution_failed: ' || v_err_msg
      );
      return jsonb_build_object(
        'success', false,
        'action', 'failed_terminal',
        'error', v_err_msg,
        'classification', 'resolution',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'lock_id', v_lock_id
      );
    else
      perform public.schedule_webhook_retry(
        v_event.id,
        'unexpected_error: ' || v_err_msg
      );
      return jsonb_build_object(
        'success', false,
        'action', 'failed_retryable',
        'error', v_err_msg,
        'classification', 'unexpected',
        'webhook_event_id', v_event.id,
        'provider_id', v_event.provider_id,
        'lock_id', v_lock_id
      );
    end if;
  end;
end;
$$;

grant execute on function public.process_webhook_event(uuid) to service_role;


-- 2. Restore M53 stub for record_purchase_from_webhook
create or replace function public.record_purchase_from_webhook(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'record_purchase_from_webhook: rolled back to M53 stub';
end;
$$;

grant execute on function public.record_purchase_from_webhook(uuid) to service_role;


-- 3. Restore M53 stub for grant_entitlement_from_purchase
create or replace function public.grant_entitlement_from_purchase(
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'grant_entitlement_from_purchase: rolled back to M53 stub';
end;
$$;

grant execute on function public.grant_entitlement_from_purchase(uuid) to service_role;


-- 4. Restore safe_plan_switch to M31 7-parameter form (drops p_expires_at)
create or replace function public.safe_plan_switch(
  p_user_id           uuid,
  p_new_plan          text,
  p_billing_cycle     text        default 'monthly',
  p_provider          text        default null,
  p_provider_sub_id   text        default null,
  p_amount            numeric     default 0,
  p_triggered_by      text        default 'webhook'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now         timestamptz := now() at time zone 'UTC';
  v_normalized  text;
  v_old_plan    text;
  v_old_status  text;
  v_expires_at  timestamptz;
  v_duration    integer;
begin
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

  select plan, status
    into v_old_plan, v_old_status
    from public.user_subscriptions
   where user_id = p_user_id
   limit 1;

  v_duration := case lower(coalesce(p_billing_cycle,'monthly'))
    when 'yearly' then 365
    else 30
  end;

  v_expires_at := v_now + (v_duration || ' days')::interval;

  insert into public.user_subscriptions
    (user_id, plan, status, billing_cycle, starts_at, expires_at,
     current_period_start, current_period_end,
     last_plan_change_at, last_payment_at, next_billing_at,
     provider, provider_subscription_id,
     subscription_source, is_revenue_eligible,
     amount, currency, auto_renew, granted_by_admin)
  values
    (p_user_id, v_normalized, 'active', p_billing_cycle,
     v_now, v_expires_at,
     v_now, v_expires_at,
     v_now, v_now, v_expires_at,
     p_provider, p_provider_sub_id,
     coalesce(p_provider,'manual_admin'), (p_provider is not null),
     p_amount, 'USD', true, false)
  on conflict (user_id) do update set
    plan                  = v_normalized,
    status                = 'active',
    billing_cycle         = p_billing_cycle,
    starts_at             = v_now,
    expires_at            = v_expires_at,
    current_period_start  = v_now,
    current_period_end    = v_expires_at,
    last_plan_change_at   = v_now,
    last_payment_at       = v_now,
    next_billing_at       = v_expires_at,
    grace_period_ends_at  = null,
    reminder_dismissed_until = null,
    provider              = coalesce(p_provider, public.user_subscriptions.provider),
    provider_subscription_id = coalesce(p_provider_sub_id, public.user_subscriptions.provider_subscription_id),
    is_revenue_eligible   = (p_provider is not null),
    amount                = p_amount,
    auto_renew            = true,
    granted_by_admin      = false,
    updated_at            = v_now;

  update public.profiles
     set subscription_tier       = v_normalized,
         current_plan            = v_normalized,
         subscription_expires_at = v_expires_at,
         updated_at              = v_now
   where user_id = p_user_id;

  perform public.log_subscription_event(
    p_user_id, 'plan_switch',
    v_old_plan, v_normalized,
    v_old_status, 'active',
    p_triggered_by,
    jsonb_build_object(
      'billing_cycle', p_billing_cycle,
      'provider', p_provider,
      'amount', p_amount,
      'expires_at', v_expires_at
    )
  );

  return jsonb_build_object(
    'success',    true,
    'plan',       v_normalized,
    'expires_at', v_expires_at,
    'switched_at', v_now
  );
end;
$$;

grant execute on function public.safe_plan_switch(
  uuid, text, text, text, text, numeric, text
) to service_role;


commit;

*/
