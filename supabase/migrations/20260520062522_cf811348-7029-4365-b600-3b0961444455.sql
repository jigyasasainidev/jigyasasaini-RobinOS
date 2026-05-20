-- === CORE TYPES ===
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_method_type') THEN
    CREATE TYPE public.payout_method_type AS ENUM ('paypal', 'usdt_trc20');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'earning_status') THEN
    CREATE TYPE public.earning_status AS ENUM ('pending', 'available', 'paid');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
    CREATE TYPE public.withdrawal_status AS ENUM ('pending', 'approved', 'paid', 'rejected');
  END IF;
END $$;

-- === BASE TABLES ===
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  avatar_url text,
  full_name text,
  openai_api_key text,
  elevenlabs_api_key text,
  video_api_key text,
  subscription_tier text DEFAULT 'free',
  current_plan text DEFAULT 'free',
  is_suspended boolean NOT NULL DEFAULT false,
  affiliate_enabled boolean NOT NULL DEFAULT false,
  total_scripts_generated integer NOT NULL DEFAULT 0,
  total_trend_scans integer NOT NULL DEFAULT 0,
  referral_code text UNIQUE,
  affiliate_balance numeric(10,2) NOT NULL DEFAULT 0,
  total_earnings numeric(10,2) NOT NULL DEFAULT 0,
  upi_id text,
  scripts_used_this_month integer NOT NULL DEFAULT 0,
  scripts_reset_at timestamptz NOT NULL DEFAULT now(),
  free_scans_used integer NOT NULL DEFAULT 0,
  free_scripts_used integer NOT NULL DEFAULT 0,
  free_trial_started_at timestamptz NOT NULL DEFAULT now(),
  free_trial_expired boolean NOT NULL DEFAULT false,
  trending_scans_used integer NOT NULL DEFAULT 0,
  trending_scans_reset_at timestamptz NOT NULL DEFAULT now(),
  hashtag_scans_used integer NOT NULL DEFAULT 0,
  hashtag_scans_reset_at timestamptz NOT NULL DEFAULT now(),
  country text,
  currency text DEFAULT 'USD',
  subscription_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  niche text NOT NULL,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.script_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic text NOT NULL,
  tone text NOT NULL,
  length text NOT NULL,
  output text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'free',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'trialing',
  renewal_date timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  plan text NOT NULL DEFAULT 'free',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'created',
  currency text DEFAULT 'USD',
  payment_provider text DEFAULT 'stripe',
  invoice_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signup_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  referral_code text NOT NULL UNIQUE,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean NOT NULL DEFAULT false,
  payout_updated_at timestamptz,
  total_clicks integer NOT NULL DEFAULT 0,
  total_conversions integer NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  pending_balance numeric NOT NULL DEFAULT 0,
  paid_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL,
  referred_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL,
  referred_user_id uuid,
  plan_code text,
  billed_amount numeric(12,2) NOT NULL DEFAULT 0,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0.30,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  converted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL,
  conversion_id uuid REFERENCES public.affiliate_conversions(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  status public.earning_status NOT NULL DEFAULT 'pending',
  release_at timestamptz,
  released_at timestamptz,
  paid_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  requester_email text,
  amount numeric(12,2) NOT NULL,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  payout_method public.payout_method_type NOT NULL,
  payout_details text NOT NULL,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz
);

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

CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generation_type text NOT NULL,
  credits_used integer NOT NULL DEFAULT 0,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feature_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature_name text NOT NULL,
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action_type text NOT NULL,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- === INDEXES ===
CREATE INDEX IF NOT EXISTS idx_scan_history_user ON public.scan_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_script_history_user ON public.script_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON public.subscriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON public.payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate_user ON public.affiliate_clicks(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate_user ON public.affiliate_conversions(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_affiliate_user ON public.affiliate_earnings(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate_status ON public.affiliate_commissions(affiliate_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_generations_type_created_at ON public.ai_generations(generation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_feature_created_at ON public.feature_usage(feature_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at DESC);

-- === FUNCTIONS / TRIGGERS ===
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.referral_code := 'VA1-' || substr(md5(random()::text), 1, 8);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_referral_code ON public.profiles;
CREATE TRIGGER set_referral_code
BEFORE INSERT ON public.profiles
FOR EACH ROW
WHEN (NEW.referral_code IS NULL)
EXECUTE FUNCTION public.generate_referral_code();

DROP TRIGGER IF EXISTS trg_subscriptions_touch_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_touch_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_profiles_touch_updated_at ON public.affiliate_profiles;
CREATE TRIGGER trg_affiliate_profiles_touch_updated_at
BEFORE UPDATE ON public.affiliate_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_commissions_touch_updated_at ON public.affiliate_commissions;
CREATE TRIGGER trg_affiliate_commissions_touch_updated_at
BEFORE UPDATE ON public.affiliate_commissions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_withdrawal_requests_touch_updated_at ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_requests_touch_updated_at
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_platform_settings_touch_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_touch_updated_at
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- === AFFILIATE / ADMIN RPCS ===
CREATE OR REPLACE FUNCTION public.ensure_affiliate_profile()
RETURNS public.affiliate_profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_seed text;
  v_candidate text;
  v_try integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_profile FROM public.affiliate_profiles WHERE user_id = v_user_id;
  IF FOUND THEN RETURN v_profile; END IF;

  v_seed := lower(substring(replace(v_user_id::text, '-', '') from 1 for 8));
  v_candidate := 'robin' || v_seed;

  LOOP
    BEGIN
      INSERT INTO public.affiliate_profiles (user_id, referral_code)
      VALUES (v_user_id, v_candidate)
      RETURNING * INTO v_profile;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      v_candidate := 'robin' || v_seed || lpad(v_try::text, 2, '0');
    END;
  END LOOP;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_payout_method(
  p_method public.payout_method_type,
  p_details text
)
RETURNS public.affiliate_profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_clean text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_clean := trim(coalesce(p_details, ''));
  IF length(v_clean) = 0 OR length(v_clean) > 160 THEN
    RAISE EXCEPTION 'Invalid payout details';
  END IF;

  PERFORM public.ensure_affiliate_profile();

  UPDATE public.affiliate_profiles
  SET payout_method = p_method,
      payout_details = v_clean,
      payout_verified = false,
      payout_updated_at = now()
  WHERE user_id = v_user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_amount numeric)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_available numeric(12,2);
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_min_withdrawal numeric(10,2) := 25;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;

  SELECT coalesce(minimum_withdrawal, 25)
  INTO v_min_withdrawal
  FROM public.platform_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF p_amount < v_min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%s', v_min_withdrawal;
  END IF;

  PERFORM public.ensure_affiliate_profile();

  SELECT * INTO v_profile
  FROM public.affiliate_profiles
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Affiliate profile not found'; END IF;
  IF v_profile.payout_method IS NULL OR coalesce(v_profile.payout_details, '') = '' THEN
    RAISE EXCEPTION 'Add payout method first';
  END IF;

  SELECT
    coalesce(sum(case when ae.status = 'available' then ae.amount else 0 end), 0) -
    coalesce((
      SELECT sum(wr.amount + wr.fee_amount)
      FROM public.withdrawal_requests wr
      WHERE wr.user_id = v_user_id AND wr.status IN ('pending','approved','paid')
    ), 0)
  INTO v_available
  FROM public.affiliate_earnings ae
  WHERE ae.affiliate_user_id = v_user_id;

  IF p_amount > greatest(v_available, 0) THEN
    RAISE EXCEPTION 'Amount exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests (
    user_id, requester_email, amount, payout_method, payout_details, status
  )
  VALUES (
    v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending'
  )
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard()
RETURNS TABLE (
  profile_id uuid,
  user_id uuid,
  referral_code text,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean,
  payout_updated_at timestamptz,
  total_referrals bigint,
  converted_referrals bigint,
  referral_clicks bigint,
  conversion_count bigint,
  total_earned numeric,
  pending_earnings numeric,
  paid_out numeric,
  available_balance numeric
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  p AS (
    SELECT ap.*
    FROM public.affiliate_profiles ap
    JOIN me ON ap.user_id = me.uid
  )
  SELECT
    p.id,
    p.user_id,
    p.referral_code,
    p.payout_method,
    p.payout_details,
    p.payout_verified,
    p.payout_updated_at,
    coalesce((SELECT count(*) FROM public.affiliate_clicks c WHERE c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((SELECT count(*) FROM public.affiliate_conversions c WHERE c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((SELECT count(*) FROM public.affiliate_clicks c WHERE c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((SELECT count(*) FROM public.affiliate_conversions c WHERE c.affiliate_user_id = p.user_id), 0)::bigint,
    round(coalesce((SELECT sum(amount) FROM public.affiliate_earnings e WHERE e.affiliate_user_id = p.user_id), 0), 2),
    round(coalesce((SELECT sum(amount) FROM public.affiliate_earnings e WHERE e.affiliate_user_id = p.user_id AND e.status = 'pending'), 0), 2),
    round(coalesce((SELECT sum(amount) FROM public.affiliate_earnings e WHERE e.affiliate_user_id = p.user_id AND e.status = 'paid'), 0), 2),
    round(
      greatest(
        coalesce((SELECT sum(amount) FROM public.affiliate_earnings e WHERE e.affiliate_user_id = p.user_id AND e.status = 'available'), 0)
        -
        coalesce((SELECT sum(amount + fee_amount) FROM public.withdrawal_requests w WHERE w.user_id = p.user_id AND w.status IN ('pending','approved','paid')), 0),
        0
      ),
      2
    )
  FROM p;
$$;

CREATE OR REPLACE FUNCTION public.admin_write_log(
  p_action_type text,
  p_target_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS public.admin_logs
LANGUAGE plpgsql
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SET search_path = public
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
        paid_balance = COALESCE(paid_balance, 0) + COALESCE(v_req.amount, 0),
        pending_balance = GREATEST(COALESCE(pending_balance, 0) - COALESCE(v_req.amount, 0), 0),
        updated_at = now()
    WHERE user_id = v_req.user_id;
  END IF;

  PERFORM public.admin_write_log(
    'withdrawal_' || p_status,
    p_request_id::text,
    jsonb_build_object('request_id', p_request_id, 'status', p_status, 'amount', v_req.amount)
  );

  RETURN v_req;
END;
$$;

-- === VIEW USED BY ADMIN DASHBOARD ===
CREATE OR REPLACE VIEW public.admin_profiles_view
WITH (security_invoker = on)
AS
SELECT
  p.user_id,
  COALESCE(p.email, au.email) AS email,
  p.avatar_url,
  COALESCE(p.full_name, p.display_name) AS full_name,
  COALESCE(p.current_plan, p.subscription_tier, 'free') AS current_plan,
  public.has_role(p.user_id, 'admin') AS is_admin,
  COALESCE(p.is_suspended, false) AS is_suspended,
  COALESCE(p.affiliate_enabled, false) AS affiliate_enabled,
  COALESCE(p.total_scripts_generated, 0) AS total_scripts_generated,
  COALESCE(p.total_trend_scans, 0) AS total_trend_scans,
  p.created_at,
  p.updated_at
FROM public.profiles p
LEFT JOIN auth.users au ON au.id = p.user_id;

-- === RLS ===
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can view their own profile') THEN
    CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can insert their own profile') THEN
    CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins can view all profiles') THEN
    CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scan_history' AND policyname='Users can view own scans') THEN
    CREATE POLICY "Users can view own scans" ON public.scan_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scan_history' AND policyname='Users can insert own scans') THEN
    CREATE POLICY "Users can insert own scans" ON public.scan_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='script_history' AND policyname='Users can view own scripts') THEN
    CREATE POLICY "Users can view own scripts" ON public.script_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='script_history' AND policyname='Users can insert own scripts') THEN
    CREATE POLICY "Users can insert own scripts" ON public.script_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscriptions' AND policyname='Users read own subscriptions') THEN
    CREATE POLICY "Users read own subscriptions" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscriptions' AND policyname='Admins manage subscriptions') THEN
    CREATE POLICY "Admins manage subscriptions" ON public.subscriptions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Users can view own payments') THEN
    CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Admins can view all payments') THEN
    CREATE POLICY "Admins can view all payments" ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='signup_ips' AND policyname='Service role manages signup ips') THEN
    CREATE POLICY "Service role manages signup ips" ON public.signup_ips FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Users can view their own roles') THEN
    CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_profiles' AND policyname='Users manage own affiliate profile') THEN
    CREATE POLICY "Users manage own affiliate profile" ON public.affiliate_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_profiles' AND policyname='Admins read all affiliate profiles') THEN
    CREATE POLICY "Admins read all affiliate profiles" ON public.affiliate_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_clicks' AND policyname='Users read own affiliate clicks') THEN
    CREATE POLICY "Users read own affiliate clicks" ON public.affiliate_clicks FOR SELECT TO authenticated USING (auth.uid() = affiliate_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_conversions' AND policyname='Users read own affiliate conversions') THEN
    CREATE POLICY "Users read own affiliate conversions" ON public.affiliate_conversions FOR SELECT TO authenticated USING (auth.uid() = affiliate_user_id OR auth.uid() = referred_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_earnings' AND policyname='Users read own affiliate earnings') THEN
    CREATE POLICY "Users read own affiliate earnings" ON public.affiliate_earnings FOR SELECT TO authenticated USING (auth.uid() = affiliate_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='Users manage own withdrawal requests') THEN
    CREATE POLICY "Users manage own withdrawal requests" ON public.withdrawal_requests FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='Admins read all withdrawals') THEN
    CREATE POLICY "Admins read all withdrawals" ON public.withdrawal_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='Admins update withdrawals') THEN
    CREATE POLICY "Admins update withdrawals" ON public.withdrawal_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_commissions' AND policyname='Admins manage affiliate commissions') THEN
    CREATE POLICY "Admins manage affiliate commissions" ON public.affiliate_commissions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_commissions' AND policyname='Users read own affiliate commissions') THEN
    CREATE POLICY "Users read own affiliate commissions" ON public.affiliate_commissions FOR SELECT TO authenticated USING (auth.uid() = affiliate_user_id OR auth.uid() = referred_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_generations' AND policyname='Admins read ai generations') THEN
    CREATE POLICY "Admins read ai generations" ON public.ai_generations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_generations' AND policyname='Users read own ai generations') THEN
    CREATE POLICY "Users read own ai generations" ON public.ai_generations FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feature_usage' AND policyname='Admins read feature usage') THEN
    CREATE POLICY "Admins read feature usage" ON public.feature_usage FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feature_usage' AND policyname='Users read own feature usage') THEN
    CREATE POLICY "Users read own feature usage" ON public.feature_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_settings' AND policyname='Authenticated read platform settings') THEN
    CREATE POLICY "Authenticated read platform settings" ON public.platform_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_settings' AND policyname='Admins manage platform settings') THEN
    CREATE POLICY "Admins manage platform settings" ON public.platform_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_logs' AND policyname='Admins manage admin logs') THEN
    CREATE POLICY "Admins manage admin logs" ON public.admin_logs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- === INITIAL SETTINGS ROW ===
INSERT INTO public.platform_settings (
  creator_price, pro_price, agency_price, free_scripts_limit, free_scans_limit,
  affiliate_commission_percent, minimum_withdrawal, payout_delay_days, maintenance_mode
)
SELECT 19, 39, 99, 5, 3, 30, 25, 7, false
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings);

-- === GRANTS ===
REVOKE ALL ON FUNCTION public.ensure_affiliate_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_payout_method(public.payout_method_type, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_withdrawal_request(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_affiliate_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_write_log(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_process_withdrawal_request(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_affiliate_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_payout_method(public.payout_method_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_withdrawal_request(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_write_log(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal_request(uuid, text, text) TO authenticated;