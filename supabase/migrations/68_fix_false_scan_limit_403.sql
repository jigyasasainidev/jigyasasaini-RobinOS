-- ============================================================
-- MIGRATION 68 — FIX FALSE "SCAN LIMIT REACHED" 403
-- ============================================================
-- ROOT CAUSE (verified against live DB):
--   Users without a row in public.profiles cause
--   consume_usage()/check_and_increment_usage() to fail when
--   inserting into public.usage_tracking
--   (usage_tracking.user_id references profiles.user_id).
--   That FK violation surfaces as an RPC error, which the
--   edge functions report as an HTTP 403 with the misleading
--   message "Scan limit reached. Upgrade to continue."
--
--   It was NEVER a quota problem — plan_entitlements are all
--   unlimited (limit_value = -1) and get_usage_status_v2
--   already returns { allowed: true }.
--
-- THIS MIGRATION:
--   1. Auto-creates missing profiles for every auth.users row.
--   2. Installs a trigger so new signups always get a profile.
--   3. Makes consume_usage() fail-safe: it NEVER throws, so no
--      tracking/entitlement error can ever block a generation.
-- ============================================================

-- ── 1. Backfill profiles for existing users ─────────────────
insert into public.profiles (user_id, email, display_name, subscription_tier, current_plan)
select
  u.id,
  u.email,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(u.email, ''), '@', 1)),
  'free',
  'free'
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

-- ── 2. Auto-create a profile for every new signup ───────────
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name, subscription_tier, current_plan)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    'free',
    'free'
  )
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    -- Profile creation must never block the signup itself.
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- ── 3. Fail-safe consume_usage() ────────────────────────────
-- Identical logic to migration 29, but wrapped so that ANY
-- error (e.g. missing profile FK, idempotency race, etc.)
-- degrades to "allowed" instead of blocking generations.
create or replace function public.consume_usage(
  p_user_id         uuid,
  p_feature_key     text,
  p_increment       integer  default 1,
  p_idempotency_key text     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_key     text;
  v_ent          record;
  v_period       record;
  v_current      integer;
  v_remaining    numeric;
  v_soft_thresh  numeric;
  v_abuse_at     numeric;
begin
  -- Auth guard
  if p_user_id is null then
    return jsonb_build_object('success',false,'code','AUTH_REQUIRED',
      'message','Authentication required');
  end if;
  if coalesce(p_increment,0) < 1 then
    return jsonb_build_object('success',false,'code','INVALID_INCREMENT',
      'message','Increment must be >= 1');
  end if;

  -- Idempotency check
  if p_idempotency_key is not null then
    perform 1 from public.feature_usage_events
    where user_id = p_user_id
      and feature_name = p_feature_key
      and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('success',true,'code','IDEMPOTENT',
        'message','Already processed');
    end if;
  end if;

  -- Resolve plan
  v_plan_key := coalesce(
    (public.resolve_user_plan(p_user_id) ->> 'plan'), 'free');

  -- Fetch entitlement
  select pe.limit_value, pe.limit_period, pe.enabled,
         coalesce(pe.metadata,'{}')
  into v_ent
  from public.plan_entitlements pe
  where pe.plan_key = v_plan_key
    and pe.feature_key = p_feature_key;

  if not found or not v_ent.enabled or v_ent.limit_value = 0 then
    return jsonb_build_object('success',false,'code','FEATURE_DISABLED',
      'feature',p_feature_key,'plan',v_plan_key,
      'message','Feature not available on your current plan. Upgrade to unlock.');
  end if;

  -- Compute period
  select * into v_period
  from public.compute_period_bounds(v_ent.limit_period) limit 1;

  -- Unlimited / fair_usage: always allow, just track
  if v_ent.limit_value = -1 then
    insert into public.usage_tracking
      (user_id,feature_key,usage_count,period_key,period_start,period_end,last_used_at)
    values
      (p_user_id,p_feature_key,p_increment,v_period.period_key,
       v_period.period_start,v_period.period_end,now())
    on conflict (user_id,feature_key,period_key) do update set
      usage_count  = public.usage_tracking.usage_count + p_increment,
      last_used_at = now(),
      updated_at   = now()
    returning usage_count into v_current;

    -- Record idempotency
    if p_idempotency_key is not null then
      insert into public.feature_usage_events
        (user_id,feature_name,increment_by,idempotency_key)
      values (p_user_id,p_feature_key,p_increment,p_idempotency_key)
      on conflict do nothing;
    end if;

    -- Fair usage abuse check
    v_soft_thresh := coalesce((v_ent.metadata->>'soft_threshold')::numeric,0);
    v_abuse_at    := coalesce((v_ent.metadata->>'abuse_warning_at')::numeric,0);

    return jsonb_build_object(
      'success',true,'code','ALLOWED',
      'feature',p_feature_key,'plan',v_plan_key,
      'fair_usage',(v_ent.limit_period='fair_usage'),
      'unlimited',(v_ent.limit_period<>'fair_usage'),
      'used',v_current,
      'abuse_warning',(v_abuse_at>0 and v_current>=v_abuse_at),
      'message','Usage recorded');
  end if;

  -- Capped plan: ensure row exists, then lock + check + increment
  insert into public.usage_tracking
    (user_id,feature_key,usage_count,period_key,period_start,period_end,last_used_at)
  values
    (p_user_id,p_feature_key,0,v_period.period_key,
     v_period.period_start,v_period.period_end,now())
  on conflict (user_id,feature_key,period_key) do nothing;

  select usage_count into v_current
  from public.usage_tracking
  where user_id=p_user_id and feature_key=p_feature_key
    and period_key=v_period.period_key
  for update;

  v_current := coalesce(v_current,0);

  if v_current + p_increment > v_ent.limit_value then
    v_remaining := greatest(v_ent.limit_value - v_current, 0);
    return jsonb_build_object(
      'success',false,'code','USAGE_LIMIT_EXCEEDED',
      'feature',p_feature_key,'plan',v_plan_key,
      'limit',v_ent.limit_value,'used',v_current,'remaining',v_remaining,
      'reset_at',v_period.period_end,
      'message','Daily ' || replace(p_feature_key,'_',' ') || ' limit reached. Upgrade to continue.');
  end if;

  update public.usage_tracking set
    usage_count  = usage_count + p_increment,
    last_used_at = now(),
    updated_at   = now()
  where user_id=p_user_id and feature_key=p_feature_key
    and period_key=v_period.period_key;

  if p_idempotency_key is not null then
    insert into public.feature_usage_events
      (user_id,feature_name,increment_by,idempotency_key)
    values (p_user_id,p_feature_key,p_increment,p_idempotency_key)
    on conflict do nothing;
  end if;

  v_remaining := greatest(v_ent.limit_value - (v_current + p_increment), 0);

  return jsonb_build_object(
    'success',true,'code','ALLOWED',
    'feature',p_feature_key,'plan',v_plan_key,
    'limit',v_ent.limit_value,
    'used',v_current + p_increment,
    'remaining',v_remaining,
    'reset_at',v_period.period_end,
    'near_limit',(v_remaining <= greatest(ceil(v_ent.limit_value * 0.2), 2)),
    'message','Usage recorded');
exception
  when others then
    -- FAIL-SAFE: never block a generation because usage bookkeeping
    -- or entitlement resolution errored (e.g. missing profile row).
    return jsonb_build_object(
      'success',true,'code','ALLOWED',
      'feature',p_feature_key,'plan',coalesce(v_plan_key,''),
      'unlimited',true,
      'message','Allowed (fallback: usage tracking unavailable)');
end;
$$;

grant execute on function public.consume_usage(uuid,text,integer,text)
  to authenticated, service_role;

-- check_and_increment_usage() delegates to consume_usage(); re-assert
-- the alias so it inherits the fail-safe behaviour above.
create or replace function public.check_and_increment_usage(
  p_user_id         uuid,
  p_feature_key     text,
  p_increment       integer  default 1,
  p_idempotency_key text     default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.consume_usage(p_user_id, p_feature_key, p_increment, p_idempotency_key);
$$;

grant execute on function public.check_and_increment_usage(uuid,text,integer,text)
  to authenticated, service_role;
