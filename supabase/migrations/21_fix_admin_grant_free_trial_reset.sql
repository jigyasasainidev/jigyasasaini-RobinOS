-- ============================================================
-- FIX: admin_grant_subscription — reset free_trial_expired
-- ============================================================
-- Root cause:
--   admin_grant_subscription updated profiles.subscription_tier
--   and profiles.current_plan but NEVER set free_trial_expired = false.
--
--   After an admin upgrade:
--     profiles.subscription_tier     = 'pro_creator'  ← correct
--     profiles.free_trial_expired     = true           ← BUG (never reset)
--
--   useFreeTrialStatus() reads profiles.free_trial_expired directly.
--   During the entitlements loading window (placeholderData = FREE_FALLBACK),
--   useIsFree() returns true, which causes useFreeTrialStatus() to read
--   the stale free_trial_expired = true → paywall fires → never dismissed.
--
-- This patch adds free_trial_expired = false to the profiles UPDATE
-- inside admin_grant_subscription so the flag is cleared immediately
-- upon any admin grant of a non-free plan.
--
-- ADDITIVE: Uses CREATE OR REPLACE — no destructive schema change.
-- ============================================================

create or replace function public.admin_grant_subscription(
  p_target_user_id  uuid,
  p_plan_key        text,
  p_billing_cycle   text    default 'monthly',
  p_duration_days   integer default null,
  p_granted_reason  text    default 'Admin grant',
  p_skip_cooldown   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role   text;
  v_now          timestamptz := now();
  v_starts_at    timestamptz := v_now;
  v_expires_at   timestamptz;
  v_duration     integer;
  v_normalized   text;
  v_existing_id  uuid;
begin
  -- ── Auth: must be called by an admin ──────────────────────
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Admin access required');
  end if;

  -- ── Normalize plan key ────────────────────────────────────
  v_normalized := lower(p_plan_key);
  case v_normalized
    when 'starter', 'basic'       then v_normalized := 'creator';
    when 'pro', 'premium'         then v_normalized := 'pro_creator';
    when 'scale_agency'           then v_normalized := 'agency';
    else null;
  end case;

  if v_normalized not in ('free', 'creator', 'pro_creator', 'agency') then
    return jsonb_build_object('success', false, 'code', 'INVALID_PLAN', 'message', 'Invalid plan key: ' || p_plan_key);
  end if;

  -- ── Compute duration ─────────────────────────────────────
  if p_duration_days is not null then
    v_duration := p_duration_days;
  elsif lower(coalesce(p_billing_cycle, 'monthly')) = 'yearly' then
    v_duration := 365;
  else
    v_duration := 30;
  end if;

  -- Free plan = no expiry
  if v_normalized = 'free' then
    v_expires_at := null;
  else
    v_expires_at := v_starts_at + (v_duration || ' days')::interval;
  end if;

  -- ── Check cooldown (unless admin bypasses) ─────────────────
  if not p_skip_cooldown then
    declare
      v_cooldown_check jsonb;
    begin
      v_cooldown_check := public.check_plan_change_cooldown(p_target_user_id);
      if not (v_cooldown_check ->> 'allowed')::boolean then
        return jsonb_build_object(
          'success',         false,
          'code',            'COOLDOWN_ACTIVE',
          'days_remaining',  (v_cooldown_check ->> 'days_remaining')::integer,
          'message',         v_cooldown_check ->> 'message'
        );
      end if;
    end;
  end if;

  -- ── Check if subscription row already exists ──────────────
  select id into v_existing_id
    from public.user_subscriptions
   where user_id = p_target_user_id
   limit 1;

  if found then
    update public.user_subscriptions
       set plan                  = v_normalized,
           status                = 'active',
           billing_cycle         = p_billing_cycle,
           starts_at             = v_starts_at,
           expires_at            = v_expires_at,
           current_period_start  = v_starts_at,
           current_period_end    = v_expires_at,
           last_plan_change_at   = v_now,
           cooldown_until        = case
             when p_skip_cooldown then cooldown_until
             else v_now + interval '14 days'
           end,
           granted_by_admin      = true,
           granted_reason        = p_granted_reason,
           subscription_source   = 'manual_admin',
           is_revenue_eligible   = false,
           updated_at            = v_now
     where user_id = p_target_user_id;
  else
    insert into public.user_subscriptions
      (user_id, plan, status, billing_cycle, starts_at, expires_at,
       current_period_start, current_period_end,
       last_plan_change_at, cooldown_until,
       granted_by_admin, granted_reason,
       subscription_source, is_revenue_eligible,
       amount, currency)
    values
      (p_target_user_id, v_normalized, 'active', p_billing_cycle, v_starts_at, v_expires_at,
       v_starts_at, v_expires_at,
       v_now, case when p_skip_cooldown then null else v_now + interval '14 days' end,
       true, p_granted_reason,
       'manual_admin', false,
       0, 'USD');
  end if;

  -- ── Update profiles for immediate propagation ──────────────
  -- BUG FIX: free_trial_expired must be reset to false on any
  -- non-free grant. Without this, the paywall reads stale
  -- free_trial_expired = true even after the plan is upgraded.
  update public.profiles
     set subscription_tier       = v_normalized,
         current_plan            = v_normalized,
         subscription_expires_at = v_expires_at,
         free_trial_expired      = case
           when v_normalized = 'free' then free_trial_expired  -- preserve on free downgrade
           else false                                            -- ← THE FIX
         end,
         updated_at              = v_now
   where user_id = p_target_user_id;

  return jsonb_build_object(
    'success',       true,
    'user_id',       p_target_user_id,
    'plan',          v_normalized,
    'billing_cycle', p_billing_cycle,
    'starts_at',     v_starts_at,
    'expires_at',    v_expires_at,
    'duration_days', v_duration,
    'granted_by',    auth.uid(),
    'reason',        p_granted_reason
  );
end;
$$;

grant execute on function public.admin_grant_subscription(uuid, text, text, integer, text, boolean) to authenticated;

comment on function public.admin_grant_subscription(uuid, text, text, integer, text, boolean) is
  'Admin-only: grant a timed subscription to any user. Resets free_trial_expired on non-free grants.';

-- ── Backfill: fix any currently-broken admin-upgraded accounts ─
-- Any user who has a non-free subscription_tier but still has
-- free_trial_expired = true is in the broken state. Reset them now.
update public.profiles
   set free_trial_expired = false
 where subscription_tier in ('creator', 'pro_creator', 'agency', 'scale_agency')
   and free_trial_expired = true;
