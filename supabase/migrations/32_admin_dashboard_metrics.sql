-- ============================================================
-- MIGRATION 32 — ADMIN DASHBOARD METRICS RPC
-- ============================================================
-- Root cause: AdminDashboard queries ai_generations table which
-- nothing writes to. Actual usage is in:
--   - feature_usage (written by trackFeatureUsage after generation)
--   - usage_tracking (written by check_and_increment_usage RPC)
--
-- This migration creates get_admin_dashboard_metrics() which
-- aggregates from the correct authoritative tables.
-- ============================================================

-- ── Ensure service_role can read feature_usage ────────────
-- (already has policy but make sure it covers SELECT)
drop policy if exists "Service role manages feature usage" on public.feature_usage;
create policy "Service role manages feature usage"
  on public.feature_usage for all to service_role
  using (true) with check (true);

drop policy if exists "Service role reads usage tracking" on public.usage_tracking;
create policy "Service role reads usage tracking"
  on public.usage_tracking for select to service_role
  using (true);

-- ── Index for fast admin aggregation ─────────────────────
create index if not exists idx_feature_usage_feature_name_count
  on public.feature_usage (feature_name, usage_count);

create index if not exists idx_usage_tracking_feature_key_count
  on public.usage_tracking (feature_key, usage_count);

-- ── get_admin_dashboard_metrics() ────────────────────────
-- Single RPC that returns all admin dashboard metric values.
-- Aggregates from authoritative tables only.
-- SECURITY DEFINER + admin-only guard.
-- Returns null-safe values (COALESCE everywhere).

create or replace function public.get_admin_dashboard_metrics()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_admin_role          text;
  v_total_users         bigint;
  v_active_subscribers  bigint;
  v_monthly_revenue     numeric;
  v_scripts_generated   bigint;
  v_trend_searches      bigint;
  v_caption_generated   bigint;
  v_voice_generated     bigint;
  v_video_generated     bigint;
  v_affiliate_earnings  numeric;
  v_pending_withdrawals bigint;
  v_estimated_ai_cost   numeric;
begin
  -- Admin guard
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('error','UNAUTHORIZED');
  end if;

  -- ── Total users ──────────────────────────────────────────
  select count(*) into v_total_users
  from public.profiles;

  -- ── Active subscribers (revenue-eligible, active/trialing) ──
  select count(distinct user_id) into v_active_subscribers
  from public.user_subscriptions
  where lower(status) in ('active','trialing')
    and is_revenue_eligible = true
    and lower(coalesce(plan,'free')) <> 'free';

  -- ── Monthly revenue (active revenue-eligible subscriptions) ──
  select coalesce(sum(amount), 0) into v_monthly_revenue
  from public.user_subscriptions
  where lower(status) in ('active','trialing')
    and is_revenue_eligible = true
    and lower(coalesce(plan,'free')) <> 'free';

  -- ── Scripts generated — from feature_usage (primary source) ──
  -- feature_usage is written by trackFeatureUsage() after every
  -- successful generation. Sum all usage_count for script_generation.
  select coalesce(sum(usage_count), 0) into v_scripts_generated
  from public.feature_usage
  where feature_name = 'script_generation';

  -- Fallback: also check usage_tracking if feature_usage is empty
  if v_scripts_generated = 0 then
    select coalesce(sum(usage_count), 0) into v_scripts_generated
    from public.usage_tracking
    where feature_key = 'script_generation';
  end if;

  -- ── Trend searches — from feature_usage (primary source) ──
  select coalesce(sum(usage_count), 0) into v_trend_searches
  from public.feature_usage
  where feature_name = 'trend_scan';

  if v_trend_searches = 0 then
    select coalesce(sum(usage_count), 0) into v_trend_searches
    from public.usage_tracking
    where feature_key = 'trend_scan';
  end if;

  -- ── Caption generations ───────────────────────────────────
  select coalesce(sum(usage_count), 0) into v_caption_generated
  from public.feature_usage
  where feature_name = 'caption_generation';

  if v_caption_generated = 0 then
    select coalesce(sum(usage_count), 0) into v_caption_generated
    from public.usage_tracking
    where feature_key = 'caption_generation';
  end if;

  -- ── Voice generations ─────────────────────────────────────
  select coalesce(sum(usage_count), 0) into v_voice_generated
  from public.feature_usage
  where feature_name = 'tts_generation';

  if v_voice_generated = 0 then
    select coalesce(sum(usage_count), 0) into v_voice_generated
    from public.usage_tracking
    where feature_key = 'tts_generation';
  end if;

  -- ── Video generations ─────────────────────────────────────
  select coalesce(sum(usage_count), 0) into v_video_generated
  from public.feature_usage
  where feature_name = 'video_generation';

  if v_video_generated = 0 then
    select coalesce(sum(usage_count), 0) into v_video_generated
    from public.usage_tracking
    where feature_key = 'video_generation';
  end if;

  -- ── Affiliate earnings ────────────────────────────────────
  select coalesce(sum(amount), 0) into v_affiliate_earnings
  from public.affiliate_commissions
  where lower(status) in ('approved','paid');

  -- ── Pending withdrawals ───────────────────────────────────
  select count(*) into v_pending_withdrawals
  from public.withdrawal_requests
  where lower(status) = 'pending';

  -- ── Estimated AI cost ─────────────────────────────────────
  -- Rough estimate: scripts ~$0.009/gen, voice ~$0.01/gen, video ~$0.012/gen
  v_estimated_ai_cost :=
    (v_scripts_generated  * 0.009) +
    (v_caption_generated  * 0.006) +
    (v_voice_generated    * 0.010) +
    (v_video_generated    * 0.012) +
    (v_trend_searches     * 0.004);

  return jsonb_build_object(
    -- Core metrics
    'total_users',          v_total_users,
    'active_subscribers',   v_active_subscribers,
    'monthly_revenue',      v_monthly_revenue,
    -- Usage metrics (the ones that were broken)
    'scripts_generated',    v_scripts_generated,
    'trend_searches',       v_trend_searches,
    'caption_generated',    v_caption_generated,
    'voice_generated',      v_voice_generated,
    'video_generated',      v_video_generated,
    -- Financial
    'affiliate_earnings',   v_affiliate_earnings,
    'pending_withdrawals',  v_pending_withdrawals,
    'estimated_ai_cost',    round(v_estimated_ai_cost::numeric, 2),
    -- Meta
    'computed_at',          now() at time zone 'UTC'
  );
end;
$$;

grant execute on function public.get_admin_dashboard_metrics()
  to authenticated;

comment on function public.get_admin_dashboard_metrics() is
  'Admin-only aggregated dashboard metrics. '
  'Reads from feature_usage (primary) and usage_tracking (fallback). '
  'Returns scripts_generated and trend_searches from authoritative tables.';

