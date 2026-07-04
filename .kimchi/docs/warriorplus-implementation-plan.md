# RobinOS — WarriorPlus Implementation Plan

**Planning document only. No SQL, no code, no implementation.**

**Source architecture:** `warriorplus-architecture-v2.md` (approved)
**Source audit:** `warriorplus-preimplementation-audit.md`
**Source review:** `warriorplus-architecture-review.md`
**Date:** 2026-07-03

---

## Table of Contents

1. [Implementation Overview](#implementation-overview)
2. [Phase 1 — Database](#phase-1--database)
3. [Phase 2 — Edge Functions](#phase-2--edge-functions)
4. [Phase 3 — Frontend](#phase-3--frontend)
5. [Phase 4 — Admin Panel](#phase-4--admin-panel)
6. [Phase 5 — Background Jobs](#phase-5--background-jobs)
7. [Phase 6 — Testing](#phase-6--testing)
8. [Phase 7 — Deployment](#phase-7--deployment)
9. [Phase 8 — Rollback](#phase-8--rollback)
10. [Phase 9 — Launch Checklist](#phase-9--launch-checklist)
11. [Cross-Phase Dependencies](#cross-phase-dependencies)
12. [Timeline Estimates](#timeline-estimates)

---

## Implementation Overview

This plan implements the architecture approved in V2 across 9 sequential phases. Each phase has explicit dependencies on prior phases. Implementation begins only after **all** V2 external dependencies (`[EXT-DEP]`) are validated.

### Critical Preconditions

Before Phase 1 begins:

1. **WP vendor validation completed** — `warriorplus-validation-report.md` exists and approved
2. **All `[EXT-DEP]` items resolved or accepted** with documented fallbacks
3. **V2 architecture re-reviewed and signed off** by a second reviewer
4. **Test WP credentials obtained** (sandbox or test-mode)
5. **Email service selected** and tested (Resend, SendGrid, or other)

### Sequencing Rationale

```
Phase 1 (Database) → Phase 2 (Edge Functions) → Phase 5 (Background Jobs)
                                  ↓
                         Phase 3 (Frontend) → Phase 4 (Admin)
                                  ↓
                         Phase 6 (Testing) ← all phases
                                  ↓
                         Phase 7 (Deployment) → Phase 8 (Rollback ready)
                                  ↓
                         Phase 9 (Launch)
```

Phase 5 (Background Jobs) overlaps with Phase 2 because the worker depends on Edge Functions but is invoked separately.

---

## Phase 1 — Database

### 1.1 Migration Inventory

**Total migrations required: 5**

Each migration is independent (no cross-migration FK dependencies) but must be applied in order.

#### Migration 51: `warriorplus_event_queue`
**Purpose:** Per-txn_id ordered event log (fixes Bug #1)

**Creates:**
- Table `warriorplus_event_queue` (see V2 §15.1 for schema reference)
- Indexes:
  - `idx_wpeq_pending` on `(received_at) WHERE status IN ('received', 'claim_required')`
  - `idx_wpeq_txn_seq` on `(warriorplus_txn_id, sequence_number)`
  - `idx_wpeq_failed` on `(retry_count, received_at) WHERE status IN ('failed', 'dead_letter')`
- RLS policies:
  - Service role: full access
- No triggers in this migration
- No RPCs in this migration

**Dependencies:** None (root migration for WP integration)

**Deployment order:** 1st

---

#### Migration 52: `warriorplus_product_registry`
**Purpose:** Admin-managed WP item_id → RobinOS plan mapping

**Creates:**
- Table `warriorplus_product_registry` (see V2 §15.2)
- Indexes:
  - `idx_wpr_enabled` on `(is_enabled) WHERE is_enabled = true`
- RLS policies:
  - Admins: full access (super_admin, admin)
  - Service role: SELECT only
- No triggers

**Dependencies:** None (independent table)

**Deployment order:** 2nd

---

#### Migration 53: `warriorplus_pending_claims_and_chargebacks`
**Purpose:** Claim workflow + chargeback tracking

**Creates:**
- Table `warriorplus_pending_claims` (see V2 §15.3)
- Table `warriorplus_chargebacks` (see V2 §15.4)
- Indexes:
  - `idx_wpc_claim_status` on `(claim_status, claim_expires_at)`
  - `idx_wpc_magic_link` on `(magic_link_token) WHERE claim_status = 'pending_verification'`
  - `idx_wpc_buyer_hash` on `(buyer_email_hash)`
  - `idx_wpcb_user` on `(user_id, received_at DESC)`
  - `idx_wpcb_status` on `(status, received_at DESC) WHERE status = 'open'`
  - `idx_wpcb_txn` on `(warriorplus_txn_id)`
- RLS policies for both tables

**Dependencies:** None (independent tables; FK to warriorplus_event_queue is logical, not enforced via SQL FK to allow flexible testing)

**Deployment order:** 3rd

---

#### Migration 54: `user_product_grants_and_supporting`
**Purpose:** Stacking support + remaining auxiliary tables

**Creates:**
- Table `user_product_grants` (see V2 §15.8)
- Table `warriorplus_sales_ledger` (see V2 §15.5)
- Table `warriorplus_unknown_items` (see V2 §15.6)
- Table `warriorplus_webhook_dead_letter` (see V2 §15.7)
- Indexes for all tables

**Dependencies:** None

**Modifies:**
- Table `user_subscriptions`:
  - **No changes** — keep unique constraint on `user_id` (primary subscription remains one-per-user)
  - Stacking happens via `user_product_grants`

**Modifies:**
- Table `profiles`:
  - Add column `subscription_tier_priority` (text) — for stacking resolution
  - Add column `effective_plan_source` (text) — debug field

**Deployment order:** 4th

---

#### Migration 55: `warriorplus_rpcs_and_triggers`
**Purpose:** All RPCs + triggers for WP integration

**Creates RPCs:**

| RPC Name | Purpose | Security |
|----------|---------|----------|
| `process_warriorplus_event(p_event_id UUID)` | Composite RPC: identity + product + grant in transaction | `SECURITY DEFINER`, service_role only |
| `safe_plan_grant(...)` | Wrapper for WP-specific grants (replaces p_auto_renew parameter) | `SECURITY DEFINER`, service_role only |
| `register_warriorplus_product(...)` | Admin: register new product mapping | `SECURITY DEFINER`, authenticated (admin role check) |
| `update_warriorplus_product(...)` | Admin: update existing product | `SECURITY DEFINER`, authenticated (admin role check) |
| `disable_warriorplus_product(p_item_id TEXT)` | Admin: disable product | `SECURITY DEFINER`, authenticated (admin role check) |
| `lookup_warriorplus_product(p_item_id TEXT)` | Internal: lookup product | `SECURITY DEFINER`, service_role |
| `process_pending_warriorplus_events(p_batch_size INTEGER)` | Worker: process queue batch | `SECURITY DEFINER`, service_role |
| `reprocess_warriorplus_dead_letter(p_id UUID, p_corrections JSONB)` | Admin: reprocess failed event | `SECURITY DEFINER`, authenticated (admin role check) |
| `initiate_warriorplus_claim(p_event_id UUID)` | Worker: create pending claim | `SECURITY DEFINER`, service_role |
| `verify_warriorplus_magic_link(p_token UUID)` | Claim: verify magic link | `SECURITY DEFINER`, service_role (called from edge function with claimer's session) |
| `complete_warriorplus_claim(p_token UUID, p_account_data JSONB)` | Claim: create account + process | `SECURITY DEFINER`, service_role (called from edge function) |
| `resolve_warriorplus_dispute(p_id UUID, p_outcome TEXT, p_notes TEXT)` | Admin: mark dispute won/lost | `SECURITY DEFINER`, authenticated (admin role check) |
| `generate_dispute_evidence(p_chargeback_id UUID)` | Worker: build evidence package | `SECURITY DEFINER`, service_role |
| `cleanup_expired_warriorplus_claims()` | Cron: mark expired claims | `SECURITY DEFINER`, service_role |
| `cleanup_expired_magic_links()` | Cron: mark expired magic links | `SECURITY DEFINER`, service_role |
| `recalculate_user_effective_plan(p_user_id UUID)` | Internal: re-resolve plan from subscriptions + grants | `SECURITY DEFINER`, service_role |

**Creates triggers:**

| Trigger | Table | When | Action |
|---------|-------|------|--------|
| `trg_wpeq_set_sequence` | `warriorplus_event_queue` | BEFORE INSERT | Auto-set `sequence_number` from max(sequence_number)+1 for same txn_id, or from `wp_timestamp` |
| `trg_wpc_set_updated_at` | `warriorplus_pending_claims` | BEFORE UPDATE | Set `updated_at = now()` |
| `trg_wpcb_set_updated_at` | `warriorplus_chargebacks` | BEFORE UPDATE | Set `updated_at = now()` |
| `trg_upg_set_updated_at` | `user_product_grants` | BEFORE UPDATE | Set `updated_at = now()` |
| `trg_wpr_updated_at` | `warriorplus_product_registry` | BEFORE UPDATE | Set `updated_at = now()` |

**Modifies existing functions:**

| Function | Change |
|----------|--------|
| `resolve_user_plan(p_user_id)` | Add logic to consider `user_product_grants` when computing effective plan (stacking) |
| `get_user_entitlements(p_user_id)` | Add logic to consider grants when computing feature limits |
| `safe_plan_switch(...)` | **NO CHANGES** — preserved as-is (V2 uses new `safe_plan_grant` wrapper instead) |

**Dependencies:** Requires migrations 51-54 to be applied first

**Deployment order:** 5th

---

### 1.2 Migration Deployment Order

```
Migration 51 (event_queue)           ← Apply first
        ↓
Migration 52 (product_registry)      ← Apply second (independent)
        ↓
Migration 53 (claims + chargebacks)  ← Apply third (independent)
        ↓
Migration 54 (grants + aux tables)   ← Apply fourth (independent)
        ↓
Migration 55 (RPCs + triggers)       ← Apply last (depends on 51-54)
```

**Total migrations: 5**

Each migration must complete successfully before the next is applied. If any fails, halt and investigate.

### 1.3 Database Pre-Deployment Checklist

- [ ] Staging database exists and is current with production schema
- [ ] All 5 migrations tested on staging first
- [ ] Migration scripts include rollback DDL (for emergency)
- [ ] DBA review of all FK relationships and indexes
- [ ] Estimated table sizes for capacity planning
- [ ] Backup taken before migration window

---

## Phase 2 — Edge Functions

### 2.1 Edge Function Inventory

**Total edge functions: 4 entry points + 11 shared modules**

#### Entry Point Functions (deployable)

1. `warriorplus-webhook`
2. `warriorplus-build-link`
3. `process-warriorplus-events`
4. `admin-warriorplus`

#### Shared Modules (internal to Edge Functions)

These are not separately deployable but are referenced by entry points:

5. `_shared/warriorplus/signature.ts`
6. `_shared/warriorplus/normalize.ts`
7. `_shared/warriorplus/validate.ts`
8. `_shared/warriorplus/enqueue.ts`
9. `_shared/warriorplus/identity-resolver.ts`
10. `_shared/warriorplus/product-resolver.ts`
11. `_shared/warriorplus/claim-workflow.ts`
12. `_shared/warriorplus/chargeback-handler.ts`
13. `_shared/warriorplus/refund-handler.ts`
14. `_shared/warriorplus/subscription-grantor.ts`
15. `_shared/warriorplus/notifier.ts`

---

### 2.2 Entry Point 1: `warriorplus-webhook`

**Purpose:** Entry point for WP IPN. Verifies signature, validates payload, enqueues event, ACKs to WP.

**Deploy location:** `supabase/functions/warriorplus-webhook/index.ts`
**Config:** `verify_jwt = false` (required — IPN has no user JWT)

**Inputs:**
- HTTP request body: raw bytes (preserve for signature verification)
- HTTP headers: `Content-Type`, `cverify` (or whatever WP uses), custom WP headers
- HTTP method: must be POST

**Outputs:**
- 200 OK with `{received: true, queued: true}` on valid signature + enqueue success
- 200 OK with `{received: true, duplicate: true}` if event already processed
- 200 OK with `{received: true, blocked: <reason>}` for validation failures (still ACK to prevent WP retry storms)
- 400 Bad Request for malformed payload (no retry desired)
- 401 Unauthorized for signature failure (no retry desired)
- 503 Service Unavailable for DB outage (WP will retry)

**Dependencies:**
- `_shared/warriorplus/signature.ts` — HMAC verification
- `_shared/warriorplus/normalize.ts` — payload → normalized event
- `_shared/warriorplus/validate.ts` — field validation
- `_shared/warriorplus/enqueue.ts` — idempotent enqueue
- `subscription_webhook_events` table (existing) for layer-1 idempotency
- `warriorplus_event_queue` table (new) for layer-2 idempotency

**Error handling:**
- Signature failure: log CRITICAL + admin notification + return 401
- Malformed payload: log WARN + return 400
- DB outage: log ERROR + return 503 (let WP retry)
- Enqueue duplicate: log INFO + return 200 (idempotent skip)
- Any other error: log ERROR + attempt enqueue anyway (mark as 'failed'); return 200

**Security requirements:**
- Constant-time signature comparison (`crypto.timingSafeEqual`)
- Raw body must be read before any parsing
- HMAC algorithm as documented by WP (validated in pre-implementation)
- Rate limiting per source IP (Cloudflare or Edge Function check)
- IP whitelisting as fallback if algorithm unconfirmed

**CORS:** Allow POST from any origin (WP servers); no CORS preflight needed for server-to-server

---

### 2.3 Entry Point 2: `warriorplus-build-link`

**Purpose:** Generate signed URL for logged-in user to redirect to WP checkout.

**Deploy location:** `supabase/functions/warriorplus-build-link/index.ts`
**Config:** `verify_jwt = true` (requires user authentication)

**Inputs:**
- HTTP body: `{planKey: string, userId: UUID, userEmail: string, referralCode?: string}`
- Authorization header: user JWT

**Outputs:**
- 200 OK with `{signedUrl: string, expiresAt: ISO timestamp}`
- 400 Bad Request for invalid plan
- 401 Unauthorized for missing/invalid JWT
- 409 Conflict for duplicate active subscription (per stacking matrix)
- 503 Service Unavailable if `safe_plan_grant` check fails

**Dependencies:**
- `user_subscriptions` table (existing) for duplicate check
- `WARRIORPLUS_ROBINOS_SIGNING_SECRET` secret
- Standard CORS headers from `_shared/entitlement.ts`

**Error handling:**
- Invalid plan: log + return 400
- Duplicate sub (per stacking matrix): return 409 with explanatory message
- JWT failure: return 401
- Signing key missing: return 500 (config error)
- DB failure: return 503

**Security requirements:**
- JWT required (no anonymous URL generation)
- Signed URL expires in 1 hour (configurable)
- HMAC-SHA256 of payload using `WARRIORPLUS_ROBINOS_SIGNING_SECRET`
- Constant-time comparison not applicable here (no comparison; only signing)

---

### 2.4 Entry Point 3: `process-warriorplus-events`

**Purpose:** Async worker that processes queued events. Invoked by cron.

**Deploy location:** `supabase/functions/process-warriorplus-events/index.ts`
**Config:** `verify_jwt = false` (invoked by cron with service role)

**Inputs:**
- HTTP body (optional): `{batchSize?: number, maxRuntimeMs?: number}`
- Or triggered by cron with empty body

**Outputs:**
- 200 OK with `{processed: number, failed: number, blocked: number, skipped: number, duration_ms: number}`
- 500 Internal Server Error if DB outage

**Dependencies:**
- `warriorplus_event_queue` table
- `_shared/warriorplus/identity-resolver.ts`
- `_shared/warriorplus/product-resolver.ts`
- `_shared/warriorplus/refund-handler.ts`
- `_shared/warriorplus/chargeback-handler.ts`
- `_shared/warriorplus/subscription-grantor.ts`
- `_shared/warriorplus/claim-workflow.ts`
- `_shared/warriorplus/notifier.ts`

**Error handling:**
- DB outage: log + return 500 (cron will retry)
- Event processing failure: increment retry_count, mark failed/dead_letter per retry policy
- Identity resolution returns claim_required: don't fail; mark event as such
- Product resolution returns blocked: mark event, send admin notification

**Security requirements:**
- Only callable via service role (cron has this; direct HTTP calls require service key)
- No user input processing beyond batch size
- Trace ID for all log lines

---

### 2.5 Entry Point 4: `admin-warriorplus`

**Purpose:** Admin RPCs for product registry, claims, chargebacks, dead letter management.

**Deploy location:** `supabase/functions/admin-warriorplus/index.ts`
**Config:** `verify_jwt = true` (admin authentication required)

**Inputs:**
- HTTP body: `{action: string, payload: object}` where action is one of:
  - `register_product`
  - `update_product`
  - `disable_product`
  - `list_products`
  - `list_pending_claims`
  - `approve_claim_manually`
  - `link_purchase_to_user`
  - `list_chargebacks`
  - `resolve_dispute`
  - `list_dead_letter`
  - `reprocess_dead_letter`
  - `mark_dead_letter_unrecoverable`
  - `view_sales_ledger`
  - `toggle_warriorplus_enabled`

**Outputs:**
- 200 OK with action-specific response
- 400 Bad Request for invalid action
- 401 Unauthorized for non-admin
- 403 Forbidden for admin actions requiring super_admin
- 404 Not Found for missing entities

**Dependencies:**
- All WP tables
- `get_admin_role()` for authorization
- Audit logging via `log_subscription_event` or new `log_admin_action`

**Error handling:**
- Per-action validation
- All admin actions logged to audit log
- Idempotent where possible

**Security requirements:**
- Admin role required (super_admin for sensitive actions like manual linking)
- All actions audit-logged
- Rate limiting on admin actions (defense in depth)

---

### 2.6 Shared Module Specifications

(Implementation details are deferred — only contracts documented)

#### `_shared/warriorplus/signature.ts`
- Exports: `verifyWPSignature(rawBody, headers, secret): boolean`
- Throws: `SignatureError` on malformed signature

#### `_shared/warriorplus/normalize.ts`
- Exports: `normalizeWPPayload(rawPayload): NormalizedWarriorPlusEvent`
- Throws: `ValidationError` on unparseable payload

#### `_shared/warriorplus/validate.ts`
- Exports: `validateNormalizedEvent(event): ValidationResult`

#### `_shared/warriorplus/enqueue.ts`
- Exports: `enqueueWPSupabaseEvent(normalizedEvent): EnqueueResult`
- Atomic with idempotency check

#### `_shared/warriorplus/identity-resolver.ts`
- Exports: `resolveWPSupabaseIdentity(normalizedEvent, supabaseClient): IdentityResolution`
- Returns one of: resolved / claim_required / admin_required

#### `_shared/warriorplus/product-resolver.ts`
- Exports: `resolveWPSupabaseProduct(itemId, supabaseClient): ProductResolution | null`

#### `_shared/warriorplus/claim-workflow.ts`
- Exports:
  - `initiateWPSupabaseClaim(eventId): PendingClaim`
  - `verifyMagicLink(token): VerificationResult`
  - `completeClaim(token, accountData): CompletionResult`

#### `_shared/warriorplus/chargeback-handler.ts`
- Exports: `handleWPSupabaseChargeback(eventId): ProcessingResult`
- Generates dispute evidence

#### `_shared/warriorplus/refund-handler.ts`
- Exports: `handleWPSupabaseRefund(eventId): ProcessingResult`
- Branches on billing_cycle

#### `_shared/warriorplus/subscription-grantor.ts`
- Exports: `grantWPSupabaseSubscription(userId, product, event): GrantResult`
- Calls `safe_plan_grant` RPC

#### `_shared/warriorplus/notifier.ts`
- Exports: `notifyWPSupabaseAdmin(type, title, message, metadata): void`
- Wraps `push_admin_notification`

---

### 2.7 Edge Function Deployment Order

```
Step 1: Deploy _shared/warriorplus/* modules (referenced by all entry points)
Step 2: Deploy warriorplus-webhook (set verify_jwt = false in config.toml)
Step 3: Deploy warriorplus-build-link (set verify_jwt = true in config.toml)
Step 4: Deploy process-warriorplus-events (set verify_jwt = false in config.toml)
Step 5: Deploy admin-warriorplus (set verify_jwt = true in config.toml)
Step 6: Update supabase/config.toml with new function configurations
```

---

## Phase 3 — Frontend

### 3.1 Frontend Inventory

**Total new pages/components: 5 new + 6 modified**

### 3.2 New Pages

#### Page 1: `/warriorplus/thank-you`
**Purpose:** Landing page after WP checkout. Shows processing status until entitlement granted.

**Route:** `/warriorplus/thank-you`
**File:** `src/pages/WarriorPlusThankYou.tsx`

**Behavior:**
1. Reads `txn` query param
2. Shows "Processing your purchase..." message
3. Polls backend for status (SSE or short-poll, max 60s)
4. On success: redirects to `/dashboard`
5. On timeout: shows "Still processing — you'll receive email when ready"
6. On claim_required: shows "Check your email to verify and claim your purchase"

**Components:**
- `<ProcessingSpinner />` — animated indicator
- `<StatusBadge />` — current state display
- `<ClaimEmailPrompt />` — shown when claim workflow needed

**Dependencies:**
- `get_subscription_status` RPC (existing)
- `check_pending_claim` (new RPC for claim_required detection)
- React Router for navigation

---

#### Page 2: `/warriorplus/verify`
**Purpose:** Magic-link verification landing. Buyer clicks link in email → email verified.

**Route:** `/warriorplus/verify`
**File:** `src/pages/WarriorPlusVerify.tsx`

**Behavior:**
1. Reads `token` query param
2. Calls `verify_warriorplus_magic_link(token)` on mount
3. If valid: shows account creation form
4. If invalid/expired: shows error page with "Request new link" button
5. After form submit: calls `complete_warriorplus_claim(token, accountData)`
6. On success: redirects to `/dashboard`
7. On failure: shows error with retry option

**Components:**
- `<EmailDisplay />` — shows the email that will be used (with edit option)
- `<PasswordSetupForm />` — password creation
- `<VerifyErrorState />` — error display

---

#### Page 3: `/warriorplus/claim`
**Purpose:** Post-verification, account creation confirmation page.

**Route:** `/warriorplus/claim`
**File:** `src/pages/WarriorPlusClaim.tsx`

**Behavior:**
1. Shows success message: "Your WarriorPlus purchase is linked!"
2. Shows plan details (tier, billing cycle, expiry)
3. "Continue to Dashboard" CTA

**Components:**
- `<PlanSummaryCard />` — displays what was granted
- `<ContinueButton />` — navigation

---

#### Page 4: `/admin/warriorplus/products`
**Purpose:** Admin page for managing product registry.

**Route:** `/admin/warriorplus/products`
**File:** `src/pages/admin/WarriorPlusProducts.tsx`

**Behavior:**
1. Lists all registered products
2. Add/Edit/Disable/Enable actions
3. Form for new product registration
4. Shows recent registrations and admin actions

**Access:** Admin role required (`super_admin`, `admin`)

---

#### Page 5: `/admin/warriorplus/operations`
**Purpose:** Admin dashboard for ongoing WP operations.

**Route:** `/admin/warriorplus/operations`
**File:** `src/pages/admin/WarriorPlusOps.tsx`

**Behavior:**
1. Tabs: Pending Claims | Open Chargebacks | Dead Letter | Sales Ledger
2. Each tab shows relevant records with action buttons
3. Manual linking interface
4. Dispute resolution interface
5. Dead letter reprocessing interface

**Access:** Admin role required (`super_admin` for sensitive actions)

---

### 3.3 Modified Pages/Components

#### Modification 1: `src/pages/Pricing.tsx` (or wherever pricing is rendered)
**Change:** Add "Buy via WarriorPlus" CTA alongside Dodo CTA.

**Behavior:**
- Show WarriorPlus CTA when `warriorplus_page_enabled = true`
- Clicking calls `warriorplus-build-link`
- Redirects to returned signed URL

**Files:**
- `src/components/PricingCards.tsx` (or similar)
- `src/lib/payments/warriorplus.ts` (NEW — client wrapper)

---

#### Modification 2: `src/components/UpgradeDialog.tsx`
**Change:** Add WP as a payment method option.

**Behavior:**
- Radio buttons: "Credit Card (Dodo)" | "WarriorPlus Marketplace"
- Selection determines which build-link is called

---

#### Modification 3: `src/pages/AffiliatePage.tsx`
**Change:** Add disclosure about WP commission policy.

**Behavior:**
- New section: "WarriorPlus Sales"
- Explains: WP-driven sales don't earn RobinOS affiliate commission unless buyer came via RobinOS affiliate link
- Default disclosure (legal-safe language)

---

#### Modification 4: `src/pages/SettingsPage.tsx`
**Change:** Display WP-sourced subscriptions and grants.

**Behavior:**
- "Subscription" section shows provider (Dodo / WarriorPlus / Admin)
- "Additional Grants" section shows user_product_grants
- Each line shows source, plan, expiry, refund status

---

#### Modification 5: `src/lib/payments/types.ts`
**Change:** Add `warriorplus` provider type.

**New types:**
- `PlanKey` unchanged (still creator | pro_creator | agency)
- `SubscriptionState.provider` now includes `"warriorplus" | "whop" | "dodo"`
- `BillingCycle` adds `"one_time"`

---

#### Modification 6: `src/lib/payments/` 
**Change:** Add `warriorplus.ts` client wrapper.

**File:** `src/lib/payments/warriorplus.ts`

**Exports:**
- `createWarriorPlusCheckoutLink(planKey, referralCode?): Promise<{url, expiresAt}>`
- `checkPendingClaimStatus(txnId): Promise<ClaimStatus>`

---

### 3.4 Frontend Build Order

```
Step 1: Update pricing.ts and types.ts
Step 2: Create warriorplus.ts client wrapper
Step 3: Modify Pricing component with new CTA
Step 4: Modify UpgradeDialog with provider selection
Step 5: Create WarriorPlusThankYou page
Step 6: Create WarriorPlusVerify page
Step 7: Create WarriorPlusClaim page
Step 8: Modify AffiliatePage with disclosure
Step 9: Modify SettingsPage to show WP subscriptions
Step 10: Create admin WarriorPlusProducts page
Step 11: Create admin WarriorPlusOps page
Step 12: Add admin routes to router
Step 13: Update navigation/menus
```

---

## Phase 4 — Admin Panel

### 4.1 Admin Features Required

#### Feature 1: Product Registry Management
**Page:** `/admin/warriorplus/products`

**Capabilities:**
- List all registered products (paginated, searchable)
- Register new product (form: item_id, item_name, plan_key, billing_cycle, amount, is_subscription, notes)
- Edit existing product
- Enable/disable product
- View product usage statistics (sales count, revenue)

**Edge Function calls:**
- `admin-warriorplus` action `register_product`
- `admin-warriorplus` action `update_product`
- `admin-warriorplus` action `disable_product`
- `admin-warriorplus` action `list_products`

---

#### Feature 2: Pending Claims Management
**Page:** `/admin/warriorplus/operations` (Pending Claims tab)

**Capabilities:**
- List pending claims (with filters: pending_verification, email_verified, expired)
- View claim details (buyer email masked, purchase details)
- Resend magic link email
- Manually link purchase to existing user (super_admin only)
- Manually create user account for claim (super_admin only)
- Mark claim as abandoned (with reason)

**Edge Function calls:**
- `admin-warriorplus` action `list_pending_claims`
- `admin-warriorplus` action `approve_claim_manually`
- `admin-warriorplus` action `link_purchase_to_user`

---

#### Feature 3: Chargeback Management
**Page:** `/admin/warriorplus/operations` (Open Chargebacks tab)

**Capabilities:**
- List open chargebacks
- View chargeback details + dispute evidence package
- Download dispute evidence (JSON or PDF)
- Mark as won / lost / withdrawn
- Add resolution notes

**Edge Function calls:**
- `admin-warriorplus` action `list_chargebacks`
- `admin-warriorplus` action `resolve_dispute`

---

#### Feature 4: Dead Letter Management
**Page:** `/admin/warriorplus/operations` (Dead Letter tab)

**Capabilities:**
- List dead letter events
- View failure details + stack trace
- Reprocess event (optionally with corrections)
- Mark as unrecoverable (with reason)

**Edge Function calls:**
- `admin-warriorplus` action `list_dead_letter`
- `admin-warriorplus` action `reprocess_dead_letter`
- `admin-warriorplus` action `mark_dead_letter_unrecoverable`

---

#### Feature 5: Sales Ledger Analytics
**Page:** `/admin/warriorplus/operations` (Sales Ledger tab)

**Capabilities:**
- Filter by date range, plan, billing cycle
- View total revenue, commission paid, commission skipped
- Export to CSV

**Edge Function calls:**
- `admin-warriorplus` action `view_sales_ledger`

---

#### Feature 6: WarriorPlus Feature Toggle
**Location:** Admin Settings page (existing)

**Capabilities:**
- Toggle `warriorplus_page_enabled` (existing from migration 50)
- Toggle `warriorplus_pays_robinos_affiliate` (new — commission exception)
- Set `warriorplus_robinos_commission_percent` (new)

**Existing or new admin RPCs:**
- Update `platform_settings` row (existing pattern)

---

#### Feature 7: Unknown Items Alert Response
**Page:** Admin Dashboard notification panel (existing)

**Capabilities:**
- Notification when unknown items appear
- Quick action: open product registry with item_id pre-filled

---

#### Feature 8: Event Queue Monitoring
**Page:** `/admin/warriorplus/operations` (Queue tab)

**Capabilities:**
- View pending event count
- View failed event count
- View dead letter count
- View average processing time
- View recent processing errors

**Edge Function calls:**
- New action `get_queue_stats`

---

### 4.2 Admin Permissions Matrix

| Action | super_admin | admin | support |
|--------|-------------|-------|---------|
| Register product | ✅ | ✅ | ❌ |
| Edit product | ✅ | ✅ | ❌ |
| Disable product | ✅ | ✅ | ❌ |
| View claims | ✅ | ✅ | ✅ |
| Resend magic link | ✅ | ✅ | ❌ |
| Manually link purchase | ✅ | ❌ | ❌ |
| Manually create account for claim | ✅ | ❌ | ❌ |
| View chargebacks | ✅ | ✅ | ✅ |
| Resolve dispute | ✅ | ❌ | ❌ |
| View dead letter | ✅ | ✅ | ✅ |
| Reprocess dead letter | ✅ | ❌ | ❌ |
| Mark unrecoverable | ✅ | ❌ | ❌ |
| View sales ledger | ✅ | ✅ | ✅ |
| Toggle WP enabled | ✅ | ✅ | ❌ |
| Toggle commission exception | ✅ | ❌ | ❌ |

---

## Phase 5 — Background Jobs

### 5.1 Cron Jobs Required

#### Cron 1: `process-warriorplus-events`
**Schedule:** Every 30 seconds
**Function:** Invoke `process-warriorplus-events` Edge Function

**Configuration:**
- Batch size: 50 (configurable)
- Max runtime: 25 seconds (leave buffer before next invocation)
- Concurrency: Multiple invocations allowed (handled by `FOR UPDATE SKIP LOCKED`)

**Monitoring:**
- Alert if queue depth > 1000 for > 5 minutes
- Alert if avg processing time > 5 seconds
- Alert if failure rate > 10%

---

#### Cron 2: `cleanup-expired-warriorplus-claims`
**Schedule:** Every 6 hours
**Function:** Invoke `cleanup_expired_warriorplus_claims()` RPC

**Behavior:**
- Marks claims with `claim_expires_at < now() AND claim_status IN ('pending_verification', 'email_verified')` as `expired`
- Notifies admin of expired claims
- Optionally auto-refunds WP for unclaimed purchases (configurable)

**Configuration:**
- Auto-refund: enabled (default) or disabled

---

#### Cron 3: `cleanup-expired-magic-links`
**Schedule:** Every hour
**Function:** Invoke `cleanup_expired_magic_links()` RPC

**Behavior:**
- Marks magic links with `magic_link_expires_at < now()` as expired
- No admin notification (high volume)

---

#### Cron 4: `recalculate-stale-effective-plans`
**Schedule:** Daily at 2 AM UTC
**Function:** Invoke `recalculate_user_effective_plan()` for active users

**Behavior:**
- For all users with active subscriptions or grants:
  - Recompute effective plan
  - Update profiles if changed
- Logs discrepancies for debugging

**Purpose:** Defense in depth — catches any drift in stacking resolution

---

#### Cron 5: `notify-stuck-events`
**Schedule:** Every 15 minutes
**Function:** Custom Edge Function `check-stuck-events`

**Behavior:**
- Finds events with status='processing' for > 5 minutes
- Marks as 'failed' (assumes worker crashed)
- Sends admin notification if > 10 stuck events

**Purpose:** Recovery from worker crashes

---

### 5.2 Queues and Workers

#### Queue 1: `warriorplus_event_queue`
**Type:** Database-backed queue (existing in migration 51)
**Worker:** `process-warriorplus-events` Edge Function
**Capacity:** Designed for 10K pending events
**Backpressure:** Admin notification at 1000+, alert at 5000+

#### Queue 2: Email Retry Queue
**Type:** Database-backed (new table or use existing notification table)
**Worker:** Part of main worker batch

**Behavior:**
- Failed email sends are retried 3x with exponential backoff
- After 3 failures, admin notification
- No automatic abandonment

#### Queue 3: Admin Notification Queue
**Type:** Existing `push_admin_notification` infrastructure
**Worker:** Existing notification delivery system

**Behavior:**
- All WP notifications routed through existing admin notification system
- Priority levels preserved (info, success, warning, critical)

---

### 5.3 Background Job Deployment Order

```
Step 1: Implement cron 1 (process events) — most critical
Step 2: Implement cron 2 (cleanup claims) — needed before any real WP sale
Step 3: Implement cron 3 (cleanup magic links) — needed for claim workflow
Step 4: Implement cron 5 (stuck events) — defensive
Step 5: Implement cron 4 (recalculate plans) — defense in depth, deploy last
```

---

## Phase 6 — Testing

### 6.1 Test Categories

**Total test scenarios: 50+** (across 12 categories)

### 6.2 Test Categories Detail

#### Category 1: Successful Purchase (Logged-In User)

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 1.1 | User on /pricing clicks "Buy via WarriorPlus" for Creator | Redirected to WP with signed URL |
| 1.2 | Signed URL contains rbin_uid, rbin_sig, rbin_exp, rbin_email, rbin_ref | All params present |
| 1.3 | User completes WP checkout | WP sends SALE IPN |
| 1.4 | IPN arrives at webhook | Event enqueued |
| 1.5 | Worker processes event | Subscription granted, user_product_grants row created |
| 1.6 | User lands on thank-you page | Shows processing, then dashboard |
| 1.7 | User logs in and visits dashboard | Plan shows as Creator |
| 1.8 | Admin sees entry in subscription_audit_log | Log entry exists |
| 1.9 | Admin sees entry in sales_ledger | Sale recorded |
| 1.10 | RobinOS affiliate (if rbin_ref set) | Commission recorded (at 15%) |

#### Category 2: Successful Purchase (Guest User)

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 2.1 | User without account finds RobinOS on WP Marketplace | WP listing visible |
| 2.2 | User buys via WP | IPN arrives, no email match |
| 2.3 | Event marked claim_required | Pending claim created |
| 2.4 | Magic-link email sent to buyer_email | Email arrives |
| 2.5 | User clicks magic link | Verification page shown |
| 2.6 | User enters email + password | Account created |
| 2.7 | Claim marked email_verified, then account_created, then processed | Status sequence correct |
| 2.8 | Worker processes the queued event | Entitlement granted |
| 2.9 | User redirected to dashboard | Active subscription visible |

#### Category 3: Duplicate Webhook

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 3.1 | Same IPN arrives twice within 1 second | Second one deduplicated at layer 1 |
| 3.2 | Same IPN arrives after 1 minute | Deduplicated (unique constraint) |
| 3.3 | Same IPN with same amount + timestamp (V1 bug scenario) | New hash differentiates them |
| 3.4 | Same IPN with different timestamp | Treated as distinct |
| 3.5 | Duplicate with retry count > 0 | Logged, not reprocessed |

#### Category 4: Refund Flow

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 4.1 | Full refund of subscription (monthly) | Status = cancelled, access until expires_at |
| 4.2 | Partial refund of subscription | No entitlement change, audit log entry |
| 4.3 | Full refund of one-time purchase | Immediate downgrade to free, grant revoked |
| 4.4 | Partial refund of one-time | No entitlement change, audit log entry |
| 4.5 | Refund of subscription past expires_at | No state change, accounting record |
| 4.6 | Refund before SALE (out-of-order) | RFND waits for SALE in queue, then processed |
| 4.7 | Multiple partial refunds | All processed, cumulative tracked |
| 4.8 | Refund + commission reversal | Commission status = reversed |

#### Category 5: Chargeback Flow

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 5.1 | CGBK for active subscription | Immediate cancel, downgrade to free |
| 5.2 | CGBK for one-time grant | Grant revoked, downgrade to free |
| 5.3 | CGBK during cooldown | Cooldown reset to 30 days |
| 5.4 | dispute.won after CGBK | Subscription restored |
| 5.5 | dispute.lost after CGBK | Subscription stays cancelled |
| 5.6 | CGBK before SALE | Processed in order after SALE arrives |
| 5.7 | Commission + chargeback | Commission reversed with requires_manual_recovery |
| 5.8 | Dispute evidence generated | JSON evidence package stored |
| 5.9 | Admin notification sent | CRITICAL priority notification received |

#### Category 6: Invalid Hash / Signature Failure

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 6.1 | IPN with wrong signature | 401 returned, no enqueue |
| 6.2 | IPN with missing signature | 401 returned |
| 6.3 | IPN with tampered body | 401 returned |
| 6.4 | IPN with old timestamp (replay attempt) | Idempotency table catches it |
| 6.5 | Rapid signature failures from same IP | Rate limited |

#### Category 7: Unknown Product

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 7.1 | IPN with item_id not in registry | Event marked blocked, admin notified |
| 7.2 | IPN with disabled product | Event marked blocked, admin notified |
| 7.3 | IPN with malformed item_id | Validation error, 400 returned |
| 7.4 | Unknown item_count > 10 | Escalation to CRITICAL priority |

#### Category 8: Unknown User (Already Tested in Category 2)

Add additional scenarios:
| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 8.1 | Multiple IPNs for same buyer_email | All create pending claims, linked via buyer_email_hash |
| 8.2 | Buyer_email from disposable domain | Flagged for admin review |
| 8.3 | Rate limit exceeded for email match | Magic-link verification required |

#### Category 9: Retry Behavior

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 9.1 | Worker fails on first attempt | Retry 1 after 1 minute |
| 9.2 | Worker fails 5 times | Event moved to dead_letter |
| 9.3 | DB outage during processing | Event marked failed, retried on next cron |
| 9.4 | Network timeout during RPC call | Retry within handler, then escalate |
| 9.5 | Worker crashes mid-processing | Stuck event detected by cron 5 |

#### Category 10: Timeout

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 10.1 | Worker exceeds 25s runtime | Invocation returns, remaining events retry on next cron |
| 10.2 | Single event takes > 60s | Marked failed, retried |
| 10.3 | Edge Function request exceeds 30s | WP sees timeout, retries |

#### Category 11: Race Conditions

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 11.1 | Two IPNs for same user arrive in parallel | Both enqueued, processed serially |
| 11.2 | User claims while IPN processes | Idempotent grant, no double entitlement |
| 11.3 | Admin manual links while IPN processes | Unique constraint catches race |
| 11.4 | Worker A and Worker B process same event | SKIP LOCKED ensures only one wins |
| 11.5 | Two partial refunds in same second | Different event IDs, both processed |

#### Category 12: Subscription Stacking

| Test # | Scenario | Expected Result |
|--------|----------|-----------------|
| 12.1 | User on Creator (Dodo) buys Creator (WP) | Stack via user_product_grants |
| 12.2 | User on Creator (Dodo) buys Pro Creator (WP) | Upgrade replaces primary, grants added |
| 12.3 | User on Creator (Dodo) buys Free (WP) | Reject (downgrade blocked) |
| 12.4 | User on Pro Creator (WP) buys Creator (WP) | Downgrade with cooldown |
| 12.5 | User on Pro Creator (Dodo) buys Agency (WP) | Upgrade during cooldown → queued |
| 12.6 | User has 2 grants + 1 subscription | resolve_user_plan returns max tier |

### 6.3 Test Environments

| Environment | Purpose | WP Mode |
|-------------|---------|---------|
| Unit tests | Component logic | Mocked |
| Integration tests | Edge Function + DB | Mocked WP |
| Staging | End-to-end with WP sandbox | WP Test Mode |
| Pre-production | Final validation | WP Test Mode (limited) |
| Production | Live | WP Live Mode |

### 6.4 Test Data Requirements

- Mocked WP IPN payloads for each event type
- Test users with various subscription states
- Test products in registry
- Pre-existing Dodo subscriptions for stacking tests
- Pre-existing commission records

### 6.5 Test Coverage Requirements

- Unit test coverage: ≥ 80% of new code
- Integration test coverage: All edge function paths
- E2E test coverage: All critical user journeys
- Load test coverage: 1000 IPN/minute sustained

---

## Phase 7 — Deployment

### 7.1 Pre-Deployment Validation

**MUST complete before deployment begins:**

- [ ] All V2 `[EXT-DEP]` items validated or accepted with fallbacks
- [ ] All migrations tested on staging
- [ ] All edge functions tested on staging
- [ ] Worker cron tested on staging
- [ ] Email service configured and tested
- [ ] Admin pages tested on staging
- [ ] Test WP account connected
- [ ] All test categories (§6) passed on staging
- [ ] Load test passed (1000 IPN/min for 1 hour)
- [ ] Security review passed
- [ ] Rollback procedure documented and tested
- [ ] Monitoring/alerting configured
- [ ] On-call rotation established
- [ ] Communication plan ready

### 7.2 Deployment Order (Safest Sequence)

```
Day 1: Database (low risk, no user-facing changes)
  ↓
Day 2: Verify database works in production
  ↓
Day 3: Edge Functions deployed with feature flag OFF
  ↓
Day 4: Verify edge functions deployable, but feature flag prevents use
  ↓
Day 5: Worker cron enabled (processes nothing if no events)
  ↓
Day 6: Smoke test with test-mode WP purchase
  ↓
Day 7: Admin panel deployed
  ↓
Day 8: Enable warriorplus_page_enabled for internal users only
  ↓
Day 9-14: Internal testing in production with test WP products
  ↓
Day 15: Enable for limited audience (beta users, 100 people)
  ↓
Day 16-30: Beta testing, monitor closely
  ↓
Day 31: Enable for general public (warriorplus_page_enabled = true)
```

### 7.3 Feature Flag Strategy

Use `platform_settings.warriorplus_page_enabled` (existing from migration 50) plus new flags:

- `warriorplus_page_enabled` (existing) — Public visibility
- `warriorplus_internal_only` (new) — Restrict to internal users (email allowlist)
- `warriorplus_test_mode_only` (new) — Only accept WP test-mode IPs
- `warriorplus_pays_robinos_affiliate` (new) — Commission exception toggle

**Default during rollout:** All OFF. Enable sequentially.

### 7.4 Database Deployment Procedure

```
1. Take backup (timestamped)
2. Announce maintenance window (or use online migration if supported)
3. Apply migration 51 (event_queue)
4. Verify table exists + indexes
5. Apply migration 52 (product_registry)
6. Verify
7. Apply migration 53 (claims + chargebacks)
8. Verify
9. Apply migration 54 (grants + aux tables)
10. Verify
11. Apply migration 55 (RPCs + triggers)
12. Verify RPCs callable
13. Smoke test: insert test event into queue, process it
14. If any step fails: halt, investigate, rollback if needed
```

### 7.5 Edge Function Deployment Procedure

```
1. Deploy shared modules first (no config needed)
2. Update supabase/config.toml with new function settings
3. Deploy warriorplus-webhook (verify_jwt = false)
4. Deploy warriorplus-build-link (verify_jwt = true)
5. Deploy process-warriorplus-events (verify_jwt = false)
6. Deploy admin-warriorplus (verify_jwt = true)
7. Smoke test each function with curl
8. Verify config.toml correct
9. Update secrets in Supabase Dashboard
```

### 7.6 Worker Cron Deployment

```
1. Deploy cron via Supabase Dashboard or SQL
2. Test with empty queue (should process 0 events)
3. Insert test event manually
4. Verify worker picks up event
5. Monitor first 24 hours closely
```

### 7.7 Smoke Test Procedure

After deployment, before public enable:

```
1. Create test product in warriorplus_product_registry
2. Set warriorplus_test_mode_only = true
3. Initiate test purchase via test WP account
4. Verify event enqueued
5. Verify worker processes within 60 seconds
6. Verify subscription granted
7. Verify magic-link email received (for guest test)
8. Verify claim workflow completes
9. Verify admin pages accessible
10. Verify chargeback handling (test dispute simulation)
```

---

## Phase 8 — Rollback

### 8.1 Rollback Decision Criteria

Rollback if any of:
- Error rate > 5% in first hour after enable
- Event queue grows > 5000 events
- Subscription grants failing (success rate < 95%)
- Magic-link emails not sending
- Admin pages broken
- Chargeback handling incorrect
- Critical security vulnerability discovered

### 8.2 Rollback Levels

#### Level 1: Feature Flag Disable (Immediate, No Data Loss)
**Time to execute:** < 1 minute
**Action:** Set `warriorplus_page_enabled = false`
**Effect:** Public CTA hidden; existing WP purchases continue working
**Use case:** Marketing issue, UI bug, low-severity problem

#### Level 2: Worker Disable (Stops New Processing)
**Time to execute:** < 5 minutes
**Action:** Disable `process-warriorplus-events` cron
**Effect:** Events accumulate in queue; existing entitlements preserved
**Use case:** Worker bug, processing error, downstream issue

#### Level 3: Webhook Reject (Stops New Events)
**Time to execute:** < 5 minutes
**Action:** Update webhook to return 503 immediately
**Effect:** WP retries (will eventually fail after 7 days); existing entitlements preserved
**Use case:** Critical bug in event handling

#### Level 4: Full Database Rollback (DESTRUCTIVE)
**Time to execute:** 30-60 minutes
**Action:** DROP all WP tables (via reverse migrations); revert `safe_plan_switch` modifications (none in V2)
**Effect:** Complete removal of WP integration; users with WP entitlements lose them
**Use case:** Catastrophic failure, security breach
**WARNING:** Data loss. Requires user notification.

### 8.3 Rollback Procedure (Level 1 — Most Common)

```
1. Admin logs in
2. Navigate to /admin/settings
3. Toggle warriorplus_page_enabled = false
4. Click "Save"
5. Verify public CTAs hidden
6. Monitor for 24 hours
7. If issue resolved: investigate, fix, re-enable
8. If issue persists: escalate to Level 2
```

### 8.4 Rollback Procedure (Level 2)

```
1. Admin logs in to Supabase Dashboard
2. Navigate to Database → Cron Jobs
3. Disable process-warriorplus-events cron
4. Verify no new events processed
5. Investigate root cause
6. Fix and re-enable
```

### 8.5 Rollback Procedure (Level 3)

```
1. Update warriorplus-webhook to return 503 for all requests
2. Deploy updated function
3. Existing events in queue still process (if worker is running)
4. Investigate root cause
5. Fix and re-enable
```

### 8.6 Rollback Procedure (Level 4 — Emergency Only)

**Requires:** Engineering lead approval + customer communication

```
1. Take final backup of all WP tables
2. Run reverse migrations:
   - DROP warriorplus_webhook_dead_letter
   - DROP warriorplus_unknown_items
   - DROP warriorplus_sales_ledger
   - DROP user_product_grants
   - DROP warriorplus_chargebacks
   - DROP warriorplus_pending_claims
   - DROP warriorplus_product_registry
   - DROP warriorplus_event_queue
3. Revert platform_settings columns:
   - DROP COLUMN warriorplus_page_enabled
   - DROP COLUMN warriorplus_demo_video_url
4. Revert safe_plan_switch modifications: (none needed — V2 didn't modify)
5. Disable edge functions (delete or set verify_jwt = false with reject logic)
6. Notify all affected users
7. Plan remediation
```

### 8.7 Data Preservation Strategy

For Levels 2-3 (non-destructive), data is preserved:
- Events stay in queue
- Claims stay pending
- Chargebacks stay open
- Subscriptions remain granted

For Level 4 (destructive):
- Backup taken before rollback
- User subscription status preserved via `user_subscriptions` (not dropped)
- WP-specific grants in `user_product_grants` are dropped (users lose those grants)

### 8.8 Communication Plan

**Level 1 rollback:** No user communication (internal issue)
**Level 2 rollback:** No user communication (internal issue)
**Level 3 rollback:** No user communication (internal issue)
**Level 4 rollback:** Mandatory user notification:
- Email to all users with active WP subscriptions
- Status page update
- Public blog post (if material)
- Refund commitments

### 8.9 Post-Rollback Actions

After any rollback:
- [ ] Root cause analysis
- [ ] Fix deployed and tested
- [ ] Post-mortem document written
- [ ] Monitoring enhanced
- [ ] Communication sent to stakeholders

---

## Phase 9 — Launch Checklist

### 9.1 Pre-Launch Validation (Must Pass)

#### Database
- [ ] All 5 migrations applied to production
- [ ] All RPCs callable
- [ ] All triggers firing correctly
- [ ] Indexes created and used (EXPLAIN queries)
- [ ] RLS policies verified
- [ ] No existing data affected (existing subscriptions unchanged)
- [ ] Backup verified

#### Edge Functions
- [ ] All 4 entry points deployed
- [ ] All 11 shared modules deployed
- [ ] `verify_jwt` settings correct in config.toml
- [ ] Secrets set in Supabase Dashboard
- [ ] HMAC algorithm validated against WP documentation
- [ ] CORS headers correct
- [ ] Timeout settings appropriate

#### Frontend
- [ ] All new pages deployed and accessible
- [ ] All modified pages deployed
- [ ] Routing configured
- [ ] Email templates correct
- [ ] Mobile responsive
- [ ] SEO metadata updated
- [ ] Analytics tracking added

#### Admin
- [ ] All admin pages accessible to admin role
- [ ] Permission boundaries verified
- [ ] Audit logging working
- [ ] Bulk actions tested

#### Background Jobs
- [ ] All 5 crons configured
- [ ] Cron schedules verified
- [ ] Worker concurrency tested
- [ ] Email retry queue functional

#### Monitoring & Alerting
- [ ] Queue depth alerts configured
- [ ] Worker failure alerts configured
- [ ] Signature failure alerts configured
- [ ] Unknown item alerts configured
- [ ] Claim expiry alerts configured
- [ ] Chargeback alerts configured
- [ ] Dead letter alerts configured
- [ ] On-call rotation established

#### Security
- [ ] HMAC algorithm verified
- [ ] Rate limiting configured
- [ ] IP whitelisting configured (if applicable)
- [ ] Secrets rotated for production
- [ ] Admin actions audit-logged
- [ ] RLS policies tested for unauthorized access

#### Documentation
- [ ] Architecture docs published
- [ ] Admin user guide written
- [ ] Customer FAQ updated
- [ ] Support runbook created
- [ ] Incident response plan documented
- [ ] Rollback procedure tested

#### Legal & Compliance
- [ ] Terms of Service updated for WP integration
- [ ] Refund policy disclosed
- [ ] Affiliate TOS updated for commission exception
- [ ] GDPR compliance verified (PII handling, data retention)
- [ ] PCI scope confirmed (no card data handled)

### 9.2 Launch Day Procedure

```
T-24h: Final dry-run of all tests
T-12h: Verify all monitoring active
T-4h:  Deploy feature flags (all OFF except internal)
T-2h:  Internal team uses WP, validates flow
T-0:   Enable for beta users (100)
T+2h:  Monitor for issues
T+24h: Beta metrics reviewed
T+7d:  Expand to 1000 users
T+14d: Expand to 10000 users
T+30d: Full public enable
```

### 9.3 Launch Day Monitoring

**Monitor every 15 minutes for first 24 hours:**
- Event queue depth
- Worker success rate
- Magic-link delivery rate
- Admin notifications (any unexpected)
- Error rate by category
- Processing latency (p50, p95, p99)

**Escalation triggers:**
- Any signature failure
- Queue depth > 500
- Worker success rate < 95%
- Any unexpected admin notification type
- Error rate > 2%
- p95 processing latency > 10s

### 9.4 Post-Launch Review

After 30 days:
- [ ] Total WP sales processed
- [ ] Refund rate vs Dodo baseline
- [ ] Chargeback rate vs Dodo baseline
- [ ] Average processing time
- [ ] Magic-link claim completion rate
- [ ] Dead letter events (count and reasons)
- [ ] Admin interventions required (count)
- [ ] Customer support tickets related to WP

### 9.5 Success Metrics (KPIs)

| Metric | Target |
|--------|--------|
| WP sales successfully processed | ≥ 99% |
| Magic-link claim completion rate | ≥ 85% |
| Refund processing accuracy | 100% |
| Chargeback response time | < 24 hours |
| Worker p95 processing time | < 5 seconds |
| Dead letter events per week | < 5 |
| Admin manual interventions per 1000 sales | < 10 |
| Customer support tickets per 1000 sales | < 5 |

### 9.6 Launch Approval

Required sign-offs before public enable:
- [ ] Engineering Lead
- [ ] Product Manager
- [ ] Customer Support Lead
- [ ] Security Reviewer
- [ ] Legal/Compliance
- [ ] Executive Sponsor

---

## Cross-Phase Dependencies

### Dependency Map

```
Phase 1 (Database)
  ├── Phase 2 (Edge Functions) — depends on tables/RPCs
  │     ├── Phase 5 (Background Jobs) — worker depends on functions
  │     │     └── Phase 7 (Deployment) — crons deploy with functions
  │     └── Phase 3 (Frontend) — depends on Edge Function contracts
  │           └── Phase 4 (Admin Panel) — depends on Edge Function + Frontend
  └── Phase 6 (Testing) — depends on all phases being implemented

Phase 7 (Deployment) — depends on all phases complete
Phase 8 (Rollback) — depends on Phase 7 + monitoring
Phase 9 (Launch) — depends on Phases 7 + 8
```

### Critical Path

The critical path to launch:
```
Phase 1 → Phase 2 → Phase 5 (worker) → Phase 6 (testing) → Phase 7 (deploy) → Phase 9 (launch)
```

Phases 3, 4, 8 can proceed in parallel with testing.

---

## Timeline Estimates

### Optimistic Timeline (All Validations Pass)

| Phase | Duration | Notes |
|-------|----------|-------|
| Pre-implementation validation | 1 week | Contact WP, test purchases |
| Phase 1: Database | 1 week | Schema design + RPCs |
| Phase 2: Edge Functions | 2 weeks | All 4 functions + modules |
| Phase 3: Frontend | 1 week | All pages + modifications |
| Phase 4: Admin Panel | 1 week | All admin features |
| Phase 5: Background Jobs | 3 days | Crons + monitoring |
| Phase 6: Testing | 2 weeks | All categories + load test |
| Phase 7: Deployment | 1 week | Staged rollout |
| Phase 8: Rollback prep | Concurrent | Tested before deploy |
| Phase 9: Launch | Ongoing | 30-day public enable |
| **Total** | **~9-10 weeks** | |

### Realistic Timeline (Including Iteration)

| Phase | Duration |
|-------|----------|
| Pre-implementation validation | 2 weeks |
| Phase 1: Database | 1.5 weeks |
| Phase 2: Edge Functions | 3 weeks |
| Phase 3: Frontend | 1.5 weeks |
| Phase 4: Admin Panel | 1.5 weeks |
| Phase 5: Background Jobs | 1 week |
| Phase 6: Testing | 3 weeks |
| Phase 7: Deployment | 1.5 weeks |
| Phase 8: Rollback prep | 1 week |
| Phase 9: Launch (beta) | 2 weeks |
| Phase 9: Launch (public) | 2 weeks |
| **Total** | **~16-20 weeks** |

### Risk-Adjusted Timeline

Add 30% buffer for unexpected issues:
- WP vendor delays
- Unforeseen technical issues
- Testing reveals bugs requiring rework
- Edge cases discovered late

**Risk-adjusted total: ~21-26 weeks (5-6 months)**

---

## Summary

This implementation plan converts the approved V2 architecture into a sequenced, dependency-aware roadmap. All 9 phases have explicit dependencies, deliverables, and exit criteria. The plan emphasizes:

1. **Database-first sequencing** — Schema and RPCs before any consuming code
2. **Modular edge function delivery** — Shared modules before entry points
3. **Worker-before-frontend** — Background processing ready before user-facing changes
4. **Multi-stage rollout** — Internal → Beta → Public with feature flags
5. **Multi-level rollback** — From feature flag to full database rollback
6. **Comprehensive testing** — 50+ test scenarios across 12 categories
7. **Explicit launch criteria** — 30+ checklist items before public enable

**Recommended start:** Pre-implementation validation phase (1-2 weeks), then proceed to Phase 1.

**No SQL, no code, no migrations created.** Planning document only as required.
