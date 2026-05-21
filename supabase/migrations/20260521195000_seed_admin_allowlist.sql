-- Seed the approved admin email into the admin allowlist.
-- This is required for the get_admin_role() and get_admin_access()
-- functions to authorize the admin Google OAuth login.
--
-- The admin_allowlist RLS policy blocks all direct client-side writes,
-- so this must be done via migration/service role.

insert into public.admin_allowlist (email, is_active, note)
values ('ashadbuilds@gmail.com', true, 'Primary admin account')
on conflict (email) do nothing;