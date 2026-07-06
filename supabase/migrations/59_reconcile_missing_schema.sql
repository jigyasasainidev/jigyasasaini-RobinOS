-- ============================================================
-- MIGRATION 59 — RECONCILE MISSING SCHEMA (IDEMPOTENT)
-- ============================================================
-- Reconciles every schema object introduced or modified in
-- migrations 45-58, plus any earlier tables/objects those
-- layers depend on.
--
-- For every object, the statement is gated so it is a no-op
-- when the object already exists. No data is dropped, renamed,
-- or rewritten. Functions and RPCs are intentionally NOT
-- reconciled here (see migration 60 for those).
--
-- Object categories covered (in order):
--   1.  Enum value additions           (payment_provider, payment_status)
--   2.  Tables                         (CREATE TABLE IF NOT EXISTS)
--   3.  Columns                        (DO blocks with information_schema.columns)
--   4.  Indexes                        (CREATE INDEX IF NOT EXISTS)
--   5.  Triggers                       (DROP TRIGGER IF EXISTS / CREATE TRIGGER)
--   6.  RLS enablement                 (ALTER TABLE ... ENABLE ROW LEVEL SECURITY)
--   7.  RLS policies                   (DROP POLICY IF EXISTS / CREATE POLICY)
--   8.  Seed data                      (INSERT ... ON CONFLICT DO NOTHING)
--   9.  Missing unique constraints     (catalog-checked)
--   10. Storage buckets + policies     (idempotent)
--
-- Every statement is idempotent. Safe to run on a database
-- that already has the schema in place.
-- ============================================================

-- ============================================================
-- SECTION 1 — ENUM VALUE ADDITIONS
-- ============================================================
-- PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE IF NOT EXISTS.
-- New values added in M53. Enum values cannot be removed, so
-- these are pure additions.

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'payment_provider'
       and e.enumlabel = 'warriorplus'
  ) then
    alter type public.payment_provider add value 'warriorplus';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'payment_status'
       and e.enumlabel = 'partially_refunded'
  ) then
    alter type public.payment_status add value 'partially_refunded';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'payment_status'
       and e.enumlabel = 'charged_back'
  ) then
    alter type public.payment_status add value 'charged_back';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'payment_status'
       and e.enumlabel = 'disputed'
  ) then
    alter type public.payment_status add value 'disputed';
  end if;
end $$;


-- ============================================================
-- SECTION 2 — TABLES (CREATE TABLE IF NOT EXISTS)
-- ============================================================
-- Tables introduced in M45-58 that may be missing. All use
-- CREATE TABLE IF NOT EXISTS so this is a no-op when present.

-- M47: Creator Resource Vault
create table if not exists public.resources (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  description     text,
  category        text not null,
  pdf_url         text not null,
  cover_image_url text,
  featured        boolean not null default false,
  download_count  integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- M51: Payment Provider Registry
create table if not exists public.payment_providers (
  id                                text        primary key,
  display_name                      text        not null,
  adapter_version                   text        not null default '1.0.0',
  is_enabled                        boolean     not null default false,
  config                            jsonb       not null default '{}'::jsonb,
  allowed_ip_ranges                 cidr[],
  require_signature_verification    boolean     not null default true,
  is_test_mode                      boolean     not null default false,
  webhook_url                       text,
  notes                             text,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  created_by                        uuid        references auth.users(id) on delete set null,
  updated_by                        uuid        references auth.users(id) on delete set null
);

-- M51: Payment Provider Secrets
create table if not exists public.payment_provider_secrets (
  id                        uuid        primary key default gen_random_uuid(),
  provider_id               text        not null references public.payment_providers(id) on delete cascade,
  secret_name               text        not null,
  secret_value_encrypted    text        not null,
  description               text,
  is_active                 boolean     not null default true,
  rotated_at                timestamptz,
  expires_at                timestamptz,
  created_at                timestamptz not null default now(),
  created_by                uuid        references auth.users(id) on delete set null
);

-- M52: Provider Products Mapping
create table if not exists public.provider_products (
  id                        uuid        primary key default gen_random_uuid(),
  provider_id               text        not null references public.payment_providers(id) on delete cascade,
  provider_product_id       text        not null,
  provider_offer_id         text,
  plan_key                  text        not null,
  billing_cycle             text        not null,
  duration_value            numeric     not null,
  duration_unit             text        not null,
  amount                    numeric     not null,
  currency                  text        not null default 'USD',
  is_subscription           boolean     not null default false,
  is_enabled                boolean     not null default true,
  display_name              text,
  description               text,
  metadata                  jsonb       not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid        references auth.users(id) on delete set null,
  updated_by                uuid        references auth.users(id) on delete set null
);

-- M52: Universal Webhook Event Log
create table if not exists public.webhook_events (
  id                              uuid        primary key default gen_random_uuid(),
  provider_id                     text        not null references public.payment_providers(id) on delete cascade,
  provider_event_id               text        not null,
  provider_transaction_id         text,
  provider_event_type             text        not null,
  standardized_event_type         text,
  event_mapping_confidence        text,
  payload_hash                    text        not null,
  raw_payload                     jsonb       not null,
  raw_headers                     jsonb,
  status                          text        not null default 'received',
  retry_count                     integer     not null default 0,
  max_retries                     integer     not null default 5,
  next_retry_at                   timestamptz,
  locked_by                       text,
  locked_at                       timestamptz,
  last_error                      text,
  last_error_at                   timestamptz,
  error_history                   jsonb       not null default '[]'::jsonb,
  linked_purchase_id              uuid,
  linked_user_id                  uuid        references auth.users(id) on delete set null,
  trace_id                        uuid        not null,
  received_at                     timestamptz not null default now(),
  verified_at                     timestamptz,
  processing_started_at           timestamptz,
  processed_at                    timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);


-- ============================================================
-- SECTION 3 — COLUMNS (catalog-checked ALTER TABLE ADD COLUMN)
-- ============================================================
-- For every column added after the initial table creation,
-- wrap in a DO block that checks information_schema.columns.
-- Each DO block is independent and idempotent.

-- ── 3a. platform_settings columns (M10, M23, M24, M25, M46, M48, M50, M53) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'commission_hold_days'
  ) then
    alter table public.platform_settings
      add column commission_hold_days integer not null default 14;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'creator_os_page_enabled'
  ) then
    alter table public.platform_settings
      add column creator_os_page_enabled boolean not null default true;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'creator_os_demo_video_url'
  ) then
    alter table public.platform_settings
      add column creator_os_demo_video_url text default null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'jvzoo_affiliate_enabled'
  ) then
    alter table public.platform_settings
      add column jvzoo_affiliate_enabled boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'jvzoo_affiliate_demo_video_url'
  ) then
    alter table public.platform_settings
      add column jvzoo_affiliate_demo_video_url text default null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'jvzoo_affiliate_cta_url'
  ) then
    alter table public.platform_settings
      add column jvzoo_affiliate_cta_url text default null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'jvzoo_affiliate_button_text'
  ) then
    alter table public.platform_settings
      add column jvzoo_affiliate_button_text text default 'Join Affiliate Program';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'jvzoo_affiliate_login_url'
  ) then
    alter table public.platform_settings
      add column jvzoo_affiliate_login_url text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'affiliate_resources_url'
  ) then
    alter table public.platform_settings
      add column affiliate_resources_url text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'resource_vault_enabled'
  ) then
    alter table public.platform_settings
      add column resource_vault_enabled boolean not null default true;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'warriorplus_page_enabled'
  ) then
    alter table public.platform_settings
      add column warriorplus_page_enabled boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'warriorplus_demo_video_url'
  ) then
    alter table public.platform_settings
      add column warriorplus_demo_video_url text default null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'payment_provider_default'
  ) then
    alter table public.platform_settings
      add column payment_provider_default text default 'warriorplus';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'platform_settings'
       and column_name = 'payment_provider_require_email_verification'
  ) then
    alter table public.platform_settings
      add column payment_provider_require_email_verification boolean not null default true;
  end if;
end $$;

-- ── 3b. profiles column (M53) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'primary_payment_provider'
  ) then
    alter table public.profiles
      add column primary_payment_provider text;
  end if;
end $$;

-- ── 3c. payments columns (M53) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'provider_subscription_id'
  ) then
    alter table public.payments
      add column provider_subscription_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'provider_order_id'
  ) then
    alter table public.payments
      add column provider_order_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'provider_invoice_id'
  ) then
    alter table public.payments
      add column provider_invoice_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'buyer_email'
  ) then
    alter table public.payments
      add column buyer_email text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'buyer_email_hash'
  ) then
    alter table public.payments
      add column buyer_email_hash text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'buyer_name'
  ) then
    alter table public.payments
      add column buyer_name text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'buyer_country'
  ) then
    alter table public.payments
      add column buyer_country text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'plan_key'
  ) then
    alter table public.payments
      add column plan_key text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'source_webhook_event_id'
  ) then
    alter table public.payments
      add column source_webhook_event_id uuid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'affiliate_user_id'
  ) then
    alter table public.payments
      add column affiliate_user_id uuid
      references auth.users(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'referral_code'
  ) then
    alter table public.payments
      add column referral_code text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'affiliate_commission_amount'
  ) then
    alter table public.payments
      add column affiliate_commission_amount numeric;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'affiliate_commission_status'
  ) then
    alter table public.payments
      add column affiliate_commission_status text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'raw_provider_payload'
  ) then
    alter table public.payments
      add column raw_provider_payload jsonb;
  end if;
end $$;

-- ── 3d. webhook_events columns (M57) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'webhook_events'
       and column_name = 'provider_customer_id'
  ) then
    alter table public.webhook_events
      add column provider_customer_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'webhook_events'
       and column_name = 'resolution_attempted_at'
  ) then
    alter table public.webhook_events
      add column resolution_attempted_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'webhook_events'
       and column_name = 'resolution_outcome'
  ) then
    alter table public.webhook_events
      add column resolution_outcome text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'webhook_events'
       and column_name = 'resolution_buyer_email_hash'
  ) then
    alter table public.webhook_events
      add column resolution_buyer_email_hash text;
  end if;
end $$;

-- ── 3e. user_subscriptions columns (M15, M17, M30) ──
-- These columns support the subscription lifecycle engine.
-- All nullable except where a NOT NULL default is needed.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'subscription_source'
  ) then
    alter table public.user_subscriptions
      add column subscription_source text not null default 'manual_admin';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'is_revenue_eligible'
  ) then
    alter table public.user_subscriptions
      add column is_revenue_eligible boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'starts_at'
  ) then
    alter table public.user_subscriptions
      add column starts_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'expires_at'
  ) then
    alter table public.user_subscriptions
      add column expires_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'last_plan_change_at'
  ) then
    alter table public.user_subscriptions
      add column last_plan_change_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'cooldown_until'
  ) then
    alter table public.user_subscriptions
      add column cooldown_until timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'granted_by_admin'
  ) then
    alter table public.user_subscriptions
      add column granted_by_admin boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_subscriptions'
       and column_name = 'granted_reason'
  ) then
    alter table public.user_subscriptions
      add column granted_reason text;
  end if;
end $$;

-- ── 3f. affiliate_profiles columns (M36, M38) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_profiles'
       and column_name = 'total_earned'
  ) then
    alter table public.affiliate_profiles
      add column total_earned numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_profiles'
       and column_name = 'pending_balance'
  ) then
    alter table public.affiliate_profiles
      add column pending_balance numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_profiles'
       and column_name = 'paid_balance'
  ) then
    alter table public.affiliate_profiles
      add column paid_balance numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_profiles'
       and column_name = 'locked_balance'
  ) then
    alter table public.affiliate_profiles
      add column locked_balance numeric not null default 0;
  end if;
end $$;

-- ── 3g. affiliate_commissions columns (M10, M36, M38, M53) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'approved_at'
  ) then
    alter table public.affiliate_commissions
      add column approved_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'payable_at'
  ) then
    alter table public.affiliate_commissions
      add column payable_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'paid_at'
  ) then
    alter table public.affiliate_commissions
      add column paid_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'reversed_at'
  ) then
    alter table public.affiliate_commissions
      add column reversed_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'payout_batch_id'
  ) then
    alter table public.affiliate_commissions
      add column payout_batch_id uuid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'requires_manual_recovery'
  ) then
    alter table public.affiliate_commissions
      add column requires_manual_recovery boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'status'
  ) then
    alter table public.affiliate_commissions
      add column status text not null default 'pending';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'eligible_at'
  ) then
    alter table public.affiliate_commissions
      add column eligible_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'reversal_reason'
  ) then
    alter table public.affiliate_commissions
      add column reversal_reason text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'dodo_subscription_id'
  ) then
    alter table public.affiliate_commissions
      add column dodo_subscription_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_commissions'
       and column_name = 'provider_payment_id'
  ) then
    alter table public.affiliate_commissions
      add column provider_payment_id text;
  end if;
end $$;

-- ── 3h. affiliate_conversions columns (M39) ──

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'plan_code'
  ) then
    alter table public.affiliate_conversions
      add column plan_code text not null default 'signup';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'billed_amount'
  ) then
    alter table public.affiliate_conversions
      add column billed_amount numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'commission_rate'
  ) then
    alter table public.affiliate_conversions
      add column commission_rate numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'commission_amount'
  ) then
    alter table public.affiliate_conversions
      add column commission_amount numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'referral_code'
  ) then
    alter table public.affiliate_conversions
      add column referral_code text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliate_conversions'
       and column_name = 'status'
  ) then
    alter table public.affiliate_conversions
      add column status text not null default 'pending';
  end if;
end $$;


-- ============================================================
-- SECTION 4 — INDEXES (CREATE INDEX IF NOT EXISTS)
-- ============================================================
-- All indexes referenced by M47, M51, M52, M53, M57, and the
-- earlier affiliate/lifecycle migrations. CREATE INDEX IF NOT
-- EXISTS is idempotent on its own.

-- ── resources (M47) ──
create index if not exists idx_resources_slug         on public.resources(slug);
create index if not exists idx_resources_category     on public.resources(category);
create index if not exists idx_resources_featured     on public.resources(featured desc, created_at desc);
create index if not exists idx_resources_search       on public.resources
  using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));
create index if not exists idx_resources_created_at   on public.resources(created_at desc);

-- ── payment_providers (M51) ──
create index if not exists idx_payment_providers_enabled
  on public.payment_providers (id)
  where is_enabled = true;

-- ── payment_provider_secrets (M51) ──
create index if not exists idx_payment_provider_secrets_provider
  on public.payment_provider_secrets (provider_id);
create index if not exists idx_payment_provider_secrets_active
  on public.payment_provider_secrets (provider_id, is_active)
  where is_active = true;
create unique index if not exists idx_payment_provider_secrets_unique_active
  on public.payment_provider_secrets (provider_id, secret_name)
  where is_active = true;

-- ── provider_products (M52) ──
create index if not exists idx_provider_products_enabled
  on public.provider_products (provider_id, provider_product_id)
  where is_enabled = true;
create index if not exists idx_provider_products_plan
  on public.provider_products (plan_key);
create unique index if not exists idx_provider_products_unique
  on public.provider_products (provider_id, provider_product_id, coalesce(provider_offer_id, ''));

-- ── webhook_events (M52, M57) ──
create index if not exists idx_webhook_events_queue
  on public.webhook_events (received_at)
  where status in ('received', 'verified', 'failed_retryable');

create index if not exists idx_webhook_events_provider_txn
  on public.webhook_events (provider_id, provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists idx_webhook_events_user
  on public.webhook_events (linked_user_id, received_at desc)
  where linked_user_id is not null;

create index if not exists idx_webhook_events_retry
  on public.webhook_events (next_retry_at)
  where status = 'failed_retryable';

create index if not exists idx_webhook_events_trace
  on public.webhook_events (trace_id);

create index if not exists idx_webhook_events_status_received
  on public.webhook_events (status, received_at desc);

create index if not exists idx_webhook_events_resolution_outcome
  on public.webhook_events (resolution_outcome, resolution_attempted_at desc)
  where resolution_outcome is not null;

create index if not exists idx_webhook_events_resolution_email_hash
  on public.webhook_events (resolution_buyer_email_hash)
  where resolution_buyer_email_hash is not null;

-- ── payments (M53, M54) ──
-- M54 corrected idx_payments_subscription to use subscription_id.
-- Re-create here so it is correct regardless of prior state.
do $$
begin
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'payments'
       and indexname = 'idx_payments_subscription'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'payments'
       and column_name = 'user_subscription_id'
  ) then
    -- Index exists but references the wrong column. Drop + recreate.
    drop index public.idx_payments_subscription;
  end if;
end $$;

create index if not exists idx_payments_subscription
  on public.payments (subscription_id)
  where subscription_id is not null;

create index if not exists idx_payments_buyer_hash
  on public.payments (buyer_email_hash)
  where buyer_email_hash is not null;

create index if not exists idx_payments_provider_event
  on public.payments (provider, provider_payment_id);

create index if not exists idx_payments_affiliate
  on public.payments (affiliate_user_id)
  where affiliate_user_id is not null;

create index if not exists idx_payments_status_date
  on public.payments (status, created_at desc);

create index if not exists idx_payments_plan_key
  on public.payments (plan_key)
  where plan_key is not null;

-- ── affiliate_commissions (M10, M36, M38, M53) ──
create index if not exists idx_affiliate_commissions_dodo_sub
  on public.affiliate_commissions (dodo_subscription_id)
  where dodo_subscription_id is not null;

create index if not exists idx_affiliate_commissions_provider_payment
  on public.affiliate_commissions (provider_payment_id)
  where provider_payment_id is not null;

create index if not exists idx_affiliate_commissions_status
  on public.affiliate_commissions (status, eligible_at);

create index if not exists idx_affiliate_commissions_eligible
  on public.affiliate_commissions (eligible_at)
  where status = 'pending';

create index if not exists idx_affiliate_commissions_dodo_sub_status
  on public.affiliate_commissions (dodo_subscription_id, status)
  where dodo_subscription_id is not null;

-- ── affiliate_conversions (M39) ──
create index if not exists idx_affiliate_conversions_referral_code
  on public.affiliate_conversions (referral_code)
  where referral_code is not null;

-- ── user_subscriptions (M15, M17) ──
create index if not exists idx_user_subscriptions_revenue_eligible
  on public.user_subscriptions (is_revenue_eligible, status)
  where is_revenue_eligible = true;

create index if not exists idx_user_subscriptions_expires_at
  on public.user_subscriptions (expires_at)
  where expires_at is not null;

create index if not exists idx_user_subscriptions_status_active
  on public.user_subscriptions (status, expires_at)
  where lower(status) = 'active';


-- ============================================================
-- SECTION 5 — TRIGGERS (catalog-checked DROP / CREATE)
-- ============================================================
-- Triggers introduced in M47, M51, M52, M53. Each is dropped
-- (idempotent) before being recreated so its definition is
-- always aligned with the canonical version.
--
-- M53's trg_payments_updated_at is intentionally NOT recreated
-- here: M54 dropped it as a duplicate of M01's trigger. We
-- leave it absent to preserve M54's correction.
--
-- The M53 set_payments_buyer_hash trigger function is owned by
-- migration 60 (function body). Here we only ensure the trigger
-- exists if the function is present.

-- ── resources (M47) ──
drop trigger if exists trg_resources_updated_at on public.resources;
create trigger trg_resources_updated_at
  before update on public.resources
  for each row
  execute function public.set_resources_updated_at();

-- ── payment_providers (M51) ──
drop trigger if exists trg_payment_providers_updated_at on public.payment_providers;
create trigger trg_payment_providers_updated_at
  before update on public.payment_providers
  for each row execute function public.set_updated_at();

-- ── provider_products (M52) ──
drop trigger if exists trg_provider_products_updated_at on public.provider_products;
create trigger trg_provider_products_updated_at
  before update on public.provider_products
  for each row execute function public.set_updated_at();

-- ── webhook_events (M52) ──
drop trigger if exists trg_webhook_events_updated_at on public.webhook_events;
create trigger trg_webhook_events_updated_at
  before update on public.webhook_events
  for each row execute function public.set_updated_at();

-- ── payments (M53) ──
-- set_payments_buyer_hash trigger function is created in M60.
-- We only attach the trigger when the function exists.
do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_payments_buyer_hash'
  ) then
    drop trigger if exists trg_payments_set_buyer_hash on public.payments;
    create trigger trg_payments_set_buyer_hash
      before insert on public.payments
      for each row execute function public.set_payments_buyer_hash();
  end if;
end $$;


-- ============================================================
-- SECTION 6 — RLS ENABLEMENT (idempotent)
-- ============================================================
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent in
-- PostgreSQL — re-running it on an already-enabled table is a
-- no-op.

alter table public.resources                enable row level security;
alter table public.payment_providers        enable row level security;
alter table public.payment_provider_secrets enable row level security;
alter table public.provider_products        enable row level security;
alter table public.webhook_events           enable row level security;


-- ============================================================
-- SECTION 7 — RLS POLICIES (DROP IF EXISTS / CREATE)
-- ============================================================
-- Every policy from M47, M51, M52, M53 is recreated with the
-- same name/body as in the source migrations. DROP POLICY IF
-- EXISTS + CREATE POLICY is idempotent.
--
-- NB: policies on storage.objects (M47) use the storage schema,
-- not public. They are still included in section 9 below.

-- ── resources (M47) ──
drop policy if exists "Public can read resources"   on public.resources;
drop policy if exists "Admins can manage resources" on public.resources;
create policy "Public can read resources"
  on public.resources for select to public using (true);
create policy "Admins can manage resources"
  on public.resources for all to authenticated
  using      (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'));

-- ── payment_providers (M51) ──
drop policy if exists "Admins manage payment_providers"      on public.payment_providers;
drop policy if exists "Service role reads payment_providers"  on public.payment_providers;
create policy "Admins manage payment_providers"
  on public.payment_providers for all to authenticated
  using      (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'));
create policy "Service role reads payment_providers"
  on public.payment_providers for select to service_role using (true);

-- ── payment_provider_secrets (M51) ──
drop policy if exists "Service role manages payment_provider_secrets" on public.payment_provider_secrets;
drop policy if exists "payment_provider_secrets_deny_authenticated"   on public.payment_provider_secrets;
create policy "Service role manages payment_provider_secrets"
  on public.payment_provider_secrets for all to service_role
  using (true) with check (true);
create policy "payment_provider_secrets_deny_authenticated"
  on public.payment_provider_secrets for all to authenticated
  using (false) with check (false);

-- ── provider_products (M52) ──
drop policy if exists "Admins manage provider_products"     on public.provider_products;
drop policy if exists "Service role reads provider_products" on public.provider_products;
create policy "Admins manage provider_products"
  on public.provider_products for all to authenticated
  using      (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'));
create policy "Service role reads provider_products"
  on public.provider_products for select to service_role using (true);

-- ── webhook_events (M52) ──
drop policy if exists "Admins read webhook_events"        on public.webhook_events;
drop policy if exists "Service role manages webhook_events" on public.webhook_events;
drop policy if exists "webhook_events_deny_anon"          on public.webhook_events;
create policy "Admins read webhook_events"
  on public.webhook_events for select to authenticated
  using (public.get_admin_role(auth.uid()) is not null);
create policy "Service role manages webhook_events"
  on public.webhook_events for all to service_role
  using (true) with check (true);
create policy "webhook_events_deny_anon"
  on public.webhook_events for all to anon
  using (false) with check (false);


-- ============================================================
-- SECTION 8 — SEED DATA (INSERT ... ON CONFLICT DO NOTHING)
-- ============================================================
-- Seed rows that the system expects to be present. All use
-- ON CONFLICT to avoid duplicate-key errors.

-- M51: WarriorPlus provider registered (disabled by default).
insert into public.payment_providers
  (id, display_name, adapter_version, is_enabled, require_signature_verification)
values
  ('warriorplus', 'WarriorPlus', '1.0.0', false, true)
on conflict (id) do nothing;


-- ============================================================
-- SECTION 9 — UNIQUE CONSTRAINTS (catalog-checked)
-- ============================================================
-- Constraints that M51, M52, or M39 added on top of the basic
-- tables. Each is wrapped in a DO block that only adds the
-- constraint when it is absent.

-- M51: payment_provider_secrets — only one active secret per (provider, name).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'payment_provider_secrets'
       and c.conname = 'payment_provider_secrets_unique'
  ) then
    alter table public.payment_provider_secrets
      add constraint payment_provider_secrets_unique
      unique (provider_id, secret_name, is_active) deferrable initially deferred;
  end if;
end $$;

-- M52: provider_products — unique (provider_id, product, offer).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_unique_mapping'
  ) then
    alter table public.provider_products
      add constraint provider_products_unique_mapping
      unique (provider_id, provider_product_id, provider_offer_id);
  end if;
end $$;

-- M52: provider_products plan_key check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_plan_key_check'
  ) then
    alter table public.provider_products
      add constraint provider_products_plan_key_check
      check (plan_key in ('free', 'creator', 'pro_creator', 'agency'));
  end if;
end $$;

-- M52: provider_products billing_cycle check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_billing_cycle_check'
  ) then
    alter table public.provider_products
      add constraint provider_products_billing_cycle_check
      check (billing_cycle in ('monthly', 'yearly', 'one_time'));
  end if;
end $$;

-- M52: provider_products duration_value positive.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_duration_value_positive'
  ) then
    alter table public.provider_products
      add constraint provider_products_duration_value_positive
      check (duration_value > 0);
  end if;
end $$;

-- M52: provider_products duration_unit check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_duration_unit_check'
  ) then
    alter table public.provider_products
      add constraint provider_products_duration_unit_check
      check (duration_unit in ('day', 'week', 'month', 'year'));
  end if;
end $$;

-- M52: provider_products amount non-negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'provider_products'
       and c.conname = 'provider_products_amount_nonneg'
  ) then
    alter table public.provider_products
      add constraint provider_products_amount_nonneg
      check (amount >= 0);
  end if;
end $$;

-- M52: webhook_events status check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'webhook_events'
       and c.conname = 'webhook_events_status_check'
  ) then
    alter table public.webhook_events
      add constraint webhook_events_status_check
      check (status in (
        'received', 'validating', 'verified', 'processing',
        'processed', 'duplicate', 'failed_retryable',
        'failed_terminal', 'blocked', 'awaiting_claim',
        'awaiting_admin'
      ));
  end if;
end $$;

-- M52: webhook_events unique (provider_id, provider_event_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'webhook_events'
       and c.conname = 'webhook_events_unique_event'
  ) then
    alter table public.webhook_events
      add constraint webhook_events_unique_event
      unique (provider_id, provider_event_id);
  end if;
end $$;

-- M53: payments affiliate_commission_status check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'payments'
       and c.conname = 'payments_affiliate_commission_status_check'
  ) then
    alter table public.payments
      add constraint payments_affiliate_commission_status_check
      check (affiliate_commission_status is null
             or affiliate_commission_status in ('pending','paid','reversed','skipped'));
  end if;
end $$;

-- M57: webhook_events resolution_outcome check.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class t     on t.oid = c.conrelid
     where n.nspname = 'public'
       and t.relname = 'webhook_events'
       and c.conname = 'webhook_events_resolution_outcome_check'
  ) then
    alter table public.webhook_events
      add constraint webhook_events_resolution_outcome_check
      check (resolution_outcome is null or resolution_outcome in (
        'resolved_existing_user',
        'marked_guest_awaiting_claim',
        'resolution_failed'
      ));
  end if;
end $$;

-- M39: affiliate_conversions unique (affiliate, referred_user, plan_code).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public'
       and table_name   = 'affiliate_conversions'
       and constraint_name = 'uq_affiliate_conversions_affiliate_referred_plan'
  ) then
    alter table public.affiliate_conversions
      add constraint uq_affiliate_conversions_affiliate_referred_plan
      unique (affiliate_user_id, referred_user_id, plan_code);
  end if;
end $$;


-- ============================================================
-- SECTION 10 — STORAGE BUCKETS AND POLICIES (M47)
-- ============================================================
-- Storage objects live in storage.objects and are managed
-- through the storage schema. The bucket inserts and policy
-- definitions here mirror M47 verbatim.

-- ── Storage buckets ──
insert into storage.buckets (id, name, public)
  values ('resource-pdfs', 'resource-pdfs', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('resource-covers', 'resource-covers', true)
  on conflict (id) do nothing;

-- ── Storage policies: resource-pdfs ──
drop policy if exists "Public read resource-pdfs"          on storage.objects;
drop policy if exists "Admins can upload resource-pdfs"   on storage.objects;
drop policy if exists "Admins can update resource-pdfs"   on storage.objects;
drop policy if exists "Admins can delete resource-pdfs"   on storage.objects;
create policy "Public read resource-pdfs"
  on storage.objects for select to public
  using (bucket_id = 'resource-pdfs');
create policy "Admins can upload resource-pdfs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );
create policy "Admins can update resource-pdfs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  )
  with check (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );
create policy "Admins can delete resource-pdfs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

-- ── Storage policies: resource-covers ──
drop policy if exists "Public read resource-covers"        on storage.objects;
drop policy if exists "Admins can upload resource-covers" on storage.objects;
drop policy if exists "Admins can update resource-covers" on storage.objects;
drop policy if exists "Admins can delete resource-covers" on storage.objects;
create policy "Public read resource-covers"
  on storage.objects for select to public
  using (bucket_id = 'resource-covers');
create policy "Admins can upload resource-covers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );
create policy "Admins can update resource-covers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  )
  with check (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );
create policy "Admins can delete resource-covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

-- ============================================================
-- END OF MIGRATION 59
-- ============================================================
-- This file is fully idempotent. Every object added here is
-- gated by IF NOT EXISTS or a catalog check. No data is
-- dropped, renamed, or modified. No CREATE OR REPLACE FUNCTION
-- is included (RPCs live in migration 60).
-- ============================================================
