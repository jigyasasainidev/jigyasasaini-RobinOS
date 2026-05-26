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

  -- pending_balance = approved commissions (withdrawable)
  select payout_method, payout_details,
         coalesce(pending_balance, 0) as withdrawable_balance
    into v_profile
    from public.affiliate_profiles
   where user_id = v_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Affiliate profile not found');
  end if;

  if coalesce(v_profile.payout_method, '') <> 'usdt_trc20'
     or coalesce(v_profile.payout_details, '') = '' then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Please save your USDT (TRC20) wallet address before requesting a withdrawal.'
    );
  end if;

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

  if p_amount > v_profile.withdrawable_balance then
    return jsonb_build_object(
      'ok',    false,
      'error', 'Amount exceeds available balance'
    );
  end if;

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

  insert into public.withdrawal_requests
    (user_id, amount, fee_amount, status, payout_method, payout_details)
  values
    (v_user_id, p_amount, 0, 'pending', 'usdt_trc20', v_profile.payout_details);

  return jsonb_build_object('ok', true, 'amount', p_amount, 'method', 'usdt_trc20');
end;
$$;

grant execute on function public.submit_withdrawal_request(numeric) to authenticated;
