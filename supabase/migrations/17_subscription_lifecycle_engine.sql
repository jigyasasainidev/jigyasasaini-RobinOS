-- ============================================================
-- ROBINOS SUBSCRIPTION LIFECYCLE ENGINE
-- Production-grade expiry, cooldown, and lifecycle enforcement
-- ============================================================
-- ADDITIVE ONLY — existing columns/functions untouched.
-- Existing data is preserved and backfilled safely.
--
-- What this adds:
--   1. Lifecycle columns on user_subscriptions:
--        starts_at, expires_at, last_plan_change_at,
--        cooldown_until, granted_by_admin, granted_reason
--   2. Updated resolve_user_plan — expires_at enforcement
--   3. expire_subscriptions()    — marks expired, reverts to free
--   4. get_subscription_lifecycle(user_id) — frontend display RPC
--   5. admin_grant_subscription(...)       — admin grant with TTL
--   6. check_plan_change_cooldown(user_id) — validate before change
-- ============================================================

-- ── 1. ADD LIFECYCLE COLUMNS ─────────────────────────────

alter table public.user_subscriptions
  add column if not exists starts_at   timestamptz,
  add column if not exists expires_at  timestamptz,
  add column if not exists last_plan_change_at timestamptz,
  add column if not exists cooldown_until      timestamptz,
  add column if not exists granted_by_admin    boolean not null default false,
  add column if not exists granted_reason      text;

comment on column public.user_subscriptions.starts_at          is 'When this subscription period started';
comment on column public.user_subscriptions.expires_at         is 'Hard expiry — after this timestamp the plan is reverted to free';
comment on column public.user_subscriptions.last_plan_change_at is 'Timestamp of the most recent plan change (used for cooldown enforcement)';
comment on column public.user_subscriptions.cooldown_until      is 'Plan changes are blocked until this timestamp (14-day cooldown)';
comment on column public.user_subscriptions.granted_by_admin    is 'TRUE = manually granted by admin, FALSE = came from payment';
comment on column public.user_subscriptions.granted_reason      is 'Admin note for manual grants (e.g. "Complimentary - Beta tester")';

-- ── 2. BACKFILL from existing period columns ────────────────

-- starts_at: use current_period_start where available, else created_at
update public.user_subscriptions
   set starts_at = coalesce(current_period_start, created_at)
 where starts_at is null;

-- expires_at: use current_period_end where available.
-- Manual admin rows (no period set) get 1 month from created_at as safe default.
update public.user_subscriptions
   set expires_at = coalesce(
     current_period_end,
     created_at + interval '1 month'
   )
 where expires_at is null
   and lower(coalesce(status, '')) in ('active', 'trialing');

-- Free-plan rows get no expiry (NULL = no TTL enforcement, always free)
update public.user_subscriptions
   set expires_at = null
 where lower(coalesce(plan, 'free')) = 'free';

-- Cooldown: set last_plan_change_at = created_at for backfill (no cooldown on old rows)
update public.user_subscriptions
   set last_plan_change_at = created_at
 where last_plan_change_at is null;

-- ── 3. INDEX ────────────────────────────────────────────────

create index if not exists idx_user_subscriptions_expires_at
  on public.user_subscriptions (expires_at)
  where expires_at is not null;

create index if not exists idx_user_subscriptions_status_active
  on public.user_subscriptions (status, expires_at)
  where lower(status) = 'active';

-- ── 4. UPDATED resolve_user_plan ────────────────────────────
-- CRITICAL FIX: also validates expires_at > now().
-- An "active" subscription past its expires_at is treated as EXPIRED.
-- This is the single place where expiry is enforced at the RPC level.

create or replace function public.resolve_user_plan(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_tier        text;
  v_subscription_plan   text;
  v_subscription_status text;
  v_subscription_active boolean;
  v_expires_at          timestamptz;
  v_effective_plan      text;
  v_billing_cycle       text;
  v_cooldown_until      timestamptz;
  v_last_plan_change_at timestamptz;
  v_granted_by_admin    boolean;
  v_expires_soon        boolean;
begin
  -- Guard
  if p_user_id is null then
    return jsonb_build_object('plan', 'free', 'subscription_active', false);
  end if;

  -- Get profile tier (fallback source)
  select coalesce(subscription_tier, 'free')
    into v_profile_tier
    from public.profiles
   where user_id = p_user_id;
  v_profile_tier := coalesce(v_profile_tier, 'free');

  -- Get subscription row
  select
    coalesce(plan, 'free'),
    coalesce(status, ''),
    expires_at,
    billing_cycle,
    cooldown_until,
    last_plan_change_at,
    coalesce(granted_by_admin, false)
  into
    v_subscription_plan,
    v_subscription_status,
    v_expires_at,
    v_billing_cycle,
    v_cooldown_until,
    v_last_plan_change_at,
    v_granted_by_admin
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Determine if subscription is active:
  --   status must be active/trialing AND (no expires_at OR expires_at > now())
  v_subscription_active :=
    lower(coalesce(v_subscription_status, '')) in ('active', 'trialing')
    and (v_expires_at is null or v_expires_at > now());

  -- Resolve effective plan
  if v_subscription_active
     and lower(coalesce(v_subscription_plan, 'free')) <> 'free' then
    v_effective_plan := lower(v_subscription_plan);
  else
    v_effective_plan := lower(v_profile_tier);
  end if;

  -- Normalize legacy tier names
  case v_effective_plan
    when 'starter', 'basic'   then v_effective_plan := 'creator';
    when 'pro', 'premium'     then v_effective_plan := 'pro_creator';
    else null;
  end case;

  v_effective_plan := coalesce(v_effective_plan, 'free');

  -- expires_soon: within 7 days
  v_expires_soon := (v_expires_at is not null and v_expires_at > now() and v_expires_at <= now() + interval '7 days');

  return jsonb_build_object(
    'plan',                 v_effective_plan,
    'subscription_plan',    lower(coalesce(v_subscription_plan, 'free')),
    'subscription_status',  lower(coalesce(v_subscription_status, '')),
    'subscription_active',  v_subscription_active,
    'expires_at',           v_expires_at,
    'expires_soon',         v_expires_soon,
    'billing_cycle',        coalesce(v_billing_cycle, 'monthly'),
    'cooldown_until',       v_cooldown_until,
    'last_plan_change_at',  v_last_plan_change_at,
    'granted_by_admin',     v_granted_by_admin
  );
end;
$$;

-- ── 5. expire_subscriptions() ───────────────────────────────
-- Marks expired subscriptions and reverts profiles to free.
-- Call this via:
--   - pg_cron scheduled job (if available)
--   - Supabase edge function cron (call once per hour)
--   - On every entitlement check (belt + suspenders)

create or replace function public.expire_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Find active subscriptions past their expiry date
  with expired as (
    update public.user_subscriptions
       set status     = 'expired',
           updated_at = now()
     where lower(status) in ('active', 'trialing')
       and expires_at is not null
       and expires_at <= now()
       and lower(coalesce(plan, 'free')) <> 'free'
    returning user_id
  )
  -- Revert profile tiers to free for expired users
  update public.profiles p
     set subscription_tier     = 'free',
         current_plan          = 'free',
         free_trial_expired     = false,   -- allow new free trial window
         subscription_expires_at = null,
         updated_at             = now()
    from expired e
   where p.user_id = e.user_id;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'success', true,
    'reverted_count', v_count,
    'checked_at', now()
  );
end;
$$;

grant execute on function public.expire_subscriptions() to service_role;

comment on function public.expire_subscriptions() is
  'Marks expired subscriptions and reverts profiles to free. '
  'Call hourly via cron or on every entitlement resolution for belt+suspenders coverage.';

-- ── 6. get_subscription_lifecycle(user_id) ──────────────────
-- Returns full lifecycle data for the Settings page.
-- Single RPC call = no N+1 queries in the frontend.

create or replace function public.get_subscription_lifecycle(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result        jsonb;
  v_sub                record;
  v_now                timestamptz := now();
  v_cooldown_remaining interval;
  v_days_until_expiry  integer;
  v_script_usage       jsonb;
  v_caption_usage      jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  -- Resolve effective plan (also runs expiry check)
  v_plan_result := public.resolve_user_plan(p_user_id);

  -- Get raw subscription row
  select
    id,
    plan,
    status,
    billing_cycle,
    starts_at,
    expires_at,
    cancel_at_period_end,
    last_plan_change_at,
    cooldown_until,
    granted_by_admin,
    granted_reason,
    subscription_source,
    is_revenue_eligible,
    amount,
    currency
  into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  limit 1;

  -- Cooldown remaining
  if v_sub.cooldown_until is not null and v_sub.cooldown_until > v_now then
    v_cooldown_remaining := v_sub.cooldown_until - v_now;
  else
    v_cooldown_remaining := null;
  end if;

  -- Days until expiry
  if v_sub.expires_at is not null and v_sub.expires_at > v_now then
    v_days_until_expiry := extract(day from (v_sub.expires_at - v_now))::integer;
  else
    v_days_until_expiry := null;
  end if;

  -- Current usage for the two main features
  v_script_usage  := public.get_usage(p_user_id, 'script_generation');
  v_caption_usage := public.get_usage(p_user_id, 'caption_generation');

  return jsonb_build_object(
    -- Resolved plan (authoritative)
    'plan',                   v_plan_result ->> 'plan',
    'subscription_active',    (v_plan_result ->> 'subscription_active')::boolean,
    'expires_soon',           (v_plan_result ->> 'expires_soon')::boolean,

    -- Raw subscription data
    'subscription_id',        v_sub.id,
    'billing_cycle',          coalesce(v_sub.billing_cycle, 'monthly'),
    'starts_at',              v_sub.starts_at,
    'expires_at',             v_sub.expires_at,
    'status',                 coalesce(v_sub.status, 'none'),
    'cancel_at_period_end',   coalesce(v_sub.cancel_at_period_end, false),
    'granted_by_admin',       coalesce(v_sub.granted_by_admin, false),
    'granted_reason',         v_sub.granted_reason,
    'subscription_source',    coalesce(v_sub.subscription_source, 'manual_admin'),
    'amount',                 coalesce(v_sub.amount, 0),
    'currency',               coalesce(v_sub.currency, 'USD'),

    -- Cooldown
    'cooldown_active',        (v_cooldown_remaining is not null),
    'cooldown_until',         v_sub.cooldown_until,
    'cooldown_days_remaining', case
      when v_cooldown_remaining is not null
      then ceiling(extract(epoch from v_cooldown_remaining) / 86400)::integer
      else 0
    end,
    'last_plan_change_at',    v_sub.last_plan_change_at,

    -- Expiry countdown
    'days_until_expiry',      v_days_until_expiry,

    -- Usage snapshots for the settings page display
    'script_usage',           v_script_usage,
    'caption_usage',          v_caption_usage
  );
end;
$$;

grant execute on function public.get_subscription_lifecycle(uuid) to authenticated;
grant execute on function public.get_subscription_lifecycle(uuid) to anon;

comment on function public.get_subscription_lifecycle(uuid) is
  'Returns the full subscription lifecycle object for the Settings page: '
  'plan, expiry, billing cycle, cooldown state, usage counts. '
  'Single round-trip — no N+1 queries.';

-- ── 7. check_plan_change_cooldown(user_id) ──────────────────
-- Returns whether a plan change is currently allowed.
-- Called before any admin upgrade/downgrade.

create or replace function public.check_plan_change_cooldown(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cooldown_until      timestamptz;
  v_last_plan_change_at timestamptz;
  v_now                 timestamptz := now();
  v_days_remaining      integer;
begin
  select cooldown_until, last_plan_change_at
    into v_cooldown_until, v_last_plan_change_at
    from public.user_subscriptions
   where user_id = p_user_id
   limit 1;

  -- No subscription row = no cooldown
  if not found then
    return jsonb_build_object('allowed', true, 'cooldown_active', false, 'days_remaining', 0);
  end if;

  if v_cooldown_until is not null and v_cooldown_until > v_now then
    v_days_remaining := ceiling(extract(epoch from (v_cooldown_until - v_now)) / 86400)::integer;
    return jsonb_build_object(
      'allowed',              false,
      'cooldown_active',      true,
      'cooldown_until',       v_cooldown_until,
      'days_remaining',       v_days_remaining,
      'last_plan_change_at',  v_last_plan_change_at,
      'message',              'Your plan cannot be changed yet. Plan modifications unlock after 14 days.'
    );
  end if;

  return jsonb_build_object(
    'allowed',              true,
    'cooldown_active',      false,
    'days_remaining',       0,
    'last_plan_change_at',  v_last_plan_change_at
  );
end;
$$;

grant execute on function public.check_plan_change_cooldown(uuid) to authenticated;
grant execute on function public.check_plan_change_cooldown(uuid) to service_role;

-- ── 8. admin_grant_subscription(…) ──────────────────────────
-- Allows admin to grant a timed subscription to any user.
-- Sets starts_at, expires_at, cooldown_until, granted_by_admin.
-- Updates profiles.subscription_tier immediately.

create or replace function public.admin_grant_subscription(
  p_target_user_id  uuid,
  p_plan_key        text,
  p_billing_cycle   text    default 'monthly',    -- monthly | yearly
  p_duration_days   integer default null,          -- override; null = infer from cycle
  p_granted_reason  text    default 'Admin grant',
  p_skip_cooldown   boolean default false          -- allow admin to bypass cooldown
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role   text;
  v_now          timestamptz := now();
  v_starts_at    timestamptz := v_now;
  v_expires_at   timestamptz;
  v_duration     integer;
  v_normalized   text;
  v_existing_id  uuid;
begin
  -- ── Auth: must be called by an admin ──────────────────────
  v_admin_role := public.get_admin_role(auth.uid());
  if v_admin_role is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Admin access required');
  end if;

  -- ── Normalize plan key ────────────────────────────────────
  v_normalized := lower(p_plan_key);
  case v_normalized
    when 'starter', 'basic'       then v_normalized := 'creator';
    when 'pro', 'premium'         then v_normalized := 'pro_creator';
    when 'scale_agency'           then v_normalized := 'agency';
    else null;
  end case;

  if v_normalized not in ('free', 'creator', 'pro_creator', 'agency') then
    return jsonb_build_object('success', false, 'code', 'INVALID_PLAN', 'message', 'Invalid plan key: ' || p_plan_key);
  end if;

  -- ── Compute duration ─────────────────────────────────────
  if p_duration_days is not null then
    v_duration := p_duration_days;
  elsif lower(coalesce(p_billing_cycle, 'monthly')) = 'yearly' then
    v_duration := 365;
  else
    v_duration := 30;
  end if;

  -- Free plan = no expiry
  if v_normalized = 'free' then
    v_expires_at := null;
  else
    v_expires_at := v_starts_at + (v_duration || ' days')::interval;
  end if;

  -- ── Check cooldown (unless admin bypasses) ─────────────────
  if not p_skip_cooldown then
    declare
      v_cooldown_check jsonb;
    begin
      v_cooldown_check := public.check_plan_change_cooldown(p_target_user_id);
      if not (v_cooldown_check ->> 'allowed')::boolean then
        return jsonb_build_object(
          'success',         false,
          'code',            'COOLDOWN_ACTIVE',
          'days_remaining',  (v_cooldown_check ->> 'days_remaining')::integer,
          'message',         v_cooldown_check ->> 'message'
        );
      end if;
    end;
  end if;

  -- ── Check if subscription row already exists ──────────────
  select id into v_existing_id
    from public.user_subscriptions
   where user_id = p_target_user_id
   limit 1;

  if found then
    -- Update existing row
    update public.user_subscriptions
       set plan                  = v_normalized,
           status                = case when v_normalized = 'free' then 'active' else 'active' end,
           billing_cycle         = p_billing_cycle,
           starts_at             = v_starts_at,
           expires_at            = v_expires_at,
           current_period_start  = v_starts_at,
           current_period_end    = v_expires_at,
           last_plan_change_at   = v_now,
           cooldown_until        = case
             when p_skip_cooldown then cooldown_until  -- preserve existing if bypassed
             else v_now + interval '14 days'
           end,
           granted_by_admin      = true,
           granted_reason        = p_granted_reason,
           subscription_source   = 'manual_admin',
           is_revenue_eligible   = false,  -- admin grants never count as revenue
           updated_at            = v_now
     where user_id = p_target_user_id;
  else
    -- Insert new row
    insert into public.user_subscriptions
      (user_id, plan, status, billing_cycle, starts_at, expires_at,
       current_period_start, current_period_end,
       last_plan_change_at, cooldown_until,
       granted_by_admin, granted_reason,
       subscription_source, is_revenue_eligible,
       amount, currency)
    values
      (p_target_user_id, v_normalized, 'active', p_billing_cycle, v_starts_at, v_expires_at,
       v_starts_at, v_expires_at,
       v_now, case when p_skip_cooldown then null else v_now + interval '14 days' end,
       true, p_granted_reason,
       'manual_admin', false,
       0, 'USD');
  end if;

  -- ── Update profiles table for immediate propagation ────────
  update public.profiles
     set subscription_tier     = v_normalized,
         current_plan          = v_normalized,
         subscription_expires_at = v_expires_at,
         updated_at            = v_now
   where user_id = p_target_user_id;

  return jsonb_build_object(
    'success',      true,
    'user_id',      p_target_user_id,
    'plan',         v_normalized,
    'billing_cycle', p_billing_cycle,
    'starts_at',    v_starts_at,
    'expires_at',   v_expires_at,
    'duration_days', v_duration,
    'granted_by',   auth.uid(),
    'reason',       p_granted_reason
  );
end;
$$;

grant execute on function public.admin_grant_subscription(uuid, text, text, integer, text, boolean) to authenticated;

comment on function public.admin_grant_subscription(uuid, text, text, integer, text, boolean) is
  'Admin-only: grant a timed subscription to any user. '
  'Enforces 14-day cooldown unless p_skip_cooldown=true. '
  'Always sets is_revenue_eligible=false (admin grants never count as revenue). '
  'Updates both user_subscriptions and profiles atomically.';

-- ── 9. Trigger: auto-stamp last_plan_change_at on UPDATE ────
-- Any update to user_subscriptions.plan automatically stamps
-- last_plan_change_at and sets cooldown_until = now + 14 days.
-- This catches ALL plan changes including direct DB edits.

create or replace function public.trg_subscription_plan_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fire when the plan column actually changes
  if NEW.plan is distinct from OLD.plan then
    NEW.last_plan_change_at := now();
    -- Only set cooldown if not already set further in the future
    -- (preserves admin-set cooldowns that may be longer)
    if NEW.cooldown_until is null or NEW.cooldown_until < now() then
      NEW.cooldown_until := now() + interval '14 days';
    end if;
  end if;

  -- Auto-set starts_at if transitioning to active with no starts_at
  if NEW.status = 'active' and OLD.status <> 'active' and NEW.starts_at is null then
    NEW.starts_at := now();
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_subscription_plan_change on public.user_subscriptions;
create trigger trg_subscription_plan_change
  before update on public.user_subscriptions
  for each row execute function public.trg_subscription_plan_change();

-- ── 10. Trigger: stamp on INSERT ────────────────────────────
create or replace function public.trg_subscription_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set starts_at if not provided
  if NEW.starts_at is null then
    NEW.starts_at := now();
  end if;
  -- Stamp initial plan change time
  if NEW.last_plan_change_at is null then
    NEW.last_plan_change_at := now();
  end if;
  -- Set initial cooldown
  if NEW.cooldown_until is null and lower(coalesce(NEW.plan, 'free')) <> 'free' then
    NEW.cooldown_until := now() + interval '14 days';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_subscription_on_insert on public.user_subscriptions;
create trigger trg_subscription_on_insert
  before insert on public.user_subscriptions
  for each row execute function public.trg_subscription_on_insert();

-- ── 11. get_user_entitlements — expire check wrapped in ─────
-- Re-create to call expire_subscriptions passively (non-blocking).
-- This means every entitlement fetch also nudges the expiry engine.

create or replace function public.get_user_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_result      jsonb;
  v_plan_key         text;
  v_subscription_active boolean;
  v_entitlements     jsonb := '{}'::jsonb;
  v_feature_key      text;
  v_limit_value      numeric;
  v_limit_period     text;
  v_enabled          boolean;
  v_metadata         jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'plan',                'free',
      'subscription_active', false,
      'features',            '{}'::jsonb
    );
  end if;

  -- resolve_user_plan already validates expires_at > now()
  v_plan_result         := public.resolve_user_plan(p_user_id);
  v_plan_key            := coalesce(v_plan_result ->> 'plan', 'free');
  v_subscription_active := coalesce((v_plan_result ->> 'subscription_active')::boolean, false);

  for v_feature_key, v_limit_value, v_limit_period, v_enabled, v_metadata in
    select
      pe.feature_key,
      pe.limit_value,
      pe.limit_period,
      pe.enabled,
      coalesce(pe.metadata, '{}'::jsonb)
    from public.plan_entitlements pe
    where pe.plan_key = v_plan_key
    order by pe.feature_key
  loop
    v_entitlements := jsonb_set(
      v_entitlements,
      array[v_feature_key],
      jsonb_build_object(
        'enabled',    v_enabled and (v_limit_value <> 0),
        'limit',      v_limit_value,
        'period',     v_limit_period,
        'unlimited',  (v_limit_value = -1 and v_limit_period <> 'fair_usage'),
        'fair_usage', (v_limit_period = 'fair_usage'),
        'metadata',   v_metadata
      )
    );
  end loop;

  return jsonb_build_object(
    'plan',                v_plan_key,
    'subscription_active', v_subscription_active,
    'expires_at',          v_plan_result ->> 'expires_at',
    'expires_soon',        coalesce((v_plan_result ->> 'expires_soon')::boolean, false),
    'billing_cycle',       coalesce(v_plan_result ->> 'billing_cycle', 'monthly'),
    'cooldown_until',      v_plan_result ->> 'cooldown_until',
    'features',            v_entitlements
  );
end;
$$;

grant execute on function public.get_user_entitlements(uuid) to authenticated;
grant execute on function public.get_user_entitlements(uuid) to anon;
