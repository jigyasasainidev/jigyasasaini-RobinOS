do $$ begin
  create type public.payout_method_type as enum ('paypal', 'usdt_trc20');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.earning_status as enum ('pending', 'available', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.withdrawal_status as enum ('pending', 'approved', 'paid', 'rejected');
exception when duplicate_object then null; end $$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create table if not exists public.affiliate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  referral_code text not null unique,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean not null default false,
  payout_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referred_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  referred_user_id uuid,
  plan_code text,
  billed_amount numeric(12,2) not null default 0,
  commission_rate numeric(5,4) not null default 0.30,
  commission_amount numeric(12,2) not null default 0,
  converted_at timestamptz not null default now()
);

create table if not exists public.affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null,
  conversion_id uuid references public.affiliate_conversions(id) on delete set null,
  amount numeric(12,2) not null,
  status public.earning_status not null default 'pending',
  release_at timestamptz,
  released_at timestamptz,
  paid_out_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric(12,2) not null,
  fee_amount numeric(12,2) not null default 0,
  status public.withdrawal_status not null default 'pending',
  payout_method public.payout_method_type not null,
  payout_details text not null,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz
);

create index if not exists idx_affiliate_clicks_affiliate_user on public.affiliate_clicks(affiliate_user_id);
create index if not exists idx_affiliate_conversions_affiliate_user on public.affiliate_conversions(affiliate_user_id);
create index if not exists idx_affiliate_earnings_affiliate_user on public.affiliate_earnings(affiliate_user_id);
create index if not exists idx_affiliate_earnings_status on public.affiliate_earnings(status);
create index if not exists idx_withdrawal_requests_user_id on public.withdrawal_requests(user_id);
create index if not exists idx_withdrawal_requests_status on public.withdrawal_requests(status);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_affiliate_profiles_touch on public.affiliate_profiles;
create trigger trg_affiliate_profiles_touch
before update on public.affiliate_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_withdrawal_requests_touch on public.withdrawal_requests;
create trigger trg_withdrawal_requests_touch
before update on public.withdrawal_requests
for each row execute function public.touch_updated_at();

alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.affiliate_earnings enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "Users read own affiliate profile" on public.affiliate_profiles;
create policy "Users read own affiliate profile"
on public.affiliate_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users create own affiliate profile" on public.affiliate_profiles;
create policy "Users create own affiliate profile"
on public.affiliate_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users update own affiliate profile" on public.affiliate_profiles;
create policy "Users update own affiliate profile"
on public.affiliate_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Admins read all affiliate profiles" on public.affiliate_profiles;
create policy "Admins read all affiliate profiles"
on public.affiliate_profiles
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users read own clicks" on public.affiliate_clicks;
create policy "Users read own clicks"
on public.affiliate_clicks
for select
to authenticated
using (auth.uid() = affiliate_user_id);

drop policy if exists "Admins read all clicks" on public.affiliate_clicks;
create policy "Admins read all clicks"
on public.affiliate_clicks
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users read own conversions" on public.affiliate_conversions;
create policy "Users read own conversions"
on public.affiliate_conversions
for select
to authenticated
using (auth.uid() = affiliate_user_id);

drop policy if exists "Admins read all conversions" on public.affiliate_conversions;
create policy "Admins read all conversions"
on public.affiliate_conversions
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users read own earnings" on public.affiliate_earnings;
create policy "Users read own earnings"
on public.affiliate_earnings
for select
to authenticated
using (auth.uid() = affiliate_user_id);

drop policy if exists "Admins read all earnings" on public.affiliate_earnings;
create policy "Admins read all earnings"
on public.affiliate_earnings
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users read own withdrawals" on public.withdrawal_requests;
create policy "Users read own withdrawals"
on public.withdrawal_requests
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users insert own withdrawals" on public.withdrawal_requests;
create policy "Users insert own withdrawals"
on public.withdrawal_requests
for insert
to authenticated
with check (auth.uid() = user_id and status = 'pending');

drop policy if exists "Admins read all withdrawals" on public.withdrawal_requests;
create policy "Admins read all withdrawals"
on public.withdrawal_requests
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins update withdrawals" on public.withdrawal_requests;
create policy "Admins update withdrawals"
on public.withdrawal_requests
for update
to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.ensure_affiliate_profile()
returns public.affiliate_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_seed text;
  v_candidate text;
  v_try integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.affiliate_profiles where user_id = v_user_id;
  if found then return v_profile; end if;

  v_seed := lower(substring(replace(v_user_id::text, '-', '') from 1 for 8));
  v_candidate := 'robin' || v_seed;

  loop
    begin
      insert into public.affiliate_profiles (user_id, referral_code)
      values (v_user_id, v_candidate)
      returning * into v_profile;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      v_candidate := 'robin' || v_seed || lpad(v_try::text, 2, '0');
    end;
  end loop;

  return v_profile;
end;
$$;

create or replace function public.save_payout_method(
  p_method public.payout_method_type,
  p_details text
)
returns public.affiliate_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.affiliate_profiles%rowtype;
  v_clean text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_clean := trim(coalesce(p_details, ''));
  if length(v_clean) = 0 or length(v_clean) > 160 then raise exception 'Invalid payout details'; end if;

  perform public.ensure_affiliate_profile();

  update public.affiliate_profiles
  set payout_method = p_method,
      payout_details = v_clean,
      payout_verified = false,
      payout_updated_at = now()
  where user_id = v_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

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

  insert into public.withdrawal_requests (user_id, amount, payout_method, payout_details, status)
  values (v_user_id, round(p_amount, 2), v_profile.payout_method, v_profile.payout_details, 'pending')
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.admin_update_withdrawal_status(
  p_request_id uuid,
  p_status public.withdrawal_status,
  p_admin_note text default null
)
returns public.withdrawal_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.withdrawal_requests%rowtype;
  v_updated public.withdrawal_requests%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.has_role(v_actor, 'admin') then raise exception 'Admin privileges required'; end if;

  select * into v_existing from public.withdrawal_requests where id = p_request_id for update;
  if not found then raise exception 'Withdrawal request not found'; end if;

  if p_status = 'approved' then
    if v_existing.status <> 'pending' then raise exception 'Only pending can be approved'; end if;
    update public.withdrawal_requests set status = 'approved', approved_at = now(), admin_note = p_admin_note where id = p_request_id returning * into v_updated;
  elsif p_status = 'paid' then
    if v_existing.status <> 'approved' then raise exception 'Only approved can be marked paid'; end if;
    update public.withdrawal_requests set status = 'paid', completed_at = now(), admin_note = p_admin_note where id = p_request_id returning * into v_updated;
  elsif p_status = 'rejected' then
    if v_existing.status = 'paid' then raise exception 'Paid request cannot be rejected'; end if;
    update public.withdrawal_requests set status = 'rejected', rejected_at = now(), admin_note = p_admin_note where id = p_request_id returning * into v_updated;
  else
    raise exception 'Unsupported status transition';
  end if;

  return v_updated;
end;
$$;

create or replace function public.get_affiliate_dashboard()
returns table (
  profile_id uuid,
  user_id uuid,
  referral_code text,
  payout_method public.payout_method_type,
  payout_details text,
  payout_verified boolean,
  payout_updated_at timestamptz,
  total_referrals bigint,
  converted_referrals bigint,
  referral_clicks bigint,
  conversion_count bigint,
  total_earned numeric,
  pending_earnings numeric,
  paid_out numeric,
  available_balance numeric
)
language sql
security invoker
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  p as (
    select ap.* from public.affiliate_profiles ap join me on ap.user_id = me.uid
  )
  select
    p.id,
    p.user_id,
    p.referral_code,
    p.payout_method,
    p.payout_details,
    p.payout_verified,
    p.payout_updated_at,
    coalesce((select count(*) from public.affiliate_clicks c where c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((select count(*) from public.affiliate_conversions c where c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((select count(*) from public.affiliate_clicks c where c.affiliate_user_id = p.user_id), 0)::bigint,
    coalesce((select count(*) from public.affiliate_conversions c where c.affiliate_user_id = p.user_id), 0)::bigint,
    round(coalesce((select sum(amount) from public.affiliate_earnings e where e.affiliate_user_id = p.user_id), 0), 2),
    round(coalesce((select sum(amount) from public.affiliate_earnings e where e.affiliate_user_id = p.user_id and e.status = 'pending'), 0), 2),
    round(coalesce((select sum(amount) from public.affiliate_earnings e where e.affiliate_user_id = p.user_id and e.status = 'paid'), 0), 2),
    round(
      greatest(
        coalesce((select sum(amount) from public.affiliate_earnings e where e.affiliate_user_id = p.user_id and e.status = 'available'), 0)
        -
        coalesce((select sum(amount + fee_amount) from public.withdrawal_requests w where w.user_id = p.user_id and w.status in ('pending','approved','paid')), 0),
        0
      ),
      2
    )
  from p;
$$;

revoke all on function public.ensure_affiliate_profile() from public;
revoke all on function public.save_payout_method(public.payout_method_type, text) from public;
revoke all on function public.submit_withdrawal_request(numeric) from public;
revoke all on function public.admin_update_withdrawal_status(uuid, public.withdrawal_status, text) from public;
revoke all on function public.get_affiliate_dashboard() from public;

grant execute on function public.ensure_affiliate_profile() to authenticated;
grant execute on function public.save_payout_method(public.payout_method_type, text) to authenticated;
grant execute on function public.submit_withdrawal_request(numeric) to authenticated;
grant execute on function public.admin_update_withdrawal_status(uuid, public.withdrawal_status, text) to authenticated;
grant execute on function public.get_affiliate_dashboard() to authenticated;