-- 1) Centralized plan entitlements
create table if not exists public.subscription_entitlements (
  tier text primary key,
  script_daily_limit integer not null,
  caption_daily_limit integer not null,
  byok_enabled boolean not null default false,
  is_fair_usage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_entitlements enable row level security;

-- Internal table: no direct reads from clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_entitlements'
      AND policyname = 'No direct client access to entitlements'
  ) THEN
    CREATE POLICY "No direct client access to entitlements"
      ON public.subscription_entitlements
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

insert into public.subscription_entitlements (tier, script_daily_limit, caption_daily_limit, byok_enabled, is_fair_usage)
values
  ('free', 2, 10, false, false),
  ('creator', 20, 20, false, false),
  ('pro_creator', 100, 100, true, false),
  ('agency', 2000, 2000, true, true),
  ('scale_agency', 2000, 2000, true, true)
on conflict (tier) do update
set
  script_daily_limit = excluded.script_daily_limit,
  caption_daily_limit = excluded.caption_daily_limit,
  byok_enabled = excluded.byok_enabled,
  is_fair_usage = excluded.is_fair_usage,
  updated_at = now();

-- 2) Usage events for idempotent counting
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  period_key date not null,
  idempotency_key text,
  amount integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user_feature_period on public.usage_events(user_id, feature_name, period_key);
create unique index if not exists uq_usage_events_user_feature_idempotency
  on public.usage_events(user_id, feature_name, idempotency_key)
  where idempotency_key is not null;

alter table public.usage_events enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='usage_events' AND policyname='Users can view own usage events'
  ) THEN
    CREATE POLICY "Users can view own usage events"
      ON public.usage_events
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='usage_events' AND policyname='Users can insert own usage events'
  ) THEN
    CREATE POLICY "Users can insert own usage events"
      ON public.usage_events
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 3) Script generation tracking table
create table if not exists public.script_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id text,
  prompt text not null,
  tone text,
  content_length text,
  generated_output text,
  generation_status text not null default 'succeeded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint script_generations_status_check check (generation_status in ('succeeded', 'failed', 'cancelled', 'empty')),
  constraint script_generations_prompt_len_check check (char_length(prompt) between 1 and 4000)
);

create index if not exists idx_script_generations_user_created_at on public.script_generations(user_id, created_at desc);
create unique index if not exists uq_script_generations_user_request_id
  on public.script_generations(user_id, request_id)
  where request_id is not null;

alter table public.script_generations enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_generations' AND policyname='Users can view own script generations'
  ) THEN
    CREATE POLICY "Users can view own script generations"
      ON public.script_generations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_generations' AND policyname='Users can create own script generations'
  ) THEN
    CREATE POLICY "Users can create own script generations"
      ON public.script_generations
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_generations' AND policyname='Users can edit own script generations'
  ) THEN
    CREATE POLICY "Users can edit own script generations"
      ON public.script_generations
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4) Caption generation safety fields
alter table public.caption_generations
  add column if not exists request_id text,
  add column if not exists generation_status text not null default 'succeeded';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'caption_generations_status_check'
  ) THEN
    ALTER TABLE public.caption_generations
      ADD CONSTRAINT caption_generations_status_check
      CHECK (generation_status in ('succeeded', 'failed', 'cancelled', 'empty'));
  END IF;
END $$;

create unique index if not exists uq_caption_generations_user_request_id
  on public.caption_generations(user_id, request_id)
  where request_id is not null;

create index if not exists idx_caption_generations_user_status_created_at
  on public.caption_generations(user_id, generation_status, created_at desc);

-- 5) Canonical tier normalization helper
create or replace function public.normalize_tier(p_tier text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_tier text := lower(coalesce(p_tier, 'free'));
begin
  if v_tier = 'starter' then
    return 'creator';
  elsif v_tier = 'pro' then
    return 'pro_creator';
  elsif v_tier in ('free', 'creator', 'pro_creator', 'agency', 'scale_agency') then
    return v_tier;
  end if;

  return 'free';
end;
$$;

-- 6) Updated caption tier limit function
create or replace function public.caption_daily_limit_for_tier(p_tier text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_norm text := public.normalize_tier(p_tier);
  v_limit integer;
begin
  select se.caption_daily_limit
  into v_limit
  from public.subscription_entitlements se
  where se.tier = v_norm
  limit 1;

  return coalesce(v_limit, 10);
end;
$$;

-- 7) Unified usage status function (scripts + captions)
create or replace function public.get_usage_status(p_feature_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text := 'free';
  v_norm_tier text := 'free';
  v_limit integer := 0;
  v_used integer := 0;
  v_remaining integer := 0;
  v_today date := (now() at time zone 'utc')::date;
  v_feature text := lower(coalesce(p_feature_name, ''));
  v_is_fair_usage boolean := false;
  v_near_limit boolean := false;
  v_allowed boolean := false;
  v_byok_enabled boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_feature not in ('scripts', 'captions') then
    raise exception 'Unsupported feature: %', v_feature;
  end if;

  select coalesce(subscription_tier, 'free')
  into v_tier
  from public.profiles
  where user_id = v_user_id
  limit 1;

  v_norm_tier := public.normalize_tier(v_tier);

  select
    case when v_feature = 'scripts' then script_daily_limit else caption_daily_limit end,
    is_fair_usage,
    byok_enabled
  into v_limit, v_is_fair_usage, v_byok_enabled
  from public.subscription_entitlements
  where tier = v_norm_tier
  limit 1;

  if v_feature = 'captions' then
    select count(*)::integer
    into v_used
    from public.caption_generations cg
    where cg.user_id = v_user_id
      and cg.generation_status = 'succeeded'
      and (cg.created_at at time zone 'utc')::date = v_today;
  else
    select coalesce(uc.used_count, 0)
    into v_used
    from public.usage_counters uc
    where uc.user_id = v_user_id
      and uc.feature_name = 'scripts'
      and uc.period_key = v_today
    limit 1;

    v_used := coalesce(v_used, 0);
  end if;

  v_remaining := greatest(v_limit - v_used, 0);
  v_allowed := (v_is_fair_usage or v_used < v_limit);

  if v_is_fair_usage then
    v_near_limit := false;
  else
    v_near_limit := (v_remaining > 0 and v_remaining <= 3);
  end if;

  return jsonb_build_object(
    'feature_name', v_feature,
    'tier', v_norm_tier,
    'period_key', v_today,
    'quota', v_limit,
    'used', v_used,
    'remaining', v_remaining,
    'allowed', v_allowed,
    'near_limit', v_near_limit,
    'fair_usage', v_is_fair_usage,
    'byok_enabled', v_byok_enabled,
    'message',
      case
        when v_is_fair_usage then 'Fair usage active'
        when v_allowed then concat(v_remaining::text, ' generations remaining today')
        else 'Daily limit reached — upgrade to continue creating'
      end
  );
end;
$$;

-- 8) Safe consumption with idempotency (scripts)
create or replace function public.consume_feature_quota(
  p_feature_name text,
  p_increment integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_feature text := lower(coalesce(p_feature_name, ''));
  v_increment integer := coalesce(p_increment, 1);
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_today date := (now() at time zone 'utc')::date;
  v_status jsonb;
  v_quota integer;
  v_used integer;
  v_remaining integer;
  v_allowed boolean;
  v_near_limit boolean;
  v_fair_usage boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_feature not in ('scripts') then
    raise exception 'Unsupported feature for consume_feature_quota: %', v_feature;
  end if;

  if v_increment <= 0 then
    raise exception 'Increment must be greater than zero';
  end if;

  if v_key is not null then
    if exists (
      select 1
      from public.usage_events ue
      where ue.user_id = v_user_id
        and ue.feature_name = v_feature
        and ue.idempotency_key = v_key
    ) then
      v_status := public.get_usage_status(v_feature);
      return jsonb_build_object('ok', true, 'already_counted', true, 'status', v_status);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('consume_feature_quota:' || v_user_id::text || ':' || v_feature || ':' || v_today::text));

  v_status := public.get_usage_status(v_feature);
  v_quota := coalesce((v_status ->> 'quota')::integer, 0);
  v_used := coalesce((v_status ->> 'used')::integer, 0);
  v_fair_usage := coalesce((v_status ->> 'fair_usage')::boolean, false);

  if not v_fair_usage and (v_used + v_increment) > v_quota then
    return jsonb_build_object('ok', false, 'error', 'quota_exceeded', 'status', v_status);
  end if;

  insert into public.usage_counters (user_id, feature_name, period_key, used_count)
  values (v_user_id, v_feature, v_today, v_increment)
  on conflict (user_id, feature_name, period_key)
  do update set
    used_count = public.usage_counters.used_count + excluded.used_count,
    updated_at = now();

  if v_key is not null then
    insert into public.usage_events (user_id, feature_name, period_key, idempotency_key, amount)
    values (v_user_id, v_feature, v_today, v_key, v_increment)
    on conflict (user_id, feature_name, idempotency_key)
    do nothing;
  end if;

  v_status := public.get_usage_status(v_feature);
  v_remaining := coalesce((v_status ->> 'remaining')::integer, 0);
  v_allowed := coalesce((v_status ->> 'allowed')::boolean, false);
  v_near_limit := coalesce((v_status ->> 'near_limit')::boolean, false);

  return jsonb_build_object(
    'ok', true,
    'allowed', v_allowed,
    'used', coalesce((v_status ->> 'used')::integer, 0),
    'quota', coalesce((v_status ->> 'quota')::integer, 0),
    'remaining', v_remaining,
    'near_limit', v_near_limit,
    'message', coalesce(v_status ->> 'message', ''),
    'status', v_status
  );
end;
$$;

-- 9) Atomic caption insert with quota enforcement
create or replace function public.create_caption_generation_if_allowed(
  p_request_id text,
  p_platform text,
  p_generation_style text,
  p_prompt text,
  p_generated_caption text,
  p_generated_hashtags text[] default '{}',
  p_generated_keywords text[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request_id text := nullif(trim(coalesce(p_request_id, '')), '');
  v_status jsonb;
  v_quota integer;
  v_used integer;
  v_fair_usage boolean;
  v_row public.caption_generations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_request_id is null then
    raise exception 'request_id is required';
  end if;

  if exists (
    select 1
    from public.caption_generations cg
    where cg.user_id = v_user_id
      and cg.request_id = v_request_id
  ) then
    select * into v_row
    from public.caption_generations cg
    where cg.user_id = v_user_id
      and cg.request_id = v_request_id
    limit 1;

    v_status := public.get_usage_status('captions');
    return jsonb_build_object('ok', true, 'already_counted', true, 'generation', to_jsonb(v_row), 'status', v_status);
  end if;

  perform pg_advisory_xact_lock(hashtext('caption_insert:' || v_user_id::text || ':' || ((now() at time zone 'utc')::date)::text));

  v_status := public.get_usage_status('captions');
  v_quota := coalesce((v_status ->> 'quota')::integer, 0);
  v_used := coalesce((v_status ->> 'used')::integer, 0);
  v_fair_usage := coalesce((v_status ->> 'fair_usage')::boolean, false);

  if not v_fair_usage and v_used >= v_quota then
    return jsonb_build_object('ok', false, 'error', 'quota_exceeded', 'status', v_status);
  end if;

  insert into public.caption_generations (
    user_id,
    request_id,
    platform,
    generation_style,
    prompt,
    generated_caption,
    generated_hashtags,
    generated_keywords,
    generation_status
  )
  values (
    v_user_id,
    v_request_id,
    lower(trim(p_platform)),
    lower(trim(p_generation_style)),
    p_prompt,
    p_generated_caption,
    coalesce(p_generated_hashtags, '{}'),
    coalesce(p_generated_keywords, '{}'),
    'succeeded'
  )
  returning * into v_row;

  v_status := public.get_usage_status('captions');
  return jsonb_build_object('ok', true, 'generation', to_jsonb(v_row), 'status', v_status);
exception
  when unique_violation then
    select * into v_row
    from public.caption_generations cg
    where cg.user_id = v_user_id
      and cg.request_id = v_request_id
    limit 1;

    v_status := public.get_usage_status('captions');
    return jsonb_build_object('ok', true, 'already_counted', true, 'generation', to_jsonb(v_row), 'status', v_status);
end;
$$;

-- 10) Backward-compatible caption status function
create or replace function public.get_caption_usage_status()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.get_usage_status('captions');
end;
$$;

-- 11) Backward-compatible caption consume function (no longer increments ahead of success)
create or replace function public.consume_caption_quota(p_increment integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status jsonb;
begin
  v_status := public.get_usage_status('captions');

  if coalesce((v_status ->> 'allowed')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'error', 'quota_exceeded', 'status', v_status);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- 12) Function grants
revoke all on function public.get_usage_status(text) from public;
revoke all on function public.consume_feature_quota(text, integer, text) from public;
revoke all on function public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) from public;
revoke all on function public.get_caption_usage_status() from public;
revoke all on function public.consume_caption_quota(integer) from public;

grant execute on function public.get_usage_status(text) to authenticated;
grant execute on function public.consume_feature_quota(text, integer, text) to authenticated;
grant execute on function public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) to authenticated;
grant execute on function public.get_caption_usage_status() to authenticated;
grant execute on function public.consume_caption_quota(integer) to authenticated;