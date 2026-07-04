-- ============================================================
-- MIGRATION 52 — PROVIDER PRODUCT MAPPING + WEBHOOK EVENT LOG
-- ============================================================
-- Continues the generic payment provider abstraction started in
-- migration 51. Adds the tables required for:
--   1. Provider → RobinOS plan mapping (admin-configurable)
--   2. Universal webhook event log (preserved forever)
--
-- This migration is ADDITIVE ONLY. No existing tables, columns,
-- enums, RLS policies, triggers, or RPCs are modified.
--
-- What this adds:
--   1. provider_products    — Maps any provider's product ID to
--                              a RobinOS plan, with configurable
--                              duration (the "6-month rule").
--   2. webhook_events       — Universal webhook log per provider.
--                              Every webhook ever received is
--                              stored forever for audit/debug.
--   3. Indexes for both
--   4. RLS policies for both
--   5. updated_at triggers for both
--
-- CRITICAL: provider_products.duration_value + duration_unit
-- are the SOLE source of truth for the 6-month RobinOS Pro Plan
-- access duration. The 6-month value is NEVER hardcoded in any
-- Edge Function or RPC. Admin can change duration via UI and
-- the next purchase uses the new value immediately.
--
-- Reuses existing infrastructure:
--   - public.set_updated_at() (from migration 01)
--   - public.get_admin_role() (from migration 01)
-- ============================================================

begin;

-- ── 1. provider_products TABLE ─────────────────────────────
-- Admin-configurable mapping from any provider's product ID
-- to a RobinOS plan. Includes configurable duration so the
-- 6-month rule lives as data, not code.

create table if not exists public.provider_products (
  id                        uuid        primary key default gen_random_uuid(),
  provider_id               text        not null references public.payment_providers(id) on delete cascade,

  -- Provider's product identification
  provider_product_id       text        not null,
  provider_offer_id         text,

  -- RobinOS plan mapping
  plan_key                  text        not null
    constraint provider_products_plan_key_check
      check (plan_key in ('free', 'creator', 'pro_creator', 'agency')),
  billing_cycle             text        not null
    constraint provider_products_billing_cycle_check
      check (billing_cycle in ('monthly', 'yearly', 'one_time')),

  -- Configurable duration — the ENTIRE mechanism for the
  -- "6-month RobinOS Pro Plan" business rule. Never hardcoded.
  duration_value            numeric     not null
    constraint provider_products_duration_value_positive
      check (duration_value > 0),
  duration_unit             text        not null
    constraint provider_products_duration_unit_check
      check (duration_unit in ('day', 'week', 'month', 'year')),

  -- Pricing
  amount                    numeric     not null
    constraint provider_products_amount_nonneg
      check (amount >= 0),
  currency                  text        not null default 'USD',

  -- Type
  is_subscription           boolean     not null default false,
  is_enabled                boolean     not null default true,

  -- Display
  display_name              text,
  description               text,
  metadata                  jsonb       not null default '{}'::jsonb,

  -- Audit
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid        references auth.users(id) on delete set null,
  updated_by                uuid        references auth.users(id) on delete set null,

  -- Unique per provider product+offer combination.
  -- NULL offer_id is normalized to '' via partial unique index below.
  constraint provider_products_unique_mapping
    unique (provider_id, provider_product_id, provider_offer_id)
);

-- Partial unique index to handle NULL provider_offer_id correctly
-- (SQL UNIQUE treats NULLs as distinct, so we use a COALESCE)
create unique index if not exists idx_provider_products_unique
  on public.provider_products (provider_id, provider_product_id, coalesce(provider_offer_id, ''));

comment on table public.provider_products is
  'Admin-configurable mapping from any provider product to a RobinOS plan with configurable duration. The 6-month rule lives here as data.';

comment on column public.provider_products.provider_id is
  'FK to payment_providers.id. Identifies which provider this mapping applies to.';
comment on column public.provider_products.provider_product_id is
  'The product ID from the provider (e.g. WarriorPlus item_id).';
comment on column public.provider_products.provider_offer_id is
  'Optional: provider-specific variant/offer ID. NULL if provider has no variant concept.';
comment on column public.provider_products.plan_key is
  'RobinOS plan this product grants (free/creator/pro_creator/agency).';
comment on column public.provider_products.billing_cycle is
  'Billing cycle (monthly/yearly/one_time). one_time = no recurring billing.';
comment on column public.provider_products.duration_value is
  'Numeric duration quantity. Combined with duration_unit to compute expires_at. Example: 6 (months).';
comment on column public.provider_products.duration_unit is
  'Duration unit (day/week/month/year). Combined with duration_value. Example: month.';
comment on column public.provider_products.amount is
  'Price in major units (e.g. 39.00 = $39.00). Currency in amount_currency.';
comment on column public.provider_products.is_subscription is
  'True if this product has recurring billing. False for one-time purchases.';
comment on column public.provider_products.is_enabled is
  'When false, new webhooks for this product are marked blocked. Existing purchases unaffected.';

-- ── 2. INDEXES on provider_products ───────────────────────
create index if not exists idx_provider_products_enabled
  on public.provider_products (provider_id, provider_product_id)
  where is_enabled = true;

create index if not exists idx_provider_products_plan
  on public.provider_products (plan_key);

-- ── 3. RLS on provider_products ───────────────────────────
alter table public.provider_products enable row level security;

drop policy if exists "Admins manage provider_products" on public.provider_products;
create policy "Admins manage provider_products"
  on public.provider_products for all
  to authenticated
  using (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'));

drop policy if exists "Service role reads provider_products" on public.provider_products;
create policy "Service role reads provider_products"
  on public.provider_products for select
  to service_role
  using (true);

-- ── 4. updated_at TRIGGER for provider_products ───────────
drop trigger if exists trg_provider_products_updated_at on public.provider_products;
create trigger trg_provider_products_updated_at
  before update on public.provider_products
  for each row execute function public.set_updated_at();


-- ── 5. webhook_events TABLE ────────────────────────────────
-- Universal webhook log. EVERY webhook from EVERY provider is
-- stored here and NEVER deleted. This is the audit/debug log.
-- Idempotency is enforced via the unique constraint on
-- (provider_id, provider_event_id).

create table if not exists public.webhook_events (
  id                              uuid        primary key default gen_random_uuid(),

  -- Provider identification
  provider_id                     text        not null references public.payment_providers(id) on delete cascade,

  -- Provider's identification of this event
  provider_event_id               text        not null,
  provider_transaction_id         text,
  provider_event_type             text        not null,

  -- Standardized event (after adapter mapping)
  standardized_event_type         text,
  event_mapping_confidence        text,

  -- Idempotency and payload
  payload_hash                    text        not null,

  -- Raw payload (preserved forever for audit/debugging)
  raw_payload                     jsonb       not null,
  raw_headers                     jsonb,

  -- Processing status
  status                          text        not null default 'received'
    constraint webhook_events_status_check
      check (status in (
        'received', 'validating', 'verified', 'processing',
        'processed', 'duplicate', 'failed_retryable',
        'failed_terminal', 'blocked', 'awaiting_claim',
        'awaiting_admin'
      )),
  retry_count                     integer     not null default 0,
  max_retries                     integer     not null default 5,
  next_retry_at                   timestamptz,

  -- Async worker locking
  locked_by                       text,
  locked_at                       timestamptz,

  -- Error tracking
  last_error                      text,
  last_error_at                   timestamptz,
  error_history                   jsonb       not null default '[]'::jsonb,

  -- Resolution linkage
  linked_purchase_id              uuid,
  linked_user_id                  uuid        references auth.users(id) on delete set null,

  -- Distributed tracing
  trace_id                        uuid        not null,

  -- Timestamps
  received_at                     timestamptz not null default now(),
  verified_at                     timestamptz,
  processing_started_at           timestamptz,
  processed_at                    timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  -- Idempotency
  constraint webhook_events_unique_event unique (provider_id, provider_event_id)
);

comment on table public.webhook_events is
  'Universal webhook event log. Stores every webhook from every provider. NEVER deleted. Provides admin search and replay capability.';

comment on column public.webhook_events.provider_event_id is
  'The provider''s unique identifier for this event (used for idempotency).';
comment on column public.webhook_events.provider_transaction_id is
  'The associated provider transaction/sale ID, if any. Used to correlate with purchases.';
comment on column public.webhook_events.provider_event_type is
  'The raw event type string from the provider (e.g. SALE, charge.succeeded).';
comment on column public.webhook_events.standardized_event_type is
  'Provider-agnostic event type after adapter mapping (e.g. purchase.created). NULL if unmapped.';
comment on column public.webhook_events.event_mapping_confidence is
  'How confident the adapter is in the mapping: exact / inferred / unknown.';
comment on column public.webhook_events.payload_hash is
  'SHA-256 of the raw body. Used for duplicate detection.';
comment on column public.webhook_events.raw_payload is
  'The original webhook payload from the provider. NEVER modified, NEVER deleted.';
comment on column public.webhook_events.raw_headers is
  'HTTP headers at the time of webhook receipt. Used for debugging signature issues.';
comment on column public.webhook_events.status is
  'Current processing state. See constraint for allowed values.';
comment on column public.webhook_events.retry_count is
  'Number of processing attempts. Incremented on each failure.';
comment on column public.webhook_events.next_retry_at is
  'When to attempt the next retry. Set by worker on transient failure.';
comment on column public.webhook_events.locked_by is
  'Worker ID currently holding this row for processing. NULL when unlocked.';
comment on column public.webhook_events.error_history is
  'Array of error objects with timestamps. Append-only.';
comment on column public.webhook_events.linked_purchase_id is
  'FK to payments.id when this event has been linked to a purchase row.';
comment on column public.webhook_events.linked_user_id is
  'RobinOS user_id involved in this event (set after identity resolution).';
comment on column public.webhook_events.trace_id is
  'UUID v7 for distributed tracing. Propagated to all logs and audit entries.';

-- ── 6. INDEXES on webhook_events ───────────────────────────
-- Hot-path index for the worker's queue scan
create index if not exists idx_webhook_events_queue
  on public.webhook_events (received_at)
  where status in ('received', 'verified', 'failed_retryable');

-- Search by provider transaction
create index if not exists idx_webhook_events_provider_txn
  on public.webhook_events (provider_id, provider_transaction_id)
  where provider_transaction_id is not null;

-- Admin search by user
create index if not exists idx_webhook_events_user
  on public.webhook_events (linked_user_id, received_at desc)
  where linked_user_id is not null;

-- Retry queue scan
create index if not exists idx_webhook_events_retry
  on public.webhook_events (next_retry_at)
  where status = 'failed_retryable';

-- Tracing
create index if not exists idx_webhook_events_trace
  on public.webhook_events (trace_id);

-- Status filter (for monitoring dashboards)
create index if not exists idx_webhook_events_status_received
  on public.webhook_events (status, received_at desc);

-- ── 7. RLS on webhook_events ───────────────────────────────
-- Admin SELECT for diagnostics. No client access. Service role
-- manages all writes via Edge Functions.

alter table public.webhook_events enable row level security;

drop policy if exists "Admins read webhook_events" on public.webhook_events;
create policy "Admins read webhook_events"
  on public.webhook_events for select
  to authenticated
  using (public.get_admin_role(auth.uid()) is not null);

drop policy if exists "Service role manages webhook_events" on public.webhook_events;
create policy "Service role manages webhook_events"
  on public.webhook_events for all
  to service_role
  using (true) with check (true);

-- Explicit deny for anon
drop policy if exists "webhook_events_deny_anon" on public.webhook_events;
create policy "webhook_events_deny_anon"
  on public.webhook_events for all
  to anon
  using (false)
  with check (false);

-- ── 8. updated_at TRIGGER for webhook_events ───────────────
drop trigger if exists trg_webhook_events_updated_at on public.webhook_events;
create trigger trg_webhook_events_updated_at
  before update on public.webhook_events
  for each row execute function public.set_updated_at();

commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 52
-- ============================================================
-- Execute this ONLY if Milestone 1 needs to be reverted before
-- Milestone 2 begins. Drops the new tables and triggers.
--
-- Data loss warning: drops provider_products and webhook_events
-- entirely. If any webhook events were received during Milestone 1
-- testing, they will be lost. Backup before running.

/*
begin;

drop trigger if exists trg_provider_products_updated_at on public.provider_products;
drop trigger if exists trg_webhook_events_updated_at on public.webhook_events;
drop table if exists public.webhook_events cascade;
drop table if exists public.provider_products cascade;

commit;
*/
