# Phase 2C — Safe Test Plan (No Real Payment)

## Objective
Test Whop webhook activation + affiliate commission creation + balance update without modifying production data permanently.

## Test User
- UUID: `b787ba21-8443-4e2e-9dbd-bc2bc7adf989`
- You must find an existing referral code from `affiliate_profiles` table.

## Test Method
Supabase Dashboard → Edge Functions → Invoke `whop-webhook` with test payload.

## Cleanup
All test data deleted after verification. Original state restored.

---

## PHASE 1 — Pre-Test State Capture

Go to Supabase Dashboard → SQL Editor. Run these queries one by one.

### 1.1 Find Existing Referral Code
```sql
SELECT user_id, referral_code, display_name
FROM profiles
WHERE referral_code IS NOT NULL
LIMIT 5;
```
**Pick one referral_code** from the output. Note it down. Example: `ASHAD123`

### 1.2 Capture Pre-Test State
```sql
-- user_id: b787ba21-8443-4e2e-9dbd-bc2bc7adf989
SELECT 
  'user_subscriptions' as table_name,
  user_id, plan, status, provider, provider_subscription_id,
  subscription_source, amount, auto_renew
FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
```sql
SELECT 
  'profiles' as table_name,
  user_id, subscription_tier, current_plan, subscription_expires_at
FROM profiles
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
```sql
SELECT 
  'affiliate_commissions' as table_name,
  id, affiliate_user_id, referred_user_id, dodo_subscription_id,
  amount, status, eligible_at
FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
```sql
SELECT 
  'affiliate_profiles' as table_name,
  user_id, referral_code, locked_balance, pending_balance, paid_balance,
  total_earned
FROM affiliate_profiles
WHERE referral_code = 'ASHAD123';  -- replace with actual code from step 1.1
```

Save these results as your "before" state.

---

## PHASE 2 — Edge Function Invoke Test

### 2.1 Invoke whop-webhook via Dashboard

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Click on **`whop-webhook`**
3. Click **"Invoke"** tab
4. In the **Request Body**, paste this exact JSON:

**Payload A — With metadata.referral_code (tests full flow):**
```json
{
  "id": "msg_test_2c_001",
  "api_version": "v1",
  "timestamp": "2025-06-07T12:00:00.000Z",
  "type": "membership.activated",
  "data": {
    "id": "mem_test_2c_001",
    "created_at": "2025-06-07T12:00:00.000Z",
    "joined_at": "2025-06-07T12:00:00.000Z",
    "updated_at": "2025-06-07T12:00:00.000Z",
    "manage_url": "https://whop.com/billing/manage/mem_test_2c_001",
    "member": { "id": "mber_test_2c_001" },
    "user": {
      "id": "user_test_2c_001",
      "username": "robinostest",
      "name": "Test User",
      "email": "test@tryrobin.xyz"
    },
    "renewal_period_start": "2025-06-07T12:00:00.000Z",
    "renewal_period_end": "2025-07-07T12:00:00.000Z",
    "cancel_at_period_end": false,
    "cancellation_reason": null,
    "canceled_at": null,
    "company": { "id": "biz_test_2c", "title": "RobinOS" },
    "plan": { "id": "plan_creator_monthly", "metadata": {} },
    "promo_code": null,
    "product": { "id": "prod_creator", "title": "Creator", "metadata": {} },
    "license_key": null,
    "metadata": {
      "user_id": "b787ba21-8443-4e2e-9dbd-bc2bc7adf989",
      "plan_key": "creator",
      "billing_cycle": "monthly",
      "source": "robinos_web",
      "referral_code": "ASHAD123"
    },
    "payment_collection_paused": false,
    "checkout_configuration_id": "ch_test_2c_001",
    "custom_field_responses": []
  },
  "company_id": "biz_test_2c"
}
```

**Replace `ASHAD123`** with the actual referral_code from Step 1.1.

5. Click **"Send Request"**
6. Wait for the response.

### 2.2 Expected Response
```json
{
  "success": true,
  "activated": {
    "success": true,
    "plan": "creator",
    "expires_at": "2025-07-07T...",
    "switched_at": "2025-06-07T..."
  }
}
```

### 2.3 Check Function Logs
1. Go to **Edge Functions** → `whop-webhook` → **Logs** tab
2. Look for these log lines:
   - `[whop-webhook] membership.activated metadata: user_id=b787ba21-8443-4e2e-9dbd-bc2bc7adf989 plan_key=creator billing_cycle=monthly`
   - `[whop-webhook] Plan activated: {...}`
   - `[whop-webhook] Attribution via metadata.referral_code=ASHAD123`
   - `[affiliate] Commission: affiliate=xxx referred=b787ba21-8443-4e2e-9dbd-bc2bc7adf989 amount=$19 rate=30% commission=$5.70`
   - `[affiliate] Commission recorded: $5.70 for affiliate xxx`

---

## PHASE 3 — Verification Queries

Run these in SQL Editor to verify everything worked:

### 3.1 Verify Subscription Activation
```sql
SELECT 
  user_id, plan, status, provider, provider_subscription_id,
  subscription_source, amount, auto_renew, created_at, updated_at
FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
**Expected:** `plan='creator'`, `status='active'`, `provider='whop'`, `provider_subscription_id='mem_test_2c_001'`

### 3.2 Verify Profile Update
```sql
SELECT 
  user_id, subscription_tier, current_plan, subscription_expires_at
FROM profiles
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
**Expected:** `subscription_tier='creator'`, `current_plan='creator'`, `subscription_expires_at` is ~30 days in future.

### 3.3 Verify Audit Log
```sql
SELECT 
  user_id, event_type, old_plan, new_plan, old_status, new_status,
  triggered_by, metadata
FROM subscription_audit_log
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
ORDER BY created_at DESC
LIMIT 3;
```
**Expected:** `event_type='plan_switch'`, `new_plan='creator'`, `new_status='active'`

### 3.4 Verify Commission Created
```sql
SELECT 
  id, affiliate_user_id, referred_user_id, dodo_subscription_id,
  amount, status, eligible_at, created_at
FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND dodo_subscription_id = 'mem_test_2c_001'
ORDER BY created_at DESC;
```
**Expected:** 1 row, `amount=5.70`, `status='pending'`, `eligible_at` is ~14 days in future.

### 3.5 Verify Affiliate Balance
```sql
SELECT 
  user_id, referral_code, locked_balance, pending_balance, paid_balance,
  total_earned
FROM affiliate_profiles
WHERE referral_code = 'ASHAD123';  -- replace with actual code
```
**Expected:** `locked_balance` increased by $5.70, `total_earned` increased by $5.70.

### 3.6 Verify Admin Notification
```sql
SELECT 
  type, title, message, priority, metadata
FROM admin_notifications_logs  -- or whatever table stores notifications
WHERE type = 'affiliate'
ORDER BY created_at DESC
LIMIT 3;
```
**Expected:** Row with `title='🪙 Affiliate commission generated'`, `message='$5.70 (30%) · ref ASHAD123'`.

---

## PHASE 4 — Cleanup (Restore Original State)

**Critical:** Delete ALL test data immediately after verification.

Run these queries in SQL Editor:

### 4.1 Delete Test Commission
```sql
DELETE FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND dodo_subscription_id = 'mem_test_2c_001';
```

### 4.2 Revert Affiliate Balance (decrement $5.70)
```sql
UPDATE affiliate_profiles
SET 
  locked_balance = greatest(coalesce(locked_balance, 0) - 5.70, 0),
  total_earned = greatest(coalesce(total_earned, 0) - 5.70, 0)
WHERE referral_code = 'ASHAD123';  -- replace with actual code
```

### 4.3 Delete Test Subscription
```sql
DELETE FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND provider = 'whop'
  AND provider_subscription_id = 'mem_test_2c_001';
```

### 4.4 Revert Profile Tier
```sql
UPDATE profiles
SET 
  subscription_tier = 'free',
  current_plan = 'free',
  subscription_expires_at = NULL,
  updated_at = now() AT TIME ZONE 'UTC'
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```

**Note:** If your profile was actually on a paid plan before the test, DO NOT run 4.4. Only run it if you were on free before the test.

### 4.5 Delete Test Audit Logs
```sql
DELETE FROM subscription_audit_log
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989'
  AND triggered_by = 'webhook'
  AND created_at > now() - interval '5 minutes';
```

### 4.6 Final Verification (After Cleanup)
Run the same queries from Phase 1.2 (Pre-Test State Capture) and confirm they match exactly.

```sql
SELECT 
  user_id, plan, status, provider, provider_subscription_id
FROM user_subscriptions
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
```sql
SELECT 
  user_id, subscription_tier, current_plan, subscription_expires_at
FROM profiles
WHERE user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```
```sql
SELECT 
  id, affiliate_user_id, referred_user_id, dodo_subscription_id, amount
FROM affiliate_commissions
WHERE referred_user_id = 'b787ba21-8443-4e2e-9dbd-bc2bc7adf989';
```

---

## PHASE 5 — Fallback Test (Without Referral Code)

To test the fallback path (no `metadata.referral_code`, checks `profiles.referred_by_code`):

### 5.1 Invoke with empty metadata.referral_code
Use the same payload but change metadata to:
```json
"metadata": {
  "user_id": "b787ba21-8443-4e2e-9dbd-bc2bc7adf989",
  "plan_key": "pro_creator",
  "billing_cycle": "monthly",
  "source": "robinos_web"
}
```

### 5.2 Expected Behavior
If `profiles.referred_by_code` is set for this user, commission is recorded using that code. If not, log shows:
```
[whop-webhook] No referral attribution for user=b787ba21-8443-4e2e-9dbd-bc2bc7adf989
```

### 5.3 Cleanup
Run the same Phase 4 cleanup queries with `dodo_subscription_id = 'mem_test_2c_002'`.

---

## Summary Table

| Phase | Action | Tool |
|---|---|---|
| 1.1 | Find referral code | SQL Editor |
| 1.2 | Capture before state | SQL Editor |
| 2.1 | Invoke whop-webhook | Edge Functions → Invoke |
| 2.3 | Check logs | Edge Functions → Logs |
| 3.x | Verify 6 tables | SQL Editor |
| 4.x | Delete test data | SQL Editor |
| 4.6 | Confirm restored state | SQL Editor |

No production data permanently modified. All test data cleaned up.