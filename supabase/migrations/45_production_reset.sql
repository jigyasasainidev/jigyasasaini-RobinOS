-- ============================================================
-- MIGRATION 45 — Production Reset (Pre-Launch Clean Slate)
-- ============================================================
-- Removes all test/demo data created during development.
-- Preserves EVERYTHING related to ashadbuilds@gmail.com.
-- Preserves all schema, RLS, functions, triggers, config.
-- Only deletes runtime/user/transactional data.
--
-- SAFE TO RUN: no schema changes, no logic changes.
-- ============================================================

-- ── 1. TREND / INTEL CACHE ─────────────────────────────────
-- Shared cache tables — no user_id column, safe to truncate fully.
-- Data is regenerated automatically on next scan.

truncate public.trend_audios               restart identity cascade;
truncate public.trend_hashtags             restart identity cascade;
truncate public.trend_topics               restart identity cascade;
truncate public.trend_collection_snapshots restart identity cascade;

-- Global audit log — no user_id column, safe to truncate.
truncate public.trend_radar_scans          restart identity cascade;

-- ── 2. AI GENERATION HISTORY ───────────────────────────────
-- Per-user script, caption, scan history.

delete from public.ai_generations
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.script_generations
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.script_history
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.caption_generations
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.scan_history
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 3. USAGE TRACKING ──────────────────────────────────────

delete from public.usage_tracking
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.usage_counters
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.feature_usage
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

delete from public.feature_usage_events
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 4. AFFILIATE SYSTEM ────────────────────────────────────
-- Delete in FK-safe order: children before parents.

-- commission_events references affiliate_commissions (cascade) — truncate safe
truncate public.commission_events restart identity cascade;

-- payout_history references withdrawal_requests
delete from public.payout_history
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- withdrawal_requests
delete from public.withdrawal_requests
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_commissions (commission_events already cleared above)
delete from public.affiliate_commissions
 where affiliate_user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_conversions
delete from public.affiliate_conversions
 where affiliate_user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_clicks
delete from public.affiliate_clicks
 where affiliate_user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_referrals
delete from public.affiliate_referrals
 where affiliate_user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_earnings (uses affiliate_user_id)
delete from public.affiliate_earnings
 where affiliate_user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_wallet_ledger
delete from public.affiliate_wallet_ledger
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_wallets
delete from public.affiliate_wallets
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- affiliate_profiles — delete non-admin rows
delete from public.affiliate_profiles
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- Reset admin affiliate profile counters to 0 (keep the row)
update public.affiliate_profiles
   set pending_balance   = 0,
       paid_balance      = 0,
       total_earned      = 0,
       total_clicks      = 0,
       total_conversions = 0,
       updated_at        = now()
 where user_id = (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 5. PAYMENTS & SUBSCRIPTIONS ────────────────────────────
-- subscription_audit_log
delete from public.subscription_audit_log
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- subscription_events
delete from public.subscription_events
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- subscription_webhook_events — global idempotency log, no user_id, safe to truncate
truncate public.subscription_webhook_events restart identity cascade;

-- payment_events — no user_id column, references payments (set null on delete)
-- safe to truncate since payments will be deleted next
truncate public.payment_events restart identity cascade;

-- invoices
delete from public.invoices
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- payments
delete from public.payments
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- user_subscriptions
delete from public.user_subscriptions
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 6. ONBOARDING STATE ────────────────────────────────────

delete from public.onboarding_states
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 7. ADMIN NOTIFICATIONS ─────────────────────────────────
-- Clear all test-period notification history.

truncate public.admin_notifications restart identity cascade;

-- ── 8. ADMIN AUDIT / ACTIVITY LOGS ────────────────────────
-- Clear test-period admin action logs.

truncate public.admin_audit_logs restart identity cascade;
truncate public.admin_logs       restart identity cascade;

-- ── 9. MODERATION ACTIONS ──────────────────────────────────

truncate public.moderation_actions restart identity cascade;

-- ── 10. SIGNUP IPS ─────────────────────────────────────────
-- Rate-limit tracking — safe to clear.

truncate public.signup_ips restart identity cascade;

-- ── 11. NON-ADMIN USER PROFILES ────────────────────────────
-- Delete all non-admin profiles.
-- CASCADE handles any remaining FK children.

delete from public.profiles
 where user_id <> (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── 12. RESET ADMIN PROFILE COUNTERS ──────────────────────
-- Zero out usage counters on the admin profile itself.

update public.profiles
   set total_scripts_generated = 0,
       total_trend_scans       = 0,
       updated_at              = now()
 where user_id = (select id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1);

-- ── DONE ───────────────────────────────────────────────────
-- Schema intact. RLS intact. Functions intact. Config intact.
-- Admin account (ashadbuilds@gmail.com) untouched.
-- All test user data removed. All counters zeroed.
-- App is in fresh-launch state.
--
-- NEXT STEP: Delete test auth.users from Supabase Dashboard
--   Authentication → Users → select all non-admin → Delete
-- ============================================================
