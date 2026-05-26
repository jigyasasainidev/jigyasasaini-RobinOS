-- ============================================================
-- MIGRATION 43 — Production-grade Payout Ledger
-- ============================================================
-- Fixes 3 critical accounting bugs:
--   1. submit_withdrawal_request() now atomically reserves
--      (deducts) pending_balance so balance can't be double-spent.
--   2. reject_withdrawal() restores reserved amount back to
--      pending_balance with full audit trail.
--   3. mark_withdrawal_paid() finalises the payout correctly
--      (amount was already reserved on submit, just moves to
--      paid_balance).
--
-- LEDGER MODEL:
--   pending_balance  = approved commissions available to withdraw
--                      (decremented on submit, restored on reject)
--   paid_balance     = lifetime paid out (incremented on paid)
--   available_balance (computed) = pending_balance
--                      (no separate column needed — balance is
--                       already reserved at submit time)
--
-- STATUS FLOW:
--   pending → approved → paid
--   pending → rejected  (restores pending_balance)
--   approved → rejected (restores pending_balance)
--   approved → paid
--
-- SAFETY:
--   - FOR UPDATE row locking prevents race conditions
--   - Negative balance guard (greatest(..., 0))
--   - Duplicate pending request guard
--   - Cannot re-process a paid withdrawal
--   - All mutations in single transaction (plpgsql implicit txn)
-- ============================================================

-- ── 1. Drop old functions to allow clean replacement ────────
drop function if exists public.submit_withdrawal_request(numeric);
drop function if exists public.admin_process_withdrawal_request(uuid, text, text);
drop function if exists public.reject_withdrawal(uuid, text);
drop function if exists public.mark_withdrawal_paid(uuid, text);
drop function if exists public.approve_withdrawal(uuid, text);

-- ── 2. submit_withdrawal_request() ─────────────────────────
-- Atomically reserves (deducts) pending_balance on submit.
-- Prevents double-spend: balance is locked immediately.

create or replace function public.submit_withdrawal_request(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid    := auth.uid();
  v_profile  record;
  v_settings record;
  v_min      numeric;
  v_pending  integer;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Authentication required');
  end if;

  -- Lock the profile row to prevent concurrent submissions
  select payout_method,
         payout_details,
         coalesce(pending_balance, 0) as pending_balance
    into v_profile
    from public.affiliate_profiles
   where user_id = v_user_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Affiliate profile not found');
  end if;

  -- Require USDT TRC20 wallet
  if coalesce(v_profile.payout_method, '') <> 'usdt_trc20'
     or coalesce(v_profile.payout_details, '') = '' then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Please save your USDT (TRC20) wallet address before requesting a withdrawal.'
    );
  end if;

  -- Platform settings
  select minimum_withdrawal, payout_delay_days
    into v_settings
    from public.platform_settings
   order by updated_at desc
   limit 1;

  v_min := coalesce(v_settings.minimum_withdrawal, 25);

  if p_amount < v_min then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Amount is below the minimum withdrawal of $' || v_min::text
    );
  end if;

  -- Guard: cannot withdraw more than available balance
  if p_amount > v_profile.pending_balance then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Amount exceeds available balance of $' || v_profile.pending_balance::text
    );
  end if;

  -- Guard: no duplicate pending/approved requests
  select count(*) into v_pending
    from public.withdrawal_requests
   where user_id = v_user_id
     and lower(status) in ('pending', 'approved');

  if v_pending > 0 then
    return jsonb_build_object(
      'ok',    false,
      'error', 'You already have a pending withdrawal request in review.'
    );
  end if;

  -- ✅ CRITICAL FIX: Reserve (deduct) the amount from pending_balance immediately
  -- This prevents the user from submitting another request using the same balance.
  update public.affiliate_profiles
     set pending_balance = greatest(coalesce(pending_balance, 0) - p_amount, 0),
         updated_at      = now()
   where user_id = v_user_id;

  -- Create the withdrawal request
  insert into public.withdrawal_requests
    (user_id, amount, fee_amount, status, payout_method, payout_details)
  values
    (v_user_id, p_amount, 0, 'pending', 'usdt_trc20', v_profile.payout_details);

  return jsonb_build_object('ok', true, 'amount', p_amount, 'method', 'usdt_trc20');
end;
$$;

grant execute on function public.submit_withdrawal_request(numeric) to authenticated;

comment on function public.submit_withdrawal_request(numeric) is
  'Submits a USDT TRC20 withdrawal request. '
  'Atomically reserves (deducts) pending_balance on submit to prevent double-spend. '
  'Prevents duplicate pending requests.';

-- ── 3. approve_withdrawal() ─────────────────────────────────
-- Admin approves a pending request (moves to approved state).
-- Balance was already reserved on submit — no balance change needed.

create or replace function public.approve_withdrawal(
  p_request_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_req      record;
begin
  v_is_admin := public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support');

  if auth.uid() is null or not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  select * into v_req
    from public.withdrawal_requests
   where id = p_request_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Withdrawal request not found');
  end if;

  if v_req.status = 'paid' then
    return jsonb_build_object('ok', false, 'error', 'Cannot modify a paid withdrawal');
  end if;

  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', false, 'error', 'Cannot approve a rejected withdrawal');
  end if;

  if v_req.status = 'approved' then
    return jsonb_build_object('ok', true, 'message', 'Already approved');
  end if;

  update public.withdrawal_requests
     set status      = 'approved',
         admin_note  = coalesce(p_admin_note, admin_note),
         approved_at = coalesce(approved_at, now()),
         updated_at  = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.approve_withdrawal(uuid, text) to authenticated;

comment on function public.approve_withdrawal(uuid, text) is
  'Admin approves a pending withdrawal. Balance already reserved on submit — no balance mutation needed.';

-- ── 4. reject_withdrawal() ──────────────────────────────────
-- ✅ CRITICAL FIX: Restores reserved amount back to pending_balance on reject.

create or replace function public.reject_withdrawal(
  p_request_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_req      record;
begin
  v_is_admin := public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support');

  if auth.uid() is null or not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  select * into v_req
    from public.withdrawal_requests
   where id = p_request_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Withdrawal request not found');
  end if;

  if v_req.status = 'paid' then
    return jsonb_build_object('ok', false, 'error', 'Cannot reject a paid withdrawal');
  end if;

  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'message', 'Already rejected');
  end if;

  -- ✅ CRITICAL FIX: Restore the reserved amount back to pending_balance
  -- This is the amount that was deducted when the user submitted the request.
  update public.affiliate_profiles
     set pending_balance = coalesce(pending_balance, 0) + coalesce(v_req.amount, 0),
         updated_at      = now()
   where user_id = v_req.user_id;

  update public.withdrawal_requests
     set status      = 'rejected',
         admin_note  = coalesce(p_admin_note, admin_note),
         rejected_at = coalesce(rejected_at, now()),
         updated_at  = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'restored_amount', v_req.amount);
end;
$$;

grant execute on function public.reject_withdrawal(uuid, text) to authenticated;

comment on function public.reject_withdrawal(uuid, text) is
  'Admin rejects a pending/approved withdrawal. '
  'Restores the reserved amount back to the affiliate pending_balance. '
  'Preserves full audit trail via rejected_at timestamp.';

-- ── 5. mark_withdrawal_paid() ───────────────────────────────
-- ✅ CRITICAL FIX: Finalises payout correctly.
-- Amount was already reserved (deducted from pending_balance) on submit.
-- Here we just move it to paid_balance and record payout_history.

create or replace function public.mark_withdrawal_paid(
  p_request_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_req      record;
begin
  v_is_admin := public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support');

  if auth.uid() is null or not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;

  select * into v_req
    from public.withdrawal_requests
   where id = p_request_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Withdrawal request not found');
  end if;

  if v_req.status = 'paid' then
    return jsonb_build_object('ok', true, 'message', 'Already marked as paid');
  end if;

  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', false, 'error', 'Cannot mark a rejected withdrawal as paid');
  end if;

  -- ✅ CORRECT ACCOUNTING:
  -- pending_balance was already deducted on submit.
  -- We only need to increment paid_balance to record the lifetime payout.
  -- Do NOT deduct pending_balance again here.
  update public.affiliate_profiles
     set paid_balance = coalesce(paid_balance, 0) + coalesce(v_req.amount, 0),
         updated_at   = now()
   where user_id = v_req.user_id;

  -- Record in payout_history for audit trail
  insert into public.payout_history (
    withdrawal_request_id,
    user_id,
    payout_method,
    payout_details,
    amount,
    processed_by
  )
  values (
    v_req.id,
    v_req.user_id,
    v_req.payout_method,
    v_req.payout_details,
    v_req.amount,
    auth.uid()
  )
  on conflict do nothing;

  update public.withdrawal_requests
     set status       = 'paid',
         admin_note   = coalesce(p_admin_note, admin_note),
         completed_at = coalesce(completed_at, now()),
         updated_at   = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'paid_amount', v_req.amount);
end;
$$;

grant execute on function public.mark_withdrawal_paid(uuid, text) to authenticated;

comment on function public.mark_withdrawal_paid(uuid, text) is
  'Admin marks a withdrawal as paid. '
  'Amount was already reserved on submit — only increments paid_balance. '
  'Records entry in payout_history for full audit trail.';

-- ── 6. admin_process_withdrawal_request() — compatibility shim ──
-- Kept for backward compatibility with any existing admin calls.
-- Routes to the correct new function based on target status.

create or replace function public.admin_process_withdrawal_request(
  p_request_id uuid,
  p_status     text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status = 'paid' then
    return public.mark_withdrawal_paid(p_request_id, p_admin_note);
  elsif v_status = 'rejected' then
    return public.reject_withdrawal(p_request_id, p_admin_note);
  elsif v_status = 'approved' then
    return public.approve_withdrawal(p_request_id, p_admin_note);
  elsif v_status in ('pending', 'reviewing') then
    -- Simple status update, no balance change
    if public.get_admin_role(auth.uid()) not in ('super_admin', 'admin', 'support') then
      return jsonb_build_object('ok', false, 'error', 'Unauthorized');
    end if;
    update public.withdrawal_requests
       set status     = v_status,
           admin_note = coalesce(p_admin_note, admin_note),
           updated_at = now()
     where id = p_request_id;
    return jsonb_build_object('ok', true);
  else
    return jsonb_build_object('ok', false, 'error', 'Invalid status: ' || v_status);
  end if;
end;
$$;

grant execute on function public.admin_process_withdrawal_request(uuid, text, text) to authenticated;

comment on function public.admin_process_withdrawal_request(uuid, text, text) is
  'Backward-compatible shim. Routes to approve_withdrawal(), reject_withdrawal(), '
  'or mark_withdrawal_paid() based on target status.';

-- ── 7. Updated get_affiliate_dashboard() ────────────────────
-- available_balance = pending_balance (already reserved on submit)
-- pending_withdrawals = sum of active withdrawal requests (for display)
-- paid_out = paid_balance (lifetime paid)

drop function if exists public.get_affiliate_dashboard();

create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id           uuid := auth.uid();
  v_row               record;
  v_pending_withdrawal numeric;
  v_approved_commissions numeric;
  v_pending_commissions  numeric;
  v_paid_commissions     numeric;
  v_total_earned         numeric;
  v_paid_conversions     integer;
  v_total_clicks         integer;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  -- Get profile (pending_balance = available to withdraw, paid_balance = lifetime paid)
  select * into v_row
    from public.affiliate_profiles
   where user_id = v_user_id;

  if not found then
    return jsonb_build_object('error', 'PROFILE_NOT_FOUND');
  end if;

  -- Sum of active (pending/approved) withdrawal requests
  -- This is informational — balance is already reserved in pending_balance
  select coalesce(sum(amount), 0) into v_pending_withdrawal
    from public.withdrawal_requests
   where user_id = v_user_id
     and lower(status) in ('pending', 'approved');

  -- Commission breakdown from affiliate_commissions
  select
    coalesce(sum(amount) filter (where status = 'approved'), 0),
    coalesce(sum(amount) filter (where status = 'pending'),  0),
    coalesce(sum(amount) filter (where status = 'paid'),     0),
    coalesce(sum(amount) filter (where status not in ('reversed', 'cancelled')), 0)
  into v_approved_commissions, v_pending_commissions, v_paid_commissions, v_total_earned
  from public.affiliate_commissions
  where affiliate_user_id = v_user_id;

  -- Paid conversions count
  select coalesce(count(distinct referred_user_id), 0)::integer
    into v_paid_conversions
    from public.affiliate_conversions
   where affiliate_user_id = v_user_id
     and plan_code <> 'signup'
     and status not in ('reversed', 'cancelled');

  v_total_clicks := coalesce(v_row.total_clicks, 0);

  return jsonb_build_object(
    'user_id',              v_row.user_id,
    'referral_code',        v_row.referral_code,
    'referral_link',        'https://tryrobin.xyz/?ref=' || v_row.referral_code,

    -- Balance fields
    -- available_balance = pending_balance (reserved on submit, so this is always accurate)
    'available_balance',    coalesce(v_row.pending_balance, 0),
    'pending_withdrawal',   v_pending_withdrawal,
    'paid_out',             coalesce(v_row.paid_balance, 0),

    -- Commission breakdown (for display)
    'approved_commissions', v_approved_commissions,
    'locked_balance',       v_pending_commissions,
    'pending_earnings',     v_pending_commissions,
    'total_earned',         v_total_earned,

    -- Stats
    'total_referrals',      v_total_clicks,
    'referral_clicks',      v_total_clicks,
    'conversion_count',     v_paid_conversions,
    'converted_referrals',  v_paid_conversions,

    -- Payout method
    'payout_method',        v_row.payout_method,
    'payout_details',       v_row.payout_details,
    'payout_verified',      coalesce(v_row.payout_verified, false),
    'payout_updated_at',    v_row.updated_at
  );
end;
$$;

grant execute on function public.get_affiliate_dashboard() to authenticated, anon;

comment on function public.get_affiliate_dashboard() is
  'Returns affiliate dashboard data. '
  'available_balance = pending_balance (reserved atomically on withdrawal submit). '
  'paid_out = paid_balance (lifetime paid). '
  'pending_withdrawal = sum of active withdrawal requests (informational).';

-- ── 8. Data integrity repair ─────────────────────────────────
-- Fix any existing affiliate_profiles where pending_balance is
-- inconsistent with the ledger (e.g. from old code that didn't
-- deduct on submit).
--
-- SAFE REPAIR LOGIC:
--   correct pending_balance = approved_commissions - paid_balance - active_withdrawals
--   where active_withdrawals = sum of pending/approved withdrawal requests
--
-- This only runs once as part of the migration.
-- It will NOT affect users with no withdrawal requests.

do $$
declare
  r record;
  v_approved_commissions numeric;
  v_active_withdrawals   numeric;
  v_correct_balance      numeric;
begin
  for r in
    select ap.user_id, ap.pending_balance, ap.paid_balance
      from public.affiliate_profiles ap
     where exists (
       select 1 from public.withdrawal_requests wr
        where wr.user_id = ap.user_id
          and lower(wr.status) in ('pending', 'approved')
     )
  loop
    -- Sum of approved commissions for this affiliate
    select coalesce(sum(amount), 0) into v_approved_commissions
      from public.affiliate_commissions
     where affiliate_user_id = r.user_id
       and status = 'approved';

    -- Sum of active (pending/approved) withdrawal requests
    select coalesce(sum(amount), 0) into v_active_withdrawals
      from public.withdrawal_requests
     where user_id = r.user_id
       and lower(status) in ('pending', 'approved');

    -- Correct balance = approved commissions - paid out - active withdrawals
    v_correct_balance := greatest(
      v_approved_commissions - coalesce(r.paid_balance, 0) - v_active_withdrawals,
      0
    );

    -- Only update if the balance is wrong (not already deducted)
    if abs(coalesce(r.pending_balance, 0) - v_correct_balance) > 0.001 then
      update public.affiliate_profiles
         set pending_balance = v_correct_balance,
             updated_at      = now()
       where user_id = r.user_id;

      raise notice 'Repaired pending_balance for user %: % -> %',
        r.user_id, r.pending_balance, v_correct_balance;
    end if;
  end loop;
end;
$$;
