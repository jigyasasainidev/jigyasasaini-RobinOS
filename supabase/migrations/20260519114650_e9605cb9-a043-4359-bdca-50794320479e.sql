-- performance indexes for operations queries
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON public.user_subscriptions(plan);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_email ON public.user_subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created ON public.withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate ON public.affiliate_conversions(affiliate_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate ON public.affiliate_clicks(affiliate_user_id);

-- backfill subscription rows from existing authenticated users
INSERT INTO public.user_subscriptions (
  user_id,
  full_name,
  email,
  plan,
  status,
  billing_status,
  is_affiliate,
  credits_balance,
  created_at,
  updated_at
)
SELECT
  au.id,
  nullif(trim(coalesce(au.raw_user_meta_data ->> 'display_name', '')), ''),
  coalesce(au.email, concat('user-', left(replace(au.id::text, '-', ''), 8), '@robinos.local')),
  'creator'::public.plan_tier,
  'trial'::public.user_plan_status,
  'unpaid',
  false,
  0,
  coalesce(au.created_at, now()),
  now()
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions us WHERE us.user_id = au.id
);

-- admin upsert/update user operations record
CREATE OR REPLACE FUNCTION public.admin_upsert_user_subscription(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_plan public.plan_tier,
  p_status public.user_plan_status,
  p_billing_status TEXT,
  p_is_affiliate BOOLEAN,
  p_credits_balance INTEGER,
  p_subscription_expires_at TIMESTAMPTZ,
  p_ai_generations_count INTEGER DEFAULT 0,
  p_image_generations_count INTEGER DEFAULT 0,
  p_video_generations_count INTEGER DEFAULT 0,
  p_prompt_count INTEGER DEFAULT 0,
  p_token_usage BIGINT DEFAULT 0,
  p_infra_cost_estimate NUMERIC DEFAULT 0
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_row public.user_subscriptions%rowtype;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF coalesce(p_credits_balance, 0) < 0 THEN
    RAISE EXCEPTION 'Credits cannot be negative';
  END IF;

  INSERT INTO public.user_subscriptions (
    user_id,
    full_name,
    email,
    plan,
    status,
    billing_status,
    is_affiliate,
    credits_balance,
    subscription_expires_at,
    ai_generations_count,
    image_generations_count,
    video_generations_count,
    prompt_count,
    token_usage,
    infra_cost_estimate,
    updated_at
  ) VALUES (
    p_user_id,
    nullif(trim(coalesce(p_full_name, '')), ''),
    lower(trim(p_email)),
    p_plan,
    p_status,
    coalesce(nullif(trim(p_billing_status), ''), 'unpaid'),
    coalesce(p_is_affiliate, false),
    coalesce(p_credits_balance, 0),
    p_subscription_expires_at,
    greatest(coalesce(p_ai_generations_count, 0), 0),
    greatest(coalesce(p_image_generations_count, 0), 0),
    greatest(coalesce(p_video_generations_count, 0), 0),
    greatest(coalesce(p_prompt_count, 0), 0),
    greatest(coalesce(p_token_usage, 0), 0),
    greatest(coalesce(p_infra_cost_estimate, 0), 0),
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
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

  INSERT INTO public.business_control_change_logs (
    control_id,
    changed_by,
    action_type,
    change_scope,
    before_snapshot,
    after_snapshot,
    requires_confirmation
  ) VALUES (
    NULL,
    v_actor,
    'user_update',
    'user_management',
    NULL,
    jsonb_build_object('user_id', p_user_id, 'email', lower(trim(p_email)), 'plan', p_plan, 'status', p_status),
    false
  );

  RETURN v_row;
END;
$$;

-- admin adjustments for usage/credits
CREATE OR REPLACE FUNCTION public.admin_adjust_user_usage(
  p_user_id UUID,
  p_credit_delta INTEGER DEFAULT 0,
  p_prompt_delta INTEGER DEFAULT 0,
  p_token_delta BIGINT DEFAULT 0,
  p_ai_generation_delta INTEGER DEFAULT 0,
  p_image_generation_delta INTEGER DEFAULT 0,
  p_video_generation_delta INTEGER DEFAULT 0,
  p_infra_cost_delta NUMERIC DEFAULT 0
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_row public.user_subscriptions%rowtype;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User subscription row not found';
  END IF;

  INSERT INTO public.business_control_change_logs (
    control_id,
    changed_by,
    action_type,
    change_scope,
    before_snapshot,
    after_snapshot,
    requires_confirmation
  ) VALUES (
    NULL,
    v_actor,
    'usage_adjust',
    'user_management',
    NULL,
    jsonb_build_object(
      'user_id', p_user_id,
      'credit_delta', coalesce(p_credit_delta, 0),
      'prompt_delta', coalesce(p_prompt_delta, 0),
      'token_delta', coalesce(p_token_delta, 0),
      'ai_generation_delta', coalesce(p_ai_generation_delta, 0),
      'image_generation_delta', coalesce(p_image_generation_delta, 0),
      'video_generation_delta', coalesce(p_video_generation_delta, 0),
      'infra_cost_delta', coalesce(p_infra_cost_delta, 0)
    ),
    false
  );

  RETURN v_row;
END;
$$;

-- admin account removal from subscription ops table
CREATE OR REPLACE FUNCTION public.admin_delete_user_subscription(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  DELETE FROM public.user_subscriptions WHERE user_id = p_user_id;

  INSERT INTO public.business_control_change_logs (
    control_id,
    changed_by,
    action_type,
    change_scope,
    before_snapshot,
    after_snapshot,
    requires_confirmation
  ) VALUES (
    NULL,
    v_actor,
    'user_delete',
    'user_management',
    jsonb_build_object('user_id', p_user_id),
    NULL,
    true
  );

  RETURN true;
END;
$$;

-- use dynamic minimum withdrawal from business controls
CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_amount numeric)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_available numeric(12,2);
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_min_withdrawal numeric(10,2) := 25;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;

  select coalesce(minimum_withdrawal_amount, 25)
  into v_min_withdrawal
  from public.business_controls
  order by updated_at desc
  limit 1;

  if p_amount < v_min_withdrawal then raise exception 'Minimum withdrawal is $%s', v_min_withdrawal; end if;

  perform public.ensure_affiliate_profile();

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id for update;
  if not found then raise exception 'Affiliate profile not found'; end if;
  if v_profile.payout_method is null or coalesce(v_profile.payout_details, '') = '' then raise exception 'Add payout method first'; end if;

  select
    coalesce(sum(case when ae.status = 'available' then ae.amount else 0 end), 0) -
    coalesce((
      select sum(wr.amount + wr.fee_amount)
      from public.withdrawal_requests wr
      where wr.user_id = v_user_id and wr.status in ('pending','approved','paid')
    ), 0)
  into v_available
  from public.affiliate_earnings ae
  where ae.affiliate_user_id = v_user_id;

  if p_amount > greatest(v_available, 0) then raise exception 'Amount exceeds available balance'; end if;

  insert into public.withdrawal_requests (user_id, requester_email, amount, payout_method, payout_details, status)
  values (v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending')
  returning * into v_request;

  return v_request;
end;
$function$;