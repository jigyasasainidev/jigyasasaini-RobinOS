CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawal_requests_active_per_user
ON public.withdrawal_requests (user_id)
WHERE status IN ('pending','approved');

CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_amount numeric)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_wallet public.affiliate_wallets%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_min_withdrawal numeric(10,2) := 25;
  v_has_active_request boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;

  perform public.ensure_affiliate_profile();

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id for update;
  select * into v_wallet from public.affiliate_wallets where user_id = v_user_id for update;

  if v_wallet.id is null then
    raise exception 'Affiliate wallet not found';
  end if;

  select exists(
    select 1
    from public.withdrawal_requests wr
    where wr.user_id = v_user_id
      and wr.status in ('pending','approved')
  ) into v_has_active_request;

  if v_has_active_request then
    raise exception 'You already have a pending withdrawal request under review';
  end if;

  select coalesce(minimum_withdrawal, 25)
  into v_min_withdrawal
  from public.platform_settings
  order by updated_at desc
  limit 1;

  if p_amount < v_min_withdrawal then
    raise exception 'Minimum withdrawal is $%s', v_min_withdrawal;
  end if;

  if coalesce(v_profile.payout_method::text, '') = '' or coalesce(v_profile.payout_details, '') = '' then
    raise exception 'Add payout method first';
  end if;

  if coalesce(v_profile.payout_verified, false) = false then
    raise exception 'Payout method must be verified before withdrawal';
  end if;

  if coalesce(v_wallet.is_active, true) = false or coalesce(v_profile.wallet_active, true) = false then
    raise exception 'Wallet is inactive';
  end if;

  if round(coalesce(v_wallet.available_balance, 0), 2) < round(p_amount, 2) then
    raise exception 'Amount exceeds available balance';
  end if;

  update public.affiliate_wallets
  set available_balance = round(available_balance - p_amount, 2),
      locked_balance = round(locked_balance + p_amount, 2),
      updated_at = now()
  where user_id = v_user_id;

  insert into public.withdrawal_requests(
    user_id, requester_email, amount, payout_method, payout_details, status
  ) values (
    v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending'
  )
  returning * into v_request;

  insert into public.affiliate_wallet_ledger(
    wallet_id, user_id, entry_type, amount, reference_type, reference_id, note
  )
  values (
    v_wallet.id, v_user_id, 'withdrawal_locked', round(p_amount, 2),
    'withdrawal_requests', v_request.id,
    'Withdrawal requested and funds locked'
  );

  return v_request;
end;
$function$;