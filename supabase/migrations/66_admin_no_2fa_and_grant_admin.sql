-- ============================================================
-- MIGRATION 66 — DISABLE ADMIN 2FA + GRANT FULL ADMIN ACCESS
-- ============================================================
-- Two jobs:
--   A) Remove ALL admin 2FA records (so nothing forces TOTP setup)
--   B) Grant a second user FULL admin (super_admin) access
--
-- IMPORTANT:
--   This SQL cleans the `admin_2fa` table and grants admin access.
--   Skipping the 2FA *screen* itself is handled in the frontend:
--   src/components/admin/AdminRouteGuard.tsx now has
--   `ENFORCE_ADMIN_2FA = false`, which bypasses the setup/verify gate.
--
-- HOW TO RUN:
--   1. Replace the placeholder below with the second admin's email.
--   2. Run this file in the Supabase SQL editor (or `supabase db push`).
--
-- Safe to re-run (idempotent).
-- ============================================================

do $$
declare
  -- ── STEP 1: put the second admin's email here ──────────────
  target_email text := 'jigyasa.saini.dev@gmail.com';
  target_uid   uuid;
begin
  -- Safety guard: refuse to run with the placeholder left in
  if target_email is null
     or target_email = ''
     or target_email = 'REPLACE_WITH_SECOND_ADMIN_EMAIL' then
    raise exception 'Set target_email to the second admin''s email before running migration 66.';
  end if;

  -- ── A) Remove ALL 2FA records (disables 2FA platform-wide) ──
  insert into public.admin_2fa_audit (user_id, event)
  select user_id, 'disabled'
  from public.admin_2fa;

  delete from public.admin_2fa;

  -- ── B) Allowlist the email ─────────────────────────────────
  insert into public.admin_allowlist (email, is_active, note)
  values (lower(target_email), true, 'Full admin — granted via migration 66')
  on conflict (email) do update
    set is_active  = true,
        note       = excluded.note,
        updated_at = now();

  -- ── C) Grant super_admin in user_roles (if account exists) ──
  select id into target_uid
  from auth.users
  where lower(email) = lower(target_email)
  limit 1;

  if target_uid is null then
    raise notice 'User % not found in auth.users yet. Allowlist row created; re-run this file after they sign up to grant user_roles.', target_email;
  else
    insert into public.user_roles (user_id, role)
    select target_uid, 'super_admin'
    where not exists (
      select 1 from public.user_roles r
      where r.user_id = target_uid and r.role = 'super_admin'
    );
    raise notice 'Granted super_admin to % (%)', target_email, target_uid;
  end if;
end $$;

-- ============================================================
-- Verification (optional)
-- ============================================================
-- select count(*) as remaining_2fa_rows from public.admin_2fa;
-- select email, is_active from public.admin_allowlist order by created_at;
-- select u.email, ur.role
--   from public.user_roles ur
--   join auth.users u on u.id = ur.user_id
--  order by ur.role;
