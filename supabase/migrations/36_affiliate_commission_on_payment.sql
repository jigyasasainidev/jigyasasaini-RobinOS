-- ============================================================
-- MIGRATION 36 — Affiliate commission on payment
-- ============================================================
-- Adds increment_affiliate_balance() RPC for atomic balance updates.
-- Called by dodo-webhook after every successful payment for a referred user.
-- Commission rate is read live from platform_settings (admin-controlled).
-- ============================================================

-- ── Ensure affiliate_profiles has the needed columns ──────
alter table public.affiliate_profiles
  add column if not exists total_earned    numeric not null default 0,
  add column if not exists pending_balance numeric not null default 0,
  add column if not exists paid_balance    numeric not null default 0;

-- ── Atomic balance increment ───────────────────────────────
-- Called by webhook after commission is recorded.
-- Increments both total_earned and pending_balance atomically.

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
  update public.affiliate_profiles
     set total_earned    = coalesce(total_earned, 0)    + p_amount,
         pending_balance = coalesce(pending_balance, 0) + p_amount,
         updated_at      = now()
   where user_id = p_affiliate_user_id;
end;
$$;

grant execute on function public.increment_affiliate_balance(uuid, numeric)
  to service_role;

comment on function public.increment_affiliate_balance(uuid, numeric) is
  'Atomically increments affiliate total_earned and pending_balance. '
  'Called by dodo-webhook after every successful referred payment.';

-- ── Ensure affiliate_commissions has subscription_id as text ─
-- The existing table has subscription_id as uuid but Dodo returns
-- subscription IDs as text (sub_xxx). Add a text column for Dodo IDs.

alter table public.affiliate_commissions
  add column if not exists dodo_subscription_id text;

create index if not exists idx_affiliate_commissions_dodo_sub
  on public.affiliate_commissions (dodo_subscription_id)
  where dodo_subscription_id is not null;

-- ── RLS: service_role can write commissions ────────────────
drop policy if exists "Service role manages affiliate commissions" on public.affiliate_commissions;
create policy "Service role manages affiliate commissions"
  on public.affiliate_commissions for all to service_role
  using (true) with check (true);

drop policy if exists "Service role manages affiliate profiles" on public.affiliate_profiles;
create policy "Service role manages affiliate profiles"
  on public.affiliate_profiles for all to service_role
  using (true) with check (true);
