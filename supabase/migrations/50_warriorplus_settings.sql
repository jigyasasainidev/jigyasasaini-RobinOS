-- Chunk 1: WarriorPlus sales-page visibility toggle
-- Adds the columns required for the standalone /warriorplus marketplace
-- sales page. Mirrors the pattern used for /jvzoo (creator_os_* columns
-- in migration 23) but defaults to OFF so the page must be explicitly
-- enabled in Admin → Settings after marketplace approval.
--
-- IMPORTANT: This migration is additive only. It does NOT touch any
-- existing /jvzoo or affiliate columns. The /jvzoo page continues to
-- read creator_os_page_enabled exactly as before.

alter table public.platform_settings
  add column if not exists warriorplus_page_enabled    boolean not null default false;

alter table public.platform_settings
  add column if not exists warriorplus_demo_video_url  text default null;

comment on column public.platform_settings.warriorplus_page_enabled is
  'When true, the /warriorplus sales page is publicly accessible. When false, the page redirects to the homepage. Defaults to false — must be enabled in Admin → Settings after WarriorPlus marketplace approval.';

comment on column public.platform_settings.warriorplus_demo_video_url is
  'Optional demo video URL for the /warriorplus sales page. Accepts YouTube, Vimeo, Loom, or direct MP4. Leave empty to show the placeholder player.';
