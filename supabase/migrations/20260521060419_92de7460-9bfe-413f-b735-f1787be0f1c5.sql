ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS referred_by_code text;

ALTER TABLE public.affiliate_profiles
ADD COLUMN IF NOT EXISTS payout_method text,
ADD COLUMN IF NOT EXISTS payout_details text,
ADD COLUMN IF NOT EXISTS payout_verified boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS payout_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_profiles_payout_method_check'
      AND conrelid = 'public.affiliate_profiles'::regclass
  ) THEN
    ALTER TABLE public.affiliate_profiles
      ADD CONSTRAINT affiliate_profiles_payout_method_check
      CHECK (payout_method IS NULL OR payout_method IN ('paypal', 'usdt_trc20'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_code
  ON public.profiles (referred_by_code)
  WHERE referred_by_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_commissions_unique_subscription_ref
  ON public.affiliate_commissions (affiliate_user_id, referred_user_id, subscription_id)
  WHERE subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.affiliate_profiles ap WHERE upper(ap.referral_code) = v_code
      UNION ALL
      SELECT 1 FROM public.profiles p WHERE upper(coalesce(p.referral_code, '')) = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_affiliate_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ref_code text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT referral_code
  INTO v_ref_code
  FROM public.affiliate_profiles
  WHERE user_id = v_user_id;

  IF v_ref_code IS NULL THEN
    SELECT coalesce(referral_code, public.generate_referral_code())
    INTO v_ref_code
    FROM public.profiles
    WHERE user_id = v_user_id;

    IF v_ref_code IS NULL THEN
      v_ref_code := public.generate_referral_code();
    END IF;

    INSERT INTO public.affiliate_profiles (user_id, referral_code)
    VALUES (v_user_id, upper(v_ref_code))
    ON CONFLICT (user_id) DO UPDATE
      SET referral_code = coalesce(public.affiliate_profiles.referral_code, excluded.referral_code),
          updated_at = now();

    UPDATE public.profiles
    SET referral_code = coalesce(referral_code, upper(v_ref_code)),
        updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id, 'referral_code', upper(v_ref_code));
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_user_account(p_referred_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized', 'code', 'AUTH_REQUIRED');
  END IF;

  SELECT referral_code, referred_by_code
  INTO v_existing_referral_code, v_existing_referred_by
  FROM public.profiles
  WHERE user_id = v_user_id;

  v_referral_code := coalesce(v_existing_referral_code, public.generate_referral_code());

  IF v_clean_referred_by = upper(v_referral_code) THEN
    v_clean_referred_by := NULL;
  END IF;

  INSERT INTO public.profiles (
    user_id,
    email,
    display_name,
    full_name,
    referral_code,
    referred_by_code,
    subscription_tier,
    current_plan
  )
  VALUES (
    v_user_id,
    v_email,
    v_display_name,
    v_display_name,
    upper(v_referral_code),
    v_clean_referred_by,
    'free',
    'free'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = coalesce(public.profiles.email, excluded.email),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at = now();

  PERFORM public.ensure_affiliate_profile();

  IF v_existing_referred_by IS NULL AND v_clean_referred_by IS NOT NULL THEN
    UPDATE public.affiliate_profiles ap
    SET total_clicks = coalesce(ap.total_clicks, 0) + 1,
        updated_at = now()
    WHERE upper(ap.referral_code) = v_clean_referred_by
      AND ap.user_id <> v_user_id;
  END IF;

  INSERT INTO public.user_subscriptions (user_id, plan, status, amount, currency)
  VALUES (v_user_id, 'free', 'active', 0, 'USD')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_user_account()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.initialize_user_account(NULL);
$$;

CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard()
RETURNS TABLE (
  profile_id uuid,
  user_id uuid,
  referral_code text,
  referral_link text,
  payout_method text,
  payout_details text,
  payout_verified boolean,
  payout_updated_at timestamptz,
  total_referrals integer,
  converted_referrals integer,
  referral_clicks integer,
  conversion_count integer,
  total_earned numeric,
  pending_earnings numeric,
  paid_out numeric,
  available_balance numeric,
  locked_balance numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_domain text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.ensure_affiliate_profile();

  SELECT coalesce(nullif(platform_domain, ''), 'https://tryrobin.xyz')
  INTO v_domain
  FROM public.platform_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    ap.user_id AS profile_id,
    ap.user_id,
    ap.referral_code,
    rtrim(v_domain, '/') || '/?ref=' || ap.referral_code AS referral_link,
    ap.payout_method,
    ap.payout_details,
    coalesce(ap.payout_verified, false) AS payout_verified,
    ap.payout_updated_at,
    coalesce(ap.total_clicks, 0) AS total_referrals,
    coalesce(ap.total_conversions, 0) AS converted_referrals,
    coalesce(ap.total_clicks, 0) AS referral_clicks,
    coalesce(ap.total_conversions, 0) AS conversion_count,
    coalesce(ap.total_earned, 0) AS total_earned,
    coalesce(ap.pending_balance, 0) AS pending_earnings,
    coalesce(ap.paid_balance, 0) AS paid_out,
    coalesce(ap.pending_balance, 0) AS available_balance,
    0::numeric AS locked_balance
  FROM public.affiliate_profiles ap
  WHERE ap.user_id = v_user_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_payout_method(p_method text, p_details text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_method text := lower(trim(coalesce(p_method, '')));
  v_details text := trim(coalesce(p_details, ''));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_method NOT IN ('paypal', 'usdt_trc20') THEN
    RAISE EXCEPTION 'Invalid payout method';
  END IF;

  IF v_details = '' THEN
    RAISE EXCEPTION 'Payout details required';
  END IF;

  PERFORM public.ensure_affiliate_profile();

  UPDATE public.affiliate_profiles
  SET payout_method = v_method,
      payout_details = v_details,
      payout_verified = false,
      payout_updated_at = now(),
      updated_at = now()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_minimum numeric := 25;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT coalesce(minimum_withdrawal, 25)
  INTO v_minimum
  FROM public.platform_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF p_amount < v_minimum THEN
    RAISE EXCEPTION 'Minimum withdrawal is %', v_minimum;
  END IF;

  PERFORM public.ensure_affiliate_profile();

  SELECT * INTO v_profile
  FROM public.affiliate_profiles
  WHERE user_id = v_user_id;

  IF v_profile.payout_method IS NULL OR coalesce(v_profile.payout_details, '') = '' THEN
    RAISE EXCEPTION 'Payout method not configured';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.withdrawal_requests wr
    WHERE wr.user_id = v_user_id
      AND wr.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'You already have a pending withdrawal request';
  END IF;

  IF p_amount > coalesce(v_profile.pending_balance, 0) THEN
    RAISE EXCEPTION 'Requested amount exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests (
    user_id,
    amount,
    fee_amount,
    status,
    payout_method,
    payout_details
  )
  VALUES (
    v_user_id,
    round(p_amount, 2),
    0,
    'pending',
    v_profile.payout_method,
    v_profile.payout_details
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support');
  v_status text := lower(trim(coalesce(p_status, '')));
  v_req public.withdrawal_requests%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF v_status NOT IN ('pending', 'approved', 'paid', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid status');
  END IF;

  SELECT *
  INTO v_req
  FROM public.withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Withdrawal request not found');
  END IF;

  IF v_req.status = 'paid' AND v_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Paid withdrawal cannot be reverted');
  END IF;

  IF v_status = 'paid' AND v_req.status <> 'paid' THEN
    UPDATE public.affiliate_profiles
    SET pending_balance = greatest(coalesce(pending_balance, 0) - coalesce(v_req.amount, 0), 0),
        paid_balance = coalesce(paid_balance, 0) + coalesce(v_req.amount, 0),
        updated_at = now()
    WHERE user_id = v_req.user_id;
  END IF;

  UPDATE public.withdrawal_requests
  SET
    status = v_status,
    admin_note = p_admin_note,
    updated_at = now(),
    approved_at = CASE WHEN v_status = 'approved' THEN coalesce(approved_at, now()) ELSE approved_at END,
    completed_at = CASE WHEN v_status = 'paid' THEN coalesce(completed_at, now()) ELSE completed_at END,
    rejected_at = CASE WHEN v_status = 'rejected' THEN coalesce(rejected_at, now()) ELSE rejected_at END
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_referral_commission_for_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referred_by_code text;
  v_affiliate_user_id uuid;
  v_commission_percent numeric := 30;
  v_commission_amount numeric := 0;
  v_inserted_id uuid;
BEGIN
  IF coalesce(lower(NEW.plan), 'free') = 'free' THEN
    RETURN NEW;
  END IF;

  IF coalesce(lower(NEW.status), '') <> 'active' THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.referred_by_code
  INTO v_referred_by_code
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id;

  IF v_referred_by_code IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ap.user_id
  INTO v_affiliate_user_id
  FROM public.affiliate_profiles ap
  WHERE upper(ap.referral_code) = upper(v_referred_by_code)
  LIMIT 1;

  IF v_affiliate_user_id IS NULL OR v_affiliate_user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(ps.affiliate_commission_percent, 30)
  INTO v_commission_percent
  FROM public.platform_settings ps
  ORDER BY ps.updated_at DESC
  LIMIT 1;

  v_commission_amount := round((coalesce(NEW.amount, 0) * v_commission_percent / 100.0)::numeric, 2);

  IF v_commission_amount <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.affiliate_commissions (
    affiliate_user_id,
    referred_user_id,
    subscription_id,
    amount,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_affiliate_user_id,
    NEW.user_id,
    NEW.id,
    v_commission_amount,
    'paid',
    now(),
    now()
  )
  ON CONFLICT (affiliate_user_id, referred_user_id, subscription_id)
  DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.affiliate_profiles ap
  SET total_conversions = coalesce(ap.total_conversions, 0) + 1,
      total_earned = coalesce(ap.total_earned, 0) + v_commission_amount,
      pending_balance = coalesce(ap.pending_balance, 0) + v_commission_amount,
      updated_at = now()
  WHERE ap.user_id = v_affiliate_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_referral_commission_on_subscription
ON public.user_subscriptions;

CREATE TRIGGER trg_apply_referral_commission_on_subscription
AFTER INSERT OR UPDATE OF status, plan, amount
ON public.user_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.apply_referral_commission_for_subscription();