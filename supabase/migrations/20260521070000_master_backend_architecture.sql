-- RobinOS Master Backend Architecture (Consolidated)
-- Generated as a single production-ready SQL blueprint
do $$ begin
  create type public.app_role as enum ('super_admin','admin','support','user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

/* ============================================================
1) EXTENSIONS
============================================================ */
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

/* ============================================================
2) ENUMS
============================================================ */
do $$ begin
  create type public.app_role as enum ('super_admin','admin','support','user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plan_tier as enum ('free','creator','pro_creator','agency','scale_agency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_plan_status as enum ('active','trialing','past_due','canceled','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payout_method_type as enum ('paypal','usdt_trc20');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.withdrawal_status as enum ('pending','reviewing','approved','paid','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.earning_status as enum ('pending','available','paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_provider as enum ('creem','stripe','lemonsqueezy','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending','succeeded','failed','refunded','canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.billing_cycle as enum ('monthly','yearly','one_time');
exception when duplicate_object then null; end $$;

/* ============================================================
3) UTILITY FUNCTIONS
============================================================ */
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

create or replace function public.touch_caption_generations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
      select 1 from public.affiliate_profiles ap where upper(ap.referral_code) = v_code
      union all
      select 1 from public.profiles p where upper(coalesce(p.referral_code, '')) = v_code
    );
  end loop;

  return v_code;
end;
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role = _role
  );
$$;

create or replace function public.get_admin_role(user_uuid uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_role text;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_allowlisted boolean := false;
begin
  if auth.uid() is null then
    return null;
  end if;

  if user_uuid is distinct from auth.uid() then
    return null;
  end if;

  select ur.role::text
  into v_role
  from public.user_roles ur
  where ur.user_id = user_uuid
  order by case ur.role
    when 'super_admin' then 4
    when 'admin' then 3
    when 'support' then 2
    when 'user' then 1
    else 0
  end desc
  limit 1;

  if v_role is not null and v_role <> 'user' then
    return v_role;
  end if;

  select exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = v_email
      and a.is_active = true
  )
  into v_allowlisted;

  if v_allowlisted then
    return 'admin';
  end if;

  return null;
end;
$$;

create or replace function public.get_admin_access()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role text := null;
  v_allowlisted boolean := false;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('role', null, 'allowlisted', false, 'is_admin', false);
  end if;

  v_role := public.get_admin_role(v_user_id);

  select exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = v_email
      and a.is_active = true
  ) into v_allowlisted;

  v_is_admin := v_role is not null;

  return jsonb_build_object('role', v_role, 'allowlisted', v_allowlisted, 'is_admin', v_is_admin);
end;
$$;

/* ============================================================
4) CORE TABLES
============================================================ */
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text,
  display_name text,
  full_name text,
  avatar_url text,
  username text,
  country text not null default 'Global',
  currency text not null default 'USD',
  subscription_tier text not null default 'free',
  current_plan text not null default 'free',
  onboarding_completed boolean not null default false,
  affiliate_enabled boolean not null default true,
  referral_code text,
  referred_by_code text,
  credits_remaining integer not null default 0,
  free_trial_started_at timestamptz not null default now(),
  free_trial_expired boolean not null default false,
  subscription_expires_at timestamptz,
  scripts_used_this_month integer not null default 0,
  scripts_reset_at timestamptz not null default now(),
  free_scans_used integer not null default 0,
  free_scripts_used integer not null default 0,
  trending_scans_used integer not null default 0,
  trending_scans_reset_at timestamptz not null default now(),
  hashtag_scans_used integer not null default 0,
  hashtag_scans_reset_at timestamptz not null default now(),
  affiliate_balance numeric not null default 0,
  total_earnings numeric not null default 0,
  pending_balance numeric not null default 0,
  paid_balance numeric not null default 0,
  upi_id text,
  openai_api_key text,
  elevenlabs_api_key text,
  video_api_key text,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists public.admin_allowlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  creator_price numeric not null default 19,
  pro_price numeric not null default 39,
  agency_price numeric not null default 99,
  free_scripts_limit integer not null default 3,
  free_scans_limit integer not null default 20,
  affiliate_commission_percent numeric not null default 30,
  minimum_withdrawal numeric not null default 25,
  payout_delay_days integer not null default 7,
  maintenance_mode boolean not null default false,
  announcement_banner text,
  platform_domain text,
  support_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null unique,
  flag_value boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan text not null default 'creator',
  status text not null default 'active',
  amount numeric not null default 0,
  currency text not null default 'USD',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  billing_cycle text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  subscription_id uuid,
  event_type text not null,
  provider text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  subscription_id uuid,
  provider public.payment_provider not null default 'manual',
  provider_payment_id text,
  amount numeric not null default 0,
  currency text not null default 'USD',
  status public.payment_status not null default 'pending',
  billing_cycle public.billing_cycle not null default 'monthly',
  refunded_amount numeric not null default 0,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  payment_id uuid,
  invoice_number text not null unique,
  amount numeric not null default 0,
  currency text not null default 'USD',
  status text not null default 'issued',
  pdf_url text,
  due_at timestamptz,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid,
  provider public.payment_provider not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_profiles (
  user_id uuid primary key,
  referral_code text not null unique,
  total_clicks integer not null default 0,
  total_conversions integer not null default 0,
  total_earned numeric not null default 0,
  pending_balance numeric not null default 0,
  paid_balance numeric not null default 0,
  payout_method text,
  payout_details text,
  payout_verified boolean not null default false,
  payout_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  click_key text,
  landing_page text,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referred_user_id uuid not null,
  subscription_id uuid,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (affiliate_user_id, referred_user_id, subscription_id)
);

create table if not exists public.affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referral_user_id uuid,
  source_type text not null default 'subscription',
  source_id text,
  amount numeric not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referred_user_id uuid,
  subscription_id uuid,
  amount numeric not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliate_user_id, referred_user_id, subscription_id)
);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referral_code text not null,
  referred_user_id uuid,
  click_key text,
  converted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_wallets (
  user_id uuid primary key,
  available_balance numeric not null default 0,
  pending_balance numeric not null default 0,
  lifetime_earnings numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entry_type text not null,
  amount numeric not null default 0,
  reference_type text,
  reference_id text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric not null default 0,
  fee_amount numeric not null default 0,
  payout_method text not null default 'paypal',
  payout_details text not null default '',
  status text not null default 'pending',
  admin_note text,
  payout_proof_url text,
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payout_history (
  id uuid primary key default gen_random_uuid(),
  withdrawal_request_id uuid,
  user_id uuid not null,
  payout_method text not null,
  payout_details text not null,
  amount numeric not null default 0,
  processed_by uuid,
  processed_at timestamptz not null default now(),
  tx_reference text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  generation_type text not null default 'script',
  model text,
  provider text,
  credits_used integer not null default 0,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  status text not null default 'succeeded',
  created_at timestamptz not null default now()
);

create table if not exists public.script_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id text not null,
  prompt text not null,
  tone text not null default 'Casual',
  content_length text not null default '60s Reel',
  generated_output text not null default '',
  generation_status text not null default 'succeeded',
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists public.caption_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id text not null,
  platform text not null,
  generation_style text not null,
  prompt text not null,
  generated_caption text not null,
  generated_hashtags text[] not null default '{}'::text[],
  generated_keywords text[] not null default '{}'::text[],
  is_saved boolean not null default false,
  generation_status text not null default 'succeeded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists public.script_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  tone text not null default 'Casual',
  length text not null default '60s Reel',
  output text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  niche text not null,
  topics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  period_key text not null,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature_name, period_key)
);

create table if not exists public.feature_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  increment_by integer not null default 1,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, feature_name, idempotency_key)
);

create table if not exists public.feature_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  usage_count integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  action_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  target_user_id uuid not null,
  action_type text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.signup_ips (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.onboarding_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  step_key text not null default 'account_created',
  completed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ============================================================
5) RELATIONSHIPS
============================================================ */
alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_user_id_fkey,
  add constraint user_subscriptions_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.subscription_events
  drop constraint if exists subscription_events_user_id_fkey,
  add constraint subscription_events_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade,
  drop constraint if exists subscription_events_subscription_id_fkey,
  add constraint subscription_events_subscription_id_fkey
    foreign key (subscription_id) references public.user_subscriptions(id) on delete set null;

alter table public.payments
  drop constraint if exists payments_user_id_fkey,
  add constraint payments_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade,
  drop constraint if exists payments_subscription_id_fkey,
  add constraint payments_subscription_id_fkey
    foreign key (subscription_id) references public.user_subscriptions(id) on delete set null;

alter table public.invoices
  drop constraint if exists invoices_user_id_fkey,
  add constraint invoices_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade,
  drop constraint if exists invoices_payment_id_fkey,
  add constraint invoices_payment_id_fkey
    foreign key (payment_id) references public.payments(id) on delete set null;

alter table public.payment_events
  drop constraint if exists payment_events_payment_id_fkey,
  add constraint payment_events_payment_id_fkey
    foreign key (payment_id) references public.payments(id) on delete cascade;

alter table public.affiliate_profiles
  drop constraint if exists affiliate_profiles_user_id_fkey,
  add constraint affiliate_profiles_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.affiliate_clicks
  drop constraint if exists affiliate_clicks_affiliate_user_id_fkey,
  add constraint affiliate_clicks_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.affiliate_conversions
  drop constraint if exists affiliate_conversions_affiliate_user_id_fkey,
  add constraint affiliate_conversions_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliate_profiles(user_id) on delete cascade,
  drop constraint if exists affiliate_conversions_referred_user_id_fkey,
  add constraint affiliate_conversions_referred_user_id_fkey
    foreign key (referred_user_id) references public.profiles(user_id) on delete cascade,
  drop constraint if exists affiliate_conversions_subscription_id_fkey,
  add constraint affiliate_conversions_subscription_id_fkey
    foreign key (subscription_id) references public.user_subscriptions(id) on delete set null;

alter table public.affiliate_earnings
  drop constraint if exists affiliate_earnings_affiliate_user_id_fkey,
  add constraint affiliate_earnings_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_affiliate_user_id_fkey,
  add constraint affiliate_commissions_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliate_profiles(user_id) on delete cascade,
  drop constraint if exists affiliate_commissions_referred_user_id_fkey,
  add constraint affiliate_commissions_referred_user_id_fkey
    foreign key (referred_user_id) references public.profiles(user_id) on delete set null,
  drop constraint if exists affiliate_commissions_subscription_id_fkey,
  add constraint affiliate_commissions_subscription_id_fkey
    foreign key (subscription_id) references public.user_subscriptions(id) on delete set null;

alter table public.affiliate_referrals
  drop constraint if exists affiliate_referrals_affiliate_user_id_fkey,
  add constraint affiliate_referrals_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliate_profiles(user_id) on delete cascade,
  drop constraint if exists affiliate_referrals_referred_user_id_fkey,
  add constraint affiliate_referrals_referred_user_id_fkey
    foreign key (referred_user_id) references public.profiles(user_id) on delete set null;

alter table public.affiliate_wallets
  drop constraint if exists affiliate_wallets_user_id_fkey,
  add constraint affiliate_wallets_user_id_fkey
    foreign key (user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.affiliate_wallet_ledger
  drop constraint if exists affiliate_wallet_ledger_user_id_fkey,
  add constraint affiliate_wallet_ledger_user_id_fkey
    foreign key (user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_user_id_fkey,
  add constraint withdrawal_requests_user_id_fkey
    foreign key (user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.payout_history
  drop constraint if exists payout_history_withdrawal_request_id_fkey,
  add constraint payout_history_withdrawal_request_id_fkey
    foreign key (withdrawal_request_id) references public.withdrawal_requests(id) on delete set null,
  drop constraint if exists payout_history_user_id_fkey,
  add constraint payout_history_user_id_fkey
    foreign key (user_id) references public.affiliate_profiles(user_id) on delete cascade;

alter table public.ai_generations
  drop constraint if exists ai_generations_user_id_fkey,
  add constraint ai_generations_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.script_generations
  drop constraint if exists script_generations_user_id_fkey,
  add constraint script_generations_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.caption_generations
  drop constraint if exists caption_generations_user_id_fkey,
  add constraint caption_generations_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.script_history
  drop constraint if exists script_history_user_id_fkey,
  add constraint script_history_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.scan_history
  drop constraint if exists scan_history_user_id_fkey,
  add constraint scan_history_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.usage_counters
  drop constraint if exists usage_counters_user_id_fkey,
  add constraint usage_counters_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.feature_usage_events
  drop constraint if exists feature_usage_events_user_id_fkey,
  add constraint feature_usage_events_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.feature_usage
  drop constraint if exists feature_usage_user_id_fkey,
  add constraint feature_usage_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.onboarding_states
  drop constraint if exists onboarding_states_user_id_fkey,
  add constraint onboarding_states_user_id_fkey
    foreign key (user_id) references public.profiles(user_id) on delete cascade;

/* ============================================================
6) TRIGGERS
============================================================ */
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_admin_allowlist_updated_at on public.admin_allowlist;
create trigger trg_admin_allowlist_updated_at
before update on public.admin_allowlist
for each row execute function public.set_updated_at();

drop trigger if exists trg_platform_settings_updated_at on public.platform_settings;
create trigger trg_platform_settings_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_feature_flags_updated_at on public.feature_flags;
create trigger trg_feature_flags_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_subscriptions_updated_at on public.user_subscriptions;
create trigger trg_user_subscriptions_updated_at
before update on public.user_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_affiliate_profiles_updated_at on public.affiliate_profiles;
create trigger trg_affiliate_profiles_updated_at
before update on public.affiliate_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_affiliate_earnings_updated_at on public.affiliate_earnings;
create trigger trg_affiliate_earnings_updated_at
before update on public.affiliate_earnings
for each row execute function public.set_updated_at();

drop trigger if exists trg_affiliate_commissions_updated_at on public.affiliate_commissions;
create trigger trg_affiliate_commissions_updated_at
before update on public.affiliate_commissions
for each row execute function public.set_updated_at();

drop trigger if exists trg_affiliate_wallets_updated_at on public.affiliate_wallets;
create trigger trg_affiliate_wallets_updated_at
before update on public.affiliate_wallets
for each row execute function public.set_updated_at();

drop trigger if exists trg_withdrawal_requests_updated_at on public.withdrawal_requests;
create trigger trg_withdrawal_requests_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_caption_generations_updated_at on public.caption_generations;
create trigger trg_caption_generations_updated_at
before update on public.caption_generations
for each row execute function public.touch_caption_generations_updated_at();

drop trigger if exists trg_usage_counters_updated_at on public.usage_counters;
create trigger trg_usage_counters_updated_at
before update on public.usage_counters
for each row execute function public.set_updated_at();

drop trigger if exists trg_onboarding_states_updated_at on public.onboarding_states;
create trigger trg_onboarding_states_updated_at
before update on public.onboarding_states
for each row execute function public.set_updated_at();

/* ============================================================
7) BUSINESS LOGIC FUNCTIONS
============================================================ */
create or replace function public.ensure_affiliate_profile()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ref_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select referral_code
  into v_ref_code
  from public.affiliate_profiles
  where user_id = v_user_id;

  if v_ref_code is null then
    select coalesce(referral_code, public.generate_referral_code())
    into v_ref_code
    from public.profiles
    where user_id = v_user_id;

    if v_ref_code is null then
      v_ref_code := public.generate_referral_code();
    end if;

    insert into public.affiliate_profiles (user_id, referral_code)
    values (v_user_id, upper(v_ref_code))
    on conflict (user_id) do update
      set referral_code = coalesce(public.affiliate_profiles.referral_code, excluded.referral_code),
          updated_at = now();

    insert into public.affiliate_wallets (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;

    update public.profiles
    set referral_code = coalesce(referral_code, upper(v_ref_code)),
        updated_at = now()
    where user_id = v_user_id;
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_user_id, 'referral_code', upper(v_ref_code));
end;
$$;

create or replace function public.initialize_user_account(p_referred_by text default null)
returns jsonb
language plpgsql
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
  v_referral_code text;
  v_existing_referral_code text;
  v_existing_referred_by text;
  v_clean_referred_by text := nullif(upper(trim(coalesce(p_referred_by, ''))), '');
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized', 'code', 'AUTH_REQUIRED');
  end if;

  select referral_code, referred_by_code
  into v_existing_referral_code, v_existing_referred_by
  from public.profiles
  where user_id = v_user_id;

  v_referral_code := coalesce(v_existing_referral_code, public.generate_referral_code());

  if v_clean_referred_by = upper(v_referral_code) then
    v_clean_referred_by := null;
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
    upper(v_referral_code),
    v_clean_referred_by,
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

  perform public.ensure_affiliate_profile();

  if v_existing_referred_by is null and v_clean_referred_by is not null then
    update public.affiliate_profiles ap
    set total_clicks = coalesce(ap.total_clicks, 0) + 1,
        updated_at = now()
    where upper(ap.referral_code) = v_clean_referred_by
      and ap.user_id <> v_user_id;
  end if;

  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  insert into public.onboarding_states (user_id, step_key, completed)
  values (v_user_id, 'account_created', false)
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', sqlstate);
end;
$$;

create or replace function public.initialize_user_account()
returns jsonb
language sql
set search_path = public
as $$
  select public.initialize_user_account(null);
$$;

create or replace function public.get_usage_status(p_feature_name text default 'scripts')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text := 'free';
  v_used integer := 0;
  v_quota integer := 0;
  v_remaining integer := 0;
  v_allowed boolean := true;
  v_near_limit boolean := false;
  v_fair_usage boolean := false;
  v_byok_enabled boolean := false;
  v_feature text := coalesce(nullif(trim(lower(p_feature_name)), ''), 'scripts');
  v_free_scripts_limit integer := 3;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'used', 0,
      'quota', 0,
      'remaining', 0,
      'allowed', false,
      'near_limit', false,
      'fair_usage', false,
      'byok_enabled', false,
      'message', 'Authentication required'
    );
  end if;

  select coalesce(subscription_tier, 'free'), coalesce(scripts_used_this_month, 0)
  into v_tier, v_used
  from public.profiles
  where user_id = v_user_id;

  select coalesce(ps.free_scripts_limit, 3)
  into v_free_scripts_limit
  from public.platform_settings ps
  order by ps.updated_at desc
  limit 1;

  if v_tier in ('agency', 'scale_agency') then
    v_fair_usage := true;
    v_quota := 0;
    v_remaining := 0;
    v_allowed := true;
  else
    if v_feature = 'captions' then
      v_quota := case v_tier
        when 'pro_creator' then 200
        when 'creator' then 50
        else 20
      end;
    else
      v_quota := case v_tier
        when 'pro_creator' then 100
        when 'creator' then 20
        else greatest(v_free_scripts_limit, 0)
      end;
    end if;

    v_remaining := greatest(v_quota - v_used, 0);
    v_allowed := v_remaining > 0;
    v_near_limit := v_quota > 0 and v_used >= ceil(v_quota * 0.8);
  end if;

  v_byok_enabled := v_tier in ('pro_creator', 'agency', 'scale_agency');

  return jsonb_build_object(
    'used', v_used,
    'quota', case when v_fair_usage then null else v_quota end,
    'remaining', case when v_fair_usage then 999999 else v_remaining end,
    'allowed', v_allowed,
    'near_limit', v_near_limit,
    'fair_usage', v_fair_usage,
    'byok_enabled', v_byok_enabled,
    'message', case
      when v_fair_usage then 'Unlimited (fair usage)'
      when v_allowed then 'Usage available'
      else 'Limit reached'
    end
  );
end;
$$;

create or replace function public.consume_feature_quota(
  p_feature_name text,
  p_increment integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status_before jsonb;
  v_status_after jsonb;
  v_existing_event uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  if coalesce(p_increment, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'Invalid increment');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing_event
    from public.feature_usage_events
    where user_id = v_user_id
      and feature_name = p_feature_name
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_event is not null then
      return jsonb_build_object('ok', true, 'idempotent', true, 'status', public.get_usage_status(p_feature_name));
    end if;
  end if;

  v_status_before := public.get_usage_status(p_feature_name);

  if coalesce((v_status_before->>'allowed')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'status', v_status_before);
  end if;

  update public.profiles
  set
    scripts_used_this_month = coalesce(scripts_used_this_month, 0) + p_increment,
    updated_at = now()
  where user_id = v_user_id;

  insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
  values (v_user_id, p_feature_name, p_increment, p_idempotency_key)
  on conflict (user_id, feature_name, idempotency_key) do nothing;

  v_status_after := public.get_usage_status(p_feature_name);

  return jsonb_build_object('ok', true, 'status', v_status_after);
end;
$$;

create or replace function public.create_caption_generation_if_allowed(
  p_request_id text,
  p_platform text,
  p_generation_style text,
  p_prompt text,
  p_generated_caption text,
  p_generated_hashtags text[] default '{}'::text[],
  p_generated_keywords text[] default '{}'::text[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_consume_result jsonb;
  v_status jsonb;
  v_generation public.caption_generations;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  v_consume_result := public.consume_feature_quota('captions', 1, coalesce(nullif(trim(p_request_id), ''), gen_random_uuid()::text));

  if coalesce((v_consume_result->>'ok')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'status', coalesce(v_consume_result->'status', public.get_usage_status('captions')));
  end if;

  insert into public.caption_generations (
    user_id,
    request_id,
    platform,
    generation_style,
    prompt,
    generated_caption,
    generated_hashtags,
    generated_keywords,
    generation_status
  )
  values (
    v_user_id,
    coalesce(nullif(trim(p_request_id), ''), gen_random_uuid()::text),
    lower(trim(p_platform)),
    lower(trim(p_generation_style)),
    p_prompt,
    p_generated_caption,
    coalesce(p_generated_hashtags, '{}'),
    coalesce(p_generated_keywords, '{}'),
    'succeeded'
  )
  on conflict (user_id, request_id)
  do update set
    generated_caption = excluded.generated_caption,
    generated_hashtags = excluded.generated_hashtags,
    generated_keywords = excluded.generated_keywords,
    generation_status = 'succeeded',
    updated_at = now()
  returning * into v_generation;

  v_status := public.get_usage_status('captions');

  return jsonb_build_object('ok', true, 'generation', to_jsonb(v_generation), 'status', v_status);
end;
$$;

create or replace function public.save_payout_method(p_method text, p_details text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_method text := lower(trim(coalesce(p_method, '')));
  v_details text := trim(coalesce(p_details, ''));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_method not in ('paypal', 'usdt_trc20') then
    raise exception 'Invalid payout method';
  end if;

  if v_details = '' then
    raise exception 'Payout details required';
  end if;

  perform public.ensure_affiliate_profile();

  update public.affiliate_profiles
  set payout_method = v_method,
      payout_details = v_details,
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
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_minimum numeric := 25;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  select coalesce(minimum_withdrawal, 25)
  into v_minimum
  from public.platform_settings
  order by updated_at desc
  limit 1;

  if p_amount < v_minimum then
    raise exception 'Minimum withdrawal is %', v_minimum;
  end if;

  perform public.ensure_affiliate_profile();

  select * into v_profile
  from public.affiliate_profiles
  where user_id = v_user_id;

  if v_profile.payout_method is null or coalesce(v_profile.payout_details, '') = '' then
    raise exception 'Payout method not configured';
  end if;

  if exists (
    select 1
    from public.withdrawal_requests wr
    where wr.user_id = v_user_id
      and wr.status in ('pending', 'approved', 'reviewing')
  ) then
    raise exception 'You already have a pending withdrawal request';
  end if;

  if p_amount > coalesce(v_profile.pending_balance, 0) then
    raise exception 'Requested amount exceeds available balance';
  end if;

  insert into public.withdrawal_requests (
    user_id,
    amount,
    fee_amount,
    status,
    payout_method,
    payout_details
  )
  values (
    v_user_id,
    round(p_amount, 2),
    0,
    'pending',
    v_profile.payout_method,
    v_profile.payout_details
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_is_admin boolean := public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support');
  v_status text := lower(trim(coalesce(p_status, '')));
  v_req public.withdrawal_requests%rowtype;
begin
  if auth.uid() is null or not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  if v_status not in ('pending', 'reviewing', 'approved', 'paid', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'Invalid status');
  end if;

  select * into v_req
  from public.withdrawal_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Withdrawal request not found');
  end if;

  if v_req.status = 'paid' and v_status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'Paid withdrawal cannot be reverted');
  end if;

  if v_status = 'paid' and v_req.status <> 'paid' then
    update public.affiliate_profiles
    set pending_balance = greatest(coalesce(pending_balance, 0) - coalesce(v_req.amount, 0), 0),
        paid_balance = coalesce(paid_balance, 0) + coalesce(v_req.amount, 0),
        updated_at = now()
    where user_id = v_req.user_id;

    insert into public.payout_history (
      withdrawal_request_id,
      user_id,
      payout_method,
      payout_details,
      amount,
      processed_by
    )
    values (
      v_req.id,
      v_req.user_id,
      v_req.payout_method,
      v_req.payout_details,
      v_req.amount,
      auth.uid()
    );
  end if;

  update public.withdrawal_requests
  set
    status = v_status,
    admin_note = p_admin_note,
    updated_at = now(),
    approved_at = case when v_status = 'approved' then coalesce(approved_at, now()) else approved_at end,
    completed_at = case when v_status = 'paid' then coalesce(completed_at, now()) else completed_at end,
    rejected_at = case when v_status = 'rejected' then coalesce(rejected_at, now()) else rejected_at end
  where id = p_request_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_affiliate_dashboard()
returns table(
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
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_domain text;
begin
  if v_user_id is null then
    return;
  end if;

  perform public.ensure_affiliate_profile();

  select coalesce(nullif(platform_domain, ''), 'https://tryrobin.xyz')
  into v_domain
  from public.platform_settings
  order by updated_at desc
  limit 1;

  return query
  select
    ap.user_id as profile_id,
    ap.user_id,
    ap.referral_code,
    rtrim(v_domain, '/') || '/?ref=' || ap.referral_code as referral_link,
    ap.payout_method,
    ap.payout_details,
    coalesce(ap.payout_verified, false) as payout_verified,
    ap.payout_updated_at,
    coalesce(ap.total_clicks, 0) as total_referrals,
    coalesce(ap.total_conversions, 0) as converted_referrals,
    coalesce(ap.total_clicks, 0) as referral_clicks,
    coalesce(ap.total_conversions, 0) as conversion_count,
    coalesce(ap.total_earned, 0) as total_earned,
    coalesce(ap.pending_balance, 0) as pending_earnings,
    coalesce(ap.paid_balance, 0) as paid_out,
    coalesce(ap.pending_balance, 0) as available_balance,
    0::numeric as locked_balance
  from public.affiliate_profiles ap
  where ap.user_id = v_user_id
  limit 1;
end;
$$;

create or replace function public.apply_referral_commission_for_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_by_code text;
  v_affiliate_user_id uuid;
  v_commission_percent numeric := 30;
  v_commission_amount numeric := 0;
  v_inserted_id uuid;
begin
  if coalesce(lower(new.plan), 'free') = 'free' then
    return new;
  end if;

  if coalesce(lower(new.status), '') <> 'active' then
    return new;
  end if;

  if coalesce(new.amount, 0) <= 0 then
    return new;
  end if;

  select p.referred_by_code
  into v_referred_by_code
  from public.profiles p
  where p.user_id = new.user_id;

  if v_referred_by_code is null then
    return new;
  end if;

  select ap.user_id
  into v_affiliate_user_id
  from public.affiliate_profiles ap
  where upper(ap.referral_code) = upper(v_referred_by_code)
  limit 1;

  if v_affiliate_user_id is null or v_affiliate_user_id = new.user_id then
    return new;
  end if;

  select coalesce(ps.affiliate_commission_percent, 30)
  into v_commission_percent
  from public.platform_settings ps
  order by ps.updated_at desc
  limit 1;

  v_commission_amount := round((coalesce(new.amount, 0) * v_commission_percent / 100.0)::numeric, 2);

  if v_commission_amount <= 0 then
    return new;
  end if;

  insert into public.affiliate_commissions (
    affiliate_user_id,
    referred_user_id,
    subscription_id,
    amount,
    status,
    created_at,
    updated_at
  )
  values (
    v_affiliate_user_id,
    new.user_id,
    new.id,
    v_commission_amount,
    'paid',
    now(),
    now()
  )
  on conflict (affiliate_user_id, referred_user_id, subscription_id)
  do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return new;
  end if;

  update public.affiliate_profiles ap
  set total_conversions = coalesce(ap.total_conversions, 0) + 1,
      total_earned = coalesce(ap.total_earned, 0) + v_commission_amount,
      pending_balance = coalesce(ap.pending_balance, 0) + v_commission_amount,
      updated_at = now()
  where ap.user_id = v_affiliate_user_id;

  insert into public.affiliate_wallet_ledger (user_id, entry_type, amount, reference_type, reference_id, notes)
  values (v_affiliate_user_id, 'commission', v_commission_amount, 'subscription', new.id::text, 'Auto commission from paid conversion');

  return new;
end;
$$;

drop trigger if exists trg_apply_referral_commission_for_subscription on public.user_subscriptions;
create trigger trg_apply_referral_commission_for_subscription
after insert or update of status, plan, amount on public.user_subscriptions
for each row execute function public.apply_referral_commission_for_subscription();

create or replace function public.get_public_platform_settings()
returns table(
  creator_price numeric,
  pro_price numeric,
  agency_price numeric,
  free_scripts_limit integer,
  free_scans_limit integer,
  affiliate_commission_percent numeric,
  minimum_withdrawal numeric,
  payout_delay_days integer,
  maintenance_mode boolean,
  announcement_banner text,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    ps.creator_price,
    ps.pro_price,
    ps.agency_price,
    ps.free_scripts_limit,
    ps.free_scans_limit,
    ps.affiliate_commission_percent,
    ps.minimum_withdrawal,
    ps.payout_delay_days,
    ps.maintenance_mode,
    ps.announcement_banner,
    ps.updated_at
  from public.platform_settings ps
  order by ps.updated_at desc
  limit 1;
$$;

create or replace function public.admin_write_log(
  p_action_type text,
  p_target_id text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_admin_user_id uuid := auth.uid();
begin
  if v_admin_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  if public.get_admin_role(v_admin_user_id) is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  insert into public.admin_audit_logs (admin_user_id, action_type, target_id, details)
  values (
    v_admin_user_id,
    coalesce(nullif(trim(p_action_type), ''), 'manual_action'),
    coalesce(nullif(trim(p_target_id), ''), 'unknown'),
    coalesce(p_details, '{}'::jsonb)
  );

  return jsonb_build_object('ok', true);
end;
$$;

/* ============================================================
8) RLS POLICIES
============================================================ */
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.admin_allowlist enable row level security;
alter table public.platform_settings enable row level security;
alter table public.feature_flags enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_events enable row level security;
alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.affiliate_earnings enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_wallets enable row level security;
alter table public.affiliate_wallet_ledger enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.payout_history enable row level security;
alter table public.ai_generations enable row level security;
alter table public.script_generations enable row level security;
alter table public.caption_generations enable row level security;
alter table public.script_history enable row level security;
alter table public.scan_history enable row level security;
alter table public.usage_counters enable row level security;
alter table public.feature_usage_events enable row level security;
alter table public.feature_usage enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_logs enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.signup_ips enable row level security;
alter table public.onboarding_states enable row level security;

-- profiles
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "Admins can view all profiles" on public.profiles for select using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));
create policy "Admins can update all profiles" on public.profiles for update using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- user_roles
drop policy if exists "Users can view own roles" on public.user_roles;
create policy "Users can view own roles" on public.user_roles for select using (auth.uid() = user_id);

-- admin_allowlist
drop policy if exists "Authenticated users can read own active allowlist row" on public.admin_allowlist;
drop policy if exists "No direct access to admin allowlist" on public.admin_allowlist;
create policy "Authenticated users can read own active allowlist row" on public.admin_allowlist for select to authenticated using (is_active = true and lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy "No direct access to admin allowlist" on public.admin_allowlist for all using (false) with check (false);

-- platform settings
drop policy if exists "Admins can manage platform settings" on public.platform_settings;
drop policy if exists "Authenticated can read platform settings" on public.platform_settings;
drop policy if exists "Public can read platform settings" on public.platform_settings;
create policy "Admins can manage platform settings" on public.platform_settings for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));
create policy "Authenticated can read platform settings" on public.platform_settings for select to authenticated using (true);
create policy "Public can read platform settings" on public.platform_settings for select to public using (true);

-- feature flags
drop policy if exists "Public can read feature flags" on public.feature_flags;
drop policy if exists "Admins can manage feature flags" on public.feature_flags;
create policy "Public can read feature flags" on public.feature_flags for select using (true);
create policy "Admins can manage feature flags" on public.feature_flags for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- subscription + payment
drop policy if exists "Users can view own subscriptions" on public.user_subscriptions;
drop policy if exists "Admins can manage subscriptions" on public.user_subscriptions;
create policy "Users can view own subscriptions" on public.user_subscriptions for select using (auth.uid() = user_id);
create policy "Admins can manage subscriptions" on public.user_subscriptions for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own subscription events" on public.subscription_events;
drop policy if exists "Admins can manage subscription events" on public.subscription_events;
create policy "Users can view own subscription events" on public.subscription_events for select using (auth.uid() = user_id);
create policy "Admins can manage subscription events" on public.subscription_events for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own payments" on public.payments;
drop policy if exists "Admins can view all payments" on public.payments;
create policy "Users can view own payments" on public.payments for select using (auth.uid() = user_id);
create policy "Admins can view all payments" on public.payments for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own invoices" on public.invoices;
drop policy if exists "Admins can manage invoices" on public.invoices;
create policy "Users can view own invoices" on public.invoices for select using (auth.uid() = user_id);
create policy "Admins can manage invoices" on public.invoices for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Admins can manage payment events" on public.payment_events;
create policy "Admins can manage payment events" on public.payment_events for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- affiliate
drop policy if exists "Users can view own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Users can insert own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Users can update own affiliate profile" on public.affiliate_profiles;
drop policy if exists "Admins can manage affiliate profiles" on public.affiliate_profiles;
create policy "Users can view own affiliate profile" on public.affiliate_profiles for select using (auth.uid() = user_id);
create policy "Users can insert own affiliate profile" on public.affiliate_profiles for insert with check (auth.uid() = user_id);
create policy "Users can update own affiliate profile" on public.affiliate_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins can manage affiliate profiles" on public.affiliate_profiles for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate clicks" on public.affiliate_clicks;
drop policy if exists "Admins can manage affiliate clicks" on public.affiliate_clicks;
create policy "Users can view own affiliate clicks" on public.affiliate_clicks for select using (auth.uid() = affiliate_user_id);
create policy "Admins can manage affiliate clicks" on public.affiliate_clicks for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate conversions" on public.affiliate_conversions;
drop policy if exists "Admins can manage affiliate conversions" on public.affiliate_conversions;
create policy "Users can view own affiliate conversions" on public.affiliate_conversions for select using (auth.uid() = affiliate_user_id);
create policy "Admins can manage affiliate conversions" on public.affiliate_conversions for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate earnings" on public.affiliate_earnings;
drop policy if exists "Admins can manage affiliate earnings" on public.affiliate_earnings;
create policy "Users can view own affiliate earnings" on public.affiliate_earnings for select using (auth.uid() = affiliate_user_id);
create policy "Admins can manage affiliate earnings" on public.affiliate_earnings for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate commissions" on public.affiliate_commissions;
drop policy if exists "Admins can manage affiliate commissions" on public.affiliate_commissions;
create policy "Users can view own affiliate commissions" on public.affiliate_commissions for select using (auth.uid() = affiliate_user_id);
create policy "Admins can manage affiliate commissions" on public.affiliate_commissions for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate referrals" on public.affiliate_referrals;
drop policy if exists "Admins can manage affiliate referrals" on public.affiliate_referrals;
create policy "Users can view own affiliate referrals" on public.affiliate_referrals for select using (auth.uid() = affiliate_user_id);
create policy "Admins can manage affiliate referrals" on public.affiliate_referrals for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own affiliate wallet" on public.affiliate_wallets;
drop policy if exists "Admins can manage affiliate wallets" on public.affiliate_wallets;
create policy "Users can view own affiliate wallet" on public.affiliate_wallets for select using (auth.uid() = user_id);
create policy "Admins can manage affiliate wallets" on public.affiliate_wallets for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own wallet ledger" on public.affiliate_wallet_ledger;
drop policy if exists "Admins can manage wallet ledger" on public.affiliate_wallet_ledger;
create policy "Users can view own wallet ledger" on public.affiliate_wallet_ledger for select using (auth.uid() = user_id);
create policy "Admins can manage wallet ledger" on public.affiliate_wallet_ledger for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can create own withdrawal requests" on public.withdrawal_requests;
drop policy if exists "Users can view own withdrawal requests" on public.withdrawal_requests;
drop policy if exists "Admins can manage withdrawal requests" on public.withdrawal_requests;
create policy "Users can create own withdrawal requests" on public.withdrawal_requests for insert with check (auth.uid() = user_id);
create policy "Users can view own withdrawal requests" on public.withdrawal_requests for select using (auth.uid() = user_id);
create policy "Admins can manage withdrawal requests" on public.withdrawal_requests for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own payout history" on public.payout_history;
drop policy if exists "Admins can manage payout history" on public.payout_history;
create policy "Users can view own payout history" on public.payout_history for select using (auth.uid() = user_id);
create policy "Admins can manage payout history" on public.payout_history for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- ai + content
drop policy if exists "Users can view own ai generations" on public.ai_generations;
drop policy if exists "Users can create own ai generations" on public.ai_generations;
drop policy if exists "Admins can view all ai generations" on public.ai_generations;
create policy "Users can view own ai generations" on public.ai_generations for select using (auth.uid() = user_id);
create policy "Users can create own ai generations" on public.ai_generations for insert with check (auth.uid() = user_id);
create policy "Admins can view all ai generations" on public.ai_generations for select using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own script generations" on public.script_generations;
drop policy if exists "Users can insert own script generations" on public.script_generations;
drop policy if exists "Admins can manage script generations" on public.script_generations;
create policy "Users can view own script generations" on public.script_generations for select using (auth.uid() = user_id);
create policy "Users can insert own script generations" on public.script_generations for insert with check (auth.uid() = user_id);
create policy "Admins can manage script generations" on public.script_generations for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own caption generations" on public.caption_generations;
drop policy if exists "Users can insert own caption generations" on public.caption_generations;
drop policy if exists "Users can update own caption generations" on public.caption_generations;
drop policy if exists "Admins can manage caption generations" on public.caption_generations;
create policy "Users can view own caption generations" on public.caption_generations for select using (auth.uid() = user_id);
create policy "Users can insert own caption generations" on public.caption_generations for insert with check (auth.uid() = user_id);
create policy "Users can update own caption generations" on public.caption_generations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins can manage caption generations" on public.caption_generations for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own scripts" on public.script_history;
drop policy if exists "Users can insert own scripts" on public.script_history;
create policy "Users can view own scripts" on public.script_history for select using (auth.uid() = user_id);
create policy "Users can insert own scripts" on public.script_history for insert with check (auth.uid() = user_id);

drop policy if exists "Users can view own scans" on public.scan_history;
drop policy if exists "Users can insert own scans" on public.scan_history;
create policy "Users can view own scans" on public.scan_history for select using (auth.uid() = user_id);
create policy "Users can insert own scans" on public.scan_history for insert with check (auth.uid() = user_id);

-- usage
drop policy if exists "Users can view own usage counters" on public.usage_counters;
drop policy if exists "Users can manage own usage counters" on public.usage_counters;
drop policy if exists "Admins can manage usage counters" on public.usage_counters;
create policy "Users can view own usage counters" on public.usage_counters for select using (auth.uid() = user_id);
create policy "Users can manage own usage counters" on public.usage_counters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins can manage usage counters" on public.usage_counters for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Users can view own usage events" on public.feature_usage_events;
drop policy if exists "Users can insert own usage events" on public.feature_usage_events;
create policy "Users can view own usage events" on public.feature_usage_events for select using (auth.uid() = user_id);
create policy "Users can insert own usage events" on public.feature_usage_events for insert with check (auth.uid() = user_id);

drop policy if exists "Users can view own feature usage" on public.feature_usage;
drop policy if exists "Users can create own feature usage" on public.feature_usage;
drop policy if exists "Admins can view all feature usage" on public.feature_usage;
create policy "Users can view own feature usage" on public.feature_usage for select using (auth.uid() = user_id);
create policy "Users can create own feature usage" on public.feature_usage for insert with check (auth.uid() = user_id);
create policy "Admins can view all feature usage" on public.feature_usage for select using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- admin + moderation
drop policy if exists "Admins can manage admin audit logs" on public.admin_audit_logs;
create policy "Admins can manage admin audit logs" on public.admin_audit_logs for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Admins can manage admin logs" on public.admin_logs;
create policy "Admins can manage admin logs" on public.admin_logs for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

drop policy if exists "Admins can manage moderation actions" on public.moderation_actions;
create policy "Admins can manage moderation actions" on public.moderation_actions for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

-- signup ips (service-only)
drop policy if exists "Service role manages signup ips" on public.signup_ips;
create policy "Service role manages signup ips" on public.signup_ips for all to service_role using (true) with check (true);

-- onboarding
drop policy if exists "Users can view own onboarding state" on public.onboarding_states;
drop policy if exists "Users can manage own onboarding state" on public.onboarding_states;
drop policy if exists "Admins can manage onboarding state" on public.onboarding_states;
create policy "Users can view own onboarding state" on public.onboarding_states for select using (auth.uid() = user_id);
create policy "Users can manage own onboarding state" on public.onboarding_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Admins can manage onboarding state" on public.onboarding_states for all to authenticated using (public.get_admin_role(auth.uid()) in ('super_admin','admin','support')) with check (public.get_admin_role(auth.uid()) in ('super_admin','admin','support'));

/* ============================================================
9) STORAGE SETUP
============================================================ */
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('logos', 'logos', true),
  ('generated-content', 'generated-content', false),
  ('invoices', 'invoices', false),
  ('admin-assets', 'admin-assets', false)
on conflict (id) do nothing;

-- public read for avatar and logos
drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "Public read logos" on storage.objects;
create policy "Public read logos"
on storage.objects for select
using (bucket_id = 'logos');

-- owner upload/read generated-content
drop policy if exists "Users manage own generated content" on storage.objects;
create policy "Users manage own generated content"
on storage.objects for all
to authenticated
using (
  bucket_id = 'generated-content'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'generated-content'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- invoices private to owner folder
drop policy if exists "Users read own invoices" on storage.objects;
create policy "Users read own invoices"
on storage.objects for select
to authenticated
using (
  bucket_id = 'invoices'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- admin assets admin-only
drop policy if exists "Admins manage admin assets" on storage.objects;
create policy "Admins manage admin assets"
on storage.objects for all
to authenticated
using (
  bucket_id = 'admin-assets'
  and public.get_admin_role(auth.uid()) in ('super_admin','admin','support')
)
with check (
  bucket_id = 'admin-assets'
  and public.get_admin_role(auth.uid()) in ('super_admin','admin','support')
);

/* ============================================================
10) ANALYTICS VIEWS
============================================================ */
create or replace view public.admin_dashboard_stats as
select
  (select count(*) from public.profiles) as total_users,
  (select count(*) from public.user_subscriptions where lower(status) = 'active' and lower(plan) <> 'free') as active_subscriptions,
  (select coalesce(sum(amount),0) from public.payments where status = 'succeeded') as total_revenue,
  (select count(*) from public.withdrawal_requests where status in ('pending','reviewing','approved')) as pending_withdrawals,
  (select coalesce(sum(estimated_cost_usd),0) from public.ai_generations) as total_ai_cost;

create or replace view public.revenue_analytics as
select
  date_trunc('day', p.created_at)::date as day,
  count(*) as payment_count,
  coalesce(sum(p.amount),0) as gross_revenue,
  coalesce(sum(p.refunded_amount),0) as refunded_revenue,
  coalesce(sum(case when p.status = 'succeeded' then p.amount else 0 end),0) as net_success_revenue
from public.payments p
group by 1
order by 1 desc;

create or replace view public.affiliate_analytics as
select
  ap.user_id,
  ap.referral_code,
  ap.total_clicks,
  ap.total_conversions,
  ap.total_earned,
  ap.pending_balance,
  ap.paid_balance,
  case when ap.total_clicks > 0 then round((ap.total_conversions::numeric / ap.total_clicks::numeric) * 100, 2) else 0 end as conversion_rate
from public.affiliate_profiles ap;

create or replace view public.user_growth_analytics as
select
  date_trunc('day', p.created_at)::date as day,
  count(*) as users_created
from public.profiles p
group by 1
order by 1 desc;

create or replace view public.admin_profiles_view as
select
  p.user_id,
  p.email,
  p.display_name,
  p.current_plan,
  p.subscription_tier,
  p.is_suspended,
  p.created_at,
  p.updated_at,
  coalesce(us.status, 'none') as subscription_status,
  coalesce(us.plan, 'free') as subscription_plan
from public.profiles p
left join public.user_subscriptions us on us.user_id = p.user_id;

/* ============================================================
11) MATERIALIZED VIEWS
============================================================ */
create materialized view if not exists public.mv_daily_kpis as
select
  d.day,
  coalesce(u.new_users, 0) as new_users,
  coalesce(r.revenue, 0) as revenue,
  coalesce(w.withdrawals_requested, 0) as withdrawals_requested,
  coalesce(a.ai_cost, 0) as ai_cost
from (
  select generate_series((now() - interval '90 days')::date, now()::date, interval '1 day')::date as day
) d
left join (
  select date_trunc('day', created_at)::date as day, count(*) as new_users
  from public.profiles
  group by 1
) u on u.day = d.day
left join (
  select date_trunc('day', created_at)::date as day, sum(amount) as revenue
  from public.payments
  where status = 'succeeded'
  group by 1
) r on r.day = d.day
left join (
  select date_trunc('day', created_at)::date as day, sum(amount) as withdrawals_requested
  from public.withdrawal_requests
  group by 1
) w on w.day = d.day
left join (
  select date_trunc('day', created_at)::date as day, sum(estimated_cost_usd) as ai_cost
  from public.ai_generations
  group by 1
) a on a.day = d.day;

create unique index if not exists idx_mv_daily_kpis_day on public.mv_daily_kpis(day);

/* ============================================================
12) SEED CONFIGURATION
============================================================ */
insert into public.platform_settings (
  creator_price,
  pro_price,
  agency_price,
  free_scripts_limit,
  free_scans_limit,
  affiliate_commission_percent,
  minimum_withdrawal,
  payout_delay_days,
  maintenance_mode,
  announcement_banner,
  platform_domain,
  support_email
)
select
  19,
  39,
  99,
  3,
  20,
  30,
  25,
  7,
  false,
  null,
  'https://tryrobin.xyz',
  'support@tryrobin.xyz'
where not exists (select 1 from public.platform_settings);

insert into public.feature_flags (flag_key, flag_value, description)
values
  ('maintenance_banner_enabled', false, 'Enable/disable public maintenance banner'),
  ('affiliate_program_enabled', true, 'Enable/disable affiliate program surfaces'),
  ('ai_generation_enabled', true, 'Enable/disable AI generation services')
on conflict (flag_key) do nothing;

/* ============================================================
13) PERFORMANCE INDEXES
============================================================ */
create index if not exists idx_profiles_email on public.profiles (lower(email));
create index if not exists idx_profiles_referral_code on public.profiles (upper(referral_code));
create index if not exists idx_profiles_referred_by_code on public.profiles (upper(referred_by_code));
create index if not exists idx_profiles_plan on public.profiles (subscription_tier, current_plan);
create index if not exists idx_profiles_created_at on public.profiles (created_at desc);

create index if not exists idx_user_roles_user on public.user_roles (user_id);
create index if not exists idx_admin_allowlist_email on public.admin_allowlist (lower(email));

create index if not exists idx_user_subscriptions_plan_status on public.user_subscriptions (plan, status);
create index if not exists idx_user_subscriptions_provider_sub on public.user_subscriptions (provider, provider_subscription_id);
create index if not exists idx_subscription_events_user_created on public.subscription_events (user_id, created_at desc);

create index if not exists idx_payments_user_created on public.payments (user_id, created_at desc);
create index if not exists idx_payments_status_created on public.payments (status, created_at desc);
create index if not exists idx_payments_provider_id on public.payments (provider, provider_payment_id);
create index if not exists idx_invoices_user_created on public.invoices (user_id, created_at desc);
create index if not exists idx_payment_events_created on public.payment_events (created_at desc);

create index if not exists idx_affiliate_profiles_referral_code on public.affiliate_profiles (upper(referral_code));
create index if not exists idx_affiliate_clicks_affiliate_user on public.affiliate_clicks (affiliate_user_id, created_at desc);
create index if not exists idx_affiliate_clicks_click_key on public.affiliate_clicks (click_key);
create index if not exists idx_affiliate_conversions_affiliate on public.affiliate_conversions (affiliate_user_id, created_at desc);
create index if not exists idx_affiliate_earnings_affiliate_status on public.affiliate_earnings (affiliate_user_id, status, created_at desc);
create index if not exists idx_affiliate_commissions_affiliate_status on public.affiliate_commissions (affiliate_user_id, status, created_at desc);
create index if not exists idx_affiliate_referrals_code on public.affiliate_referrals (lower(referral_code));
create index if not exists idx_affiliate_wallet_ledger_user_created on public.affiliate_wallet_ledger (user_id, created_at desc);

create index if not exists idx_withdrawal_requests_user_status on public.withdrawal_requests (user_id, status, created_at desc);
create index if not exists idx_withdrawal_requests_status_created on public.withdrawal_requests (status, created_at desc);
create index if not exists idx_payout_history_user_processed on public.payout_history (user_id, processed_at desc);

create index if not exists idx_ai_generations_user_created on public.ai_generations (user_id, created_at desc);
create index if not exists idx_script_generations_user_created on public.script_generations (user_id, created_at desc);
create index if not exists idx_caption_generations_user_created on public.caption_generations (user_id, created_at desc);
create index if not exists idx_script_history_user_created on public.script_history (user_id, created_at desc);
create index if not exists idx_scan_history_user_created on public.scan_history (user_id, created_at desc);
create index if not exists idx_usage_counters_user_period on public.usage_counters (user_id, period_key desc);
create index if not exists idx_feature_usage_events_user_created on public.feature_usage_events (user_id, created_at desc);

create index if not exists idx_admin_audit_logs_admin_created on public.admin_audit_logs (admin_user_id, created_at desc);
create index if not exists idx_signup_ips_ip_created on public.signup_ips (ip_address, created_at desc);

/* ============================================================
14) FINAL VERIFICATION NOTES
============================================================ */
-- 1) Run refresh materialized view concurrently public.mv_daily_kpis; after first data load.
-- 2) Ensure frontend calls initialize_user_account() right after first authenticated login.
-- 3) Verify service role secrets are only used in backend functions/webhooks.
-- 4) Confirm payment webhooks (Creem/Stripe) write into user_subscriptions + payments + payment_events.
-- 5) This script consolidates prior fragmented architecture into one authoritative production baseline.
