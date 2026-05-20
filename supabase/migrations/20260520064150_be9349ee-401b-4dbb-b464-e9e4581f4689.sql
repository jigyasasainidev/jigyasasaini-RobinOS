drop function if exists public.get_affiliate_dashboard();

-- Core security helper
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

-- Affiliate profile enhancements
alter table public.affiliate_profiles
  add column if not exists referral_link text,
  add column if not exists wallet_active boolean not null default true;

create unique index if not exists idx_affiliate_profiles_referral_code_unique
  on public.affiliate_profiles (lower(referral_code));

-- Wallet + ledger
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
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.affiliate_wallets(id) on delete cascade,
  user_id uuid not null,
  entry_type text not null,
  amount numeric(12,2) not null,
  reference_type text,
  reference_id uuid,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aff_wallet_ledger_user_created
  on public.affiliate_wallet_ledger(user_id, created_at desc);
create index if not exists idx_aff_wallet_ledger_reference
  on public.affiliate_wallet_ledger(reference_type, reference_id);

-- Referral attribution
create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code text not null,
  affiliate_user_id uuid not null,
  click_id uuid,
  click_key text,
  referred_user_id uuid,
  source text,
  campaign text,
  landing_path text,
  click_meta jsonb not null default '{}'::jsonb,
  clicked_at timestamptz not null default now(),
  signed_up_at timestamptz,
  converted_at timestamptz,
  conversion_amount numeric(12,2),
  created_at timestamptz not null default now(),
  unique (referred_user_id)
);

create index if not exists idx_aff_referrals_code on public.affiliate_referrals(lower(referral_code));
create index if not exists idx_aff_referrals_affiliate on public.affiliate_referrals(affiliate_user_id, created_at desc);
create index if not exists idx_aff_referrals_click_key on public.affiliate_referrals(click_key);

-- Subscription infrastructure
create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  plan text not null default 'free',
  billing_cycle text not null default 'monthly',
  status text not null default 'inactive',
  amount numeric(12,2) not null default 0,
  currency text not null default 'USD',
  period_start timestamptz,
  period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  failed_payment_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists idx_user_subscriptions_status2 on public.user_subscriptions(status);
create index if not exists idx_user_subscriptions_plan2 on public.user_subscriptions(plan);
create index if not exists idx_user_subscriptions_provider_sub2 on public.user_subscriptions(provider, provider_subscription_id);
create index if not exists idx_subscription_events_user on public.subscription_events(user_id, created_at desc);

-- Plan limits + usage
create table if not exists public.plan_feature_limits (
  id uuid primary key default gen_random_uuid(),
  plan text not null,
  feature_name text not null,
  quota_period text not null default 'day',
  quota integer,
  fair_usage boolean not null default false,
  hard_block boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan, feature_name, quota_period)
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

create index if not exists idx_usage_counters_user_period on public.usage_counters(user_id, period_key desc);

insert into public.plan_feature_limits(plan, feature_name, quota_period, quota, fair_usage, hard_block)
values
  ('creator', 'scripts', 'day', 20, false, true),
  ('creator', 'ai_requests', 'day', 120, false, true),
  ('creator', 'voice_generations', 'day', 20, false, true),
  ('creator', 'exports', 'day', 20, false, true),
  ('creator', 'automation_runs', 'day', 10, false, true),
  ('pro_creator', 'scripts', 'day', 100, false, true),
  ('pro_creator', 'ai_requests', 'day', 600, false, true),
  ('pro_creator', 'voice_generations', 'day', 80, false, true),
  ('pro_creator', 'exports', 'day', 120, false, true),
  ('pro_creator', 'automation_runs', 'day', 60, false, true),
  ('agency', 'scripts', 'day', null, true, false),
  ('agency', 'ai_requests', 'day', null, true, false),
  ('agency', 'voice_generations', 'day', null, true, false),
  ('agency', 'exports', 'day', null, true, false),
  ('agency', 'automation_runs', 'day', null, true, false)
on conflict (plan, feature_name, quota_period) do update
set quota = excluded.quota,
    fair_usage = excluded.fair_usage,
    hard_block = excluded.hard_block,
    updated_at = now();

-- Updated-at trigger helper
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

drop trigger if exists trg_affiliate_wallets_touch_updated_at on public.affiliate_wallets;
create trigger trg_affiliate_wallets_touch_updated_at
before update on public.affiliate_wallets
for each row execute function public.touch_updated_at();

drop trigger if exists trg_user_subscriptions_touch_updated_at on public.user_subscriptions;
create trigger trg_user_subscriptions_touch_updated_at
before update on public.user_subscriptions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_plan_feature_limits_touch_updated_at on public.plan_feature_limits;
create trigger trg_plan_feature_limits_touch_updated_at
before update on public.plan_feature_limits
for each row execute function public.touch_updated_at();

drop trigger if exists trg_usage_counters_touch_updated_at on public.usage_counters;
create trigger trg_usage_counters_touch_updated_at
before update on public.usage_counters
for each row execute function public.touch_updated_at();

-- RPCs
create or replace function public.ensure_affiliate_profile()
returns public.affiliate_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_code text;
  v_domain text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id;
  if found then
    if coalesce(v_profile.referral_link, '') = '' then
      select coalesce(nullif(platform_domain, ''), 'https://tryrobin.xyz')
      into v_domain
      from public.platform_settings
      order by updated_at desc
      limit 1;

      update public.affiliate_profiles
      set referral_link = rtrim(v_domain, '/') || '/?ref=' || v_profile.referral_code,
          updated_at = now()
      where id = v_profile.id
      returning * into v_profile;
    end if;

    insert into public.affiliate_wallets(user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;

    return v_profile;
  end if;

  loop
    v_code := 'robin_' || upper(substring(md5(gen_random_uuid()::text) from 1 for 5));
    begin
      insert into public.affiliate_profiles(user_id, referral_code)
      values (v_user_id, v_code)
      returning * into v_profile;
      exit;
    exception when unique_violation then
      -- retry
    end;
  end loop;

  select coalesce(nullif(platform_domain, ''), 'https://tryrobin.xyz')
  into v_domain
  from public.platform_settings
  order by updated_at desc
  limit 1;

  update public.affiliate_profiles
  set referral_link = rtrim(v_domain, '/') || '/?ref=' || v_profile.referral_code,
      updated_at = now()
  where id = v_profile.id
  returning * into v_profile;

  insert into public.affiliate_wallets(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  return v_profile;
end;
$$;

create or replace function public.record_referral_signup(
  p_referral_code text,
  p_referred_user_id uuid,
  p_click_id uuid default null,
  p_click_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affiliate_user_id uuid;
begin
  if p_referred_user_id is null then
    raise exception 'Referred user id is required';
  end if;

  if coalesce(trim(p_referral_code), '') = '' then
    return;
  end if;

  select user_id
  into v_affiliate_user_id
  from public.affiliate_profiles
  where lower(referral_code) = lower(trim(p_referral_code))
  limit 1;

  if v_affiliate_user_id is null or v_affiliate_user_id = p_referred_user_id then
    return;
  end if;

  insert into public.affiliate_referrals(
    referral_code,
    affiliate_user_id,
    referred_user_id,
    click_id,
    click_key,
    signed_up_at
  ) values (
    lower(trim(p_referral_code)),
    v_affiliate_user_id,
    p_referred_user_id,
    p_click_id,
    nullif(trim(coalesce(p_click_key, '')), ''),
    now()
  )
  on conflict (referred_user_id) do update
  set affiliate_user_id = excluded.affiliate_user_id,
      referral_code = excluded.referral_code,
      click_id = coalesce(public.affiliate_referrals.click_id, excluded.click_id),
      click_key = coalesce(public.affiliate_referrals.click_key, excluded.click_key),
      signed_up_at = coalesce(public.affiliate_referrals.signed_up_at, excluded.signed_up_at);
end;
$$;

revoke all on function public.record_referral_signup(text, uuid, uuid, text) from public;
grant execute on function public.record_referral_signup(text, uuid, uuid, text) to anon, authenticated, service_role;

create or replace function public.save_payout_method(p_method public.payout_method_type, p_details text)
returns public.affiliate_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_clean text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_clean := trim(coalesce(p_details, ''));
  if length(v_clean) = 0 or length(v_clean) > 160 then
    raise exception 'Invalid payout details';
  end if;

  if p_method = 'paypal' and v_clean !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Invalid PayPal email';
  end if;

  if p_method = 'usdt_trc20' and v_clean !~ '^T[1-9A-HJ-NP-Za-km-z]{25,35}$' then
    raise exception 'Invalid TRC20 address';
  end if;

  perform public.ensure_affiliate_profile();

  update public.affiliate_profiles
  set payout_method = p_method,
      payout_details = v_clean,
      payout_verified = false,
      payout_updated_at = now(),
      updated_at = now()
  where user_id = v_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.submit_withdrawal_request(p_amount numeric)
returns public.withdrawal_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_wallet public.affiliate_wallets%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_min_withdrawal numeric(10,2) := 25;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;

  perform public.ensure_affiliate_profile();

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id for update;
  select * into v_wallet from public.affiliate_wallets where user_id = v_user_id for update;

  if v_wallet.id is null then
    raise exception 'Affiliate wallet not found';
  end if;

  select coalesce(minimum_withdrawal, 25)
  into v_min_withdrawal
  from public.platform_settings
  order by updated_at desc
  limit 1;

  if p_amount < v_min_withdrawal then
    raise exception 'Minimum withdrawal is $%s', v_min_withdrawal;
  end if;

  if coalesce(v_profile.payout_method::text, '') = '' or coalesce(v_profile.payout_details, '') = '' then
    raise exception 'Add payout method first';
  end if;

  if coalesce(v_profile.payout_verified, false) = false then
    raise exception 'Payout method must be verified before withdrawal';
  end if;

  if coalesce(v_wallet.is_active, true) = false or coalesce(v_profile.wallet_active, true) = false then
    raise exception 'Wallet is inactive';
  end if;

  if round(coalesce(v_wallet.available_balance, 0), 2) < round(p_amount, 2) then
    raise exception 'Amount exceeds available balance';
  end if;

  update public.affiliate_wallets
  set available_balance = round(available_balance - p_amount, 2),
      locked_balance = round(locked_balance + p_amount, 2),
      updated_at = now()
  where user_id = v_user_id;

  insert into public.withdrawal_requests(
    user_id, requester_email, amount, payout_method, payout_details, status
  ) values (
    v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending'
  )
  returning * into v_request;

  insert into public.affiliate_wallet_ledger(
    wallet_id, user_id, entry_type, amount, reference_type, reference_id, note
  )
  values (
    v_wallet.id, v_user_id, 'withdrawal_locked', round(p_amount, 2),
    'withdrawal_requests', v_request.id,
    'Withdrawal requested and funds locked'
  );

  return v_request;
end;
$$;

create or replace function public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text default null
)
returns public.withdrawal_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.withdrawal_requests%rowtype;
  v_wallet public.affiliate_wallets%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.has_role(v_actor, 'admin') then raise exception 'Admin privileges required'; end if;
  if p_status not in ('pending', 'approved', 'paid', 'rejected') then raise exception 'Invalid status'; end if;

  update public.withdrawal_requests
  set status = p_status::public.withdrawal_status,
      admin_note = coalesce(p_admin_note, admin_note),
      approved_at = case when p_status = 'approved' then now() else approved_at end,
      completed_at = case when p_status = 'paid' then now() else completed_at end,
      rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
      updated_at = now()
  where id = p_request_id
  returning * into v_req;

  if not found then raise exception 'Withdrawal request not found'; end if;

  select * into v_wallet
  from public.affiliate_wallets
  where user_id = v_req.user_id
  for update;

  if p_status = 'rejected' then
    update public.affiliate_wallets
    set locked_balance = round(greatest(locked_balance - v_req.amount, 0), 2),
        available_balance = round(available_balance + v_req.amount, 2),
        updated_at = now()
    where user_id = v_req.user_id;

    insert into public.affiliate_wallet_ledger(
      wallet_id, user_id, entry_type, amount, reference_type, reference_id, note
    ) values (
      v_wallet.id, v_req.user_id, 'withdrawal_rejected_release', v_req.amount,
      'withdrawal_requests', v_req.id,
      'Withdrawal rejected, locked amount released back to available'
    );
  elsif p_status = 'paid' then
    update public.affiliate_wallets
    set locked_balance = round(greatest(locked_balance - v_req.amount, 0), 2),
        paid_out = round(paid_out + v_req.amount, 2),
        total_withdrawn = round(total_withdrawn + v_req.amount, 2),
        updated_at = now()
    where user_id = v_req.user_id;

    update public.affiliate_profiles
    set paid_balance = round(coalesce(paid_balance, 0) + v_req.amount, 2),
        payout_verified = true,
        updated_at = now()
    where user_id = v_req.user_id;

    update public.affiliate_earnings
    set status = 'paid',
        paid_out_at = now()
    where affiliate_user_id = v_req.user_id
      and status = 'available'
      and paid_out_at is null;

    insert into public.affiliate_wallet_ledger(
      wallet_id, user_id, entry_type, amount, reference_type, reference_id, note
    ) values (
      v_wallet.id, v_req.user_id, 'withdrawal_paid', v_req.amount,
      'withdrawal_requests', v_req.id,
      'Withdrawal paid successfully'
    );
  end if;

  perform public.admin_write_log(
    'withdrawal_' || p_status,
    p_request_id::text,
    jsonb_build_object('request_id', p_request_id, 'status', p_status, 'amount', v_req.amount)
  );

  return v_req;
end;
$$;

create or replace function public.upsert_subscription_state(
  p_user_id uuid,
  p_provider text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_plan text,
  p_status text,
  p_billing_cycle text,
  p_amount numeric,
  p_currency text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_grace_until timestamptz,
  p_cancel_at_period_end boolean,
  p_failed_payment_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_subscriptions%rowtype;
  v_plan_for_profile text;
begin
  if p_user_id is null then raise exception 'user id required'; end if;

  v_plan_for_profile := case
    when lower(coalesce(p_plan, 'free')) in ('pro', 'pro_creator') then 'pro_creator'
    when lower(coalesce(p_plan, 'free')) in ('agency', 'scale_agency') then 'agency'
    when lower(coalesce(p_plan, 'free')) in ('creator', 'starter') then 'creator'
    else 'free'
  end;

  insert into public.user_subscriptions(
    user_id, provider, provider_customer_id, provider_subscription_id, plan,
    billing_cycle, status, amount, currency, period_start, period_end, grace_until,
    cancel_at_period_end, failed_payment_at, cancelled_at, metadata
  ) values (
    p_user_id, lower(coalesce(p_provider, 'stripe')), p_provider_customer_id, p_provider_subscription_id, v_plan_for_profile,
    lower(coalesce(p_billing_cycle, 'monthly')), lower(coalesce(p_status, 'active')), round(coalesce(p_amount, 0), 2),
    upper(coalesce(p_currency, 'USD')), p_period_start, p_period_end, p_grace_until,
    coalesce(p_cancel_at_period_end, false), p_failed_payment_at,
    case when lower(coalesce(p_status, '')) = 'cancelled' then now() else null end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (user_id) do update
  set provider = excluded.provider,
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      plan = excluded.plan,
      billing_cycle = excluded.billing_cycle,
      status = excluded.status,
      amount = excluded.amount,
      currency = excluded.currency,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      grace_until = excluded.grace_until,
      cancel_at_period_end = excluded.cancel_at_period_end,
      failed_payment_at = excluded.failed_payment_at,
      cancelled_at = excluded.cancelled_at,
      metadata = excluded.metadata,
      updated_at = now()
  returning * into v_row;

  insert into public.subscriptions(
    user_id, plan, billing_cycle, amount, status, renewal_date, cancelled_at, updated_at
  ) values (
    p_user_id, v_row.plan, v_row.billing_cycle, v_row.amount, v_row.status, v_row.period_end, v_row.cancelled_at, now()
  )
  on conflict (user_id) do update
  set plan = excluded.plan,
      billing_cycle = excluded.billing_cycle,
      amount = excluded.amount,
      status = excluded.status,
      renewal_date = excluded.renewal_date,
      cancelled_at = excluded.cancelled_at,
      updated_at = now();

  update public.profiles
  set subscription_tier = case
        when lower(v_row.status) in ('active','trialing','past_due') then v_plan_for_profile
        when lower(v_row.status) = 'cancelled' and v_row.grace_until is not null and v_row.grace_until > now() then v_plan_for_profile
        else 'free'
      end,
      current_plan = v_plan_for_profile,
      subscription_expires_at = coalesce(v_row.period_end, v_row.grace_until),
      updated_at = now()
  where user_id = p_user_id;

  return v_row;
end;
$$;

revoke all on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) from public;
grant execute on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) to service_role;

create or replace function public.consume_feature_quota(
  p_feature_name text,
  p_amount integer default 1
)
returns table (
  allowed boolean,
  plan text,
  used integer,
  quota integer,
  remaining integer,
  fair_usage boolean,
  message text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text := 'free';
  v_sub public.user_subscriptions%rowtype;
  v_limit public.plan_feature_limits%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_counter public.usage_counters%rowtype;
  v_next_used integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(trim(p_feature_name), '') = '' then raise exception 'Feature name required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select * into v_sub from public.user_subscriptions where user_id = v_user_id;
  if v_sub.id is not null then
    if lower(v_sub.status) in ('active','trialing','past_due') then
      v_plan := coalesce(v_sub.plan, 'free');
    elsif lower(v_sub.status) = 'cancelled' and v_sub.grace_until is not null and v_sub.grace_until > now() then
      v_plan := coalesce(v_sub.plan, 'free');
    end if;
  end if;

  select * into v_limit
  from public.plan_feature_limits
  where plan = v_plan and feature_name = p_feature_name and quota_period = 'day'
  limit 1;

  if v_limit.id is null then
    return query select false, v_plan, 0, 0, 0, false, 'Feature is not enabled for this plan';
    return;
  end if;

  insert into public.usage_counters(user_id, feature_name, period_key, used_count)
  values (v_user_id, p_feature_name, v_today, 0)
  on conflict (user_id, feature_name, period_key) do nothing;

  select * into v_counter
  from public.usage_counters
  where user_id = v_user_id and feature_name = p_feature_name and period_key = v_today
  for update;

  v_next_used := coalesce(v_counter.used_count, 0) + p_amount;

  if v_limit.quota is not null and v_next_used > v_limit.quota and coalesce(v_limit.hard_block, true) then
    return query
    select false,
           v_plan,
           coalesce(v_counter.used_count, 0),
           v_limit.quota,
           greatest(v_limit.quota - coalesce(v_counter.used_count, 0), 0),
           coalesce(v_limit.fair_usage, false),
           format('Limit reached: %s/%s used today', coalesce(v_counter.used_count, 0), v_limit.quota);
    return;
  end if;

  update public.usage_counters
  set used_count = v_next_used,
      updated_at = now()
  where id = v_counter.id;

  return query
  select true,
         v_plan,
         v_next_used,
         v_limit.quota,
         case when v_limit.quota is null then null else greatest(v_limit.quota - v_next_used, 0) end,
         coalesce(v_limit.fair_usage, false),
         case
           when v_limit.quota is null then format('%s used today (fair usage)', v_next_used)
           else format('%s/%s used today', v_next_used, v_limit.quota)
         end;
end;
$$;

create or replace function public.get_usage_status(p_feature_name text)
returns table (
  plan text,
  used integer,
  quota integer,
  remaining integer,
  fair_usage boolean,
  message text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text := 'free';
  v_sub public.user_subscriptions%rowtype;
  v_limit public.plan_feature_limits%rowtype;
  v_used integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_sub from public.user_subscriptions where user_id = v_user_id;
  if v_sub.id is not null then
    if lower(v_sub.status) in ('active','trialing','past_due') then
      v_plan := coalesce(v_sub.plan, 'free');
    elsif lower(v_sub.status) = 'cancelled' and v_sub.grace_until is not null and v_sub.grace_until > now() then
      v_plan := coalesce(v_sub.plan, 'free');
    end if;
  end if;

  select * into v_limit
  from public.plan_feature_limits
  where plan = v_plan and feature_name = p_feature_name and quota_period = 'day'
  limit 1;

  select coalesce(used_count, 0)
  into v_used
  from public.usage_counters
  where user_id = v_user_id
    and feature_name = p_feature_name
    and period_key = (now() at time zone 'utc')::date;

  if not found then v_used := 0; end if;

  return query
  select v_plan,
         v_used,
         coalesce(v_limit.quota, null),
         case when v_limit.quota is null then null else greatest(v_limit.quota - v_used, 0) end,
         coalesce(v_limit.fair_usage, false),
         case
           when v_limit.id is null then 'Feature is not enabled for this plan'
           when v_limit.quota is null then format('%s used today (fair usage)', v_used)
           else format('%s/%s used today', v_used, v_limit.quota)
         end;
end;
$$;

create function public.get_affiliate_dashboard()
returns table(
  profile_id uuid,
  user_id uuid,
  referral_code text,
  referral_link text,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean,
  payout_updated_at timestamptz,
  total_referrals bigint,
  converted_referrals bigint,
  referral_clicks bigint,
  conversion_count bigint,
  total_earned numeric,
  pending_earnings numeric,
  paid_out numeric,
  available_balance numeric,
  locked_balance numeric,
  withdrawal_count bigint
)
language sql
security invoker
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  p as (
    select ap.*
    from public.affiliate_profiles ap
    join me on ap.user_id = me.uid
  ),
  w as (
    select * from public.affiliate_wallets aw
    join me on aw.user_id = me.uid
  )
  select
    p.id,
    p.user_id,
    p.referral_code,
    p.referral_link,
    p.payout_method,
    p.payout_details,
    p.payout_verified,
    p.payout_updated_at,
    coalesce((select count(*) from public.affiliate_referrals ar where ar.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((select count(*) from public.affiliate_referrals ar where ar.affiliate_user_id = p.user_id and ar.converted_at is not null), 0)::bigint,
    coalesce((select count(*) from public.affiliate_clicks c where c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((select count(*) from public.affiliate_conversions c where c.affiliate_user_id = p.user_id), 0)::bigint,
    round(coalesce(w.total_earned, 0), 2),
    round(coalesce(w.pending_balance, 0), 2),
    round(coalesce(w.paid_out, 0), 2),
    round(coalesce(w.available_balance, 0), 2),
    round(coalesce(w.locked_balance, 0), 2),
    coalesce((select count(*) from public.withdrawal_requests wr where wr.user_id = p.user_id), 0)::bigint
  from p
  left join w on true;
$$;

create or replace view public.affiliate_withdrawals as
select
  wr.id,
  wr.user_id,
  wr.requester_email,
  wr.amount,
  wr.fee_amount,
  wr.status,
  wr.payout_method,
  wr.payout_details,
  wr.admin_note,
  wr.created_at,
  wr.updated_at,
  wr.approved_at,
  wr.completed_at,
  wr.rejected_at
from public.withdrawal_requests wr;

-- RLS
alter table public.affiliate_wallets enable row level security;
alter table public.affiliate_wallet_ledger enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.plan_feature_limits enable row level security;
alter table public.usage_counters enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_wallets' and policyname='Users read own affiliate wallet') then
    create policy "Users read own affiliate wallet" on public.affiliate_wallets for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_wallets' and policyname='Admins manage affiliate wallets') then
    create policy "Admins manage affiliate wallets" on public.affiliate_wallets for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_wallet_ledger' and policyname='Users read own wallet ledger') then
    create policy "Users read own wallet ledger" on public.affiliate_wallet_ledger for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_wallet_ledger' and policyname='Admins manage wallet ledger') then
    create policy "Admins manage wallet ledger" on public.affiliate_wallet_ledger for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_referrals' and policyname='Users read own affiliate referrals') then
    create policy "Users read own affiliate referrals" on public.affiliate_referrals for select to authenticated using (auth.uid() = affiliate_user_id or auth.uid() = referred_user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='affiliate_referrals' and policyname='Service role manages affiliate referrals') then
    create policy "Service role manages affiliate referrals" on public.affiliate_referrals for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_subscriptions' and policyname='Users read own subscription profile') then
    create policy "Users read own subscription profile" on public.user_subscriptions for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_subscriptions' and policyname='Admins manage subscriptions profile') then
    create policy "Admins manage subscriptions profile" on public.user_subscriptions for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_subscriptions' and policyname='Service role manages subscriptions profile') then
    create policy "Service role manages subscriptions profile" on public.user_subscriptions for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subscription_events' and policyname='Admins read subscription events') then
    create policy "Admins read subscription events" on public.subscription_events for select to authenticated using (public.has_role(auth.uid(), 'admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subscription_events' and policyname='Service role manages subscription events') then
    create policy "Service role manages subscription events" on public.subscription_events for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='plan_feature_limits' and policyname='Authenticated can read plan feature limits') then
    create policy "Authenticated can read plan feature limits" on public.plan_feature_limits for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='plan_feature_limits' and policyname='Admins manage plan feature limits') then
    create policy "Admins manage plan feature limits" on public.plan_feature_limits for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usage_counters' and policyname='Users read own usage counters') then
    create policy "Users read own usage counters" on public.usage_counters for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usage_counters' and policyname='Users manage own usage counters') then
    create policy "Users manage own usage counters" on public.usage_counters for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usage_counters' and policyname='Admins read all usage counters') then
    create policy "Admins read all usage counters" on public.usage_counters for select to authenticated using (public.has_role(auth.uid(), 'admin'));
  end if;
end
$$;

-- Backfill
insert into public.affiliate_wallets(user_id)
select ap.user_id
from public.affiliate_profiles ap
left join public.affiliate_wallets aw on aw.user_id = ap.user_id
where aw.user_id is null;

insert into public.user_subscriptions(user_id, provider, plan, billing_cycle, status, amount, currency, period_end)
select
  p.user_id,
  coalesce(pay.payment_provider, 'stripe'),
  case
    when lower(coalesce(p.subscription_tier, 'free')) in ('pro', 'pro_creator') then 'pro_creator'
    when lower(coalesce(p.subscription_tier, 'free')) in ('agency', 'scale_agency') then 'agency'
    when lower(coalesce(p.subscription_tier, 'free')) in ('creator', 'starter') then 'creator'
    else 'free'
  end,
  coalesce(sub.billing_cycle, 'monthly'),
  case
    when lower(coalesce(sub.status, '')) in ('active','trialing','past_due') then lower(sub.status)
    when lower(coalesce(p.subscription_tier, 'free')) <> 'free' then 'active'
    else 'inactive'
  end,
  coalesce(sub.amount, 0),
  coalesce(pay.currency, 'USD'),
  p.subscription_expires_at
from public.profiles p
left join public.subscriptions sub on sub.user_id = p.user_id
left join lateral (
  select payment_provider, currency
  from public.payments pa
  where pa.user_id = p.user_id
  order by pa.created_at desc
  limit 1
) pay on true
where not exists (
  select 1 from public.user_subscriptions us where us.user_id = p.user_id
);

update public.affiliate_profiles ap
set referral_link = rtrim(coalesce((
    select nullif(platform_domain, '') from public.platform_settings order by updated_at desc limit 1
  ), 'https://tryrobin.xyz'), '/') || '/?ref=' || ap.referral_code
where coalesce(ap.referral_link, '') = '';

-- Realtime enablement (idempotent)
do $$ begin
  begin alter publication supabase_realtime add table public.affiliate_wallets; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.affiliate_wallet_ledger; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.withdrawal_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.affiliate_referrals; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.user_subscriptions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.usage_counters; exception when duplicate_object then null; end;
end $$;