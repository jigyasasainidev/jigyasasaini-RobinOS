-- Enums
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier') THEN
    CREATE TYPE public.plan_tier AS ENUM ('creator','pro_creator','agency');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_plan_status') THEN
    CREATE TYPE public.user_plan_status AS ENUM ('trial','active','cancelled','suspended','expired');
  END IF;
END $$;

-- Utility updated_at trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Affiliate tables
CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  referral_code text NOT NULL UNIQUE,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean NOT NULL DEFAULT false,
  payout_updated_at timestamptz,
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

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate_user ON public.affiliate_clicks(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate_user ON public.affiliate_conversions(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_affiliate_user ON public.affiliate_earnings(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_status ON public.affiliate_earnings(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created ON public.withdrawal_requests(status, created_at DESC);

-- Ops tables
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  full_name text,
  email text NOT NULL,
  plan public.plan_tier NOT NULL DEFAULT 'creator',
  status public.user_plan_status NOT NULL DEFAULT 'trial',
  billing_status text NOT NULL DEFAULT 'unpaid',
  is_affiliate boolean NOT NULL DEFAULT false,
  credits_balance integer NOT NULL DEFAULT 0,
  ai_generations_count integer NOT NULL DEFAULT 0,
  image_generations_count integer NOT NULL DEFAULT 0,
  video_generations_count integer NOT NULL DEFAULT 0,
  prompt_count integer NOT NULL DEFAULT 0,
  token_usage bigint NOT NULL DEFAULT 0,
  infra_cost_estimate numeric(12,2) NOT NULL DEFAULT 0,
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_price numeric(10,2) NOT NULL DEFAULT 19,
  pro_creator_price numeric(10,2) NOT NULL DEFAULT 39,
  agency_price numeric(10,2) NOT NULL DEFAULT 99,
  public_affiliate_recurring_percent numeric(5,2) NOT NULL DEFAULT 30,
  jvzoo_launch_percent numeric(5,2) NOT NULL DEFAULT 50,
  launch_promotions_enabled boolean NOT NULL DEFAULT false,
  limited_time_offer_enabled boolean NOT NULL DEFAULT false,
  affiliate_campaign_enabled boolean NOT NULL DEFAULT true,
  minimum_withdrawal_amount numeric(10,2) NOT NULL DEFAULT 25,
  payout_delay_days integer NOT NULL DEFAULT 7,
  recurring_duration_months integer NOT NULL DEFAULT 12,
  seasonal_campaign_name text,
  seasonal_campaign_bonus_percent numeric(5,2),
  exclusive_offer_label text,
  published_at timestamptz,
  rollback_source_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_control_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id uuid REFERENCES public.business_controls(id) ON DELETE CASCADE,
  changed_by uuid,
  action_type text NOT NULL DEFAULT 'update',
  change_scope text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  requires_confirmation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON public.user_subscriptions(plan);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_email ON public.user_subscriptions(email);

-- Enable RLS
ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_control_change_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_profiles' AND policyname='Users manage own affiliate profile') THEN
    CREATE POLICY "Users manage own affiliate profile" ON public.affiliate_profiles
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_clicks' AND policyname='Users read own affiliate clicks') THEN
    CREATE POLICY "Users read own affiliate clicks" ON public.affiliate_clicks
      FOR SELECT TO authenticated
      USING (auth.uid() = affiliate_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_conversions' AND policyname='Users read own affiliate conversions') THEN
    CREATE POLICY "Users read own affiliate conversions" ON public.affiliate_conversions
      FOR SELECT TO authenticated
      USING (auth.uid() = affiliate_user_id OR auth.uid() = referred_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='affiliate_earnings' AND policyname='Users read own affiliate earnings') THEN
    CREATE POLICY "Users read own affiliate earnings" ON public.affiliate_earnings
      FOR SELECT TO authenticated
      USING (auth.uid() = affiliate_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='withdrawal_requests' AND policyname='Users manage own withdrawal requests') THEN
    CREATE POLICY "Users manage own withdrawal requests" ON public.withdrawal_requests
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_subscriptions' AND policyname='Users read own subscription profile') THEN
    CREATE POLICY "Users read own subscription profile" ON public.user_subscriptions
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_subscriptions' AND policyname='Admins full access subscription profiles') THEN
    CREATE POLICY "Admins full access subscription profiles" ON public.user_subscriptions
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='business_controls' AND policyname='Authenticated read business controls') THEN
    CREATE POLICY "Authenticated read business controls" ON public.business_controls
      FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='business_controls' AND policyname='Admins write business controls') THEN
    CREATE POLICY "Admins write business controls" ON public.business_controls
      FOR INSERT TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='business_controls' AND policyname='Admins update business controls') THEN
    CREATE POLICY "Admins update business controls" ON public.business_controls
      FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='business_control_change_logs' AND policyname='Admins read control logs') THEN
    CREATE POLICY "Admins read control logs" ON public.business_control_change_logs
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='business_control_change_logs' AND policyname='Admins write control logs') THEN
    CREATE POLICY "Admins write control logs" ON public.business_control_change_logs
      FOR INSERT TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Triggers for updated_at fields
DROP TRIGGER IF EXISTS touch_user_subscriptions_updated_at ON public.user_subscriptions;
CREATE TRIGGER touch_user_subscriptions_updated_at
BEFORE UPDATE ON public.user_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_business_controls_updated_at ON public.business_controls;
CREATE TRIGGER touch_business_controls_updated_at
BEFORE UPDATE ON public.business_controls
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_affiliate_profiles_updated_at ON public.affiliate_profiles;
CREATE TRIGGER touch_affiliate_profiles_updated_at
BEFORE UPDATE ON public.affiliate_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER touch_withdrawal_requests_updated_at
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Affiliate helper functions
CREATE OR REPLACE FUNCTION public.ensure_affiliate_profile()
RETURNS public.affiliate_profiles
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_profile FROM public.affiliate_profiles WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.affiliate_profiles (user_id, referral_code)
    VALUES (v_user_id, lower(substr(md5(v_user_id::text || now()::text), 1, 8)))
    RETURNING * INTO v_profile;
  END IF;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_payout_method(p_method public.payout_method_type, p_details text)
RETURNS public.affiliate_profiles
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_method IS NULL THEN
    RAISE EXCEPTION 'Payout method is required';
  END IF;
  IF p_details IS NULL OR length(trim(p_details)) = 0 THEN
    RAISE EXCEPTION 'Payout details are required';
  END IF;

  PERFORM public.ensure_affiliate_profile();

  UPDATE public.affiliate_profiles
  SET payout_method = p_method,
      payout_details = trim(p_details),
      payout_verified = false,
      payout_updated_at = now(),
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_payload jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_profile := public.ensure_affiliate_profile();

  SELECT jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'clicks', (SELECT count(*) FROM public.affiliate_clicks WHERE affiliate_user_id = v_user_id),
    'conversions', (SELECT count(*) FROM public.affiliate_conversions WHERE affiliate_user_id = v_user_id),
    'available_balance', (SELECT coalesce(sum(amount), 0) FROM public.affiliate_earnings WHERE affiliate_user_id = v_user_id AND status = 'available'),
    'pending_balance', (SELECT coalesce(sum(amount), 0) FROM public.affiliate_earnings WHERE affiliate_user_id = v_user_id AND status = 'pending'),
    'total_paid', (SELECT coalesce(sum(amount), 0) FROM public.affiliate_earnings WHERE affiliate_user_id = v_user_id AND status = 'paid'),
    'withdrawals', (SELECT coalesce(jsonb_agg(w ORDER BY w.created_at DESC), '[]'::jsonb) FROM public.withdrawal_requests w WHERE w.user_id = v_user_id)
  ) INTO v_payload;

  RETURN coalesce(v_payload, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_amount numeric)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
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

  SELECT coalesce(minimum_withdrawal_amount, 25)
  INTO v_min_withdrawal
  FROM public.business_controls
  ORDER BY updated_at DESC
  LIMIT 1;

  IF p_amount < v_min_withdrawal THEN RAISE EXCEPTION 'Minimum withdrawal is $%s', v_min_withdrawal; END IF;

  v_profile := public.ensure_affiliate_profile();
  IF v_profile.payout_method IS NULL OR coalesce(v_profile.payout_details, '') = '' THEN
    RAISE EXCEPTION 'Add payout method first';
  END IF;

  SELECT coalesce(sum(case when ae.status = 'available' then ae.amount else 0 end), 0)
  INTO v_available
  FROM public.affiliate_earnings ae
  WHERE ae.affiliate_user_id = v_user_id;

  IF p_amount > greatest(v_available, 0) THEN RAISE EXCEPTION 'Amount exceeds available balance'; END IF;

  INSERT INTO public.withdrawal_requests (user_id, requester_email, amount, payout_method, payout_details, status)
  VALUES (v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending')
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

-- Business controls + admin ops functions
CREATE OR REPLACE FUNCTION public.get_live_business_controls()
RETURNS public.business_controls
LANGUAGE sql
SET search_path = public
AS $$
  SELECT *
  FROM public.business_controls
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_ops_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payload jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.user_subscriptions),
    'active_subscribers', (SELECT count(*) FROM public.user_subscriptions WHERE status = 'active'),
    'total_affiliates', (SELECT count(*) FROM public.affiliate_profiles),
    'pending_withdrawals', (SELECT count(*) FROM public.withdrawal_requests WHERE status = 'pending'),
    'business_controls', (SELECT to_jsonb(bc) FROM public.business_controls bc ORDER BY bc.updated_at DESC LIMIT 1)
  ) INTO v_payload;

  RETURN coalesce(v_payload, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publish_business_controls(
  p_control_id uuid,
  p_creator_price numeric,
  p_pro_creator_price numeric,
  p_agency_price numeric,
  p_public_affiliate_recurring_percent numeric,
  p_jvzoo_launch_percent numeric,
  p_launch_promotions_enabled boolean,
  p_limited_time_offer_enabled boolean,
  p_affiliate_campaign_enabled boolean,
  p_minimum_withdrawal_amount numeric,
  p_payout_delay_days integer,
  p_recurring_duration_months integer,
  p_seasonal_campaign_name text,
  p_seasonal_campaign_bonus_percent numeric,
  p_exclusive_offer_label text,
  p_confirm_high_commission boolean DEFAULT false
)
RETURNS public.business_controls
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_after public.business_controls%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  UPDATE public.business_controls
  SET creator_price = p_creator_price,
      pro_creator_price = p_pro_creator_price,
      agency_price = p_agency_price,
      public_affiliate_recurring_percent = p_public_affiliate_recurring_percent,
      jvzoo_launch_percent = p_jvzoo_launch_percent,
      launch_promotions_enabled = p_launch_promotions_enabled,
      limited_time_offer_enabled = p_limited_time_offer_enabled,
      affiliate_campaign_enabled = p_affiliate_campaign_enabled,
      minimum_withdrawal_amount = p_minimum_withdrawal_amount,
      payout_delay_days = p_payout_delay_days,
      recurring_duration_months = p_recurring_duration_months,
      seasonal_campaign_name = nullif(trim(coalesce(p_seasonal_campaign_name, '')), ''),
      seasonal_campaign_bonus_percent = p_seasonal_campaign_bonus_percent,
      exclusive_offer_label = nullif(trim(coalesce(p_exclusive_offer_label, '')), ''),
      updated_by = v_actor,
      published_at = now(),
      updated_at = now()
  WHERE id = p_control_id
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    INSERT INTO public.business_controls (
      creator_price, pro_creator_price, agency_price,
      public_affiliate_recurring_percent, jvzoo_launch_percent,
      launch_promotions_enabled, limited_time_offer_enabled, affiliate_campaign_enabled,
      minimum_withdrawal_amount, payout_delay_days, recurring_duration_months,
      seasonal_campaign_name, seasonal_campaign_bonus_percent, exclusive_offer_label,
      created_by, updated_by, published_at
    ) VALUES (
      p_creator_price, p_pro_creator_price, p_agency_price,
      p_public_affiliate_recurring_percent, p_jvzoo_launch_percent,
      p_launch_promotions_enabled, p_limited_time_offer_enabled, p_affiliate_campaign_enabled,
      p_minimum_withdrawal_amount, p_payout_delay_days, p_recurring_duration_months,
      nullif(trim(coalesce(p_seasonal_campaign_name, '')), ''), p_seasonal_campaign_bonus_percent, nullif(trim(coalesce(p_exclusive_offer_label, '')), ''),
      v_actor, v_actor, now()
    ) RETURNING * INTO v_after;
  END IF;

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_user_subscription(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_plan public.plan_tier,
  p_status public.user_plan_status,
  p_billing_status text,
  p_is_affiliate boolean,
  p_credits_balance integer,
  p_subscription_expires_at timestamptz,
  p_ai_generations_count integer DEFAULT 0,
  p_image_generations_count integer DEFAULT 0,
  p_video_generations_count integer DEFAULT 0,
  p_prompt_count integer DEFAULT 0,
  p_token_usage bigint DEFAULT 0,
  p_infra_cost_estimate numeric DEFAULT 0
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.user_subscriptions%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  INSERT INTO public.user_subscriptions (
    user_id, full_name, email, plan, status, billing_status, is_affiliate, credits_balance,
    subscription_expires_at, ai_generations_count, image_generations_count, video_generations_count,
    prompt_count, token_usage, infra_cost_estimate, updated_at
  ) VALUES (
    p_user_id, nullif(trim(coalesce(p_full_name, '')), ''), lower(trim(p_email)), p_plan, p_status,
    coalesce(nullif(trim(p_billing_status), ''), 'unpaid'), coalesce(p_is_affiliate, false),
    coalesce(p_credits_balance, 0), p_subscription_expires_at,
    greatest(coalesce(p_ai_generations_count, 0), 0), greatest(coalesce(p_image_generations_count, 0), 0),
    greatest(coalesce(p_video_generations_count, 0), 0), greatest(coalesce(p_prompt_count, 0), 0),
    greatest(coalesce(p_token_usage, 0), 0), greatest(coalesce(p_infra_cost_estimate, 0), 0), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    billing_status = EXCLUDED.billing_status,
    is_affiliate = EXCLUDED.is_affiliate,
    credits_balance = EXCLUDED.credits_balance,
    subscription_expires_at = EXCLUDED.subscription_expires_at,
    ai_generations_count = EXCLUDED.ai_generations_count,
    image_generations_count = EXCLUDED.image_generations_count,
    video_generations_count = EXCLUDED.video_generations_count,
    prompt_count = EXCLUDED.prompt_count,
    token_usage = EXCLUDED.token_usage,
    infra_cost_estimate = EXCLUDED.infra_cost_estimate,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_user_usage(
  p_user_id uuid,
  p_credit_delta integer DEFAULT 0,
  p_prompt_delta integer DEFAULT 0,
  p_token_delta bigint DEFAULT 0,
  p_ai_generation_delta integer DEFAULT 0,
  p_image_generation_delta integer DEFAULT 0,
  p_video_generation_delta integer DEFAULT 0,
  p_infra_cost_delta numeric DEFAULT 0
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.user_subscriptions%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  UPDATE public.user_subscriptions
  SET credits_balance = greatest(credits_balance + coalesce(p_credit_delta, 0), 0),
      prompt_count = greatest(prompt_count + coalesce(p_prompt_delta, 0), 0),
      token_usage = greatest(token_usage + coalesce(p_token_delta, 0), 0),
      ai_generations_count = greatest(ai_generations_count + coalesce(p_ai_generation_delta, 0), 0),
      image_generations_count = greatest(image_generations_count + coalesce(p_image_generation_delta, 0), 0),
      video_generations_count = greatest(video_generations_count + coalesce(p_video_generation_delta, 0), 0),
      infra_cost_estimate = greatest(infra_cost_estimate + coalesce(p_infra_cost_delta, 0), 0),
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'User subscription row not found'; END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user_subscription(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  DELETE FROM public.user_subscriptions WHERE user_id = p_user_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_withdrawal_status(
  p_withdrawal_id uuid,
  p_status public.withdrawal_status,
  p_admin_note text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.withdrawal_requests%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Admin privileges required'; END IF;

  UPDATE public.withdrawal_requests
  SET status = p_status,
      admin_note = COALESCE(p_admin_note, admin_note),
      fee_amount = COALESCE(p_fee_amount, fee_amount),
      approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
      completed_at = CASE WHEN p_status = 'paid' THEN now() ELSE completed_at END,
      rejected_at = CASE WHEN p_status = 'rejected' THEN now() ELSE rejected_at END,
      updated_at = now()
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;
  RETURN v_row;
END;
$$;