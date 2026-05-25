-- ============================================================
-- CANONICAL PLAN KEY CONSTRAINTS
-- Ensures split-brain is impossible at the database layer.
-- ============================================================
-- This migration:
--   1. Normalizes all existing plan_key values to lowercase
--      canonical form before adding constraints
--   2. Adds CHECK constraints on user_subscriptions.plan
--      and profiles.subscription_tier + current_plan
--   3. Ensures resolve_user_plan always returns a lowercase
--      canonical value by updating the normalization table
-- ============================================================

-- ── 1. Normalize existing data BEFORE constraints ────────────

-- user_subscriptions.plan: normalize to canonical lowercase
update public.user_subscriptions
   set plan = case lower(coalesce(plan, 'free'))
     when 'pro'           then 'pro_creator'
     when 'premium'       then 'pro_creator'
     when 'starter'       then 'creator'
     when 'basic'         then 'creator'
     when 'scale_agency'  then 'agency'
     else lower(coalesce(plan, 'free'))
   end
 where lower(coalesce(plan, 'free')) not in ('free', 'creator', 'pro_creator', 'agency');

-- profiles.subscription_tier: normalize to canonical lowercase
update public.profiles
   set subscription_tier = case lower(coalesce(subscription_tier, 'free'))
     when 'pro'           then 'pro_creator'
     when 'premium'       then 'pro_creator'
     when 'starter'       then 'creator'
     when 'basic'         then 'creator'
     when 'scale_agency'  then 'agency'
     else lower(coalesce(subscription_tier, 'free'))
   end
 where lower(coalesce(subscription_tier, 'free')) not in ('free', 'creator', 'pro_creator', 'agency');

-- profiles.current_plan: normalize to canonical lowercase
update public.profiles
   set current_plan = case lower(coalesce(current_plan, 'free'))
     when 'pro'           then 'pro_creator'
     when 'premium'       then 'pro_creator'
     when 'starter'       then 'creator'
     when 'basic'         then 'creator'
     when 'scale_agency'  then 'agency'
     else lower(coalesce(current_plan, 'free'))
   end
 where lower(coalesce(current_plan, 'free')) not in ('free', 'creator', 'pro_creator', 'agency');

-- ── 2. CHECK constraints — enforce canonical values ────────────
-- These prevent any future write with an invalid plan key.

alter table public.user_subscriptions
  add constraint chk_subscription_plan_canonical
    check (
      plan in ('free', 'creator', 'pro_creator', 'agency')
    );

-- subscription status: normalize existing
update public.user_subscriptions
   set status = lower(coalesce(status, 'active'))
 where lower(coalesce(status, 'active')) not in ('active', 'expired', 'cancelled', 'past_due', 'suspended', 'trialing');

alter table public.user_subscriptions
  add constraint chk_subscription_status_canonical
    check (
      status in ('active', 'expired', 'cancelled', 'past_due', 'suspended', 'trialing')
    );

-- profiles.subscription_tier CHECK
alter table public.profiles
  add constraint chk_profile_subscription_tier_canonical
    check (
      subscription_tier is null
      or subscription_tier in ('free', 'creator', 'pro_creator', 'agency')
    );

-- profiles.current_plan CHECK
alter table public.profiles
  add constraint chk_profile_current_plan_canonical
    check (
      current_plan is null
      or current_plan in ('free', 'creator', 'pro_creator', 'agency')
    );

-- ── 3. plan_entitlements: ensure plan_key values are canonical ─

update public.plan_entitlements
   set plan_key = lower(plan_key)
 where plan_key != lower(plan_key);

-- ── 4. Comment the constraints ────────────────────────────────

comment on constraint chk_subscription_plan_canonical on public.user_subscriptions is
  'Enforces canonical lowercase plan keys. Only: free, creator, pro_creator, agency. '
  'Prevents split-brain between DB, entitlement resolver, and frontend.';

comment on constraint chk_subscription_status_canonical on public.user_subscriptions is
  'Enforces canonical status values: active, expired, cancelled, past_due, suspended, trialing.';
