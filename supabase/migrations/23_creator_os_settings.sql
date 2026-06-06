-- ============================================================
-- CREATOR OS — Runtime settings columns on platform_settings
-- Additive migration — safe to re-run (IF NOT EXISTS logic via
-- ALTER TABLE ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- Page visibility toggle (default true = page visible)
alter table public.platform_settings
  add column if not exists creator_os_page_enabled boolean not null default true;

-- Admin-configurable demo video URL
-- Supports: YouTube, Vimeo, Loom, MP4 direct URL
-- Frontend renders the appropriate embed when populated
alter table public.platform_settings
  add column if not exists creator_os_demo_video_url text default null;

comment on column public.platform_settings.creator_os_page_enabled is
  'When false, /creator-os redirects to homepage and navbar link is hidden.';
comment on column public.platform_settings.creator_os_demo_video_url is
  'Admin-configured demo video URL. YouTube / Vimeo / Loom / MP4. Empty = placeholder shown.';
