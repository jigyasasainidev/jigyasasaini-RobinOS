-- ============================================================
-- MIGRATION 67 — REMOVE ALL BACKEND LIMITS (NO QUOTAS)
-- ============================================================
-- Makes EVERY feature UNLIMITED for EVERY plan, so the backend can
-- never return FEATURE_DISABLED or USAGE_LIMIT_EXCEEDED.
--
-- How enforcement works in this codebase:
--   edge functions -> check_and_increment_usage()
--                  -> consume_usage() -> plan_entitlements
-- Setting every plan_entitlements row to (-1 / day / enabled)
-- puts consume_usage() on its "unlimited" branch → always ALLOWED.
--
-- This also covers the legacy paths:
--   get_usage_status() -> get_usage_status_v2() -> plan_entitlements
--   consume_feature_quota() -> get_usage_status()
--
-- Idempotent: safe to re-run. No schema changes. No data loss.
-- ============================================================

-- ── 1. Flatten every existing entitlement row to UNLIMITED ──
update public.plan_entitlements
set
  limit_value  = -1,          -- -1 = unlimited
  limit_period = 'day',       -- daily window, unlimited
  enabled      = true,        -- never disabled
  updated_at   = now();

-- ── 2. Insert any missing plan×feature rows as UNLIMITED ────
-- Guarantees get_entitlement() never hits "not found" →
-- FEATURE_DISABLED is impossible.
insert into public.plan_entitlements
  (plan_key, feature_key, limit_value, limit_period, enabled, metadata)
select
  p.plan_key,
  f.feature_key,
  -1, 'day', true, '{}'::jsonb
from (values ('free'), ('creator'), ('pro_creator'), ('agency'),
             ('scale_agency'), ('starter'), ('pro')) as p(plan_key)
cross join (values
  ('script_generation'), ('caption_generation'), ('trend_scan'),
  ('hashtag_scan'), ('tts_generation'), ('video_generation'),
  ('byok_access'), ('analytics_access'), ('watermark_removal'),
  ('automation_tools'), ('export_access'), ('team_workspaces')
) as f(feature_key)
on conflict (plan_key, feature_key) do update
  set limit_value  = -1,
      limit_period = 'day',
      enabled      = true,
      updated_at   = now();

-- ── 3. Neutralize legacy platform_settings free-tier caps ───
-- Not enforced by the current engine, but kept consistent so no
-- stale "free_scripts_limit" can ever gate a user.
update public.platform_settings
set
  free_scripts_limit = 1000000,
  free_scans_limit   = 1000000,
  updated_at         = now();

-- ============================================================
-- Verification (optional): every row should read -1 / day / true
-- ============================================================
-- select plan_key, feature_key, limit_value, limit_period, enabled
-- from public.plan_entitlements
-- order by plan_key, feature_key;
