-- ============================================================
-- ROBINOS: Fix remaining 500 on PATCH /profiles during sign-in
-- ============================================================
-- Root Cause:
--   initialize_user_account() (called during every Google OAuth sign-in)
--   runs as SECURITY INVOKER (default). It does INSERT ... ON CONFLICT
--   DO UPDATE SET on public.profiles. When the ON CONFLICT triggers the
--   UPDATE path, RLS evaluates ALL applicable policies, including
--   "Admins can update all profiles" which calls get_admin_role().
--   Even though get_admin_role() is now SECURITY DEFINER (from the
--   previous migration), the nested RLS evaluation within a SECURITY INVOKER
--   function can still produce 500 errors via PostgREST/RPC.
--
-- Fix:
--   Mark initialize_user_account() and ensure_affiliate_profile() as
--   SECURITY DEFINER. Both functions already:
--     1. Validate auth.uid() is non-null before any operation
--     2. Only operate on the authenticated user's own data
--     3. Use auth.jwt() for email (which is immutable per request)
--   This allows the profile insert/update pipeline to bypass RLS
--   entirely during sign-in, while maintaining all security constraints.
-- ============================================================

-- ============================================================
-- FIX 1: Make initialize_user_account() SECURITY DEFINER
-- ============================================================
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

-- ============================================================
-- FIX 2: Make ensure_affiliate_profile() SECURITY DEFINER
-- (Called by initialize_user_account() and directly by other
--  functions. Needs definer rights to update profiles/affiliate
--  tables without hitting RLS.)
-- ============================================================
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