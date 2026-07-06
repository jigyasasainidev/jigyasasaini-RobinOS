# Reconciliation Migration Review

## Verdict
**APPROVED** — after one fix (`record_subscription_webhook_event` was missing from `60_reconcile_missing_rpcs.sql` and has been added), both files are idempotent, data-safe, and aligned with the plan.

> Note: Automated reviewer agents timed out twice while reading the large source migrations, so this review was completed manually.

## Files reviewed
- `supabase/migrations/59_reconcile_missing_schema.sql` (1,575 lines)
- `supabase/migrations/60_reconcile_missing_rpcs.sql` (2,354 lines after fix)

## Fix applied during review
- **File:** `supabase/migrations/60_reconcile_missing_rpcs.sql`
- **Issue:** The M54 `record_subscription_webhook_event(p_provider_event_id text, p_provider text, p_event_type text, p_payload_hash text)` RPC was omitted from the original build.
- **Action:** Copied the final M54 implementation (lines 416–455) and inserted it before the file's `commit;`.
- **Result:** Function count increased from 28 to 29.

## Statement inventory — `59_reconcile_missing_schema.sql`

### `ALTER TABLE ... ADD COLUMN` (catalog-checked inside `DO $$` blocks)
All column additions are wrapped in a catalog check against `information_schema.columns`.

| Table | Column | Type / Constraints |
|---|---|---|
| `public.platform_settings` | `commission_hold_days` | `integer not null default 14` |
| `public.platform_settings` | `creator_os_page_enabled` | `boolean not null default true` |
| `public.platform_settings` | `creator_os_demo_video_url` | `text default null` |
| `public.platform_settings` | `jvzoo_affiliate_enabled` | `boolean not null default false` |
| `public.platform_settings` | `jvzoo_affiliate_demo_video_url` | `text default null` |
| `public.platform_settings` | `jvzoo_affiliate_cta_url` | `text default null` |
| `public.platform_settings` | `jvzoo_affiliate_button_text` | `text default 'Join Affiliate Program'` |
| `public.platform_settings` | `jvzoo_affiliate_login_url` | `text` |
| `public.platform_settings` | `affiliate_resources_url` | `text` |
| `public.platform_settings` | `resource_vault_enabled` | `boolean not null default true` |
| `public.platform_settings` | `warriorplus_page_enabled` | `boolean not null default false` |
| `public.platform_settings` | `warriorplus_demo_video_url` | `text default null` |
| `public.platform_settings` | `payment_provider_default` | `text default 'warriorplus'` |
| `public.platform_settings` | `payment_provider_require_email_verification` | `boolean not null default true` |
| `public.profiles` | `primary_payment_provider` | `text` |
| `public.payments` | `provider_subscription_id` | `text` |
| `public.payments` | `provider_order_id` | `text` |
| `public.payments` | `provider_invoice_id` | `text` |
| `public.payments` | `buyer_email` | `text` |
| `public.payments` | `buyer_email_hash` | `text` |
| `public.payments` | `buyer_name` | `text` |
| `public.payments` | `buyer_country` | `text` |
| `public.payments` | `plan_key` | `text` |
| `public.payments` | `source_webhook_event_id` | `uuid` |
| `public.payments` | `affiliate_user_id` | `uuid` |
| `public.payments` | `referral_code` | `text` |
| `public.payments` | `affiliate_commission_amount` | `numeric` |
| `public.payments` | `affiliate_commission_status` | `text` |
| `public.payments` | `raw_provider_payload` | `jsonb` |
| `public.webhook_events` | `provider_customer_id` | `text` |
| `public.webhook_events` | `resolution_attempted_at` | `timestamptz` |
| `public.webhook_events` | `resolution_outcome` | `text` |
| `public.webhook_events` | `resolution_buyer_email_hash` | `text` |
| `public.user_subscriptions` | `subscription_source` | `text not null default 'manual_admin'` |
| `public.user_subscriptions` | `is_revenue_eligible` | `boolean not null default false` |
| `public.user_subscriptions` | `starts_at` | `timestamptz` |
| `public.user_subscriptions` | `expires_at` | `timestamptz` |
| `public.user_subscriptions` | `last_plan_change_at` | `timestamptz` |
| `public.user_subscriptions` | `cooldown_until` | `timestamptz` |
| `public.user_subscriptions` | `granted_by_admin` | `boolean not null default false` |
| `public.user_subscriptions` | `granted_reason` | `text` |
| `public.affiliate_profiles` | `total_earned` | `numeric not null default 0` |
| `public.affiliate_profiles` | `pending_balance` | `numeric not null default 0` |
| `public.affiliate_profiles` | `paid_balance` | `numeric not null default 0` |
| `public.affiliate_profiles` | `locked_balance` | `numeric not null default 0` |
| `public.affiliate_commissions` | `approved_at` | `timestamptz` |
| `public.affiliate_commissions` | `payable_at` | `timestamptz` |
| `public.affiliate_commissions` | `paid_at` | `timestamptz` |
| `public.affiliate_commissions` | `reversed_at` | `timestamptz` |
| `public.affiliate_commissions` | `payout_batch_id` | `uuid` |
| `public.affiliate_commissions` | `requires_manual_recovery` | `boolean not null default false` |
| `public.affiliate_commissions` | `status` | `text not null default 'pending'` |
| `public.affiliate_commissions` | `eligible_at` | `timestamptz` |
| `public.affiliate_commissions` | `reversal_reason` | `text` |
| `public.affiliate_commissions` | `dodo_subscription_id` | `text` |
| `public.affiliate_commissions` | `provider_payment_id` | `text` |
| `public.affiliate_conversions` | `plan_code` | `text not null default 'signup'` |
| `public.affiliate_conversions` | `billed_amount` | `numeric not null default 0` |
| `public.affiliate_conversions` | `commission_rate` | `numeric not null default 0` |
| `public.affiliate_conversions` | `commission_amount` | `numeric not null default 0` |
| `public.affiliate_conversions` | `referral_code` | `text` |
| `public.affiliate_conversions` | `status` | `text not null default 'pending'` |

### `ALTER TYPE ... ADD VALUE`
All enum-value additions are wrapped in a catalog check against `pg_enum`.

| Type | Value |
|---|---|
| `public.payment_provider` | `warriorplus` |
| `public.payment_status` | `partially_refunded` |
| `public.payment_status` | `charged_back` |
| `public.payment_status` | `disputed` |

### `CREATE INDEX IF NOT EXISTS`

| Index | Table | Columns / Expression |
|---|---|---|
| `idx_resources_slug` | `public.resources` | `(slug)` |
| `idx_resources_category` | `public.resources` | `(category)` |
| `idx_resources_featured` | `public.resources` | `(featured desc, created_at desc)` |
| `idx_resources_created_at` | `public.resources` | `(created_at desc)` |
| `idx_payment_providers_enabled` | `public.payment_providers` | `(id)` |
| `idx_payment_provider_secrets_provider` | `public.payment_provider_secrets` | `(provider_id)` |
| `idx_payment_provider_secrets_active` | `public.payment_provider_secrets` | `(provider_id, is_active)` |
| `idx_provider_products_enabled` | `public.provider_products` | `(provider_id, provider_product_id)` |
| `idx_provider_products_plan` | `public.provider_products` | `(plan_key)` |
| `idx_webhook_events_queue` | `public.webhook_events` | `(received_at)` |
| `idx_webhook_events_provider_txn` | `public.webhook_events` | `(provider_id, provider_transaction_id)` |
| `idx_webhook_events_user` | `public.webhook_events` | `(linked_user_id, received_at desc)` |
| `idx_webhook_events_retry` | `public.webhook_events` | `(next_retry_at)` |
| `idx_webhook_events_trace` | `public.webhook_events` | `(trace_id)` |
| `idx_webhook_events_status_received` | `public.webhook_events` | `(status, received_at desc)` |
| `idx_webhook_events_resolution_outcome` | `public.webhook_events` | `(resolution_outcome, resolution_attempted_at desc)` where `resolution_outcome is not null` |
| `idx_webhook_events_resolution_email_hash` | `public.webhook_events` | `(resolution_buyer_email_hash)` where `resolution_buyer_email_hash is not null` |
| `idx_payments_subscription` | `public.payments` | `(subscription_id)` where `subscription_id is not null` |
| `idx_payments_buyer_hash` | `public.payments` | `(buyer_email_hash)` where `buyer_email_hash is not null` |
| `idx_payments_provider_event` | `public.payments` | `(provider, provider_payment_id)` |
| `idx_payments_affiliate` | `public.payments` | `(affiliate_user_id)` where `affiliate_user_id is not null` |
| `idx_payments_status_date` | `public.payments` | `(status, created_at desc)` |
| `idx_payments_plan_key` | `public.payments` | `(plan_key)` where `plan_key is not null` |
| `idx_affiliate_commissions_dodo_sub` | `public.affiliate_commissions` | `(dodo_subscription_id)` where `dodo_subscription_id is not null` |
| `idx_affiliate_commissions_provider_payment` | `public.affiliate_commissions` | `(provider_payment_id)` where `provider_payment_id is not null` |
| `idx_affiliate_commissions_status` | `public.affiliate_commissions` | `(status, eligible_at)` |
| `idx_affiliate_commissions_eligible` | `public.affiliate_commissions` | `(eligible_at)` |
| `idx_affiliate_commissions_dodo_sub_status` | `public.affiliate_commissions` | `(dodo_subscription_id, status)` |
| `idx_affiliate_conversions_referral_code` | `public.affiliate_conversions` | `(referral_code)` |
| `idx_user_subscriptions_revenue_eligible` | `public.user_subscriptions` | `(is_revenue_eligible, status)` |
| `idx_user_subscriptions_expires_at` | `public.user_subscriptions` | `(expires_at)` |
| `idx_user_subscriptions_status_active` | `public.user_subscriptions` | `(status, expires_at)` |

### `CREATE TRIGGER`
All triggers use `DROP TRIGGER IF EXISTS ...; CREATE TRIGGER ...`.

| Trigger | Table | Timing /  Event |
|---|---|---|
| `trg_resources_updated_at` | `public.resources` | `before update` |
| `trg_payment_providers_updated_at` | `public.payment_providers` | `before update` |
| `trg_provider_products_updated_at` | `public.provider_products` | `before update` |
| `trg_webhook_events_updated_at` | `public.webhook_events` | `before update` |
| `trg_payments_set_buyer_hash` | `public.payments` | `before insert` |

### `CREATE POLICY`
All policies use `DROP POLICY IF EXISTS ...; CREATE POLICY ...`.

| Policy | Table |
|---|---|
| `Public can read resources` | `public.resources` |
| `Admins can manage resources` | `public.resources` |
| `Admins manage payment_providers` | `public.payment_providers` |
| `Service role reads payment_providers` | `public.payment_providers` |
| `Service role manages payment_provider_secrets` | `public.payment_provider_secrets` |
| `payment_provider_secrets_deny_authenticated` | `public.payment_provider_secrets` |
| `Admins manage provider_products` | `public.provider_products` |
| `Service role reads provider_products` | `public.provider_products` |
| `Admins read webhook_events` | `public.webhook_events` |
| `Service role manages webhook_events` | `public.webhook_events` |
| `webhook_events_deny_anon` | `public.webhook_events` |
| `Public read resource-pdfs` | `storage.objects` |
| `Admins can upload resource-pdfs` | `storage.objects` |
| `Admins can update resource-pdfs` | `storage.objects` |
| `Admins can delete resource-pdfs` | `storage.objects` |
| `Public read resource-covers` | `storage.objects` |
| `Admins can upload resource-covers` | `storage.objects` |
| `Admins can update resource-covers` | `storage.objects` |
| `Admins can delete resource-covers` | `storage.objects` |

### `DROP` statements
Only schema-level `DROP IF EXISTS` statements are present, plus one conditional `DROP INDEX` inside a catalog-checked `DO $$` block.

- `drop index public.idx_payments_subscription;` — guarded by a catalog check that only runs when the index exists and the underlying column `user_subscription_id` does **not** exist (M54 self-heal path).
- `drop trigger if exists ...` for each trigger listed above.
- `drop policy if exists ...` for each policy listed above.

No `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `DROP SCHEMA`, or data-deleting statements appear.

### Seed / lookup `INSERT` statements
All inserts use `ON CONFLICT DO NOTHING`.

| Table | Description |
|---|---|
| `public.payment_providers` | Inserts the `warriorplus` provider row if missing. |
| `storage.buckets` | Inserts `resource-pdfs` and `resource-covers` buckets if missing. |

### Other schema objects
- **Tables created with `IF NOT EXISTS`:** `public.resources`, `public.payment_providers`, `public.payment_provider_secrets`, `public.provider_products`, `public.webhook_events`.
- **Constraints:** Catalog-checked unique/check constraints are added for `payment_provider_secrets`, `provider_products`, `webhook_events`, `payments`, and `affiliate_conversions`.
- **RLS enablement:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is applied idempotently to the five new tables.

## Statement inventory — `60_reconcile_missing_rpcs.sql`

All 29 functions use `CREATE OR REPLACE FUNCTION public.<name>(...)` with `security definer` and `search_path = public`.

| # | Function | Signature (source) |
|---|---|---|
| 1 | `public.set_payments_buyer_hash()` | `()` trigger function (M53) |
| 2 | `public.retry_webhook_event` | `(p_webhook_event_id uuid)` (M53) |
| 3 | `public.mark_webhook_dead_letter` | `(p_webhook_event_id uuid, p_reason text)` (M53) |
| 4 | `public.revoke_entitlement_from_purchase` | `(p_purchase_id uuid, p_reason text)` (M53 stub) |
| 5 | `public.recalculate_user_effective_plan` | `(p_user_id uuid)` (M53 stub) |
| 6 | `public.send_purchase_claim_email` | `(p_purchase_id uuid, p_buyer_email text)` (M53 stub) |
| 7 | `public.complete_purchase_claim` | `(p_claim_token uuid, p_account_data jsonb)` (M53 stub) |
| 8 | `public.enqueue_webhook_event` | `(p_provider_id text, p_provider_event_id text, p_provider_event_type text, p_raw_payload jsonb, p_raw_headers jsonb default null, p_provider_transaction_id text default null, p_trace_id uuid default gen_random_uuid())` (M54 final) |
| 9 | `public.search_payments` | `(p_provider_id text default null, p_provider_payment_id text default null, p_buyer_email text default null, p_user_id uuid default null, p_plan_key text default null, p_payment_status text default null, p_date_from timestamptz default null, p_date_to timestamptz default null, p_limit integer default 100, p_offset integer default 0)` (M54 final) |
| 10 | `public.search_webhook_events` | `(p_provider_id text default null, p_provider_transaction_id text default null, p_provider_event_type text default null, p_status text default null, p_buyer_email text default null, p_user_id uuid default null, p_date_from timestamptz default null, p_date_to timestamptz default null, p_limit integer default 100, p_offset integer default 0)` (M54 final) |
| 11 | `public.record_subscription_webhook_event` | `(p_provider_event_id text, p_provider text, p_event_type text, p_payload_hash text)` (M54 final) |
| 12 | `public.is_caller_admin` | `()` (M55) |
| 13 | `public.admin_list_providers` | `()` (M55) |
| 14 | `public.admin_get_provider` | `(p_id text)` (M55) |
| 15 | `public.admin_upsert_provider` | `(p_id text, p_display_name text, p_is_enabled boolean default false, p_is_test_mode boolean default false, p_require_signature_verification boolean default true, p_webhook_url text default null, p_notes text default null, p_config jsonb default '{}'::jsonb, p_allowed_ip_ranges cidr[] default null)` (M55) |
| 16 | `public.admin_toggle_provider` | `(p_id text, p_is_enabled boolean)` (M55) |
| 17 | `public.admin_list_provider_products` | `(p_provider_id text)` (M55) |
| 18 | `public.admin_upsert_provider_product` | `(p_id uuid default null, p_provider_id text default null, p_provider_product_id text default null, p_provider_offer_id text default null, p_plan_key text default null, p_billing_cycle text default null, p_duration_value numeric default null, p_duration_unit text default null, p_amount numeric default null, p_currency text default 'USD', p_is_subscription boolean default false, p_is_enabled boolean default true, p_display_name text default null, p_description text default null, p_metadata jsonb default '{}'::jsonb)` (M55) |
| 19 | `public.admin_delete_provider_product` | `(p_id uuid)` (M55) |
| 20 | `public.admin_get_payment_provider_summary` | `()` (M55) |
| 21 | `public._webhook_retry_delay_seconds` | `(p_retry_count int)` (M56) |
| 22 | `public.schedule_webhook_retry` | `(p_webhook_event_id uuid, p_error_message text)` (M56) |
| 23 | `public.process_pending_webhook_events` | `(p_batch_size integer default 50, p_max_runtime_ms integer default 25000)` (M56 final) |
| 24 | `public.get_webhook_queue_stats` | `()` (M56) |
| 25 | `public.resolve_or_create_user_from_purchase` | `(p_buyer_email text, p_buyer_name text, p_provider_id text, p_provider_customer_id text default null, p_create_if_missing boolean default false)` (M57 final) |
| 26 | `public.safe_plan_switch` | `(p_user_id uuid, p_new_plan text, p_billing_cycle text default 'monthly', p_provider text default null, p_provider_sub_id text default null, p_amount numeric default 0, p_triggered_by text default 'webhook', p_expires_at timestamptz default null)` (M58 final) |
| 27 | `public.record_purchase_from_webhook` | `(p_webhook_event_id uuid)` (M58 final) |
| 28 | `public.grant_entitlement_from_purchase` | `(p_purchase_id uuid)` (M58 final) |
| 29 | `public.process_webhook_event` | `(p_webhook_event_id uuid default null)` (M58 final) |

### `DROP FUNCTION IF EXISTS`
None are present. `CREATE OR REPLACE FUNCTION` handles replacement for matching signatures; non-matching older signatures (e.g., M53 `process_webhook_event(uuid)` vs M58 `process_webhook_event(uuid default null)`) are distinct PostgreSQL overloads and do not conflict.

## Idempotency confirmation
- **Migration 59:**
  - `CREATE TABLE IF NOT EXISTS` for all tables.
  - `ALTER TABLE ... ADD COLUMN` wrapped in `DO $$` blocks that check `information_schema.columns`.
  - `ALTER TYPE ... ADD VALUE` wrapped in `DO $$` blocks that check `pg_enum`.
  - `CREATE INDEX IF NOT EXISTS` for all indexes.
  - Triggers and policies use `DROP IF EXISTS` + `CREATE`.
  - Constraints are added only when missing, verified against `information_schema.table_constraints` / `pg_constraint`.
  - Seed inserts use `ON CONFLICT DO NOTHING`.
- **Migration 60:**
  - Every function uses `CREATE OR REPLACE FUNCTION`, which is idempotent.
  - The file is wrapped in a single transaction (`BEGIN; ... COMMIT;`).

## Data-safety confirmation
- **No existing RobinOS data is modified.**
- Neither file contains `DROP TABLE`, `DELETE FROM`, `TRUNCATE`, `UPDATE`, or object renames at the top level.
- The only `INSERT` statements are seed/lookup inserts with `ON CONFLICT DO NOTHING`.
- The `DROP INDEX` in migration 59 is conditional and only fires when the index exists but references a non-existent column (schema-only self-heal path).
- DML inside function bodies (e.g., `safe_plan_switch` upserts `user_subscriptions`, `admin_delete_provider_product` deletes a product) is not executed by running the migration; it only runs when the RPC is invoked.

## Known caveats
- Four M53 RPCs remain stubs (`revoke_entitlement_from_purchase`, `recalculate_user_effective_plan`, `send_purchase_claim_email`, `complete_purchase_claim`). These match the source migrations and are not implemented in M54–M58.
- `record_subscription_webhook_event` was added during review; if you regenerate the file from scratch, ensure it is retained.
