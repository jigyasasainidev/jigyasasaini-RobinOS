-- Fix security-definer view issue by enforcing invoker semantics
create or replace view public.affiliate_withdrawals
with (security_invoker=on)
as
select
  wr.id,
  wr.user_id,
  wr.requester_email,
  wr.amount,
  wr.fee_amount,
  wr.status,
  wr.payout_method,
  wr.payout_details,
  wr.admin_note,
  wr.created_at,
  wr.updated_at,
  wr.approved_at,
  wr.completed_at,
  wr.rejected_at
from public.withdrawal_requests wr;

-- has_role should not be security definer
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
revoke all on function public.has_role(uuid, public.app_role) from anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- Restrict security-definer function execution to server-side role only
revoke all on function public.record_referral_signup(text, uuid, uuid, text) from public;
revoke all on function public.record_referral_signup(text, uuid, uuid, text) from anon;
revoke all on function public.record_referral_signup(text, uuid, uuid, text) from authenticated;
grant execute on function public.record_referral_signup(text, uuid, uuid, text) to service_role;

revoke all on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) from public;
revoke all on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) from anon;
revoke all on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) from authenticated;
grant execute on function public.upsert_subscription_state(uuid, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, jsonb) to service_role;