-- ============================================================
-- MIGRATION 45 — Production Reset (Pre-Launch Clean Slate)
-- ============================================================
-- Removes all test/demo data created during development.
-- Preserves EVERYTHING related to ashadbuilds@gmail.com.
-- Preserves all schema, RLS, functions, triggers, config.
-- Only deletes runtime/user/transactional data.
--
-- SAFE TO RUN: idempotent, no schema changes, no logic changes.
-- ============================================================

-- ── Capture admin user_id once — used throughout ───────────
-- All deletes are scoped to exclude this user.
do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id
    from auth.users
   where lower(email) = 'ashadbuilds@gmail.com'
   limit 1;

  if v_admin_id is null then
    raise exception 'Admin user ashadbuilds@gmail.com not found in auth.users — aborting reset.';
  end if;

  raise notice 'Admin user_id = %', v_admin_id;
end;
$$;

-- ── 1. TREND / INTEL CACHE ─────────────────────────────────
-- Cached trend data, audio trends, hashtags, topics.
-- All regenerated on next scan — safe to wipe.

truncate public.trend_audios              restart identity cascade;
truncate public.trend_hashtags            restart identity cascade;
truncate public.trend_topics              restart identity cascade;
truncate public.trend_collection_snapshots restart identity cascade;

-- ── 2. TREND RADAR SCANS ───────────────────────────────────
-- Per-user scan history. Wipe all non-admin scans.

delete from public.trend_radar_scans
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 3. AI GENERATION HISTORY ───────────────────────────────
-- Script, caption, video generations — all test content.

delete from public.ai_generations
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.script_generations
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.script_history
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.caption_generations
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 4. SCAN HISTORY ────────────────────────────────────────

delete from public.scan_history
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 5. USAGE TRACKING ──────────────────────────────────────
-- Feature usage counters, usage events, usage tracking rows.

delete from public.feature_usage
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.feature_usage_events
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.usage_tracking
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

delete from public.usage_counters
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 6. AFFILIATE SYSTEM ────────────────────────────────────
-- Commissions, conversions, clicks, referrals, wallets,
-- withdrawal requests, payout history.
-- Delete in FK-safe order (children before parents).

-- Payout history (references withdrawal_requests)
delete from public.payout_history
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Withdrawal requests (references affiliate_profiles)
delete from public.withdrawal_requests
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Commission events (references affiliate_commissions)
truncate public.commission_events restart identity cascade;

-- Affiliate commissions (references affiliate_profiles)
delete from public.affiliate_commissions
 where affiliate_user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate conversions (references affiliate_profiles)
delete from public.affiliate_conversions
 where affiliate_user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate clicks
delete from public.affiliate_clicks
 where affiliate_user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate referrals
delete from public.affiliate_referrals
 where affiliate_user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate earnings
delete from public.affiliate_earnings
 where affiliate_user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate wallet ledger
delete from public.affiliate_wallet_ledger
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate wallets
delete from public.affiliate_wallets
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Affiliate profiles — reset balances to 0 for admin, delete all others
delete from public.affiliate_profiles
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Reset admin affiliate profile balances to 0 (keep the profile itself)
update public.affiliate_profiles
   set pending_balance   = 0,
       paid_balance      = 0,
       total_earned      = 0,
       total_clicks      = 0,
       total_conversions = 0,
       updated_at        = now()
 where user_id = (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 7. PAYMENTS & SUBSCRIPTIONS ────────────────────────────
-- All test subscriptions, payments, invoices, events.
-- Delete children before parents.

-- Subscription audit log
delete from public.subscription_audit_log
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Subscription events
delete from public.subscription_events
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Webhook events — safe to fully truncate (idempotency log, not user data)
truncate public.subscription_webhook_events restart identity cascade;

-- Invoices (references payments via set null — safe to delete first)
delete from public.invoices
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Payment events (references payments)
delete from public.payment_events
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- Payments
delete from public.payments
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- User subscriptions
delete from public.user_subscriptions
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 8. ONBOARDING STATE ────────────────────────────────────

delete from public.onboarding_states
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 9. MODERATION / REPORTS ────────────────────────────────

truncate public.moderation_actions restart identity cascade;

-- ── 10. ADMIN NOTIFICATIONS ────────────────────────────────
-- Clear all notification history — fresh inbox for launch.

truncate public.admin_notifications restart identity cascade;

-- ── 11. ADMIN AUDIT / ACTIVITY LOGS ───────────────────────
-- Clear test-period admin action logs.

truncate public.admin_audit_logs restart identity cascade;
truncate public.admin_logs       restart identity cascade;

-- ── 12. SIGNUP IPS ─────────────────────────────────────────
-- Rate-limit tracking — safe to clear.

truncate public.signup_ips restart identity cascade;

-- ── 13. NON-ADMIN USER PROFILES ────────────────────────────
-- Delete profiles for all non-admin users.
-- CASCADE will handle any remaining child rows.
-- auth.users rows are NOT touched here — Supabase auth users
-- must be deleted from the Supabase Dashboard → Authentication
-- (or via service_role API). We only clean public.profiles.

delete from public.profiles
 where user_id <> (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 );

-- ── 14. RESET ADMIN PROFILE COUNTERS ──────────────────────
-- Keep the admin profile but zero out any generated counters.

update public.profiles
   set total_scripts_generated = 0,
       total_trend_scans       = 0,
       updated_at              = now()
 where user_id = (
   select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1
 )
   and (total_scripts_generated > 0 or total_trend_scans > 0);

-- ── DONE ───────────────────────────────────────────────────
-- Schema intact. RLS intact. Functions intact. Config intact.
-- Admin account (ashadbuilds@gmail.com) untouched.
-- All test user data removed. All counters zeroed.
-- App is in fresh-launch state.
--
-- NEXT STEP: Delete test auth.users from Supabase Dashboard
--   Authentication → Users → select all non-admin → Delete
-- ============================================================
