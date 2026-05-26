-- ============================================================
-- MIGRATION 40 — Fix conversion count + affiliate dashboard
-- ============================================================
-- Root cause of "200% conversion rate":
--   total_conversions incremented at BOTH signup AND payment.
--   conversion_count should only reflect PAID conversions.
--
-- Fix: get_affiliate_dashboard() now counts paid conversions
--   directly from affiliate_commissions where plan_code != 'signup'
--   instead of using the total_conversions counter.
-- ============================================================

-- ── Updated get_affiliate_dashboard() ─────────────────────

create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_profile   record;
  v_paid_conversions integer;
  v_locked    numeric;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  -- Get affiliate profile
  select
    ap.user_id,
    ap.referral_code,
    coalesce(ap.total_clicks, 0)       as total_clicks,
    coalesce(ap.total_conversions, 0)  as total_conversions,
    coalesce(ap.total_earned, 0)       as total_earned,
    coalesce(ap.pending_balance, 0)    as pending_balance,
    coalesce(ap.locked_balance, 0)     as locked_balance,
    coalesce(ap.paid_balance, 0)       as paid_balance,
    ap.payout_method,
    ap.payout_details,
    coalesce(ap.payout_verified, false) as payout_verified,
    ap.updated_at                      as payout_updated_at
  into v_profile
  from public.affiliate_profiles ap
  where ap.user_id = v_user_id;

  if not found then
    return jsonb_build_object('error', 'PROFILE_NOT_FOUND');
  end if;

  -- Count PAID conversions only (plan_code != 'signup', status not reversed)
  -- This prevents double-counting signup + payment conversions
  select count(distinct referred_user_id)
    into v_paid_conversions
    from public.affiliate_commissions
   where affiliate_user_id = v_user_id
     and plan_code <> 'signup'
     and status not in ('reversed', 'cancelled');

  v_paid_conversions := coalesce(v_paid_conversions, 0);

  -- Locked balance = sum of pending commissions in cooldown
  select coalesce(sum(amount), 0)
    into v_locked
    from public.affiliate_commissions
   where affiliate_user_id = v_user_id
     and status = 'pending';

  -- Sync locked_balance if it drifted
  if v_locked <> v_profile.locked_balance then
    update public.affiliate_profiles
       set locked_balance = v_locked, updated_at = now()
     where user_id = v_user_id;
    v_profile.locked_balance := v_locked;
  end if;

  return jsonb_build_object(
    'user_id',          v_profile.user_id,
    'referral_code',    v_profile.referral_code,
    'referral_link',    'https://tryrobin.xyz/?ref=' || v_profile.referral_code,
    -- total_referrals = unique users who clicked (total_clicks)
    'total_referrals',  v_profile.total_clicks,
    -- conversion_count = only PAID plan conversions (not signup events)
    'conversion_count', v_paid_conversions,
    'converted_referrals', v_paid_conversions,
    'referral_clicks',  v_profile.total_clicks,
    -- Earnings
    'total_earned',     v_profile.total_earned,
    'available_balance', v_profile.pending_balance,   -- approved, withdrawable
    'locked_balance',   v_profile.locked_balance,     -- in 14d cooldown
    'pending_earnings', v_profile.locked_balance,     -- alias for UI
    'paid_out',         v_profile.paid_balance,
    -- Payout
    'payout_method',    v_profile.payout_method,
    'payout_details',   v_profile.payout_details,
    'payout_verified',  v_profile.payout_verified,
    'payout_updated_at', v_profile.payout_updated_at
  );
end;
$$;

grant execute on function public.get_affiliate_dashboard()
  to authenticated, anon;

comment on function public.get_affiliate_dashboard() is
  'Returns affiliate dashboard data. conversion_count = paid plan conversions only '
  '(excludes signup events to prevent double-counting). '
  'available_balance = approved commissions (withdrawable). '
  'locked_balance = pending commissions in 14-day cooldown.';
