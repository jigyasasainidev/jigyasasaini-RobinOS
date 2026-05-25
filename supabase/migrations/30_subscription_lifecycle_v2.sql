-- ============================================================
-- MIGRATION 30 — SUBSCRIPTION LIFECYCLE V2
-- Grace periods, reminder dismissal, expiry states, yearly plans
-- ============================================================
-- ADDITIVE ONLY. All existing data preserved.
-- Builds on migration 17 (lifecycle engine).
--
-- What this adds:
--   1. New columns: grace_period_ends_at, reminder_dismissed_until,
--      last_payment_at, next_billing_at, auto_renew, provider,
--      provider_subscription_id, canceled_at
--   2. Canonical status values extended: expiring, grace_period,
--      payment_failed, paused
--   3. get_subscription_status(user_id) — rich frontend RPC
--   4. dismiss_expiry_popup(user_id)    — 24h snooze
--   5. process_subscription_expiry()   — cron-safe lifecycle job
--   6. Updated resolve_user_plan       — grace period access
--   7. Updated get_subscription_lifecycle — includes new fields
-- ============================================================

-- ── 1. ADD NEW LIFECYCLE COLUMNS ──────────────────────────
alter table public.user_subscriptions
  add column if not exists grace_period_ends_at      timestamptz,
  add column if not exists reminder_dismissed_until  timestamptz,
  add column if not exists last_payment_at           timestamptz,
  add column if not exists next_billing_at           timestamptz,
  add column if not exists auto_renew                boolean not null default true,
  add column if not exists provider                  text,
  add column if not exists provider_subscription_id  text,
  add column if not exists canceled_at               timestamptz;

comment on column public.user_subscriptions.grace_period_ends_at     is '3-day grace window after expiry — limited access preserved';
comment on column public.user_subscriptions.reminder_dismissed_until is 'Suppress renewal popup until this timestamp (24h snooze)';
comment on column public.user_subscriptions.last_payment_at          is 'Timestamp of last successful payment';
comment on column public.user_subscriptions.next_billing_at          is 'Next scheduled billing date (for display)';
comment on column public.user_subscriptions.auto_renew               is 'Whether subscription auto-renews';
comment on column public.user_subscriptions.provider                 is 'Payment provider: creem | dodo | stripe | manual_admin';
comment on column public.user_subscriptions.provider_subscription_id is 'External subscription ID from payment provider';
comment on column public.user_subscriptions.canceled_at              is 'When the subscription was canceled';

-- ── 2. EXTEND CANONICAL STATUS CONSTRAINT ─────────────────
-- Drop old constraint, add extended one
alter table public.user_subscriptions
  drop constraint if exists chk_subscription_status_canonical;

alter table public.user_subscriptions
  add constraint chk_subscription_status_canonical
    check (status in (
      'active', 'trialing', 'expiring', 'grace_period',
      'expired', 'cancelled', 'canceled', 'payment_failed',
      'past_due', 'suspended', 'paused'
    ));

-- ── 3. BACKFILL: set next_billing_at from expires_at ──────
update public.user_subscriptions
   set next_billing_at = expires_at
 where next_billing_at is null
   and expires_at is not null
   and lower(coalesce(status,'')) in ('active','trialing');

-- ── 4. INDEX new columns ──────────────────────────────────
create index if not exists idx_user_subscriptions_grace_period
  on public.user_subscriptions (grace_period_ends_at)
  where grace_period_ends_at is not null;

create index if not exists idx_user_subscriptions_reminder
  on public.user_subscriptions (reminder_dismissed_until)
  where reminder_dismissed_until is not null;

create index if not exists idx_user_subscriptions_provider
  on public.user_subscriptions (provider, provider_subscription_id)
  where provider is not null;


-- ── 5. UPDATED resolve_user_plan — grace period access ────
-- Grace period: subscription expired but grace_period_ends_at > now()
-- → user keeps plan access (limited) during 3-day grace window

create or replace function public.resolve_user_plan(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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
      'expiry_state','none');
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
    auto_renew,
    provider
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Determine access state
  v_subscription_active :=
    lower(coalesce(v_sub.status,'')) in ('active','trialing','expiring')
    and (v_sub.expires_at is null or v_sub.expires_at > now());

  -- Grace period: expired but within 3-day grace window
  v_in_grace_period :=
    not v_subscription_active
    and v_sub.grace_period_ends_at is not null
    and v_sub.grace_period_ends_at > now();

  -- Effective plan: active OR in grace period → keep plan
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

  -- Days remaining
  if v_sub.expires_at is not null and v_sub.expires_at > now() then
    v_days_remaining := ceil(extract(epoch from (v_sub.expires_at - now())) / 86400)::integer;
  else
    v_days_remaining := 0;
  end if;

  -- Expiry state
  v_expires_soon := (v_sub.expires_at is not null
    and v_sub.expires_at > now()
    and v_sub.expires_at <= now() + interval '7 days');

  v_expiry_state := case
    when v_in_grace_period                                          then 'grace_period'
    when v_sub.expires_at is not null and v_sub.expires_at <= now() then 'expired'
    when v_days_remaining <= 1                                      then 'expiring_1d'
    when v_days_remaining <= 3                                      then 'expiring_3d'
    when v_days_remaining <= 7                                      then 'expiring_7d'
    when v_subscription_active                                      then 'active'
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
    'auto_renew',           coalesce(v_sub.auto_renew, true),
    'provider',             v_sub.provider
  );
end;
$$;

grant execute on function public.resolve_user_plan(uuid)
  to authenticated, anon, service_role;


-- ── 6. get_subscription_status() — rich frontend RPC ──────
-- Single call returns everything the renewal reminder needs.
-- Called by useSubscriptionStatus hook on dashboard load.

create or replace function public.get_subscription_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result jsonb;
  v_sub         record;
  v_now         timestamptz := now();
  v_show_reminder boolean;
  v_reminder_urgency text;
  v_days_remaining integer;
  v_grace_days_remaining integer;
begin
  if p_user_id is null then
    return jsonb_build_object('error','AUTH_REQUIRED');
  end if;

  v_plan_result := public.resolve_user_plan(p_user_id);

  select
    id, plan, status, billing_cycle,
    starts_at, expires_at, grace_period_ends_at,
    canceled_at, last_payment_at, next_billing_at,
    auto_renew, provider, provider_subscription_id,
    reminder_dismissed_until, granted_by_admin,
    granted_reason, subscription_source, amount, currency
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  v_days_remaining := coalesce((v_plan_result->>'days_remaining')::integer, 0);

  -- Grace period days remaining
  if v_sub.grace_period_ends_at is not null and v_sub.grace_period_ends_at > v_now then
    v_grace_days_remaining := ceil(
      extract(epoch from (v_sub.grace_period_ends_at - v_now)) / 86400
    )::integer;
  else
    v_grace_days_remaining := 0;
  end if;

  -- Reminder eligibility:
  -- Show if: expiry_state is expiring_* or grace_period
  -- AND: reminder not dismissed (or dismissal expired)
  v_show_reminder :=
    (v_plan_result->>'expiry_state') in ('expiring_1d','expiring_3d','expiring_7d','grace_period')
    and (
      v_sub.reminder_dismissed_until is null
      or v_sub.reminder_dismissed_until <= v_now
    )
    and not coalesce(v_sub.granted_by_admin, false);  -- don't nag admin grants

  -- Urgency level for UI
  v_reminder_urgency := case v_plan_result->>'expiry_state'
    when 'grace_period'  then 'critical'
    when 'expiring_1d'   then 'high'
    when 'expiring_3d'   then 'medium'
    when 'expiring_7d'   then 'low'
    else 'none'
  end;

  return jsonb_build_object(
    -- Plan state
    'plan',                   v_plan_result->>'plan',
    'subscription_active',    (v_plan_result->>'subscription_active')::boolean,
    'expiry_state',           v_plan_result->>'expiry_state',
    'in_grace_period',        (v_plan_result->>'in_grace_period')::boolean,
    'days_remaining',         v_days_remaining,
    'grace_days_remaining',   v_grace_days_remaining,

    -- Billing details
    'billing_cycle',          coalesce(v_sub.billing_cycle,'monthly'),
    'expires_at',             v_sub.expires_at,
    'grace_period_ends_at',   v_sub.grace_period_ends_at,
    'next_billing_at',        v_sub.next_billing_at,
    'last_payment_at',        v_sub.last_payment_at,
    'auto_renew',             coalesce(v_sub.auto_renew, true),
    'provider',               v_sub.provider,
    'amount',                 coalesce(v_sub.amount, 0),
    'currency',               coalesce(v_sub.currency,'USD'),
    'status',                 coalesce(v_sub.status,'none'),
    'granted_by_admin',       coalesce(v_sub.granted_by_admin, false),

    -- Reminder state
    'show_reminder',          v_show_reminder,
    'reminder_urgency',       v_reminder_urgency,
    'reminder_dismissed_until', v_sub.reminder_dismissed_until,

    -- Metadata
    'checked_at',             v_now
  );
end;
$$;

grant execute on function public.get_subscription_status(uuid)
  to authenticated, anon, service_role;

comment on function public.get_subscription_status(uuid) is
  'Rich subscription status for the renewal reminder system. '
  'Returns expiry state, days remaining, reminder eligibility, urgency level.';


-- ── 7. dismiss_expiry_popup() — 24h snooze ────────────────
create or replace function public.dismiss_expiry_popup(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_dismissed_until timestamptz := now() + interval '24 hours';
begin
  -- Users can only dismiss their own popup
  if v_caller is null or v_caller <> p_user_id then
    return jsonb_build_object('success',false,'code','UNAUTHORIZED');
  end if;

  update public.user_subscriptions
     set reminder_dismissed_until = v_dismissed_until,
         updated_at               = now()
   where user_id = p_user_id;

  if not found then
    return jsonb_build_object('success',false,'code','NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success',           true,
    'dismissed_until',   v_dismissed_until,
    'message',           'Reminder snoozed for 24 hours'
  );
end;
$$;

grant execute on function public.dismiss_expiry_popup(uuid)
  to authenticated;

comment on function public.dismiss_expiry_popup(uuid) is
  'Snoozes the renewal reminder popup for 24 hours. '
  'User can only dismiss their own popup. Synced across devices.';

-- ── 8. process_subscription_expiry() — cron-safe job ──────
-- Handles the full expiry lifecycle:
--   1. Mark 'expiring' status for subscriptions within 7 days
--   2. Activate grace period for just-expired subscriptions
--   3. Downgrade to free after grace period ends
-- Safe to call multiple times (idempotent).

create or replace function public.process_subscription_expiry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now              timestamptz := now();
  v_expiring_count   integer := 0;
  v_grace_count      integer := 0;
  v_downgraded_count integer := 0;
begin

  -- ── Step 1: Mark 'expiring' for subscriptions within 7 days ──
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
  -- Subscriptions that expired but have no grace period yet
  with newly_expired as (
    update public.user_subscriptions
       set status               = 'grace_period',
           grace_period_ends_at = v_now + interval '3 days',
           updated_at           = v_now
     where lower(status) in ('active','expiring')
       and expires_at is not null
       and expires_at <= v_now
       and grace_period_ends_at is null
       and lower(coalesce(plan,'free')) <> 'free'
    returning user_id
  )
  select count(*) into v_grace_count from newly_expired;

  -- ── Step 3: Downgrade after grace period ends ─────────────
  with grace_expired as (
    update public.user_subscriptions
       set status     = 'expired',
           updated_at = v_now
     where lower(status) = 'grace_period'
       and grace_period_ends_at is not null
       and grace_period_ends_at <= v_now
    returning user_id
  )
  -- Revert profiles to free — preserve all content
  update public.profiles p
     set subscription_tier       = 'free',
         current_plan            = 'free',
         subscription_expires_at = null,
         updated_at              = v_now
    from grace_expired g
   where p.user_id = g.user_id;

  get diagnostics v_downgraded_count = row_count;

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

comment on function public.process_subscription_expiry() is
  'Cron-safe lifecycle job. Marks expiring, activates grace periods, '
  'downgrades expired accounts. Idempotent — safe to call hourly.';


-- ── 9. UPDATED get_subscription_lifecycle() ───────────────
-- Extends existing function with new fields.

create or replace function public.get_subscription_lifecycle(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result        jsonb;
  v_sub                record;
  v_now                timestamptz := now();
  v_cooldown_remaining interval;
  v_days_until_expiry  integer;
  v_grace_days         integer;
  v_script_usage       jsonb;
  v_caption_usage      jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('error','AUTH_REQUIRED');
  end if;

  v_plan_result := public.resolve_user_plan(p_user_id);

  select
    id, plan, status, billing_cycle,
    starts_at, expires_at, grace_period_ends_at,
    cancel_at_period_end, last_plan_change_at,
    cooldown_until, granted_by_admin, granted_reason,
    subscription_source, is_revenue_eligible,
    amount, currency, reminder_dismissed_until,
    last_payment_at, next_billing_at, auto_renew,
    provider, canceled_at
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Cooldown remaining
  if v_sub.cooldown_until is not null and v_sub.cooldown_until > v_now then
    v_cooldown_remaining := v_sub.cooldown_until - v_now;
  end if;

  -- Days until expiry
  if v_sub.expires_at is not null and v_sub.expires_at > v_now then
    v_days_until_expiry := ceil(
      extract(epoch from (v_sub.expires_at - v_now)) / 86400
    )::integer;
  end if;

  -- Grace days remaining
  if v_sub.grace_period_ends_at is not null and v_sub.grace_period_ends_at > v_now then
    v_grace_days := ceil(
      extract(epoch from (v_sub.grace_period_ends_at - v_now)) / 86400
    )::integer;
  end if;

  v_script_usage  := public.get_usage(p_user_id, 'script_generation');
  v_caption_usage := public.get_usage(p_user_id, 'caption_generation');

  return jsonb_build_object(
    'plan',                   v_plan_result->>'plan',
    'subscription_active',    (v_plan_result->>'subscription_active')::boolean,
    'expires_soon',           (v_plan_result->>'expires_soon')::boolean,
    'expiry_state',           v_plan_result->>'expiry_state',
    'in_grace_period',        (v_plan_result->>'in_grace_period')::boolean,
    'days_remaining',         coalesce((v_plan_result->>'days_remaining')::integer, 0),
    'grace_days_remaining',   coalesce(v_grace_days, 0),

    'subscription_id',        v_sub.id,
    'billing_cycle',          coalesce(v_sub.billing_cycle,'monthly'),
    'starts_at',              v_sub.starts_at,
    'expires_at',             v_sub.expires_at,
    'grace_period_ends_at',   v_sub.grace_period_ends_at,
    'status',                 coalesce(v_sub.status,'none'),
    'cancel_at_period_end',   coalesce(v_sub.cancel_at_period_end, false),
    'granted_by_admin',       coalesce(v_sub.granted_by_admin, false),
    'granted_reason',         v_sub.granted_reason,
    'subscription_source',    coalesce(v_sub.subscription_source,'manual_admin'),
    'amount',                 coalesce(v_sub.amount, 0),
    'currency',               coalesce(v_sub.currency,'USD'),
    'last_payment_at',        v_sub.last_payment_at,
    'next_billing_at',        v_sub.next_billing_at,
    'auto_renew',             coalesce(v_sub.auto_renew, true),
    'provider',               v_sub.provider,
    'canceled_at',            v_sub.canceled_at,

    'cooldown_active',        (v_cooldown_remaining is not null),
    'cooldown_until',         v_sub.cooldown_until,
    'cooldown_days_remaining', case
      when v_cooldown_remaining is not null
      then ceiling(extract(epoch from v_cooldown_remaining) / 86400)::integer
      else 0
    end,
    'last_plan_change_at',    v_sub.last_plan_change_at,
    'days_until_expiry',      v_days_until_expiry,
    'reminder_dismissed_until', v_sub.reminder_dismissed_until,

    'script_usage',           v_script_usage,
    'caption_usage',          v_caption_usage
  );
end;
$$;

grant execute on function public.get_subscription_lifecycle(uuid)
  to authenticated, anon;

-- ── 10. UPDATED get_user_entitlements — grace period aware ─
create or replace function public.get_user_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result         jsonb;
  v_plan_key            text;
  v_subscription_active boolean;
  v_entitlements        jsonb := '{}'::jsonb;
  v_feat                record;
begin
  if p_user_id is null then
    return jsonb_build_object('plan','free','subscription_active',false,
      'features','{}'::jsonb);
  end if;

  v_plan_result         := public.resolve_user_plan(p_user_id);
  v_plan_key            := coalesce(v_plan_result->>'plan','free');
  v_subscription_active := coalesce((v_plan_result->>'subscription_active')::boolean,false);

  for v_feat in
    select feature_key, limit_value, limit_period, enabled,
           coalesce(metadata,'{}') as metadata
    from public.plan_entitlements
    where plan_key = v_plan_key
    order by feature_key
  loop
    v_entitlements := jsonb_set(v_entitlements, array[v_feat.feature_key],
      jsonb_build_object(
        'enabled',    v_feat.enabled and (v_feat.limit_value <> 0),
        'limit',      v_feat.limit_value,
        'period',     v_feat.limit_period,
        'unlimited',  (v_feat.limit_value = -1 and v_feat.limit_period <> 'fair_usage'),
        'fair_usage', (v_feat.limit_period = 'fair_usage'),
        'metadata',   v_feat.metadata
      ));
  end loop;

  return jsonb_build_object(
    'plan',                v_plan_key,
    'subscription_active', v_subscription_active,
    'expires_at',          v_plan_result->>'expires_at',
    'expires_soon',        coalesce((v_plan_result->>'expires_soon')::boolean,false),
    'expiry_state',        v_plan_result->>'expiry_state',
    'in_grace_period',     coalesce((v_plan_result->>'in_grace_period')::boolean,false),
    'days_remaining',      coalesce((v_plan_result->>'days_remaining')::integer,0),
    'billing_cycle',       coalesce(v_plan_result->>'billing_cycle','monthly'),
    'cooldown_until',      v_plan_result->>'cooldown_until',
    'features',            v_entitlements
  );
end;
$$;

grant execute on function public.get_user_entitlements(uuid)
  to authenticated, anon;

