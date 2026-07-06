# Reconciliation Migration Plan

## Objective
Create two idempotent Supabase migrations that reconcile missing schema objects and RPCs without modifying existing user data.

## Output Files
1. `supabase/migrations/59_reconcile_missing_schema.sql`
2. `supabase/migrations/60_reconcile_missing_rpcs.sql`

## Constraints
- Do not execute the migrations.
- Do not connect to or modify any database.
- Do not run migration repair, db push, or any other CLI command that mutates schema/data.
- No `DROP TABLE`, `DELETE`, `TRUNCATE`, or renames of existing objects.
- Use `IF NOT EXISTS`, catalog checks, or `ON CONFLICT DO NOTHING` to keep statements idempotent.

## Source of Truth
The existing migration files in `/Users/ashadali/Documents/RobinOS-main/supabase/migrations/01_master_backend_architecture.sql` through `58_purchase_and_entitlement.sql` represent the desired final schema.

## File 1 — `59_reconcile_missing_schema.sql`

### Scope
Only schema objects introduced or modified in migrations 45–58, plus any earlier objects those layers depend on. For each object, add it if missing using idempotent checks.

### Object categories
1. **Tables** — `CREATE TABLE IF NOT EXISTS` for any table that may be absent.
2. **Columns** — For every column added after the initial table creation, wrap in:
   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '<table>' AND column_name = '<column>'
     ) THEN
       ALTER TABLE public.<table> ADD COLUMN <column> <type> <constraints>;
     END IF;
   END $$;
   ```
3. **Enum values** — For each `ALTER TYPE ... ADD VALUE`, wrap in catalog check against `pg_enum` or use `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
4. **Indexes** — `CREATE INDEX IF NOT EXISTS <name> ON public.<table> ...`.
5. **Triggers** — `DROP TRIGGER IF EXISTS <name> ON public.<table>; CREATE TRIGGER <name> ...` (or `CREATE OR REPLACE TRIGGER` where supported).
6. **RLS policies** — `DROP POLICY IF EXISTS <name> ON public.<table>; CREATE POLICY <name> ON public.<table> ...`.
7. **RLS enablement** — `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` (idempotent).
8. **Seed data** — `INSERT INTO public.<table> (...) VALUES (...) ON CONFLICT (<key>) DO NOTHING;`.
9. **Foreign keys / constraints** — Only add missing constraints via catalog checks (`information_schema.table_constraints`).

### Key areas to reconcile (non-exhaustive; derive exact DDL from source migrations)
- `platform_settings` columns added in M23, M24, M25, M46, M48, M50, M53.
- `profiles` column `primary_payment_provider` (M53).
- `payments` columns added in M53 and M54.
- `user_subscriptions` columns added in M15, M17, M30, M31.
- `affiliate_profiles` columns added in M10, M38.
- `affiliate_commissions` columns added in M38, M53.
- `affiliate_conversions` columns added in M39.
- `payment_provider` enum values (M53).
- `payment_status` enum values (M53).
- New tables: `payment_providers`, `payment_provider_secrets`, `provider_products`, `webhook_events`, `subscription_webhook_events`, `subscription_audit_log`, `admin_notifications`, `resources`, `affiliate_promo_assets`, `admin_2fa`, `admin_2fa_audit`, `commission_events`, `feature_usage_events`, `trend_radar_scans`.
- All indexes, triggers, policies, and seed inserts associated with the above.

### Idempotency rule
Every statement must be safe to run multiple times. Prefer catalog checks over blind `CREATE/DROP`.

## File 2 — `60_reconcile_missing_rpcs.sql`

### Scope
Restore final function implementations as of migration 58, plus any worker/search/admin-provider RPCs from M53–M57 that are not overridden by M58.

### Approach
Use `CREATE OR REPLACE FUNCTION` for every required function. The final implementation is the one in the latest migration that defines it (usually M58 for the purchase/webhook/entitlement flow; M56 for worker RPCs; M55 for admin provider RPCs; M54 for search fixes).

### Function groups to include (derive exact signatures/DDL from source migrations)
1. **Final M58 implementations**
   - `safe_plan_switch`
   - `record_purchase_from_webhook`
   - `grant_entitlement_from_purchase`
   - `process_webhook_event`
2. **User resolution / purchase claim (final versions)**
   - `resolve_or_create_user_from_purchase`
   - `send_purchase_claim_email`
   - `complete_purchase_claim`
   - `recalculate_user_effective_plan`
3. **Worker RPCs (M56)**
   - `_webhook_retry_delay_seconds`
   - `schedule_webhook_retry`
   - `process_webhook_event` (worker overloads)
   - `process_pending_webhook_events`
   - `get_webhook_queue_stats`
4. **Admin payment provider RPCs (M55)**
   - `is_caller_admin`
   - `admin_list_providers`
   - `admin_get_provider`
   - `admin_upsert_provider`
   - `admin_toggle_provider`
   - `admin_list_provider_products`
   - `admin_upsert_provider_product`
   - `admin_delete_provider_product`
   - `admin_get_payment_provider_summary`
5. **Search RPC fixes (M54)**
   - `search_payments`
   - `search_webhook_events`
   - `enqueue_webhook_event`
   - `record_subscription_webhook_event`
6. **Supporting functions from M53**
   - `set_payments_buyer_hash`
   - `retry_webhook_event`
   - `mark_webhook_dead_letter`
   - `revoke_entitlement_from_purchase`
   - Any other helper used by the above.

### Idempotency rule
`CREATE OR REPLACE FUNCTION` is idempotent; do not drop functions before recreating unless necessary to resolve signature conflicts. Do not include any statement that modifies user tables.

## Acceptance Criteria
- Both files exist at the exact paths above.
- `59_reconcile_missing_schema.sql` contains no `DROP TABLE`, `DELETE`, `TRUNCATE`, or renames.
- `60_reconcile_missing_rpcs.sql` contains only `CREATE OR REPLACE FUNCTION` and related `DROP FUNCTION IF EXISTS` for obsolete signatures.
- Every statement in both files is idempotent.
- No `INSERT`/`UPDATE`/`DELETE` on user data tables (profiles, payments, subscriptions, etc.) except seed data inserts with `ON CONFLICT DO NOTHING`.
- Files use `public.` schema qualifier.
- No execution or database mutation occurs.
