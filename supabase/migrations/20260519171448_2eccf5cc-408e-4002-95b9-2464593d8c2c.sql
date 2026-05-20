-- 1) Extend profiles with operational columns (without storing roles in profiles)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS current_plan text DEFAULT 'creator',
  ADD COLUMN IF NOT EXISTS is_suspended boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS affiliate_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_scripts_generated integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_trend_scans integer DEFAULT 0;

-- 2) Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'creator',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'trialing',
  renewal_date timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'Admins manage subscriptions'
  ) THEN
    CREATE POLICY "Admins manage subscriptions"
    ON public.subscriptions
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'Users read own subscriptions'
  ) THEN
    CREATE POLICY "Users read own subscriptions"
    ON public.subscriptions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3) Affiliate referrals
CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL,
  referred_user_id uuid,
  converted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_referrals' AND policyname = 'Admins manage affiliate referrals'
  ) THEN
    CREATE POLICY "Admins manage affiliate referrals"
    ON public.affiliate_referrals
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_referrals' AND policyname = 'Users read own affiliate referrals'
  ) THEN
    CREATE POLICY "Users read own affiliate referrals"
    ON public.affiliate_referrals
    FOR SELECT
    TO authenticated
    USING (auth.uid() = affiliate_user_id OR auth.uid() = referred_user_id);
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
    WHERE schemaname = 'public' AND tablename = 'affiliate_commissions' AND policyname = 'Admins manage affiliate commissions'
  ) THEN
    CREATE POLICY "Admins manage affiliate commissions"
    ON public.affiliate_commissions
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_commissions' AND policyname = 'Users read own affiliate commissions'
  ) THEN
    CREATE POLICY "Users read own affiliate commissions"
    ON public.affiliate_commissions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = affiliate_user_id OR auth.uid() = referred_user_id);
  END IF;
END $$;

-- 5) Usage tracking
CREATE TABLE IF NOT EXISTS public.usage_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scripts_generated integer NOT NULL DEFAULT 0,
  trend_scans integer NOT NULL DEFAULT 0,
  voice_generations integer NOT NULL DEFAULT 0,
  video_generations integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usage_tracking' AND policyname = 'Admins manage usage tracking'
  ) THEN
    CREATE POLICY "Admins manage usage tracking"
    ON public.usage_tracking
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usage_tracking' AND policyname = 'Users read own usage tracking'
  ) THEN
    CREATE POLICY "Users read own usage tracking"
    ON public.usage_tracking
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 6) Platform settings
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_price numeric NOT NULL DEFAULT 19,
  pro_price numeric NOT NULL DEFAULT 39,
  agency_price numeric NOT NULL DEFAULT 99,
  free_scripts_limit integer NOT NULL DEFAULT 5,
  free_scans_limit integer NOT NULL DEFAULT 3,
  affiliate_commission_percent numeric NOT NULL DEFAULT 30,
  minimum_withdrawal numeric NOT NULL DEFAULT 25,
  payout_delay_days integer NOT NULL DEFAULT 7,
  maintenance_mode boolean NOT NULL DEFAULT false,
  announcement_banner text,
  support_email text,
  platform_domain text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_settings' AND policyname = 'Admins manage platform settings'
  ) THEN
    CREATE POLICY "Admins manage platform settings"
    ON public.platform_settings
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_settings' AND policyname = 'Authenticated read platform settings'
  ) THEN
    CREATE POLICY "Authenticated read platform settings"
    ON public.platform_settings
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END $$;

-- 7) Activity logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action_type text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'Admins read activity logs'
  ) THEN
    CREATE POLICY "Admins read activity logs"
    ON public.activity_logs
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 8) AI generations
CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generation_type text NOT NULL,
  credits_used integer NOT NULL DEFAULT 0,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_generations' AND policyname = 'Admins read ai generations'
  ) THEN
    CREATE POLICY "Admins read ai generations"
    ON public.ai_generations
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_generations' AND policyname = 'Users read own ai generations'
  ) THEN
    CREATE POLICY "Users read own ai generations"
    ON public.ai_generations
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 9) Feature usage
CREATE TABLE IF NOT EXISTS public.feature_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature_name text NOT NULL,
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feature_usage' AND policyname = 'Admins read feature usage'
  ) THEN
    CREATE POLICY "Admins read feature usage"
    ON public.feature_usage
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feature_usage' AND policyname = 'Users read own feature usage'
  ) THEN
    CREATE POLICY "Users read own feature usage"
    ON public.feature_usage
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 10) Admin logs
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action_type text NOT NULL,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_logs' AND policyname = 'Admins manage admin logs'
  ) THEN
    CREATE POLICY "Admins manage admin logs"
    ON public.admin_logs
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 11) Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON public.subscriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON public.payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate_status ON public.affiliate_commissions(affiliate_user_id, status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created_at ON public.withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_type_created_at ON public.ai_generations(generation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_feature_created_at ON public.feature_usage(feature_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at DESC);

-- 12) Updated-at triggers
DROP TRIGGER IF EXISTS trg_subscriptions_touch_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_touch_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_commissions_touch_updated_at ON public.affiliate_commissions;
CREATE TRIGGER trg_affiliate_commissions_touch_updated_at
BEFORE UPDATE ON public.affiliate_commissions
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_usage_tracking_touch_updated_at ON public.usage_tracking;
CREATE TRIGGER trg_usage_tracking_touch_updated_at
BEFORE UPDATE ON public.usage_tracking
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_platform_settings_touch_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_touch_updated_at
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- 13) Seed platform settings row
INSERT INTO public.platform_settings (
  creator_price,
  pro_price,
  agency_price,
  free_scripts_limit,
  free_scans_limit,
  affiliate_commission_percent,
  minimum_withdrawal,
  payout_delay_days,
  maintenance_mode,
  announcement_banner,
  support_email,
  platform_domain
)
SELECT 19, 39, 99, 5, 3, 30, 25, 7, false, null, null, null
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings);

-- 14) Admin-safe aggregation view
CREATE OR REPLACE VIEW public.admin_profiles_view
WITH (security_invoker = on)
AS
SELECT
  p.user_id,
  COALESCE(p.email, us.email) AS email,
  p.avatar_url,
  COALESCE(p.full_name, p.display_name, us.full_name) AS full_name,
  COALESCE(p.current_plan, us.plan::text, 'creator') AS current_plan,
  public.has_role(p.user_id, 'admin') AS is_admin,
  COALESCE(p.is_suspended, us.status = 'suspended') AS is_suspended,
  COALESCE(p.affiliate_enabled, us.is_affiliate, false) AS affiliate_enabled,
  COALESCE(p.total_scripts_generated, 0) + COALESCE(us.prompt_count, 0) AS total_scripts_generated,
  COALESCE(p.total_trend_scans, 0) + COALESCE(p.trending_scans_used, 0) AS total_trend_scans,
  p.created_at,
  p.updated_at
FROM public.profiles p
LEFT JOIN public.user_subscriptions us ON us.user_id = p.user_id;

-- 15) Admin log helper
CREATE OR REPLACE FUNCTION public.admin_write_log(
  p_action_type text,
  p_target_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS public.admin_logs
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.admin_logs%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  INSERT INTO public.admin_logs(admin_id, action_type, target_id, details)
  VALUES (v_actor, p_action_type, p_target_id, COALESCE(p_details, '{}'::jsonb))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 16) Withdrawal status transition helper (writes logs + updates affiliate balances)
CREATE OR REPLACE FUNCTION public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_req public.withdrawal_requests%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;
  IF p_status NOT IN ('pending', 'approved', 'paid', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.withdrawal_requests
  SET status = p_status::public.withdrawal_status,
      admin_note = COALESCE(p_admin_note, admin_note),
      approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
      completed_at = CASE WHEN p_status = 'paid' THEN now() ELSE completed_at END,
      rejected_at = CASE WHEN p_status = 'rejected' THEN now() ELSE rejected_at END,
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;

  IF p_status = 'paid' THEN
    UPDATE public.affiliate_profiles
    SET payout_verified = true,
        updated_at = now()
    WHERE user_id = v_req.user_id;
  END IF;

  PERFORM public.admin_write_log(
    'withdrawal_status_update',
    v_req.id::text,
    jsonb_build_object('status', p_status, 'amount', v_req.amount, 'user_id', v_req.user_id)
  );

  RETURN v_req;
END;
$$;

-- 17) Realtime publication additions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'withdrawal_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'affiliate_commissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.affiliate_commissions;
  END IF;
END $$;