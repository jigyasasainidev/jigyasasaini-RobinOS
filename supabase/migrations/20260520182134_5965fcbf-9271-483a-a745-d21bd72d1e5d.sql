-- 1) Subscriptions
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'creator',
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_subscriptions' AND policyname = 'Users can view own subscriptions'
  ) THEN
    CREATE POLICY "Users can view own subscriptions"
      ON public.user_subscriptions
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_subscriptions' AND policyname = 'Admins can manage subscriptions'
  ) THEN
    CREATE POLICY "Admins can manage subscriptions"
      ON public.user_subscriptions
      FOR ALL
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 2) Withdrawal requests
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payout_method text NOT NULL DEFAULT 'paypal',
  payout_details text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz
);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'withdrawal_requests' AND policyname = 'Users can view own withdrawal requests'
  ) THEN
    CREATE POLICY "Users can view own withdrawal requests"
      ON public.withdrawal_requests
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'withdrawal_requests' AND policyname = 'Users can create own withdrawal requests'
  ) THEN
    CREATE POLICY "Users can create own withdrawal requests"
      ON public.withdrawal_requests
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'withdrawal_requests' AND policyname = 'Admins can manage withdrawal requests'
  ) THEN
    CREATE POLICY "Admins can manage withdrawal requests"
      ON public.withdrawal_requests
      FOR ALL
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 3) Affiliate profiles
CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  user_id uuid PRIMARY KEY,
  referral_code text NOT NULL,
  total_clicks integer NOT NULL DEFAULT 0,
  total_conversions integer NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  pending_balance numeric NOT NULL DEFAULT 0,
  paid_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referral_code)
);

ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_profiles' AND policyname = 'Users can view own affiliate profile'
  ) THEN
    CREATE POLICY "Users can view own affiliate profile"
      ON public.affiliate_profiles
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_profiles' AND policyname = 'Users can insert own affiliate profile'
  ) THEN
    CREATE POLICY "Users can insert own affiliate profile"
      ON public.affiliate_profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_profiles' AND policyname = 'Users can update own affiliate profile'
  ) THEN
    CREATE POLICY "Users can update own affiliate profile"
      ON public.affiliate_profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_profiles' AND policyname = 'Admins can manage affiliate profiles'
  ) THEN
    CREATE POLICY "Admins can manage affiliate profiles"
      ON public.affiliate_profiles
      FOR ALL
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 4) Affiliate commissions
CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL,
  referred_user_id uuid,
  subscription_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_commissions' AND policyname = 'Users can view own affiliate commissions'
  ) THEN
    CREATE POLICY "Users can view own affiliate commissions"
      ON public.affiliate_commissions
      FOR SELECT
      TO authenticated
      USING (auth.uid() = affiliate_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_commissions' AND policyname = 'Admins can manage affiliate commissions'
  ) THEN
    CREATE POLICY "Admins can manage affiliate commissions"
      ON public.affiliate_commissions
      FOR ALL
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 5) AI generations
CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generation_type text NOT NULL DEFAULT 'script',
  credits_used integer NOT NULL DEFAULT 0,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_generations' AND policyname = 'Users can view own ai generations'
  ) THEN
    CREATE POLICY "Users can view own ai generations"
      ON public.ai_generations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_generations' AND policyname = 'Users can create own ai generations'
  ) THEN
    CREATE POLICY "Users can create own ai generations"
      ON public.ai_generations
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_generations' AND policyname = 'Admins can view all ai generations'
  ) THEN
    CREATE POLICY "Admins can view all ai generations"
      ON public.ai_generations
      FOR SELECT
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 6) Feature usage
CREATE TABLE IF NOT EXISTS public.feature_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature_name text NOT NULL,
  usage_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feature_usage' AND policyname = 'Users can view own feature usage'
  ) THEN
    CREATE POLICY "Users can view own feature usage"
      ON public.feature_usage
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feature_usage' AND policyname = 'Users can create own feature usage'
  ) THEN
    CREATE POLICY "Users can create own feature usage"
      ON public.feature_usage
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feature_usage' AND policyname = 'Admins can view all feature usage'
  ) THEN
    CREATE POLICY "Admins can view all feature usage"
      ON public.feature_usage
      FOR SELECT
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 7) Platform settings
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_price numeric NOT NULL DEFAULT 19,
  pro_price numeric NOT NULL DEFAULT 39,
  agency_price numeric NOT NULL DEFAULT 99,
  free_scripts_limit integer NOT NULL DEFAULT 3,
  free_scans_limit integer NOT NULL DEFAULT 20,
  affiliate_commission_percent numeric NOT NULL DEFAULT 30,
  minimum_withdrawal numeric NOT NULL DEFAULT 25,
  payout_delay_days integer NOT NULL DEFAULT 7,
  maintenance_mode boolean NOT NULL DEFAULT false,
  announcement_banner text,
  support_email text,
  platform_domain text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_settings' AND policyname = 'Authenticated can read platform settings'
  ) THEN
    CREATE POLICY "Authenticated can read platform settings"
      ON public.platform_settings
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_settings' AND policyname = 'Admins can manage platform settings'
  ) THEN
    CREATE POLICY "Admins can manage platform settings"
      ON public.platform_settings
      FOR ALL
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 8) Admin-safe profiles view for dashboard
DROP VIEW IF EXISTS public.admin_profiles_view;
CREATE VIEW public.admin_profiles_view
WITH (security_invoker = on) AS
SELECT
  p.user_id,
  p.email,
  NULL::text AS avatar_url,
  p.full_name,
  p.current_plan,
  (public.get_admin_role(p.user_id) IS NOT NULL) AS is_admin,
  p.is_suspended,
  false::boolean AS affiliate_enabled,
  p.scripts_used_this_month::integer AS total_scripts_generated,
  p.free_scans_used::integer AS total_trend_scans,
  p.created_at,
  p.updated_at
FROM public.profiles p;

-- allow admin users to read all profiles so admin_profiles_view can return full admin dataset
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can view all profiles'
  ) THEN
    CREATE POLICY "Admins can view all profiles"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;

-- 9) Admin withdrawal processor function expected by dashboard
CREATE OR REPLACE FUNCTION public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support');
BEGIN
  IF auth.uid() IS NULL OR NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  UPDATE public.withdrawal_requests
  SET
    status = lower(p_status),
    admin_note = p_admin_note,
    updated_at = now(),
    approved_at = CASE WHEN lower(p_status) = 'approved' THEN now() ELSE approved_at END,
    completed_at = CASE WHEN lower(p_status) IN ('paid', 'completed') THEN now() ELSE completed_at END,
    rejected_at = CASE WHEN lower(p_status) = 'rejected' THEN now() ELSE rejected_at END
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal_request(uuid, text, text) TO authenticated;