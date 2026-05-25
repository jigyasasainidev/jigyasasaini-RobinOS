# RobinOS Subscription System — Production QA Checklist

## How to use
Run each scenario manually or via automated test. Mark ✅ pass / ❌ fail.
All backend assertions should be verified in Supabase SQL Editor.

---

## 1. Monthly Renewal
- [ ] User on Creator monthly: `expires_at = starts_at + 30 days` (UTC)
- [ ] `expiry_state = 'active'` while > 7 days remain
- [ ] `expiry_state = 'expiring_7d'` at exactly 7 days remaining
- [ ] `expiry_state = 'expiring_3d'` at exactly 3 days remaining
- [ ] `expiry_state = 'expiring_1d'` at exactly 1 day remaining
- [ ] `show_reminder = true` at 7d, 3d, 1d (if not dismissed)
- [ ] `show_reminder = false` for admin-granted plans
- [ ] After renewal: `expires_at` advances by 30 days, `grace_period_ends_at = null`
- [ ] After renewal: `reminder_dismissed_until = null` (reset)
- [ ] `is_revenue_eligible = true` for paid renewals, `false` for admin grants

## 2. Yearly Renewal
- [ ] `expires_at = starts_at + 365 days` (UTC)
- [ ] Same expiry state transitions as monthly
- [ ] `billing_cycle = 'yearly'` displayed correctly in Settings
- [ ] Yearly → monthly downgrade: new `expires_at = now + 30 days`
- [ ] Monthly → yearly upgrade: new `expires_at = now + 365 days`

## 3. Payment Failure
- [ ] Webhook sets `status = 'payment_failed'`
- [ ] `resolve_user_plan` still returns current plan (not free) during payment_failed
- [ ] Grace period activates after `expires_at` passes
- [ ] `show_reminder = true` with urgency = 'critical' during grace
- [ ] After 3-day grace: `status = 'expired'`, profile reverts to free
- [ ] User content preserved after downgrade (no deletion)

## 4. Cancellation
- [ ] `canceled_at` timestamp set on cancellation
- [ ] `auto_renew = false` after cancellation
- [ ] Plan access continues until `expires_at`
- [ ] Grace period activates after `expires_at` (same as expiry flow)
- [ ] `cancel_at_period_end = true` shown in Settings UI

## 5. Grace Period
- [ ] `grace_period_ends_at = expires_at + 3 days` (UTC)
- [ ] User retains plan access during grace period
- [ ] `in_grace_period = true` in `resolve_user_plan`
- [ ] `expiry_state = 'grace_period'` returned
- [ ] Popup shows with urgency = 'critical'
- [ ] After grace ends: `status = 'expired'`, profile = free
- [ ] `subscription_audit_log` has `grace_activated` and `auto_downgrade` events

## 6. Auto Downgrade
- [ ] `process_subscription_expiry()` is idempotent (run twice = same result)
- [ ] Advisory lock prevents concurrent runs
- [ ] `subscription_audit_log` records every downgrade
- [ ] Profile `subscription_tier = 'free'` after downgrade
- [ ] `subscription_expires_at = null` on profile after downgrade
- [ ] User's usage history, scripts, captions preserved
- [ ] `get_user_entitlements` returns free plan features after downgrade

## 7. Popup Dismissal
- [ ] Clicking "Remind me tomorrow": `reminder_dismissed_until = now + 24h` (UTC)
- [ ] Popup disappears immediately after dismiss (local state)
- [ ] Popup does NOT reappear on page refresh within 24h
- [ ] Popup reappears after 24h window expires
- [ ] Dismissal synced across devices (backend-stored)
- [ ] Clicking backdrop also dismisses popup
- [ ] Dismiss is debounced (double-click doesn't fire twice)
- [ ] `dismiss_expiry_popup` rejects if caller ≠ p_user_id

## 8. Plan Switching
- [ ] Creator → Pro Creator: new `expires_at`, `billing_cycle` preserved
- [ ] Pro Creator → Agency: same
- [ ] Any plan → Free: `expires_at = null`, `grace_period_ends_at = null`
- [ ] `safe_plan_switch` clears `grace_period_ends_at` on renewal
- [ ] `safe_plan_switch` clears `reminder_dismissed_until` on renewal
- [ ] No duplicate `user_subscriptions` rows (upsert on user_id)
- [ ] `subscription_audit_log` has `plan_switch` event
- [ ] `profiles.subscription_tier` updated atomically with subscription row

## 9. Timezone Edge Cases
- [ ] All `expires_at` values stored as UTC in database
- [ ] `compute_period_bounds` uses `now() at time zone 'UTC'`
- [ ] `process_subscription_expiry` uses UTC throughout
- [ ] Daily usage resets at UTC midnight (not browser timezone)
- [ ] Frontend displays dates in user's local timezone (display only)
- [ ] User in UTC+5:30 sees correct "X days remaining" (server-computed)
- [ ] User in UTC-8 sees correct expiry date (localized display)

## 10. Mobile Responsiveness
- [ ] Popup renders as bottom sheet on mobile (< sm breakpoint)
- [ ] Popup renders as centered card on desktop (≥ sm breakpoint)
- [ ] Safe-area padding applied (iPhone notch / home indicator)
- [ ] No scroll lock on body when popup is open
- [ ] Backdrop blur works on iOS Safari
- [ ] Drag handle visible on mobile
- [ ] All buttons have adequate touch targets (≥ 44px)
- [ ] Text doesn't overflow on small screens (320px width)
- [ ] PWA mode: popup renders correctly in standalone display

## 11. Multi-Device Sync
- [ ] Dismiss on Device A → popup hidden on Device B within 60s (realtime)
- [ ] Plan upgrade on Device A → entitlements update on Device B
- [ ] `useSubRealtime` subscribes to `user_subscriptions` changes
- [ ] `useInvalidateSubscriptionQueries` invalidates all caches on demand

## 12. Webhook Replay Attack Prevention
- [ ] `record_webhook_event` returns `is_duplicate: true` on replay
- [ ] Duplicate webhook does NOT change subscription state
- [ ] `subscription_webhook_events` has unique constraint on (provider, provider_event_id)
- [ ] Payload hash stored for audit purposes
- [ ] Creem/Dodo webhook handlers call `record_webhook_event` first

## 13. Expired Access Protection
- [ ] `resolve_user_plan` returns 'free' after grace period ends
- [ ] `get_user_entitlements` returns free features after expiry
- [ ] `consume_usage` blocks premium features for expired users
- [ ] Edge functions validate entitlement before generation
- [ ] No cached premium access after downgrade (staleTime = 30s max)

## 14. Observability
- [ ] `subscription_audit_log` has entry for every plan change
- [ ] `subscription_audit_log` has entry for every downgrade
- [ ] `subscription_audit_log` has entry for every grace activation
- [ ] `triggered_by` field correctly set ('system', 'webhook', 'admin', 'user')
- [ ] Failed webhook events logged with error metadata

---

## SQL Verification Queries

```sql
-- Check a user's current subscription state
select
  us.user_id, us.plan, us.status, us.expires_at,
  us.grace_period_ends_at, us.reminder_dismissed_until,
  p.subscription_tier
from user_subscriptions us
join profiles p using (user_id)
where us.user_id = '<user_id>';

-- Check audit log for a user
select event_type, old_plan, new_plan, old_status, new_status,
       triggered_by, metadata, created_at
from subscription_audit_log
where user_id = '<user_id>'
order by created_at desc
limit 20;

-- Check webhook idempotency log
select provider, provider_event_id, event_type, processed_at
from subscription_webhook_events
order by created_at desc
limit 20;

-- Run expiry job manually
select process_subscription_expiry();

-- Check users in grace period
select user_id, plan, status, expires_at, grace_period_ends_at
from user_subscriptions
where status = 'grace_period'
  and grace_period_ends_at > now();

-- Check users about to be downgraded
select user_id, plan, status, grace_period_ends_at
from user_subscriptions
where status = 'grace_period'
  and grace_period_ends_at <= now() + interval '1 hour';
```
