-- ============================================================
-- MIGRATION 38 — Commission State Machine
-- ============================================================
-- Adds cooldown-based commission lifecycle to affiliate_commissions.
--
-- Status flow:
--   pending → approved  (after 14-day cooldown, no refund/chargeback)
--   pending → reversed  (refund, chargeback, or payment_failed)
--   approved → paid     (admin processes payout)
--   approved → reversed (late chargeback — rare but possible)
--
-- Key rules:
--   - Commission is NOT withdrawable until status = 'approved'
--   - Cancellation of future renewal ≠ reversal (user keeps access)
--   - Refund / chargeback / payment_failed = reversal
--   - 14-day cooldown before auto-approval
--   - pending_balance only reflects approved commissions
-- ============================================================

-- ── 1. Add lifecycle columns to affiliate_commissions ──────

alter table public.affiliate_commissions
  add column if not exists status          text        not null default 'pending',
  add column if not exists eligible_at     timestamptz,          -- when cooldown ends
  add column if not exists approved_at     timestamptz,
  add column if not exists reversed_at     timestamptz,
  add column if not exists reversal_reason text,
  add column if not exists updated_at      timestamptz not null default now();

-- Backfill: existing rows get 14-day cooldown from created_at
update public.affiliate_commissions
   set eligible_at = created_at + interval '14 days',
       updated_at  = now()
 where eligible_at is null;

comment on column public.affiliate_commissions.status is
  'pending | approved | paid | reversed | cancelled';
comment on column public.affiliate_commissions.eligible_at is
  '14 days after payment — commission becomes withdrawable if not reversed';
comment on column public.affiliate_commissions.approved_at is
  'When commission moved from pending → approved (after cooldown)';
comment on column public.affiliate_commissions.reversed_at is
  'When commission was reversed due to refund/chargeback/payment_failed';
comment on column public.affiliate_commissions.reversal_reason is
  'refund | chargeback | payment_failed | fraud | manual_admin';

-- ── 2. Indexes ─────────────────────────────────────────────

create index if not exists idx_affiliate_commissions_status
  on public.affiliate_commissions (status, eligible_at);

create index if not exists idx_affiliate_commissions_eligible
  on public.affiliate_commissions (eligible_at)
  where status = 'pending';

create index if not exists idx_affiliate_commissions_dodo_sub_status
  on public.affiliate_commissions (dodo_subscription_id, status)
  where dodo_subscription_id is not null;

-- ── 3. Fix affiliate_profiles balance columns ──────────────
-- pending_balance = sum of APPROVED commissions not yet paid
-- (not pending — pending is locked during cooldown)

alter table public.affiliate_profiles
  add column if not exists locked_balance numeric not null default 0;

comment on column public.affiliate_profiles.locked_balance is
  'Sum of pending commissions in 14-day cooldown — NOT withdrawable yet';
comment on column public.affiliate_profiles.pending_balance is
  'Sum of approved commissions — withdrawable';

-- ── 4. Fix increment_affiliate_balance() ──────────────────
-- On payment: increment locked_balance (not pending_balance).
-- pending_balance only increases when commission is approved.

create or replace function public.increment_affiliate_balance(
  p_affiliate_user_id uuid,
  p_amount            numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- New commissions go into locked_balance during 14-day cooldown
  update public.affiliate_profiles
     set total_earned    = coalesce(total_earned, 0)    + p_amount,
         locked_balance  = coalesce(locked_balance, 0)  + p_amount,
         updated_at      = now()
   where user_id = p_affiliate_user_id;
end;
$$;

grant execute on function public.increment_affiliate_balance(uuid, numeric)
  to service_role;

-- ── 5. approve_pending_commissions() — cron job ───────────
-- Run daily. Moves commissions past their 14-day cooldown
-- from pending → approved and unlocks the balance.

create or replace function public.approve_pending_commissions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now     timestamptz := now() at time zone 'UTC';
  v_count   integer := 0;
  v_row     record;
begin
  for v_row in
    select id, affiliate_user_id, amount
    from public.affiliate_commissions
    where status = 'pending'
      and eligible_at is not null
      and eligible_at <= v_now
    for update skip locked
  loop
    -- Move to approved
    update public.affiliate_commissions
       set status      = 'approved',
           approved_at = v_now,
           updated_at  = v_now
     where id = v_row.id;

    -- Move from locked_balance → pending_balance (withdrawable)
    update public.affiliate_profiles
       set locked_balance  = greatest(coalesce(locked_balance, 0)  - v_row.amount, 0),
           pending_balance = coalesce(pending_balance, 0) + v_row.amount,
           updated_at      = v_now
     where user_id = v_row.affiliate_user_id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success',   true,
    'approved',  v_count,
    'checked_at', v_now
  );
end;
$$;

grant execute on function public.approve_pending_commissions()
  to service_role;

comment on function public.approve_pending_commissions() is
  'Cron job: approves commissions past 14-day cooldown. '
  'Moves locked_balance → pending_balance (withdrawable). '
  'Run daily via pg_cron or Supabase edge function cron.';

-- ── 6. reverse_commission() — called by webhook ───────────
-- Reverses a pending or approved commission.
-- Called on: refund, chargeback, payment_failed.
-- NOT called on: subscription.cancelled (user keeps access).

create or replace function public.reverse_commission(
  p_dodo_subscription_id text,
  p_reason               text default 'refund'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now() at time zone 'UTC';
  v_row  record;
  v_count integer := 0;
begin
  for v_row in
    select id, affiliate_user_id, amount, status
    from public.affiliate_commissions
    where dodo_subscription_id = p_dodo_subscription_id
      and status in ('pending', 'approved')
    for update skip locked
  loop
    -- Mark reversed
    update public.affiliate_commissions
       set status          = 'reversed',
           reversed_at     = v_now,
           reversal_reason = p_reason,
           updated_at      = v_now
     where id = v_row.id;

    -- Deduct from the correct balance bucket
    if v_row.status = 'pending' then
      update public.affiliate_profiles
         set locked_balance = greatest(coalesce(locked_balance, 0) - v_row.amount, 0),
             total_earned   = greatest(coalesce(total_earned, 0)   - v_row.amount, 0),
             updated_at     = v_now
       where user_id = v_row.affiliate_user_id;
    elsif v_row.status = 'approved' then
      update public.affiliate_profiles
         set pending_balance = greatest(coalesce(pending_balance, 0) - v_row.amount, 0),
             total_earned    = greatest(coalesce(total_earned, 0)    - v_row.amount, 0),
             updated_at      = v_now
       where user_id = v_row.affiliate_user_id;
    end if;

    -- Emit admin notification
    perform public.push_admin_notification(
      'affiliate',
      '⚠️ Commission reversed',
      '$' || v_row.amount::text || ' · reason: ' || p_reason,
      'warning',
      jsonb_build_object(
        'commission_id',        v_row.id,
        'affiliate_user_id',    v_row.affiliate_user_id,
        'amount',               v_row.amount,
        'reason',               p_reason,
        'dodo_subscription_id', p_dodo_subscription_id
      )
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success',  true,
    'reversed', v_count,
    'reason',   p_reason
  );
end;
$$;

grant execute on function public.reverse_commission(text, text)
  to service_role;

comment on function public.reverse_commission(text, text) is
  'Reverses pending/approved commissions for a subscription. '
  'Called on refund, chargeback, payment_failed. '
  'NOT called on subscription.cancelled (user keeps access).';

-- ── 7. get_affiliate_dashboard view — update balance display ─
-- The existing get_affiliate_dashboard RPC needs to show
-- locked_balance separately so affiliates understand the cooldown.
-- We patch it here to include locked_balance in the response.

create or replace function public.get_affiliate_dashboard_v2(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_profile  record;
  v_pending_commissions integer;
  v_locked_amount numeric;
begin
  if p_user_id is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  select
    ap.user_id,
    ap.referral_code,
    ap.total_clicks,
    ap.total_conversions,
    coalesce(ap.total_earned, 0)    as total_earned,
    coalesce(ap.pending_balance, 0) as available_balance,  -- approved, withdrawable
    coalesce(ap.locked_balance, 0)  as locked_balance,     -- in cooldown
    coalesce(ap.paid_balance, 0)    as paid_out,
    ap.payout_method,
    ap.payout_details,
    ap.payout_verified,
    ap.updated_at                   as payout_updated_at
  into v_profile
  from public.affiliate_profiles ap
  where ap.user_id = p_user_id;

  if not found then
    return jsonb_build_object('error', 'PROFILE_NOT_FOUND');
  end if;

  -- Count pending commissions in cooldown
  select count(*), coalesce(sum(amount), 0)
    into v_pending_commissions, v_locked_amount
    from public.affiliate_commissions
   where affiliate_user_id = p_user_id
     and status = 'pending';

  return jsonb_build_object(
    'user_id',          v_profile.user_id,
    'referral_code',    v_profile.referral_code,
    'referral_link',    'https://tryrobin.xyz/?ref=' || v_profile.referral_code,
    'total_clicks',     coalesce(v_profile.total_clicks, 0),
    'total_conversions', coalesce(v_profile.total_conversions, 0),
    'total_earned',     v_profile.total_earned,
    'available_balance', v_profile.available_balance,
    'locked_balance',   v_profile.locked_balance,
    'pending_commissions_count', v_pending_commissions,
    'paid_out',         v_profile.paid_out,
    'payout_method',    v_profile.payout_method,
    'payout_details',   v_profile.payout_details,
    'payout_verified',  coalesce(v_profile.payout_verified, false),
    'payout_updated_at', v_profile.payout_updated_at
  );
end;
$$;

grant execute on function public.get_affiliate_dashboard_v2(uuid)
  to authenticated, anon;

-- ── 8. Cron: approve commissions daily ────────────────────
-- Requires pg_cron extension. Run in Supabase SQL Editor:
-- select cron.schedule('approve-commissions', '0 2 * * *',
--   'select public.approve_pending_commissions()');
