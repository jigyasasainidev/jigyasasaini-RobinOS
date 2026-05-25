-- ============================================================
-- MIGRATION 29 — ENTITLEMENT SYSTEM REBUILD
-- Production-grade plan limits, atomic usage, all RPCs
-- ============================================================
-- ADDITIVE ONLY. Existing tables/data preserved.
-- Fixes:
--   1. Plan limits updated to match final spec
--   2. feature_usage_events table (idempotency log)
--   3. get_usage_status() backward-compat wrapper
--   4. consume_usage() — atomic increment RPC
--   5. can_access_feature() — boolean gate RPC
--   6. get_usage_summary() — full summary RPC
--   7. get_usage_status_v2() — corrected read-only check
-- ============================================================

-- ── 1. ENSURE feature_usage_events TABLE EXISTS ────────────
create table if not exists public.feature_usage_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  feature_name    text not null,
  increment_by    integer not null default 1,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  unique (user_id, feature_name, idempotency_key)
);

create index if not exists idx_feature_usage_events_user
  on public.feature_usage_events (user_id, feature_name);

alter table public.feature_usage_events enable row level security;

drop policy if exists "Users view own usage events" on public.feature_usage_events;
create policy "Users view own usage events"
  on public.feature_usage_events for select
  using (auth.uid() = user_id);

drop policy if exists "Service role manages usage events" on public.feature_usage_events;
create policy "Service role manages usage events"
  on public.feature_usage_events for all to service_role
  using (true) with check (true);


-- ── 2. UPDATE PLAN ENTITLEMENTS TO FINAL SPEC ─────────────
-- Upsert all plan limits — this is the single source of truth.
-- Any existing rows are updated to match the spec exactly.

insert into public.plan_entitlements
  (plan_key, feature_key, limit_value, limit_period, enabled, metadata)
values
  -- ── FREE PLAN ──────────────────────────────────────────
  ('free','script_generation',  2,  '24h',      true,  '{}'::jsonb),
  ('free','caption_generation', 2,  'day',       true,  '{}'::jsonb),
  ('free','trend_scan',         1,  'lifetime',  true,  '{}'::jsonb),
  ('free','hashtag_scan',       0,  'day',       false, '{}'::jsonb),
  ('free','tts_generation',     0,  'day',       false, '{}'::jsonb),
  ('free','video_generation',   0,  'day',       false, '{}'::jsonb),
  ('free','byok_access',        0,  'day',       false, '{}'::jsonb),
  ('free','analytics_access',   0,  'day',       false, '{}'::jsonb),
  ('free','watermark_removal',  0,  'day',       false, '{}'::jsonb),
  ('free','automation_tools',   0,  'day',       false, '{}'::jsonb),
  ('free','export_access',      3,  'day',       true,  '{"watermarked":true}'::jsonb),
  ('free','team_workspaces',    1,  'lifetime',  true,  '{}'::jsonb),

  -- ── CREATOR PLAN ($19) ─────────────────────────────────
  ('creator','script_generation',  20, 'day',      true,  '{}'::jsonb),
  ('creator','caption_generation', 20, 'day',      true,  '{}'::jsonb),
  ('creator','trend_scan',         10, 'day',      true,  '{}'::jsonb),
  ('creator','hashtag_scan',       20, 'day',      true,  '{}'::jsonb),
  ('creator','tts_generation',      0, 'day',      false, '{}'::jsonb),
  ('creator','video_generation',    0, 'day',      false, '{}'::jsonb),
  ('creator','byok_access',         0, 'day',      false, '{}'::jsonb),
  ('creator','analytics_access',    5, 'day',      true,  '{}'::jsonb),
  ('creator','watermark_removal',   0, 'day',      false, '{}'::jsonb),
  ('creator','automation_tools',    0, 'day',      false, '{}'::jsonb),
  ('creator','export_access',      50, 'day',      true,  '{"watermarked":false}'::jsonb),
  ('creator','team_workspaces',     1, 'lifetime', true,  '{}'::jsonb),

  -- ── PRO CREATOR PLAN ($39) ─────────────────────────────
  ('pro_creator','script_generation',  100, 'day',      true,  '{}'::jsonb),
  ('pro_creator','caption_generation', 100, 'day',      true,  '{}'::jsonb),
  ('pro_creator','trend_scan',         100, 'day',      true,  '{}'::jsonb),
  ('pro_creator','hashtag_scan',       100, 'day',      true,  '{}'::jsonb),
  ('pro_creator','tts_generation',     200, 'day',      true,  '{}'::jsonb),
  ('pro_creator','video_generation',    50, 'day',      true,  '{}'::jsonb),
  ('pro_creator','byok_access',         -1, 'day',      true,  '{}'::jsonb),
  ('pro_creator','analytics_access',    -1, 'day',      true,  '{"advanced":true}'::jsonb),
  ('pro_creator','watermark_removal',    1, 'day',      true,  '{}'::jsonb),
  ('pro_creator','automation_tools',     0, 'day',      false, '{}'::jsonb),
  ('pro_creator','export_access',      250, 'day',      true,  '{"watermarked":false}'::jsonb),
  ('pro_creator','team_workspaces',      3, 'lifetime', true,  '{}'::jsonb),

  -- ── AGENCY PLAN ($99) ──────────────────────────────────
  ('agency','script_generation',  -1, 'fair_usage', true, '{"soft_threshold":500,"abuse_warning_at":2000}'::jsonb),
  ('agency','caption_generation', -1, 'fair_usage', true, '{"soft_threshold":500,"abuse_warning_at":2000}'::jsonb),
  ('agency','trend_scan',         -1, 'fair_usage', true, '{"soft_threshold":200}'::jsonb),
  ('agency','hashtag_scan',       -1, 'fair_usage', true, '{"soft_threshold":200}'::jsonb),
  ('agency','tts_generation',     -1, 'fair_usage', true, '{"soft_threshold":500}'::jsonb),
  ('agency','video_generation',   -1, 'fair_usage', true, '{"soft_threshold":100,"abuse_warning_at":500}'::jsonb),
  ('agency','byok_access',        -1, 'day',        true, '{}'::jsonb),
  ('agency','analytics_access',   -1, 'day',        true, '{"advanced":true}'::jsonb),
  ('agency','watermark_removal',   1, 'day',        true, '{}'::jsonb),
  ('agency','automation_tools',   -1, 'day',        true, '{}'::jsonb),
  ('agency','export_access',      -1, 'fair_usage', true, '{"watermarked":false,"soft_threshold":1000}'::jsonb),
  ('agency','team_workspaces',    -1, 'lifetime',   true, '{}'::jsonb)

on conflict (plan_key, feature_key) do update set
  limit_value  = excluded.limit_value,
  limit_period = excluded.limit_period,
  enabled      = excluded.enabled,
  metadata     = excluded.metadata,
  updated_at   = now();


-- ── 3. HELPER: compute_period_bounds ──────────────────────
-- Returns (period_key, period_start, period_end) for a given
-- limit_period. Centralizes period logic used by all RPCs.

create or replace function public.compute_period_bounds(p_limit_period text)
returns table(period_key text, period_start timestamptz, period_end timestamptz)
language plpgsql
stable
set search_path = public
as $$
begin
  if p_limit_period = '24h' then
    return query select
      to_char(date_trunc('hour', now()) - interval '24 hours', 'YYYY-MM-DD-HH24'),
      date_trunc('hour', now()) - interval '24 hours',
      date_trunc('hour', now());
  elsif p_limit_period = 'day' or p_limit_period = 'fair_usage' then
    return query select
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      date_trunc('day', now() at time zone 'UTC'),
      date_trunc('day', now() at time zone 'UTC') + interval '1 day';
  elsif p_limit_period = 'month' then
    return query select
      to_char(now() at time zone 'UTC', 'YYYY-MM'),
      date_trunc('month', now() at time zone 'UTC'),
      date_trunc('month', now() at time zone 'UTC') + interval '1 month';
  elsif p_limit_period = 'lifetime' then
    return query select
      'lifetime'::text,
      '2025-01-01 00:00:00+00'::timestamptz,
      '2099-12-31 23:59:59+00'::timestamptz;
  else
    -- default: day
    return query select
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      date_trunc('day', now() at time zone 'UTC'),
      date_trunc('day', now() at time zone 'UTC') + interval '1 day';
  end if;
end;
$$;

grant execute on function public.compute_period_bounds(text) to authenticated, anon, service_role;


-- ── 4. consume_usage() — ATOMIC GATE + INCREMENT ──────────
-- THE critical RPC. Called by edge functions BEFORE generation.
-- Validates quota, increments atomically, prevents all bypasses.
-- Returns structured result the edge function uses to allow/deny.

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
end;
$$;

grant execute on function public.consume_usage(uuid,text,integer,text)
  to authenticated, service_role;

comment on function public.consume_usage(uuid,text,integer,text) is
  'Atomic gate+increment. Call BEFORE generation. Returns success/failure with quota details.';


-- ── 5. can_access_feature() — boolean gate ────────────────
create or replace function public.can_access_feature(
  p_user_id    uuid,
  p_feature_key text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_key text;
  v_ent      record;
begin
  if p_user_id is null then return false; end if;

  v_plan_key := coalesce(
    (public.resolve_user_plan(p_user_id) ->> 'plan'), 'free');

  select enabled, limit_value into v_ent
  from public.plan_entitlements
  where plan_key = v_plan_key and feature_key = p_feature_key;

  if not found then return false; end if;
  return v_ent.enabled and v_ent.limit_value <> 0;
end;
$$;

grant execute on function public.can_access_feature(uuid,text)
  to authenticated, anon, service_role;

-- ── 6. get_usage_summary() — full summary for a user ──────
create or replace function public.get_usage_summary(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_key text;
  v_result   jsonb := '{}'::jsonb;
  v_feat     record;
  v_ent      record;
  v_period   record;
  v_used     integer;
  v_remaining numeric;
begin
  if p_user_id is null then
    return jsonb_build_object('error','AUTH_REQUIRED');
  end if;

  v_plan_key := coalesce(
    (public.resolve_user_plan(p_user_id) ->> 'plan'), 'free');

  for v_feat in
    select feature_key, limit_value, limit_period, enabled,
           coalesce(metadata,'{}') as metadata
    from public.plan_entitlements
    where plan_key = v_plan_key
    order by feature_key
  loop
    select * into v_period
    from public.compute_period_bounds(v_feat.limit_period) limit 1;

    select coalesce(usage_count,0) into v_used
    from public.usage_tracking
    where user_id=p_user_id
      and feature_key=v_feat.feature_key
      and period_key=v_period.period_key;

    v_used := coalesce(v_used,0);

    if v_feat.limit_value = -1 then
      v_remaining := 999999;
    else
      v_remaining := greatest(v_feat.limit_value - v_used, 0);
    end if;

    v_result := jsonb_set(v_result, array[v_feat.feature_key],
      jsonb_build_object(
        'enabled',    v_feat.enabled and v_feat.limit_value <> 0,
        'limit',      v_feat.limit_value,
        'period',     v_feat.limit_period,
        'used',       v_used,
        'remaining',  v_remaining,
        'allowed',    (v_feat.enabled and v_feat.limit_value <> 0
                       and (v_feat.limit_value = -1 or v_remaining > 0)),
        'fair_usage', (v_feat.limit_period = 'fair_usage'),
        'unlimited',  (v_feat.limit_value = -1 and v_feat.limit_period <> 'fair_usage'),
        'reset_at',   v_period.period_end
      ));
  end loop;

  return jsonb_build_object(
    'plan',     v_plan_key,
    'user_id',  p_user_id,
    'features', v_result,
    'checked_at', now()
  );
end;
$$;

grant execute on function public.get_usage_summary(uuid)
  to authenticated, anon, service_role;


-- ── 7. get_usage_status_v2() — corrected read-only check ──
-- Replaces the old version. Uses usage_tracking (not feature_usage).
-- Called by frontend hooks for display-only status.

create or replace function public.get_usage_status_v2(
  p_user_id    uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_key  text;
  v_ent       record;
  v_period    record;
  v_used      integer;
  v_remaining numeric;
  v_allowed   boolean;
  v_near_limit boolean;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed',false,'used',0,'quota',0,
      'remaining',0,'near_limit',false,'fair_usage',false,
      'unlimited',false,'message','Not authenticated');
  end if;

  v_plan_key := coalesce(
    (public.resolve_user_plan(p_user_id) ->> 'plan'), 'free');

  select limit_value, limit_period, enabled,
         coalesce(metadata,'{}') as metadata
  into v_ent
  from public.plan_entitlements
  where plan_key = v_plan_key and feature_key = p_feature_key;

  if not found or not v_ent.enabled or v_ent.limit_value = 0 then
    return jsonb_build_object('allowed',false,'used',0,'quota',0,
      'remaining',0,'near_limit',false,'fair_usage',false,
      'unlimited',false,'message','Feature not available on your plan');
  end if;

  select * into v_period
  from public.compute_period_bounds(v_ent.limit_period) limit 1;

  select coalesce(usage_count,0) into v_used
  from public.usage_tracking
  where user_id=p_user_id
    and feature_key=p_feature_key
    and period_key=v_period.period_key;

  v_used := coalesce(v_used,0);

  if v_ent.limit_value = -1 then
    return jsonb_build_object(
      'allowed',true,'used',v_used,'quota',null,
      'remaining',999999,'near_limit',false,
      'fair_usage',(v_ent.limit_period='fair_usage'),
      'unlimited',(v_ent.limit_period<>'fair_usage'),
      'reset_at',v_period.period_end,
      'message',case when v_ent.limit_period='fair_usage'
                then 'Unlimited (fair usage)' else 'Unlimited' end);
  end if;

  v_remaining  := greatest(v_ent.limit_value - v_used, 0);
  v_allowed    := v_remaining > 0;
  v_near_limit := v_ent.limit_value > 0
    and v_used >= ceil(v_ent.limit_value * 0.8);

  return jsonb_build_object(
    'allowed',v_allowed,'used',v_used,'quota',v_ent.limit_value,
    'remaining',v_remaining,'near_limit',v_near_limit,
    'fair_usage',false,'unlimited',false,
    'reset_at',v_period.period_end,
    'message',case when v_allowed then 'Usage available'
              else 'Daily limit reached. Upgrade to continue.' end);
end;
$$;

grant execute on function public.get_usage_status_v2(uuid,text)
  to authenticated, anon, service_role;


-- ── 8. get_usage_status() — backward-compat wrapper ───────
-- StudioPage and CaptionEnginePage call this with p_feature_name
-- = 'scripts' or 'captions'. This wrapper maps to the new engine.

create or replace function public.get_usage_status(
  p_feature_name text default 'scripts'
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_feature_key text;
begin
  -- Map old feature names to new canonical keys
  v_feature_key := case lower(coalesce(p_feature_name,'scripts'))
    when 'scripts'  then 'script_generation'
    when 'captions' then 'caption_generation'
    when 'trends'   then 'trend_scan'
    when 'hashtags' then 'hashtag_scan'
    when 'voice'    then 'tts_generation'
    when 'video'    then 'video_generation'
    else p_feature_name
  end;

  return public.get_usage_status_v2(v_user_id, v_feature_key);
end;
$$;

grant execute on function public.get_usage_status(text)
  to authenticated, anon, service_role;

comment on function public.get_usage_status(text) is
  'Backward-compat wrapper. Maps old feature names (scripts/captions) '
  'to new canonical keys and delegates to get_usage_status_v2.';

-- ── 9. check_and_increment_usage() — alias for consume_usage ─
-- Some edge functions may call this name. Alias to consume_usage.

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

-- ── 10. get_user_entitlements() — refresh with new period logic
-- Re-create to use compute_period_bounds for consistency.

create or replace function public.get_user_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result         jsonb;
  v_plan_key            text;
  v_subscription_active boolean;
  v_entitlements        jsonb := '{}'::jsonb;
  v_feat                record;
begin
  if p_user_id is null then
    return jsonb_build_object('plan','free','subscription_active',false,
      'features','{}'::jsonb);
  end if;

  v_plan_result         := public.resolve_user_plan(p_user_id);
  v_plan_key            := coalesce(v_plan_result->>'plan','free');
  v_subscription_active := coalesce((v_plan_result->>'subscription_active')::boolean,false);

  for v_feat in
    select feature_key, limit_value, limit_period, enabled,
           coalesce(metadata,'{}') as metadata
    from public.plan_entitlements
    where plan_key = v_plan_key
    order by feature_key
  loop
    v_entitlements := jsonb_set(v_entitlements, array[v_feat.feature_key],
      jsonb_build_object(
        'enabled',    v_feat.enabled and (v_feat.limit_value <> 0),
        'limit',      v_feat.limit_value,
        'period',     v_feat.limit_period,
        'unlimited',  (v_feat.limit_value = -1 and v_feat.limit_period <> 'fair_usage'),
        'fair_usage', (v_feat.limit_period = 'fair_usage'),
        'metadata',   v_feat.metadata
      ));
  end loop;

  return jsonb_build_object(
    'plan',                v_plan_key,
    'subscription_active', v_subscription_active,
    'expires_at',          v_plan_result->>'expires_at',
    'expires_soon',        coalesce((v_plan_result->>'expires_soon')::boolean,false),
    'billing_cycle',       coalesce(v_plan_result->>'billing_cycle','monthly'),
    'cooldown_until',      v_plan_result->>'cooldown_until',
    'features',            v_entitlements
  );
end;
$$;

grant execute on function public.get_user_entitlements(uuid)
  to authenticated, anon;

-- ── 11. INDEXES ────────────────────────────────────────────
create index if not exists idx_usage_tracking_period_lookup
  on public.usage_tracking (user_id, feature_key, period_key);

create index if not exists idx_plan_entitlements_plan_feature
  on public.plan_entitlements (plan_key, feature_key);

-- ── 12. COMMENTS ──────────────────────────────────────────
comment on function public.consume_usage(uuid,text,integer,text) is
  'ATOMIC gate+increment. Call BEFORE generation. Prevents all bypass vectors.';
comment on function public.can_access_feature(uuid,text) is
  'Boolean: does this user have access to this feature on their plan?';
comment on function public.get_usage_summary(uuid) is
  'Full usage summary for all features for a user. Used by frontend hooks.';
comment on function public.get_usage_status_v2(uuid,text) is
  'Read-only usage status for a single feature. Display-only, no side effects.';
