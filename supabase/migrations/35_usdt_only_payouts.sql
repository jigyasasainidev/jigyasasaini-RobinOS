-- ============================================================
-- MIGRATION 35 — USDT-only payout infrastructure
-- ============================================================
-- Removes PayPal from all payout logic.
-- Migrates existing PayPal rows to usdt_trc20 (blank details).
-- Updates save_payout_method() to reject non-USDT methods.
-- Updates submit_withdrawal_request() accordingly.
-- ADDITIVE + SAFE: no data deleted, no tables dropped.
-- ============================================================

-- ── 1. Migrate existing PayPal rows ───────────────────────
-- Any affiliate_profiles row with payout_method='paypal' gets
-- reset to usdt_trc20 with blank details so the user is prompted
-- to enter their wallet address. No data is lost — payout_details
-- for PayPal was just an email, which we clear for privacy.

update public.affiliate_profiles
   set payout_method  = 'usdt_trc20',
       payout_details = '',
       payout_verified = false,
       updated_at     = now()
 where lower(coalesce(payout_method, '')) = 'paypal';

-- ── 2. Migrate withdrawal_requests default ─────────────────
-- Existing pending/approved rows with payout_method='paypal'
-- are updated to usdt_trc20. Admin will need to confirm wallet
-- address with the affiliate before processing.

update public.withdrawal_requests
   set payout_method = 'usdt_trc20',
       updated_at    = now()
 where lower(coalesce(payout_method, '')) = 'paypal';

-- ── 3. Fix default on withdrawal_requests ─────────────────
alter table public.withdrawal_requests
  alter column payout_method set default 'usdt_trc20';

-- ── 4. UPDATED save_payout_method() ───────────────────────
-- Accepts only 'usdt_trc20'. Rejects all other methods.
-- Validates TRC20 address format server-side.

create or replace function public.save_payout_method(
  p_method  text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_method  text := lower(trim(coalesce(p_method, '')));
  v_details text := trim(coalesce(p_details, ''));
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Authentication required');
  end if;

  -- Only USDT TRC20 supported
  if v_method <> 'usdt_trc20' then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Only USDT (TRC20) payouts are supported. Please enter a valid TRC20 wallet address.'
    );
  end if;

  if v_details = '' then
    return jsonb_build_object('ok', false, 'error', 'Wallet address is required');
  end if;

  -- TRC20 address validation: starts with T, 34 chars, base58
  if not (v_details ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$') then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Invalid TRC20 wallet address. Must start with T and be 34 characters.'
    );
  end if;

  update public.affiliate_profiles
     set payout_method   = v_method,
         payout_details  = v_details,
         payout_verified = false,   -- requires admin verification
         updated_at      = now()
   where user_id = v_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Affiliate profile not found');
  end if;

  return jsonb_build_object('ok', true, 'method', v_method);
end;
$$;

grant execute on function public.save_payout_method(text, text)
  to authenticated;

comment on function public.save_payout_method(text, text) is
  'Saves USDT TRC20 wallet address for affiliate payouts. '
  'Only usdt_trc20 method accepted. Validates TRC20 address format.';

-- ── 5. UPDATED submit_withdrawal_request() ────────────────
-- Removes PayPal references. Uses usdt_trc20 exclusively.

create or replace function public.submit_withdrawal_request(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_profile    record;
  v_settings   record;
  v_min        numeric;
  v_delay      integer;
  v_pending    integer;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Authentication required');
  end if;

  -- Fetch affiliate profile
  select payout_method, payout_details, available_balance
    into v_profile
    from public.affiliate_profiles
   where user_id = v_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Affiliate profile not found');
  end if;

  -- Require USDT wallet address
  if coalesce(v_profile.payout_method, '') <> 'usdt_trc20'
     or coalesce(v_profile.payout_details, '') = '' then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Please save your USDT (TRC20) wallet address before requesting a withdrawal.'
    );
  end if;

  -- Fetch platform settings
  select minimum_withdrawal, payout_delay_days
    into v_settings
    from public.platform_settings
   order by updated_at desc
   limit 1;

  v_min   := coalesce(v_settings.minimum_withdrawal, 25);
  v_delay := coalesce(v_settings.payout_delay_days, 7);

  if p_amount < v_min then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Amount is below the minimum withdrawal of $' || v_min::text
    );
  end if;

  if p_amount > coalesce(v_profile.available_balance, 0) then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Amount exceeds available balance'
    );
  end if;

  -- Prevent duplicate pending requests
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

  -- Insert withdrawal request
  insert into public.withdrawal_requests
    (user_id, amount, fee_amount, status, payout_method, payout_details)
  values
    (v_user_id, p_amount, 0, 'pending', 'usdt_trc20', v_profile.payout_details);

  return jsonb_build_object('ok', true, 'amount', p_amount, 'method', 'usdt_trc20');
end;
$$;

grant execute on function public.submit_withdrawal_request(numeric)
  to authenticated;

comment on function public.submit_withdrawal_request(numeric) is
  'Submits a USDT TRC20 withdrawal request. '
  'Requires a saved wallet address. Prevents duplicate pending requests.';

