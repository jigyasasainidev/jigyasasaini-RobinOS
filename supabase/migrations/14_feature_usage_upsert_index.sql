-- ============================================================
-- Feature Usage Analytics — daily upsert support
-- ============================================================
-- The feature_usage table already exists (master migration).
-- This migration adds:
--   1. date_key column (YYYY-MM-DD) for daily aggregation
--   2. Unique constraint on (user_id, feature_name, date_key)
--      so the shared tracker can do atomic UPSERT increments
--      instead of creating unbounded duplicate rows.
--
-- Existing rows are preserved.
-- date_key defaults to current UTC date for any existing rows
-- that lack it (safe backfill via DEFAULT).
-- ============================================================

-- Add date_key if not already present
alter table public.feature_usage
  add column if not exists date_key text not null default to_char(now(), 'YYYY-MM-DD');

-- Index for dashboard aggregation queries (feature_name grouping)
create index if not exists idx_feature_usage_feature_name
  on public.feature_usage (feature_name);

-- Index for per-user lookups
create index if not exists idx_feature_usage_user_feature
  on public.feature_usage (user_id, feature_name);

-- Unique constraint enabling daily UPSERT increment
-- ON CONFLICT (user_id, feature_name, date_key) DO UPDATE SET usage_count = usage_count + N
alter table public.feature_usage
  drop constraint if exists feature_usage_user_feature_date_key;

alter table public.feature_usage
  add constraint feature_usage_user_feature_date_key
    unique (user_id, feature_name, date_key);

-- RLS: service_role writes, users read own rows
-- (table already has RLS enabled from master migration)
drop policy if exists "Users can view own feature usage" on public.feature_usage;
create policy "Users can view own feature usage"
  on public.feature_usage for select
  using (auth.uid() = user_id);

drop policy if exists "Service role manages feature usage" on public.feature_usage;
create policy "Service role manages feature usage"
  on public.feature_usage for all to service_role
  using (true) with check (true);

-- ============================================================
-- RPC: upsert_feature_usage (atomic daily increment)
-- Called by _shared/feature-usage.ts on every successful generation.
-- SECURITY DEFINER so service_role bypass applies at function level.
-- ============================================================
create or replace function public.upsert_feature_usage(
  p_user_id     uuid,
  p_feature_name text,
  p_date_key    text,
  p_increment   integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feature_usage (user_id, feature_name, date_key, usage_count, created_at)
  values (p_user_id, p_feature_name, p_date_key, p_increment, now())
  on conflict (user_id, feature_name, date_key)
  do update set
    usage_count = public.feature_usage.usage_count + p_increment,
    created_at  = now();
end;
$$;
