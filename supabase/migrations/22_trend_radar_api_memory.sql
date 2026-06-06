-- ============================================================
-- TREND RADAR API — Scan Memory + Audit Log
-- ============================================================
-- Adds a lightweight audit table for external API scan history.
-- The trend_topics table already exists (migration 05) and is
-- re-used for trend memory via upsert from the API handler.
-- This migration only adds the audit/history table.
-- ============================================================

-- ── Scan history table ────────────────────────────────────
create table if not exists public.trend_radar_scans (
  id            uuid primary key default gen_random_uuid(),
  request_id    text not null unique,
  topic         text not null,
  source_spread integer not null default 0,
  confidence    integer not null default 0,
  opportunity_count integer not null default 0,
  is_fallback   boolean not null default false,
  scanned_at    timestamptz not null default now()
);

comment on table public.trend_radar_scans is
  'Audit log of external Trend Radar API scan requests.';
comment on column public.trend_radar_scans.request_id is
  'Unique per-request ID from the API response (tr_<ts>_<rand>).';
comment on column public.trend_radar_scans.is_fallback is
  'True when no live signals were found and fallback trends were returned.';

create index if not exists idx_trend_radar_scans_topic
  on public.trend_radar_scans (topic);
create index if not exists idx_trend_radar_scans_scanned
  on public.trend_radar_scans (scanned_at desc);

alter table public.trend_radar_scans enable row level security;

-- Public read (so dashboards can query scan history)
drop policy if exists "Public read trend radar scans" on public.trend_radar_scans;
create policy "Public read trend radar scans"
  on public.trend_radar_scans for select to public using (true);

-- Service role full access (API writes via service key)
drop policy if exists "Service role manage trend radar scans" on public.trend_radar_scans;
create policy "Service role manage trend radar scans"
  on public.trend_radar_scans for all to service_role using (true) with check (true);
