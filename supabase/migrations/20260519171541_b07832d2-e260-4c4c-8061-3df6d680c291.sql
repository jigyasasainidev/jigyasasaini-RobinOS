ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_provider text DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS invoice_url text;

ALTER TABLE public.affiliate_profiles
  ADD COLUMN IF NOT EXISTS total_clicks integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_conversions integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earned numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_balance numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_balance numeric DEFAULT 0;