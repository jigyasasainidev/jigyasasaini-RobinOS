-- Canonical plan entitlement source
create table if not exists public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null unique,
  max_scripts_per_day integer not null default 0,
  max_audio_generations integer not null default 0,
  max_hashtag_generations integer not null default 0,
  max_workspaces integer not null default 1,
  max_trend_scans_per_day integer not null default 0,
  max_exports_per_day integer not null default 0,
  advanced_analytics_enabled boolean not null default false,
  watermark_removed boolean not null default false,
  automation_enabled boolean not null default false,
  priority_generation boolean not null default false,
  long_form_enabled boolean not null default false,
  team_workspace_enabled boolean not null default false,
  white_label_enabled boolean not null default false,
  byok_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_entitlements_plan_name_check check (plan_name in ('free', 'creator', 'pro_creator', 'agency')),
  constraint plan_entitlements_non_negative_check check (
    max_scripts_per_day >= 0
    and max_audio_generations >= 0
    and max_hashtag_generations >= 0
    and max_workspaces >= 0
    and max_trend_scans_per_day >= 0
    and max_exports_per_day >= 0
  )
);

alter table public.plan_entitlements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='plan_entitlements' and policyname='Authenticated users can read plan entitlements'
  ) then
    create policy "Authenticated users can read plan entitlements"
    on public.plan_entitlements
    for select
    to authenticated
    using (true);
  end if;
end $$;

-- Canonical subscriptions table (Paddle-backed)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  paddle_customer_id text,
  paddle_subscription_id text unique,
  plan_name text not null default 'free',
  billing_cycle text not null default 'monthly',
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_plan_name_check check (plan_name in ('free', 'creator', 'pro_creator', 'agency')),
  constraint subscriptions_billing_cycle_check check (billing_cycle in ('monthly', 'yearly')),
  constraint subscriptions_status_check check (status in ('active', 'trialing', 'past_due', 'canceled', 'payment_failed', 'expired', 'free'))
);

create index if not exists idx_subscriptions_user_status on public.subscriptions(user_id, status);
create index if not exists idx_subscriptions_expires_at on public.subscriptions(expires_at);
create index if not exists idx_subscriptions_plan_cycle on public.subscriptions(plan_name, billing_cycle);

alter table public.subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='subscriptions' and policyname='Users can read own subscriptions'
  ) then
    create policy "Users can read own subscriptions"
    on public.subscriptions
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;
end $$;

-- Daily usage tracking table
create table if not exists public.usage_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  usage_date date not null default ((now() at time zone 'utc')::date),
  scripts_generated integer not null default 0,
  audio_generated integer not null default 0,
  hashtags_generated integer not null default 0,
  trend_scans integer not null default 0,
  exports_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_tracking_unique_per_day unique (user_id, usage_date),
  constraint usage_tracking_non_negative_check check (
    scripts_generated >= 0
    and audio_generated >= 0
    and hashtags_generated >= 0
    and trend_scans >= 0
    and exports_used >= 0
  )
);

create index if not exists idx_usage_tracking_user_date on public.usage_tracking(user_id, usage_date desc);

alter table public.usage_tracking enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='usage_tracking' and policyname='Users can read own usage tracking'
  ) then
    create policy "Users can read own usage tracking"
    on public.usage_tracking
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;
end $$;

-- Subscription audit logs + webhook idempotency
create table if not exists public.subscription_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  user_id uuid,
  paddle_customer_id text,
  paddle_subscription_id text,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'processed',
  error_message text,
  created_at timestamptz not null default now(),
  constraint subscription_audit_logs_status_check check (processing_status in ('processed', 'ignored', 'failed'))
);

create index if not exists idx_subscription_audit_logs_created_at on public.subscription_audit_logs(created_at desc);
create index if not exists idx_subscription_audit_logs_subscription on public.subscription_audit_logs(paddle_subscription_id);

alter table public.subscription_audit_logs enable row level security;

-- Keep logs private to backend only (service role bypasses RLS)

-- Updated_at triggers
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_plan_entitlements_updated_at on public.plan_entitlements;
create trigger trg_plan_entitlements_updated_at
before update on public.plan_entitlements
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_usage_tracking_updated_at on public.usage_tracking;
create trigger trg_usage_tracking_updated_at
before update on public.usage_tracking
for each row
execute function public.touch_updated_at();

-- Seed canonical entitlements (single source of truth)
insert into public.plan_entitlements (
  plan_name,
  max_scripts_per_day,
  max_audio_generations,
  max_hashtag_generations,
  max_workspaces,
  max_trend_scans_per_day,
  max_exports_per_day,
  advanced_analytics_enabled,
  watermark_removed,
  automation_enabled,
  priority_generation,
  long_form_enabled,
  team_workspace_enabled,
  white_label_enabled,
  byok_enabled
)
values
  ('free', 3, 0, 0, 1, 3, 3, false, false, false, false, false, false, false, false),
  ('creator', 20, 20, 30, 3, 50, 20, false, true, false, false, false, false, false, false),
  ('pro_creator', 100, 100, 100, 5, 200, 100, true, true, false, true, true, false, false, false),
  ('agency', 1000000, 1000000, 1000000, 100, 1000000, 1000000, true, true, true, true, true, true, true, true)
on conflict (plan_name) do update set
  max_scripts_per_day = excluded.max_scripts_per_day,
  max_audio_generations = excluded.max_audio_generations,
  max_hashtag_generations = excluded.max_hashtag_generations,
  max_workspaces = excluded.max_workspaces,
  max_trend_scans_per_day = excluded.max_trend_scans_per_day,
  max_exports_per_day = excluded.max_exports_per_day,
  advanced_analytics_enabled = excluded.advanced_analytics_enabled,
  watermark_removed = excluded.watermark_removed,
  automation_enabled = excluded.automation_enabled,
  priority_generation = excluded.priority_generation,
  long_form_enabled = excluded.long_form_enabled,
  team_workspace_enabled = excluded.team_workspace_enabled,
  white_label_enabled = excluded.white_label_enabled,
  byok_enabled = excluded.byok_enabled,
  updated_at = now();

-- Normalize/initialize subscriptions for existing users
insert into public.subscriptions (
  user_id,
  plan_name,
  billing_cycle,
  status,
  current_period_start,
  current_period_end,
  expires_at,
  cancel_at_period_end
)
select
  p.user_id,
  case
    when lower(coalesce(p.subscription_tier, 'free')) in ('pro', 'pro_creator') then 'pro_creator'
    when lower(coalesce(p.subscription_tier, 'free')) in ('agency', 'scale_agency') then 'agency'
    when lower(coalesce(p.subscription_tier, 'free')) in ('creator', 'starter') then 'creator'
    else 'free'
  end,
  'monthly',
  case
    when lower(coalesce(p.subscription_tier, 'free')) = 'free' then 'free'
    else 'active'
  end,
  coalesce(p.created_at, now()),
  case
    when p.subscription_expires_at is not null then p.subscription_expires_at
    when lower(coalesce(p.subscription_tier, 'free')) = 'free' then null
    else now() + interval '1 month'
  end,
  p.subscription_expires_at,
  false
from public.profiles p
on conflict (user_id) do nothing;

-- Helper: canonical current entitlement bundle for a user
create or replace function public.get_user_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_ent record;
  v_now timestamptz := now();
  v_plan text := 'free';
  v_status text := 'free';
  v_cycle text := 'monthly';
  v_expires_at timestamptz := null;
begin
  select s.*
  into v_sub
  from public.subscriptions s
  where s.user_id = p_user_id
  order by s.updated_at desc
  limit 1;

  if found then
    v_plan := v_sub.plan_name;
    v_status := v_sub.status;
    v_cycle := v_sub.billing_cycle;
    v_expires_at := v_sub.expires_at;

    if v_expires_at is not null and v_expires_at < v_now then
      v_plan := 'free';
      v_status := 'expired';
    end if;
  end if;

  select *
  into v_ent
  from public.plan_entitlements pe
  where pe.plan_name = v_plan
  limit 1;

  if not found then
    select *
    into v_ent
    from public.plan_entitlements pe
    where pe.plan_name = 'free'
    limit 1;
    v_plan := 'free';
  end if;

  return jsonb_build_object(
    'plan_name', v_plan,
    'status', v_status,
    'billing_cycle', v_cycle,
    'expires_at', v_expires_at,
    'entitlements', to_jsonb(v_ent)
  );
end;
$$;

-- Helper: authenticated caller entitlement snapshot
create or replace function public.get_my_entitlements()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_user_entitlements(auth.uid());
$$;

-- Atomic usage gate + increment
create or replace function public.check_and_consume_usage(
  p_feature_name text,
  p_increment integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_ent jsonb;
  v_plan text;
  v_limit integer := 0;
  v_used integer := 0;
  v_remaining integer := 0;
  v_col text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_increment is null or p_increment <= 0 then
    raise exception 'Increment must be greater than zero';
  end if;

  v_ent := public.get_user_entitlements(v_user_id);
  v_plan := coalesce(v_ent ->> 'plan_name', 'free');

  if p_feature_name = 'scripts' then
    v_limit := coalesce((v_ent #>> '{entitlements,max_scripts_per_day}')::integer, 0);
    v_col := 'scripts_generated';
  elsif p_feature_name = 'audio' then
    v_limit := coalesce((v_ent #>> '{entitlements,max_audio_generations}')::integer, 0);
    v_col := 'audio_generated';
  elsif p_feature_name = 'hashtags' then
    v_limit := coalesce((v_ent #>> '{entitlements,max_hashtag_generations}')::integer, 0);
    v_col := 'hashtags_generated';
  elsif p_feature_name = 'trend_scans' then
    v_limit := coalesce((v_ent #>> '{entitlements,max_trend_scans_per_day}')::integer, 0);
    v_col := 'trend_scans';
  elsif p_feature_name = 'exports' then
    v_limit := coalesce((v_ent #>> '{entitlements,max_exports_per_day}')::integer, 0);
    v_col := 'exports_used';
  else
    raise exception 'Unsupported feature: %', p_feature_name;
  end if;

  insert into public.usage_tracking (user_id, usage_date)
  values (v_user_id, v_today)
  on conflict (user_id, usage_date) do nothing;

  if v_col = 'scripts_generated' then
    select scripts_generated into v_used from public.usage_tracking where user_id = v_user_id and usage_date = v_today for update;
  elsif v_col = 'audio_generated' then
    select audio_generated into v_used from public.usage_tracking where user_id = v_user_id and usage_date = v_today for update;
  elsif v_col = 'hashtags_generated' then
    select hashtags_generated into v_used from public.usage_tracking where user_id = v_user_id and usage_date = v_today for update;
  elsif v_col = 'trend_scans' then
    select trend_scans into v_used from public.usage_tracking where user_id = v_user_id and usage_date = v_today for update;
  else
    select exports_used into v_used from public.usage_tracking where user_id = v_user_id and usage_date = v_today for update;
  end if;

  v_used := coalesce(v_used, 0);

  if v_limit >= 0 and (v_used + p_increment) > v_limit then
    v_remaining := greatest(v_limit - v_used, 0);
    return jsonb_build_object(
      'ok', false,
      'error', 'limit_exceeded',
      'message', 'You reached your current plan limit.',
      'feature_name', p_feature_name,
      'plan_name', v_plan,
      'limit', v_limit,
      'used', v_used,
      'remaining', v_remaining
    );
  end if;

  if v_col = 'scripts_generated' then
    update public.usage_tracking
      set scripts_generated = scripts_generated + p_increment,
          updated_at = now()
    where user_id = v_user_id and usage_date = v_today
    returning scripts_generated into v_used;
  elsif v_col = 'audio_generated' then
    update public.usage_tracking
      set audio_generated = audio_generated + p_increment,
          updated_at = now()
    where user_id = v_user_id and usage_date = v_today
    returning audio_generated into v_used;
  elsif v_col = 'hashtags_generated' then
    update public.usage_tracking
      set hashtags_generated = hashtags_generated + p_increment,
          updated_at = now()
    where user_id = v_user_id and usage_date = v_today
    returning hashtags_generated into v_used;
  elsif v_col = 'trend_scans' then
    update public.usage_tracking
      set trend_scans = trend_scans + p_increment,
          updated_at = now()
    where user_id = v_user_id and usage_date = v_today
    returning trend_scans into v_used;
  else
    update public.usage_tracking
      set exports_used = exports_used + p_increment,
          updated_at = now()
    where user_id = v_user_id and usage_date = v_today
    returning exports_used into v_used;
  end if;

  v_remaining := greatest(v_limit - v_used, 0);

  return jsonb_build_object(
    'ok', true,
    'feature_name', p_feature_name,
    'plan_name', v_plan,
    'limit', v_limit,
    'used', v_used,
    'remaining', v_remaining
  );
end;
$$;

-- Safe downgrade utility (single user)
create or replace function public.apply_subscription_expiry_downgrade(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub
  from public.subscriptions
  where user_id = p_user_id
  order by updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_sub.expires_at is null or v_sub.expires_at >= now() then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'not_expired');
  end if;

  update public.subscriptions
  set plan_name = 'free',
      status = 'expired',
      billing_cycle = 'monthly',
      cancel_at_period_end = false,
      current_period_end = v_sub.expires_at,
      updated_at = now()
  where id = v_sub.id;

  update public.profiles
  set subscription_tier = 'free',
      current_plan = 'free',
      free_trial_expired = true,
      subscription_expires_at = null,
      updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'changed', true, 'new_plan', 'free');
end;
$$;

-- Bulk expiry sweeper utility (for schedulers/webhooks/admin jobs)
create or replace function public.apply_expiry_downgrades_batch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select s.user_id
    from public.subscriptions s
    where s.plan_name <> 'free'
      and s.expires_at is not null
      and s.expires_at < now()
  loop
    perform public.apply_subscription_expiry_downgrade(v_row.user_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;