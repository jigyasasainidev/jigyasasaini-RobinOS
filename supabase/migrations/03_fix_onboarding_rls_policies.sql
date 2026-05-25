-- RobinOS: Fix onboarding architecture and RLS policies
-- Issue: initialize_user_account() runs with SECURITY INVOKER (default),
--   so it is blocked by RLS when inserting into user_subscriptions
--   because that table has NO insert policy for regular authenticated users.
--
-- Root cause analysis:
--   All onboarding tables had INSERT policies EXCEPT user_subscriptions.
--   The function initialize_user_account() was also not SECURITY DEFINER,
--   meaning it inherited the caller's RLS restrictions instead of bypassing them.
--
-- Fix:
--   1. Make initialize_user_account() SECURITY DEFINER to bypass RLS during onboarding
--      (it already validates auth.uid() is non-null, so this is safe)
--   2. Add user-scoped INSERT policy on user_subscriptions for direct client access
--
-- Security: 
--   - SECURITY DEFINER is safe here because the function validates auth.uid() first
--   - The INSERT policy only allows rows where user_id = auth.uid()
--   - No global public write access is introduced
--   - Referral system remains optional (null referral is handled gracefully)

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

-- Drop the old overloaded version (no params) that was an invoker-rights wrapper
-- The new function with default param handles both cases
drop function if exists public.initialize_user_account();

-- Recreate the zero-parameter overload as a simple wrapper to maintain API compatibility
create or replace function public.initialize_user_account()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.initialize_user_account(null);
$$;

-- ============================================================
-- FIX 2: Add INSERT policy on user_subscriptions for authenticated users
-- ============================================================

drop policy if exists "Users can insert own subscriptions" on public.user_subscriptions;
create policy "Users can insert own subscriptions"
  on public.user_subscriptions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ============================================================
-- VERIFICATION: Existing policies remain intact
-- ============================================================
-- 
-- profiles:
--   "Users can view own profile"       - select using (auth.uid() = user_id) ✓
--   "Users can update own profile"     - update using (auth.uid() = user_id) ✓
--   "Users can insert own profile"     - insert with check (auth.uid() = user_id) ✓
--   "Admins can view all profiles"     - select for admins ✓
--   "Admins can update all profiles"   - update for admins ✓
--
-- user_subscriptions:
--   "Users can view own subscriptions"       - select using (auth.uid() = user_id) ✓
--   "Admins can manage subscriptions"        - all for admins ✓
--   "Users can insert own subscriptions"      - insert with check (auth.uid() = user_id) NEW ✓
--
-- affiliate_wallets:
--   "Users can view own affiliate wallet"     - select using (auth.uid() = user_id) ✓
--   "Admins can manage affiliate wallets"    - all for admins ✓
--   "Users can insert own affiliate wallet"  - insert with check (auth.uid() = user_id) ✓ (existing fix)
--
-- Security protections preserved:
--   1. No public write access introduced
--   2. auth.uid() = user_id enforcement for all inserts
--   3. Referral system remains optional (null referral code flows normally)
--   4. Free plan initialization: tier=free, status=active, amount=0
--   5. SECURITY DEFINER still validates auth.uid() != null
--   6. Admin-only tables unaffected
--   7. Existing admin policies unchanged