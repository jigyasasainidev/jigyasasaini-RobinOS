## Goal
Implement a full production SaaS subscription system on RobinOS using Lovable Cloud backend + Paddle, with server-enforced entitlements, daily usage tracking, webhook-driven lifecycle updates, and dynamic feature gating.

## Phase 1 — Backend foundation (schema + security)
1. **Create canonical plan + subscription schema via migration**
   - Add/normalize tables:
     - `plan_entitlements` (single source of truth)
     - `subscriptions` (Paddle customer/subscription lifecycle)
     - `usage_tracking` (daily counters per user)
     - `subscription_audit_logs` (webhook/audit trail + idempotency)
   - Add strict constraints (plan names, billing cycles, non-negative counters, unique keys).
   - Add performance indexes for user/date/status/provider IDs.

2. **RLS + role-safe access model**
   - Enable RLS for all new tables.
   - User policies: read own subscription/usage.
   - Service/admin policies: webhook and system mutation paths.
   - Keep admin checks using security-definer role function pattern (no recursive RLS policy logic).

3. **Seed entitlements table (authoritative limits/flags)**
   - Insert rows for `free`, `creator`, `pro_creator`, `agency` including all required limits and feature booleans.
   - Remove hardcoded limit assumptions from runtime logic and use DB-based entitlement reads.

## Phase 2 — Server-side subscription/usage engine
4. **Create DB functions for atomic enforcement**
   - `get_user_entitlements(user_id)` → returns active plan + flags + limits.
   - `check_and_consume_usage(user_id, feature, increment)` → transactional quota check + increment.
   - `reset_daily_usage_if_needed(user_id)` integrated in usage flow (date-based reset semantics).
   - `apply_subscription_expiry_downgrade()` for safe FREE fallback when expired.

5. **Subscription period handling logic (monthly/yearly)**
   - Ensure `expires_at/current_period_end` reflects exact cycle semantics (1 month vs 1 year).
   - Downgrade behavior on expiry:
     - active plan becomes FREE
     - premium access revoked
     - gated features respect FREE entitlements immediately

6. **Realtime-ready usage data path**
   - Ensure usage table and reads support live counters in dashboard.
   - Keep server as source of truth; frontend only displays returned state.

## Phase 3 — Paddle integration (webhooks + checkout)
7. **Enable payments provider workflow**
   - Run provider eligibility flow and enable Paddle integration (project-side).
   - Configure product/price mapping for creator/pro/agency monthly/yearly.

8. **Build production webhook handler edge function**
   - Handle required events:
     - `subscription.created`
     - `subscription.updated`
     - `subscription.canceled`
     - `transaction.completed`
     - `subscription.past_due`
     - `subscription.payment_failed`
   - Implement:
     - signature verification
     - idempotency guard (event ID uniqueness)
     - status transitions + period refresh
     - audit logging on every processed event

9. **Checkout/session edge flow**
   - Server-side creation of Paddle checkout for selected plan + billing cycle.
   - Persist provider references safely and update local subscription state.

## Phase 4 — Frontend architecture (no hardcoded gating)
10. **Centralized entitlement hooks/utilities**
   - Add hooks:
     - `useEntitlements()`
     - `useUsageStatus()`
     - `useSubscriptionState()`
   - Replace tier hardcoding in existing hooks/pages with entitlement-driven checks.

11. **Feature gate integration across generation flows**
   - Before each action (script/audio/hashtag/export/trend):
     - call server validation/consume path
     - block on quota exceeded
     - show standard limit message + upgrade CTA

12. **Upgrade UX + dashboard subscription intelligence**
   - Settings/dashboard show:
     - current plan
     - billing cycle
     - renewal date
     - remaining counters + progress bars
   - Upgrade modal shows current plan and recommended next plan based on blocked feature.

## Phase 5 — Migration compatibility + rollout safety
13. **Backward compatibility mapping**
   - Normalize old plan aliases (e.g. starter/pro/scale_agency) to canonical plan keys.
   - Migrate existing profile/subscription fields into canonical subscription records.

14. **Validation and production hardening**
   - Validate RLS behavior for authenticated user vs admin/service contexts.
   - Verify webhook replay/idempotency and failed-payment transitions.
   - Verify no privileged action is trusted from frontend-only state.

## Deliverables
- SQL migrations for full schema + constraints + indexes + policies.
- Seeded `plan_entitlements` table.
- DB functions for entitlement resolution, atomic usage consumption, and expiry downgrade.
- Paddle webhook edge function with signature verification + idempotency + audit logs.
- Checkout edge function for plan/cycle purchases.
- Refactored TS hooks/utilities for centralized plan gating.
- Dashboard/upgrade state integration with live usage and subscription metadata.

## Technical implementation notes
- Keep all quota enforcement server-side and transactional.
- Use canonical plan names: `free`, `creator`, `pro_creator`, `agency`.
- Treat `plan_entitlements` as the only policy source; UI derives from backend entitlements only.
- Use event-driven subscription updates from webhook as source of billing truth.