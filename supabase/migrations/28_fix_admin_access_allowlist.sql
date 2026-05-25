-- ============================================================
-- MIGRATION 28 — Fix get_admin_access to honour admin_allowlist
-- ============================================================
-- BUG: get_admin_access() sets v_is_admin := v_role is not null
-- This means only users with a row in user_roles are treated as admin.
-- Users in admin_allowlist but NOT in user_roles get is_admin=false.
--
-- FIX: v_is_admin should be true if EITHER:
--   a) user has a role in user_roles, OR
--   b) user's email is in admin_allowlist with is_active=true
--
-- Also: seed user_roles for the primary admin if not already present.
-- ============================================================

-- ── 1. Fix get_admin_access() ─────────────────────────────
create or replace function public.get_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_email       text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role        text := null;
  v_allowlisted boolean := false;
  v_is_admin    boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('role', null, 'allowlisted', false, 'is_admin', false);
  end if;

  -- Check user_roles table
  v_role := public.get_admin_role(v_user_id);

  -- Check admin_allowlist
  select exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = v_email
      and a.is_active = true
  ) into v_allowlisted;

  -- FIX: is_admin is true if user has a role OR is allowlisted
  v_is_admin := (v_role is not null) or v_allowlisted;

  -- If allowlisted but no explicit role, default role to 'admin'
  if v_allowlisted and v_role is null then
    v_role := 'admin';
  end if;

  return jsonb_build_object(
    'role',        v_role,
    'allowlisted', v_allowlisted,
    'is_admin',    v_is_admin
  );
end;
$$;

-- ── 2. Seed user_roles for primary admin ──────────────────
-- Ensures the primary admin has an explicit role row so both
-- the old and new logic work correctly.
insert into public.user_roles (user_id, role)
select u.id, 'super_admin'
from auth.users u
where lower(u.email) = 'ashadbuilds@gmail.com'
on conflict (user_id) do update set role = 'super_admin';

comment on function public.get_admin_access() is
  'Returns admin access info for the current user. is_admin=true if user
   has a role in user_roles OR their email is in admin_allowlist.';
