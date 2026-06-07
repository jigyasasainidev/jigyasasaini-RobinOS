# Production Cleanup Audit — Whop Test Data

## Test History

Three test activations were performed against the deployed `whop-webhook` edge function. All three used the same user:

| # | Membership ID | Triggered Handler? | Created DB Rows? |
|---|---|---|---|
| 1 | `mem_test_2c_001` | ❌ No (`payload.type` bug) | ❌ None |
| 2 | `mem_test_version` | ✅ Yes (used `"event"` key) | ✅ Yes |
| 3 | `mem_test_phase2c` | ✅ Yes (used `"event"` key) | ✅ Yes |
| 4 | `mem_test_fix_001` | ✅ Yes (post-fix, used `"type"` key) | ✅ Yes |

**User ID:** `b787ba21-8443-4e2e-9dbd-bc2bc7adf989`

**Referral Code:** `EA1DE55D` (used in tests #3 and #4)

---

## Affected Tables

| # | Table | How Test Affected It | Action Required |
|---|---|---|---|
| 1 | `user_subscriptions` | `safe_plan_switch` **upserted** 3 test subscription rows (provider = 'whop') | **DELETE** test rows |
| 2 | `profiles` | `safe_plan_switch` **updated** `subscription_tier`, `current_plan`, `subscription_expires_at` | **REVERT** to 'free' |
| 3 | `subscription_audit_log` | `log_subscription_event` **inserted** 3 audit rows (event_type = 'plan_switch') | **DELETE** test rows |
| 4 | `affiliate_commissions` | `recordAffiliateCommission` **inserted** commissions (only if EA1DE55D exists) | **DELETE** test rows |
| 5 | `affiliate_profiles` | `increment_affiliate_balance` **incremented** locked_balance + total_earned (only if commission existed) | **DECREMENT** balances |
| 6 | `admin_notifications` | `push_admin_notification` may have inserted admin alerts (only if commission existed) | **DELETE** test rows |

**Tables NOT affected:**
- `auth.users` — never touched
- `platform_settings` — read-only
- `plan_entitlements` — read-only
- `affiliate_referrals` — not created by commission logic
- `affiliate_clicks` — not created
- `affiliate_conversions` — not created
- `subscription_webhook_events` — `record_webhook_event` NOT called by whop-webhook yet
- `payments`, `invoices`, `payment_events` — not touched (no Dodo/payment flow triggered)
- `usage_tracking`, `feature_usage` — not touched

---

## Phase 1 — Count Test Rows (Run These First)

Run each query in Supabase Dashboard → SQL Editor. **Do not delete anything yet.**

### 1.1 Count Test Subscriptions

```sql
SELECT 
  COUNT(*) as test_subscription_count,
  STRING_AGG(provider_subscription_id, ', ') as membership_ids
FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND provider = 'whop'
  AND provider_subscription_id LIKE 'mem_test%';
```

**Expected:** 0–3 rows. Each test activation created one.

### 1.2 Count Test Audit Logs

```sql
SELECT 
  COUNT(*) as test_audit_count,
  STRING_AGG(DISTINCT event_type, ', ') as event_types
FROM subscription_audit_log
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND triggered_by = 'webhook'
  AND metadata::text LIKE '%mem_test%';
```

**Expected:** 0–3 rows.

### 1.3 Count Test Commissions

```sql
SELECT 
  COUNT(*) as test_commission_count,
  COALESCE(SUM(amount), 0) as total_amount
FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND dodo_subscription_id LIKE 'mem_test%';
```

**Expected:** 0 or 1–3 rows (only if EA1DE55D existed in affiliate_profiles).

### 1.4 Check Affiliate Balance Impact

```sql
SELECT 
  user_id, referral_code,
  locked_balance, total_earned,
  pending_balance, paid_balance
FROM affiliate_profiles
WHERE referral_code = 'EA1DE55D';
```

**Expected:** If commissions were created, `locked_balance` and `total_earned` may be > 0. If 0 rows in 1.3, these should be unchanged.

### 1.5 Check Admin Notifications

```sql
SELECT 
  COUNT(*) as test_notification_count
FROM admin_notifications  -- or admin_notifications_logs
WHERE type = 'affiliate'
  AND metadata::text LIKE '%mem_test%';
```

**Note:** Table name may vary depending on exact schema. Check migration 37 for correct table name.

### 1.6 Check Profile State

```sql
SELECT 
  user_id, subscription_tier, current_plan, subscription_expires_at
FROM profiles
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```

**Expected:** If test ran, tier may = 'creator' instead of original. If never ran, should still be 'free'.

---

## Phase 2 — Exact Cleanup SQL (Run After Approval)

### 2.1 Delete Test Subscriptions

```sql
DELETE FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND provider = 'whop'
  AND provider_subscription_id LIKE 'mem_test%';
```

### 2.2 Revert Profile Tier

```sql
UPDATE profiles
SET 
  subscription_tier = 'free',
  current_plan = 'free',
  subscription_expires_at = NULL,
  updated_at = now() AT TIME ZONE 'UTC'
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND subscription_tier = 'creator'
  AND provider_subscription_id LIKE 'mem_test%';
```

Wait - `profiles` doesn't have `provider_subscription_id`. Use this instead:

```sql
UPDATE profiles
SET 
  subscription_tier = 'free',
  current_plan = 'free',
  subscription_expires_at = NULL,
  updated_at = now() AT TIME ZONE 'UTC'
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND subscription_tier = 'creator';
```

⚠️ **Warning:** This reverts the profile to 'free'. Only run if you are certain this user was on 'free' before testing.

### 2.3 Delete Test Audit Logs

```sql
DELETE FROM subscription_audit_log
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND triggered_by = 'webhook'
  AND metadata::text LIKE '%mem_test%';
```

### 2.4 Delete Test Commissions

```sql
DELETE FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND dodo_subscription_id LIKE 'mem_test%';
```

### 2.5 Revert Affiliate Balance

Run this **only if** Phase 1.3 returned > 0 commissions AND Phase 1.4 shows inflated balances:

```sql
UPDATE affiliate_profiles
SET 
  locked_balance = greatest(coalesce(locked_balance, 0) - 5.70 * (
    SELECT COUNT(*) FROM affiliate_commissions 
    WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
      AND dodo_subscription_id LIKE 'mem_test%'
  ), 0),
  total_earned = greatest(coalesce(total_earned, 0) - 5.70 * (
    SELECT COUNT(*) FROM affiliate_commissions 
    WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
      AND dodo_subscription_id LIKE 'mem_test%'
  ), 0),
  updated_at = now() AT TIME ZONE 'UTC'
WHERE referral_code = 'EA1DE55D';
```

### 2.6 Delete Test Admin Notifications

```sql
DELETE FROM admin_notifications
WHERE type = 'affiliate'
  AND metadata::text LIKE '%mem_test%';
```

---

## Phase 3 — Final Verification (After Cleanup)

### 3.1 Confirm Subscriptions Clean

```sql
SELECT COUNT(*) as remaining_test_subs
FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND provider = 'whop'
  AND provider_subscription_id LIKE 'mem_test%';
```
**Expected:** `0`

### 3.2 Confirm Audit Logs Clean

```sql
SELECT COUNT(*) as remaining_test_audits
FROM subscription_audit_log
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND triggered_by = 'webhook'
  AND metadata::text LIKE '%mem_test%';
```
**Expected:** `0`

### 3.3 Confirm Commissions Clean

```sql
SELECT COUNT(*) as remaining_test_commissions
FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND dodo_subscription_id LIKE 'mem_test%';
```
**Expected:** `0`

### 3.4 Confirm Profile State

```sql
SELECT subscription_tier, current_plan
FROM profiles
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
**Expected:** If original was free → `'free'`, `'free'`.

---

## Summary

| Step | Action | Condition |
|---|---|---|
| Phase 1 | Run COUNT queries | **Before any cleanup** |
| Phase 2.1 | Delete `user_subscriptions` test rows | If Phase 1.1 > 0 |
| Phase 2.2 | Revert `profiles` tier | If profile was on 'free' before test |
| Phase 2.3 | Delete `subscription_audit_log` test rows | If Phase 1.2 > 0 |
| Phase 2.4 | Delete `affiliate_commissions` test rows | If Phase 1.3 > 0 |
| Phase 2.5 | Revert `affiliate_profiles` balance | If Phase 1.3 > 0 AND Phase 1.4 shows inflated |
| Phase 2.6 | Delete `admin_notifications` test rows | If Phase 1.5 > 0 |
| Phase 3 | Run final COUNT queries | **After cleanup** |

**Data preserved:**
- ✅ `profiles` (everything except test subscription tier)
- ✅ `affiliate_profiles` (referral code, structure, non-test balances)
- ✅ `auth.users`
- ✅ `platform_settings`
- ✅ `plan_entitlements`
- ✅ All Dodo configuration
- ✅ All Whop configuration
- ✅ All subscription/commission schema structure

---

## Approval Required

**Do not run cleanup until approved.**

Please:
1. Run Phase 1 COUNT queries
2. Paste results here
3. Confirm next steps
