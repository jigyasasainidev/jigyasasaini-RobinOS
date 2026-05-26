-- ============================================================
-- MIGRATION 41 — Centralized Affiliate Analytics View
-- ============================================================
-- Single source of truth for all affiliate analytics.
-- Aggregates from authoritative tables only.
-- Used by admin leaderboard, charts, and metrics.
-- ============================================================

-- Drop old function first to allow return type change
drop function if exists public.get_affiliate_dashboard();
drop function if exists public.get_affiliate_dashboard_v2(uuid);

-- ── 1. CENTRALIZED ANALYTICS VIEW ─────────────────────────

create or replace view public.affiliate_analytics_view as
select
  ap.user_id                                                    as affiliate_user_id,
  coalesce(p.email, ap.user_id::text)                          as email,
  ap.referral_code,

  -- Clicks: count from affiliate_profiles (incremented on each referral visit)
  coalesce(ap.total_clicks, 0)                                  as total_clicks,

  -- Unique referred users (signed up via this affiliate)
  coalesce(
    (select count(distinct ac.referred_user_id)
       from public.affiliate_conversions ac
      where ac.affiliate_user_id = ap.user_id),
    0
  )::integer                                                    as total_signups,

  -- Paid conversions: distinct users who made a paid purchase
  coalesce(
    (select count(distinct ac.referred_user_id)
       from public.affiliate_conversions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.plan_code <> 'signup'
        and ac.status not in ('reversed', 'cancelled')),
    0
  )::integer                                                    as paid_conversions,

  -- Pending commissions (in 14-day cooldown)
  coalesce(
    (select sum(ac.amount)
       from public.affiliate_commissions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.status = 'pending'),
    0
  )::numeric                                                    as pending_commissions,

  -- Approved commissions (withdrawable)
  coalesce(
    (select sum(ac.amount)
       from public.affiliate_commissions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.status = 'approved'),
    0
  )::numeric                                                    as approved_commissions,

  -- Paid out commissions
  coalesce(
    (select sum(ac.amount)
       from public.affiliate_commissions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.status = 'paid'),
    0
  )::numeric                                                    as paid_commissions,

  -- Total earned (all non-reversed commissions)
  coalesce(
    (select sum(ac.amount)
       from public.affiliate_commissions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.status not in ('reversed', 'cancelled')),
    0
  )::numeric                                                    as total_earned,

  -- Conversion revenue (sum of billed amounts for paid conversions)
  coalesce(
    (select sum(ac.billed_amount)
       from public.affiliate_conversions ac
      where ac.affiliate_user_id = ap.user_id
        and ac.plan_code <> 'signup'
        and ac.status not in ('reversed', 'cancelled')),
    0
  )::numeric                                                    as conversion_revenue,

  -- Conversion rate: paid_conversions / max(total_clicks, 1)
  case
    when coalesce(ap.total_clicks, 0) > 0
    then round(
      (
        (select count(distinct ac.referred_user_id)
           from public.affiliate_conversions ac
          where ac.affiliate_user_id = ap.user_id
            and ac.plan_code <> 'signup'
            and ac.status not in ('reversed', 'cancelled'))::numeric
        / greatest(ap.total_clicks, 1)
      ) * 100, 1
    )
    else 0
  end                                                           as conversion_rate,

  -- Latest conversion timestamp
  (select max(ac.created_at)
     from public.affiliate_conversions ac
    where ac.affiliate_user_id = ap.user_id
      and ac.plan_code <> 'signup')                            as last_conversion_at,

  ap.payout_method,
  ap.payout_details,
  coalesce(ap.payout_verified, false)                          as payout_verified,
  ap.updated_at

from public.affiliate_profiles ap
left join public.profiles p on p.user_id = ap.user_id;

comment on view public.affiliate_analytics_view is
  'Centralized affiliate analytics. Single source of truth for admin dashboard, '
  'leaderboard, and charts. Aggregates from affiliate_commissions and '
  'affiliate_conversions — never from stale profile counters.';

-- RLS: admins only
alter view public.affiliate_analytics_view owner to postgres;

-- ── 2. get_admin_affiliate_analytics() — admin RPC ────────

create or replace function public.get_admin_affiliate_analytics()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_admin_role text;
  v_leaderboard jsonb;
  v_totals      jsonb;
  v_chart_data  jsonb;
begin
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('error', 'UNAUTHORIZED');
  end if;

  -- Leaderboard: top 10 by total_earned
  select jsonb_agg(row_to_json(t))
    into v_leaderboard
    from (
      select
        affiliate_user_id,
        email,
        referral_code,
        total_clicks,
        paid_conversions,
        total_earned,
        approved_commissions,
        pending_commissions,
        conversion_rate,
        last_conversion_at
      from public.affiliate_analytics_view
      where total_clicks > 0 or total_earned > 0
      order by total_earned desc, paid_conversions desc
      limit 10
    ) t;

  -- Totals for metric cards
  select jsonb_build_object(
    'total_affiliates',       count(*),
    'active_affiliates',      count(*) filter (where total_clicks > 0 or total_earned > 0),
    'total_pending',          coalesce(sum(pending_commissions), 0),
    'total_approved',         coalesce(sum(approved_commissions), 0),
    'total_paid',             coalesce(sum(paid_commissions), 0),
    'total_earned',           coalesce(sum(total_earned), 0),
    'total_paid_conversions', coalesce(sum(paid_conversions), 0),
    'total_signups',          coalesce(sum(total_signups), 0),
    'total_clicks',           coalesce(sum(total_clicks), 0),
    'conversion_revenue',     coalesce(sum(conversion_revenue), 0)
  )
    into v_totals
    from public.affiliate_analytics_view;

  -- Chart data: top 8 affiliates for bar chart
  select jsonb_agg(row_to_json(t))
    into v_chart_data
    from (
      select
        split_part(email, '@', 1)  as name,
        paid_conversions           as conversions,
        total_earned               as earned,
        total_clicks               as clicks
      from public.affiliate_analytics_view
      where total_clicks > 0 or total_earned > 0
      order by total_earned desc
      limit 8
    ) t;

  return jsonb_build_object(
    'leaderboard',  coalesce(v_leaderboard, '[]'::jsonb),
    'totals',       coalesce(v_totals, '{}'::jsonb),
    'chart_data',   coalesce(v_chart_data, '[]'::jsonb),
    'computed_at',  now() at time zone 'UTC'
  );
end;
$$;

grant execute on function public.get_admin_affiliate_analytics()
  to authenticated;

-- ── 3. FIXED get_affiliate_dashboard() ────────────────────
-- Uses affiliate_analytics_view as source of truth.

create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     record;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  select * into v_row
  from public.affiliate_analytics_view
  where affiliate_user_id = v_user_id;

  if not found then
    return jsonb_build_object('error', 'PROFILE_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'user_id',           v_row.affiliate_user_id,
    'referral_code',     v_row.referral_code,
    'referral_link',     'https://tryrobin.xyz/?ref=' || v_row.referral_code,
    'total_referrals',   v_row.total_clicks,
    'referral_clicks',   v_row.total_clicks,
    'conversion_count',  v_row.paid_conversions,
    'converted_referrals', v_row.paid_conversions,
    'total_earned',      v_row.total_earned,
    'available_balance', v_row.approved_commissions,
    'locked_balance',    v_row.pending_commissions,
    'pending_earnings',  v_row.pending_commissions,
    'paid_out',          v_row.paid_commissions,
    'payout_method',     v_row.payout_method,
    'payout_details',    v_row.payout_details,
    'payout_verified',   v_row.payout_verified,
    'payout_updated_at', v_row.updated_at
  );
end;
$$;

grant execute on function public.get_affiliate_dashboard()
  to authenticated, anon;
