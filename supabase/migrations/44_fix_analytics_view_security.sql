-- ============================================================
-- MIGRATION 44 — Fix affiliate_analytics_view security
-- ============================================================
-- Removes SECURITY DEFINER from the view by changing owner
-- from postgres (superuser) to the authenticated role.
--
-- WHY THIS MATTERS:
--   When a view is owned by postgres it runs with superuser
--   privileges, bypassing RLS on all underlying tables.
--   This is flagged by Supabase's security linter.
--
-- CORRECT APPROACH:
--   The view itself should run as the querying user (invoker).
--   Access control is enforced by:
--     1. RLS policies on the underlying tables
--        (affiliate_profiles, affiliate_commissions, etc.)
--     2. The SECURITY DEFINER RPCs that query this view
--        (get_affiliate_dashboard, get_admin_affiliate_analytics)
--        — those functions already do their own auth checks.
--
-- RESULT:
--   - View owner = authenticated (invoker security)
--   - Direct SELECT on the view respects RLS of the caller
--   - RPCs that use the view still work correctly because they
--     are SECURITY DEFINER and do their own role checks
-- ============================================================

-- Change view owner from postgres to authenticated
-- This removes the implicit SECURITY DEFINER behaviour
alter view public.affiliate_analytics_view owner to authenticated;

-- Grant SELECT to authenticated so RPCs and direct queries work
grant select on public.affiliate_analytics_view to authenticated;

-- Revoke from anon — this view contains PII (emails, earnings)
-- Access must go through the SECURITY DEFINER RPCs only
revoke all on public.affiliate_analytics_view from anon;

comment on view public.affiliate_analytics_view is
  'Centralized affiliate analytics. Invoker security — RLS on underlying '
  'tables is respected. Access via get_affiliate_dashboard() or '
  'get_admin_affiliate_analytics() RPCs which enforce their own auth checks.';
