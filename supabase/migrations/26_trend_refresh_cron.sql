-- ============================================================
-- MIGRATION 26 — AUTO TREND REFRESH (12-HOUR CRON)
-- ============================================================
-- Schedules the collect-trends edge function to run every 12h.
-- This triggers the Idea Stream /refresh endpoint which:
--   1. Fetches fresh audio + hashtag data from sources
--   2. Scores and ranks results
--   3. Writes updated rows to trend_audios + trend_hashtags
--   4. Future calls to trending-audio edge fn serve the new data
--
-- Requirements:
--   - pg_cron extension must be enabled (Supabase: Database → Extensions)
--   - collect-trends edge function must be deployed
--   - IDEA_STREAM_BASE_URL + IDEA_STREAM_API_KEY must be set in secrets
--
-- Safe to re-run: uses cron.schedule which replaces existing job by name.
-- ============================================================

-- Enable pg_cron extension (safe if already enabled)
create extension if not exists pg_cron with schema extensions;

-- Grant cron usage to postgres role
grant usage on schema cron to postgres;

-- ── Schedule: every 12 hours at :00 ──────────────────────
-- Runs at 00:00 UTC and 12:00 UTC daily.
-- Calls the collect-trends Supabase edge function via http extension.
-- The edge function is a thin trigger that calls Idea Stream /refresh.
--
-- Note: net.http_post requires the pg_net extension (enabled by default
-- on all Supabase projects). If pg_net is unavailable, the cron job
-- will log an error but will NOT break any other functionality.

-- Enable pg_net if not already enabled (needed for HTTP calls from cron)
create extension if not exists pg_net with schema extensions;

-- Remove old job if it exists (idempotent)
select cron.unschedule('trend-refresh-12h')
where exists (
  select 1 from cron.job where jobname = 'trend-refresh-12h'
);

-- Schedule the 12-hour refresh
select cron.schedule(
  'trend-refresh-12h',              -- job name (unique, used for management)
  '0 */12 * * *',                   -- cron expression: every 12 hours at :00
  $$
    select
      net.http_post(
        url     := current_setting('app.supabase_url', true) || '/functions/v1/collect-trends',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body    := '{}'::jsonb
      ) as request_id;
  $$
);

-- ── Verify the job was scheduled ─────────────────────────
-- Run this to confirm after migration:
--   select jobname, schedule, command, active from cron.job where jobname = 'trend-refresh-12h';

comment on extension pg_cron is
  'Used by RobinOS to schedule the 12-hour trend data refresh pipeline.';

-- ── Alternative: set app config if not already set ───────
-- If Supabase secrets are not accessible as GUC settings, the cron
-- job above uses app.supabase_url / app.service_role_key.
-- These can be set via: alter database postgres set app.supabase_url = '...';
-- Or use the bootstrap SQL below (run once from admin):
--
--   alter database postgres set app.supabase_url = 'https://YOUR_PROJECT.supabase.co';
--   alter database postgres set app.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
--
-- These are stored as database-level configuration, NOT in plaintext
-- in the migrations. Replace with actual values in Supabase SQL editor.
