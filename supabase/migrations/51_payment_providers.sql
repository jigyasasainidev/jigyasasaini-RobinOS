-- ============================================================
-- MIGRATION 51 — PAYMENT PROVIDER REGISTRY
-- ============================================================
-- Generic payment provider abstraction layer. Adds the tables
-- required to register and configure any payment provider
-- (WarriorPlus first, then JVZoo, Digistore24, Stripe, etc.).
--
-- This migration is ADDITIVE ONLY. No existing tables, columns,
-- enums, RLS policies, triggers, or RPCs are modified.
--
-- What this adds:
--   1. payment_providers            — Registry of configured providers
--   2. payment_provider_secrets     — Encrypted secret storage per provider
--   3. Indexes for both
--   4. RLS policies for both (admin-managed, service_role reads)
--   5. updated_at triggers for both
--   6. Seed row for 'warriorplus' (disabled by default)
--
-- Reuses existing infrastructure:
--   - public.set_updated_at() (from migration 01)
--   - public.get_admin_role() (from migration 01)
--
-- Production note on encryption:
--   This project does not yet have pgsodium or Supabase Vault
--   configured. payment_provider_secrets.secret_value_encrypted
--   stores AES-256-GCM ciphertext produced by Edge Functions
--   (using a project-level encryption key from Supabase Secrets).
--   Decryption happens only inside Edge Functions with the
--   service role. Plaintext never appears in logs.
-- ============================================================

begin;

-- ── 1. payment_providers TABLE ─────────────────────────────
-- Registry of every payment provider integrated with RobinOS.
-- Each row represents one provider (WarriorPlus, Stripe, etc.)
-- with its adapter configuration and security settings.

create table if not exists public.payment_providers (
  -- Identity
  id                          text        primary key,
  display_name                text        not null,
  adapter_version             text        not null default '1.0.0',
  is_enabled                  boolean     not null default false,

  -- Adapter-specific configuration (timeout, retry policy, etc.)
  config                      jsonb       not null default '{}'::jsonb,

  -- Security
  allowed_ip_ranges           cidr[],
  require_signature_verification boolean not null default true,
  is_test_mode                boolean     not null default false,

  -- Webhook endpoint (displayed to admin, registered at provider dashboard)
  webhook_url                 text,
  notes                       text,

  -- Audit
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid        references auth.users(id) on delete set null,
  updated_by                  uuid        references auth.users(id) on delete set null
);

comment on table public.payment_providers is
  'Registry of configured payment providers (WarriorPlus, Stripe, etc.). Each row is one provider with its adapter config and security settings. Admin-managed; service_role reads.';

comment on column public.payment_providers.id is
  'Stable provider identifier (e.g. warriorplus, stripe). Used in webhook URL path and as FK in other tables.';
comment on column public.payment_providers.display_name is
  'Human-readable provider name shown in admin UI.';
comment on column public.payment_providers.adapter_version is
  'Version of the provider adapter implementation. Bump when adapter logic changes.';
comment on column public.payment_providers.is_enabled is
  'When false, webhooks from this provider are rejected with 503. Admin toggles after configuration is complete.';
comment on column public.payment_providers.config is
  'Adapter-specific configuration (timeouts, retry policies, feature flags). JSON shape is adapter-defined.';
comment on column public.payment_providers.allowed_ip_ranges is
  'Optional IP whitelist for webhook sources. NULL = accept from any IP (rely on signature verification).';
comment on column public.payment_providers.require_signature_verification is
  'When true, webhooks with invalid signatures are rejected. When false (NOT recommended), signature is logged but not enforced.';
comment on column public.payment_providers.is_test_mode is
  'When true, provider operates in sandbox/test mode. Test purchases only.';
comment on column public.payment_providers.webhook_url is
  'Webhook endpoint to register in the provider dashboard. Format: https://<project>.supabase.co/functions/v1/payment-webhook/<id>';

-- ── 2. INDEXES on payment_providers ────────────────────────
create index if not exists idx_payment_providers_enabled
  on public.payment_providers (id)
  where is_enabled = true;

-- ── 3. RLS on payment_providers ────────────────────────────
alter table public.payment_providers enable row level security;

drop policy if exists "Admins manage payment_providers" on public.payment_providers;
create policy "Admins manage payment_providers"
  on public.payment_providers for all
  to authenticated
  using (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin'));

drop policy if exists "Service role reads payment_providers" on public.payment_providers;
create policy "Service role reads payment_providers"
  on public.payment_providers for select
  to service_role
  using (true);

-- ── 4. updated_at TRIGGER for payment_providers ────────────
drop trigger if exists trg_payment_providers_updated_at on public.payment_providers;
create trigger trg_payment_providers_updated_at
  before update on public.payment_providers
  for each row execute function public.set_updated_at();


-- ── 5. payment_provider_secrets TABLE ──────────────────────
-- Per-provider secret storage. Values are AES-256-GCM ciphertext
-- produced by Edge Functions. NEVER store plaintext here.
--
-- The actual webhook signing secrets used by Edge Functions
-- during request verification live in Supabase Edge Function
-- Secrets (environment variables). This table is for admin-
-- managed credentials such as API keys used for outbound calls
-- (e.g. verifyTransactionViaAPI in the adapter interface).

create table if not exists public.payment_provider_secrets (
  id                        uuid        primary key default gen_random_uuid(),
  provider_id               text        not null references public.payment_providers(id) on delete cascade,

  -- Secret identification
  secret_name               text        not null,

  -- Encrypted value (AES-256-GCM, base64-encoded: iv::tag::ciphertext)
  secret_value_encrypted    text        not null,

  -- Lifecycle
  description               text,
  is_active                 boolean     not null default true,
  rotated_at                timestamptz,
  expires_at                timestamptz,

  -- Audit
  created_at                timestamptz not null default now(),
  created_by                uuid        references auth.users(id) on delete set null,

  -- Only one active secret per (provider, name)
  constraint payment_provider_secrets_unique
    unique (provider_id, secret_name, is_active) deferrable initially deferred
);

create unique index if not exists idx_payment_provider_secrets_unique_active
  on public.payment_provider_secrets (provider_id, secret_name)
  where is_active = true;

comment on table public.payment_provider_secrets is
  'Encrypted credential storage per payment provider. service_role only. Plaintext NEVER stored.';

comment on column public.payment_provider_secrets.secret_name is
  'Identifier of the secret within the provider (e.g. webhook_secret, api_key, signing_key).';
comment on column public.payment_provider_secrets.secret_value_encrypted is
  'AES-256-GCM ciphertext, base64-encoded (format: iv::tag::ciphertext). Decryption happens only inside Edge Functions.';
comment on column public.payment_provider_secrets.is_active is
  'When false, this secret is rotated/replaced. Only one active per (provider_id, secret_name) enforced via partial unique index.';
comment on column public.payment_provider_secrets.rotated_at is
  'Timestamp of last rotation. Used to enforce periodic rotation policy.';
comment on column public.payment_provider_secrets.expires_at is
  'Optional expiration. NULL = no expiry. Edge Functions should reject expired secrets.';

-- ── 6. INDEXES on payment_provider_secrets ─────────────────
create index if not exists idx_payment_provider_secrets_provider
  on public.payment_provider_secrets (provider_id);

create index if not exists idx_payment_provider_secrets_active
  on public.payment_provider_secrets (provider_id, is_active)
  where is_active = true;

-- ── 7. RLS on payment_provider_secrets ────────────────────
-- Service_role only. No client or admin SQL access — all
-- operations go through Edge Functions with explicit audit.
-- Even super_admin cannot read via SQL; rotation is via RPC.

alter table public.payment_provider_secrets enable row level security;

drop policy if exists "Service role manages payment_provider_secrets" on public.payment_provider_secrets;
create policy "Service role manages payment_provider_secrets"
  on public.payment_provider_secrets for all
  to service_role
  using (true) with check (true);

-- Explicit deny for authenticated (defense in depth)
drop policy if exists "payment_provider_secrets_deny_authenticated" on public.payment_provider_secrets;
create policy "payment_provider_secrets_deny_authenticated"
  on public.payment_provider_secrets for all
  to authenticated
  using (false)
  with check (false);


-- ── 8. SEED: WarriorPlus provider (disabled) ───────────────
-- The provider is registered but disabled. Admin must configure
-- secrets and explicitly enable after setup is complete.

insert into public.payment_providers
  (id, display_name, adapter_version, is_enabled, require_signature_verification)
values
  ('warriorplus', 'WarriorPlus', '1.0.0', false, true)
on conflict (id) do nothing;


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 51
-- ============================================================
-- Execute this ONLY if Milestone 1 needs to be reverted before
-- Milestone 2 begins. Drops the new tables and triggers.
--
-- Data loss warning: drops payment_providers and
-- payment_provider_secrets entirely, including any data
-- created during testing of Milestone 1.

/*
begin;

drop trigger if exists trg_payment_providers_updated_at on public.payment_providers;
drop table if exists public.payment_provider_secrets cascade;
drop table if exists public.payment_providers cascade;

commit;
*/
