-- PHASE 1: Core admin tables
create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin','admin','support')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_admin_roles_user_id on public.admin_roles(user_id);
create index if not exists idx_admin_roles_role on public.admin_roles(role);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_admin_user_id on public.admin_audit_logs(admin_user_id);
create index if not exists idx_admin_audit_logs_created_at on public.admin_audit_logs(created_at desc);

-- Keep updated_at fresh on admin_roles updates
create trigger touch_admin_roles_updated_at
before update on public.admin_roles
for each row execute function public.touch_updated_at();

-- PHASE 2: Security helper functions
create or replace function public.get_admin_role(user_uuid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ar.role
  from public.admin_roles ar
  where ar.user_id = user_uuid
  limit 1
$$;

create or replace function public.is_admin(user_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = user_uuid
      and ar.role in ('super_admin', 'admin', 'support')
  )
$$;

create or replace function public.require_super_admin(user_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = user_uuid
      and ar.role = 'super_admin'
  ) then
    raise exception 'Unauthorized: super_admin required';
  end if;
end;
$$;

create or replace function public.log_admin_action(p_action text, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_log_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_admin(v_user_id) then
    raise exception 'Unauthorized: admin role required';
  end if;

  insert into public.admin_audit_logs (admin_user_id, action, metadata)
  values (v_user_id, p_action, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_log_id;

  return v_log_id;
end;
$$;

-- PHASE 3: RLS hardening
alter table public.admin_roles enable row level security;
alter table public.admin_audit_logs enable row level security;

-- admin_roles policies
create policy "Super admins manage admin roles"
on public.admin_roles
for all
to authenticated
using (public.get_admin_role(auth.uid()) = 'super_admin')
with check (public.get_admin_role(auth.uid()) = 'super_admin');

create policy "Admins read own admin role"
on public.admin_roles
for select
to authenticated
using (auth.uid() = user_id);

-- admin_audit_logs policies
create policy "Admins can write audit logs"
on public.admin_audit_logs
for insert
to authenticated
with check (
  admin_user_id = auth.uid()
  and public.is_admin(auth.uid())
);

create policy "Super admins can read audit logs"
on public.admin_audit_logs
for select
to authenticated
using (public.get_admin_role(auth.uid()) = 'super_admin');

-- PHASE 4: seed first super admin safely
insert into public.admin_roles (user_id, role, permissions)
select u.id, 'super_admin', '{"all": true}'::jsonb
from auth.users u
where lower(u.email) = lower('ashadbuilds@gmail.com')
on conflict (user_id) do update
set role = excluded.role,
    permissions = excluded.permissions,
    updated_at = now();