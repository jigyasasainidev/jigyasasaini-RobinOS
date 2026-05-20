create or replace function public.get_caption_usage_status()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text := 'free';
  v_limit integer := 0;
  v_used integer := 0;
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(subscription_tier, 'free')
  into v_tier
  from public.profiles
  where user_id = v_user_id
  limit 1;

  v_limit := public.caption_daily_limit_for_tier(v_tier);

  select count(*)::integer
  into v_used
  from public.caption_generations cg
  where cg.user_id = v_user_id
    and (cg.created_at at time zone 'utc')::date = v_today;

  return jsonb_build_object(
    'feature_name', 'captions',
    'tier', lower(coalesce(v_tier, 'free')),
    'period_key', v_today,
    'limit', v_limit,
    'used', coalesce(v_used, 0),
    'remaining', greatest(v_limit - coalesce(v_used, 0), 0),
    'allowed', coalesce(v_used, 0) < v_limit
  );
end;
$$;

create or replace function public.consume_caption_quota(p_increment integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status jsonb;
  v_limit integer;
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_increment is null or p_increment <= 0 then
    raise exception 'Increment must be greater than zero';
  end if;

  v_status := public.get_caption_usage_status();
  v_limit := (v_status ->> 'limit')::integer;
  v_used := (v_status ->> 'used')::integer;

  if (v_used + p_increment) > v_limit then
    return jsonb_build_object('ok', false, 'error', 'quota_exceeded', 'status', v_status);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke execute on function public.get_caption_usage_status() from public;
revoke execute on function public.consume_caption_quota(integer) from public;
grant execute on function public.get_caption_usage_status() to authenticated;
grant execute on function public.consume_caption_quota(integer) to authenticated;