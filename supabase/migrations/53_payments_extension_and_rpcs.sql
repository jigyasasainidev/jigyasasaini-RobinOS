-- ============================================================
-- MIGRATION 53 — PAYMENTS EXTENSION + RPCs + TRIGGERS
-- ============================================================
-- Final migration of Milestone 1. Extends the existing payments
-- table to support provider-agnostic purchase records, adds
-- enum values for new statuses, adds the remaining RPCs and
-- triggers, and extends platform_settings + profiles with
-- minimal additive columns.
--
-- This migration is ADDITIVE ONLY. No existing tables, columns,
-- RLS policies, triggers, or RPCs are MODIFIED. Existing data
-- is 100% preserved.
--
-- What this adds:
--   1. 13 new columns on public.payments
--   2. 1 new column on public.affiliate_commissions
--   3. 2 new columns on public.platform_settings
--   4. 1 new column on public.profiles
--   5. 3 new values on payment_provider enum
--   6. 3 new values on payment_status enum
--   7. 15 new RPCs (6 implemented, 9 stubbed for later milestones)
--   8. 2 new triggers on public.payments
--
-- IMPORTANT NOTE ON ENUM ALTERATIONS:
--   PostgreSQL allows ALTER TYPE ... ADD VALUE inside a
--   transaction (since PG 12), but the new value CANNOT be
--   referenced in the same transaction. This migration does
--   NOT use the new enum values directly; future migrations
--   and runtime INSERTs can use them after this transaction
--   commits.
--
-- Reuses existing infrastructure:
--   - public.set_updated_at() (migration 01)
--   - public.get_admin_role() (migration 01)
--   - public.safe_plan_switch() (migration 31) — NOT MODIFIED
--   - public.reverse_commission() (migration 38) — NOT MODIFIED
--   - pgcrypto extension for SHA-256 hashing (migration 01)
-- ============================================================

begin;

-- ── 1. EXTEND payment_provider ENUM ─────────────────────────
-- Add 'warriorplus' value to the existing payment_provider enum.
-- This enables inserting payment records with provider='warriorplus'
-- in future migrations (M3+) and at runtime.
--
-- NOTE: Cannot reference 'warriorplus' in this same transaction.
-- Any INSERT with this value must happen in a later migration.

alter type public.payment_provider
  add value if not exists 'warriorplus';

-- ── 2. EXTEND payment_status ENUM ──────────────────────────
-- Add new statuses for partial refund, chargeback, and dispute.

alter type public.payment_status
  add value if not exists 'partially_refunded';

alter type public.payment_status
  add value if not exists 'charged_back';

alter type public.payment_status
  add value if not exists 'disputed';


-- ── 3. EXTEND payments TABLE ────────────────────────────────
-- Add 13 new columns to support provider-agnostic purchase
-- records. All columns are nullable so existing rows remain
-- valid without modification.

alter table public.payments
  add column if not exists provider_subscription_id   text,
  add column if not exists provider_order_id           text,
  add column if not exists provider_invoice_id         text,
  add column if not exists buyer_email                 text,
  add column if not exists buyer_email_hash            text,
  add column if not exists buyer_name                  text,
  add column if not exists buyer_country               text,
  add column if not exists plan_key                    text,
  add column if not exists source_webhook_event_id     uuid,
  add column if not exists affiliate_user_id           uuid
    references auth.users(id) on delete set null,
  add column if not exists referral_code               text,
  add column if not exists affiliate_commission_amount  numeric,
  add column if not exists affiliate_commission_status  text
    constraint payments_affiliate_commission_status_check
      check (affiliate_commission_status is null
             or affiliate_commission_status in ('pending','paid','reversed','skipped')),
  add column if not exists raw_provider_payload        jsonb;

comment on column public.payments.provider_subscription_id is
  'Provider-side subscription ID (for recurring products). Distinct from provider_payment_id which is one transaction.';
comment on column public.payments.provider_order_id is
  'Provider-side order ID (if provider distinguishes orders from payments).';
comment on column public.payments.provider_invoice_id is
  'Provider-side invoice ID (if provider issues invoices).';
comment on column public.payments.buyer_email is
  'Lowercased + trimmed email of the buyer. Populated from webhook before user_id is resolved.';
comment on column public.payments.buyer_email_hash is
  'SHA-256 hash of buyer_email. Used for PII-safe search and admin lookups.';
comment on column public.payments.buyer_name is
  'Buyer name from provider payload (may differ from RobinOS profile).';
comment on column public.payments.buyer_country is
  'ISO country code from provider (when provided).';
comment on column public.payments.plan_key is
  'Resolved RobinOS plan (free/creator/pro_creator/agency). Denormalized for fast queries.';
comment on column public.payments.source_webhook_event_id is
  'FK to webhook_events.id that created this purchase record. Set after M3+ webhook processing is enabled.';
comment on column public.payments.affiliate_user_id is
  'RobinOS user_id of the affiliate who referred this purchase (NULL if no affiliate or suppressed).';
comment on column public.payments.referral_code is
  'The affiliate referral code captured from the purchase URL (e.g. ABC123).';
comment on column public.payments.affiliate_commission_amount is
  'Commission amount earned by the affiliate on this purchase. NULL if no commission.';
comment on column public.payments.affiliate_commission_status is
  'Status of the commission: pending/paid/reversed/skipped. NULL if no commission.';
comment on column public.payments.raw_provider_payload is
  'Original provider payload preserved for audit. NEVER modified.';

-- ── 4. INDEXES on new payments columns ─────────────────────
create index if not exists idx_payments_buyer_hash
  on public.payments (buyer_email_hash)
  where buyer_email_hash is not null;

create index if not exists idx_payments_provider_event
  on public.payments (provider, provider_payment_id);

create index if not exists idx_payments_subscription
  on public.payments (user_subscription_id)
  where user_subscription_id is not null;

create index if not exists idx_payments_affiliate
  on public.payments (affiliate_user_id)
  where affiliate_user_id is not null;

create index if not exists idx_payments_status_date
  on public.payments (status, created_at desc);

create index if not exists idx_payments_plan_key
  on public.payments (plan_key)
  where plan_key is not null;


-- ── 5. EXTEND affiliate_commissions ────────────────────────
-- Add provider_payment_id so commissions can be linked back
-- to the specific provider transaction (for reversal lookup).

alter table public.affiliate_commissions
  add column if not exists provider_payment_id text;

create index if not exists idx_affiliate_commissions_provider_payment
  on public.affiliate_commissions (provider_payment_id)
  where provider_payment_id is not null;


-- ── 6. EXTEND platform_settings ────────────────────────────
alter table public.platform_settings
  add column if not exists payment_provider_default text default 'warriorplus';

alter table public.platform_settings
  add column if not exists payment_provider_require_email_verification boolean not null default true;

comment on column public.platform_settings.payment_provider_default is
  'Which payment provider is the default for new signups. Used by frontend when multiple providers are enabled.';
comment on column public.platform_settings.payment_provider_require_email_verification is
  'When true (default), new users created from a purchase must verify email via magic link before getting entitlement. When false, account is auto-created and entitlement granted immediately.';


-- ── 7. EXTEND profiles ────────────────────────────────────
alter table public.profiles
  add column if not exists primary_payment_provider text;

comment on column public.profiles.primary_payment_provider is
  'Tracks which payment provider the user originally came from. Used for support routing and analytics. NULL for users created before this column was added.';


-- ── 8. TRIGGER: auto-compute buyer_email_hash on INSERT ───
-- Trigger function: hashes buyer_email into buyer_email_hash
-- whenever a new payment row is inserted with buyer_email set.

create or replace function public.set_payments_buyer_hash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.buyer_email is not null and new.buyer_email_hash is null then
    new.buyer_email_hash := encode(
      digest(lower(trim(new.buyer_email)), 'sha256'),
      'hex'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payments_set_buyer_hash on public.payments;
create trigger trg_payments_set_buyer_hash
  before insert on public.payments
  for each row execute function public.set_payments_buyer_hash();


-- ── 9. TRIGGER: payments.updated_at ────────────────────────
-- Standard updated_at maintenance. Reuses existing set_updated_at().

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();


-- ────────────────────────────────────────────────────────────
-- SECTION B: NEW RPCs (15 total)
-- ────────────────────────────────────────────────────────────
--
-- Of the 15 RPCs created in this migration:
--   - 6 are FULLY IMPLEMENTED (pure data operations, safe now)
--   - 9 are STUBS that raise an exception with a TODO marker
--     pointing to the milestone that will implement them
--
-- The stubs have correct signatures and security so that later
-- migrations can replace their bodies via CREATE OR REPLACE
-- FUNCTION without re-touching the security model.
--
-- All RPCs use SECURITY DEFINER with search_path pinned to
-- public, following the established codebase convention.
-- ────────────────────────────────────────────────────────────

-- ============================================================
-- RPC 1 (IMPLEMENTED): enqueue_webhook_event
-- ============================================================
-- Idempotent insert into webhook_events. If the same
-- (provider_id, provider_event_id) already exists, returns
-- the existing row's id and is_duplicate=true.

create or replace function public.enqueue_webhook_event(
  p_provider_id             text,
  p_provider_event_id       text,
  p_provider_event_type     text,
  p_raw_payload             jsonb,
  p_raw_headers             jsonb default null,
  p_provider_transaction_id text default null,
  p_trace_id                uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id      uuid;
  v_payload_hash text;
begin
  -- Compute payload hash for audit/dedup verification
  v_payload_hash := encode(
    digest(p_raw_payload::text, 'sha256'),
    'hex'
  );

  -- Try to find existing event with same idempotency key
  select id into v_existing_id
    from public.webhook_events
   where provider_id = p_provider_id
     and provider_event_id = p_provider_event_id;

  if found then
    return jsonb_build_object(
      'id', v_existing_id,
      'is_duplicate', true,
      'status', (select status from public.webhook_events where id = v_existing_id)
    );
  end if;

  -- Insert new event
  insert into public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    payload_hash, raw_payload, raw_headers,
    provider_transaction_id, trace_id,
    status
  ) values (
    p_provider_id, p_provider_event_id, p_provider_event_type,
    v_payload_hash, p_raw_payload, p_raw_headers,
    p_provider_transaction_id, p_trace_id,
    'received'
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'id', v_new_id,
    'is_duplicate', false,
    'status', 'received'
  );
end;
$$;

grant execute on function public.enqueue_webhook_event(
  text, text, text, jsonb, jsonb, text, uuid
) to service_role;

comment on function public.enqueue_webhook_event is
  'Idempotently enqueue a webhook event. Returns existing row id if duplicate. Called by payment-webhook Edge Function (M3).';


-- ============================================================
-- RPC 2 (IMPLEMENTED): record_subscription_webhook_event
-- ============================================================
-- Idempotency check via the existing subscription_webhook_events
-- table (migration 31). Returns is_duplicate=true if seen.

create or replace function public.record_subscription_webhook_event(
  p_provider_event_id text,
  p_provider          text,
  p_event_type        text,
  p_payload_hash      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
begin
  select id into v_existing_id
    from public.subscription_webhook_events
   where provider = p_provider
     and provider_event_id = p_provider_event_id;

  if found then
    return jsonb_build_object(
      'is_duplicate', true,
      'recorded_at',  (select processed_at from public.subscription_webhook_events where id = v_existing_id)
    );
  end if;

  insert into public.subscription_webhook_events (
    provider_event_id, provider, event_type, payload_hash
  ) values (
    p_provider_event_id, p_provider, p_event_type, p_payload_hash
  );

  return jsonb_build_object(
    'is_duplicate', false,
    'recorded_at',  now()
  );
end;
$$;

grant execute on function public.record_subscription_webhook_event(
  text, text, text, text
) to service_role;

comment on function public.record_subscription_webhook_event is
  'Idempotency gate for webhook handlers. Reuses existing subscription_webhook_events table from migration 31. Used as a fast pre-check before enqueueing into webhook_events.';


-- ============================================================
-- RPC 3 (IMPLEMENTED): retry_webhook_event
-- ============================================================
-- Admin-triggered retry of a dead-letter or failed event.
-- Resets status to received, clears retry_count and next_retry_at.

create or replace function public.retry_webhook_event(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.webhook_events
   where id = p_webhook_event_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'webhook_event_not_found');
  end if;

  if v_status not in ('failed_terminal', 'failed_retryable', 'blocked', 'awaiting_admin') then
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_status_for_retry',
      'current_status', v_status
    );
  end if;

  update public.webhook_events
     set status = 'received',
         retry_count = 0,
         next_retry_at = null,
         last_error = null,
         last_error_at = null,
         updated_at = now()
   where id = p_webhook_event_id;

  return jsonb_build_object('success', true, 'webhook_event_id', p_webhook_event_id);
end;
$$;

grant execute on function public.retry_webhook_event(uuid) to service_role;

comment on function public.retry_webhook_event is
  'Manually retry a failed or dead-letter webhook event. Resets it for the worker to pick up. Admin-only (called from admin-payment-providers Edge Function).';


-- ============================================================
-- RPC 4 (IMPLEMENTED): mark_webhook_dead_letter
-- ============================================================
-- Marks a webhook event as terminally failed (dead letter).
-- Called by the worker when retry_count >= max_retries.

create or replace function public.mark_webhook_dead_letter(
  p_webhook_event_id uuid,
  p_reason           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.webhook_events
     set status = 'failed_terminal',
         last_error = p_reason,
         last_error_at = now(),
         error_history = error_history || jsonb_build_object(
           'error', p_reason,
           'timestamp', now()
         ),
         updated_at = now()
   where id = p_webhook_event_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'webhook_event_not_found');
  end if;

  return jsonb_build_object('success', true, 'webhook_event_id', p_webhook_event_id);
end;
$$;

grant execute on function public.mark_webhook_dead_letter(uuid, text) to service_role;

comment on function public.mark_webhook_dead_letter is
  'Move a webhook event to dead-letter state. Called by the worker when retries are exhausted.';


-- ============================================================
-- RPC 5 (IMPLEMENTED): search_webhook_events
-- ============================================================
-- Admin-facing search across webhook_events. Supports
-- filtering by provider, transaction, status, date range,
-- buyer email (hashed), and user_id.

create or replace function public.search_webhook_events(
  p_provider_id             text    default null,
  p_provider_transaction_id text    default null,
  p_provider_event_type     text    default null,
  p_status                  text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider_id           text,
  provider_event_id     text,
  provider_event_type   text,
  status                text,
  trace_id              uuid,
  received_at           timestamptz,
  processed_at          timestamptz,
  retry_count           integer,
  last_error            text,
  linked_user_id        uuid,
  linked_purchase_id    uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');
  end if;

  return query
    select
      we.id, we.provider_id, we.provider_event_id, we.provider_event_type,
      we.status, we.trace_id, we.received_at, we.processed_at,
      we.retry_count, we.last_error, we.linked_user_id, we.linked_purchase_id
    from public.webhook_events we
    where (p_provider_id             is null or we.provider_id             = p_provider_id)
      and (p_provider_transaction_id is null or we.provider_transaction_id = p_provider_transaction_id)
      and (p_provider_event_type     is null or we.provider_event_type     = p_provider_event_type)
      and (p_status                  is null or we.status                  = p_status)
      and (v_buyer_email_hash        is null or we.raw_payload->>'buyer_email_hash' = v_buyer_email_hash)
      and (p_user_id                 is null or we.linked_user_id          = p_user_id)
      and (p_date_from               is null or we.received_at             >= p_date_from)
      and (p_date_to                 is null or we.received_at             <= p_date_to)
    order by we.received_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_webhook_events(
  text, text, text, text, text, uuid, timestamptz, timestamptz, integer, integer
) to authenticated;

comment on function public.search_webhook_events is
  'Admin search across webhook_events. Used by admin diagnostics page (M11).';


-- ============================================================
-- RPC 6 (IMPLEMENTED): search_payments
-- ============================================================
-- Admin-facing search across the payments table. Supports
-- filtering by provider, transaction, buyer, user, plan,
-- status, and date range. Masks buyer email in output.

create or replace function public.search_payments(
  p_provider_id             text    default null,
  p_provider_payment_id     text    default null,
  p_buyer_email             text    default null,
  p_user_id                 uuid    default null,
  p_plan_key                text    default null,
  p_payment_status          text    default null,
  p_date_from               timestamptz default null,
  p_date_to                 timestamptz default null,
  p_limit                   integer default 100,
  p_offset                  integer default 0
)
returns table (
  id                    uuid,
  provider              text,
  provider_payment_id   text,
  plan_key              text,
  billing_cycle         text,
  amount                numeric,
  currency              text,
  status                text,
  refunded_amount       numeric,
  buyer_email_masked    text,
  user_id               uuid,
  user_subscription_id  uuid,
  purchased_at          timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_buyer_email_hash text;
begin
  if p_buyer_email is not null then
    v_buyer_email_hash := encode(digest(lower(trim(p_buyer_email)), 'sha256'), 'hex');
  end if;

  return query
    select
      p.id, p.provider::text, p.provider_payment_id, p.plan_key, p.billing_cycle,
      p.amount, p.currency, p.status::text, p.refunded_amount,
      case
        when p.buyer_email is null then null
        when length(p.buyer_email) <= 4 then '***'
        else substring(p.buyer_email from 1 for 1) || '***@' || split_part(p.buyer_email, '@', 2)
      end as buyer_email_masked,
      p.user_id, p.user_subscription_id, p.paid_at, p.refunded_at, p.created_at
    from public.payments p
    where (p_provider_id             is null or p.provider::text          = p_provider_id)
      and (p_provider_payment_id     is null or p.provider_payment_id      = p_provider_payment_id)
      and (v_buyer_email_hash        is null or p.buyer_email_hash         = v_buyer_email_hash)
      and (p_user_id                 is null or p.user_id                  = p_user_id)
      and (p_plan_key                is null or p.plan_key                 = p_plan_key)
      and (p_payment_status          is null or p.status::text             = p_payment_status)
      and (p_date_from               is null or p.created_at               >= p_date_from)
      and (p_date_to                 is null or p.created_at               <= p_date_to)
    order by p.created_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_payments(
  text, text, text, uuid, text, text, timestamptz, timestamptz, integer, integer
) to authenticated;

comment on function public.search_payments is
  'Admin search across payments. Buyer email is masked in output for PII protection. Used by admin purchase search page (M11).';


-- ============================================================
-- RPC 7 (STUB — M4): process_webhook_event
-- ============================================================
-- Orchestrator for a single webhook event. Locks the row,
-- runs the adapter pipeline, applies effects. STUB in M1.

create or replace function public.process_webhook_event(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'process_webhook_event: not yet implemented (scheduled for Milestone 4)';
end;
$$;

grant execute on function public.process_webhook_event(uuid) to service_role;

comment on function public.process_webhook_event is
  'STUB — full implementation scheduled for Milestone 4 (Webhook Event Queue + Worker). Will lock the row, dispatch to the adapter pipeline, and apply side effects.';


-- ============================================================
-- RPC 8 (STUB — M4): process_pending_webhook_events
-- ============================================================
-- Worker batch entry point. Selects pending events with
-- FOR UPDATE SKIP LOCKED and processes them. STUB in M1.

create or replace function public.process_pending_webhook_events(
  p_batch_size     integer default 50,
  p_max_runtime_ms integer default 25000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'process_pending_webhook_events: not yet implemented (scheduled for Milestone 4)';
end;
$$;

grant execute on function public.process_pending_webhook_events(integer, integer) to service_role;

comment on function public.process_pending_webhook_events is
  'STUB — full implementation scheduled for Milestone 4 (Webhook Event Queue + Worker). Will be cron-invoked.';


-- ============================================================
-- RPC 9 (STUB — M6): record_purchase_from_webhook
-- ============================================================
-- Records a purchase row from a webhook event. STUB in M1.

create or replace function public.record_purchase_from_webhook(
  p_webhook_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'record_purchase_from_webhook: not yet implemented (scheduled for Milestone 6)';
end;
$$;

grant execute on function public.record_purchase_from_webhook(uuid) to service_role;

comment on function public.record_purchase_from_webhook is
  'STUB — full implementation scheduled for Milestone 6 (Entitlement Grant). Will insert/update the payments row from webhook event data.';


-- ============================================================
-- RPC 10 (STUB — M6): grant_entitlement_from_purchase
-- ============================================================
-- Grants the RobinOS plan entitlement based on a purchase.
-- Reads provider_products.duration_value + duration_unit
-- to compute expires_at. STUB in M1.

create or replace function public.grant_entitlement_from_purchase(
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'grant_entitlement_from_purchase: not yet implemented (scheduled for Milestone 6)';
end;
$$;

grant execute on function public.grant_entitlement_from_purchase(uuid) to service_role;

comment on function public.grant_entitlement_from_purchase is
  'STUB — full implementation scheduled for Milestone 6 (Entitlement Grant). Will read provider_products.duration_value + duration_unit, compute expires_at, call safe_plan_switch, and override the expires_at.';


-- ============================================================
-- RPC 11 (STUB — M7): revoke_entitlement_from_purchase
-- ============================================================
-- Revokes entitlement on refund/chargeback. STUB in M1.

create or replace function public.revoke_entitlement_from_purchase(
  p_purchase_id uuid,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'revoke_entitlement_from_purchase: not yet implemented (scheduled for Milestone 7)';
end;
$$;

grant execute on function public.revoke_entitlement_from_purchase(uuid, text) to service_role;

comment on function public.revoke_entitlement_from_purchase is
  'STUB — full implementation scheduled for Milestone 7 (Refund Handling). Will branch on billing_cycle for one_time vs subscription.';


-- ============================================================
-- RPC 12 (STUB — M5): recalculate_user_effective_plan
-- ============================================================
-- Re-derives a user's effective plan from subscriptions +
-- grants. Used after entitlement changes. STUB in M1.

create or replace function public.recalculate_user_effective_plan(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'recalculate_user_effective_plan: not yet implemented (scheduled for Milestone 5)';
end;
$$;

grant execute on function public.recalculate_user_effective_plan(uuid) to service_role;

comment on function public.recalculate_user_effective_plan is
  'STUB — full implementation scheduled for Milestone 5 (User Resolution). Will call existing resolve_user_plan and return the result.';


-- ============================================================
-- RPC 13 (STUB — M5): resolve_or_create_user_from_purchase
-- ============================================================
-- Identity resolution for a purchase. Links to existing user
-- by email match, or creates a pending claim. STUB in M1.

create or replace function public.resolve_or_create_user_from_purchase(
  p_buyer_email         text,
  p_buyer_name          text,
  p_provider_id         text,
  p_provider_customer_id text default null,
  p_create_if_missing   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'resolve_or_create_user_from_purchase: not yet implemented (scheduled for Milestone 5)';
end;
$$;

grant execute on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) to service_role;

comment on function public.resolve_or_create_user_from_purchase is
  'STUB — full implementation scheduled for Milestone 5 (User Resolution). Will match buyer email against auth.users and either link or create a pending claim.';


-- ============================================================
-- RPC 14 (STUB — M9): send_purchase_claim_email
-- ============================================================
-- Sends magic-link email to buyer for claim verification. STUB in M1.

create or replace function public.send_purchase_claim_email(
  p_purchase_id  uuid,
  p_buyer_email  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'send_purchase_claim_email: not yet implemented (scheduled for Milestone 9)';
end;
$$;

grant execute on function public.send_purchase_claim_email(uuid, text) to service_role;

comment on function public.send_purchase_claim_email is
  'STUB — full implementation scheduled for Milestone 9 (Guest User Creation). Will integrate with email service to send magic-link.';


-- ============================================================
-- RPC 15 (STUB — M9): complete_purchase_claim
-- ============================================================
-- Completes the claim workflow: verifies magic link, creates
-- auth.users + profiles, links purchase. STUB in M1.

create or replace function public.complete_purchase_claim(
  p_claim_token   uuid,
  p_account_data  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'complete_purchase_claim: not yet implemented (scheduled for Milestone 9)';
end;
$$;

grant execute on function public.complete_purchase_claim(uuid, jsonb) to service_role;

comment on function public.complete_purchase_claim is
  'STUB — full implementation scheduled for Milestone 9 (Guest User Creation). Will verify magic link, create account, link purchase.';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 53
-- ============================================================
-- Execute this ONLY if Milestone 1 needs to be reverted before
-- Milestone 2 begins. Reverts all schema changes and drops all
-- new RPCs.
--
-- IMPORTANT LIMITATIONS:
--   - PostgreSQL does not allow DROP VALUE on enum types.
--     The 'warriorplus' value on payment_provider and
--     'partially_refunded', 'charged_back', 'disputed' on
--     payment_status CANNOT be removed. They will remain as
--     unused values if rollback is needed. This is harmless
--     to existing functionality.
--   - If any data was created using the new enum values
--     before rollback, those rows will need to be migrated
--     before the column can be dropped.
--
-- Data loss warning:
--   - Drops all 15 new RPCs
--   - Drops 2 new triggers on public.payments
--   - Drops 13 new columns on public.payments (NULL values only,
--     no data loss for existing rows)
--   - Drops 1 new column on public.affiliate_commissions
--   - Drops 2 new columns on public.platform_settings
--   - Drops 1 new column on public.profiles

/*
begin;

-- Drop new RPCs
drop function if exists public.enqueue_webhook_event(text, text, text, jsonb, jsonb, text, uuid);
drop function if exists public.record_subscription_webhook_event(text, text, text, text);
drop function if exists public.retry_webhook_event(uuid);
drop function if exists public.mark_webhook_dead_letter(uuid, text);
drop function if exists public.search_webhook_events(text, text, text, text, text, uuid, timestamptz, timestamptz, integer, integer);
drop function if exists public.search_payments(text, text, text, uuid, text, text, timestamptz, timestamptz, integer, integer);
drop function if exists public.process_webhook_event(uuid);
drop function if exists public.process_pending_webhook_events(integer, integer);
drop function if exists public.record_purchase_from_webhook(uuid);
drop function if exists public.grant_entitlement_from_purchase(uuid);
drop function if exists public.revoke_entitlement_from_purchase(uuid, text);
drop function if exists public.recalculate_user_effective_plan(uuid);
drop function if exists public.resolve_or_create_user_from_purchase(text, text, text, text, boolean);
drop function if exists public.send_purchase_claim_email(uuid, text);
drop function if exists public.complete_purchase_claim(uuid, jsonb);

-- Drop trigger function (no other code uses it)
drop function if exists public.set_payments_buyer_hash();

-- Drop triggers on payments
drop trigger if exists trg_payments_set_buyer_hash on public.payments;
drop trigger if exists trg_payments_updated_at on public.payments;

-- Drop new columns on payments (additive, NULL values)
alter table public.payments
  drop column if exists provider_subscription_id,
  drop column if exists provider_order_id,
  drop column if exists provider_invoice_id,
  drop column if exists buyer_email,
  drop column if exists buyer_email_hash,
  drop column if exists buyer_name,
  drop column if exists buyer_country,
  drop column if exists plan_key,
  drop column if exists source_webhook_event_id,
  drop column if exists affiliate_user_id,
  drop column if exists referral_code,
  drop column if exists affiliate_commission_amount,
  drop column if exists affiliate_commission_status,
  drop column if exists raw_provider_payload;

-- Drop new index on affiliate_commissions (column drop cascades index)
-- The column drop on affiliate_commissions also drops its index
alter table public.affiliate_commissions
  drop column if exists provider_payment_id;

-- Drop new columns on platform_settings
alter table public.platform_settings
  drop column if exists payment_provider_default,
  drop column if exists payment_provider_require_email_verification;

-- Drop new column on profiles
alter table public.profiles
  drop column if exists primary_payment_provider;

-- Enum values: CANNOT BE DROPPED (PostgreSQL limitation)
-- They remain as unused values: 'warriorplus' on payment_provider,
-- 'partially_refunded', 'charged_back', 'disputed' on payment_status.

commit;
*/
