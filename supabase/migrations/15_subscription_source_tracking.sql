-- ============================================================
-- Payment-Authoritative Subscription Source Tracking
-- ============================================================
-- Adds two columns to user_subscriptions:
--
--   subscription_source TEXT
--     Where the subscription originated:
--     'manual_admin' — admin panel upgrade/downgrade
--     'creem'        — Creem payment webhook
--     'dodo'         — Dodo payment webhook
--     'stripe'       — Stripe payment webhook
--     'promo'        — promotional/complimentary access
--     'affiliate_reward' — earned via affiliate program
--     'internal'     — internal testing account
--     'migration'    — data migration / legacy recovery
--     'trial'        — time-limited trial grant
--
--   is_revenue_eligible BOOLEAN
--     TRUE  → counts toward MRR, ARR, paid user totals
--     FALSE → entitlement only, excluded from all revenue analytics
--
-- BACKFILL LOGIC:
--   Existing rows with amount > 0 and status = 'active'/'trialing'
--   are presumed to be real paid subscriptions and marked eligible.
--   All free-plan seeded rows (plan = 'free') are not eligible.
--   Everything else defaults to NOT eligible (conservative backfill).
-- ============================================================

-- 1. Add subscription_source
alter table public.user_subscriptions
  add column if not exists subscription_source text not null default 'manual_admin';

comment on column public.user_subscriptions.subscription_source is
  'Origin of the subscription: manual_admin, creem, dodo, stripe, promo, affiliate_reward, internal, migration, trial';

-- 2. Add is_revenue_eligible
alter table public.user_subscriptions
  add column if not exists is_revenue_eligible boolean not null default false;

comment on column public.user_subscriptions.is_revenue_eligible is
  'TRUE = counts toward MRR/ARR/paid users. Only real verified payments set this TRUE.';

-- 3. Backfill: rows with real payment amount and active billing → eligible
--    Conservative: only mark as eligible when amount > 0 and not on the free plan seed
update public.user_subscriptions
  set is_revenue_eligible = true,
      subscription_source  = 'creem'      -- assume legacy rows came from real payments
  where is_revenue_eligible = false
    and amount > 0
    and lower(coalesce(plan, 'free')) not in ('free', '')
    and lower(coalesce(status, '')) in ('active', 'trialing');

-- 4. Backfill: all free-plan seeded rows → explicitly not eligible
update public.user_subscriptions
  set is_revenue_eligible = false,
      subscription_source  = 'manual_admin'
  where lower(coalesce(plan, 'free')) = 'free';

-- 5. Index for analytics queries (filtering by eligibility is the hot path)
create index if not exists idx_user_subscriptions_revenue_eligible
  on public.user_subscriptions (is_revenue_eligible, status)
  where is_revenue_eligible = true;
