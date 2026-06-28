# Phase 2B — whop-webhook Plan Activation & Cancellation

## File to modify
`supabase/functions/whop-webhook/index.ts` (ONLY this file)

## Goal
Convert placeholder handlers into real handlers:
1. `membership.activated` → call `safe_plan_switch` RPC → activate plan
2. `membership.deactivated` → update `user_subscriptions` → mark cancelled
3. Both share fallback user resolution logic

## Context from audit
- Whop metadata flows back: `data.metadata.user_id`, `data.metadata.plan_key`
- `membership.deactivated` payload shows `"metadata": {}` — deactivated events DO NOT preserve checkout metadata
- User resolution strategy (priority order):
  1. `data.metadata.user_id` (activation only)
  2. `user_subscriptions` lookup by `provider_subscription_id` = membership.id
  3. `profiles` lookup by email = `data.user.email`

## RPCs to call
- `safe_plan_switch(p_user_id, p_new_plan, p_billing_cycle='monthly', p_provider='whop', p_provider_sub_id, p_amount, p_triggered_by='webhook')`
- `log_subscription_event(p_user_id, p_event_type, p_old_status, p_new_status, p_triggered_by, p_metadata)`

## Tables touched
- `user_subscriptions` — read (resolve by provider_subscription_id), write (status update on deactivation)
- `profiles` — read (email fallback resolution)

## Implementation details

### handleMembershipActivated
1. Extract `data.metadata.user_id`, `data.metadata.plan_key`
2. Validate: both must be non-empty
3. If plan_key not in ['creator','pro_creator','agency'] → log + return error
4. Create Supabase service client
5. Call `safe_plan_switch` with:
   - p_user_id = metadata.user_id
   - p_new_plan = metadata.plan_key
   - p_billing_cycle = metadata.billing_cycle ?? 'monthly'
   - p_provider = 'whop'
   - p_provider_sub_id = data.id (Whop membership ID)
   - p_amount = PLAN_AMOUNTS[plan_key]
   - p_triggered_by = 'webhook'
6. Log result
7. Return `{success: true, activated: {...}}`

### handleMembershipDeactivated
1. Extract `data.id` = membershipId
2. Resolve user_id (priority):
   a. `data.metadata.user_id` (might be empty for deactivated)
   b. Query `user_subscriptions.provider_subscription_id = membershipId` AND `provider = 'whop'`
   c. Query `profiles.email = data.user.email`
3. If no user_id → log error + return `{success: false, error: 'cannot_resolve_user'}`
4. Update `user_subscriptions`:
   - status: 'cancelled'
   - auto_renew: false
   - canceled_at: now()
   - updated_at: now()
   - WHERE user_id = resolvedUserId
5. Call `log_subscription_event({p_user_id, p_event_type: 'subscription_cancelled', p_old_status: 'active', p_new_status: 'cancelled', p_triggered_by: 'webhook', p_metadata: {membership_id, provider: 'whop'}})`
6. Return `{success: true, cancelled: true}`

### handleMembershipCancelled (same logic as deactivated — shared implementation)

### PLAN_AMOUNTS
```ts
const PLAN_AMOUNTS: Record<string, number> = {
  creator: 19,
  pro_creator: 39,
  agency: 99,
};
```

### Error handling
- All errors: log to console, return `{success: false, error: message}`
- safe_plan_switch errors: throw → caught by main try/catch → return 200 with processing_error
- Database errors: same pattern

### No other files modified
