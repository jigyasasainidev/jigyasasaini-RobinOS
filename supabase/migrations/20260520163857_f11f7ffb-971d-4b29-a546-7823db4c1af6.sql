-- Remove legacy provider-specific billing artifacts (safe no-op if already absent)
DROP TABLE IF EXISTS public.subscription_audit_logs;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.payments;

-- Remove provider-specific columns from any remaining legacy tables
ALTER TABLE IF EXISTS public.user_subscriptions
  DROP COLUMN IF EXISTS paddle_customer_id,
  DROP COLUMN IF EXISTS paddle_subscription_id,
  DROP COLUMN IF EXISTS provider_customer_id,
  DROP COLUMN IF EXISTS provider_subscription_id;

-- Remove obsolete provider-specific webhook/checkout functions if present
DROP FUNCTION IF EXISTS public.process_paddle_webhook(jsonb);
DROP FUNCTION IF EXISTS public.create_paddle_checkout(uuid, text, text);
DROP FUNCTION IF EXISTS public.verify_paddle_signature(text, text, text);
DROP FUNCTION IF EXISTS public.sync_paddle_subscription(text);
