-- Core extensions
create extension if not exists pgcrypto;

-- Generic updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Roles enum and table (kept separate from profiles for security)
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('user', 'admin', 'support', 'super_admin');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, role)
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text,
  display_name text,
  full_name text,
  subscription_tier text not null default 'free',
  current_plan text not null default 'free',
  referral_code text unique,
  referred_by_code text,
  affiliate_enabled boolean not null default true,
  is_suspended boolean not null default false,
  currency text not null default 'USD',
  country text not null default 'Global',
  free_scans_used integer not null default 0,
  free_scripts_used integer not null default 0,
  free_trial_started_at timestamptz not null default now(),
  free_trial_expired boolean not null default false,
  scripts_used_this_month integer not null default 0,
  scripts_reset_at timestamptz not null default now(),
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  plan text not null default 'free',
  status text not null default 'active',
  amount numeric(10,2) not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, user_id)
);

create table if not exists public.onboarding_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  workspace_id uuid,
  is_completed boolean not null default false,
  current_step integer not null default 0,
  welcome_seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  referral_code text not null unique,
  total_clicks integer not null default 0,
  total_conversions integer not null default 0,
  total_earned numeric(10,2) not null default 0,
  pending_balance numeric(10,2) not null default 0,
  paid_balance numeric(10,2) not null default 0,
  payout_method text,
  payout_details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referred_user_id uuid not null unique,
  referral_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  period_key date not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, feature_name, period_key)
);

-- Helpful indexes
create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_profiles_referral_code on public.profiles(referral_code);
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);
create index if not exists idx_user_subscriptions_user_id on public.user_subscriptions(user_id);
create index if not exists idx_workspaces_owner_user_id on public.workspaces(owner_user_id);
create index if not exists idx_workspace_memberships_user_id on public.workspace_memberships(user_id);
create index if not exists idx_affiliate_profiles_user_id on public.affiliate_profiles(user_id);
create index if not exists idx_affiliate_referrals_affiliate_user_id on public.affiliate_referrals(affiliate_user_id);
create index if not exists idx_usage_counters_lookup on public.usage_counters(user_id, feature_name, period_key);

-- updated_at triggers
create or replace function public.ensure_updated_at_trigger(_table regclass, _trigger_name text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = _trigger_name
      and tgrelid = _table
      and not tgisinternal
  ) then
    execute format(
      'create trigger %I before update on %s for each row execute function public.set_updated_at()',
      _trigger_name,
      _table
    );
  end if;
end;
$$;

select public.ensure_updated_at_trigger('public.user_roles'::regclass, 'trg_user_roles_updated_at');
select public.ensure_updated_at_trigger('public.profiles'::regclass, 'trg_profiles_updated_at');
select public.ensure_updated_at_trigger('public.user_subscriptions'::regclass, 'trg_user_subscriptions_updated_at');
select public.ensure_updated_at_trigger('public.workspaces'::regclass, 'trg_workspaces_updated_at');
select public.ensure_updated_at_trigger('public.workspace_memberships'::regclass, 'trg_workspace_memberships_updated_at');
select public.ensure_updated_at_trigger('public.onboarding_states'::regclass, 'trg_onboarding_states_updated_at');
select public.ensure_updated_at_trigger('public.affiliate_profiles'::regclass, 'trg_affiliate_profiles_updated_at');
select public.ensure_updated_at_trigger('public.affiliate_referrals'::regclass, 'trg_affiliate_referrals_updated_at');
select public.ensure_updated_at_trigger('public.usage_counters'::regclass, 'trg_usage_counters_updated_at');

drop function if exists public.ensure_updated_at_trigger(regclass, text);

-- Enable RLS
alter table public.user_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.onboarding_states enable row level security;
alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.usage_counters enable row level security;

-- Recreate policies safely
-- profiles
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can delete own profile" on public.profiles;

create policy "Users can view own profile" on public.profiles
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own profile" on public.profiles
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own profile" on public.profiles
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own profile" on public.profiles
for delete to authenticated
using (auth.uid() = user_id);

-- user_roles (read own roles only)
drop policy if exists "Users can view own roles" on public.user_roles;
create policy "Users can view own roles" on public.user_roles
for select to authenticated
using (auth.uid() = user_id);

-- user_subscriptions
drop policy if exists "Users can view own subscription" on public.user_subscriptions;
create policy "Users can view own subscription" on public.user_subscriptions
for select to authenticated
using (auth.uid() = user_id);

-- workspaces
drop policy if exists "Users can view own workspaces" on public.workspaces;
drop policy if exists "Users can insert own workspaces" on public.workspaces;
drop policy if exists "Users can update own workspaces" on public.workspaces;
drop policy if exists "Users can delete own workspaces" on public.workspaces;

create policy "Users can view own workspaces" on public.workspaces
for select to authenticated
using (auth.uid() = owner_user_id);

create policy "Users can insert own workspaces" on public.workspaces
for insert to authenticated
with check (auth.uid() = owner_user_id);

create policy "Users can update own workspaces" on public.workspaces
for update to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "Users can delete own workspaces" on public.workspaces
for delete to authenticated
using (auth.uid() = owner_user_id);

-- workspace_memberships
drop policy if exists "Users can view own memberships" on public.workspace_memberships;
drop policy if exists "Users can insert own memberships" on public.workspace_memberships;
drop policy if exists "Users can update own memberships" on public.workspace_memberships;
drop policy if exists "Users can delete own memberships" on public.workspace_memberships;

create policy "Users can view own memberships" on public.workspace_memberships
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own memberships" on public.workspace_memberships
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own memberships" on public.workspace_memberships
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own memberships" on public.workspace_memberships
for delete to authenticated
using (auth.uid() = user_id);

-- onboarding_states
drop policy if exists "Users can view own onboarding state" on public.onboarding_states;
drop policy if exists "Users can insert own onboarding state" on public.onboarding_states;
drop policy if exists "Users can update own onboarding state" on public.onboarding_states;
drop policy if exists "Users can delete own onboarding state" on public.onboarding_states;

create policy "Users can view own onboarding state" on public.onboarding_states
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own onboarding state" on public.onboarding_states
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own onboarding state" on public.onboarding_states
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own onboarding state" on public.onboarding_states
for delete to authenticated
using (auth.uid() = user_id);

-- affiliate_profiles
drop policy if exists "Users can view own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Users can insert own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Users can update own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Users can delete own affiliate profile" on public.affiliate_profiles;

create policy "Users can view own affiliate profile" on public.affiliate_profiles
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own affiliate profile" on public.affiliate_profiles
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own affiliate profile" on public.affiliate_profiles
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own affiliate profile" on public.affiliate_profiles
for delete to authenticated
using (auth.uid() = user_id);

-- affiliate_referrals
drop policy if exists "Users can view own affiliate referrals" on public.affiliate_referrals;
create policy "Users can view own affiliate referrals" on public.affiliate_referrals
for select to authenticated
using (auth.uid() = affiliate_user_id or auth.uid() = referred_user_id);

-- usage_counters
drop policy if exists "Users can view own usage counters" on public.usage_counters;
drop policy if exists "Users can insert own usage counters" on public.usage_counters;
drop policy if exists "Users can update own usage counters" on public.usage_counters;
drop policy if exists "Users can delete own usage counters" on public.usage_counters;

create policy "Users can view own usage counters" on public.usage_counters
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own usage counters" on public.usage_counters
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own usage counters" on public.usage_counters
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own usage counters" on public.usage_counters
for delete to authenticated
using (auth.uid() = user_id);

-- Referral code helper
create or replace function public.generate_referral_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    exit when not exists (
      select 1 from public.affiliate_profiles ap where ap.referral_code = v_code
      union all
      select 1 from public.profiles p where p.referral_code = v_code
    );
  end loop;

  return v_code;
end;
$$;

-- Creates affiliate profile if missing
create or replace function public.ensure_affiliate_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ref_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_affiliate_profile:' || v_user_id::text));

  select referral_code into v_ref_code from public.affiliate_profiles where user_id = v_user_id;

  if v_ref_code is null then
    v_ref_code := public.generate_referral_code();

    insert into public.affiliate_profiles (user_id, referral_code)
    values (v_user_id, v_ref_code)
    on conflict (user_id) do nothing;

    if not exists (select 1 from public.profiles where user_id = v_user_id and referral_code is not null) then
      update public.profiles
      set referral_code = coalesce(referral_code, v_ref_code),
          updated_at = now()
      where user_id = v_user_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'referral_code', coalesce(v_ref_code, (select referral_code from public.affiliate_profiles where user_id = v_user_id)));
end;
$$;

-- Admin role check helper
create or replace function public.get_admin_role(user_uuid uuid default auth.uid())
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.user_roles ur
      where ur.user_id = user_uuid and ur.role = 'super_admin'::public.app_role
    ) then 'super_admin'
    when exists (
      select 1 from public.user_roles ur
      where ur.user_id = user_uuid and ur.role = 'admin'::public.app_role
    ) then 'admin'
    when exists (
      select 1 from public.user_roles ur
      where ur.user_id = user_uuid and ur.role = 'support'::public.app_role
    ) then 'support'
    else null
  end;
$$;

-- Signup initializer (idempotent + optional referral)
create or replace function public.initialize_user_account(p_referred_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
  v_display_name text := nullif(
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name',
      auth.jwt() ->> 'email'
    ),
    ''
  );
  v_workspace_id uuid;
  v_referral_code text;
  v_affiliate_owner uuid;
  v_referred_by text := nullif(trim(p_referred_by), '');
  v_is_new boolean := false;
  v_period_key date := (now() at time zone 'utc')::date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('initialize_user_account:' || v_user_id::text));

  select referral_code into v_referral_code
  from public.profiles
  where user_id = v_user_id;

  if v_referral_code is null then
    v_referral_code := public.generate_referral_code();
    v_is_new := true;
  end if;

  insert into public.profiles (
    user_id,
    email,
    display_name,
    full_name,
    referral_code,
    referred_by_code,
    subscription_tier,
    current_plan
  )
  values (
    v_user_id,
    v_email,
    v_display_name,
    v_display_name,
    v_referral_code,
    case when upper(coalesce(v_referred_by, '')) = upper(coalesce(v_referral_code, '')) then null else v_referred_by end,
    'free',
    'free'
  )
  on conflict (user_id) do update
  set
    email = coalesce(public.profiles.email, excluded.email),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at = now();

  insert into public.user_roles (user_id, role)
  values (v_user_id, 'user'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  insert into public.workspaces (owner_user_id, name, slug)
  values (
    v_user_id,
    coalesce(v_display_name, 'RobinOS') || '''s Workspace',
    lower('ws_' || substring(md5(v_user_id::text) from 1 for 10))
  )
  on conflict (slug) do nothing;

  select id into v_workspace_id
  from public.workspaces
  where owner_user_id = v_user_id
  order by created_at asc
  limit 1;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.onboarding_states (user_id, workspace_id, is_completed, current_step, welcome_seen)
  values (v_user_id, v_workspace_id, false, 0, false)
  on conflict (user_id) do update
  set workspace_id = excluded.workspace_id,
      updated_at = now();

  perform public.ensure_affiliate_profile();

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values
    (v_user_id, 'scripts', v_period_key, 0),
    (v_user_id, 'ai_requests', v_period_key, 0),
    (v_user_id, 'voice_generations', v_period_key, 0),
    (v_user_id, 'exports', v_period_key, 0),
    (v_user_id, 'automation_runs', v_period_key, 0)
  on conflict (user_id, feature_name, period_key) do nothing;

  if v_referred_by is not null then
    select ap.user_id into v_affiliate_owner
    from public.affiliate_profiles ap
    where upper(ap.referral_code) = upper(v_referred_by)
      and ap.user_id <> v_user_id
    limit 1;

    if v_affiliate_owner is not null then
      insert into public.affiliate_referrals (affiliate_user_id, referred_user_id, referral_code)
      values (v_affiliate_owner, v_user_id, upper(v_referred_by))
      on conflict (referred_user_id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_new_user', v_is_new,
    'workspace_id', v_workspace_id,
    'referral_code', v_referral_code,
    'referred_by', v_referred_by,
    'has_referrer', (v_affiliate_owner is not null)
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', sqlstate
    );
end;
$$;

-- Function permissions
revoke all on function public.generate_referral_code() from public;
revoke all on function public.ensure_affiliate_profile() from public;
revoke all on function public.get_admin_role(uuid) from public;
revoke all on function public.initialize_user_account(text) from public;

grant execute on function public.ensure_affiliate_profile() to authenticated;
grant execute on function public.get_admin_role(uuid) to authenticated;
grant execute on function public.initialize_user_account(text) to authenticated;