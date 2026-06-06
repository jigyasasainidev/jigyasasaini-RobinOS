-- ============================================================
-- FIX: Free plan hashtag_scan entitlement
-- ============================================================
-- Prior state: limit_value=0, enabled=false (feature fully blocked)
-- Correct state: limit_value=3, enabled=true (3 hashtag scans/day)
--
-- This aligns the backend entitlement with the documented free-tier
-- limit (HASHTAG_LIMITS.free = 3 in frontend constants) and with
-- the expected user-facing display: "Hashtags: 0/3".
--
-- Root cause: The original master migration seeded hashtag_scan
-- as disabled for free users. This prevents the check_and_increment_usage
-- RPC from tracking scans and causes get_usage_status_v2 to return
-- quota=0, which the frontend badge renders as "0/0".
-- ============================================================

update public.plan_entitlements
set
  limit_value = 3,
  limit_period = 'day',
  enabled     = true,
  updated_at  = now()
where plan_key    = 'free'
  and feature_key = 'hashtag_scan';
