-- ============================================================
-- TREND RADAR API — Memory Tables for Lovable/Idea Stream Project
-- ============================================================
-- Run this directly in the Lovable project's Supabase SQL editor.
-- Safe to re-run: all statements use IF NOT EXISTS.
--
-- This project already has:
--   trend_families, trend_family_relations, trend_signals
--
-- This script adds:
--   trend_topics      — stores scan results keyed by niche/topic
--   trend_radar_scans — audit log of every API scan request
-- ============================================================

-- ── Helper: set_updated_at() trigger function ─────────────
-- May already exist in this project. CREATE OR REPLACE is safe.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 1. trend_topics ───────────────────────────────────────
-- Stores creator-ready trend opportunities keyed by niche.
-- Written by persistTrendMemory() after each API scan.
-- Upserted on (niche_key, title) — stale rows get refreshed.

create table if not exists public.trend_topics (
  id                     uuid        primary key default gen_random_uuid(),
  niche_key              text        not null,
  title                  text        not null,
  description            text        not null default '',
  platforms              text        not null default '',
  heat                   integer     not null default 0,
  hook_types             jsonb       not null default '[]'::jsonb,
  volume                 text        not null default 'Medium',
  virality_score         numeric     not null default 0,
  trend_velocity         numeric     not null default 0,
  source                 text        not null default 'trend_radar_api',
  collection_snapshot_id uuid,
  expires_at             timestamptz not null,
  collected_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (niche_key, title)
);

comment on table public.trend_topics is
  'Creator-ready trend opportunities written by the Trend Radar API after each scan.';
comment on column public.trend_topics.niche_key is
  'Normalized topic slug (e.g. ai_faceless_reels). Keyed from the scan topic.';
comment on column public.trend_topics.heat is
  'Momentum score 0-99 (mapped from momentumScore in API response).';
comment on column public.trend_topics.source is
  'trend_radar_api | ai | google_trends — origin of this record.';
comment on column public.trend_topics.expires_at is
  'Cache TTL — 6 hours from scan time. Expired rows are stale.';

create index if not exists idx_trend_topics_niche
  on public.trend_topics (niche_key);
create index if not exists idx_trend_topics_niche_heat
  on public.trend_topics (niche_key, heat desc);
create index if not exists idx_trend_topics_expires
  on public.trend_topics (expires_at);
create index if not exists idx_trend_topics_source
  on public.trend_topics (source);

-- Updated-at trigger
drop trigger if exists trg_trend_topics_updated_at on public.trend_topics;
create trigger trg_trend_topics_updated_at
  before update on public.trend_topics
  for each row execute function public.set_updated_at();

-- RLS
alter table public.trend_topics enable row level security;

drop policy if exists "Public read trend topics" on public.trend_topics;
create policy "Public read trend topics"
  on public.trend_topics for select to public using (true);

drop policy if exists "Service role manage trend topics" on public.trend_topics;
create policy "Service role manage trend topics"
  on public.trend_topics for all to service_role using (true) with check (true);


-- ── 2. trend_radar_scans ──────────────────────────────────
-- Audit log: one row per API scan request.
-- Written by persistTrendMemory() with the requestId from the response.

create table if not exists public.trend_radar_scans (
  id                uuid        primary key default gen_random_uuid(),
  request_id        text        not null unique,
  topic             text        not null,
  source_spread     integer     not null default 0,
  confidence        integer     not null default 0,
  opportunity_count integer     not null default 0,
  is_fallback       boolean     not null default false,
  scanned_at        timestamptz not null default now()
);

comment on table public.trend_radar_scans is
  'Audit log of external Trend Radar API scan requests.';
comment on column public.trend_radar_scans.request_id is
  'Unique per-request ID from the API (tr_<timestamp>_<rand>).';
comment on column public.trend_radar_scans.source_spread is
  'Number of healthy upstream sources in this scan (0-3).';
comment on column public.trend_radar_scans.is_fallback is
  'True when no live signals found and fallback trends were returned.';

create index if not exists idx_trend_radar_scans_topic
  on public.trend_radar_scans (topic);
create index if not exists idx_trend_radar_scans_scanned
  on public.trend_radar_scans (scanned_at desc);

-- RLS
alter table public.trend_radar_scans enable row level security;

drop policy if exists "Public read trend radar scans" on public.trend_radar_scans;
create policy "Public read trend radar scans"
  on public.trend_radar_scans for select to public using (true);

drop policy if exists "Service role manage trend radar scans" on public.trend_radar_scans;
create policy "Service role manage trend radar scans"
  on public.trend_radar_scans for all to service_role using (true) with check (true);


-- ── 3. Verify ────────────────────────────────────────────
-- Run this after the script to confirm both tables exist:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--   and table_name in ('trend_topics', 'trend_radar_scans');
--
-- Expected output: 2 rows.
