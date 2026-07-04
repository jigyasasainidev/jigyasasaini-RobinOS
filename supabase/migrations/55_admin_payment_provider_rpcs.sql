-- ============================================================
-- MIGRATION 55 — ADMIN PAYMENT PROVIDER CONFIGURATION RPCs
-- ============================================================
-- Provides the data-layer operations for the Milestone 2 admin
-- UI (provider enable/disable, product CRUD). All RPCs are
-- service_role-only; the admin-payment-providers edge function
-- is the only authorized caller.
--
-- ADDITIVE ONLY. No existing tables, columns, RLS policies,
-- triggers, or RPCs are modified.
--
-- What this adds:
--   1. admin_list_providers()              — list all providers
--   2. admin_get_provider(p_id)            — fetch single provider
--   3. admin_upsert_provider(...)          — create/update provider
--   4. admin_toggle_provider(p_id, p_is_enabled) — enable/disable
--   5. admin_list_provider_products(p_provider_id) — list products
--   6. admin_upsert_provider_product(...)  — create/update product
--   7. admin_delete_provider_product(p_id) — delete product
--   8. admin_get_payment_provider_summary() — dashboard tile data
--
-- Hard rules enforced in SQL:
--   - All RPCs are SECURITY DEFINER + set search_path = public
--   - All writes check admin role via public.get_admin_role(auth.uid())
--   - Duplicate product mapping blocked at DB level
--     (provider_id, provider_product_id, provider_offer_id)
--   - Sensitive columns (payment_provider_secrets) are NEVER read
--     or returned by any RPC in this migration
--   - All money values are >= 0 (DB CHECK constraint already exists)
--   - All durations are > 0 (DB CHECK constraint already exists)
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- HELPER: is_caller_admin() — internal admin gate
-- ────────────────────────────────────────────────────────────
-- Reuses public.get_admin_role() from M01. Returns true if the
-- caller is super_admin, admin, or support. Used by every
-- write RPC in this migration.
create or replace function public.is_caller_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'),
    false
  );
$$;

grant execute on function public.is_caller_admin() to service_role;

comment on function public.is_caller_admin is
  'Internal admin gate for M55 RPCs. Returns true if the current user has an admin role. Used only by other RPCs; not callable from the frontend.';


-- ============================================================
-- RPC 1: admin_list_providers
-- ============================================================
-- Returns every provider with the count of products configured
-- for it. Safe to expose (no secrets returned).

create or replace function public.admin_list_providers()
returns table (
  id                          text,
  display_name                text,
  adapter_version             text,
  is_enabled                  boolean,
  is_test_mode                boolean,
  require_signature_verification boolean,
  webhook_url                 text,
  notes                       text,
  product_count               bigint,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_list_providers: admin access required';
  end if;

  return query
    select
      pp.id,
      pp.display_name,
      pp.adapter_version,
      pp.is_enabled,
      pp.is_test_mode,
      pp.require_signature_verification,
      pp.webhook_url,
      pp.notes,
      coalesce(count(pr.id), 0) as product_count,
      pp.created_at,
      pp.updated_at
    from public.payment_providers pp
    left join public.provider_products pr on pr.provider_id = pp.id
    group by pp.id, pp.display_name, pp.adapter_version, pp.is_enabled,
             pp.is_test_mode, pp.require_signature_verification,
             pp.webhook_url, pp.notes, pp.created_at, pp.updated_at
    order by pp.id;
end;
$$;

grant execute on function public.admin_list_providers() to service_role;

comment on function public.admin_list_providers is
  'List all registered payment providers with product counts. Admin-only (service_role caller). Does NOT return secrets.';


-- ============================================================
-- RPC 2: admin_get_provider
-- ============================================================
create or replace function public.admin_get_provider(p_id text)
returns table (
  id                          text,
  display_name                text,
  adapter_version             text,
  is_enabled                  boolean,
  is_test_mode                boolean,
  require_signature_verification boolean,
  config                      jsonb,
  allowed_ip_ranges           cidr[],
  webhook_url                 text,
  notes                       text,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_get_provider: admin access required';
  end if;

  return query
    select
      pp.id, pp.display_name, pp.adapter_version, pp.is_enabled,
      pp.is_test_mode, pp.require_signature_verification,
      pp.config, pp.allowed_ip_ranges, pp.webhook_url, pp.notes,
      pp.created_at, pp.updated_at
    from public.payment_providers pp
    where pp.id = p_id;
end;
$$;

grant execute on function public.admin_get_provider(text) to service_role;

comment on function public.admin_get_provider is
  'Fetch a single payment provider with full config. Admin-only. Does NOT return secrets.';


-- ============================================================
-- RPC 3: admin_upsert_provider
-- ============================================================
-- Creates or updates a provider. All inputs validated; will
-- reject blank id/display_name. Does NOT touch payment_provider_secrets.

create or replace function public.admin_upsert_provider(
  p_id                          text,
  p_display_name                text,
  p_is_enabled                  boolean default false,
  p_is_test_mode                boolean default false,
  p_require_signature_verification boolean default true,
  p_webhook_url                 text default null,
  p_notes                       text default null,
  p_config                      jsonb default '{}'::jsonb,
  p_allowed_ip_ranges           cidr[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_result jsonb;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_upsert_provider: admin access required';
  end if;

  -- Validate inputs
  if p_id is null or length(trim(p_id)) = 0 then
    raise exception 'admin_upsert_provider: provider id is required';
  end if;
  if length(p_id) > 64 then
    raise exception 'admin_upsert_provider: provider id must be <= 64 chars';
  end if;
  if p_id !~ '^[a-z0-9_-]+$' then
    raise exception 'admin_upsert_provider: provider id must match ^[a-z0-9_-]+$';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'admin_upsert_provider: display_name is required';
  end if;
  if length(p_display_name) > 120 then
    raise exception 'admin_upsert_provider: display_name must be <= 120 chars';
  end if;
  if p_webhook_url is not null and length(p_webhook_url) > 0 then
    if p_webhook_url !~ '^https?://' then
      raise exception 'admin_upsert_provider: webhook_url must start with http(s)://';
    end if;
  end if;

  insert into public.payment_providers (
    id, display_name, is_enabled, is_test_mode,
    require_signature_verification, webhook_url, notes, config,
    allowed_ip_ranges
  ) values (
    p_id, p_display_name, p_is_enabled, p_is_test_mode,
    p_require_signature_verification, p_webhook_url, p_notes, p_config,
    p_allowed_ip_ranges
  )
  on conflict (id) do update set
    display_name                = excluded.display_name,
    is_enabled                  = excluded.is_enabled,
    is_test_mode                = excluded.is_test_mode,
    require_signature_verification = excluded.require_signature_verification,
    webhook_url                 = excluded.webhook_url,
    notes                       = excluded.notes,
    config                      = excluded.config,
    allowed_ip_ranges           = excluded.allowed_ip_ranges,
    updated_at                  = now()
  returning id into v_id;

  select jsonb_build_object(
    'id',          v_id,
    'is_enabled',  p_is_enabled,
    'updated',     true
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_upsert_provider(
  text, text, boolean, boolean, boolean, text, text, jsonb, cidr[]
) to service_role;

comment on function public.admin_upsert_provider is
  'Create or update a payment provider. Admin-only (service_role caller). Does NOT touch secrets. Validates id format (lowercase, digits, _, -) and length.';


-- ============================================================
-- RPC 4: admin_toggle_provider
-- ============================================================
-- Quick enable/disable. Used by the toggle switch on the UI.

create or replace function public.admin_toggle_provider(
  p_id         text,
  p_is_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated timestamptz;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_toggle_provider: admin access required';
  end if;

  update public.payment_providers
     set is_enabled = p_is_enabled,
         updated_at = now()
   where id = p_id
   returning updated_at into v_updated;

  if v_updated is null then
    raise exception 'admin_toggle_provider: provider "%" not found', p_id;
  end if;

  return jsonb_build_object(
    'id',         p_id,
    'is_enabled', p_is_enabled,
    'updated_at', v_updated
  );
end;
$$;

grant execute on function public.admin_toggle_provider(text, boolean) to service_role;

comment on function public.admin_toggle_provider is
  'Enable or disable a payment provider. Admin-only. Used by the UI toggle switch.';


-- ============================================================
-- RPC 5: admin_list_provider_products
-- ============================================================
create or replace function public.admin_list_provider_products(
  p_provider_id text
)
returns table (
  id                    uuid,
  provider_id           text,
  provider_product_id   text,
  provider_offer_id     text,
  plan_key              text,
  billing_cycle         text,
  duration_value        numeric,
  duration_unit         text,
  amount                numeric,
  currency              text,
  is_subscription       boolean,
  is_enabled            boolean,
  display_name          text,
  description           text,
  metadata              jsonb,
  created_at            timestamptz,
  updated_at            timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_caller_admin() then
    raise exception 'admin_list_provider_products: admin access required';
  end if;

  return query
    select
      pr.id, pr.provider_id, pr.provider_product_id, pr.provider_offer_id,
      pr.plan_key, pr.billing_cycle, pr.duration_value, pr.duration_unit,
      pr.amount, pr.currency, pr.is_subscription, pr.is_enabled,
      pr.display_name, pr.description, pr.metadata,
      pr.created_at, pr.updated_at
    from public.provider_products pr
    where pr.provider_id = p_provider_id
    order by pr.created_at desc;
end;
$$;

grant execute on function public.admin_list_provider_products(text) to service_role;

comment on function public.admin_list_provider_products is
  'List all product mappings for a provider. Admin-only. Ordered by created_at desc (newest first).';


-- ============================================================
-- RPC 6: admin_upsert_provider_product
-- ============================================================
-- The core CRUD for product mappings. Validates:
--   - plan_key, billing_cycle, duration_unit are in the allowed sets
--   - amount >= 0, duration_value > 0
--   - currency is a 3-letter ISO code (uppercased)
--   - duplicate mapping on (provider_id, provider_product_id, provider_offer_id)
--     returns a structured error rather than a 500.
--
-- p_id NULL → INSERT; non-NULL → UPDATE that row.

create or replace function public.admin_upsert_provider_product(
  p_id                  uuid    default null,
  p_provider_id         text    default null,
  p_provider_product_id text    default null,
  p_provider_offer_id   text    default null,
  p_plan_key            text    default null,
  p_billing_cycle       text    default null,
  p_duration_value      numeric default null,
  p_duration_unit       text    default null,
  p_amount              numeric default null,
  p_currency            text    default 'USD',
  p_is_subscription     boolean default false,
  p_is_enabled          boolean default true,
  p_display_name        text    default null,
  p_description         text    default null,
  p_metadata            jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id            uuid;
  v_provider_id   text;
  v_duplicate_id  uuid;
  v_is_update     boolean;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_upsert_provider_product: admin access required';
  end if;

  -- Branch on create vs update
  v_is_update := p_id is not null;

  if v_is_update then
    -- Update path: required fields may be absent; use existing values for nulls
    select provider_id into v_provider_id
      from public.provider_products
     where id = p_id;
    if v_provider_id is null then
      raise exception 'admin_upsert_provider_product: product id "%" not found', p_id;
    end if;
  else
    -- Insert path: all required fields must be present
    if p_provider_id is null or length(trim(p_provider_id)) = 0 then
      raise exception 'admin_upsert_provider_product: provider_id is required';
    end if;
    if p_provider_product_id is null or length(trim(p_provider_product_id)) = 0 then
      raise exception 'admin_upsert_provider_product: provider_product_id is required';
    end if;
    if p_plan_key is null then
      raise exception 'admin_upsert_provider_product: plan_key is required';
    end if;
    if p_billing_cycle is null then
      raise exception 'admin_upsert_provider_product: billing_cycle is required';
    end if;
    if p_duration_value is null then
      raise exception 'admin_upsert_provider_product: duration_value is required';
    end if;
    if p_duration_unit is null then
      raise exception 'admin_upsert_provider_product: duration_unit is required';
    end if;
    if p_amount is null then
      raise exception 'admin_upsert_provider_product: amount is required';
    end if;
    v_provider_id := p_provider_id;
  end if;

  -- Field-level validation (applies to both insert and update)
  if p_plan_key is not null and p_plan_key not in ('free', 'creator', 'pro_creator', 'agency') then
    raise exception 'admin_upsert_provider_product: plan_key "%" is not one of (free, creator, pro_creator, agency)', p_plan_key;
  end if;
  if p_billing_cycle is not null and p_billing_cycle not in ('monthly', 'yearly', 'one_time') then
    raise exception 'admin_upsert_provider_product: billing_cycle "%" is not one of (monthly, yearly, one_time)', p_billing_cycle;
  end if;
  if p_duration_unit is not null and p_duration_unit not in ('day', 'week', 'month', 'year') then
    raise exception 'admin_upsert_provider_product: duration_unit "%" is not one of (day, week, month, year)', p_duration_unit;
  end if;
  if p_duration_value is not null and p_duration_value <= 0 then
    raise exception 'admin_upsert_provider_product: duration_value must be > 0';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'admin_upsert_provider_product: amount must be >= 0';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'admin_upsert_provider_product: currency must be a 3-letter ISO code (uppercase)';
  end if;
  if p_provider_product_id is not null and length(p_provider_product_id) > 64 then
    raise exception 'admin_upsert_provider_product: provider_product_id must be <= 64 chars';
  end if;
  if p_provider_offer_id is not null and length(p_provider_offer_id) > 64 then
    raise exception 'admin_upsert_provider_product: provider_offer_id must be <= 64 chars';
  end if;
  if p_display_name is not null and length(p_display_name) > 120 then
    raise exception 'admin_upsert_provider_product: display_name must be <= 120 chars';
  end if;

  -- Duplicate detection on (provider_id, provider_product_id, provider_offer_id).
  -- The UNIQUE constraint exists, but we catch it explicitly to return a structured error.
  if v_is_update then
    select id into v_duplicate_id
      from public.provider_products
     where provider_id           = v_provider_id
       and provider_product_id   = coalesce(p_provider_product_id, provider_product_id)
       and coalesce(provider_offer_id, '') = coalesce(p_provider_offer_id, '')
       and id <> p_id
     limit 1;
  else
    select id into v_duplicate_id
      from public.provider_products
     where provider_id           = p_provider_id
       and provider_product_id   = p_provider_product_id
       and coalesce(provider_offer_id, '') = coalesce(p_provider_offer_id, '')
     limit 1;
  end if;

  if v_duplicate_id is not null then
    raise exception 'DUPLICATE_PRODUCT_MAPPING:%', v_duplicate_id
      using errcode = 'P0001';
  end if;

  if v_is_update then
    update public.provider_products
       set provider_product_id   = coalesce(p_provider_product_id, provider_product_id),
           provider_offer_id     = p_provider_offer_id,
           plan_key              = coalesce(p_plan_key, plan_key),
           billing_cycle         = coalesce(p_billing_cycle, billing_cycle),
           duration_value        = coalesce(p_duration_value, duration_value),
           duration_unit         = coalesce(p_duration_unit, duration_unit),
           amount                = coalesce(p_amount, amount),
           currency              = coalesce(p_currency, currency),
           is_subscription       = coalesce(p_is_subscription, is_subscription),
           is_enabled            = coalesce(p_is_enabled, is_enabled),
           display_name          = p_display_name,
           description           = p_description,
           metadata              = coalesce(p_metadata, metadata),
           updated_at            = now()
     where id = p_id
     returning id into v_id;
  else
    insert into public.provider_products (
      provider_id, provider_product_id, provider_offer_id,
      plan_key, billing_cycle, duration_value, duration_unit,
      amount, currency, is_subscription, is_enabled,
      display_name, description, metadata
    ) values (
      p_provider_id, p_provider_product_id, p_provider_offer_id,
      p_plan_key, p_billing_cycle, p_duration_value, p_duration_unit,
      p_amount, p_currency, p_is_subscription, p_is_enabled,
      p_display_name, p_description, p_metadata
    )
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'id',         v_id,
    'provider_id', v_provider_id,
    'is_update',  v_is_update
  );
end;
$$;

grant execute on function public.admin_upsert_provider_product(
  uuid, text, text, text, text, text, numeric, text,
  numeric, text, boolean, boolean, text, text, jsonb
) to service_role;

comment on function public.admin_upsert_provider_product is
  'Create or update a product mapping. Admin-only. Validates plan_key, billing_cycle, duration_unit, amount, currency, and lengths. Returns DUPLICATE_PRODUCT_MAPPING:<id> when (provider_id, provider_product_id, provider_offer_id) already exists for a different row.';


-- ============================================================
-- RPC 7: admin_delete_provider_product
-- ============================================================
create or replace function public.admin_delete_provider_product(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_id text;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_delete_provider_product: admin access required';
  end if;

  select provider_id into v_provider_id
    from public.provider_products
   where id = p_id;

  if v_provider_id is null then
    raise exception 'admin_delete_provider_product: product id "%" not found', p_id;
  end if;

  delete from public.provider_products where id = p_id;

  return jsonb_build_object(
    'id',          p_id,
    'provider_id', v_provider_id,
    'deleted',     true
  );
end;
$$;

grant execute on function public.admin_delete_provider_product(uuid) to service_role;

comment on function public.admin_delete_provider_product is
  'Delete a product mapping. Admin-only. No soft-delete — the row is removed. Past payments are not affected (they reference provider_payment_id, not this row).';


-- ============================================================
-- RPC 8: admin_get_payment_provider_summary
-- ============================================================
-- Dashboard tile data: provider counts, enabled counts, total products.

create or replace function public.admin_get_payment_provider_summary()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_provider_count      bigint;
  v_enabled_count       bigint;
  v_product_count       bigint;
  v_active_product_count bigint;
begin
  if not public.is_caller_admin() then
    raise exception 'admin_get_payment_provider_summary: admin access required';
  end if;

  select count(*) into v_provider_count from public.payment_providers;
  select count(*) into v_enabled_count from public.payment_providers where is_enabled = true;
  select count(*) into v_product_count from public.provider_products;
  select count(*) into v_active_product_count from public.provider_products where is_enabled = true;

  return jsonb_build_object(
    'provider_count',       v_provider_count,
    'enabled_count',        v_enabled_count,
    'product_count',        v_product_count,
    'active_product_count', v_active_product_count
  );
end;
$$;

grant execute on function public.admin_get_payment_provider_summary() to service_role;

comment on function public.admin_get_payment_provider_summary is
  'Dashboard tile data for the admin payment providers page. Returns provider/product counts.';


commit;


-- ============================================================
-- ROLLBACK SCRIPT FOR MIGRATION 55
-- ============================================================
-- Reverts all admin RPCs created in this migration. Does NOT
-- touch any existing tables/policies/triggers/RPCs. Safe to run.

/*
begin;

drop function if exists public.is_caller_admin();
drop function if exists public.admin_list_providers();
drop function if exists public.admin_get_provider(text);
drop function if exists public.admin_upsert_provider(text, text, boolean, boolean, boolean, text, text, jsonb, cidr[]);
drop function if exists public.admin_toggle_provider(text, boolean);
drop function if exists public.admin_list_provider_products(text);
drop function if exists public.admin_upsert_provider_product(uuid, text, text, text, text, text, numeric, text, numeric, text, boolean, boolean, text, text, jsonb);
drop function if exists public.admin_delete_provider_product(uuid);
drop function if exists public.admin_get_payment_provider_summary();

commit;
*/
