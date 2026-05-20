DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE public.subscriptions
      DROP COLUMN IF EXISTS stripe_customer_id,
      DROP COLUMN IF EXISTS stripe_subscription_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments
      ALTER COLUMN payment_provider SET DEFAULT 'internal';

    UPDATE public.payments
    SET payment_provider = 'internal'
    WHERE lower(coalesce(payment_provider, '')) = 'stripe';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
  ) THEN
    ALTER TABLE public.user_subscriptions
      ALTER COLUMN provider SET DEFAULT 'internal';

    UPDATE public.user_subscriptions
    SET provider = 'internal'
    WHERE lower(coalesce(provider, '')) = 'stripe';
  END IF;
END $$;