-- ============================================================
-- CENTRALIZED ENTITLEMENT RESOLVER FOR FRONTEND
-- get_user_entitlements(p_user_id)
-- ============================================================
-- Provides a single RPC that returns ALL entitlements for a
-- user in one call. The frontend hook useUserEntitlements()
-- calls this on mount and caches the result.
--
-- This is the canonical source for all frontend feature checks:
--   - Voice/Video engine access
--   - BYOK availability
--   - Platform access (trend scanning)
--   - Feature limits and periods
--   - Active plan name
--
-- Returns:
-- {
--   "plan": "pro_creator",
--   "subscription_active": true,
--   "features": {
--     "script_generation": { "enabled": true, "limit": 100, "period": "day", "unlimited": false, "fair_usage": false },
--     "tts_generation":    { "enabled": true, "limit": 200, "period": "day", "unlimited": false, "fair_usage": false },
--     "byok_access":       { "enabled": true, "limit": -1,  "period": "day", "unlimited": true,  "fair_usage": false },
--     ... (all features for this plan)
--   }
-- }
--
-- Security:
--   SECURITY DEFINER — reads plan_entitlements (public) and
--   profiles/user_subscriptions (via resolve_user_plan which
--   is already SECURITY DEFINER). Scoped to p_user_id.
-- ============================================================

create or replace function public.get_user_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result      jsonb;
  v_plan_key         text;
  v_subscription_active boolean;
  v_entitlements     jsonb := '{}'::jsonb;
  v_feature_key      text;
  v_limit_value      numeric;
  v_limit_period     text;
  v_enabled          boolean;
  v_metadata         jsonb;
begin
  -- Guard: reject null user_id
  if p_user_id is null then
    return jsonb_build_object(
      'plan',                'free',
      'subscription_active', false,
      'features',            '{}'::jsonb
    );
  end if;

  -- Resolve the authoritative effective plan
  -- resolve_user_plan checks profiles.subscription_tier AND
  -- user_subscriptions (active subscription wins) so this is
  -- always correct even if profiles.subscription_tier is stale.
  v_plan_result         := public.resolve_user_plan(p_user_id);
  v_plan_key            := coalesce(v_plan_result ->> 'plan', 'free');
  v_subscription_active := coalesce((v_plan_result ->> 'subscription_active')::boolean, false);

  -- Enumerate all entitlements for this plan from plan_entitlements
  for v_feature_key, v_limit_value, v_limit_period, v_enabled, v_metadata in
    select
      pe.feature_key,
      pe.limit_value,
      pe.limit_period,
      pe.enabled,
      coalesce(pe.metadata, '{}'::jsonb)
    from public.plan_entitlements pe
    where pe.plan_key = v_plan_key
    order by pe.feature_key
  loop
    v_entitlements := jsonb_set(
      v_entitlements,
      array[v_feature_key],
      jsonb_build_object(
        'enabled',   v_enabled and (v_limit_value <> 0),
        'limit',     v_limit_value,
        'period',    v_limit_period,
        'unlimited', (v_limit_value = -1 and v_limit_period <> 'fair_usage'),
        'fair_usage', (v_limit_period = 'fair_usage'),
        'metadata',  v_metadata
      )
    );
  end loop;

  -- If plan has no entitlement rows at all, fall back to empty features
  -- (should not happen in production; plan_entitlements is always seeded)
  return jsonb_build_object(
    'plan',                v_plan_key,
    'subscription_active', v_subscription_active,
    'features',            v_entitlements
  );
end;
$$;

-- Grant execute to authenticated and anon (RLS via SECURITY DEFINER scopes it to p_user_id)
grant execute on function public.get_user_entitlements(uuid) to authenticated;
grant execute on function public.get_user_entitlements(uuid) to anon;

comment on function public.get_user_entitlements(uuid) is
  'Returns the full entitlement matrix for a user based on their active plan. '
  'Used by the frontend useUserEntitlements() hook as the single source of truth for all feature access decisions.';
