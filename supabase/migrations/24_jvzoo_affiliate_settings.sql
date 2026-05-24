-- ============================================================
-- JVZOO AFFILIATE PAGE — Runtime settings columns
-- Additive migration — safe to re-run (IF NOT EXISTS).
-- ============================================================

alter table public.platform_settings
  add column if not exists jvzoo_affiliate_enabled       boolean not null default false;

alter table public.platform_settings
  add column if not exists jvzoo_affiliate_demo_video_url text    default null;

alter table public.platform_settings
  add column if not exists jvzoo_affiliate_cta_url        text    default null;

alter table public.platform_settings
  add column if not exists jvzoo_affiliate_button_text    text    default 'Join Affiliate Program';

comment on column public.platform_settings.jvzoo_affiliate_enabled is
  'When false, /jvzooaffiliate redirects to homepage and links are hidden.';
comment on column public.platform_settings.jvzoo_affiliate_demo_video_url is
  'Admin-configurable demo video: YouTube / Vimeo / Loom / MP4. Empty = placeholder.';
comment on column public.platform_settings.jvzoo_affiliate_cta_url is
  'JVZoo affiliate sign-up URL. Admin-controlled. Example: https://jvzoo.com/...';
comment on column public.platform_settings.jvzoo_affiliate_button_text is
  'CTA button label. Default: Join Affiliate Program.';
