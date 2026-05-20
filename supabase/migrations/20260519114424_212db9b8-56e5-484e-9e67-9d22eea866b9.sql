-- enums for plan and billing controls
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier') THEN
    CREATE TYPE public.plan_tier AS ENUM ('creator','pro_creator','agency');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_plan_status') THEN
    CREATE TYPE public.user_plan_status AS ENUM ('trial','active','cancelled','suspended','expired');
  END IF;
END $$;

-- user subscription + status table for admin ops
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  full_name TEXT,
  email TEXT NOT NULL,
  plan plan_tier NOT NULL DEFAULT 'creator',
  status user_plan_status NOT NULL DEFAULT 'trial',
  billing_status TEXT NOT NULL DEFAULT 'unpaid',
  is_affiliate BOOLEAN NOT NULL DEFAULT false,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  ai_generations_count INTEGER NOT NULL DEFAULT 0,
  image_generations_count INTEGER NOT NULL DEFAULT 0,
  video_generations_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  token_usage BIGINT NOT NULL DEFAULT 0,
  infra_cost_estimate NUMERIC(12,2) NOT NULL DEFAULT 0,
  subscription_started_at TIMESTAMPTZ,
  subscription_expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_subscriptions' AND policyname = 'Users read own subscription profile'
  ) THEN
    CREATE POLICY "Users read own subscription profile"
    ON public.user_subscriptions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_subscriptions' AND policyname = 'Admins full access subscription profiles'
  ) THEN
    CREATE POLICY "Admins full access subscription profiles"
    ON public.user_subscriptions
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.business_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_price NUMERIC(10,2) NOT NULL DEFAULT 19,
  pro_creator_price NUMERIC(10,2) NOT NULL DEFAULT 39,
  agency_price NUMERIC(10,2) NOT NULL DEFAULT 99,
  public_affiliate_recurring_percent NUMERIC(5,2) NOT NULL DEFAULT 30,
  jvzoo_launch_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
  launch_promotions_enabled BOOLEAN NOT NULL DEFAULT false,
  limited_time_offer_enabled BOOLEAN NOT NULL DEFAULT false,
  affiliate_campaign_enabled BOOLEAN NOT NULL DEFAULT true,
  minimum_withdrawal_amount NUMERIC(10,2) NOT NULL DEFAULT 25,
  payout_delay_days INTEGER NOT NULL DEFAULT 7,
  recurring_duration_months INTEGER NOT NULL DEFAULT 12,
  seasonal_campaign_name TEXT,
  seasonal_campaign_bonus_percent NUMERIC(5,2),
  exclusive_offer_label TEXT,
  published_at TIMESTAMPTZ,
  rollback_source_id UUID,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.business_controls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_controls' AND policyname = 'Authenticated read business controls'
  ) THEN
    CREATE POLICY "Authenticated read business controls"
    ON public.business_controls
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_controls' AND policyname = 'Admins write business controls'
  ) THEN
    CREATE POLICY "Admins write business controls"
    ON public.business_controls
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_controls' AND policyname = 'Admins update business controls'
  ) THEN
    CREATE POLICY "Admins update business controls"
    ON public.business_controls
    FOR UPDATE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.business_control_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id UUID REFERENCES public.business_controls(id) ON DELETE CASCADE,
  changed_by UUID,
  action_type TEXT NOT NULL DEFAULT 'update',
  change_scope TEXT NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB,
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.business_control_change_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_control_change_logs' AND policyname = 'Admins read control logs'
  ) THEN
    CREATE POLICY "Admins read control logs"
    ON public.business_control_change_logs
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_control_change_logs' AND policyname = 'Admins write control logs'
  ) THEN
    CREATE POLICY "Admins write control logs"
    ON public.business_control_change_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- keep updated_at synced on mutable tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'touch_user_subscriptions_updated_at'
  ) THEN
    CREATE TRIGGER touch_user_subscriptions_updated_at
    BEFORE UPDATE ON public.user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'touch_business_controls_updated_at'
  ) THEN
    CREATE TRIGGER touch_business_controls_updated_at
    BEFORE UPDATE ON public.business_controls
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- validation for realistic business rule ranges
CREATE OR REPLACE FUNCTION public.validate_business_controls()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.creator_price < 0 OR NEW.pro_creator_price < 0 OR NEW.agency_price < 0 THEN
    RAISE EXCEPTION 'Pricing cannot be negative';
  END IF;

  IF NEW.public_affiliate_recurring_percent < 0 OR NEW.public_affiliate_recurring_percent > 70 THEN
    RAISE EXCEPTION 'Public affiliate recurring percent must be between 0 and 70';
  END IF;

  IF NEW.jvzoo_launch_percent < 0 OR NEW.jvzoo_launch_percent > 80 THEN
    RAISE EXCEPTION 'JVZoo launch percent must be between 0 and 80';
  END IF;

  IF NEW.seasonal_campaign_bonus_percent IS NOT NULL AND (NEW.seasonal_campaign_bonus_percent < 0 OR NEW.seasonal_campaign_bonus_percent > 35) THEN
    RAISE EXCEPTION 'Seasonal campaign bonus percent must be between 0 and 35';
  END IF;

  IF NEW.minimum_withdrawal_amount < 5 THEN
    RAISE EXCEPTION 'Minimum withdrawal amount must be at least 5';
  END IF;

  IF NEW.payout_delay_days < 0 OR NEW.payout_delay_days > 120 THEN
    RAISE EXCEPTION 'Payout delay must be between 0 and 120 days';
  END IF;

  IF NEW.recurring_duration_months < 1 OR NEW.recurring_duration_months > 120 THEN
    RAISE EXCEPTION 'Recurring duration must be between 1 and 120 months';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'validate_business_controls_trigger'
  ) THEN
    CREATE TRIGGER validate_business_controls_trigger
    BEFORE INSERT OR UPDATE ON public.business_controls
    FOR EACH ROW EXECUTE FUNCTION public.validate_business_controls();
  END IF;
END $$;

-- auto-create a baseline control row
INSERT INTO public.business_controls (
  creator_price,
  pro_creator_price,
  agency_price,
  public_affiliate_recurring_percent,
  jvzoo_launch_percent,
  launch_promotions_enabled,
  limited_time_offer_enabled,
  affiliate_campaign_enabled,
  minimum_withdrawal_amount,
  payout_delay_days,
  recurring_duration_months,
  created_by,
  updated_by,
  published_at
)
SELECT
  19, 39, 99,
  30, 50,
  false, false, true,
  25, 7, 12,
  auth.uid(), auth.uid(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.business_controls);

-- admin function for updating business controls with change logs + confirmation gate
CREATE OR REPLACE FUNCTION public.admin_publish_business_controls(
  p_control_id UUID,
  p_creator_price NUMERIC,
  p_pro_creator_price NUMERIC,
  p_agency_price NUMERIC,
  p_public_affiliate_recurring_percent NUMERIC,
  p_jvzoo_launch_percent NUMERIC,
  p_launch_promotions_enabled BOOLEAN,
  p_limited_time_offer_enabled BOOLEAN,
  p_affiliate_campaign_enabled BOOLEAN,
  p_minimum_withdrawal_amount NUMERIC,
  p_payout_delay_days INTEGER,
  p_recurring_duration_months INTEGER,
  p_seasonal_campaign_name TEXT,
  p_seasonal_campaign_bonus_percent NUMERIC,
  p_exclusive_offer_label TEXT,
  p_confirm_high_commission BOOLEAN DEFAULT false
)
RETURNS public.business_controls
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_before public.business_controls%rowtype;
  v_after public.business_controls%rowtype;
  v_requires_confirmation BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO v_before FROM public.business_controls WHERE id = p_control_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business control row not found';
  END IF;

  IF p_public_affiliate_recurring_percent > 50 OR p_jvzoo_launch_percent > 60 THEN
    v_requires_confirmation := true;
  END IF;

  IF v_requires_confirmation AND NOT p_confirm_high_commission THEN
    RAISE EXCEPTION 'High commission change requires explicit confirmation';
  END IF;

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
      published_at = now()
  WHERE id = p_control_id
  RETURNING * INTO v_after;

  INSERT INTO public.business_control_change_logs (
    control_id,
    changed_by,
    action_type,
    change_scope,
    before_snapshot,
    after_snapshot,
    requires_confirmation
  ) VALUES (
    p_control_id,
    v_actor,
    'publish',
    'pricing_commission_controls',
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_requires_confirmation
  );

  RETURN v_after;
END;
$$;

-- read latest control row (for public pages + admin)
CREATE OR REPLACE FUNCTION public.get_live_business_controls()
RETURNS public.business_controls
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT *
  FROM public.business_controls
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

-- admin analytics snapshot feed
CREATE OR REPLACE FUNCTION public.get_admin_ops_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_control public.business_controls%rowtype;
  v_payload JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO v_control
  FROM public.business_controls
  ORDER BY updated_at DESC
  LIMIT 1;

  WITH metrics AS (
    SELECT
      (SELECT count(*) FROM public.user_subscriptions) AS total_users,
      (SELECT count(*) FROM public.user_subscriptions WHERE status = 'active') AS active_subscribers,
      (SELECT count(*) FROM public.affiliate_profiles) AS total_affiliates,
      (SELECT coalesce(sum(
        CASE us.plan
          WHEN 'creator' THEN coalesce(v_control.creator_price, 19)
          WHEN 'pro_creator' THEN coalesce(v_control.pro_creator_price, 39)
          WHEN 'agency' THEN coalesce(v_control.agency_price, 99)
        END
      ), 0)
       FROM public.user_subscriptions us
       WHERE us.status = 'active') AS mrr,
      (SELECT coalesce(sum(billed_amount), 0) FROM public.affiliate_conversions WHERE converted_at::date = now()::date) AS today_revenue,
      (SELECT coalesce(sum(amount + fee_amount), 0) FROM public.withdrawal_requests WHERE status = 'paid') AS total_withdrawals,
      (SELECT count(*) FROM public.withdrawal_requests WHERE status = 'pending') AS pending_withdrawals,
      (SELECT round(
        CASE WHEN (SELECT count(*) FROM public.affiliate_clicks) = 0 THEN 0
        ELSE ((SELECT count(*) FROM public.affiliate_conversions)::numeric / nullif((SELECT count(*) FROM public.affiliate_clicks), 0)) * 100
        END
      , 2)) AS conversion_rate,
      (SELECT round(
        CASE WHEN (SELECT count(*) FROM public.user_subscriptions WHERE status IN ('active','cancelled')) = 0 THEN 0
        ELSE ((SELECT count(*) FROM public.user_subscriptions WHERE status = 'cancelled')::numeric
              / nullif((SELECT count(*) FROM public.user_subscriptions WHERE status IN ('active','cancelled')), 0)) * 100
        END
      , 2)) AS churn_rate,
      (SELECT coalesce(sum(ai_generations_count), 0) FROM public.user_subscriptions) AS total_ai_generations,
      (SELECT coalesce(sum(prompt_count), 0) FROM public.user_subscriptions) AS total_prompts,
      (SELECT coalesce(sum(image_generations_count), 0) FROM public.user_subscriptions) AS image_generations,
      (SELECT coalesce(sum(video_generations_count), 0) FROM public.user_subscriptions) AS video_generations,
      (SELECT coalesce(sum(token_usage), 0) FROM public.user_subscriptions) AS token_usage,
      (SELECT coalesce(sum(infra_cost_estimate), 0) FROM public.user_subscriptions) AS infra_cost_estimate
  ),
  plan_distribution AS (
    SELECT jsonb_build_object(
      'creator', (SELECT count(*) FROM public.user_subscriptions WHERE plan = 'creator'),
      'pro_creator', (SELECT count(*) FROM public.user_subscriptions WHERE plan = 'pro_creator'),
      'agency', (SELECT count(*) FROM public.user_subscriptions WHERE plan = 'agency'),
      'trial', (SELECT count(*) FROM public.user_subscriptions WHERE status = 'trial'),
      'cancelled', (SELECT count(*) FROM public.user_subscriptions WHERE status = 'cancelled')
    ) AS payload
  ),
  affiliate_leaderboard AS (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'commission_earned')::numeric DESC), '[]'::jsonb) AS payload
    FROM (
      SELECT jsonb_build_object(
        'affiliate_user_id', ap.user_id,
        'name', coalesce(us.full_name, split_part(coalesce(us.email, ap.user_id::text), '@', 1)),
        'email', us.email,
        'referrals', coalesce(c.clicks, 0),
        'paid_users', coalesce(cv.conversions, 0),
        'revenue_generated', coalesce(cv.revenue_generated, 0),
        'commission_earned', coalesce(e.commission_earned, 0),
        'conversion_percent', CASE WHEN coalesce(c.clicks, 0) = 0 THEN 0 ELSE round((coalesce(cv.conversions, 0)::numeric / c.clicks::numeric) * 100, 2) END,
        'status', CASE WHEN coalesce(cv.conversions, 0) >= 10 THEN 'top' WHEN coalesce(cv.conversions, 0) >= 3 THEN 'growing' ELSE 'new' END
      ) AS t
      FROM public.affiliate_profiles ap
      LEFT JOIN public.user_subscriptions us ON us.user_id = ap.user_id
      LEFT JOIN (
        SELECT affiliate_user_id, count(*) AS clicks
        FROM public.affiliate_clicks
        GROUP BY affiliate_user_id
      ) c ON c.affiliate_user_id = ap.user_id
      LEFT JOIN (
        SELECT affiliate_user_id, count(*) AS conversions, round(coalesce(sum(billed_amount), 0), 2) AS revenue_generated
        FROM public.affiliate_conversions
        GROUP BY affiliate_user_id
      ) cv ON cv.affiliate_user_id = ap.user_id
      LEFT JOIN (
        SELECT affiliate_user_id, round(coalesce(sum(amount), 0), 2) AS commission_earned
        FROM public.affiliate_earnings
        GROUP BY affiliate_user_id
      ) e ON e.affiliate_user_id = ap.user_id
      ORDER BY coalesce(e.commission_earned, 0) DESC
      LIMIT 100
    ) s
  ),
  revenue_series AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'day', d::date,
      'revenue', coalesce(r.revenue, 0),
      'new_users', coalesce(u.new_users, 0),
      'conversions', coalesce(c.conversions, 0),
      'withdrawals', coalesce(w.withdrawals, 0)
    ) ORDER BY d), '[]'::jsonb) AS payload
    FROM generate_series((now()::date - interval '29 days')::date, now()::date, interval '1 day') d
    LEFT JOIN (
      SELECT converted_at::date AS day, round(coalesce(sum(billed_amount), 0), 2) AS revenue
      FROM public.affiliate_conversions
      GROUP BY converted_at::date
    ) r ON r.day = d::date
    LEFT JOIN (
      SELECT created_at::date AS day, count(*) AS new_users
      FROM public.user_subscriptions
      GROUP BY created_at::date
    ) u ON u.day = d::date
    LEFT JOIN (
      SELECT converted_at::date AS day, count(*) AS conversions
      FROM public.affiliate_conversions
      GROUP BY converted_at::date
    ) c ON c.day = d::date
    LEFT JOIN (
      SELECT created_at::date AS day, round(coalesce(sum(amount), 0), 2) AS withdrawals
      FROM public.withdrawal_requests
      GROUP BY created_at::date
    ) w ON w.day = d::date
  ),
  recent_activity AS (
    SELECT coalesce(jsonb_agg(entry ORDER BY (entry->>'at') DESC), '[]'::jsonb) AS payload
    FROM (
      SELECT jsonb_build_object(
        'type', 'signup',
        'label', concat('New user: ', coalesce(us.email, us.user_id::text)),
        'severity', 'info',
        'at', us.created_at
      ) AS entry
      FROM public.user_subscriptions us
      ORDER BY us.created_at DESC
      LIMIT 30
    ) a
  )
  SELECT jsonb_build_object(
    'metrics', to_jsonb(metrics.*),
    'plan_distribution', (SELECT payload FROM plan_distribution),
    'affiliate_leaderboard', (SELECT payload FROM affiliate_leaderboard),
    'revenue_series', (SELECT payload FROM revenue_series),
    'recent_activity', (SELECT payload FROM recent_activity),
    'business_controls', to_jsonb(v_control)
  ) INTO v_payload
  FROM metrics;

  RETURN v_payload;
END;
$$;