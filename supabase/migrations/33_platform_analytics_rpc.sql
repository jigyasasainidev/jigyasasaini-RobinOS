-- ============================================================
-- MIGRATION 33 — get_platform_analytics() RPC
-- ============================================================
-- Provides authoritative analytics for the admin Analytics page.
-- Fixes:
--   - MRR: uses plan_entitlements prices, not amount field
--     (amount=0 for admin grants, so raw sum was always wrong)
--   - ARR: MRR × 12
--   - Growth: subscriber delta vs 30 days ago
--   - Churn: cancelled/expired ÷ total ever active
--   - AI telemetry: from feature_usage + usage_tracking
-- ============================================================

-- ── Plan price constants (matches plan_entitlements seed) ──
-- These are the canonical monthly-equivalent prices.
-- Yearly plans are stored as yearly total; divide by 12 for MRR.

create or replace function public.get_platform_analytics()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_admin_role          text;
  v_now                 timestamptz := now() at time zone 'UTC';
  v_30d_ago             timestamptz := v_now - interval '30 days';
  v_60d_ago             timestamptz := v_now - interval '60 days';

  -- MRR / ARR
  v_mrr                 numeric := 0;
  v_arr                 numeric := 0;

  -- Growth
  v_active_now          bigint := 0;
  v_active_30d_ago      bigint := 0;
  v_growth_rate         numeric := 0;

  -- Churn
  v_churned_30d         bigint := 0;
  v_churn_rate          numeric := 0;

  -- AI telemetry
  v_scripts_generated   bigint := 0;
  v_trend_searches      bigint := 0;
  v_caption_generated   bigint := 0;
  v_voice_generated     bigint := 0;
  v_video_generated     bigint := 0;
  v_estimated_ai_cost   numeric := 0;

  -- Subscription breakdown
  v_total_users         bigint := 0;
  v_active_subscribers  bigint := 0;
  v_pending_withdrawals bigint := 0;
  v_affiliate_earnings  numeric := 0;

  -- Plan price lookup
  v_creator_price       numeric;
  v_pro_creator_price   numeric;
  v_agency_price        numeric;
begin
  -- Admin guard
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('error','UNAUTHORIZED');
  end if;

  -- ── Fetch canonical plan prices from platform_settings ────
  -- Falls back to hardcoded defaults if not configured
  select
    coalesce(creator_price, 19),
    coalesce(pro_price, 39),
    coalesce(agency_price, 99)
  into v_creator_price, v_pro_creator_price, v_agency_price
  from public.platform_settings
  order by updated_at desc
  limit 1;

  -- If no platform_settings row, use defaults
  v_creator_price    := coalesce(v_creator_price, 19);
  v_pro_creator_price := coalesce(v_pro_creator_price, 39);
  v_agency_price     := coalesce(v_agency_price, 99);

  -- ── MRR: sum monthly-equivalent value of active subscriptions ──
  -- Uses plan key to look up canonical price, NOT the amount field.
  -- amount=0 for admin grants; plan key is always authoritative.
  -- Yearly plans: divide annual price by 12 for monthly equivalent.
  select coalesce(sum(
    case
      when lower(plan) = 'creator'     and lower(coalesce(billing_cycle,'monthly')) = 'monthly'
        then v_creator_price
      when lower(plan) = 'creator'     and lower(coalesce(billing_cycle,'monthly')) = 'yearly'
        then round((v_creator_price * 10) / 12.0, 2)  -- yearly = 10× monthly
      when lower(plan) = 'pro_creator' and lower(coalesce(billing_cycle,'monthly')) = 'monthly'
        then v_pro_creator_price
      when lower(plan) = 'pro_creator' and lower(coalesce(billing_cycle,'monthly')) = 'yearly'
        then round((v_pro_creator_price * 10) / 12.0, 2)
      when lower(plan) = 'agency'      and lower(coalesce(billing_cycle,'monthly')) = 'monthly'
        then v_agency_price
      when lower(plan) = 'agency'      and lower(coalesce(billing_cycle,'monthly')) = 'yearly'
        then round((v_agency_price * 10) / 12.0, 2)
      else 0
    end
  ), 0)
  into v_mrr
  from public.user_subscriptions
  where lower(status) in ('active','trialing','expiring','grace_period')
    and lower(coalesce(plan,'free')) <> 'free'
    and is_revenue_eligible = true;

  v_arr := v_mrr * 12;

  -- ── Active subscribers now ────────────────────────────────
  select count(*) into v_active_now
  from public.user_subscriptions
  where lower(status) in ('active','trialing','expiring','grace_period')
    and lower(coalesce(plan,'free')) <> 'free'
    and is_revenue_eligible = true;

  -- ── Active subscribers 30 days ago ───────────────────────
  -- Subscriptions that were active at v_30d_ago:
  -- started before v_30d_ago AND (no expiry OR expired after v_30d_ago)
  select count(*) into v_active_30d_ago
  from public.user_subscriptions
  where lower(coalesce(plan,'free')) <> 'free'
    and is_revenue_eligible = true
    and coalesce(starts_at, created_at) <= v_30d_ago
    and (expires_at is null or expires_at > v_30d_ago)
    and lower(status) not in ('cancelled','canceled','payment_failed');

  -- ── Growth rate (subscriber delta) ───────────────────────
  v_growth_rate := case
    when v_active_30d_ago <= 0 then
      case when v_active_now > 0 then 100.0 else 0.0 end
    else
      round(((v_active_now - v_active_30d_ago)::numeric / v_active_30d_ago) * 100, 2)
  end;

  -- ── Churn rate (last 30 days) ─────────────────────────────
  -- Churned = cancelled or expired in last 30 days
  -- Base = active 30 days ago (avoid division by zero)
  select count(*) into v_churned_30d
  from public.user_subscriptions
  where lower(status) in ('cancelled','canceled','expired')
    and lower(coalesce(plan,'free')) <> 'free'
    and is_revenue_eligible = true
    and updated_at >= v_30d_ago;

  v_churn_rate := case
    when v_active_30d_ago <= 0 then 0.0
    else round((v_churned_30d::numeric / v_active_30d_ago) * 100, 2)
  end;

  -- ── AI telemetry — feature_usage (primary) ───────────────
  select coalesce(sum(usage_count), 0) into v_scripts_generated
  from public.feature_usage where feature_name = 'script_generation';

  select coalesce(sum(usage_count), 0) into v_trend_searches
  from public.feature_usage where feature_name = 'trend_scan';

  select coalesce(sum(usage_count), 0) into v_caption_generated
  from public.feature_usage where feature_name = 'caption_generation';

  select coalesce(sum(usage_count), 0) into v_voice_generated
  from public.feature_usage where feature_name = 'tts_generation';

  select coalesce(sum(usage_count), 0) into v_video_generated
  from public.feature_usage where feature_name = 'video_generation';

  -- Fallback to usage_tracking if feature_usage is empty
  if v_scripts_generated = 0 then
    select coalesce(sum(usage_count),0) into v_scripts_generated
    from public.usage_tracking where feature_key = 'script_generation';
  end if;
  if v_trend_searches = 0 then
    select coalesce(sum(usage_count),0) into v_trend_searches
    from public.usage_tracking where feature_key = 'trend_scan';
  end if;
  if v_caption_generated = 0 then
    select coalesce(sum(usage_count),0) into v_caption_generated
    from public.usage_tracking where feature_key = 'caption_generation';
  end if;
  if v_voice_generated = 0 then
    select coalesce(sum(usage_count),0) into v_voice_generated
    from public.usage_tracking where feature_key = 'tts_generation';
  end if;
  if v_video_generated = 0 then
    select coalesce(sum(usage_count),0) into v_video_generated
    from public.usage_tracking where feature_key = 'video_generation';
  end if;

  -- ── Estimated AI cost ─────────────────────────────────────
  -- Groq LLaMA 70B: ~$0.009/script, ~$0.004/trend scan
  -- ElevenLabs TTS: ~$0.010/voice gen
  -- AI/ML API video: ~$0.012/video gen
  -- Caption (Groq): ~$0.006/caption
  v_estimated_ai_cost := round((
    (v_scripts_generated  * 0.009) +
    (v_trend_searches     * 0.004) +
    (v_caption_generated  * 0.006) +
    (v_voice_generated    * 0.010) +
    (v_video_generated    * 0.012)
  )::numeric, 2);

  -- ── Supporting metrics ────────────────────────────────────
  select count(*) into v_total_users from public.profiles;

  v_active_subscribers := v_active_now;

  select count(*) into v_pending_withdrawals
  from public.withdrawal_requests where lower(status) = 'pending';

  select coalesce(sum(amount), 0) into v_affiliate_earnings
  from public.affiliate_commissions
  where lower(status) in ('approved','paid');

  return jsonb_build_object(
    -- KPI cards
    'mrr',                  v_mrr,
    'arr',                  v_arr,
    'growth_rate',          v_growth_rate,
    'churn_rate',           v_churn_rate,
    -- Subscriber counts
    'total_users',          v_total_users,
    'active_subscribers',   v_active_subscribers,
    'active_30d_ago',       v_active_30d_ago,
    'churned_30d',          v_churned_30d,
    -- AI telemetry
    'scripts_generated',    v_scripts_generated,
    'trend_searches',       v_trend_searches,
    'caption_generated',    v_caption_generated,
    'voice_generated',      v_voice_generated,
    'video_generated',      v_video_generated,
    'estimated_ai_cost',    v_estimated_ai_cost,
    -- Financial
    'affiliate_earnings',   v_affiliate_earnings,
    'pending_withdrawals',  v_pending_withdrawals,
    -- Plan prices used (for transparency)
    'plan_prices',          jsonb_build_object(
      'creator',     v_creator_price,
      'pro_creator', v_pro_creator_price,
      'agency',      v_agency_price
    ),
    'computed_at',          v_now
  );
end;
$$;

grant execute on function public.get_platform_analytics()
  to authenticated;

comment on function public.get_platform_analytics() is
  'Admin-only platform analytics. MRR uses plan key prices (not amount field). '
  'AI telemetry from feature_usage + usage_tracking. Growth/churn from subscription history.';

-- ── Index to speed up the 30-day subscriber count ─────────
create index if not exists idx_user_subscriptions_starts_at
  on public.user_subscriptions (starts_at, is_revenue_eligible, status)
  where is_revenue_eligible = true;

create index if not exists idx_user_subscriptions_updated_status
  on public.user_subscriptions (updated_at, status)
  where lower(status) in ('cancelled','expired');
