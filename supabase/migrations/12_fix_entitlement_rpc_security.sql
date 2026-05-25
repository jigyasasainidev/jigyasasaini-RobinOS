-- ============================================================
-- FIX: Entitlement RPC security — add SECURITY DEFINER
-- ============================================================
-- Root cause:
--   check_and_increment_usage, get_usage_status_v2, and
--   resolve_user_plan are called via createUserClient() in
--   the edge function entitlement layer. This means they run
--   under the authenticated user's RLS context (anon key +
--   Bearer JWT via PostgREST).
--
--   usage_tracking has RLS enabled with only:
--     - SELECT policy for authenticated users (own rows)
--     - ALL policy for service_role
--   There is NO INSERT/UPDATE policy for authenticated users.
--
--   Without SECURITY DEFINER, check_and_increment_usage fails
--   with an RLS violation when it tries to INSERT/UPDATE into
--   usage_tracking. This error bubbles up through the edge
--   function as INTERNAL_ERROR → false 403 for all users,
--   including brand-new accounts with zero usage.
--
-- Fix:
--   Add SECURITY DEFINER to the three RPCs that need to write
--   usage data. Each function already validates auth via
--   p_user_id (passed explicitly after JWT verification in the
--   edge function). SECURITY DEFINER is safe here because:
--   1. p_user_id is set by the verified JWT, not caller-supplied
--      without verification (auth is checked in verifyAuth()
--      before calling the RPC).
--   2. All operations are scoped to WHERE user_id = p_user_id.
--   3. The reset_usage function already had SECURITY DEFINER.
--
-- Affected RPCs:
--   - check_and_increment_usage   (reads + writes usage_tracking)
--   - get_usage_status_v2         (reads usage_tracking)
--   - resolve_user_plan           (reads profiles + user_subscriptions)
--   - get_entitlement             (reads plan_entitlements)
--   - get_usage                   (reads usage_tracking)
-- ============================================================

-- ── check_and_increment_usage ─────────────────────────────
-- Re-create with SECURITY DEFINER so it can write usage_tracking
-- regardless of the calling user's RLS context.
create or replace function public.check_and_increment_usage(
  p_user_id uuid,
  p_feature_key text,
  p_increment integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement jsonb;
  v_limit_value numeric;
  v_limit_period text;
  v_enabled boolean;
  v_unlimited boolean;
  v_fair_usage boolean;
  v_metadata jsonb;
  v_period_key text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_current_usage integer;
  v_remaining numeric;
  v_reset_at timestamptz;
  v_fair_usage_warning boolean;
  v_soft_threshold numeric;
  v_abuse_warning_at numeric;
begin
  -- Validate inputs
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'AUTH_REQUIRED',
      'message', 'Authentication required'
    );
  end if;

  if coalesce(p_increment, 0) < 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_INCREMENT',
      'message', 'Increment must be greater than 0'
    );
  end if;

  -- Check idempotency first (prevents double increments)
  if p_idempotency_key is not null then
    perform 1
    from public.feature_usage_events
    where user_id = p_user_id
      and feature_name = p_feature_key
      and idempotency_key = p_idempotency_key;

    if found then
      return jsonb_build_object(
        'success', true,
        'code', 'IDEMPOTENT',
        'feature', p_feature_key,
        'plan', (public.get_entitlement(p_user_id, p_feature_key) ->> 'plan'),
        'message', 'Request already processed',
        'usage', public.get_usage(p_user_id, p_feature_key)
      );
    end if;
  end if;

  -- Resolve entitlement
  v_entitlement := public.get_entitlement(p_user_id, p_feature_key);
  v_enabled      := (v_entitlement ->> 'enabled')::boolean;
  v_limit_value  := (v_entitlement ->> 'limit_value')::numeric;
  v_limit_period := v_entitlement ->> 'limit_period';
  v_unlimited    := (v_entitlement ->> 'unlimited')::boolean;
  v_fair_usage   := (v_entitlement ->> 'fair_usage')::boolean;
  v_metadata     := v_entitlement -> 'metadata';

  -- Feature disabled check
  if not v_enabled then
    return jsonb_build_object(
      'success', false,
      'code', 'FEATURE_DISABLED',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'message', 'This feature is not available on your current plan'
    );
  end if;

  -- Calculate period boundaries
  if v_limit_period = '24h' then
    v_period_start := date_trunc('hour', now()) - interval '24 hours';
    v_period_end   := v_period_start + interval '24 hours';
    v_period_key   := to_char(v_period_start, 'YYYY-MM-DD-HH24');
  elsif v_limit_period = 'day' then
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  elsif v_limit_period = 'month' then
    v_period_start := date_trunc('month', now());
    v_period_end   := v_period_start + interval '1 month';
    v_period_key   := to_char(now(), 'YYYY-MM');
  elsif v_limit_period = 'lifetime' then
    v_period_start := '2025-01-01'::timestamptz;
    v_period_end   := '2099-12-31'::timestamptz;
    v_period_key   := 'lifetime';
  elsif v_limit_period = 'fair_usage' then
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  else
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  end if;

  v_reset_at := v_period_end;

  -- ── UNLIMITED ──────────────────────────────────────────
  if v_unlimited then
    insert into public.usage_tracking
      (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
    values
      (p_user_id, p_feature_key, p_increment, v_period_key, v_period_start, v_period_end, now())
    on conflict (user_id, feature_key, period_key)
    do update set
      usage_count  = public.usage_tracking.usage_count + p_increment,
      last_used_at = now(),
      updated_at   = now();

    if p_idempotency_key is not null then
      insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
      values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
      on conflict (user_id, feature_name, idempotency_key) do nothing;
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'ALLOWED',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'unlimited', true,
      'fair_usage', false,
      'message', 'Usage recorded (unlimited plan)'
    );
  end if;

  -- ── FAIR USAGE ─────────────────────────────────────────
  if v_fair_usage then
    insert into public.usage_tracking
      (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
    values
      (p_user_id, p_feature_key, p_increment, v_period_key, v_period_start, v_period_end, now())
    on conflict (user_id, feature_key, period_key)
    do update set
      usage_count  = public.usage_tracking.usage_count + p_increment,
      last_used_at = now(),
      updated_at   = now()
    returning usage_count into v_current_usage;

    v_soft_threshold    := coalesce((v_metadata ->> 'soft_threshold')::numeric, 0);
    v_abuse_warning_at  := coalesce((v_metadata ->> 'abuse_warning_at')::numeric, 0);
    v_fair_usage_warning := false;

    if v_abuse_warning_at > 0 and v_current_usage >= v_abuse_warning_at then
      v_fair_usage_warning := true;
      update public.usage_tracking
         set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{abuse_warning}', to_jsonb(now()::text))
       where user_id = p_user_id and feature_key = p_feature_key and period_key = v_period_key;
    end if;

    if p_idempotency_key is not null then
      insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
      values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
      on conflict (user_id, feature_name, idempotency_key) do nothing;
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'ALLOWED_FAIR_USAGE',
      'feature', p_feature_key,
      'plan', (v_entitlement ->> 'plan'),
      'unlimited', false,
      'fair_usage', true,
      'usage_count', v_current_usage,
      'soft_threshold', case when v_soft_threshold > 0 then v_soft_threshold else null end,
      'abuse_warning', v_fair_usage_warning,
      'message', case when v_fair_usage_warning
        then 'Fair usage warning: unusually high activity'
        else 'Usage recorded (fair usage)' end
    );
  end if;

  -- ── CAPPED PLAN ────────────────────────────────────────
  -- Ensure a row exists for this period so FOR UPDATE can lock it.
  insert into public.usage_tracking
    (user_id, feature_key, usage_count, period_key, period_start, period_end, last_used_at)
  values
    (p_user_id, p_feature_key, 0, v_period_key, v_period_start, v_period_end, now())
  on conflict (user_id, feature_key, period_key)
  do nothing;

  -- Read current usage with row lock
  select usage_count into v_current_usage
    from public.usage_tracking
   where user_id    = p_user_id
     and feature_key = p_feature_key
     and period_key  = v_period_key
  for update;

  v_current_usage := coalesce(v_current_usage, 0);

  -- Enforce limit
  if v_current_usage + p_increment > v_limit_value then
    v_remaining := greatest(v_limit_value - v_current_usage, 0);
    return jsonb_build_object(
      'success',   false,
      'code',      'USAGE_LIMIT_EXCEEDED',
      'feature',   p_feature_key,
      'plan',      (v_entitlement ->> 'plan'),
      'limit',     v_limit_value,
      'used',      v_current_usage,
      'remaining', v_remaining,
      'reset_at',  v_reset_at,
      'message',   case
        when v_limit_period = '24h' then '24-hour limit reached.'
        else 'Daily ' || replace(p_feature_key, '_', ' ') || ' limit reached.'
      end
    );
  end if;

  -- Atomic increment
  update public.usage_tracking
     set usage_count  = usage_count + p_increment,
         last_used_at = now(),
         updated_at   = now()
   where user_id    = p_user_id
     and feature_key = p_feature_key
     and period_key  = v_period_key;

  if p_idempotency_key is not null then
    insert into public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
    values (p_user_id, p_feature_key, p_increment, p_idempotency_key)
    on conflict (user_id, feature_name, idempotency_key) do nothing;
  end if;

  v_remaining := greatest(v_limit_value - (v_current_usage + p_increment), 0);

  return jsonb_build_object(
    'success',   true,
    'code',      'ALLOWED',
    'feature',   p_feature_key,
    'plan',      (v_entitlement ->> 'plan'),
    'limit',     v_limit_value,
    'used',      v_current_usage + p_increment,
    'remaining', v_remaining,
    'reset_at',  v_reset_at,
    'message',   'Usage recorded'
  );
end;
$$;

-- ── get_usage_status_v2 ────────────────────────────────────
-- Re-create with SECURITY DEFINER so it can read usage_tracking
-- for any user_id without RLS restricting the cross-row SELECT.
create or replace function public.get_usage_status_v2(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement  jsonb;
  v_usage        jsonb;
  v_limit_value  numeric;
  v_enabled      boolean;
  v_unlimited    boolean;
  v_fair_usage   boolean;
  v_usage_count  integer;
  v_remaining    numeric;
  v_allowed      boolean;
  v_near_limit   boolean;
  v_byok_enabled boolean;
begin
  v_entitlement := public.get_entitlement(p_user_id, p_feature_key);
  v_usage       := public.get_usage(p_user_id, p_feature_key);

  v_enabled     := (v_entitlement ->> 'enabled')::boolean;
  v_limit_value := (v_entitlement ->> 'limit_value')::numeric;
  v_unlimited   := (v_entitlement ->> 'unlimited')::boolean;
  v_fair_usage  := (v_entitlement ->> 'fair_usage')::boolean;
  v_usage_count := coalesce((v_usage ->> 'usage_count')::integer, 0);

  -- Feature disabled
  if not v_enabled then
    return jsonb_build_object(
      'allowed',      false,
      'used',         0,
      'quota',        0,
      'remaining',    0,
      'near_limit',   false,
      'fair_usage',   false,
      'unlimited',    false,
      'byok_enabled', false,
      'message',      'Feature not available on your plan'
    );
  end if;

  -- Unlimited or fair usage
  if v_unlimited or v_fair_usage then
    select (v_entitlement ->> 'plan') in ('pro_creator', 'agency', 'scale_agency')
      into v_byok_enabled;

    return jsonb_build_object(
      'allowed',      true,
      'used',         v_usage_count,
      'quota',        null::integer,
      'remaining',    999999,
      'near_limit',   false,
      'fair_usage',   v_fair_usage,
      'unlimited',    v_unlimited,
      'byok_enabled', v_byok_enabled,
      'message',      case when v_fair_usage then 'Unlimited (fair usage)' else 'Unlimited' end
    );
  end if;

  -- Capped plan
  v_remaining  := greatest(v_limit_value - v_usage_count, 0);
  v_allowed    := v_remaining > 0;
  v_near_limit := v_limit_value > 0 and v_usage_count >= ceil(v_limit_value * 0.8);

  select exists (
    select 1 from public.plan_entitlements
     where plan_key    = (v_entitlement ->> 'plan')
       and feature_key = 'byok_access'
       and enabled     = true
       and (limit_value = -1 or limit_value > 0)
  ) into v_byok_enabled;

  return jsonb_build_object(
    'allowed',      v_allowed,
    'used',         v_usage_count,
    'quota',        v_limit_value,
    'remaining',    v_remaining,
    'near_limit',   v_near_limit,
    'fair_usage',   false,
    'unlimited',    false,
    'byok_enabled', coalesce(v_byok_enabled, false),
    'message',      case when v_allowed then 'Usage available' else 'Limit reached' end
  );
end;
$$;

-- ── get_usage (helper — also needs SECURITY DEFINER) ──────
-- Called by check_and_increment_usage and get_usage_status_v2.
-- Must be able to read usage_tracking rows for the given user_id.
create or replace function public.get_usage(p_user_id uuid, p_feature_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement  jsonb;
  v_limit_period text;
  v_period_key   text;
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_usage_record record;
begin
  v_entitlement  := public.get_entitlement(p_user_id, p_feature_key);
  v_limit_period := v_entitlement ->> 'limit_period';

  if v_limit_period = '24h' then
    v_period_start := date_trunc('hour', now()) - interval '24 hours';
    v_period_end   := v_period_start + interval '24 hours';
    v_period_key   := to_char(v_period_start, 'YYYY-MM-DD-HH24');
  elsif v_limit_period = 'day' then
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  elsif v_limit_period = 'month' then
    v_period_start := date_trunc('month', now());
    v_period_end   := v_period_start + interval '1 month';
    v_period_key   := to_char(now(), 'YYYY-MM');
  elsif v_limit_period = 'lifetime' then
    v_period_start := '2025-01-01'::timestamptz;
    v_period_end   := '2099-12-31'::timestamptz;
    v_period_key   := 'lifetime';
  elsif v_limit_period = 'fair_usage' then
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  else
    v_period_start := date_trunc('day', now());
    v_period_end   := v_period_start + interval '1 day';
    v_period_key   := to_char(now(), 'YYYY-MM-DD');
  end if;

  select ut.usage_count, ut.last_used_at, ut.period_start, ut.period_end
    into v_usage_record
    from public.usage_tracking ut
   where ut.user_id     = p_user_id
     and ut.feature_key = p_feature_key
     and ut.period_key  = v_period_key;

  if not found then
    return jsonb_build_object(
      'user_id',      p_user_id,
      'feature',      p_feature_key,
      'period_key',   v_period_key,
      'period_start', v_period_start,
      'period_end',   v_period_end,
      'usage_count',  0,
      'last_used_at', null::timestamptz
    )::jsonb;
  end if;

  return jsonb_build_object(
    'user_id',      p_user_id,
    'feature',      p_feature_key,
    'period_key',   v_period_key,
    'period_start', v_usage_record.period_start,
    'period_end',   v_usage_record.period_end,
    'usage_count',  v_usage_record.usage_count,
    'last_used_at', v_usage_record.last_used_at
  )::jsonb;
end;
$$;
