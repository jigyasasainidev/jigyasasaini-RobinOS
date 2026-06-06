-- ============================================================
-- AFFILIATE PROMO ASSETS TABLE + LOGIN URL COLUMN
-- Additive migration — safe to re-run (IF NOT EXISTS).
-- ============================================================

-- ── Add affiliate login/signup URL to platform_settings ───
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_login_url text
    default 'https://www.tryrobin.xyz/login';

comment on column public.platform_settings.jvzoo_affiliate_login_url is
  'Centralized CTA URL for all affiliate CTAs on /jvzooaffiliate. Default: /login.';

-- ── Promo assets table ────────────────────────────────────
create table if not exists public.affiliate_promo_assets (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,
  description   text        not null default '',
  badge         text        default null,   -- e.g. "Coming Soon", "Free", "Ready"
  button_text   text        not null default 'Get Asset',
  button_url    text        default null,
  icon_name     text        not null default 'sparkles',  -- lucide icon name
  display_order integer     not null default 0,
  is_enabled    boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.affiliate_promo_assets is
  'Admin-managed promo resource cards shown on /jvzooaffiliate page.';
comment on column public.affiliate_promo_assets.icon_name is
  'Lucide icon name (lowercase): sparkles, film, play, pen-tool, hash, bar-chart-3, mic, mail, image';
comment on column public.affiliate_promo_assets.display_order is
  'Sort order — lower number = shown first.';

create index if not exists idx_affiliate_promo_assets_order
  on public.affiliate_promo_assets (display_order, is_enabled);

-- Updated-at trigger (reuse existing set_updated_at function)
drop trigger if exists trg_affiliate_promo_assets_updated on public.affiliate_promo_assets;
create trigger trg_affiliate_promo_assets_updated
  before update on public.affiliate_promo_assets
  for each row execute function public.set_updated_at();

-- RLS
alter table public.affiliate_promo_assets enable row level security;

drop policy if exists "Public read affiliate promo assets" on public.affiliate_promo_assets;
create policy "Public read affiliate promo assets"
  on public.affiliate_promo_assets for select to public
  using (is_enabled = true);

drop policy if exists "Service role manage affiliate promo assets" on public.affiliate_promo_assets;
create policy "Service role manage affiliate promo assets"
  on public.affiliate_promo_assets for all to service_role
  using (true) with check (true);

-- Seed default assets so page shows content immediately
insert into public.affiliate_promo_assets
  (title, description, badge, button_text, button_url, icon_name, display_order)
values
  ('Video Thumbnails',  'High-CTR thumbnail templates for YouTube and social ads.',              'Coming Soon', 'Get Templates', null, 'image',       0),
  ('Demo Videos',       'Screen recording walkthroughs and product feature demonstrations.',     'Coming Soon', 'Watch Demos',   null, 'play',        1),
  ('Short-Form Reels',  '15-60 second product highlight videos for TikTok and Instagram.',       'Coming Soon', 'Get Reels',     null, 'film',        2),
  ('Swipe Copy',        'Email sequences, DM scripts, and post captions ready to use.',          'Coming Soon', 'Get Copy',      null, 'pen-tool',    3),
  ('Email Templates',   'Conversion-tested email campaigns for your subscriber list.',            'Coming Soon', 'Get Templates', null, 'mail',        4),
  ('Banner Creatives',  'Display ads and social media graphics in multiple formats.',             'Coming Soon', 'Get Banners',   null, 'bar-chart-3', 5)
on conflict do nothing;
