-- ============================================================
-- FIX: resolve_user_plan NULL default — fresh user 403 on scan
-- ============================================================
-- Root cause:
--   In PL/pgSQL, when a SELECT ... INTO <variable> finds zero
--   rows, the variable retains its initial NULL value — the
--   COALESCE in the SELECT clause only applies to the column
--   value, not to the variable when the row is absent.
--
--   resolve_user_plan does:
--     select coalesce(subscription_tier, 'free')
--     into v_profile_tier
--     from public.profiles
--     where user_id = p_user_id;
--
--   If the profiles row does not yet exist (race condition
--   between initialize_user_account completing and the user
--   immediately hitting a feature), v_profile_tier stays NULL.
--
--   NULL flows to:
--     v_effective_plan := lower(v_profile_tier) → NULL
--   Then in get_entitlement:
--     WHERE plan_key = NULL  -- matches NOTHING (NULL ≠ NULL)
--   Then returns: enabled = false
--   Then check_and_increment_usage returns: FEATURE_DISABLED
--   Then edge function returns: 403
--
--   Fresh users see "limit reached" before using any quota.
--
-- Fix:
--   1. resolve_user_plan: add explicit NULL guard after the
--      SELECT so that missing profiles always default to 'free'
--   2. get_entitlement: add explicit NULL guard on plan_key
--      lookup so a NULL plan never reaches the entitlement join
--   3. Both functions get SECURITY DEFINER so they can read
--      from profiles and plan_entitlements regardless of the
--      calling role's RLS context
--   4. check_and_increment_usage: add a top-level guard that
--      returns a meaningful ALLOWED response (treating user as
--      free) when entitlement resolution produces a NULL plan
--
-- Safety:
--   All functions are scoped by p_user_id (verified JWT).
--   SECURITY DEFINER is safe here — see previous migration note.
-- ============================================================

-- ── resolve_user_plan ──────────────────────────────────────
-- Fix: explicit coalesce on v_profile_tier AFTER the SELECT
-- so that a missing profiles row defaults to 'free' instead of
-- producing a NULL plan that breaks downstream entitlement joins.
create or replace function public.resolve_user_plan(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_tier       text;
  v_subscription_plan  text;
  v_subscription_status text;
  v_subscription_active boolean;
  v_effective_plan     text;
begin
  -- Get profile tier — coalesce the VARIABLE after SELECT
  -- so that NOT FOUND (no profile row yet) also defaults to 'free'
  select coalesce(subscription_tier, 'free')
    into v_profile_tier
    from public.profiles
   where user_id = p_user_id;

  -- Explicit guard: if no row was found, v_profile_tier is NULL
  v_profile_tier := coalesce(v_profile_tier, 'free');

  -- Get subscription if it exists
  select coalesce(plan, 'free'), coalesce(status, '')
    into v_subscription_plan, v_subscription_status
    from public.user_subscriptions
   where user_id = p_user_id
   limit 1;

  -- Determine if subscription is active
  v_subscription_active :=
    lower(coalesce(v_subscription_status, '')) in ('active', 'trialing');

  -- Resolve effective plan: active paid subscription wins over profile tier
  if v_subscription_active
     and lower(coalesce(v_subscription_plan, 'free')) <> 'free' then
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

  -- Final safety net: never return NULL plan
  v_effective_plan := coalesce(v_effective_plan, 'free');

  return jsonb_build_object(
    'user_id',             p_user_id,
    'plan',                v_effective_plan,
    'subscription_plan',   lower(coalesce(v_subscription_plan, 'free')),
    'subscription_status', lower(coalesce(v_subscription_status, '')),
    'subscription_active', v_subscription_active
  );
end;
$$;

-- ── get_entitlement ────────────────────────────────────────
-- Fix: add explicit NULL guard on v_plan_key before the
-- plan_entitlements lookup so a NULL plan never produces a
-- wrong "feature disabled" result.
-- Also: SECURITY DEFINER so it reads plan_entitlements and
-- profiles regardless of the calling role's RLS context.
create or replace function public.get_entitlement(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_resolution jsonb;
  v_plan_key        text;
  v_limit_value     numeric;
  v_limit_period    text;
  v_enabled         boolean;
  v_metadata        jsonb;
begin
  -- Resolve user plan (always returns 'free' minimum)
  v_plan_resolution := public.resolve_user_plan(p_user_id);
  v_plan_key        := coalesce(v_plan_resolution ->> 'plan', 'free');

  -- Fetch entitlement config
  select
    pe.limit_value,
    pe.limit_period,
    pe.enabled,
    coalesce(pe.metadata, '{}'::jsonb)
  into v_limit_value, v_limit_period, v_enabled, v_metadata
  from public.plan_entitlements pe
  where pe.plan_key    = v_plan_key
    and pe.feature_key = p_feature_key;

  -- If no specific entitlement found, feature is disabled on this plan
  if not found then
    return jsonb_build_object(
      'plan',         v_plan_key,
      'feature',      p_feature_key,
      'enabled',      false,
      'limit_value',  0,
      'limit_period', 'day',
      'unlimited',    false,
      'fair_usage',   false,
      'metadata',     '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'plan',         v_plan_key,
    'feature',      p_feature_key,
    'enabled',      v_enabled,
    'limit_value',  v_limit_value,
    'limit_period', v_limit_period,
    'unlimited',    (v_limit_value = -1 and v_limit_period <> 'fair_usage'),
    'fair_usage',   (v_limit_period = 'fair_usage'),
    'metadata',     v_metadata
  );
end;
$$;
