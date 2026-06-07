-- ══════════════════════════════════════════════════
-- PRODUCTION TEST DATA CLEANUP — RobinOS
-- Run in Supabase Dashboard → SQL Editor or psql
-- ══════════════════════════════════════════════════

-- Step 0: Verify before deleting (run these first, DO NOT delete yet)
SELECT '1-TEST-SUBSCRIPTIONS' as check_name, id, plan, amount, provider, provider_subscription_id
FROM user_subscriptions
WHERE id IN (
  'cc41f91d-a599-4db8-8e72-201d67823cae',  -- test: whop w/ empty sub ID → $19
  '68a6e0be-74b7-4b27-acde-5d07cf8c2cd3',  -- test: free tier, no auth user
  '3478df9f-c435-4c8f-aaeb-b127e407adc4'   -- test: free tier, matched history
);

SELECT '2-TEST-COMMISSIONS' as check_name, id, amount, status, dodo_subscription_id, subscription_id
FROM affiliate_commissions
WHERE subscription_id IN ('cc41f91d-a599-4db8-8e72-201d67823cae')
   OR referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';

SELECT '3-TEST-COMMISSION-EVENTS' as check_name, id, commission_id, event_type
FROM commission_events
WHERE commission_id IN (
  SELECT id FROM affiliate_commissions
  WHERE subscription_id = 'cc41f91d-a599-4db8-8e72-201d67823cae'
     OR referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
);

-- Step 1: Remove dependent commission events first (avoid FK blocks if any)
DELETE FROM commission_events
WHERE commission_id IN (
  SELECT id FROM affiliate_commissions
  WHERE subscription_id = 'cc41f91d-a599-4db8-8e72-201d67823cae'
     OR referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
);

-- Step 2: Remove test commissions
DELETE FROM affiliate_commissions
WHERE subscription_id = 'cc41f91d-a599-4db8-8e72-201d67823cae'
   OR referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';

-- Step 3: Remove test subscriptions
DELETE FROM user_subscriptions
WHERE id IN (
  'cc41f91d-a599-4db8-8e72-201d67823cae',  -- test: whop w/ empty sub ID → $19
  '68a6e0be-74b7-4b27-acde-5d07cf8c2cd3',  -- test: free tier, no auth user
  '3478df9f-c435-4c8f-aaeb-b127e407adc4'   -- test: free tier, matched history
);

-- Step 4: Verify after cleanup
SELECT 'REMAINING-SUBSCRIPTIONS' as check_name, count(*) FROM user_subscriptions;
SELECT 'REMAINING-COMMISSIONS' as check_name, count(*) FROM affiliate_commissions;
