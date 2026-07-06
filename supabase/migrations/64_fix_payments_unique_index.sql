-- M64 (rewritten) — make payments provider event index unique
--
-- Fixes duplicate-payment bug: idx_payments_provider_event was a
-- non-unique btree index, so record_purchase_from_webhook's
-- unique-violation fallback was never triggered and the same
-- WarriorPlus transaction could create multiple payment rows.
--
-- This rewrite:
--   * Drops BOTH non-unique indexes on (provider, provider_payment_id)
--     (idx_payments_provider_event and idx_payments_provider_id),
--     keeping only the unique one.
--   * Deduplicates payments using a window-function CTE (no min(uuid)
--     aggregate — the linked remote DB lacks it).
--   * Repoints webhook_events.linked_purchase_id to the surviving
--     row before deleting duplicates.
--   * Creates a UNIQUE index on (provider, provider_payment_id).
--
-- Idempotent and safe to rerun.

-- 1. Drop the non-unique indexes if they exist.
drop index if exists public.idx_payments_provider_event;
drop index if exists public.idx_payments_provider_id;

-- 2a. Repoint webhook_events.linked_purchase_id from any duplicate
--     payment row to its group's survivor (oldest by created_at, id).
--
-- NOTE: ORDER BY uses id::text (not id directly) so the migration stays
-- compatible with this Supabase instance, which lacks built-in uuid
-- aggregates (see migration 62). first_value() returns the uuid value
-- as-is, so no uuid aggregate is required.
with ranked as (
  select id,
         row_number() over (
           partition by provider, provider_payment_id
           order by created_at, id::text
         ) as rn,
         first_value(id) over (
           partition by provider, provider_payment_id
           order by created_at, id::text
           rows between unbounded preceding and unbounded following
         ) as survivor_id
  from public.payments
)
update public.webhook_events w
   set linked_purchase_id = r.survivor_id
  from ranked r
 where w.linked_purchase_id = r.id
   and r.rn > 1;

-- 2b. Delete duplicate payment rows, keeping the oldest per group.
with ranked as (
  select id,
         row_number() over (
           partition by provider, provider_payment_id
           order by created_at, id::text
         ) as rn
  from public.payments
)
delete from public.payments
 where id in (select id from ranked where rn > 1);

-- 3. Create the unique index.
create unique index if not exists idx_payments_provider_event
  on public.payments (provider, provider_payment_id);
