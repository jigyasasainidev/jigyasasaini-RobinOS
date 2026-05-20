
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz DEFAULT NULL;

-- Backfill existing paid users: set expiry based on their last successful payment
UPDATE public.profiles p
SET subscription_expires_at = (
  SELECT 
    CASE 
      WHEN pay.billing_cycle = 'yearly' THEN pay.created_at + interval '1 year'
      ELSE pay.created_at + interval '1 month'
    END
  FROM public.payments pay
  WHERE pay.user_id = p.user_id AND pay.status = 'paid'
  ORDER BY pay.created_at DESC
  LIMIT 1
)
WHERE p.subscription_tier IS NOT NULL 
  AND p.subscription_tier != 'free'
  AND p.subscription_expires_at IS NULL;
