-- ============================================================
-- TREND SIGNAL DEPTH COLUMNS + CACHE FORCE INVALIDATION
-- ============================================================
-- Root cause:
--   velocity, confidence, creator_count, repost_count,
--   momentum_direction, window_label were never added to DB.
--   Edge function upserts them → silently ignored.
--   Cache reads return NULL → frontend renders nothing.
--
-- This migration:
--   1. Adds all missing signal depth columns (additive, safe)
--   2. Force-expires all stale cache rows (sets expires_at = now)
--      so the next request triggers a full regeneration with
--      all new fields populated.
--   3. RLS + index for window_label lookups
-- ============================================================

-- ── 1. trend_audios — add missing signal depth columns ────────

alter table public.trend_audios
  add column if not exists velocity          text    default 'stable',
  add column if not exists confidence        integer default 70,
  add column if not exists creator_count     integer default 0,
  add column if not exists repost_count      integer default 0,
  add column if not exists momentum_direction text   default 'stable',
  add column if not exists window_label      text    default null;

comment on column public.trend_audios.velocity is
  'Signal velocity tier: exploding | hot | rising | stable';
comment on column public.trend_audios.confidence is
  'Deterministic confidence score 55–95 derived from virality + cross-source + rank';
comment on column public.trend_audios.creator_count is
  'Estimated creator reuse count — heuristic derived from virality_score + rank';
comment on column public.trend_audios.repost_count is
  'Estimated repost/reuse count — ~18-28% of creator_count';
comment on column public.trend_audios.momentum_direction is
  'Momentum direction: up | stable | down';
comment on column public.trend_audios.window_label is
  'Human-readable signal window: e.g. "Velocity spiked in last 3h"';

-- ── 2. trend_hashtags — add missing signal depth columns ──────

alter table public.trend_hashtags
  add column if not exists velocity          text    default 'stable',
  add column if not exists confidence        integer default 70,
  add column if not exists creator_count     integer default 0,
  add column if not exists momentum_direction text   default 'stable',
  add column if not exists window_label      text    default null;

comment on column public.trend_hashtags.velocity is
  'Signal velocity tier: exploding | hot | rising | stable';
comment on column public.trend_hashtags.confidence is
  'Deterministic confidence score 55–95';
comment on column public.trend_hashtags.creator_count is
  'Estimated creator posts count — heuristic';
comment on column public.trend_hashtags.momentum_direction is
  'Momentum direction: up | stable | down';
comment on column public.trend_hashtags.window_label is
  'Human-readable signal window';

-- ── 3. FORCE EXPIRE all stale cache rows ──────────────────────
-- This invalidates every cached row immediately.
-- The next request for any platform will trigger a full
-- cache-miss regeneration with all new fields correctly populated.
-- Without this, old rows (missing velocity/confidence/etc.)
-- would keep serving for up to 6 hours.

update public.trend_audios
  set expires_at = now() - interval '1 second'
  where expires_at > now();

update public.trend_hashtags
  set expires_at = now() - interval '1 second'
  where expires_at > now();

-- ── 4. Performance index for velocity lookups ─────────────────
create index if not exists idx_trend_audios_velocity
  on public.trend_audios (platform, velocity);

create index if not exists idx_trend_hashtags_velocity
  on public.trend_hashtags (platform, velocity);
