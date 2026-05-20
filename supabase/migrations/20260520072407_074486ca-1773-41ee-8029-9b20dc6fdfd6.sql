create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

create or replace function public.initialize_user_account(p_referred_by text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_display_name text := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    auth.jwt() -> 'user_metadata' ->> 'name',
    auth.jwt() ->> 'email',
    'RobinOS User'
  );
  v_referral_code text;
  v_workspace_id uuid;
  v_is_new boolean := false;
  v_period_key date := (now() at time zone 'utc')::date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select referral_code into v_referral_code from public.profiles where user_id = v_user_id;

  if v_referral_code is null then
    v_referral_code := public.generate_referral_code();
    v_is_new := true;
  end if;

  insert into public.profiles (
    user_id, email, display_name, full_name, referral_code, referred_by_code, subscription_tier, current_plan
  )
  values (
    v_user_id,
    nullif(v_email, ''),
    nullif(v_display_name, ''),
    nullif(v_display_name, ''),
    v_referral_code,
    nullif(p_referred_by, ''),
    'free',
    'free'
  )
  on conflict (user_id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at = now();

  insert into public.workspaces (owner_user_id, name, slug)
  values (
    v_user_id,
    coalesce(nullif(v_display_name, ''), 'RobinOS') || '''s Workspace',
    lower('ws_' || substring(md5(v_user_id::text) from 1 for 10))
  )
  on conflict (slug) do nothing;

  select id into v_workspace_id
  from public.workspaces
  where owner_user_id = v_user_id
  order by created_at asc
  limit 1;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.onboarding_states (user_id, workspace_id, is_completed, current_step, welcome_seen)
  values (v_user_id, v_workspace_id, false, 0, false)
  on conflict (user_id) do update
  set workspace_id = excluded.workspace_id;

  perform public.ensure_affiliate_profile();

  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values
    (v_user_id, 'scripts', v_period_key, 0),
    (v_user_id, 'ai_requests', v_period_key, 0),
    (v_user_id, 'voice_generations', v_period_key, 0),
    (v_user_id, 'exports', v_period_key, 0),
    (v_user_id, 'automation_runs', v_period_key, 0)
  on conflict (user_id, feature_name, period_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'is_new_user', v_is_new,
    'workspace_id', v_workspace_id,
    'referral_code', v_referral_code
  );
end;
$$;

revoke all on function public.has_role(uuid, public.app_role) from public;
revoke all on function public.initialize_user_account(text) from public;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.initialize_user_account(text) to authenticated;