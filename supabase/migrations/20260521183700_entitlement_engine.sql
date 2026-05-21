-- ============================================================
-- ROBINOS PRODUCTION ENTITLEMENT ENGINE
-- Plan-Driven Server-Side Usage Enforcement
-- 2026-05-21
-- ============================================================
-- This migration introduces a production-grade centralized
-- entitlement + usage enforcement engine that replaces the
-- scattered, non-authoritative frontend-only enforcement.
--
-- CRITICAL: This is NEW infrastructure. Old migrations are
-- NOT modified. Existing get_usage_status/consume_feature_quota
-- functions are superseded by the new RPCs below.
-- ============================================================

/* ============================================================
1. CREATE PLAN ENTITLEMENTS TABLE
Centralized plan configuration — source of truth for ALL limits
============================================================ */
create table if not exists public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  feature_key text not null,
  limit_value numeric not null default 0,
  limit_period text not null default 'day',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_key, feature_key)
);

comment on table public.plan_entitlements is 'Centralized plan configuration — authoritative limit definitions per feature per plan';
comment on column public.plan_entitlements.plan_key is 'e.g. free, creator, pro_creator, agency';
comment on column public.plan_entitlements.feature_key is 'e.g. script_generation, caption_generation, trend_scan';
comment on column public.plan_entitlements.limit_value is 'Numeric limit. 0 = disabled, -1 = unlimited/fair_usage, >0 = capped';
comment on column public.plan_entitlements.limit_period is 'day, month, 24h, lifetime, fair_usage';
comment on column public.plan_entitlements.enabled is 'Whether this feature is available on this plan at all';
comment on column public.plan_entitlements.metadata is 'Extensible — e.g. soft_threshold, abuse_warning_at, notes';

/* ============================================================
2. CREATE USAGE TRACKING TABLE
Production-grade atomic usage tracking per user per feature
============================================================ */
create table if not exists public.usage_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  feature_key text not null,
  usage_count integer not null default 0,
  period_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  last_used_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature_key, period_key)
);

comment on table public.usage_tracking is 'Atomic usage tracking per user per feature per period — race-condition safe';
comment on column public.usage_tracking.period_key is 'e.g. 2026-05-21 or 2026-05 or lifetime';
comment on column public.usage_tracking.period_start is 'Start of current usage window';
comment on column public.usage_tracking.period_end is 'End of current usage window (reset point)';
comment on column public.usage_tracking.metadata is 'Extensible — e.g. fair_usage_warnings, abuse_flags';

create index if not exists idx_usage_tracking_user_feature on public.usage_tracking (user_id, feature_key);
create index if not exists idx_usage_tracking_user_period on public.usage_tracking (user_id, period_key desc);
create index if not exists idx_usage_tracking_period_end on public.usage_tracking (period_end);

-- Enable RLS
alter table public.plan_entitlements enable row level security;
alter table public.usage_tracking enable row level security;

-- Plan entitlements: public read, admin write
drop policy if exists "Public can read plan entitlements" on public.plan_entitlements;
drop policy if exists "Admins can manage plan entitlements" on public.plan_entitlements;
create policy "Public can read plan entitlements" on public.plan_entitlements for select to public using (true);
create policy "Admins can manage plan entitlements" on public.plan_entitlements for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- Usage tracking: users own access, service_role bypass
drop policy if exists "Users can view own usage tracking" on public.usage_tracking;
drop policy if exists "Service role manages usage tracking" on public.usage_tracking;
create policy "Users can view own usage tracking" on public.usage_tracking for select using (auth.uid() = user_id);
create policy "Service role manages usage tracking" on public.usage_tracking for all to service_role using (true) with check (true);

-- Timestamp triggers
drop trigger if exists trg_plan_entitlements_updated_at on public.plan_entitlements;
create trigger trg_plan_entitlements_updated_at
  before update on public.plan_entitlements
  for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_tracking_updated_at on public.usage_tracking;
create trigger trg_usage_tracking_updated_at
  before update on public.usage_tracking
  for each row execute function public.set_updated_at();

/* ============================================================
3. SEED PLAN ENTITLEMENTS
Authoritative plan configuration — this is THE source of truth
============================================================ */
insert into public.plan_entitlements (plan_key, feature_key, limit_value, limit_period, enabled, metadata) values
  -- FREE PLAN
  ('free', 'script_generation', 2, '24h', true, '{}'::jsonb),
  ('free', 'caption_generation', 2, 'day', true, '{}'::jsonb),
  ('free', 'trend_scan', 1, 'lifetime', true, '{}'::jsonb),
  ('free', 'hashtag_scan', 0, 'day', false, '{}'::jsonb),
  ('free', 'tts_generation', 0, 'day', false, '{}'::jsonb),
  ('free', 'video_generation', 0, 'day', false, '{}'::jsonb),
  ('free', 'byok_access', 0, 'day', false, '{}'::jsonb),
  ('free', 'analytics_access', 0, 'day', false, '{}'::jsonb),
  ('free', 'watermark_removal', 0, 'day', false, '{}'::jsonb),
  ('free', 'team_workspaces', 1, 'lifetime', true, '{}'::jsonb),
  ('free', 'automation_tools', 0, 'day', false, '{}'::jsonb),
  ('free', 'export_access', 3, 'day', true, '{"watermarked": true}'::jsonb),

  -- CREATOR PLAN ($19)
  ('creator', 'script_generation', 20, 'day', true, '{}'::jsonb),
  ('creator', 'caption_generation', 20, 'day', true, '{}'::jsonb),
  ('creator', 'trend_scan', 10, 'day', true, '{}'::jsonb),
  ('creator', 'hashtag_scan', 20, 'day', true, '{}'::jsonb),
  ('creator', 'tts_generation', 0, 'day', false, '{}'::jsonb),
  ('creator', 'video_generation', 0, 'day', false, '{}'::jsonb),
  ('creator', 'byok_access', 0, 'day', false, '{}'::jsonb),
  ('creator', 'analytics_access', 5, 'day', true, '{}'::jsonb),
  ('creator', 'watermark_removal', 0, 'day', false, '{}'::jsonb),
  ('creator', 'team_workspaces', 1, 'lifetime', true, '{}'::jsonb),
  ('creator', 'automation_tools', 0, 'day', false, '{}'::jsonb),
  ('creator', 'export_access', 50, 'day', true, '{"watermarked": false}'::jsonb),

  -- PRO CREATOR PLAN ($39)
  ('pro_creator', 'script_generation', 100, 'day', true, '{}'::jsonb),
  ('pro_creator', 'caption_generation', 100, 'day', true, '{}'::jsonb),
  ('pro_creator', 'trend_scan', 100, 'day', true, '{}'::jsonb),
  ('pro_creator', 'hashtag_scan', 100, 'day', true, '{}'::jsonb),
  ('pro_creator', 'tts_generation', 200, 'day', true, '{}'::jsonb),
  ('pro_creator', 'video_generation', 50, 'day', true, '{}'::jsonb),
  ('pro_creator', 'byok_access', -1, 'day', true, '{}'::jsonb),
  ('pro_creator', 'analytics_access', -1, 'day', true, '{"advanced": true}'::jsonb),
  ('pro_creator', 'watermark_removal', 1, 'day', true, '{}'::jsonb),
  ('pro_creator', 'team_workspaces', 3, 'lifetime', true, '{}'::jsonb),
  ('pro_creator', 'automation_tools', 0, 'day', false, '{}'::jsonb),
  ('pro_creator', 'export_access', 250, 'day', true, '{"watermarked": false}'::jsonb),

  -- AGENCY PLAN ($99)
  ('agency', 'script_generation', -1, 'fair_usage', true, '{"soft_threshold": 500, "abuse_warning_at": 2000}'::jsonb),
  ('agency', 'caption_generation', -1, 'fair_usage', true, '{"soft_threshold": 500, "abuse_warning_at": 2000}'::jsonb),
  ('agency', 'trend_scan', -1, 'fair_usage', true, '{"soft_threshold": 200}'::jsonb),
  ('agency', 'hashtag_scan', -1, 'fair_usage', true, '{"soft_threshold": 200}'::jsonb),
  ('agency', 'tts_generation', -1, 'fair_usage', true, '{"soft_threshold": 500}'::jsonb),
  ('agency', 'video_generation', -1, 'fair_usage', true, '{"soft_threshold": 100, "abuse_warning_at": 500}'::jsonb),
  ('agency', 'byok_access', -1, 'day', true, '{}'::jsonb),
  ('agency', 'analytics_access', -1, 'day', true, '{"advanced": true}'::jsonb),
  ('agency', 'watermark_removal', 1, 'day', true, '{}'::jsonb),
  ('agency', 'team_workspaces', -1, 'lifetime', true, '{}'::jsonb),
  ('agency', 'automation_tools', -1, 'day', true, '{}'::jsonb),
  ('agency', 'export_access', -1, 'fair_usage', true, '{"watermarked": false, "soft_threshold": 1000}'::jsonb)
on conflict (plan_key, feature_key) do update set
  limit_value = excluded.limit_value,
  limit_period = excluded.limit_period,
  enabled = excluded.enabled,
  metadata = excluded.metadata,
  updated_at = now();

/* ============================================================
4. CENTRALIZED RPC: resolve_user_plan
Determines the effective plan for a user
============================================================ */
create or replace function public.resolve_user_plan(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_profile_tier text;
  v_subscription_plan text;
  v_subscription_status text;
  v_subscription_active boolean;
  v_effective_plan text;
begin
  -- Get profile tier
  select coalesce(subscription_tier, 'free')
  into v_profile_tier
  from public.profiles
  where user_id = p_user_id;

  -- Get subscription if it exists
  select coalesce(plan, 'free'), coalesce(status, '')
  into v_subscription_plan, v_subscription_status
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Determine if subscription is active
  v_subscription_active := lower(v_subscription_status) in ('active', 'trialing');

  -- Resolve effective plan: subscription > profile tier
  if v_subscription_active and lower(v_subscription_plan) <> 'free' then
    v_effective_plan := lower(v_subscription_plan);
  else
    v_effective_plan := lower(v_profile_tier);
  end if;

  -- Normalize legacy tier names
  if v_effective_plan in ('starter', 'basic') then
    v_effective_plan := 'creator';
  elsif v_effective_plan in ('pro', 'premium') then
    v_effective_plan := 'pro_creator';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'plan', v_effective_plan,
    'subscription_plan', lower(coalesce(v_subscription_plan, 'free')),
    'subscription_status', lower(coalesce(v_subscription_status, '')),
    'subscription_active', v_subscription_active
  );
end;
$$;

/* ============================================================
5. CENTRALIZED RPC: get_entitlement
Resolves the entitlement config for a user + feature
============================================================ */
create or replace function public.get_entitlement(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_plan_resolution jsonb;
  v_plan_key text;
  v_entitlement record;
  v_limit_value numeric;
  v_limit_period text;
  v_enabled boolean;
  v_metadata jsonb;
begin
  -- Resolve user plan
  v_plan_resolution := public.resolve_user_plan(p_user_id);
  v_plan_key := v_plan_resolution ->> 'plan';

  -- Fetch entitlement config
  select
    pe.limit_value,
    pe.limit_period,
    pe.enabled,
    coalesce(pe.metadata, '{}'::jsonb)
  into v_limit_value, v_limit_period, v_enabled, v_metadata
  from public.plan_entitlements pe
  where pe.plan_key = v_plan_key
    and pe.feature_key = p_feature_key;

  -- If no specific entitlement found, feature is disabled
  if not found then
    return jsonb_build_object(
      'plan', v_plan_key,
      'feature', p_feature_key,
      'enabled', false,
      'limit_value', 0,
      'limit_period', 'day',
      'unlimited', false,
      'fair_usage', false,
      'metadata', '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'plan', v_plan_key,
    'feature', p_feature_key,
    'enabled', v_enabled,
    'limit_value', v_limit_value,
    'limit_period', v_limit_period,
    'unlimited', (v_limit_value = -1 and v_limit_period <> 'fair_usage'),
    'fair_usage', (v_limit_period = 'fair_usage'),
    'metadata', v_metadata
  );
end;
$$;

/* ============================================================
6. CENTRALIZED RPC: get_usage
Gets current usage for a user + feature in the current period
============================================================ */
create or replace function public.get_usage(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_entitlement jsonb;
  v_limit_period text;
  v_period_key text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_usage_record record;
begin
  -- Get entitlement to determine period
  v_entitlement := public.get_entitlement(p_user_id, p_feature_key);
  v_limit_period := v_entitlement ->> 'limit_period';

  -- Calculate period boundaries
  if v_limit_period = '24h' then
    v_period_start := date_trunc('hour', now()) - interval '24 hours';
    v_period_end := v_period_start + interval '24 hours';
    v_period_key := to_char(v_period_start, 'YYYY-MM-DD-HH24');
  elsif v_limit_period = 'day' then
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  elsif v_limit_period = 'month' then
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
    v_period_key := to_char(now(), 'YYYY-MM');
  elsif v_limit_period = 'lifetime' then
    v_period_start := '2025-01-01'::timestamptz;
    v_period_end := '2099-12-31'::timestamptz;
    v_period_key := 'lifetime';
  elsif v_limit_period = 'fair_usage' then
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  else
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  end if;

  -- Fetch or return zero usage
  select ut.usage_count, ut.last_used_at, ut.period_start, ut.period_end
  into v_usage_record
  from public.usage_tracking ut
  where ut.user_id = p_user_id
    and ut.feature_key = p_feature_key
    and ut.period_key = v_period_key;

  if not found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'feature', p_feature_key,
      'period_key', v_period_key,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'usage_count', 0,
      'last_used_at', null::timestamptz
    )::jsonb;
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'feature', p_feature_key,
    'period_key', v_period_key,
    'period_start', v_usage_record.period_start,
    'period_end', v_usage_record.period_end,
    'usage_count', v_usage_record.usage_count,
    'last_used_at', v_usage_record.last_used_at
  )::jsonb;
end;
$$;

/* ============================================================
7. RPC: check_and_increment_usage (ATOMIC)
Usage validation + increment in a SINGLE atomic operation.
This is the critical RPC that prevents ALL bypass vectors.

Race-condition safe via:
- UPSERT with unique constraint
- Row-level locking via FOR UPDATE
- Single transaction scope
- Idempotency key deduplication
============================================================ */
create or replace function public.check_and_increment_usage(
  p_user_id uuid,
  p_feature_key text,
  p_increment integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_entitlement jsonb;
  v_limit_value numeric;
  v_limit_period text;
  v_enabled boolean;
  v_unlimited boolean;
  v_fair_usage boolean;
  v_metadata jsonb;
  v_period_key text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_current_usage integer;
  v_allowed boolean;
  v_remaining numeric;
  v_reset_at timestamptz;
  v_fair_usage_warning boolean;
  v_soft_threshold numeric;
  v_abuse_warning_at numeric;
begin
  -- Validate inputs
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'AUTH_REQUIRED',
      'message', 'Authentication required'
    );
  end if;

  if coalesce(p_increment, 0) < 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_INCREMENT',
      'message', 'Increment must be greater than 0'
    );
  end if;

  -- Check idempotency first (prevents double increments)
  if p_idempotency_key is not null then
    perform 1
    from public.feature_usage_events
    where user_id = p_user_id
      and feature_name = p_feature_key
      and idempotency_key = p_idempotency_key;
    
    if found then
      -- Already processed — return current status without incrementing
      return jsonb_build_object(
        'success', true,
        'code', 'IDEMPOTENT',
        'feature', p_feature_key,
        'plan', (public.get_entitlement(p_user_id, p_feature_key) ->> 'plan'),
        'message', 'Request already processed',
        'usage', public.get_usage(p_user_id, p_feature_key)
      );
    end if;
  end if;

  -- Resolve entitlement
  v_entitlement := public.get_entitlement(p_user_id, p_feature_key);
  v_enabled := (v_entitlement ->> 'enabled')::boolean;
  v_limit_value := (v_entitlement ->> 'limit_value')::numeric;
  v_limit_period := v_entitlement ->> 'limit_period';
  v_unlimited := (v_entitlement ->> 'unlimited')::boolean;
  v_fair_usage := (v_entitlement ->> 'fair_usage')::boolean;
  v_metadata := v_entitlement -> 'metadata';

  -- Feature disabled check
  if not v_enabled then
    return jsonb_build_object(
      'success', false,
      'code', 'FEATURE_DISABLED',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'message', 'This feature is not available on your current plan'
    );
  end if;

  -- Calculate period boundaries
  if v_limit_period = '24h' then
    v_period_start := date_trunc('hour', now()) - interval '24 hours';
    v_period_end := v_period_start + interval '24 hours';
    v_period_key := to_char(v_period_start, 'YYYY-MM-DD-HH24');
  elsif v_limit_period = 'day' then
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  elsif v_limit_period = 'month' then
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
    v_period_key := to_char(now(), 'YYYY-MM');
  elsif v_limit_period = 'lifetime' then
    v_period_start := '2025-01-01'::timestamptz;
    v_period_end := '2099-12-31'::timestamptz;
    v_period_key := 'lifetime';
  elsif v_limit_period = 'fair_usage' then
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  else
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
    v_period_key := to_char(now(), 'YYYY-MM-DD');
  end if;

  v_reset_at := v_period_end;

  -- Unlimited: always allowed, still track
  if v_unlimited then
    -- Atomic UPSERT to increment
    insert into public.usage_tracking (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
    values (p_user_id, p_feature_key, p_increment, v_period_key, v_period_start, v_period_end, now())
    on conflict (user_id, feature_key, period_key)
    do update set
      usage_count = public.usage_tracking.usage_count + p_increment,
      last_used_at = now(),
      updated_at = now();

    -- Record idempotency
    if p_idempotency_key is not null then
      insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
      values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
      on conflict (user_id, feature_name, idempotency_key) do nothing;
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'ALLOWED',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'unlimited', true,
      'fair_usage', false,
      'message', 'Usage recorded (unlimited plan)'
    );
  end if;

  -- Fair Usage
  if v_fair_usage then
    -- Atomic UPSERT with row lock
    insert into public.usage_tracking (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
    values (p_user_id, p_feature_key, p_increment, v_period_key, v_period_start, v_period_end, now())
    on conflict (user_id, feature_key, period_key)
    do update set
      usage_count = public.usage_tracking.usage_count + p_increment,
      last_used_at = now(),
      updated_at = now()
    returning usage_count into v_current_usage;

    -- Check soft thresholds
    v_soft_threshold := coalesce((v_metadata ->> 'soft_threshold')::numeric, 0);
    v_abuse_warning_at := coalesce((v_metadata ->> 'abuse_warning_at')::numeric, 0);
    v_fair_usage_warning := false;

    if v_abuse_warning_at > 0 and v_current_usage >= v_abuse_warning_at then
      v_fair_usage_warning := true;
      -- Update metadata with warning
      update public.usage_tracking
      set metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{abuse_warning}',
        to_jsonb(now()::text)
      )
      where user_id = p_user_id
        and feature_key = p_feature_key
        and period_key = v_period_key;
    end if;

    -- Record idempotency
    if p_idempotency_key is not null then
      insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
      values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
      on conflict (user_id, feature_name, idempotency_key) do nothing;
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'ALLOWED_FAIR_USAGE',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'unlimited', false,
      'fair_usage', true,
      'usage_count', v_current_usage,
      'soft_threshold', case when v_soft_threshold > 0 then v_soft_threshold else null end,
      'abuse_warning', v_fair_usage_warning,
      'message', case when v_fair_usage_warning then 'Fair usage warning: unusually high activity' else 'Usage recorded (fair usage)' end
    );
  end if;

  -- Capped plan: check current usage before incrementing
  -- Atomic UPSERT to get current usage safely
  insert into public.usage_tracking (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
  values (p_user_id, p_feature_key, 0, v_period_key, v_period_start, v_period_end, now())
  on conflict (user_id, feature_key, period_key)
  do nothing;

  -- Read current usage with FOR UPDATE lock
  select usage_count into v_current_usage
  from public.usage_tracking
  where user_id = p_user_id
    and feature_key = p_feature_key
    and period_key = v_period_key
  for update;

  v_current_usage := coalesce(v_current_usage, 0);

  -- Check limit
  if v_current_usage + p_increment > v_limit_value then
    v_remaining := greatest(v_limit_value - v_current_usage, 0);
    return jsonb_build_object(
      'success', false,
      'code', 'USAGE_LIMIT_EXCEEDED',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'limit', v_limit_value,
      'used', v_current_usage,
      'remaining', v_remaining,
      'reset_at', v_reset_at,
      'message', case
        when v_limit_period = '24h' then '24-hour limit reached.'
        else 'Daily ' || replace(p_feature_key, '_', ' ') || ' limit reached.'
      end
    );
  end if;

  -- Increment usage atomically
  update public.usage_tracking
  set usage_count = usage_count + p_increment,
      last_used_at = now(),
      updated_at = now()
  where user_id = p_user_id
    and feature_key = p_feature_key
    and period_key = v_period_key;

  -- Record idempotency
  if p_idempotency_key is not null then
    insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
    values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
    on conflict (user_id, feature_name, idempotency_key) do nothing;
  end if;

  v_remaining := greatest(v_limit_value - (v_current_usage + p_increment), 0);

  return jsonb_build_object(
    'success', true,
    'code', 'ALLOWED',
    'feature', p_feature_key,
    'plan', (v_entitlement ->> 'plan'),
    'limit', v_limit_value,
    'used', v_current_usage + p_increment,
    'remaining', v_remaining,
    'reset_at', v_reset_at,
    'message', 'Usage recorded'
  );
end;
$$;

/* ============================================================
8. BACKWARD-COMPATIBLE WRAPPER RPCs
These maintain compatibility with the existing get_usage_status
and consume_feature_quota patterns, but delegate to the new engine.
============================================================ */
create or replace function public.get_usage_status_v2(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_entitlement jsonb;
  v_usage jsonb;
  v_limit_value numeric;
  v_enabled boolean;
  v_unlimited boolean;
  v_fair_usage boolean;
  v_usage_count integer;
  v_remaining numeric;
  v_allowed boolean;
  v_near_limit boolean;
  v_byok_enabled boolean;
begin
  v_entitlement := public.get_entitlement(p_user_id, p_feature_key);
  v_usage := public.get_usage(p_user_id, p_feature_key);

  v_enabled := (v_entitlement ->> 'enabled')::boolean;
  v_limit_value := (v_entitlement ->> 'limit_value')::numeric;
  v_unlimited := (v_entitlement ->> 'unlimited')::boolean;
  v_fair_usage := (v_entitlement ->> 'fair_usage')::boolean;
  v_usage_count := coalesce((v_usage ->> 'usage_count')::integer, 0);

  -- Feature disabled
  if not v_enabled then
    return jsonb_build_object(
      'allowed', false,
      'used', 0,
      'quota', 0,
      'remaining', 0,
      'near_limit', false,
      'fair_usage', false,
      'unlimited', false,
      'byok_enabled', false,
      'message', 'Feature not available on your plan'
    );
  end if;

  -- Unlimited or fair usage
  if v_unlimited or v_fair_usage then
    v_allowed := true;
    v_remaining := 999999;
    v_near_limit := false;

    -- Check BYOK access
    select (v_entitlement ->> 'plan') in ('pro_creator', 'agency', 'scale_agency')
    into v_byok_enabled;

    return jsonb_build_object(
      'allowed', v_allowed,
      'used', v_usage_count,
      'quota', null::integer,
      'remaining', 999999,
      'near_limit', v_near_limit,
      'fair_usage', v_fair_usage,
      'unlimited', v_unlimited,
      'byok_enabled', v_byok_enabled,
      'message', case when v_fair_usage then 'Unlimited (fair usage)' else 'Unlimited' end
    );
  end if;

  -- Capped plan
  v_remaining := greatest(v_limit_value - v_usage_count, 0);
  v_allowed := v_remaining > 0;
  v_near_limit := v_limit_value > 0 and v_usage_count >= ceil(v_limit_value * 0.8);

  -- Check BYOK access from entitlements
  select exists (
    select 1 from public.plan_entitlements
    where plan_key = (v_entitlement ->> 'plan')
      and feature_key = 'byok_access'
      and enabled = true
      and (limit_value = -1 or limit_value > 0)
  ) into v_byok_enabled;

  return jsonb_build_object(
    'allowed', v_allowed,
    'used', v_usage_count,
    'quota', v_limit_value,
    'remaining', v_remaining,
    'near_limit', v_near_limit,
    'fair_usage', false,
    'unlimited', false,
    'byok_enabled', coalesce(v_byok_enabled, false),
    'message', case when v_allowed then 'Usage available' else 'Limit reached' end
  );
end;
$$;

/* ============================================================
9. RPC: reset_usage
Admin function to reset usage for a user + feature
============================================================ */
create or replace function public.reset_usage(
  p_user_id uuid,
  p_feature_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role text;
begin
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if p_feature_key is not null then
    delete from public.usage_tracking
    where user_id = p_user_id
      and feature_key = p_feature_key;
  else
    delete from public.usage_tracking
    where user_id = p_user_id;
  end if;

  return jsonb_build_object('success', true, 'message', 'Usage reset');
end;
$$;

/* ============================================================
10. PERFORMANCE INDEXES
============================================================ */
create index if not exists idx_plan_entitlements_plan_feature on public.plan_entitlements (plan_key, feature_key);
create index if not exists idx_plan_entitlements_feature on public.plan_entitlements (feature_key);
create index if not exists idx_usage_tracking_period_lookup on public.usage_tracking (user_id, feature_key, period_key);
create index if not exists idx_usage_tracking_usage_lookup on public.usage_tracking (user_id, feature_key, period_start, period_end);

/* ============================================================
11. SEED INITIAL DATA FOR EXISTING USERS
Sets up usage_tracking entries for users who already had usage
via the old system. This ensures a smooth migration.
Note: Old usage counters on profiles table remain for reference
but are no longer authoritative.
============================================================ */
-- Populate usage_tracking from existing profile counters for active users
insert into public.usage_tracking (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
select
  p.user_id,
  'script_generation',
  coalesce(p.scripts_used_this_month, 0),
  to_char(now(), 'YYYY-MM-DD'),
  date_trunc('day', now()),
  date_trunc('day', now()) + interval '1 day',
  now()
from public.profiles p
where coalesce(p.scripts_used_this_month, 0) > 0
on conflict (user_id, feature_key, period_key)
do nothing;

-- Note: The old fields (scripts_used_this_month, free_scans_used, etc.)
-- on the profiles table are preserved for backward compatibility
-- but are no longer authoritative. The new entitlement engine
-- uses plan_entitlements + usage_tracking as the source of truth.