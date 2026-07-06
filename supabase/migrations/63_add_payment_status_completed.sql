-- ============================================================
-- M63 — Add 'completed' value to payment_status enum
-- ============================================================
--
-- Context:
--   record_purchase_from_webhook (M58) sets payment status to
--   'completed' for purchase.created / subscription.created /
--   subscription.renewed events, but the public.payment_status enum
--   defined in 01_master_backend_architecture.sql only contains
--   ('pending','succeeded','failed','refunded','canceled').
--
--   This mismatch caused every successful SALE pipeline to fail at
--   the payments INSERT with:
--     invalid input value for enum payment_status: "completed"
--
-- Fix:
--   Add the missing 'completed' enum value. This preserves the
--   existing business logic (M6 expects 'completed' for successful
--   purchases) and does not redesign the system.
--
-- Safety:
--   ALTER TYPE ... ADD VALUE is safe when no existing rows already
--   reference the new value. At the time of this migration, the
--   pipeline was failing before any 'completed' row could be
--   inserted, so the change is non-destructive.
-- ============================================================

-- Ensure the enum value exists (idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'public.payment_status'::regtype
      and enumlabel = 'completed'
  ) then
    alter type public.payment_status add value 'completed';
  end if;
end
$$;
