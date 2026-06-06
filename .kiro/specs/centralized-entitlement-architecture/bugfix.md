# Bugfix Requirements Document

## Introduction

RobinOS's entitlement system accumulated several defects through incremental feature development. Enforcement logic was duplicated across edge functions, frontend hooks, and database RPCs — with no single authoritative path. This caused fresh users to be incorrectly blocked on first use, quota counters on the dashboard to diverge from backend state, NULL plan resolution to default users into an exhausted state, and plan changes to not propagate reliably. A series of hotfix migrations patched individual symptoms, but the root fragmentation remains.

This document captures the full set of defective behaviors, the correct behaviors they must be replaced with, and the existing behaviors that must continue to work without regression.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a brand-new user completes sign-up and their `profiles` row does not yet exist at the moment of first feature use THEN the system returns `FEATURE_DISABLED` because `resolve_user_plan` selects into `v_profile_tier` finding zero rows, leaving it NULL, which propagates to `get_entitlement` as `WHERE plan_key = NULL`, matching nothing and returning `enabled = false`

1.2 WHEN a user whose `profiles.subscription_tier` is NULL calls any entitlement RPC THEN the system treats them as having no plan rather than defaulting to `free`, causing `check_and_increment_usage` to return `FEATURE_DISABLED` for features that the free plan is entitled to

1.3 WHEN `check_and_increment_usage` or `get_usage_status_v2` is invoked via the authenticated user's JWT (anon key + Bearer token via PostgREST) THEN the system fails with an RLS violation because `usage_tracking` has no INSERT/UPDATE policy for authenticated users, causing all quota writes to fail with `INTERNAL_ERROR` and the edge function to return a false 403

1.4 WHEN a free-tier user attempts a hashtag scan THEN the system returns `FEATURE_DISABLED` because the original migration seeded `hashtag_scan` for free plan with `limit_value = 0, enabled = false` instead of the documented `limit_value = 3, enabled = true`

1.5 WHEN an edge function (e.g. `generate-script`, `scan-trends`, `generate-caption`, `elevenlabs-tts`, `generate-video`) performs plan validation THEN the system applies ad-hoc inline plan logic rather than delegating to `_shared/entitlement.ts`, making enforcement inconsistent and independently drifting from `plan_entitlements`

1.6 WHEN the frontend dashboard displays a quota counter (e.g. scripts used, scans used) THEN the system reads from stale frontend state (`free_scripts_used`, `free_scans_used` on the `profiles` row or local hook state) rather than from `usage_tracking` via `get_usage_status_v2`, causing displayed quota to drift from the enforced backend quota

1.7 WHEN `useProfile` resolves tier via `profiles.subscription_tier` and `useByokAccess` calls the legacy `get_usage_status` RPC THEN the system makes plan decisions without consulting `user_subscriptions`, meaning a user with an active paid subscription but an un-synced `subscription_tier` on their profile row is incorrectly treated as free

1.8 WHEN a user upgrades or downgrades their plan THEN the system requires a page reload or cache invalidation before edge functions enforce the new plan, because `resolve_user_plan` is not consistently called on every entitlement check

1.9 WHEN `initialize_user_account` runs for a new user THEN the system does not insert a canonical `profiles` row with `subscription_tier = 'free'` before entitlement RPCs are first called, creating a window where `resolve_user_plan` finds no profile and defaults the user to a broken NULL state

1.10 WHEN `useScriptLimits` computes `used` count for free-tier users THEN the system reads `profiles.free_scripts_used` (a column that is not atomically maintained) rather than querying `usage_tracking`, allowing the displayed count to be stale or incorrect

1.11 WHEN quota period boundaries are computed across `get_usage`, `check_and_increment_usage`, and `get_usage_status_v2` THEN the system duplicates the period-calculation logic in each function independently, creating risk of drift if any one function is patched

1.12 WHEN `PLAN_LIMITS` in `src/lib/pricing.ts` defines monthly caps and daily limits THEN the system contains values that do not match the authoritative `plan_entitlements` seed data (e.g. `PLAN_LIMITS.free.monthlyCap = 60` has no backing entitlement row, and `dailyScripts = 2` maps to the `24h` period rather than `day`)

---

### Expected Behavior (Correct)

2.1 WHEN a brand-new user completes sign-up and calls any entitlement RPC before their `profiles` row is confirmed to exist THEN the system SHALL resolve their plan as `free`, return the correct free-tier entitlement, and allow usage up to the free quota without any 403 or `FEATURE_DISABLED` response

2.2 WHEN a user's `profiles.subscription_tier` is NULL THEN the system SHALL treat that user as plan `free` at every layer of the entitlement chain (`resolve_user_plan` → `get_entitlement` → `check_and_increment_usage`), never propagating NULL into a plan key lookup

2.3 WHEN any entitlement RPC (`check_and_increment_usage`, `get_usage_status_v2`, `get_usage`, `get_entitlement`, `resolve_user_plan`) writes to or reads from `usage_tracking` or `profiles` THEN the system SHALL execute those operations under `SECURITY DEFINER` so that RLS policies on those tables do not block legitimate writes from the authenticated-user calling context

2.4 WHEN a free-tier user calls `check_and_increment_usage` for `hashtag_scan` THEN the system SHALL allow up to 3 scans per day, returning `ALLOWED` and correctly tracking usage in `usage_tracking`, consistent with the documented free-plan limit

2.5 WHEN any edge function processes a feature request (script generation, trend scan, caption generation, TTS, video generation, hashtag scan) THEN the system SHALL gate access exclusively through `checkAndIncrementUsage()` from `_shared/entitlement.ts` and SHALL NOT contain any inline plan-tier conditionals or local quota variables

2.6 WHEN the frontend dashboard renders a quota counter for any feature THEN the system SHALL display the value returned by `get_usage_status_v2` sourced from `usage_tracking`, and that displayed value SHALL match the `usage_count` stored in the backend for the current period

2.7 WHEN `resolve_user_plan` is called for a user with an active paid subscription in `user_subscriptions` THEN the system SHALL return the subscription plan as the effective plan, taking precedence over `profiles.subscription_tier`, so that plan upgrades propagate to all features on the very next entitlement call without requiring a page reload

2.8 WHEN a user upgrades or downgrades their plan THEN the system SHALL reflect the new plan on the next call to `resolve_user_plan` without any cache flush, page reload, or manual state invalidation required

2.9 WHEN `initialize_user_account` runs for a new user THEN the system SHALL upsert a `profiles` row with `subscription_tier = 'free'` before any entitlement RPCs can be called for that user, eliminating the NULL-profile window

2.10 WHEN the frontend computes usage counts for display THEN the system SHALL read from `usage_tracking` via `get_usage_status_v2` for all plan tiers, never from `profiles.free_scripts_used` or `profiles.free_scans_used`

2.11 WHEN period boundaries are computed for any limit period (`24h`, `day`, `month`, `lifetime`, `fair_usage`) THEN the system SHALL derive boundaries from a single shared implementation, so that `get_usage`, `check_and_increment_usage`, and `get_usage_status_v2` always produce identical `period_key` values for the same input moment

2.12 WHEN `src/lib/pricing.ts` exposes frontend limit constants THEN the system SHALL derive all limit values, periods, and enabled flags from `PLAN_ENTITLEMENTS` (which mirrors the database seed) as the single frontend source of truth, and `PLAN_LIMITS` SHALL NOT define values that contradict `PLAN_ENTITLEMENTS`

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a creator-tier user calls `check_and_increment_usage` for `script_generation` within their 20/day limit THEN the system SHALL CONTINUE TO return `ALLOWED` and atomically increment `usage_count` in `usage_tracking`

3.2 WHEN a pro_creator-tier user calls `check_and_increment_usage` for any feature within their capped daily limit THEN the system SHALL CONTINUE TO enforce that cap correctly and return `USAGE_LIMIT_EXCEEDED` once the cap is reached

3.3 WHEN an agency-tier user calls `check_and_increment_usage` for any fair-usage feature THEN the system SHALL CONTINUE TO return `ALLOWED_FAIR_USAGE`, track usage, and emit `abuse_warning = true` when `abuse_warning_at` thresholds are crossed

3.4 WHEN `check_and_increment_usage` is called twice with the same `idempotency_key` for the same user and feature THEN the system SHALL CONTINUE TO return `IDEMPOTENT` on the second call without double-incrementing `usage_count`

3.5 WHEN `reset_usage` is called by an authenticated admin THEN the system SHALL CONTINUE TO delete the relevant `usage_tracking` rows and return `success: true`

3.6 WHEN an unauthenticated request reaches any edge function THEN the system SHALL CONTINUE TO return 401 with `AUTH_REQUIRED` before any entitlement check is performed

3.7 WHEN `resolve_user_plan` maps legacy tier names (`starter` → `creator`, `pro` → `pro_creator`) THEN the system SHALL CONTINUE TO return the normalized canonical plan key

3.8 WHEN `get_entitlement` is called for a feature that has no row in `plan_entitlements` for the user's plan THEN the system SHALL CONTINUE TO return `enabled = false` with `limit_value = 0`

3.9 WHEN the frontend calls `getEntitlement()` or `isFeatureEnabled()` from `src/lib/pricing.ts` for display purposes THEN the system SHALL CONTINUE TO return values consistent with the backend `plan_entitlements` seed without making a network call

3.10 WHEN RLS policies on `usage_tracking` and `plan_entitlements` are evaluated for direct table access by non-service clients THEN the system SHALL CONTINUE TO enforce that users can only SELECT their own `usage_tracking` rows and that `plan_entitlements` is publicly readable

3.11 WHEN existing Supabase migrations (`20260521183700`, `20260522000000`, `20260522100000`, `20260522200000`) are present THEN the system SHALL CONTINUE TO function without those files being modified, as all further changes are applied via new additive migration files only

3.12 WHEN `useProfile`, `useTierLevel`, `useIsProUser`, `useIsAgencyUser`, and `useSubscriptionExpiry` hooks are called THEN the system SHALL CONTINUE TO return consistent values based on the resolved profile and subscription state

3.13 WHEN `handleGenerationRequest` in `_shared/entitlement.ts` is used by an edge function THEN the system SHALL CONTINUE TO attach `usage` metadata to the enriched JSON response for any generation that succeeds

3.14 WHEN `get_usage_status_v2` returns `byok_enabled: true` for a pro_creator or agency user THEN the system SHALL CONTINUE TO reflect that value correctly in the frontend `useByokAccess` hook

---

## Bug Condition Pseudocode

### Bug Condition: NULL Plan Resolution

```pascal
FUNCTION isBugCondition_NullPlan(X)
  INPUT: X of type { user_id: UUID }
  OUTPUT: boolean

  RETURN profiles.subscription_tier IS NULL
      OR NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = X.user_id)
END FUNCTION

// Property: Fix Checking — NULL Plan
FOR ALL X WHERE isBugCondition_NullPlan(X) DO
  result ← resolve_user_plan'(X.user_id)
  ASSERT result.plan = 'free'
  ASSERT result.plan IS NOT NULL
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_NullPlan(X) DO
  ASSERT resolve_user_plan(X) = resolve_user_plan'(X)
END FOR
```

### Bug Condition: RLS Write Violation

```pascal
FUNCTION isBugCondition_RLSViolation(X)
  INPUT: X of type { calling_role: text, operation: text }
  OUTPUT: boolean

  RETURN X.calling_role = 'authenticated'
     AND X.operation IN ('INSERT', 'UPDATE')
     AND target_table = 'usage_tracking'
     AND function_security != 'DEFINER'
END FUNCTION

// Property: Fix Checking — SECURITY DEFINER
FOR ALL X WHERE isBugCondition_RLSViolation(X) DO
  result ← check_and_increment_usage'(X)
  ASSERT result.code != 'INTERNAL_ERROR'
  ASSERT result.success = true OR result.code IN ('FEATURE_DISABLED', 'USAGE_LIMIT_EXCEEDED')
END FOR
```

### Bug Condition: Onboarding 403

```pascal
FUNCTION isBugCondition_OnboardingBlock(X)
  INPUT: X of type { user_id: UUID, feature_key: text }
  OUTPUT: boolean

  RETURN is_new_user(X.user_id)
     AND feature_key IN ('script_generation', 'trend_scan', 'hashtag_scan', 'caption_generation')
     AND time_since_signup(X.user_id) < interval '5 minutes'
END FUNCTION

// Property: Fix Checking — Fresh User First Use
FOR ALL X WHERE isBugCondition_OnboardingBlock(X) DO
  result ← check_and_increment_usage'(X.user_id, X.feature_key)
  ASSERT result.success = true
  ASSERT result.code = 'ALLOWED'
  ASSERT result.code != 'FEATURE_DISABLED'
END FOR
```
