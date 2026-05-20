CREATE TYPE public.admin_role AS ENUM ('super_admin', 'admin', 'support');

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.admin_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'Users can view own roles'
  ) THEN
    CREATE POLICY "Users can view own roles"
    ON public.user_roles
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_admin_role(user_uuid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF user_uuid IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;

  SELECT ur.role::text
  INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = user_uuid
  ORDER BY CASE ur.role
    WHEN 'super_admin' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'support' THEN 1
    ELSE 0
  END DESC
  LIMIT 1;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.initialize_user_account()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.initialize_user_account(NULL);
$$;

REVOKE ALL ON FUNCTION public.initialize_user_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.initialize_user_account() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_usage_status(p_feature_name text DEFAULT 'scripts')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
        ELSE 3
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
$$;

REVOKE ALL ON FUNCTION public.get_usage_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_usage_status(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_usage_status(text) TO authenticated;