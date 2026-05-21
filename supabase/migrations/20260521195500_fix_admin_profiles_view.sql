-- Fix admin_profiles_view to include all columns required by the admin dashboard.
--
-- ROOT CAUSE:
-- The frontend query selects these columns from admin_profiles_view:
--   user_id, email, avatar_url, full_name, current_plan, is_admin,
--   is_suspended, affiliate_enabled, total_scripts_generated,
--   total_trend_scans, created_at, updated_at
--
-- The old view only exposed: user_id, email, display_name, current_plan,
-- subscription_tier, is_suspended, created_at, updated_at,
-- subscription_status, subscription_plan
--
-- Missing columns (causing PostgREST 400 Bad Request):
--   avatar_url, full_name, is_admin, affiliate_enabled,
--   total_scripts_generated, total_trend_scans
--
-- FIX: Drop and recreate the view with all required columns.
-- Must use DROP VIEW first since CREATE OR REPLACE VIEW cannot change
-- column names (columns are positional, old view had display_name as col 3).

-- Add admin select policy on user_roles (was missing, only self-view existed)
drop policy if exists "Admins can view all user roles" on public.user_roles;
create policy "Admins can view all user roles" on public.user_roles
  for select
  to authenticated
  using (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'));

-- Drop then recreate to change column names
drop view if exists public.admin_profiles_view;

create view public.admin_profiles_view
with (security_invoker = true) as
select
  p.user_id,
  p.email,
  p.avatar_url,
  coalesce(p.full_name, p.display_name, p.email) as full_name,
  p.current_plan,
  p.subscription_tier,
  p.is_suspended,
  coalesce(p.affiliate_enabled, false) as affiliate_enabled,
  coalesce(
    (select ur.role::text
     from public.user_roles ur
     where ur.user_id = p.user_id
       and ur.role != 'user'
     order by case ur.role
       when 'super_admin' then 4
       when 'admin' then 3
       when 'support' then 2
       else 0
     end desc
     limit 1),
    'user'
  ) as role,
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p.user_id
      and ur.role in ('super_admin', 'admin', 'support')
  ) or exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = lower(p.email)
      and a.is_active = true
  ) as is_admin,
  coalesce(
    (select count(*)::int
     from public.ai_generations ag
     where ag.user_id = p.user_id
       and lower(ag.generation_type) = 'script'),
    0
  ) as total_scripts_generated,
  coalesce(
    (select count(*)::int
     from public.ai_generations ag
     where ag.user_id = p.user_id
       and lower(ag.generation_type) = 'trends'),
    0
  ) as total_trend_scans,
  p.created_at,
  p.updated_at,
  coalesce(us.status, 'none') as subscription_status,
  coalesce(us.plan, 'free') as subscription_plan
from public.profiles p
left join public.user_subscriptions us on us.user_id = p.user_id;