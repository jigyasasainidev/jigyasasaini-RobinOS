CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS TABLE (
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
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
  FROM public.platform_settings ps
  ORDER BY ps.updated_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_platform_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_usage_status(p_feature_name text DEFAULT 'scripts'::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_tier text := 'free';
  v_used integer := 0;
  v_quota integer := 0;
  v_remaining integer := 0;
  v_allowed boolean := true;
  v_near_limit boolean := false;
  v_fair_usage boolean := false;
  v_byok_enabled boolean := false;
  v_feature text := COALESCE(NULLIF(trim(lower(p_feature_name)), ''), 'scripts');
  v_free_scripts_limit integer := 3;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'used', 0,
      'quota', 0,
      'remaining', 0,
      'allowed', false,
      'near_limit', false,
      'fair_usage', false,
      'byok_enabled', false,
      'message', 'Authentication required'
    );
  END IF;

  SELECT COALESCE(subscription_tier, 'free'), COALESCE(scripts_used_this_month, 0)
  INTO v_tier, v_used
  FROM public.profiles
  WHERE user_id = v_user_id;

  SELECT COALESCE(ps.free_scripts_limit, 3)
  INTO v_free_scripts_limit
  FROM public.platform_settings ps
  ORDER BY ps.updated_at DESC
  LIMIT 1;

  IF v_tier IN ('agency', 'scale_agency') THEN
    v_fair_usage := true;
    v_quota := 0;
    v_remaining := 0;
    v_allowed := true;
  ELSE
    IF v_feature = 'captions' THEN
      v_quota := CASE v_tier
        WHEN 'pro_creator' THEN 200
        WHEN 'creator' THEN 50
        ELSE 20
      END;
    ELSE
      v_quota := CASE v_tier
        WHEN 'pro_creator' THEN 100
        WHEN 'creator' THEN 20
        ELSE GREATEST(v_free_scripts_limit, 0)
      END;
    END IF;

    v_remaining := GREATEST(v_quota - v_used, 0);
    v_allowed := v_remaining > 0;
    v_near_limit := v_quota > 0 AND v_used >= CEIL(v_quota * 0.8);
  END IF;

  v_byok_enabled := v_tier IN ('pro_creator', 'agency', 'scale_agency');

  RETURN jsonb_build_object(
    'used', v_used,
    'quota', CASE WHEN v_fair_usage THEN NULL ELSE v_quota END,
    'remaining', CASE WHEN v_fair_usage THEN 999999 ELSE v_remaining END,
    'allowed', v_allowed,
    'near_limit', v_near_limit,
    'fair_usage', v_fair_usage,
    'byok_enabled', v_byok_enabled,
    'message', CASE
      WHEN v_fair_usage THEN 'Unlimited (fair usage)'
      WHEN v_allowed THEN 'Usage available'
      ELSE 'Limit reached'
    END
  );
END;
$function$;