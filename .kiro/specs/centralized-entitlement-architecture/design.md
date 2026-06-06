# Centralized Entitlement Architecture — Technical Design

## Overview

This document describes the technical design for stabilizing and unifying RobinOS's entitlement enforcement system. All design decisions are constrained to **additive changes only** — no existing migrations are modified, no existing frontend components are redesigned. The design eliminates all known defects from `bugfix.md` while preserving every regression-prevention invariant (3.1–3.14).

---

## Architecture Principles

1. **Single enforcement path**: every feature access goes through one chain — `resolve_user_plan` → `get_entitlement` → `check_and_increment_usage`
2. **Backend is canonical**: no frontend code enforces quota; it only reads and displays
3. **Service client for RPC writes**: all entitlement RPCs called via service_role to bypass RLS
4. **SECURITY DEFINER on all entitlement RPCs**: writes to `usage_tracking` and reads from `profiles` succeed regardless of calling context
5. **NULL-safe plan resolution**: missing profile row always resolves to `free`, never crashes or blocks
6. **No ad-hoc plan logic in edge functions**: every function imports from `_shared/entitlement.ts` exclusively

---

## System Component Map

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React/TypeScript)                             │
│                                                          │
│  useProfile ──► useTierLevel ──► UI display only        │
│  TrendingAudioPage, IntelligencePage, etc.              │
│  └─► supabase.functions.invoke()                        │
└──────────────────────┬──────────────────────────────────┘
                       │  JWT Bearer token (auto by SDK)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase Edge Functions (Deno)                          │
│                                                          │
│  generate-script                                         │
│  scan-trends          ─── all import ──►                │
│  trending-audio                          _shared/        │
│  generate-caption                        entitlement.ts  │
│  elevenlabs-tts                          │               │
│  generate-video                          │               │
└──────────────────────────────────────────┼──────────────┘
                                           │
                    ┌──────────────────────▼──────────────┐
                    │  _shared/entitlement.ts              │
                    │                                      │
                    │  verifyAuth()         service client │
                    │  checkAndIncrementUsage()            │
                    │  getUsageStatus()                    │
                    │  createServiceClient()               │
                    └──────────────────────┬──────────────┘
                                           │  service_role key
                                           ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase Database (PostgreSQL)                          │
│                                                          │
│  RPCs (all SECURITY DEFINER):                           │
│  ├─ resolve_user_plan(p_user_id)                        │
│  ├─ get_entitlement(p_user_id, p_feature_key)           │
│  ├─ check_and_increment_usage(...)                      │
│  ├─ get_usage_status_v2(p_user_id, p_feature_key)       │
│  └─ get_usage(p_user_id, p_feature_key)                 │
│                                                          │
│  Tables:                                                 │
│  ├─ plan_entitlements  (canonical config, public read)  │
│  ├─ usage_tracking     (atomic counters, service_role)  │
│  ├─ profiles           (user tier, service_role)        │
│  └─ user_subscriptions (active plan, service_role)      │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

### `plan_entitlements` (canonical config — already exists)

```sql
plan_key      text  -- 'free', 'creator', 'pro_creator', 'agency'
feature_key   text  -- 'script_generation', 'trend_scan', etc.
limit_value   numeric  -- 0=disabled, -1=unlimited/fair_usage, >0=capped
limit_period  text  -- '24h', 'day', 'month', 'lifetime', 'fair_usage'
enabled       boolean
metadata      jsonb -- { soft_threshold, abuse_warning_at }
```

**Authoritative entitlement matrix (after all migrations applied):**

| feature_key | free | creator | pro_creator | agency |
|---|---|---|---|---|
| script_generation | 2 / 24h | 20 / day | 100 / day | -1 / fair_usage |
| caption_generation | 2 / day | 20 / day | 100 / day | -1 / fair_usage |
| trend_scan | 1 / lifetime | 10 / day | 100 / day | -1 / fair_usage |
| hashtag_scan | **3 / day** | 20 / day | 100 / day | -1 / fair_usage |
| tts_generation | disabled | disabled | 200 / day | -1 / fair_usage |
| video_generation | disabled | disabled | 50 / day | -1 / fair_usage |
| byok_access | disabled | disabled | -1 / day | -1 / day |

Note: `hashtag_scan` for free was corrected from `0/disabled` to `3/day` in migration `20260522000000`.

### `usage_tracking` (atomic consumption — already exists)

```sql
user_id      uuid  -- FK to profiles.user_id
feature_key  text
usage_count  integer NOT NULL DEFAULT 0
period_key   text  -- '2026-05-22', 'lifetime', '2026-05-22-14'
period_start timestamptz
period_end   timestamptz
last_used_at timestamptz
-- UNIQUE (user_id, feature_key, period_key)
```

No schema changes required. All correctness is in the RPCs.

---

## RPC Chain Design

### Period Key Computation (shared logic)

All three RPCs (`get_usage`, `check_and_increment_usage`, `get_usage_status_v2`) must compute period boundaries identically:

```
period = '24h'       → period_key = to_char(date_trunc('hour', now()) - interval '24h', 'YYYY-MM-DD-HH24')
period = 'day'       → period_key = to_char(now(), 'YYYY-MM-DD')
period = 'month'     → period_key = to_char(now(), 'YYYY-MM')
period = 'lifetime'  → period_key = 'lifetime'
period = 'fair_usage'→ period_key = to_char(now(), 'YYYY-MM-DD')  [daily window]
```

This is already correctly implemented in the latest migrations. No change needed.

### `resolve_user_plan` — NULL-safe plan resolution

**Fixed in migration `20260522200000`. Current correct behavior:**

```
1. SELECT subscription_tier FROM profiles WHERE user_id = p_user_id
2. v_profile_tier := COALESCE(v_profile_tier, 'free')   ← explicit NULL guard
3. SELECT plan, status FROM user_subscriptions WHERE user_id = p_user_id
4. If active paid subscription → use subscription plan
5. Else → use v_profile_tier
6. Normalize legacy aliases (starter→creator, pro→pro_creator)
7. v_effective_plan := COALESCE(v_effective_plan, 'free')  ← final safety net
```

No further changes to this function.

### `get_entitlement` — NULL-safe lookup

**Fixed in migration `20260522200000`. Current correct behavior:**

```
1. v_plan_key := COALESCE(resolve_user_plan(p_user_id) ->> 'plan', 'free')
2. SELECT FROM plan_entitlements WHERE plan_key = v_plan_key AND feature_key = p_feature_key
3. If NOT FOUND → return { enabled: false, limit_value: 0 }
```

No further changes.

### `check_and_increment_usage` — atomic enforcement

**Fixed in migration `20260522100000` (SECURITY DEFINER). Current correct behavior:**

```
1. Validate p_user_id not null
2. Check idempotency_key (prevent double-increment)
3. get_entitlement() → check enabled flag
4. Calculate period boundaries
5. Branch on unlimited / fair_usage / capped:
   - Unlimited: UPSERT + increment, return ALLOWED
   - Fair usage: UPSERT + increment, check soft thresholds, return ALLOWED_FAIR_USAGE
   - Capped: INSERT 0 (ON CONFLICT DO NOTHING) → SELECT FOR UPDATE → compare with limit → UPDATE + increment
6. Return structured JSON with success/code/feature/plan/limit/used/remaining/reset_at
```

No further changes.

---

## Edge Function Integration Contract

### Required pattern for ALL edge functions

```typescript
// 1. Handle CORS preflight
if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

// 2. Auth header — fail fast if missing
const authHeader = req.headers.get("authorization");
if (!authHeader) return createErrorResponse("AUTH_REQUIRED", "Authorization required", 401);

// 3. Entitlement check — ONLY call from _shared/entitlement.ts
const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
  authHeader,
  FEATURES.SCRIPT_GENERATION,  // feature-specific constant
  idempotencyKey
);
if (entitlementError) return entitlementError;

// 4. Extract user from service client (entitlement already verified JWT)
const supabase = createServiceClient();
const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

// 5. Execute generation / feature logic
// ...

// 6. Return response with usage attached
return new Response(JSON.stringify({ ...result, usage: entitlement }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
```

### Forbidden patterns in edge functions

```typescript
// ❌ DO NOT: ad-hoc plan checks
if (tier === 'free') { ... }
if (plan === 'agency') { ... }

// ❌ DO NOT: manual auth with fallback to anon key
Authorization: `Bearer ${session?.access_token || VITE_SUPABASE_PUBLISHABLE_KEY}`

// ❌ DO NOT: createUserClient for RPC calls
const supabase = createUserClient(authHeader);
await supabase.rpc("check_and_increment_usage", ...);

// ❌ DO NOT: inline quota constants
const FREE_LIMIT = 2;
if (scansUsed >= FREE_LIMIT) { ... }
```

---

## Frontend Architecture

### Tier resolution (display only)

```
useAuth() → session.user
  ↓
useProfile() → db.from("profiles").select("*")
  ↓
useTierLevel() → normalizeTier(profile.subscription_tier)
  ↓
UI display (badge, gate labels, settings page)
```

This chain is for **display only**. It does NOT gate feature execution. The only authority is the backend entitlement chain.

### Usage display (backend-sourced)

```
On page mount (user?.id dependency):
  supabase.rpc("get_usage_status_v2", { p_user_id, p_feature_key })
  → sets local state for badge display
  → never used to block execution (that's backend's job)
```

All pages that display usage counters (`TrendingAudioPage`, `StudioPage`, `CaptionEnginePage`, `SettingsPage`) call `get_usage_status_v2` on mount to hydrate the display. The backend will enforce regardless of what the frontend shows.

### Frontend limit constants (`src/lib/pricing.ts`)

`PLAN_ENTITLEMENTS` is the authoritative frontend constant. It mirrors the database seed 1:1.

`PLAN_LIMITS` (legacy) is deprecated for quota enforcement but retained for backward compatibility with components that use `getLimitsForTier()`. Its values are directionally consistent but should not be trusted for precise enforcement display.

Action: `PLAN_ENTITLEMENTS.free.hashtag_scan` must be updated to `{ limit: 3, enabled: true, period: "day" }` to match the database after migration `20260522000000` is applied.

---

## Upgrade / Downgrade Lifecycle

```
User upgrades plan:
  1. admin/payment webhook updates user_subscriptions.plan + status = 'active'
  2. On NEXT feature request:
     - checkAndIncrementUsage() → checkAndIncrementUsage → resolve_user_plan()
     - resolve_user_plan reads user_subscriptions → finds new active plan
     - Returns new plan immediately
  3. No cache flush needed
  4. No page reload needed
  5. Frontend useTierLevel() refreshes on next profile query (React Query staleTime = 30s)

User downgrades:
  1. Subscription status changes to 'canceled' or 'expired'
  2. resolve_user_plan falls back to profiles.subscription_tier ('free')
  3. Enforcement immediately reflects new plan
  4. Any over-quota usage_tracking rows remain but limit_value is now lower → USAGE_LIMIT_EXCEEDED on next call
```

---

## Migration Strategy

All fixes are applied as **additive new migrations**. Existing migrations are immutable.

| Migration File | What it fixes | Status |
|---|---|---|
| `20260521183700_entitlement_engine.sql` | Creates engine tables + RPCs | ✅ Deployed |
| `20260522000000_fix_free_hashtag_entitlement.sql` | Enables hashtag_scan for free (limit=3) | ✅ Deployed |
| `20260522100000_fix_entitlement_rpc_security.sql` | SECURITY DEFINER on write RPCs | ✅ Deployed |
| `20260522200000_fix_resolve_user_plan_null_default.sql` | NULL-safe plan resolution | ✅ Deployed |
| `20260522300000_harden_generate_script.sql` (planned) | No DB changes needed for this fix | Not needed |

**No further database migrations are required** for the currently identified defects. The combination of the four deployed migrations fully satisfies requirements 2.1–2.11.

Requirement 2.12 (frontend `PLAN_LIMITS` alignment with `PLAN_ENTITLEMENTS`) is a frontend-only code change — no migration needed.

---

## generate-script Edge Function — Crash Analysis & Hardened Design

### Root cause of HTTP 500

The function has **three crash paths** that produce intermittent 500s:

**Path A — Empty AI completion (most common)**
```typescript
const content = String(payload?.choices?.[0]?.message?.content || "").trim();
if (!content) {
  // Returns 500 with "Empty generation result"
}
```
The AI gateway (`google/gemini-3-flash-preview`) intermittently returns empty `content` when:
- Model is rate-limited at provider level (different from HTTP 429)
- Model output is filtered/blocked
- Response structure varies across gateway versions

**Path B — Unchecked DB insert failure after content is generated**
```typescript
await supabase.from("script_generations").insert({ ... });  // Error not checked
await supabase.from("script_history").insert({ ... });      // Error not checked
```
If the `script_generations` insert fails (e.g. unique constraint violation on `(user_id, request_id)` if somehow the same requestId is submitted twice), it throws an unhandled rejection that propagates to the outer catch → 500.

**Path C — Missing timeout on AI provider fetch**
The `fetch` to `ai.gateway.lovable.dev` has no timeout. In Deno edge functions, an unanswered request can hang until the Deno runtime terminates the function with a 500.

### Hardened execution design

The hardened `generate-script` function follows this pipeline:

```
PHASE 1: Auth + validation (fast fail)
  - Extract authHeader → 401 if missing
  - Parse req.json() with try/catch → 400 if malformed
  - Validate topic field → 400 if missing

PHASE 2: Entitlement (service client, atomic)
  - checkAndIncrementUsage(authHeader, FEATURES.SCRIPT_GENERATION, requestId)
  - On error → structured 403/503 response

PHASE 3: User resolution (service client, single call)
  - createServiceClient().auth.getUser(token)
  - On failure → 401 (should not happen after entitlement passed)

PHASE 4: AI generation (with timeout + structured error handling)
  - AbortController with 45-second timeout
  - Handle 429, 402, timeout, non-OK responses → categorized errors
  - Handle empty content → 503 (service unavailable, not 500)
  - Never throw from this phase — always return structured response

PHASE 5: Persistence (fire-and-forget, non-fatal)
  - Insert to script_generations + script_history
  - Log errors but DO NOT throw — persistence failure does not fail the user
  
PHASE 6: Response
  - Return SSE-format payload with content + usage
```

### Structured logging specification

```typescript
const LOG = (phase: string, meta: Record<string, unknown>) =>
  console.info(JSON.stringify({ fn: "generate-script", phase, ...meta, ts: Date.now() }));

// Required log points (no secrets, no tokens, no API keys):
LOG("REQUEST_RECEIVED",   { method, has_auth: !!authHeader })
LOG("AUTH_VERIFIED",      { user_id })
LOG("PLAN_RESOLVED",      { plan, feature: "script_generation" })
LOG("ENTITLEMENT_PASSED", { used, remaining, limit, code })
LOG("AI_REQUEST_STARTED", { model, topic_length })
LOG("AI_RESPONSE_OK",     { content_length, elapsed_ms })
LOG("PERSISTENCE_DONE",   { request_id })
LOG("RESPONSE_SENT",      { status: 200, elapsed_ms })

// Error log points:
LOG("ENTITLEMENT_DENIED", { code, plan, feature })
LOG("AI_PROVIDER_ERROR",  { status, category })
LOG("AI_EMPTY_CONTENT",   { model, elapsed_ms })
LOG("AI_TIMEOUT",         { timeout_ms })
LOG("PERSISTENCE_ERROR",  { table, error_code })  // non-fatal
LOG("FATAL_ERROR",        { category, message })  // outer catch
```

---

## Structured Error Code Contract

All edge functions return structured errors. Frontend can key off `code`:

| HTTP Status | code | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body, missing fields |
| 401 | `AUTH_REQUIRED` | No Authorization header |
| 401 | `UNAUTHORIZED` | Invalid/expired JWT |
| 403 | `FEATURE_DISABLED` | Plan doesn't include this feature |
| 403 | `USAGE_LIMIT_EXCEEDED` | Quota exhausted for period |
| 429 | `RATE_LIMITED` | AI provider rate limit |
| 402 | `CREDITS_EXHAUSTED` | AI provider credits |
| 503 | `AI_UNAVAILABLE` | Empty completion, timeout, provider down |
| 503 | `INTERNAL_ERROR` | DB RPC failure |
| 500 | `GENERATION_FAILED` | Unexpected runtime error |

The frontend must never display raw 500 errors to users. It must map `code` to a user-facing message.

---

## `.kirorules` Governance Additions

The following rules must be added to `.kirorules` under a new `# ENTITLEMENT RULES` section:

```
# ENTITLEMENT RULES

- Never implement plan or quota logic inside individual edge functions.
- All feature access must go through checkAndIncrementUsage() in _shared/entitlement.ts.
- All entitlement RPCs must have SECURITY DEFINER and set search_path = public.
- All entitlement RPC calls from edge functions must use createServiceClient(), not createUserClient().
- resolve_user_plan must always return a non-null plan string — 'free' is the minimum.
- Never read profiles.free_scripts_used or profiles.free_scans_used for quota display.
- All usage display in the frontend must query get_usage_status_v2 via supabase.rpc().
- PLAN_ENTITLEMENTS in src/lib/pricing.ts must exactly mirror the plan_entitlements database table.
- New features must be seeded in plan_entitlements for all plans before any edge function uses them.
- New migrations must never modify existing migration files.
- Edge functions must respond with structured JSON errors (code + message) — never raw exception messages.
```

---

## Production Reliability Guarantees

After all fixes are applied:

1. **Fresh user first use**: `resolve_user_plan` defaults to `free` → `get_entitlement` finds free-plan row → `check_and_increment_usage` allows up to quota → returns `ALLOWED`

2. **RLS writes succeed**: All entitlement RPCs are `SECURITY DEFINER` + called via `createServiceClient()` → bypass RLS entirely → `usage_tracking` writes never fail due to missing INSERT policy

3. **NULL plan never propagates**: Two explicit `COALESCE(..., 'free')` guards in `resolve_user_plan` + one in `get_entitlement` → `WHERE plan_key = NULL` never reaches the entitlement table

4. **Quota drift impossible**: Frontend reads `usage_tracking` via `get_usage_status_v2` for display; backend reads same table for enforcement → same source of truth

5. **Plan upgrades instant**: Every edge function call resolves plan live from `user_subscriptions` → no stale cache

6. **No ad-hoc plan logic**: All edge functions import from `_shared/entitlement.ts` exclusively → single enforcement point

7. **generate-script 500s eliminated**: Timeout on AI calls + non-fatal DB persistence + structured error codes → no unhandled crashes

---

## Files Modified by This Design

| File | Type | Change |
|---|---|---|
| `supabase/functions/generate-script/index.ts` | Edge function | Harden: timeout, logging, structured errors, remove double auth |
| `supabase/functions/_shared/entitlement.ts` | Shared lib | Add structured logging interface (optional) |
| `src/lib/pricing.ts` | Frontend | Fix `PLAN_ENTITLEMENTS.free.hashtag_scan` to match DB |
| `.kirorules` | Governance | Add `# ENTITLEMENT RULES` section |
| `.kiro/specs/centralized-entitlement-architecture/design.md` | Spec | This document |

No new SQL migrations required. No UI redesign. No routing changes. No auth flow changes.
