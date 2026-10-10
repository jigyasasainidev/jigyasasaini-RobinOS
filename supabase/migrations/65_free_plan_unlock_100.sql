-- ============================================================
-- MIGRATION 65 — FREE PLAN UNLOCK (100/DAY + VOICE + VIDEO + BYOK)
-- ============================================================
-- Grants the FREE plan a full self-serve experience:
--   script_generation   100 / day   (Script Engine)
--   caption_generation  100 / day   (Caption Engine)
--   tts_generation      100 / day   (Voice Over Studio)
--   video_generation    100 / day   (Video Studio)
--   byok_access        unlimited    (-1 / day, bring your own key)
--
-- NOTE: "Caption Engine" maps to the canonical feature key
-- `caption_generation` (there is no separate caption_engine key).
--
-- Idempotent: safe to run multiple times. UPSERTs against the
-- (plan_key, feature_key) unique constraint. NO schema changes.
--
-- How to run:
--   * Supabase SQL Editor / admin panel -> paste & run, OR
--   * `supabase db push` (applies as a normal migration)
--
-- To roll back, re-run migration 04/29 free-plan seed values.
-- ============================================================

insert into public.plan_entitlements
  (plan_key, feature_key, limit_value, limit_period, enabled, metadata)
values
  ('free', 'script_generation',  100, 'day', true, '{}'::jsonb),
  ('free', 'caption_generation', 100, 'day', true, '{}'::jsonb),
  ('free', 'tts_generation',     100, 'day', true, '{}'::jsonb),
  ('free', 'video_generation',   100, 'day', true, '{}'::jsonb),
  ('free', 'byok_access',         -1, 'day', true, '{}'::jsonb)
on conflict (plan_key, feature_key) do update set
  limit_value  = excluded.limit_value,
  limit_period = excluded.limit_period,
  enabled      = excluded.enabled,
  metadata     = excluded.metadata,
  updated_at   = now();

-- ============================================================
-- Verification (optional): show the resulting free-plan config.
-- ============================================================
-- select feature_key, limit_value, limit_period, enabled
-- from public.plan_entitlements
-- where plan_key = 'free'
-- order by feature_key;
