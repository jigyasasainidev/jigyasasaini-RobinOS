-- Ensure least-privilege table privileges remain enforced
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM anon;

-- Harden signup initialization path for role assignment under RLS
CREATE OR REPLACE FUNCTION public.initialize_user_account(p_referred_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_email text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
  v_display_name text := nullif(
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name',
      auth.jwt() ->> 'email'
    ),
    ''
  );
  v_workspace_id uuid;
  v_referral_code text;
  v_affiliate_owner uuid;
  v_referred_by text := nullif(trim(p_referred_by), '');
  v_is_new boolean := false;
  v_period_key date := (now() at time zone 'utc')::date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('initialize_user_account:' || v_user_id::text));

  select referral_code into v_referral_code
  from public.profiles
  where user_id = v_user_id;

  if v_referral_code is null then
    v_referral_code := public.generate_referral_code();
    v_is_new := true;
  end if;

  insert into public.profiles (
    user_id,
    email,
    display_name,
    full_name,
    referral_code,
    referred_by_code,
    subscription_tier,
    current_plan
  )
  values (
    v_user_id,
    v_email,
    v_display_name,
    v_display_name,
    v_referral_code,
    case when upper(coalesce(v_referred_by, '')) = upper(coalesce(v_referral_code, '')) then null else v_referred_by end,
    'free',
    'free'
  )
  on conflict (user_id) do update
  set
    email = coalesce(public.profiles.email, excluded.email),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
    referred_by_code = coalesce(public.profiles.referred_by_code, excluded.referred_by_code),
    updated_at = now();

  insert into public.user_roles (user_id, role)
  values (v_user_id, 'user'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.user_subscriptions (user_id, plan, status, amount, currency)
  values (v_user_id, 'free', 'active', 0, 'USD')
  on conflict (user_id) do nothing;

  insert into public.workspaces (owner_user_id, name, slug)
  values (
    v_user_id,
    coalesce(v_display_name, 'RobinOS') || '''s Workspace',
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
  set workspace_id = excluded.workspace_id,
      updated_at = now();

  perform public.ensure_affiliate_profile();

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values
    (v_user_id, 'scripts', v_period_key, 0),
    (v_user_id, 'ai_requests', v_period_key, 0),
    (v_user_id, 'voice_generations', v_period_key, 0),
    (v_user_id, 'exports', v_period_key, 0),
    (v_user_id, 'automation_runs', v_period_key, 0)
  on conflict (user_id, feature_name, period_key) do nothing;

  if v_referred_by is not null then
    select ap.user_id into v_affiliate_owner
    from public.affiliate_profiles ap
    where upper(ap.referral_code) = upper(v_referred_by)
      and ap.user_id <> v_user_id
    limit 1;

    if v_affiliate_owner is not null then
      insert into public.affiliate_referrals (affiliate_user_id, referred_user_id, referral_code)
      values (v_affiliate_owner, v_user_id, upper(v_referred_by))
      on conflict (referred_user_id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_new_user', v_is_new,
    'workspace_id', v_workspace_id,
    'referral_code', v_referral_code,
    'referred_by', v_referred_by,
    'has_referrer', (v_affiliate_owner is not null)
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', sqlstate
    );
end;
$function$;

REVOKE ALL ON FUNCTION public.initialize_user_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_user_account(text) TO authenticated;