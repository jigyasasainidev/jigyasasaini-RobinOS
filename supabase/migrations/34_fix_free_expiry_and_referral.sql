-- ============================================================
-- MIGRATION 34 — Fix free-plan expiry_state + referral conversion
-- ============================================================
-- Bug 1: Free users with status='active' and expires_at=NULL
--   get days_remaining=0 → expiry_state='expiring_1d' → popup shows.
--   Fix: expiry_state must be 'none' when effective plan is 'free'.
--
-- Bug 2: initialize_user_account stores referred_by_code but never
--   inserts into affiliate_conversions → referral never counted.
--   Fix: insert conversion row after profile upsert.
-- ============================================================

-- ── 1. HARDENED resolve_user_plan — free plan expiry fix ──
-- Key change: expiry_state cases now guard on v_effective_plan <> 'free'.
-- A free subscription (plan='free', expires_at=NULL) must always
-- return expiry_state='none', never 'expiring_*'.

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

  -- Days remaining (UTC) — only meaningful for non-free paid plans
  if v_sub.expires_at is not null
     and v_sub.expires_at > v_now
     and v_effective_plan <> 'free' then
    v_days_remaining := ceil(
      extract(epoch from (v_sub.expires_at - v_now)) / 86400
    )::integer;
  else
    v_days_remaining := 0;
  end if;

  v_expires_soon := (
    v_effective_plan <> 'free'
    and v_sub.expires_at is not null
    and v_sub.expires_at > v_now
    and v_sub.expires_at <= v_now + interval '7 days'
  );

  -- Expiry state — CRITICAL: free plan always returns 'none'.
  -- Without this guard, free users with expires_at=NULL get
  -- days_remaining=0 → 'expiring_1d' → renewal popup fires on signup.
  v_expiry_state := case
    when v_effective_plan = 'free'                            then 'none'
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

comment on function public.resolve_user_plan(uuid) is
  'Resolves effective plan + expiry state. Free plan always returns expiry_state=none '
  'to prevent renewal popup from firing on new signups.';


-- ── 2. FIX initialize_user_account — record referral conversion ──
-- Previously: stored referred_by_code in profiles + incremented clicks
-- but NEVER inserted into affiliate_conversions.
-- Fix: after profile upsert, insert conversion row if referral is new.

create or replace function public.initialize_user_account(p_referred_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id               uuid := auth.uid();
  v_email                 text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
  v_display_name          text := nullif(
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name',
      auth.jwt() ->> 'email'
    ), ''
  );
  v_referral_code         text;
  v_existing_referral_code text;
  v_existing_referred_by  text;
  v_clean_referred_by     text := nullif(upper(trim(coalesce(p_referred_by, ''))), '');
  v_affiliate_user_id     uuid;
  v_commission_rate       numeric;
  v_existing_conversion   uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized', 'code', 'AUTH_REQUIRED');
  end if;

  -- Get existing profile state
  select referral_code, referred_by_code
  into v_existing_referral_code, v_existing_referred_by
  from public.profiles
  where user_id = v_user_id;

  v_referral_code := coalesce(v_existing_referral_code, public.generate_referral_code());

  -- Prevent self-referral
  if v_clean_referred_by = upper(v_referral_code) then
    v_clean_referred_by := null;
  end if;

  -- Upsert profile
  insert into public.profiles (
    user_id, email, display_name, full_name,
    referral_code, referred_by_code,
    subscription_tier, current_plan
  )
  values (
    v_user_id, v_email, v_display_name, v_display_name,
    upper(v_referral_code), v_clean_referred_by,
    'free', 'free'
  )
  on conflict (user_id) do update set
    email        = coalesce(public.profiles.email,        excluded.email),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name    = coalesce(public.profiles.full_name,    excluded.full_name),
    referral_code    = coalesce(public.profiles.referral_code,    excluded.referral_code),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at   = now();

  -- Ensure affiliate profile exists
  perform public.ensure_affiliate_profile();

  -- ── Referral attribution ──────────────────────────────────
  -- Only process if this is a new referral (not already attributed)
  if v_existing_referred_by is null and v_clean_referred_by is not null then

    -- Find the affiliate who owns this referral code
    select user_id into v_affiliate_user_id
    from public.affiliate_profiles
    where upper(referral_code) = v_clean_referred_by
      and user_id <> v_user_id
    limit 1;

    if v_affiliate_user_id is not null then

      -- Increment click counter
      update public.affiliate_profiles
         set total_clicks = coalesce(total_clicks, 0) + 1,
             updated_at   = now()
       where user_id = v_affiliate_user_id;

      -- Check for duplicate conversion (idempotency)
      select id into v_existing_conversion
      from public.affiliate_conversions
      where affiliate_user_id = v_affiliate_user_id
        and referred_user_id  = v_user_id
      limit 1;

      if v_existing_conversion is null then
        -- Read live commission rate
        select coalesce(affiliate_commission_percent, 30) / 100.0
          into v_commission_rate
          from public.platform_settings
         order by updated_at desc
         limit 1;

        v_commission_rate := coalesce(v_commission_rate, 0.30);

        -- Insert conversion record
        insert into public.affiliate_conversions (
          affiliate_user_id, referred_user_id,
          plan_code, billed_amount,
          commission_rate, commission_amount,
          referral_code
        )
        values (
          v_affiliate_user_id, v_user_id,
          'signup', 0,
          v_commission_rate, 0,
          v_clean_referred_by
        )
        on conflict do nothing;

        -- Update affiliate profile totals
        update public.affiliate_profiles
           set total_conversions = coalesce(total_conversions, 0) + 1,
               updated_at        = now()
         where user_id = v_affiliate_user_id;

      end if;
    end if;
  end if;

  -- Ensure free subscription row exists
  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  -- Ensure onboarding state exists
  insert into public.onboarding_states (user_id, step_key, completed)
  values (v_user_id, 'account_created', false)
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', sqlstate);
end;
$$;

-- Keep the no-arg overload for schema cache fallback
create or replace function public.initialize_user_account()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.initialize_user_account(null);
$$;

grant execute on function public.initialize_user_account(text) to authenticated, anon;
grant execute on function public.initialize_user_account()     to authenticated, anon;

comment on function public.initialize_user_account(text) is
  'Creates/updates user profile on signup. Records referral conversion in '
  'affiliate_conversions if a valid referred_by_code is provided. '
  'Idempotent — safe to call multiple times.';

