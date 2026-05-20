create table if not exists public.caption_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  generation_style text not null,
  prompt text not null,
  generated_caption text not null,
  generated_hashtags text[] not null default '{}'::text[],
  generated_keywords text[] not null default '{}'::text[],
  is_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caption_generations_platform_check check (platform in ('youtube', 'instagram', 'tiktok', 'facebook')),
  constraint caption_generations_style_check check (generation_style in ('viral', 'seo_optimized', 'storytelling', 'educational', 'bold', 'conversational')),
  constraint caption_generations_prompt_len_check check (char_length(prompt) between 3 and 2000),
  constraint caption_generations_caption_len_check check (char_length(generated_caption) between 10 and 10000)
);

create index if not exists idx_caption_generations_user_created_at on public.caption_generations(user_id, created_at desc);
create index if not exists idx_caption_generations_user_platform_created_at on public.caption_generations(user_id, platform, created_at desc);
create index if not exists idx_caption_generations_user_saved_created_at on public.caption_generations(user_id, is_saved, created_at desc);
create index if not exists idx_caption_generations_hashtags_gin on public.caption_generations using gin (generated_hashtags);
create index if not exists idx_caption_generations_keywords_gin on public.caption_generations using gin (generated_keywords);

alter table public.caption_generations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'caption_generations'
      and policyname = 'Users can view own caption generations'
  ) then
    create policy "Users can view own caption generations"
    on public.caption_generations
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'caption_generations'
      and policyname = 'Users can create own caption generations'
  ) then
    create policy "Users can create own caption generations"
    on public.caption_generations
    for insert
    to authenticated
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'caption_generations'
      and policyname = 'Users can edit own caption generations'
  ) then
    create policy "Users can edit own caption generations"
    on public.caption_generations
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'caption_generations'
      and policyname = 'Users can delete own caption generations'
  ) then
    create policy "Users can delete own caption generations"
    on public.caption_generations
    for delete
    to authenticated
    using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.touch_caption_generations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_caption_generations_updated_at on public.caption_generations;
create trigger trg_caption_generations_updated_at
before update on public.caption_generations
for each row
execute function public.touch_caption_generations_updated_at();

create or replace function public.caption_daily_limit_for_tier(p_tier text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_tier text := lower(coalesce(p_tier, 'free'));
begin
  if v_tier in ('agency', 'scale_agency') then
    return 2000;
  elsif v_tier in ('pro_creator', 'pro') then
    return 120;
  elsif v_tier in ('creator', 'starter') then
    return 40;
  else
    return 10;
  end if;
end;
$$;

create or replace function public.get_caption_usage_status()
returns jsonb
language plpgsql
security definer
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
security definer
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

grant execute on function public.caption_daily_limit_for_tier(text) to authenticated;
grant execute on function public.get_caption_usage_status() to authenticated;
grant execute on function public.consume_caption_quota(integer) to authenticated;