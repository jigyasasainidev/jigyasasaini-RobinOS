do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text,
  display_name text,
  full_name text,
  avatar_url text,
  referral_code text unique,
  referred_by_code text,
  subscription_tier text not null default 'free',
  current_plan text not null default 'free',
  free_trial_started_at timestamptz not null default now(),
  free_trial_expired boolean not null default false,
  free_scans_used integer not null default 0,
  free_scripts_used integer not null default 0,
  scripts_used_this_month integer not null default 0,
  scripts_reset_at timestamptz not null default now(),
  subscription_expires_at timestamptz,
  affiliate_balance numeric(12,2) not null default 0,
  total_earnings numeric(12,2) not null default 0,
  upi_id text,
  openai_api_key text,
  elevenlabs_api_key text,
  country text,
  currency text default 'USD',
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.onboarding_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  workspace_id uuid references public.workspaces(id) on delete set null,
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
  referral_link text,
  payout_method text,
  payout_details text,
  payout_verified boolean not null default false,
  payout_updated_at timestamptz,
  total_clicks integer not null default 0,
  total_conversions integer not null default 0,
  total_earned numeric(12,2) not null default 0,
  pending_balance numeric(12,2) not null default 0,
  paid_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  total_earned numeric(12,2) not null default 0,
  pending_balance numeric(12,2) not null default 0,
  available_balance numeric(12,2) not null default 0,
  locked_balance numeric(12,2) not null default 0,
  paid_out numeric(12,2) not null default 0,
  total_withdrawn numeric(12,2) not null default 0,
  is_active boolean not null default true,
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
  unique (user_id, feature_name, period_key)
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  provider text not null default 'internal',
  provider_customer_id text,
  provider_subscription_id text,
  plan text not null default 'free',
  billing_cycle text not null default 'monthly',
  status text not null default 'active',
  amount numeric(12,2) not null default 0,
  currency text not null default 'USD',
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  creator_price numeric(12,2) not null default 29,
  pro_price numeric(12,2) not null default 79,
  agency_price numeric(12,2) not null default 199,
  free_scripts_limit integer not null default 2,
  free_scans_limit integer not null default 1,
  affiliate_commission_percent numeric(5,2) not null default 30,
  minimum_withdrawal numeric(12,2) not null default 25,
  payout_delay_days integer not null default 7,
  maintenance_mode boolean not null default false,
  announcement_banner text,
  support_email text,
  platform_domain text default 'https://tryrobin.xyz',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric(12,2) not null,
  fee_amount numeric(12,2) not null default 0,
  status text not null default 'pending',
  payout_method text not null,
  payout_details text not null,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz
);

insert into public.platform_settings (id)
select gen_random_uuid()
where not exists (select 1 from public.platform_settings);

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

drop trigger if exists trg_profiles_touch_updated_at on public.profiles;
create trigger trg_profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_workspaces_touch_updated_at on public.workspaces;
create trigger trg_workspaces_touch_updated_at before update on public.workspaces for each row execute function public.touch_updated_at();
drop trigger if exists trg_onboarding_states_touch_updated_at on public.onboarding_states;
create trigger trg_onboarding_states_touch_updated_at before update on public.onboarding_states for each row execute function public.touch_updated_at();
drop trigger if exists trg_affiliate_profiles_touch_updated_at on public.affiliate_profiles;
create trigger trg_affiliate_profiles_touch_updated_at before update on public.affiliate_profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_affiliate_wallets_touch_updated_at on public.affiliate_wallets;
create trigger trg_affiliate_wallets_touch_updated_at before update on public.affiliate_wallets for each row execute function public.touch_updated_at();
drop trigger if exists trg_usage_counters_touch_updated_at on public.usage_counters;
create trigger trg_usage_counters_touch_updated_at before update on public.usage_counters for each row execute function public.touch_updated_at();
drop trigger if exists trg_user_subscriptions_touch_updated_at on public.user_subscriptions;
create trigger trg_user_subscriptions_touch_updated_at before update on public.user_subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists trg_withdrawal_requests_touch_updated_at on public.withdrawal_requests;
create trigger trg_withdrawal_requests_touch_updated_at before update on public.withdrawal_requests for each row execute function public.touch_updated_at();

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

alter table public.user_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.onboarding_states enable row level security;
alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_wallets enable row level security;
alter table public.usage_counters enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.platform_settings enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "Users can view their own roles" on public.user_roles;
create policy "Users can view their own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Admins can manage all roles" on public.user_roles;
create policy "Admins can manage all roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own workspaces" on public.workspaces;
create policy "Users read own workspaces" on public.workspaces for select to authenticated using (auth.uid() = owner_user_id);
drop policy if exists "Users manage own workspaces" on public.workspaces;
create policy "Users manage own workspaces" on public.workspaces for all to authenticated using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop policy if exists "Users read own memberships" on public.workspace_memberships;
create policy "Users read own memberships" on public.workspace_memberships for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own memberships" on public.workspace_memberships;
create policy "Users insert own memberships" on public.workspace_memberships for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users read own onboarding state" on public.onboarding_states;
create policy "Users read own onboarding state" on public.onboarding_states for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users manage own onboarding state" on public.onboarding_states;
create policy "Users manage own onboarding state" on public.onboarding_states for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own affiliate profile" on public.affiliate_profiles;
create policy "Users read own affiliate profile" on public.affiliate_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users manage own affiliate profile" on public.affiliate_profiles;
create policy "Users manage own affiliate profile" on public.affiliate_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own affiliate wallet" on public.affiliate_wallets;
create policy "Users read own affiliate wallet" on public.affiliate_wallets for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users read own usage counters" on public.usage_counters;
create policy "Users read own usage counters" on public.usage_counters for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users manage own usage counters" on public.usage_counters;
create policy "Users manage own usage counters" on public.usage_counters for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own subscriptions" on public.user_subscriptions;
create policy "Users read own subscriptions" on public.user_subscriptions for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users manage own subscriptions" on public.user_subscriptions;
create policy "Users manage own subscriptions" on public.user_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Authenticated users can read platform settings" on public.platform_settings;
create policy "Authenticated users can read platform settings" on public.platform_settings for select to authenticated using (true);

drop policy if exists "Users read own withdrawals" on public.withdrawal_requests;
create policy "Users read own withdrawals" on public.withdrawal_requests for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own withdrawals" on public.withdrawal_requests;
create policy "Users insert own withdrawals" on public.withdrawal_requests for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Admins read all withdrawals" on public.withdrawal_requests;
create policy "Admins read all withdrawals" on public.withdrawal_requests for select to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Admins update withdrawals" on public.withdrawal_requests;
create policy "Admins update withdrawals" on public.withdrawal_requests for update to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace function public.generate_referral_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := 'ROBIN' || upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
    exit when not exists (
      select 1 from public.profiles where referral_code = v_code
    ) and not exists (
      select 1 from public.affiliate_profiles where referral_code = v_code
    );
  end loop;
  return v_code;
end;
$$;

create or replace function public.ensure_affiliate_profile()
returns public.affiliate_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_domain text;
  v_code text;
  v_profile public.affiliate_profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id;
  if found then
    return v_profile;
  end if;

  v_code := public.generate_referral_code();
  select coalesce(nullif(platform_domain, ''), 'https://tryrobin.xyz') into v_domain
  from public.platform_settings order by updated_at desc limit 1;

  insert into public.affiliate_profiles (user_id, referral_code, referral_link)
  values (v_user_id, v_code, rtrim(v_domain, '/') || '/?ref=' || v_code)
  returning * into v_profile;

  insert into public.affiliate_wallets (user_id) values (v_user_id)
  on conflict (user_id) do nothing;

  return v_profile;
end;
$$;

create or replace function public.get_affiliate_dashboard()
returns table (
  profile_id uuid,
  user_id uuid,
  referral_code text,
  referral_link text,
  payout_method text,
  payout_details text,
  payout_verified boolean,
  payout_updated_at timestamptz,
  total_referrals integer,
  converted_referrals integer,
  referral_clicks integer,
  conversion_count integer,
  total_earned numeric,
  pending_earnings numeric,
  paid_out numeric,
  available_balance numeric,
  locked_balance numeric
)
language sql
security invoker
set search_path = public
as $$
  select
    ap.id,
    ap.user_id,
    ap.referral_code,
    ap.referral_link,
    ap.payout_method,
    ap.payout_details,
    ap.payout_verified,
    ap.payout_updated_at,
    ap.total_clicks,
    ap.total_conversions,
    ap.total_clicks,
    ap.total_conversions,
    aw.total_earned,
    aw.pending_balance,
    aw.paid_out,
    aw.available_balance,
    aw.locked_balance
  from public.affiliate_profiles ap
  left join public.affiliate_wallets aw on aw.user_id = ap.user_id
  where ap.user_id = auth.uid();
$$;

create or replace function public.save_payout_method(p_method text, p_details text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.affiliate_profiles
  set payout_method = p_method,
      payout_details = p_details,
      payout_verified = false,
      payout_updated_at = now(),
      updated_at = now()
  where user_id = v_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.submit_withdrawal_request(p_amount numeric)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_wallet public.affiliate_wallets%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id;
  if not found or v_profile.payout_method is null or coalesce(v_profile.payout_details, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'payout_not_configured');
  end if;

  select * into v_wallet from public.affiliate_wallets where user_id = v_user_id;
  if not found or coalesce(v_wallet.available_balance, 0) < p_amount then
    return jsonb_build_object('ok', false, 'error', 'insufficient_balance');
  end if;

  insert into public.withdrawal_requests (user_id, amount, fee_amount, status, payout_method, payout_details)
  values (v_user_id, p_amount, 0, 'pending', v_profile.payout_method, v_profile.payout_details);

  update public.affiliate_wallets
  set available_balance = available_balance - p_amount,
      locked_balance = locked_balance + p_amount,
      updated_at = now()
  where user_id = v_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.initialize_user_account(p_referred_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_display_name text;
  v_referral_code text;
  v_workspace_id uuid;
  v_is_new boolean := false;
  v_period_key date := (now() at time zone 'utc')::date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select email,
         coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1))
  into v_email, v_display_name
  from auth.users
  where id = v_user_id;

  select referral_code into v_referral_code from public.profiles where user_id = v_user_id;

  if v_referral_code is null then
    v_referral_code := public.generate_referral_code();
    v_is_new := true;
  end if;

  insert into public.profiles (
    user_id, email, display_name, full_name, referral_code, referred_by_code, subscription_tier, current_plan
  )
  values (
    v_user_id,
    v_email,
    v_display_name,
    v_display_name,
    v_referral_code,
    nullif(p_referred_by, ''),
    'free',
    'free'
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at = now();

  insert into public.workspaces (owner_user_id, name, slug)
  values (
    v_user_id,
    coalesce(v_display_name, 'RobinOS') || '''s Workspace',
    lower('ws_' || substring(md5(v_user_id::text) from 1 for 10))
  )
  on conflict (slug) do nothing;

  select id into v_workspace_id from public.workspaces where owner_user_id = v_user_id order by created_at asc limit 1;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.onboarding_states (user_id, workspace_id, is_completed, current_step, welcome_seen)
  values (v_user_id, v_workspace_id, false, 0, false)
  on conflict (user_id) do update set workspace_id = excluded.workspace_id;

  perform public.ensure_affiliate_profile();

  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values
    (v_user_id, 'scripts', v_period_key, 0),
    (v_user_id, 'ai_requests', v_period_key, 0),
    (v_user_id, 'voice_generations', v_period_key, 0),
    (v_user_id, 'exports', v_period_key, 0),
    (v_user_id, 'automation_runs', v_period_key, 0)
  on conflict (user_id, feature_name, period_key) do nothing;

  return jsonb_build_object('ok', true, 'is_new_user', v_is_new, 'workspace_id', v_workspace_id, 'referral_code', v_referral_code);
end;
$$;

create or replace function public.get_usage_status(p_feature_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_period_key date := (now() at time zone 'utc')::date;
  v_used integer := 0;
  v_limit integer := 0;
  v_tier text := 'free';
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(subscription_tier, 'free') into v_tier from public.profiles where user_id = v_user_id;

  if v_tier = 'free' then
    if p_feature_name = 'scripts' then v_limit := 2;
    elsif p_feature_name = 'ai_requests' then v_limit := 50;
    elsif p_feature_name = 'voice_generations' then v_limit := 2;
    elsif p_feature_name = 'exports' then v_limit := 2;
    else v_limit := 1; end if;
  elsif v_tier = 'creator' then v_limit := 20;
  elsif v_tier = 'pro_creator' then v_limit := 100;
  else v_limit := 999999; end if;

  select coalesce(used_count, 0) into v_used
  from public.usage_counters
  where user_id = v_user_id and feature_name = p_feature_name and period_key = v_period_key;

  return jsonb_build_object(
    'feature_name', p_feature_name,
    'tier', v_tier,
    'period_key', v_period_key,
    'limit', v_limit,
    'used', coalesce(v_used, 0),
    'remaining', greatest(v_limit - coalesce(v_used, 0), 0),
    'allowed', (coalesce(v_used, 0) < v_limit)
  );
end;
$$;

create or replace function public.consume_feature_quota(p_feature_name text, p_increment integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_period_key date := (now() at time zone 'utc')::date;
  v_status jsonb;
  v_limit integer;
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_status := public.get_usage_status(p_feature_name);
  v_limit := (v_status ->> 'limit')::integer;
  v_used := (v_status ->> 'used')::integer;

  if (v_used + p_increment) > v_limit then
    return jsonb_build_object('ok', false, 'error', 'quota_exceeded', 'status', v_status);
  end if;

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values (v_user_id, p_feature_name, v_period_key, p_increment)
  on conflict (user_id, feature_name, period_key)
  do update set used_count = public.usage_counters.used_count + excluded.used_count, updated_at = now();

  return jsonb_build_object('ok', true, 'status', public.get_usage_status(p_feature_name));
end;
$$;

create or replace function public.get_live_business_controls()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'maintenance_mode', ps.maintenance_mode,
    'announcement_banner', ps.announcement_banner,
    'support_email', ps.support_email,
    'platform_domain', ps.platform_domain
  )
  from public.platform_settings ps
  order by ps.updated_at desc
  limit 1;
$$;

grant execute on function public.ensure_affiliate_profile() to authenticated;
grant execute on function public.initialize_user_account(text) to authenticated;
grant execute on function public.get_usage_status(text) to authenticated;
grant execute on function public.consume_feature_quota(text, integer) to authenticated;
grant execute on function public.get_affiliate_dashboard() to authenticated;
grant execute on function public.save_payout_method(text, text) to authenticated;
grant execute on function public.submit_withdrawal_request(numeric) to authenticated;
grant execute on function public.get_live_business_controls() to authenticated;