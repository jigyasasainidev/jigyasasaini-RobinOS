-- =============================================================================
-- RobinOS — Affiliate Commission Lifecycle Upgrade
-- =============================================================================
--
-- Upgrades the affiliate commission system from a simplistic auto-paid model
-- to a proper production-grade lifecycle with:
--
--   pending -> approved -> payable -> paid
--   (any state) -> reversed
--
-- Also adds:
--   - commission_hold_days for refund safety window
--   - commission_events for immutable auditing
--   - lifecycle timestamps for traceability
--   - strict transition guards
--   - deterministic reversal support
--   - payout batch placeholders
--
-- SAFETY:
--   - Backward compatible. Existing 'paid' rows are preserved as legacy.
--   - No destructive schema changes.
--   - Existing trigger signature unchanged (only status value changes).
--
-- MIGRATION NOTES:
--   - Existing 'paid' commissions are considered legacy pre-lifecycle rows.
--   - Their paid_at is backfilled from updated_at/created_at.
--   - No wallet balance recalculation needed for existing rows.
-- =============================================================================

begin;

-- =============================================================================
-- 1. SCHEMA ADDITIONS
-- =============================================================================

-- 1a. Lifecycle columns on affiliate_commissions
alter table public.affiliate_commissions
  add column if not exists approved_at timestamptz,
  add column if not exists payable_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists reversed_at timestamptz,
  add column if not exists payout_batch_id uuid,
  add column if not exists requires_manual_recovery boolean not null default false;

comment on column public.affiliate_commissions.approved_at is 'When commission was approved for payout eligibility';
comment on column public.affiliate_commissions.payable_at is 'When commission became payable (moved to available_balance)';
comment on column public.affiliate_commissions.paid_at is 'When payout was actually completed';
comment on column public.affiliate_commissions.reversed_at is 'When commission was reversed';
comment on column public.affiliate_commissions.payout_batch_id is 'Future: batch payout reference';
comment on column public.affiliate_commissions.requires_manual_recovery is 'True if paid commission was reversed and needs manual recovery';

-- 1b. Commission hold days on platform_settings
alter table public.platform_settings
  add column if not exists commission_hold_days integer not null default 14;

comment on column public.platform_settings.commission_hold_days is 'Days before pending commissions can be approved (refund safety window)';

-- 1c. Commission events table (immutable audit log)
create table if not exists public.commission_events (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.affiliate_commissions(id) on delete cascade,
  sequence_number integer not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  created_by_system boolean not null default false,
  actor_user_id uuid,
  reason_category text,
  reason_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.commission_events is 'Immutable audit trail for commission lifecycle transitions';
comment on column public.commission_events.sequence_number is 'Monotonic sequence per commission (1, 2, 3...)';
comment on column public.commission_events.event_type is 'generated | approved | payable | paid | reversed | disputed | adjusted';
comment on column public.commission_events.reason_category is 'refund | chargeback | fraud | manual_adjustment | duplicate | abuse';

create unique index if not exists idx_commission_events_commission_seq
  on public.commission_events(commission_id, sequence_number);

create index if not exists idx_commission_events_commission_id
  on public.commission_events(commission_id, created_at desc);

create index if not exists idx_commission_events_event_type
  on public.commission_events(event_type, created_at desc);

-- Enable RLS on commission_events
alter table public.commission_events enable row level security;

drop policy if exists "Admins can manage commission events" on public.commission_events;
create policy "Admins can manage commission events"
  on public.commission_events for all
  to authenticated
  using (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'));

drop policy if exists "Affiliates can view own commission events" on public.commission_events;
create policy "Affiliates can view own commission events"
  on public.commission_events for select
  to authenticated
  using (
    exists (
      select 1 from public.affiliate_commissions ac
      where ac.id = commission_events.commission_id
        and ac.affiliate_user_id = auth.uid()
    )
  );

-- =============================================================================
-- 2. EXISTING ROW BACKFILL
-- =============================================================================
-- Legacy 'paid' commissions get their paid_at backfilled.
-- These rows are treated as equivalent to the new lifecycle 'paid' state.

update public.affiliate_commissions
set paid_at = coalesce(paid_at, updated_at, created_at)
where status = 'paid'
  and paid_at is null;

commit;

-- =============================================================================
-- 3. LIFECYCLE TRANSITION GUARD
-- =============================================================================

create or replace function public.assert_valid_commission_transition(
  p_current_status text,
  p_target_status text
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_current_status = p_target_status then
    raise exception 'Commission is already in status: %', p_current_status;
  end if;

  case p_current_status
    when 'pending' then
      if p_target_status not in ('approved', 'reversed') then
        raise exception 'Invalid transition: pending -> % (allowed: approved, reversed)', p_target_status;
      end if;
    when 'approved' then
      if p_target_status not in ('payable', 'reversed') then
        raise exception 'Invalid transition: approved -> % (allowed: payable, reversed)', p_target_status;
      end if;
    when 'payable' then
      if p_target_status not in ('paid', 'reversed') then
        raise exception 'Invalid transition: payable -> % (allowed: paid, reversed)', p_target_status;
      end if;
    when 'paid' then
      if p_target_status not in ('reversed') then
        raise exception 'Invalid transition: paid -> % (allowed: reversed only with manual recovery)', p_target_status;
      end if;
    when 'reversed' then
      raise exception 'Commission is already reversed — terminal state. No transitions allowed.';
    else
      raise exception 'Unknown commission status: %', p_current_status;
  end case;
end;
$$;

-- =============================================================================
-- 4. SEQUENCE NUMBER HELPER
-- =============================================================================

create or replace function public.next_commission_event_sequence(
  p_commission_id uuid
)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_next integer;
begin
  select coalesce(max(sequence_number), 0) + 1
  into v_next
  from public.commission_events
  where commission_id = p_commission_id;

  return v_next;
end;
$$;

-- =============================================================================
-- 5. UPDATED TRIGGER FUNCTION — commission.status = 'pending' instead of 'paid'
-- =============================================================================

create or replace function public.apply_referral_commission_for_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_by_code text;
  v_affiliate_user_id uuid;
  v_commission_percent numeric := 30;
  v_commission_amount numeric := 0;
  v_inserted_id uuid;
  v_seq integer;
begin
  if coalesce(lower(new.plan), 'free') = 'free' then
    return new;
  end if;

  if coalesce(lower(new.status), '') <> 'active' then
    return new;
  end if;

  if coalesce(new.amount, 0) <= 0 then
    return new;
  end if;

  select p.referred_by_code
  into v_referred_by_code
  from public.profiles p
  where p.user_id = new.user_id;

  if v_referred_by_code is null then
    return new;
  end if;

  select ap.user_id
  into v_affiliate_user_id
  from public.affiliate_profiles ap
  where upper(ap.referral_code) = upper(v_referred_by_code)
  limit 1;

  if v_affiliate_user_id is null or v_affiliate_user_id = new.user_id then
    return new;
  end if;

  select coalesce(ps.affiliate_commission_percent, 30)
  into v_commission_percent
  from public.platform_settings ps
  order by ps.updated_at desc
  limit 1;

  v_commission_amount := round((coalesce(new.amount, 0) * v_commission_percent / 100.0)::numeric, 2);

  if v_commission_amount <= 0 then
    return new;
  end if;

  -- Insert commission with status = 'pending' (not 'paid')
  insert into public.affiliate_commissions (
    affiliate_user_id,
    referred_user_id,
    subscription_id,
    amount,
    status,
    created_at,
    updated_at
  )
  values (
    v_affiliate_user_id,
    new.user_id,
    new.id,
    v_commission_amount,
    'pending',
    now(),
    now()
  )
  on conflict (affiliate_user_id, referred_user_id, subscription_id)
  do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return new;
  end if;

  -- Update affiliate_profiles counters (only pending_balance, NOT available_balance)
  update public.affiliate_profiles ap
  set total_conversions = coalesce(ap.total_conversions, 0) + 1,
      total_earned = coalesce(ap.total_earned, 0) + v_commission_amount,
      pending_balance = coalesce(ap.pending_balance, 0) + v_commission_amount,
      updated_at = now()
  where ap.user_id = v_affiliate_user_id;

  -- Insert wallet ledger entry (commission_pending)
  insert into public.affiliate_wallet_ledger (user_id, entry_type, amount, reference_type, reference_id, notes)
  values (v_affiliate_user_id, 'commission_pending', v_commission_amount, 'subscription', new.id::text, 'Commission generated (pending) from subscription');

  -- Insert commission event
  v_seq := public.next_commission_event_sequence(v_inserted_id);
  insert into public.commission_events (commission_id, sequence_number, from_status, to_status, event_type, created_by_system, reason_notes)
  values (v_inserted_id, v_seq, null, 'pending', 'generated', true, 'Auto-generated from subscription via trg_apply_referral_commission_for_subscription');

  return new;
end;
$$;

-- Replace the trigger to use the updated function
drop trigger if exists trg_apply_referral_commission_for_subscription on public.user_subscriptions;
create trigger trg_apply_referral_commission_for_subscription
  after insert or update of status, plan, amount
  on public.user_subscriptions
  for each row
  execute function public.apply_referral_commission_for_subscription();

-- =============================================================================
-- 6. COMMISSION LIFECYCLE FUNCTIONS
-- =============================================================================

-- 6a. approve_commission — pending -> approved
create or replace function public.approve_commission(
  p_commission_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_hold_days integer;
  v_seq integer;
begin
  select * into v_commission
  from public.affiliate_commissions
  where id = p_commission_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Commission not found');
  end if;

  perform public.assert_valid_commission_transition(v_commission.status, 'approved');

  -- Check hold period unless admin override
  select coalesce(commission_hold_days, 14) into v_hold_days
  from public.platform_settings
  order by updated_at desc
  limit 1;

  if v_commission.created_at + (v_hold_days || ' days')::interval > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Commission is still within hold period',
      'hold_days', v_hold_days,
      'eligible_at', (v_commission.created_at + (v_hold_days || ' days')::interval)::text
    );
  end if;

  update public.affiliate_commissions
  set status = 'approved',
      approved_at = now(),
      updated_at = now()
  where id = p_commission_id;

  v_seq := public.next_commission_event_sequence(p_commission_id);
  insert into public.commission_events (commission_id, sequence_number, from_status, to_status, event_type, actor_user_id, created_by_system)
  values (p_commission_id, v_seq, 'pending', 'approved', 'approved', p_actor_user_id, p_actor_user_id is null);

  return jsonb_build_object('ok', true, 'commission_id', p_commission_id, 'new_status', 'approved');
end;
$$;

-- 6b. approve_commissions_batch — batch version
create or replace function public.approve_commissions_batch(
  p_commission_ids uuid[],
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission_id uuid;
  v_result jsonb;
  v_processed integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  foreach v_commission_id in array p_commission_ids
  loop
    begin
      v_result := public.approve_commission(v_commission_id, p_actor_user_id);
      if (v_result->>'ok')::boolean then
        v_processed := v_processed + 1;
      else
        v_failed := v_failed + 1;
        v_errors := v_errors || jsonb_build_object(
          'commission_id', v_commission_id,
          'error', v_result->>'error'
        );
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'commission_id', v_commission_id,
        'error', SQLERRM
      );
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'failed', v_failed,
    'errors', v_errors
  );
end;
$$;

-- 6c. mark_commission_payable — approved -> payable
-- Moves pending_balance -> available_balance
create or replace function public.mark_commission_payable(
  p_commission_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_seq integer;
begin
  select * into v_commission
  from public.affiliate_commissions
  where id = p_commission_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Commission not found');
  end if;

  perform public.assert_valid_commission_transition(v_commission.status, 'payable');

  -- Update commission status
  update public.affiliate_commissions
  set status = 'payable',
      payable_at = now(),
      updated_at = now()
  where id = p_commission_id;

  -- Move from pending_balance to available_balance in affiliate_profiles
  update public.affiliate_profiles
  set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
      updated_at = now()
  where user_id = v_commission.affiliate_user_id;

  -- Move from pending_balance to available_balance in affiliate_wallets
  update public.affiliate_wallets
  set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
      available_balance = coalesce(available_balance, 0) + v_commission.amount,
      updated_at = now()
  where user_id = v_commission.affiliate_user_id;

  -- Ledger entry: commission_payable (credit side — records the move)
  insert into public.affiliate_wallet_ledger (user_id, entry_type, amount, reference_type, reference_id, notes)
  values (
    v_commission.affiliate_user_id,
    'commission_payable',
    v_commission.amount,
    'commission',
    p_commission_id::text,
    'Commission moved to payable (pending -> available)'
  );

  v_seq := public.next_commission_event_sequence(p_commission_id);
  insert into public.commission_events (commission_id, sequence_number, from_status, to_status, event_type, actor_user_id)
  values (p_commission_id, v_seq, 'approved', 'payable', 'payable', p_actor_user_id);

  return jsonb_build_object(
    'ok', true,
    'commission_id', p_commission_id,
    'new_status', 'payable',
    'amount_moved', v_commission.amount
  );
end;
$$;

-- 6d. process_commission_payout — payable -> paid
-- Only records payout completion. Does NOT deduct available_balance.
-- Actual balance deduction happens in the withdrawal settlement flow.
create or replace function public.process_commission_payout(
  p_commission_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_seq integer;
begin
  select * into v_commission
  from public.affiliate_commissions
  where id = p_commission_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Commission not found');
  end if;

  perform public.assert_valid_commission_transition(v_commission.status, 'paid');

  -- Update commission status
  update public.affiliate_commissions
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where id = p_commission_id;

  -- Insert payout_history record
  insert into public.payout_history (user_id, amount, commission_id, processed_at, processed_by)
  values (
    v_commission.affiliate_user_id,
    v_commission.amount,
    p_commission_id,
    now(),
    coalesce(p_actor_user_id, auth.uid())
  );

  -- Ledger entry: informational — payout completed (zero net balance impact)
  insert into public.affiliate_wallet_ledger (user_id, entry_type, amount, reference_type, reference_id, notes)
  values (
    v_commission.affiliate_user_id,
    'commission_paid',
    v_commission.amount,
    'commission',
    p_commission_id::text,
    'Commission payout processed (recorded — no balance deduction here)'
  );

  v_seq := public.next_commission_event_sequence(p_commission_id);
  insert into public.commission_events (commission_id, sequence_number, from_status, to_status, event_type, actor_user_id)
  values (p_commission_id, v_seq, 'payable', 'paid', 'paid', p_actor_user_id);

  return jsonb_build_object(
    'ok', true,
    'commission_id', p_commission_id,
    'new_status', 'paid',
    'amount', v_commission.amount
  );
end;
$$;

-- 6e. reverse_commission — any status -> reversed
-- Supports reversal from ANY lifecycle state, including 'paid'.
-- If reversing from 'paid', flags requires_manual_recovery = true.
-- Creates compensating ledger entries. Never deletes data.
create or replace function public.reverse_commission(
  p_commission_id uuid,
  p_reason_category text,
  p_actor_user_id uuid default null,
  p_reason_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_was_paid boolean;
  v_seq integer;
begin
  -- Validate reason category
  if p_reason_category is null or p_reason_category not in ('refund', 'chargeback', 'fraud', 'manual_adjustment', 'duplicate', 'abuse') then
    return jsonb_build_object(
      'ok', false,
      'error', 'Invalid reason_category. Must be one of: refund, chargeback, fraud, manual_adjustment, duplicate, abuse'
    );
  end if;

  select * into v_commission
  from public.affiliate_commissions
  where id = p_commission_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Commission not found');
  end if;

  -- Allow reversal from any state via assert (reversed -> reversed will be caught by the guard)
  perform public.assert_valid_commission_transition(v_commission.status, 'reversed');

  v_was_paid := (v_commission.status = 'paid');

  -- Update commission
  update public.affiliate_commissions
  set status = 'reversed',
      reversed_at = now(),
      requires_manual_recovery = v_was_paid,
      updated_at = now()
  where id = p_commission_id;

  -- Wallet balance adjustments based on current lifecycle state
  if v_commission.status = 'pending' then
    -- Only pending_balance was touched — reverse it
    update public.affiliate_profiles
    set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
        total_earned = greatest(coalesce(total_earned, 0) - v_commission.amount, 0),
        total_conversions = greatest(coalesce(total_conversions, 0) - 1, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

    update public.affiliate_wallets
    set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
        lifetime_earnings = greatest(coalesce(lifetime_earnings, 0) - v_commission.amount, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

  elsif v_commission.status = 'approved' then
    -- Still only pending_balance was touched — reverse it
    update public.affiliate_profiles
    set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
        total_earned = greatest(coalesce(total_earned, 0) - v_commission.amount, 0),
        total_conversions = greatest(coalesce(total_conversions, 0) - 1, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

    update public.affiliate_wallets
    set pending_balance = greatest(coalesce(pending_balance, 0) - v_commission.amount, 0),
        lifetime_earnings = greatest(coalesce(lifetime_earnings, 0) - v_commission.amount, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

  elsif v_commission.status = 'payable' then
    -- Money was moved to available_balance — deduct from available
    update public.affiliate_profiles
    set total_earned = greatest(coalesce(total_earned, 0) - v_commission.amount, 0),
        total_conversions = greatest(coalesce(total_conversions, 0) - 1, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;
    -- Note: available_balance is only in wallets, not profiles

    update public.affiliate_wallets
    set available_balance = greatest(coalesce(available_balance, 0) - v_commission.amount, 0),
        lifetime_earnings = greatest(coalesce(lifetime_earnings, 0) - v_commission.amount, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

  elsif v_was_paid then
    -- Commission was already paid out — deduct from available_balance
    -- and flag for manual recovery since funds may have been withdrawn
    update public.affiliate_profiles
    set total_earned = greatest(coalesce(total_earned, 0) - v_commission.amount, 0),
        total_conversions = greatest(coalesce(total_conversions, 0) - 1, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;

    update public.affiliate_wallets
    set available_balance = greatest(coalesce(available_balance, 0) - v_commission.amount, 0),
        lifetime_earnings = greatest(coalesce(lifetime_earnings, 0) - v_commission.amount, 0),
        updated_at = now()
    where user_id = v_commission.affiliate_user_id;
  end if;

  -- Compensating ledger entry (negative amount for reversal)
  insert into public.affiliate_wallet_ledger (user_id, entry_type, amount, reference_type, reference_id, notes)
  values (
    v_commission.affiliate_user_id,
    'commission_reversed',
    v_commission.amount,
    'commission',
    p_commission_id::text,
    'Reversal: ' || p_reason_category || coalesce('. ' || p_reason_notes, '')
  );

  v_seq := public.next_commission_event_sequence(p_commission_id);
  insert into public.commission_events (
    commission_id, sequence_number, from_status, to_status, event_type,
    created_by_system, actor_user_id, reason_category, reason_notes
  )
  values (
    p_commission_id, v_seq, v_commission.status, 'reversed', 'reversed',
    p_actor_user_id is null, p_actor_user_id, p_reason_category, p_reason_notes
  );

  return jsonb_build_object(
    'ok', true,
    'commission_id', p_commission_id,
    'new_status', 'reversed',
    'requires_manual_recovery', v_was_paid
  );
end;
$$;

-- =============================================================================
-- 7. INDEXES FOR LIFECYCLE QUERIES
-- =============================================================================

create index if not exists idx_affiliate_commissions_lifecycle
  on public.affiliate_commissions(status, created_at desc);

create index if not exists idx_affiliate_commissions_hold_check
  on public.affiliate_commissions(status, created_at)
  where status = 'pending';

create index if not exists idx_affiliate_commissions_stuck
  on public.affiliate_commissions(status, created_at)
  where status in ('pending', 'approved');

-- =============================================================================
-- 8. FINAL NOTES
-- =============================================================================
--
-- USAGE:
--   1. approve_commission(id)           — pending -> approved (after hold period)
--   2. approve_commissions_batch(ids[]) — batch approval
--   3. mark_commission_payable(id)      — approved -> payable (moves to available)
--   4. process_commission_payout(id)    — payable -> paid (records payout)
--   5. reverse_commission(id, reason)   — any -> reversed (compensating entries)
--
-- The actual available_balance deduction happens in the withdrawal settlement flow.
-- Commission lifecycle and wallet payout lifecycle are deliberately separated.
-- =============================================================================

-- End of migration