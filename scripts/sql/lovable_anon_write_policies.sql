-- ============================================================
-- Allow anon key (SUPABASE_PUBLISHABLE_KEY) to write to
-- trend_topics and trend_radar_scans from the Vercel API.
--
-- Run this in the Lovable project Supabase SQL Editor.
-- Safe to re-run — uses DROP IF EXISTS + CREATE.
-- ============================================================

-- ── trend_topics: allow anon insert + update ──────────────
drop policy if exists "Anon insert trend topics" on public.trend_topics;
create policy "Anon insert trend topics"
  on public.trend_topics for insert to anon
  with check (true);

drop policy if exists "Anon update trend topics" on public.trend_topics;
create policy "Anon update trend topics"
  on public.trend_topics for update to anon
  using (true) with check (true);

-- ── trend_radar_scans: allow anon insert ──────────────────
drop policy if exists "Anon insert trend radar scans" on public.trend_radar_scans;
create policy "Anon insert trend radar scans"
  on public.trend_radar_scans for insert to anon
  with check (true);

-- ── Verify ────────────────────────────────────────────────
-- select schemaname, tablename, policyname, roles, cmd
-- from pg_policies
-- where tablename in ('trend_topics', 'trend_radar_scans')
-- order by tablename, cmd;
