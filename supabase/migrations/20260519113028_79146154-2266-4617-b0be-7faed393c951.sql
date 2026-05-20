alter table public.withdrawal_requests
add column if not exists requester_email text;

create or replace function public.submit_withdrawal_request(p_amount numeric)
returns public.withdrawal_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_available numeric(12,2);
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if p_amount < 25 then raise exception 'Minimum withdrawal is $25'; end if;

  perform public.ensure_affiliate_profile();

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id for update;
  if not found then raise exception 'Affiliate profile not found'; end if;
  if v_profile.payout_method is null or coalesce(v_profile.payout_details, '') = '' then raise exception 'Add payout method first'; end if;

  select
    coalesce(sum(case when ae.status = 'available' then ae.amount else 0 end), 0) -
    coalesce((
      select sum(wr.amount + wr.fee_amount)
      from public.withdrawal_requests wr
      where wr.user_id = v_user_id and wr.status in ('pending','approved','paid')
    ), 0)
  into v_available
  from public.affiliate_earnings ae
  where ae.affiliate_user_id = v_user_id;

  if p_amount > greatest(v_available, 0) then raise exception 'Amount exceeds available balance'; end if;

  insert into public.withdrawal_requests (user_id, requester_email, amount, payout_method, payout_details, status)
  values (v_user_id, v_email, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending')
  returning * into v_request;

  return v_request;
end;
$$;