-- ============================================================
-- BOOTSTRAP: platform_settings table + all additive columns
-- Run this ONCE in Supabase SQL Editor if table doesn't exist.
-- Safe to re-run: all statements use IF NOT EXISTS.
-- ============================================================

-- ── 1. Create base table ──────────────────────────────────
create table if not exists public.platform_settings (
  id                           uuid        primary key default gen_random_uuid(),
  creator_price                numeric     not null default 19,
  pro_price                    numeric     not null default 39,
  agency_price                 numeric     not null default 99,
  free_scripts_limit           integer     not null default 3,
  free_scans_limit             integer     not null default 20,
  affiliate_commission_percent numeric     not null default 30,
  minimum_withdrawal           numeric     not null default 25,
  payout_delay_days            integer     not null default 7,
  maintenance_mode             boolean     not null default false,
  announcement_banner          text,
  platform_domain              text,
  support_email                text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

-- ── 2. Add Creator OS columns (migration 23) ──────────────
alter table public.platform_settings
  add column if not exists creator_os_page_enabled       boolean not null default true;
alter table public.platform_settings
  add column if not exists creator_os_demo_video_url     text    default null;

-- ── 3. Add JVZoo affiliate columns (migration 24) ─────────
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_enabled       boolean not null default false;
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_demo_video_url text   default null;
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_cta_url        text   default null;
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_button_text    text   default 'Join Affiliate Program';

-- ── 4. Add affiliate login URL column (migration 25) ─────
alter table public.platform_settings
  add column if not exists jvzoo_affiliate_login_url      text
    default 'https://www.tryrobin.xyz/login';

-- ── 5. RLS ────────────────────────────────────────────────
alter table public.platform_settings enable row level security;

drop policy if exists "Public read platform settings" on public.platform_settings;
create policy "Public read platform settings"
  on public.platform_settings for select to public using (true);

drop policy if exists "Service role manage platform settings" on public.platform_settings;
create policy "Service role manage platform settings"
  on public.platform_settings for all to service_role using (true) with check (true);

-- ── 6. Seed one row if table is empty ────────────────────
insert into public.platform_settings (id)
select gen_random_uuid()
where not exists (select 1 from public.platform_settings);

-- ── 7. Verify ────────────────────────────────────────────
select
  id,
  maintenance_mode,
  creator_os_page_enabled,
  jvzoo_affiliate_enabled,
  jvzoo_affiliate_login_url,
  updated_at
from public.platform_settings
limit 1;
