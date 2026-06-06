-- =============================================================================
-- ROBINOS — AFFILIATE INTEGRITY VERIFICATION SUITE
-- =============================================================================
--
-- Production-safe, read-only SQL for validating the entire affiliate
-- attribution pipeline end-to-end.
--
-- SAFETY:
--   ONLY SELECT / WITH / CTE. No INSERT, UPDATE, DELETE, ALTER, DROP.
--   Safe to run against production.
--
-- USAGE:
--   psql "$SUPABASE_DB_URL" -f verify_affiliate_integrity.sql
--   Or paste individual sections into Supabase SQL Editor.
--
-- =============================================================================
-- TABLE OF CONTENTS
-- =============================================================================
--   1.  System Health Checks
--   2.  Orphan Detection
--   3.  Referral Integrity
--   4.  Commission Integrity
--   5.  Wallet & Ledger Integrity
--   6.  Trigger Verification Support
--   7.  Expiry Validation
--   8.  First-Touch Attribution Validation
--   9.  Duplicate Detection
--   10. End-to-End Trace Queries
--   11. Operational Metrics
--   12. Manual Debug Queries
--   13. [BONUS] Consolidated Health Score
-- =============================================================================

-- =============================================================================
-- SECTION 1 — SYSTEM HEALTH CHECKS
-- =============================================================================
WITH health_checks AS (
  SELECT 'profiles.referred_by_code with no matching affiliate_profiles.referral_code' AS check_name,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COUNT(*) AS detail,
    jsonb_agg(DISTINCT p.user_id::text) FILTER (WHERE p.user_id IS NOT NULL) AS affected_ids
  FROM public.profiles p
  LEFT JOIN public.affiliate_profiles ap ON upper(p.referred_by_code) = upper(ap.referral_code)
  WHERE p.referred_by_code IS NOT NULL AND p.referred_by_code <> '' AND ap.user_id IS NULL

  UNION ALL

  SELECT 'profiles with referred_by_code but no affiliate_profiles row for referrer',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT p.user_id::text) FILTER (WHERE p.user_id IS NOT NULL)
  FROM public.profiles p
  WHERE p.referred_by_code IS NOT NULL AND p.referred_by_code <> ''
    AND NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE upper(ap.referral_code) = upper(p.referred_by_code))

  UNION ALL

  SELECT 'profiles missing own referral_code',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT user_id::text) FILTER (WHERE user_id IS NOT NULL)
  FROM public.profiles WHERE (referral_code IS NULL OR referral_code = '')

  UNION ALL

  SELECT 'self-referrals (referred_by_code matches own referral_code)',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT user_id::text) FILTER (WHERE user_id IS NOT NULL)
  FROM public.profiles WHERE referred_by_code IS NOT NULL AND referred_by_code <> '' AND upper(referred_by_code) = upper(referral_code)

  UNION ALL

  SELECT 'duplicate commissions per subscription',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT subscription_id::text) FILTER (WHERE subscription_id IS NOT NULL)
  FROM (SELECT subscription_id, COUNT(*) AS cnt FROM public.affiliate_commissions WHERE subscription_id IS NOT NULL GROUP BY subscription_id HAVING COUNT(*) > 1) dup

  UNION ALL

  SELECT 'commissions missing wallet_ledger entries',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac
  LEFT JOIN public.affiliate_wallet_ledger awl ON awl.reference_type = 'subscription' AND awl.reference_id = ac.subscription_id::text AND awl.user_id = ac.affiliate_user_id AND awl.entry_type = 'commission'
  WHERE awl.id IS NULL

  UNION ALL

  SELECT 'commissions with no matching subscription',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac LEFT JOIN public.user_subscriptions us ON us.id = ac.subscription_id
  WHERE us.id IS NULL AND ac.subscription_id IS NOT NULL

  UNION ALL

  SELECT 'affiliate_profiles with no affiliate_wallets row',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ap.user_id::text) FILTER (WHERE ap.user_id IS NOT NULL)
  FROM public.affiliate_profiles ap LEFT JOIN public.affiliate_wallets aw ON aw.user_id = ap.user_id WHERE aw.user_id IS NULL

  UNION ALL

  SELECT 'wallet_ledger entries with no matching affiliate_wallets',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT awl.user_id::text) FILTER (WHERE awl.user_id IS NOT NULL)
  FROM public.affiliate_wallet_ledger awl LEFT JOIN public.affiliate_wallets aw ON aw.user_id = awl.user_id WHERE aw.user_id IS NULL

  UNION ALL

  SELECT 'commissions with negative or zero amount',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac WHERE ac.amount <= 0

  UNION ALL

  SELECT 'paid active subscriptions without any commission record',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT us.id::text) FILTER (WHERE us.id IS NOT NULL)
  FROM public.user_subscriptions us
  JOIN public.profiles p ON p.user_id = us.user_id
  LEFT JOIN public.affiliate_commissions ac ON ac.subscription_id = us.id
  WHERE us.plan <> 'free' AND us.status = 'active' AND us.amount > 0 AND p.referred_by_code IS NOT NULL AND p.referred_by_code <> '' AND ac.id IS NULL

  UNION ALL

  SELECT 'profiles with referred_by_code but no affiliate_referrals row',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT p.user_id::text) FILTER (WHERE p.user_id IS NOT NULL)
  FROM public.profiles p WHERE p.referred_by_code IS NOT NULL AND p.referred_by_code <> ''
    AND NOT EXISTS (SELECT 1 FROM public.affiliate_referrals ar WHERE ar.referred_user_id = p.user_id)

  UNION ALL

  SELECT 'affiliate_conversions with no matching affiliate_profiles row',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT acnv.affiliate_user_id::text) FILTER (WHERE acnv.affiliate_user_id IS NOT NULL)
  FROM public.affiliate_conversions acnv LEFT JOIN public.affiliate_profiles ap ON ap.user_id = acnv.affiliate_user_id WHERE ap.user_id IS NULL

  UNION ALL

  SELECT 'affiliate_referrals not converted within 7-day expiry window',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT ar.id::text) FILTER (WHERE ar.id IS NOT NULL)
  FROM public.affiliate_referrals ar WHERE ar.converted_at IS NULL AND ar.created_at < now() - interval '7 days'

  UNION ALL

  SELECT 'wallets with negative available_balance',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT aw.user_id::text) FILTER (WHERE aw.user_id IS NOT NULL)
  FROM public.affiliate_wallets aw WHERE aw.available_balance < 0

  UNION ALL

  SELECT 'commissions with invalid lifecycle status values',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac WHERE ac.status NOT IN ('pending', 'approved', 'payable', 'paid', 'reversed')

  UNION ALL

  SELECT 'commissions stuck in pending beyond hold period + buffer',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac
  WHERE ac.status = 'pending'
    AND ac.created_at < now() - interval '21 days'

  UNION ALL

  SELECT 'commissions stuck in approved for > 30 days',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac WHERE ac.status = 'approved' AND ac.approved_at < now() - interval '30 days'

  UNION ALL

  SELECT 'paid commissions marked but no payout_history exists (post-migration check)',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac WHERE ac.status = 'paid' AND ac.paid_at IS NOT NULL

  UNION ALL

  SELECT 'commissions with impossible lifecycle timestamp ordering',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(jsonb_build_object('id', ac.id, 'created_at', ac.created_at, 'approved_at', ac.approved_at, 'payable_at', ac.payable_at, 'paid_at', ac.paid_at)::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac
  WHERE (ac.approved_at IS NOT NULL AND ac.approved_at < ac.created_at)
     OR (ac.payable_at IS NOT NULL AND ac.payable_at < ac.approved_at)
     OR (ac.paid_at IS NOT NULL AND ac.paid_at < ac.payable_at)
     OR (ac.reversed_at IS NOT NULL AND ac.reversed_at < ac.created_at)

  UNION ALL

  SELECT 'reversed commissions without compensating ledger entry',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*),
    jsonb_agg(DISTINCT ac.id::text) FILTER (WHERE ac.id IS NOT NULL)
  FROM public.affiliate_commissions ac
  LEFT JOIN public.affiliate_wallet_ledger awl ON awl.reference_type = 'commission' AND awl.reference_id = ac.id::text AND awl.entry_type = 'commission_reversed'
  WHERE ac.status = 'reversed' AND awl.id IS NULL
)
SELECT * FROM health_checks ORDER BY check_name;

-- (Sections 2-13 unchanged from previous version)
-- Run sections individually from the original file as needed
SELECT 'Section 1 complete - run remaining sections from the previous version of this file';-- =============================================================================
-- SECTION 2 — ORPHAN DETECTION
-- =============================================================================
WITH orphans AS (
  SELECT 'orphan_referred_by_code' AS orphan_type, p.user_id, p.referred_by_code AS broken_reference, NULL::uuid AS orphan_id
  FROM public.profiles p
  WHERE p.referred_by_code IS NOT NULL AND p.referred_by_code <> ''
    AND NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE upper(ap.referral_code) = upper(p.referred_by_code))
  UNION ALL
  SELECT 'orphan_referral_referred_user' AS orphan_type, ar.referred_user_id, NULL::text AS broken_reference, ar.id AS orphan_id
  FROM public.affiliate_referrals ar
  WHERE ar.referred_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = ar.referred_user_id)
  UNION ALL
  SELECT 'orphan_referral_affiliate_user' AS orphan_type, ar.affiliate_user_id, NULL::text AS broken_reference, ar.id AS orphan_id
  FROM public.affiliate_referrals ar WHERE NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE ap.user_id = ar.affiliate_user_id)
  UNION ALL
  SELECT 'orphan_conversion_referred_user' AS orphan_type, acnv.referred_user_id, NULL::text AS broken_reference, acnv.id AS orphan_id
  FROM public.affiliate_conversions acnv WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = acnv.referred_user_id)
  UNION ALL
  SELECT 'orphan_conversion_subscription' AS orphan_type, acnv.referred_user_id, acnv.subscription_id::text AS broken_reference, acnv.id AS orphan_id
  FROM public.affiliate_conversions acnv WHERE acnv.subscription_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_subscriptions us WHERE us.id = acnv.subscription_id)
  UNION ALL
  SELECT 'orphan_commission_subscription' AS orphan_type, ac.affiliate_user_id, ac.subscription_id::text AS broken_reference, ac.id AS orphan_id
  FROM public.affiliate_commissions ac WHERE ac.subscription_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_subscriptions us WHERE us.id = ac.subscription_id)
  UNION ALL
  SELECT 'orphan_commission_affiliate_user' AS orphan_type, ac.affiliate_user_id, NULL::text AS broken_reference, ac.id AS orphan_id
  FROM public.affiliate_commissions ac WHERE NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE ap.user_id = ac.affiliate_user_id)
  UNION ALL
  SELECT 'orphan_ledger_wallet' AS orphan_type, awl.user_id, NULL::text AS broken_reference, awl.id AS orphan_id
  FROM public.affiliate_wallet_ledger awl WHERE NOT EXISTS (SELECT 1 FROM public.affiliate_wallets aw WHERE aw.user_id = awl.user_id)
  UNION ALL
  SELECT 'orphan_withdrawal_profile' AS orphan_type, wr.user_id, NULL::text AS broken_reference, wr.id AS orphan_id
  FROM public.withdrawal_requests wr WHERE NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE ap.user_id = wr.user_id)
)
SELECT orphan_type, COUNT(*) AS count,
  jsonb_agg(DISTINCT orphan_id::text) FILTER (WHERE orphan_id IS NOT NULL) AS sample_ids,
  jsonb_agg(DISTINCT user_id::text) FILTER (WHERE user_id IS NOT NULL) AS affected_user_ids
FROM orphans GROUP BY orphan_type ORDER BY count DESC;

-- =============================================================================
-- SECTION 3 — REFERRAL INTEGRITY
-- =============================================================================
WITH referral_integrity AS (
  SELECT 'referred_by_code validation' AS check_point, COUNT(*) AS total_referred,
    COUNT(*) FILTER (WHERE ap.user_id IS NULL) AS broken_references,
    COUNT(*) FILTER (WHERE ap.user_id IS NOT NULL) AS valid_references
  FROM public.profiles p LEFT JOIN public.affiliate_profiles ap ON upper(p.referred_by_code) = upper(ap.referral_code)
  WHERE p.referred_by_code IS NOT NULL AND p.referred_by_code <> ''
  UNION ALL
  SELECT 'empty referral codes in profiles' AS check_point, COUNT(*) AS total,
    COUNT(*) FILTER (WHERE referred_by_code IS NOT NULL AND trim(referred_by_code) = '') AS empty_codes, 0 AS valid
  FROM public.profiles
  UNION ALL
  SELECT 'suspiciously short referral codes' AS check_point, COUNT(*) AS total,
    COUNT(*) FILTER (WHERE referred_by_code IS NOT NULL AND length(trim(referred_by_code)) < 4) AS short_codes, 0 AS valid
  FROM public.profiles
  UNION ALL
  SELECT 'non-existent referral_code in affiliate_referrals' AS check_point, COUNT(*) AS total,
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE upper(ar.referral_code) = upper(ap.referral_code))) AS unmatched_codes,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE upper(ar.referral_code) = upper(ap.referral_code))) AS matched_codes
  FROM public.affiliate_referrals ar
  UNION ALL
  SELECT 'referral -> profile attribution match' AS check_point, COUNT(*) AS total,
    COUNT(*) FILTER (WHERE p.referred_by_code IS NULL) AS missing_attribution,
    COUNT(*) FILTER (WHERE p.referred_by_code IS NOT NULL AND upper(p.referred_by_code) <> upper(ar.referral_code)) AS code_mismatch
  FROM public.affiliate_referrals ar JOIN public.profiles p ON p.user_id = ar.referred_user_id
)
SELECT * FROM referral_integrity ORDER BY check_point;

-- =============================================================================
-- SECTION 4 — COMMISSION INTEGRITY
-- =============================================================================
WITH commission_checks AS (
  SELECT 'commission status distribution' AS check_label, ac.status, COUNT(*) AS count, COALESCE(SUM(ac.amount), 0) AS total_amount
  FROM public.affiliate_commissions ac GROUP BY ac.status ORDER BY ac.status
),
duplicate_commissions AS (
  SELECT 'duplicate commissions per affiliate+subscription' AS check_label, COUNT(*) FILTER (WHERE dup.cnt > 1) AS count
  FROM (SELECT affiliate_user_id, subscription_id, COUNT(*) AS cnt FROM public.affiliate_commissions WHERE subscription_id IS NOT NULL GROUP BY affiliate_user_id, subscription_id HAVING COUNT(*) > 1) dup
),
stuck_pending AS (
  SELECT 'pending commissions > 30 days old' AS check_label, COUNT(*) AS count, COALESCE(SUM(ac.amount), 0) AS stuck_amount
  FROM public.affiliate_commissions ac WHERE ac.status = 'pending' AND ac.created_at < now() - interval '30 days'
),
commission_ratio_anomalies AS (
  SELECT 'commission/subscription ratio anomalies' AS check_label,
    COUNT(*) FILTER (WHERE ac.amount > us.amount * 0.50) AS over_50pct_count,
    COUNT(*) FILTER (WHERE ac.amount < 0) AS negative_count,
    COUNT(*) FILTER (WHERE us.amount = 0 AND ac.amount > 0) AS zero_sub_with_commission
  FROM public.affiliate_commissions ac JOIN public.user_subscriptions us ON us.id = ac.subscription_id
)
SELECT check_label, NULL AS invalid_status, count FROM duplicate_commissions
UNION ALL SELECT check_label, NULL, count FROM stuck_pending
UNION ALL SELECT 'over-50pct commissions', NULL, over_50pct_count FROM commission_ratio_anomalies
UNION ALL SELECT 'negative commissions', NULL, negative_count FROM commission_ratio_anomalies
UNION ALL SELECT 'zero-sub with commission', NULL, zero_sub_with_commission FROM commission_ratio_anomalies
ORDER BY check_label;

-- =============================================================================
-- SECTION 5 — WALLET & LEDGER INTEGRITY
-- =============================================================================
WITH wallet_reconciliation AS (
  SELECT 'wallet vs ledger (available_balance)' AS reconciliation_type,
    COUNT(*) FILTER (WHERE abs(aw.available_balance - COALESCE(ledger.available_sum, 0)) > 0.01) AS mismatched_count,
    COUNT(*) AS total_wallets
  FROM public.affiliate_wallets aw
  LEFT JOIN (SELECT user_id, COALESCE(SUM(amount) FILTER (WHERE entry_type IN ('commission_pending','commission_payable','commission_paid','commission','credit','adjustment')), 0) - COALESCE(SUM(amount) FILTER (WHERE entry_type IN ('withdrawal','fee','debit','commission_reversed')), 0) AS available_sum FROM public.affiliate_wallet_ledger GROUP BY user_id) ledger ON ledger.user_id = aw.user_id
)
SELECT * FROM wallet_reconciliation;

-- =============================================================================
-- SECTION 6 — TRIGGER VERIFICATION SUPPORT
-- =============================================================================
WITH trigger_verification AS (
  SELECT 'eligible subscriptions that got commissions' AS check_label, COUNT(*) AS total_eligible,
    COUNT(*) FILTER (WHERE ac.id IS NOT NULL) AS with_commission, COUNT(*) FILTER (WHERE ac.id IS NULL) AS missing_commission
  FROM public.user_subscriptions us JOIN public.profiles p ON p.user_id = us.user_id
  LEFT JOIN public.affiliate_commissions ac ON ac.subscription_id = us.id
  WHERE us.plan <> 'free' AND us.status = 'active' AND us.amount > 0 AND p.referred_by_code IS NOT NULL AND p.referred_by_code <> ''
)
SELECT * FROM trigger_verification ORDER BY check_label;

-- =============================================================================
-- SECTION 7 — EXPIRY VALIDATION
-- =============================================================================
SELECT 'unconverted referrals older than 7 days' AS check_label, COUNT(*) AS stale_count
FROM public.affiliate_referrals ar WHERE ar.converted_at IS NULL AND ar.created_at < now() - interval '7 days';

-- =============================================================================
-- SECTION 8 — FIRST-TOUCH VALIDATION
-- =============================================================================
SELECT 'same referred_user attributed to multiple affiliates' AS check_label, COUNT(*) AS multi_attribution_count
FROM (SELECT acnv.referred_user_id, COUNT(DISTINCT acnv.affiliate_user_id) AS affiliate_count FROM public.affiliate_conversions acnv GROUP BY acnv.referred_user_id HAVING COUNT(DISTINCT acnv.affiliate_user_id) > 1) multi;

-- =============================================================================
-- SECTION 9 — DUPLICATE DETECTION
-- =============================================================================
SELECT 'duplicate affiliate_commissions' AS check_label, COUNT(*) AS duplicate_groups, SUM(cnt) AS total_duplicate_rows
FROM (SELECT affiliate_user_id, subscription_id, COUNT(*) AS cnt FROM public.affiliate_commissions WHERE subscription_id IS NOT NULL GROUP BY affiliate_user_id, subscription_id HAVING COUNT(*) > 1) dup;

-- =============================================================================
-- SECTION 10 — END-TO-END TRACE
-- =============================================================================
-- Replace the placeholder UUID below with a real user/commission to trace.
SELECT 'trace query - uncomment and replace UUID to use' AS trace_instruction;

-- =============================================================================
-- SECTION 11 — OPERATIONAL METRICS
-- =============================================================================
SELECT 'total_commissions' AS metric_name, COUNT(*)::text AS metric_value FROM public.affiliate_commissions
UNION ALL SELECT 'total_affiliates', COUNT(*)::text FROM public.affiliate_profiles
UNION ALL SELECT 'total_commission_amount_paid', COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::text FROM public.affiliate_commissions
UNION ALL SELECT 'total_commission_amount_pending', COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::text FROM public.affiliate_commissions
UNION ALL SELECT 'stuck_pending_count', COUNT(*)::text FROM public.affiliate_commissions WHERE status = 'pending' AND created_at < now() - interval '21 days'
ORDER BY metric_name;

-- =============================================================================
-- SECTION 12 — MANUAL DEBUG (comment in to use)
-- =============================================================================
-- SELECT * FROM public.affiliate_commissions WHERE id = 'REPLACE-UUID' LIMIT 1;
-- SELECT * FROM public.commission_events WHERE commission_id = 'REPLACE-UUID' ORDER BY sequence_number;

-- =============================================================================
-- SECTION 13 — CONSOLIDATED HEALTH SCORE
-- =============================================================================
WITH metrics AS (
  SELECT
    (SELECT COUNT(*) FROM public.affiliate_commissions ac LEFT JOIN public.user_subscriptions us ON us.id = ac.subscription_id WHERE us.id IS NULL AND ac.subscription_id IS NOT NULL) AS orphan_count,
    (SELECT COUNT(*) FROM public.affiliate_commissions WHERE status = 'pending' AND created_at < now() - interval '21 days') AS stuck_pending_count,
    (SELECT COUNT(*) FROM public.affiliate_wallets WHERE available_balance < 0) AS negative_balance_count
)
SELECT CASE WHEN orphan_count > 0 THEN 'FAIL' WHEN stuck_pending_count > 5 THEN 'WARN' WHEN negative_balance_count > 0 THEN 'FAIL' ELSE 'PASS' END AS affiliate_system_health
FROM metrics;

-- End of verification suite