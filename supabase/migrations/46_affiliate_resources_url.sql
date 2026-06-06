-- Add affiliate_resources_url to platform_settings
alter table public.platform_settings
  add column if not exists affiliate_resources_url text;

comment on column public.platform_settings.affiliate_resources_url is
  'Google Drive folder URL shared with affiliates for promotional assets, templates, and videos.';

-- Reversible: alter table public.platform_settings drop column if exists affiliate_resources_url;