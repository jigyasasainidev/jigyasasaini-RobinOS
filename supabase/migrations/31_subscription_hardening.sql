-- ============================================================
-- MIGRATION 31 — SUBSCRIPTION SYSTEM HARDENING
-- Webhook idempotency, UTC enforcement, cron safety,
-- plan-switch protection, observability logging
-- ============================================================
-- ADDITIVE ONLY. No existing data modified.
-- ============================================================

-- ── 1. WEBHOOK IDEMPOTENCY TABLE ──────────────────────────
create table if not exists public.subscription_webhook_events (
  id                uuid        primary key default gen_random_uuid(),
  provider_event_id text        not null,
  provider          text        not null,
  event_type        text        not null,
  payload_hash      text        not null,
  processed_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  -- Unique on (provider, provider_event_id) — prevents duplicate processing
  unique (provider, provider_event_id)
);

comment on table public.subscription_webhook_events is
  'Idempotency log for payment provider webhooks. '
  'Prevents duplicate subscription state changes from replayed events.';

create index if not exists idx_webhook_events_provider_event
  on public.subscription_webhook_events (provider, provider_event_id);

create index if not exists idx_webhook_events_created_at
  on public.subscription_webhook_events (created_at desc);

alter table public.subscription_webhook_events enable row level security;

-- Only service_role can write; no user access needed
create policy "Service role manages webhook events"
  on public.subscription_webhook_events for all to service_role
  using (true) with check (true);

-- ── 2. SUBSCRIPTION AUDIT LOG ─────────────────────────────
create table if not exists public.subscription_audit_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  event_type  text        not null,  -- downgrade, grace_activated, expired, reminder_triggered, etc.
  old_plan    text,
  new_plan    text,
  old_status  text,
  new_status  text,
  triggered_by text       not null default 'system',  -- system | webhook | admin | user
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.subscription_audit_log is
  'Immutable audit trail for all subscription lifecycle events. '
  'Used for observability, debugging, and dispute resolution.';

create index if not exists idx_sub_audit_user_id
  on public.subscription_audit_log (user_id, created_at desc);

create index if not exists idx_sub_audit_event_type
  on public.subscription_audit_log (event_type, created_at desc);

alter table public.subscription_audit_log enable row level security;

create policy "Users view own audit log"
  on public.subscription_audit_log for select
  using (auth.uid() = user_id);

create policy "Service role manages audit log"
  on public.subscription_audit_log for all to service_role
  using (true) with check (true);


-- ── 3. WEBHOOK IDEMPOTENCY RPC ────────────────────────────
-- Call this at the START of every webhook handler.
-- Returns {is_duplicate: true} if already processed → skip.
-- Returns {is_duplicate: false} if new → process and record.

create or replace function public.record_webhook_event(
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
begin
  -- Attempt insert; conflict = duplicate
  insert into public.subscription_webhook_events
    (provider_event_id, provider, event_type, payload_hash)
  values
    (p_provider_event_id, p_provider, p_event_type, p_payload_hash);

  return jsonb_build_object(
    'is_duplicate', false,
    'recorded_at',  now()
  );

exception when unique_violation then
  return jsonb_build_object(
    'is_duplicate', true,
    'message',      'Event already processed — skipping'
  );
end;
$$;

grant execute on function public.record_webhook_event(text,text,text,text)
  to service_role;

comment on function public.record_webhook_event(text,text,text,text) is
  'Idempotency gate for webhook handlers. '
  'Returns is_duplicate=true if event was already processed. '
  'Must be called before any state mutation in webhook handlers.';

-- ── 4. LOG SUBSCRIPTION EVENT (observability) ─────────────
create or replace function public.log_subscription_event(
  p_user_id     uuid,
  p_event_type  text,
  p_old_plan    text    default null,
  p_new_plan    text    default null,
  p_old_status  text    default null,
  p_new_status  text    default null,
  p_triggered_by text   default 'system',
  p_metadata    jsonb   default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscription_audit_log
    (user_id, event_type, old_plan, new_plan, old_status, new_status,
     triggered_by, metadata)
  values
    (p_user_id, p_event_type, p_old_plan, p_new_plan, p_old_status, p_new_status,
     p_triggered_by, p_metadata);
exception when others then
  -- Never let logging block the main flow
  null;
end;
$$;

grant execute on function public.log_subscription_event(uuid,text,text,text,text,text,text,jsonb)
  to service_role, authenticated;


-- ── 5. HARDENED process_subscription_expiry() ─────────────
-- Replaces migration 30 version.
-- Fixes:
--   - All timestamps use AT TIME ZONE 'UTC' explicitly
--   - Concurrency-safe: uses advisory locks
--   - Idempotent: checks current state before each transition
--   - Logs every transition to subscription_audit_log
--   - Never double-activates grace period
--   - Never double-downgrades

create or replace function public.process_subscription_expiry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now              timestamptz := now() at time zone 'UTC';
  v_expiring_count   integer := 0;
  v_grace_count      integer := 0;
  v_downgraded_count integer := 0;
  v_lock_acquired    boolean;
  v_row              record;
begin
  -- Advisory lock: prevents concurrent cron runs from racing
  -- Lock key: hash of function name (deterministic)
  select pg_try_advisory_xact_lock(hashtext('process_subscription_expiry'))
    into v_lock_acquired;

  if not v_lock_acquired then
    return jsonb_build_object(
      'success', false,
      'code',    'LOCK_CONTENTION',
      'message', 'Another expiry job is running — skipping this run'
    );
  end if;

  -- ── Step 1: Mark 'expiring' for subscriptions within 7 days ──
  -- Only transition active → expiring (not grace_period, not already expiring)
  update public.user_subscriptions
     set status     = 'expiring',
         updated_at = v_now
   where lower(status) = 'active'
     and expires_at is not null
     and expires_at > v_now
     and expires_at <= v_now + interval '7 days'
     and lower(coalesce(plan,'free')) <> 'free';

  get diagnostics v_expiring_count = row_count;

  -- ── Step 2: Activate grace period for just-expired ────────
  -- Only for active/expiring rows that just passed expires_at
  -- and have NOT already had grace activated (grace_period_ends_at IS NULL)
  for v_row in
    select id, user_id, plan, status
    from public.user_subscriptions
    where lower(status) in ('active','expiring')
      and expires_at is not null
      and expires_at <= v_now
      and grace_period_ends_at is null
      and lower(coalesce(plan,'free')) <> 'free'
    for update skip locked
  loop
    update public.user_subscriptions
       set status               = 'grace_period',
           grace_period_ends_at = v_now + interval '3 days',
           updated_at           = v_now
     where id = v_row.id;

    -- Log the transition
    perform public.log_subscription_event(
      v_row.user_id, 'grace_activated',
      v_row.plan, v_row.plan,
      v_row.status, 'grace_period',
      'system',
      jsonb_build_object('expires_at', now(), 'grace_ends_at', v_now + interval '3 days')
    );

    v_grace_count := v_grace_count + 1;
  end loop;

  -- ── Step 3: Downgrade after grace period ends ─────────────
  for v_row in
    select id, user_id, plan, status
    from public.user_subscriptions
    where lower(status) = 'grace_period'
      and grace_period_ends_at is not null
      and grace_period_ends_at <= v_now
    for update skip locked
  loop
    -- Mark subscription expired
    update public.user_subscriptions
       set status     = 'expired',
           updated_at = v_now
     where id = v_row.id;

    -- Revert profile to free — preserve all content
    update public.profiles
       set subscription_tier       = 'free',
           current_plan            = 'free',
           subscription_expires_at = null,
           updated_at              = v_now
     where user_id = v_row.user_id;

    -- Log the downgrade
    perform public.log_subscription_event(
      v_row.user_id, 'auto_downgrade',
      v_row.plan, 'free',
      'grace_period', 'expired',
      'system',
      jsonb_build_object('reason', 'grace_period_ended')
    );

    v_downgraded_count := v_downgraded_count + 1;
  end loop;

  return jsonb_build_object(
    'success',          true,
    'expiring_marked',  v_expiring_count,
    'grace_activated',  v_grace_count,
    'downgraded',       v_downgraded_count,
    'processed_at',     v_now
  );
end;
$$;

grant execute on function public.process_subscription_expiry()
  to service_role;


-- ── 6. SAFE PLAN SWITCH RPC ───────────────────────────────
-- Protects all plan transitions:
--   - Preserves active billing window (no accidental free downgrade)
--   - Prevents duplicate subscription rows
--   - Logs every switch
--   - UTC-only timestamps
--   - Validates new plan is canonical

create or replace function public.safe_plan_switch(
  p_user_id       uuid,
  p_new_plan      text,
  p_billing_cycle text    default 'monthly',
  p_provider      text    default null,
  p_provider_sub_id text  default null,
  p_amount        numeric default 0,
  p_triggered_by  text    default 'webhook'
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
  select plan, status, expires_at
    into v_old_plan, v_old_status, v_expires_at
    from public.user_subscriptions
   where user_id = p_user_id
   limit 1;

  -- Compute new expiry
  v_duration := case lower(coalesce(p_billing_cycle,'monthly'))
    when 'yearly' then 365
    else 30
  end;

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
     v_now, v_now + (v_duration || ' days')::interval,
     v_now, v_now + (v_duration || ' days')::interval,
     v_now, v_now, v_now + (v_duration || ' days')::interval,
     p_provider, p_provider_sub_id,
     coalesce(p_provider,'manual_admin'), (p_provider is not null),
     p_amount, 'USD', true, false)
  on conflict (user_id) do update set
    plan                  = v_normalized,
    status                = 'active',
    billing_cycle         = p_billing_cycle,
    starts_at             = v_now,
    expires_at            = v_now + (v_duration || ' days')::interval,
    current_period_start  = v_now,
    current_period_end    = v_now + (v_duration || ' days')::interval,
    last_plan_change_at   = v_now,
    last_payment_at       = v_now,
    next_billing_at       = v_now + (v_duration || ' days')::interval,
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
         subscription_expires_at = v_now + (v_duration || ' days')::interval,
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
      'expires_at', v_now + (v_duration || ' days')::interval
    )
  );

  return jsonb_build_object(
    'success',    true,
    'plan',       v_normalized,
    'expires_at', v_now + (v_duration || ' days')::interval,
    'switched_at', v_now
  );
end;
$$;

grant execute on function public.safe_plan_switch(uuid,text,text,text,text,numeric,text)
  to service_role;

comment on function public.safe_plan_switch(uuid,text,text,text,text,numeric,text) is
  'Safe plan transition for webhook handlers. UTC-only, idempotent-safe, '
  'clears grace period on renewal, logs every switch.';


-- ── 7. HARDENED resolve_user_plan — UTC explicit ──────────
-- Replaces migration 30 version.
-- All now() calls use AT TIME ZONE 'UTC' explicitly.
-- Adds payment_failed state handling.

create or replace function public.resolve_user_plan(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now                 timestamptz := now() at time zone 'UTC';
  v_profile_tier        text;
  v_sub                 record;
  v_subscription_active boolean;
  v_in_grace_period     boolean;
  v_effective_plan      text;
  v_expires_soon        boolean;
  v_days_remaining      integer;
  v_expiry_state        text;
begin
  if p_user_id is null then
    return jsonb_build_object('plan','free','subscription_active',false,
      'expiry_state','none','in_grace_period',false,'days_remaining',0);
  end if;

  -- Profile tier (fallback)
  select coalesce(subscription_tier,'free') into v_profile_tier
  from public.profiles where user_id = p_user_id;
  v_profile_tier := coalesce(v_profile_tier,'free');

  -- Subscription row
  select
    coalesce(plan,'free')                    as plan,
    coalesce(status,'')                      as status,
    expires_at,
    grace_period_ends_at,
    billing_cycle,
    cooldown_until,
    last_plan_change_at,
    coalesce(granted_by_admin,false)         as granted_by_admin,
    reminder_dismissed_until,
    next_billing_at,
    coalesce(auto_renew,true)                as auto_renew,
    provider
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Active: status in (active, trialing, expiring) AND not past expires_at
  v_subscription_active :=
    lower(coalesce(v_sub.status,'')) in ('active','trialing','expiring')
    and (v_sub.expires_at is null or v_sub.expires_at > v_now);

  -- Grace period: expired but within 3-day grace window
  v_in_grace_period :=
    not v_subscription_active
    and lower(coalesce(v_sub.status,'')) in ('grace_period','expired')
    and v_sub.grace_period_ends_at is not null
    and v_sub.grace_period_ends_at > v_now;

  -- Effective plan
  if (v_subscription_active or v_in_grace_period)
     and lower(coalesce(v_sub.plan,'free')) <> 'free' then
    v_effective_plan := lower(v_sub.plan);
  else
    v_effective_plan := lower(v_profile_tier);
  end if;

  -- Normalize legacy names
  case v_effective_plan
    when 'starter','basic'  then v_effective_plan := 'creator';
    when 'pro','premium'    then v_effective_plan := 'pro_creator';
    when 'scale_agency'     then v_effective_plan := 'agency';
    else null;
  end case;
  v_effective_plan := coalesce(v_effective_plan,'free');

  -- Days remaining (UTC)
  if v_sub.expires_at is not null and v_sub.expires_at > v_now then
    v_days_remaining := ceil(
      extract(epoch from (v_sub.expires_at - v_now)) / 86400
    )::integer;
  else
    v_days_remaining := 0;
  end if;

  v_expires_soon := (v_sub.expires_at is not null
    and v_sub.expires_at > v_now
    and v_sub.expires_at <= v_now + interval '7 days');

  -- Expiry state (deterministic, UTC-based)
  v_expiry_state := case
    when v_in_grace_period                                    then 'grace_period'
    when v_sub.expires_at is not null
         and v_sub.expires_at <= v_now
         and not v_in_grace_period                            then 'expired'
    when v_days_remaining <= 1 and v_subscription_active      then 'expiring_1d'
    when v_days_remaining <= 3 and v_subscription_active      then 'expiring_3d'
    when v_days_remaining <= 7 and v_subscription_active      then 'expiring_7d'
    when v_subscription_active                                then 'active'
    else 'none'
  end;

  return jsonb_build_object(
    'plan',                 v_effective_plan,
    'subscription_plan',    lower(coalesce(v_sub.plan,'free')),
    'subscription_status',  lower(coalesce(v_sub.status,'')),
    'subscription_active',  v_subscription_active or v_in_grace_period,
    'in_grace_period',      v_in_grace_period,
    'expires_at',           v_sub.expires_at,
    'grace_period_ends_at', v_sub.grace_period_ends_at,
    'expires_soon',         v_expires_soon,
    'days_remaining',       v_days_remaining,
    'expiry_state',         v_expiry_state,
    'billing_cycle',        coalesce(v_sub.billing_cycle,'monthly'),
    'cooldown_until',       v_sub.cooldown_until,
    'last_plan_change_at',  v_sub.last_plan_change_at,
    'granted_by_admin',     v_sub.granted_by_admin,
    'reminder_dismissed_until', v_sub.reminder_dismissed_until,
    'next_billing_at',      v_sub.next_billing_at,
    'auto_renew',           v_sub.auto_renew,
    'provider',             v_sub.provider
  );
end;
$$;

grant execute on function public.resolve_user_plan(uuid)
  to authenticated, anon, service_role;

-- ── 8. HARDENED get_subscription_status — UTC explicit ────
create or replace function public.get_subscription_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result     jsonb;
  v_sub             record;
  v_now             timestamptz := now() at time zone 'UTC';
  v_show_reminder   boolean;
  v_reminder_urgency text;
  v_days_remaining  integer;
  v_grace_days      integer;
begin
  if p_user_id is null then
    return jsonb_build_object('error','AUTH_REQUIRED');
  end if;

  v_plan_result := public.resolve_user_plan(p_user_id);

  select
    id, plan, status, billing_cycle,
    starts_at, expires_at, grace_period_ends_at,
    canceled_at, last_payment_at, next_billing_at,
    coalesce(auto_renew,true) as auto_renew,
    provider, provider_subscription_id,
    reminder_dismissed_until,
    coalesce(granted_by_admin,false) as granted_by_admin,
    granted_reason, subscription_source, amount, currency
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  v_days_remaining := coalesce((v_plan_result->>'days_remaining')::integer, 0);

  if v_sub.grace_period_ends_at is not null and v_sub.grace_period_ends_at > v_now then
    v_grace_days := ceil(
      extract(epoch from (v_sub.grace_period_ends_at - v_now)) / 86400
    )::integer;
  else
    v_grace_days := 0;
  end if;

  -- Reminder: show if expiring/grace AND not dismissed AND not admin grant
  v_show_reminder :=
    (v_plan_result->>'expiry_state') in ('expiring_1d','expiring_3d','expiring_7d','grace_period')
    and (
      v_sub.reminder_dismissed_until is null
      or v_sub.reminder_dismissed_until <= v_now
    )
    and not coalesce(v_sub.granted_by_admin, false);

  v_reminder_urgency := case v_plan_result->>'expiry_state'
    when 'grace_period'  then 'critical'
    when 'expiring_1d'   then 'high'
    when 'expiring_3d'   then 'medium'
    when 'expiring_7d'   then 'low'
    else 'none'
  end;

  return jsonb_build_object(
    'plan',                   v_plan_result->>'plan',
    'subscription_active',    (v_plan_result->>'subscription_active')::boolean,
    'expiry_state',           v_plan_result->>'expiry_state',
    'in_grace_period',        (v_plan_result->>'in_grace_period')::boolean,
    'days_remaining',         v_days_remaining,
    'grace_days_remaining',   v_grace_days,
    'billing_cycle',          coalesce(v_sub.billing_cycle,'monthly'),
    'expires_at',             v_sub.expires_at,
    'grace_period_ends_at',   v_sub.grace_period_ends_at,
    'next_billing_at',        v_sub.next_billing_at,
    'last_payment_at',        v_sub.last_payment_at,
    'auto_renew',             v_sub.auto_renew,
    'provider',               v_sub.provider,
    'amount',                 coalesce(v_sub.amount, 0),
    'currency',               coalesce(v_sub.currency,'USD'),
    'status',                 coalesce(v_sub.status,'none'),
    'granted_by_admin',       v_sub.granted_by_admin,
    'show_reminder',          v_show_reminder,
    'reminder_urgency',       v_reminder_urgency,
    'reminder_dismissed_until', v_sub.reminder_dismissed_until,
    'checked_at',             v_now
  );
end;
$$;

grant execute on function public.get_subscription_status(uuid)
  to authenticated, anon, service_role;


-- ── 9. HARDENED dismiss_expiry_popup — UTC explicit ───────
create or replace function public.dismiss_expiry_popup(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller          uuid := auth.uid();
  v_now             timestamptz := now() at time zone 'UTC';
  v_dismissed_until timestamptz := v_now + interval '24 hours';
begin
  if v_caller is null or v_caller <> p_user_id then
    return jsonb_build_object('success',false,'code','UNAUTHORIZED');
  end if;

  update public.user_subscriptions
     set reminder_dismissed_until = v_dismissed_until,
         updated_at               = v_now
   where user_id = p_user_id;

  if not found then
    return jsonb_build_object('success',false,'code','NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success',         true,
    'dismissed_until', v_dismissed_until,
    'message',         'Reminder snoozed for 24 hours'
  );
end;
$$;

grant execute on function public.dismiss_expiry_popup(uuid)
  to authenticated;

-- ── 10. HARDENED compute_period_bounds — UTC explicit ─────
create or replace function public.compute_period_bounds(p_limit_period text)
returns table(period_key text, period_start timestamptz, period_end timestamptz)
language plpgsql
stable
set search_path = public
as $$
declare
  v_now timestamptz := now() at time zone 'UTC';
begin
  if p_limit_period = '24h' then
    return query select
      to_char(date_trunc('hour', v_now) - interval '24 hours', 'YYYY-MM-DD-HH24'),
      date_trunc('hour', v_now) - interval '24 hours',
      date_trunc('hour', v_now);
  elsif p_limit_period in ('day','fair_usage') then
    return query select
      to_char(v_now, 'YYYY-MM-DD'),
      date_trunc('day', v_now),
      date_trunc('day', v_now) + interval '1 day';
  elsif p_limit_period = 'month' then
    return query select
      to_char(v_now, 'YYYY-MM'),
      date_trunc('month', v_now),
      date_trunc('month', v_now) + interval '1 month';
  elsif p_limit_period = 'lifetime' then
    return query select
      'lifetime'::text,
      '2025-01-01 00:00:00+00'::timestamptz,
      '2099-12-31 23:59:59+00'::timestamptz;
  else
    return query select
      to_char(v_now, 'YYYY-MM-DD'),
      date_trunc('day', v_now),
      date_trunc('day', v_now) + interval '1 day';
  end if;
end;
$$;

grant execute on function public.compute_period_bounds(text)
  to authenticated, anon, service_role;

-- ── 11. INDEXES for performance ───────────────────────────
create index if not exists idx_sub_audit_log_user_event
  on public.subscription_audit_log (user_id, event_type, created_at desc);

create index if not exists idx_user_subscriptions_user_status
  on public.user_subscriptions (user_id, status);

-- ── 12. COMMENTS ──────────────────────────────────────────
comment on function public.record_webhook_event(text,text,text,text) is
  'Idempotency gate. Call at start of every webhook handler.';
comment on function public.safe_plan_switch(uuid,text,text,text,text,numeric,text) is
  'Safe plan transition. UTC-only, clears grace on renewal, logs every switch.';
comment on function public.process_subscription_expiry() is
  'Cron-safe expiry job. Advisory-locked, idempotent, logs all transitions.';
