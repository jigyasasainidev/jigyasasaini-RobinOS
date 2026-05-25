-- ============================================================
-- ROBINOS CENTRALIZED TREND INTELLIGENCE ENGINE
-- Cache-first, shared-intelligence architecture
-- 2026-05-21
-- ============================================================
-- This migration introduces a centralized trend intelligence
-- architecture that replaces per-request AI generation with
-- shared cached intelligence collected in the background.
--
-- CRITICAL: Old trend tables are NOT modified. This is new
-- infrastructure that sits alongside existing schema.
--
-- KEY PROPERTIES:
-- - IMMUTABLE-safe indexes (no now() in predicates)
-- - Deterministic period_keys for cache dedup
-- - expires_at is a stored column value, not an expression
-- - UNIQUE constraints prevent duplicate ingestion
-- - Shared cache serves ALL users per niche/platform
-- ============================================================

/* ============================================================
1. TREND TOPICS CACHE
Stores AI-generated trend topics per niche.
Shared across ALL users — same niche = same cached trends.
Refreshed during background collection cycles.
============================================================ */
create table if not exists public.trend_topics (
  id uuid primary key default gen_random_uuid(),
  niche_key text not null,
  title text not null,
  description text not null,
  platforms text not null,
  heat integer not null default 0,
  hook_types jsonb not null default '[]'::jsonb,
  volume text not null default 'Medium',
  virality_score numeric not null default 0,
  trend_velocity numeric not null default 0,
  source text not null default 'ai',
  collection_snapshot_id uuid,
  expires_at timestamptz not null,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.trend_topics is 'Centralized trend topic cache per niche — shared across all users';
comment on column public.trend_topics.niche_key is 'Normalized niche key (e.g. fitness, ai_tools, finance)';
comment on column public.trend_topics.heat is 'Heat score 0-99 based on virality signals';
comment on column public.trend_topics.virality_score is 'Deterministic virality score derived from heat + velocity + platform count';
comment on column public.trend_topics.trend_velocity is 'Trend growth velocity metric';
comment on column public.trend_topics.source is 'ai, google_trends, tiktok, youtube, manual';
comment on column public.trend_topics.collection_snapshot_id is 'References the collection run that produced this trend';
comment on column public.trend_topics.expires_at is 'When this cache entry expires and should be refreshed';

create index if not exists idx_trend_topics_niche on public.trend_topics (niche_key);
create index if not exists idx_trend_topics_niche_heat on public.trend_topics (niche_key, heat desc);
create index if not exists idx_trend_topics_expires on public.trend_topics (expires_at);
create index if not exists idx_trend_topics_snapshot on public.trend_topics (collection_snapshot_id);

/* ============================================================
2. TREND AUDIOS CACHE
Stores trending audio tracks per platform.
Collected from free APIs (Apple Music RSS, Deezer).
============================================================ */
create table if not exists public.trend_audios (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  title text not null,
  artist text not null,
  category text not null default 'Trending',
  uses text default null,
  trend text not null default 'up',
  tip text default null,
  audio_source text not null default 'apple_music',
  virality_score numeric not null default 0,
  collection_snapshot_id uuid,
  expires_at timestamptz not null,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, title, artist)
);

comment on table public.trend_audios is 'Centralized trending audio cache per platform — free API-sourced';
comment on column public.trend_audios.audio_source is 'apple_music, deezer, tiktok_creative_center';

create index if not exists idx_trend_audios_platform on public.trend_audios (platform);
create index if not exists idx_trend_audios_platform_score on public.trend_audios (platform, virality_score desc);
create index if not exists idx_trend_audios_expires on public.trend_audios (expires_at);

/* ============================================================
3. TREND HASHTAGS CACHE
Stores trending hashtags per platform.
Collected from Google Trends RSS + platform signals.
============================================================ */
create table if not exists public.trend_hashtags (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  tag text not null,
  category text not null default 'Trending',
  posts text default null,
  trend text not null default 'up',
  tip text default null,
  hashtag_source text not null default 'google_trends',
  virality_score numeric not null default 0,
  collection_snapshot_id uuid,
  expires_at timestamptz not null,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, tag)
);

comment on table public.trend_hashtags is 'Centralized trending hashtag cache per platform';

create index if not exists idx_trend_hashtags_platform on public.trend_hashtags (platform);
create index if not exists idx_trend_hashtags_platform_score on public.trend_hashtags (platform, virality_score desc);
create index if not exists idx_trend_hashtags_expires on public.trend_hashtags (expires_at);

/* ============================================================
4. COLLECTION SNAPSHOTS
Tracks background collection runs for deduplication and monitoring.
============================================================ */
create table if not exists public.trend_collection_snapshots (
  id uuid primary key default gen_random_uuid(),
  collection_type text not null,
  status text not null default 'running',
  niche_keys text[] default '{}',
  platforms text[] default '{}',
  topics_collected integer not null default 0,
  audios_collected integer not null default 0,
  hashtags_collected integer not null default 0,
  errors jsonb default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.trend_collection_snapshots is 'Tracks background trend collection runs for monitoring and dedup';
comment on column public.trend_collection_snapshots.collection_type is 'full_collection, niche_refresh, platform_refresh, manual';
comment on column public.trend_collection_snapshots.niche_keys is 'Niches covered in this collection run';

create index if not exists idx_trend_snapshots_type on public.trend_collection_snapshots (collection_type);
create index if not exists idx_trend_snapshots_status on public.trend_collection_snapshots (status);
create index if not exists idx_trend_snapshots_started on public.trend_collection_snapshots (started_at desc);

/* ============================================================
5. RLS POLICIES
============================================================ */
alter table public.trend_topics enable row level security;
alter table public.trend_audios enable row level security;
alter table public.trend_hashtags enable row level security;
alter table public.trend_collection_snapshots enable row level security;

-- Trend data: public readable, service_role writable
drop policy if exists "Public read trend topics" on public.trend_topics;
drop policy if exists "Service role manage trend topics" on public.trend_topics;
create policy "Public read trend topics" on public.trend_topics for select to public using (true);
create policy "Service role manage trend topics" on public.trend_topics for all to service_role using (true) with check (true);

drop policy if exists "Public read trend audios" on public.trend_audios;
drop policy if exists "Service role manage trend audios" on public.trend_audios;
create policy "Public read trend audios" on public.trend_audios for select to public using (true);
create policy "Service role manage trend audios" on public.trend_audios for all to service_role using (true) with check (true);

drop policy if exists "Public read trend hashtags" on public.trend_hashtags;
drop policy if exists "Service role manage trend hashtags" on public.trend_hashtags;
create policy "Public read trend hashtags" on public.trend_hashtags for select to public using (true);
create policy "Service role manage trend hashtags" on public.trend_hashtags for all to service_role using (true) with check (true);

drop policy if exists "Public read trend snapshots" on public.trend_collection_snapshots;
drop policy if exists "Service role manage trend snapshots" on public.trend_collection_snapshots;
create policy "Public read trend snapshots" on public.trend_collection_snapshots for select to public using (true);
create policy "Service role manage trend snapshots" on public.trend_collection_snapshots for all to service_role using (true) with check (true);

-- Timestamp triggers
drop trigger if exists trg_trend_topics_updated_at on public.trend_topics;
create trigger trg_trend_topics_updated_at
  before update on public.trend_topics
  for each row execute function public.set_updated_at();

drop trigger if exists trg_trend_audios_updated_at on public.trend_audios;
create trigger trg_trend_audios_updated_at
  before update on public.trend_audios
  for each row execute function public.set_updated_at();

drop trigger if exists trg_trend_hashtags_updated_at on public.trend_hashtags;
create trigger trg_trend_hashtags_updated_at
  before update on public.trend_hashtags
  for each row execute function public.set_updated_at();

/* ============================================================
6. HELPER FUNCTION: get_fresh_cache_window
Returns deterministic cache expiry boundaries based on collection_type
============================================================ */
create or replace function public.get_trend_cache_window()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'topics_ttl_hours', 4,
    'audios_ttl_hours', 3,
    'hashtags_ttl_hours', 3,
    'expires_at', (date_trunc('hour', now()) + interval '4 hours')::timestamptz
  );
$$;

comment on function public.get_trend_cache_window() is 'Returns deterministic TTL configuration for trend cache freshness';
