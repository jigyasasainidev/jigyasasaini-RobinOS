-- Fix Postgres error 42883 — function digest(text, unknown) does not exist
-- Root cause: pgcrypto is installed in the `extensions` schema, but affected
-- RPCs were created with `set search_path = public`, so `digest()` is not
-- resolved at runtime.
--
-- This migration:
-- 1. Ensures pgcrypto is enabled (idempotent no-op if already present).
-- 2. Adds `extensions` to the search_path of every function that calls digest().
--
-- No business logic, payload parsing, or webhook behavior is changed.

create extension if not exists pgcrypto;

alter function public.enqueue_webhook_event set search_path = public, extensions;
alter function public.process_webhook_event set search_path = public, extensions;
alter function public.record_purchase_from_webhook set search_path = public, extensions;
alter function public.search_payments set search_path = public, extensions;
alter function public.search_webhook_events set search_path = public, extensions;
alter function public.set_payments_buyer_hash set search_path = public, extensions;
