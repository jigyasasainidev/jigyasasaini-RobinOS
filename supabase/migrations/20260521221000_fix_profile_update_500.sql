-- ============================================================
-- ROBINOS: Fix 500 Internal Server Error on PATCH /profiles
-- ============================================================
-- Root Cause:
--   The RLS policy "Admins can update all profiles" on public.profiles
--   calls public.get_admin_role(auth.uid()) to check admin access.
--   However, get_admin_role() queries public.admin_allowlist WITHOUT
--   SECURITY DEFINER. The admin_allowlist table has a restrictive RLS
--   policy ("No direct access to admin allowlist" for all using false),
--   so when the function runs during RLS policy evaluation, it hits
--   the admin_allowlist RLS block and throws a 500 error.
--
-- Fix:
--   Mark get_admin_role() and get_admin_access() as SECURITY DEFINER
--   so they bypass RLS when querying admin_allowlist during RLS evaluation.
--   Both functions already validate auth.uid() is non-null before any
--   query execution, so this is production-safe.
-- ============================================================

-- ============================================================
-- FIX 1: Make get_admin_role() SECURITY DEFINER
-- ============================================================
create or replace function public.get_admin_role(user_uuid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_allowlisted boolean := false;
begin
  if auth.uid() is null then
    return null;
  end if;

  if user_uuid is distinct from auth.uid() then
    return null;
  end if;

  select ur.role::text
  into v_role
  from public.user_roles ur
  where ur.user_id = user_uuid
  order by case ur.role
    when 'super_admin' then 4
    when 'admin' then 3
    when 'support' then 2
    when 'user' then 1
    else 0
  end desc
  limit 1;

  if v_role is not null and v_role <> 'user' then
    return v_role;
  end if;

  select exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = v_email
      and a.is_active = true
  )
  into v_allowlisted;

  if v_allowlisted then
    return 'admin';
  end if;

  return null;
end;
$$;

-- ============================================================
-- FIX 2: Make get_admin_access() SECURITY DEFINER
-- (It calls get_admin_role() and also queries admin_allowlist directly)
-- ============================================================
create or replace function public.get_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role text := null;
  v_allowlisted boolean := false;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('role', null, 'allowlisted', false, 'is_admin', false);
  end if;

  v_role := public.get_admin_role(v_user_id);

  select exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = v_email
      and a.is_active = true
  ) into v_allowlisted;

  v_is_admin := v_role is not null;

  return jsonb_build_object('role', v_role, 'allowlisted', v_allowlisted, 'is_admin', v_is_admin);
end;
$$;