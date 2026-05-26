-- ============================================================
-- MIGRATION 39 — Fix affiliate_conversions schema
-- ============================================================
-- Adds missing columns that initialize_user_account() and
-- recordAffiliateCommission() try to insert into.
-- ADDITIVE ONLY — no existing data modified.
-- ============================================================

alter table public.affiliate_conversions
  add column if not exists plan_code        text    not null default 'signup',
  add column if not exists billed_amount    numeric not null default 0,
  add column if not exists commission_rate  numeric not null default 0,
  add column if not exists commission_amount numeric not null default 0,
  add column if not exists referral_code   text,
  add column if not exists status          text    not null default 'pending',
  add column if not exists updated_at      timestamptz not null default now();

comment on column public.affiliate_conversions.plan_code is
  'signup | creator | pro_creator | agency';
comment on column public.affiliate_conversions.billed_amount is
  'Payment amount that triggered this commission (0 for signup conversions)';
comment on column public.affiliate_conversions.commission_rate is
  'Rate at time of conversion (e.g. 0.30 for 30%)';
comment on column public.affiliate_conversions.commission_amount is
  'Calculated commission amount (billed_amount × commission_rate)';
comment on column public.affiliate_conversions.referral_code is
  'The referral code used — denormalized for fast lookup';
comment on column public.affiliate_conversions.status is
  'pending | approved | paid | reversed | cancelled';

-- Drop the old unique constraint that only covers 3 columns
-- (it would block multiple conversions for same affiliate+user on different plans)
alter table public.affiliate_conversions
  drop constraint if exists affiliate_conversions_affiliate_user_id_referred_user_id_sub_key;

-- New unique constraint: one conversion per (affiliate, referred_user, plan_code)
-- Allows signup conversion + paid plan conversion for same user
alter table public.affiliate_conversions
  drop constraint if exists uq_affiliate_conversions_affiliate_referred_plan;

alter table public.affiliate_conversions
  add constraint uq_affiliate_conversions_affiliate_referred_plan
    unique (affiliate_user_id, referred_user_id, plan_code);

-- Index for fast lookup by referral_code
create index if not exists idx_affiliate_conversions_referral_code
  on public.affiliate_conversions (referral_code)
  where referral_code is not null;

-- Updated_at trigger
drop trigger if exists trg_affiliate_conversions_updated_at on public.affiliate_conversions;
create trigger trg_affiliate_conversions_updated_at
  before update on public.affiliate_conversions
  for each row execute function public.set_updated_at();

-- ── Re-create initialize_user_account with correct conflict target ─
-- The old version used ON CONFLICT DO NOTHING which hits the wrong
-- unique constraint. Now we use the new (affiliate_user_id, referred_user_id, plan_code).

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

      -- Read live commission rate
      select coalesce(affiliate_commission_percent, 30) / 100.0
        into v_commission_rate
        from public.platform_settings
       order by updated_at desc
       limit 1;

      v_commission_rate := coalesce(v_commission_rate, 0.30);

      -- Insert signup conversion (idempotent via new unique constraint)
      insert into public.affiliate_conversions (
        affiliate_user_id, referred_user_id,
        plan_code, billed_amount,
        commission_rate, commission_amount,
        referral_code, status
      )
      values (
        v_affiliate_user_id, v_user_id,
        'signup', 0,
        v_commission_rate, 0,
        v_clean_referred_by, 'pending'
      )
      on conflict (affiliate_user_id, referred_user_id, plan_code) do nothing;

      -- Update affiliate profile totals
      update public.affiliate_profiles
         set total_conversions = coalesce(total_conversions, 0) + 1,
             updated_at        = now()
       where user_id = v_affiliate_user_id;

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
