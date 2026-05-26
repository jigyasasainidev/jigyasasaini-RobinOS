-- ============================================================
-- MIGRATION 44 — Fix affiliate_analytics_view security
-- ============================================================
-- Removes SECURITY DEFINER behaviour by enabling security_invoker
-- on the view. This is the correct Postgres/Supabase approach.
--
-- WHY THIS MATTERS:
--   When a view is owned by postgres it runs with the owner's
--   privileges by default (security definer), bypassing RLS on
--   all underlying tables. Supabase's linter flags this.
--
-- CORRECT APPROACH:
--   Set security_invoker = true so the view executes with the
--   privileges of the querying user, not the view owner.
--   RLS on underlying tables is then respected.
--
--   The SECURITY DEFINER RPCs (get_affiliate_dashboard,
--   get_admin_affiliate_analytics) are unaffected — they do
--   their own auth checks and still work correctly.
--
-- NOTE: security_invoker requires Postgres 15+.
--   Supabase projects run Postgres 15, so this is safe.
-- ============================================================

-- Enable invoker security on the view
-- This makes the view respect RLS of the querying user
-- instead of running as the view owner (postgres superuser)
alter view public.affiliate_analytics_view
  set (security_invoker = true);

-- Ensure authenticated role can select from the view
grant select on public.affiliate_analytics_view to authenticated;

-- Revoke from anon — contains PII (emails, earnings)
-- All access must go through the SECURITY DEFINER RPCs
revoke all on public.affiliate_analytics_view from anon;

comment on view public.affiliate_analytics_view is
  'Centralized affiliate analytics. security_invoker = true — RLS on '
  'underlying tables is respected for the querying user. '
  'Access via get_affiliate_dashboard() or get_admin_affiliate_analytics() '
  'RPCs which enforce their own auth checks.';
