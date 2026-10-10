-- ============================================================
-- MIGRATION 69 — COMPLETELY REMOVE ADMIN 2FA (TOTP / QR)
-- ============================================================
-- Admin 2FA (Google Authenticator / QR based TOTP) is no
-- longer used. This drops every database object created by
-- migration 27:
--   - public.admin_2fa          (encrypted TOTP secrets)
--   - public.admin_2fa_audit    (2FA event log)
--   - public.set_admin_2fa_updated_at() + its trigger
--
-- The matching edge functions (generate-admin-2fa,
-- verify-admin-2fa, disable-admin-2fa, check-admin-2fa-status)
-- and the frontend QR setup/verify screens are removed in code.
--
-- Safe to re-run (idempotent — everything uses IF EXISTS).
-- ============================================================

-- Trigger + helper function on admin_2fa
drop trigger  if exists admin_2fa_updated_at on public.admin_2fa;
drop function if exists public.set_admin_2fa_updated_at();

-- Tables (audit first, then secrets)
drop table if exists public.admin_2fa_audit cascade;
drop table if exists public.admin_2fa       cascade;

-- Sanity: everything related to admin_2fa is now gone.
do $$
begin
  if to_regclass('public.admin_2fa') is not null
     or to_regclass('public.admin_2fa_audit') is not null then
    raise exception 'admin_2fa objects still exist';
  end if;
  raise notice 'Admin 2FA database objects removed.';
end $$;
