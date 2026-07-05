# Milestone 5 — Architecture Review (Pre-Implementation)

**Status:** Review complete. No code written yet.
**Goal:** Determine the minimal set of schema and RPC changes required to deliver M5 (User Resolution) without introducing unnecessary new structures.
**Principle applied:** Reuse first. Extend second. Create new structures only when there is a clear long-term benefit.

---

## 0. TL;DR — Approved Schema Changes

After review, M5 introduces **zero new tables** and **zero new `webhook_events.status` values**.

The minimal additive schema changes are:

| # | Change | Type | Rationale |
|---|---|---|---|
| 1 | `webhook_events.provider_customer_id` (nullable text) | Column add | Capture provider_customer_id when available (mostly NULL for WarriorPlus; future-proofs for Stripe/LS). |
| 2 | `webhook_events.resolution_attempted_at` (nullable timestamptz) | Column add | When M5 ran for this row. |
| 3 | `webhook_events.resolution_outcome` (nullable text + CHECK) | Column add + constraint | One of `resolved_existing_user`, `marked_guest_awaiting_claim`, `resolution_failed`. |
| 4 | `webhook_events.resolution_buyer_email_hash` (nullable text) | Column add | PII-safe lookup before M6 creates `payments.buyer_email_hash`. |
| 5 | `resolve_or_create_user_from_purchase` body replaced | `CREATE OR REPLACE FUNCTION` | Replace M1 stub with real implementation. |
| 6 | `process_webhook_event` body replaced | `CREATE OR REPLACE FUNCTION` | Inline resolution step between validation and final status transition. |
| 7 | `recalculate_user_effective_plan` — **UNCHANGED** | None | Stays a stub. M5 spec does not include entitlement recalculation; M6 owns it. |
| 8 | New `webhook_events.status` value — **NOT ADDED** | None | Reuse existing `verified` and `awaiting_claim` (see §1). |
| 9 | `user_resolution_log` table — **NOT CREATED** | None | Reuse `webhook_events` columns + existing audit infrastructure (see §2). |
| 10 | `provider_customer_links` table — **NOT CREATED** | None | Defer to M6/M7 when a second provider actually needs it (see §3). |

---

## 1. Question 1 — Is a new `identity_resolved` webhook status necessary?

### Current state of the world

The `webhook_events.status` enum (migration 52, unchanged since M1) contains:

```
'received', 'validating', 'verified', 'processing', 'processed', 'duplicate',
'failed_retryable', 'failed_terminal', 'blocked', 'awaiting_claim', 'awaiting_admin'
```

Migration 56 (M4) deliberately leaves rows at `status='verified'` as the **M5+ handoff point** (see migration 56 comment: *"The 'verified' status is the handoff point: M5+ reads rows in status='verified' and runs its own pipeline."*).

### Original proposal

Add `identity_resolved` between `verified` and M6's work. This would require:
- `ALTER TYPE` on the `webhook_events_status_check` CHECK constraint
- New partial indexes for queue scans
- Updates to M4/M6/M7/M8/M9/M10/M11 docs and worker code

### Alternatives considered

| Alternative | Description | Verdict |
|---|---|---|
| **A. Add `identity_resolved`** | New status between verified and M6 | Adds 1 enum value, 1+ indexes, touches every downstream milestone. |
| **B. Reuse `verified` with `linked_user_id` populated** | Existing user → status stays `verified`, `linked_user_id` set; guest → `awaiting_claim`. | **Chosen.** |
| **C. Use both `verified` and `awaiting_claim` only** | Same as B. | Same as B. |

### Decision: Do NOT add `identity_resolved`. Reuse `verified` + `awaiting_claim`.

**Why B works:**
- The M5 spec ("Mark the webhook ready for purchase creation") is naturally expressed as "populate `linked_user_id` while in `verified` state". The presence of `linked_user_id` IS the "ready for purchase creation" mark.
- The M5 spec ("Keep the purchase pending ownership" for unknown buyers) maps directly to the existing `awaiting_claim` status, which M3 design §2.2 already documented as the guest-claim state used by M9.
- M4's handoff contract ("rows at `verified` are M5+ inputs") is preserved — `verified` becomes "payload valid AND identity resolved to existing user", which is strictly more refined than the M4 contract.
- Downstream milestones (M6, M7, M8) already filter M5 output by `linked_user_id IS NOT NULL` or `status='awaiting_claim'`. No new queue scans.

**Why was the new status originally proposed?**
For monitoring clarity — to be able to count "rows waiting for M5 retry" separately from "rows that have completed M5 but waiting for M6". This is satisfied by `resolution_outcome` column (proposal §2 below) without an enum change.

**What would happen if we did add it?**
- Mild improvement to dashboards (could filter `status='identity_resolved'` directly).
- Cost: schema migration on the CHECK constraint, partial index updates, comment updates in 8+ docs and migration files, mental overhead for every future operator reading the status enum.
- Rejected because the marginal observability gain doesn't justify the cross-cutting change.

---

## 2. Question 2 — Is a new `user_resolution_log` table required?

### Current audit infrastructure

| Source | Captures | Does NOT capture |
|---|---|---|
| `webhook_events.linked_user_id` | Final user linkage | Email matched, attempt history |
| `webhook_events.status` | Lifecycle state | Resolution outcome detail |
| `webhook_events.error_history` (jsonb) | Append-only error log | Resolution audit |
| `webhook_events.last_error` | Latest error | Resolution outcome |
| `webhook_events.raw_payload` | Original webhook (PII preserved) | Resolution-specific context |
| `webhook_events.processed_at` | When fully processed | When resolution specifically ran |

### What M5 needs to audit

For each webhook where M5 ran:
1. **When** did resolution run? (separate from `processed_at`, which doesn't exist until M6.)
2. **What was the outcome?** Three possible: resolved to existing user / marked as guest / failed.
3. **What email was matched?** (PII-safe hash for admin search before M6 creates `payments.buyer_email_hash`.)
4. **What `provider_customer_id` was captured?** (NULL for WarriorPlus; non-NULL for Stripe/LS later.)

### Original proposal

A new `user_resolution_log` table with one row per resolution attempt, including the fields above plus attempt history.

### Alternatives considered

| Alternative | Description | Verdict |
|---|---|---|
| **A. New `user_resolution_log` table** | Multi-row history per webhook_event | Rejected — over-modeled for M5. |
| **B. New columns on `webhook_events`** | 4 columns (see §0) | **Chosen.** |
| **C. Rely only on existing columns** | `linked_user_id` + `status` + `error_history` | Insufficient — can't distinguish "M5 didn't run yet" from "M5 ran and marked guest". |

### Decision: Add 4 columns to `webhook_events`. No new table.

**Why columns win over a new table:**
- **One resolution per webhook_event is the M5 contract.** There is no realistic need for multiple attempts on the same row — the M4 retry mechanism handles transient failures at the row level, not the resolution level. If resolution fails, the row goes to `failed_retryable` and the entire `process_webhook_event` re-runs (validation + resolution atomically). A multi-row history table is modeling a problem that doesn't exist.
- **Strong 1:1 cardinality** between `webhook_events` and resolution outcome. They have the same primary key conceptually.
- **Existing audit columns** (`error_history`, `linked_user_id`, `last_error`) already follow the "columns on the parent row" pattern. M5 fits that pattern.
- **No JOIN cost** for admin queries that already scan `webhook_events`.

**Why was the table originally proposed?**
Concern about preserving attempt history. After review: M4's retry mechanism makes this unnecessary. If resolution fails for transient reasons, the row retries as a unit (validation + resolution); there is no "partial resolution state" to preserve.

**What would happen if we did add the table?**
- Future operators would need to JOIN `webhook_events` and `user_resolution_log` for every diagnostic query.
- The table would have exactly one row per `webhook_events.id` in 99.9% of cases (one-shot resolution), making the JOIN overhead pure ceremony.
- Rejected on reuse-first grounds.

**Why does each column earn its place?**

| Column | Why needed | What existing structure was considered | Why reuse was rejected | Future problem solved | What if we did not add it |
|---|---|---|---|---|---|
| `provider_customer_id` | Provider sends it; M5 is the earliest point we see it. | `user_subscriptions.provider_customer_id` (M6 creates it); `payments.raw_provider_payload` (PII). | M6's column doesn't exist yet; raw_payload is opaque PII, not queryable. | Lets M6 promote it to `user_subscriptions.provider_customer_id` without re-parsing. | Must re-parse raw_payload in M6. Loses value if multiple webhooks for same customer arrive between M5 and M6. |
| `resolution_attempted_at` | Observability: "when did M5 actually run?" | `webhook_events.verified_at` (already exists, set by M4). | That timestamp conflates validation and resolution; we need a distinct resolution timestamp for SLA monitoring. | Per-row M5 latency tracking; admin can identify rows that took >30s in M5. | Cannot distinguish slow M5 from slow M6. |
| `resolution_outcome` | Three states: existing user / guest / failed. | `webhook_events.status` (`verified` vs `awaiting_claim` vs `failed_*`). | Status encodes the outcome already, but doesn't capture "resolution_failed" cleanly (it's covered by `failed_retryable`/`failed_terminal` which encode M4-level failures). | Clean enum for monitoring: `select count(*) from webhook_events where resolution_outcome='resolved_existing_user'`. | Cannot easily answer "how many guests last week". |
| `resolution_buyer_email_hash` | Admin search before M6 runs. | `payments.buyer_email_hash` (M6 creates it); `idx_profiles_email` on profiles (different lookup target). | Pre-M6 there is no payments row to hash. Profiles index requires the email to already be associated with a profile. | Lets admins answer "show all webhooks for buyer X" before M6 completes. | Admin cannot diagnose guest-claim issues until M6 completes the purchase record. |

---

## 3. Question 3 — Is a dedicated `provider_customer_links` table necessary for WarriorPlus?

### What WarriorPlus actually sends

Per M3 design doc §15.8 (already approved): *"WP does not send a stable customer identifier. User resolution in M5 will key on WP_BUYER_EMAIL alone."*

WarriorPlus IPN fields include:
- `WP_BUYER_EMAIL` — primary identifier (used by M5)
- `WP_BUYER_NAME` — display name
- **No `WP_BUYER_ID` or `WP_CUSTOMER_ID`** — confirmed in approved M3 assumptions.

### What other (future) providers send

- Stripe: `customer` ID like `cus_abc123` — stable across multiple charges
- LemonSqueezy: `customer_id` — stable
- Whop: `user_id` — stable

These providers DO send a stable customer identifier that should outlive any single purchase.

### When does `provider_customer_id` become available downstream?

- `user_subscriptions.provider_customer_id` — column exists (migration 01), but the row is only created by M6 if a subscription exists.
- For one-time purchases: no subscription row exists; only `payments.raw_provider_payload` (PII) holds the data.

### Original proposal

A new `provider_customer_links` table:
```sql
create table provider_customer_links (
  provider_id text,
  provider_customer_id text,
  user_id uuid references auth.users(id),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  primary key (provider_id, provider_customer_id)
);
```

### Alternatives considered

| Alternative | Description | Verdict |
|---|---|---|
| **A. New `provider_customer_links` table** | Persistent provider → user mapping | Rejected for M5. Defer to M6/M7. |
| **B. Column on `webhook_events`** | Capture once per webhook | **Chosen for M5.** |
| **C. Nothing — capture into raw_payload only** | Rely on existing preservation | Rejected — see below. |

### Decision: Do NOT add the table. Add a single `webhook_events.provider_customer_id` column.

**Why the table is rejected for M5:**
- **WarriorPlus never populates it.** The first supported provider sends no customer_id at all. The table would be empty on day 1 of M5.
- **The actual mapping problem (provider_customer_id → user_id)** only emerges when multiple webhooks arrive for the same customer and we need to deduplicate. That's an M6+ problem (specifically, M7 reconciliation or M10 affiliate consistency). Solving it now is speculative — we don't even know what the second provider's customer_id format will look like.
- **`user_subscriptions.provider_customer_id` already exists** as the natural storage location once M6 creates subscriptions. If multiple purchases reference the same customer, the join via `user_id + provider` on `user_subscriptions` works.
- **For one-time purchases**, the only place `provider_customer_id` ever lives today is `payments.raw_provider_payload`. Adding a queryable column on `webhook_events` is the minimum surface area to make M5's data visible without re-parsing PII later.

**Why the column earns its place even though WarriorPlus doesn't send one:**
- It costs nothing on WarriorPlus rows (NULL).
- It future-proofs M5's contract: "we capture `provider_customer_id` when present". Stripe/LS implementations will write to it.
- It avoids re-parsing `raw_payload` in M6/M7/M10.

**What was considered (existing structures):**
- `user_subscriptions.provider_customer_id` — exists but the row doesn't exist for one-time purchases. Wrong lifecycle.
- `payments.raw_provider_payload` — exists, contains the customer_id, but is jsonb PII (not indexable / queryable).
- Nothing else captures this data point.

**What would happen if we did add the table?**
- Empty for WarriorPlus (current scope).
- Schema overhead (RLS policies, indexes, FK to auth.users).
- Risk of two sources of truth (`webhook_events.provider_customer_id` AND `provider_customer_links`).
- Speculative modeling — the second provider hasn't been implemented.

**When SHOULD this table exist?**
When we implement Stripe or LemonSqueezy (post-M10). At that point we'll have:
- Two or more providers sending `provider_customer_id`.
- A concrete need to look up "which user is provider X's customer Y" without joining through payments or subscriptions.
- Empirical data on the cardinality and access patterns.

That decision belongs to the provider-integration milestone, not M5.

---

## 4. Question 4 — Can the current worker pipeline be extended without introducing unnecessary complexity?

### Current M4 worker pipeline

`process_webhook_event()` (migration 56) per row:
1. Claim row (`FOR UPDATE SKIP LOCKED` + stale lock recovery).
2. Acquire lock, `status → 'processing'`.
3. Validate payload SHA-256, provider enabled.
4. `status → 'verified'`, release lock.
5. Return JSONB.

The M4 worker (TS edge function) calls this in a loop with structured logging.

### Two ways to extend for M5

| Option | Description | Verdict |
|---|---|---|
| **A. Inline extension (single RPC)** | `process_webhook_event` is `CREATE OR REPLACE`d to add a resolution step after validation. | **Chosen.** |
| **B. Two-stage pipeline (separate RPC)** | M4 leaves rows at `verified`. A new `resolve_webhook_user_identity` RPC runs separately. | Rejected. |

### Why Option A is much simpler

- **Atomicity**: validation + resolution happen in one transaction. If resolution fails for transient reasons, M4's existing retry mechanism re-runs the entire flow. No partial state.
- **Single status transition path**: rows only become `verified` (or `awaiting_claim`) when both validation AND resolution succeed. No "stuck at `verified` forever waiting for someone to call resolve" failure mode.
- **No new top-level RPC**: `resolve_or_create_user_from_purchase` becomes an internal helper called by `process_webhook_event`. The worker doesn't need to know about it.
- **Same worker code**: `process-webhook-worker` (TS) requires zero changes. It still calls `process_webhook_event()` in a loop; the resolution is hidden inside.
- **Idempotency is automatic**: `process_webhook_event` is already idempotent (re-running produces the same outcome). M5 inherits this.
- **Failure handling is unified**: transient failures go through `schedule_webhook_retry` (already implemented in M4). Validation failures (e.g., buyer email malformed) join the existing dead-letter path. No new error taxonomy.

### Why Option B is rejected

- Two transactions = two failure windows. A row can be at `verified` with no `linked_user_id` if the M5 RPC was never called or failed terminally.
- Requires a second worker tick or a second cron job. Doubles operational complexity.
- Requires a separate `resolve_webhook_user_identity` RPC, a separate queue scan filter, and a separate `linked_user_id IS NULL` claim query.
- All this complexity to keep M4 unchanged — but M4's contract ("rows at `verified` are M5+ handoff") already explicitly anticipates M5 changing the worker. There is no value in preserving M4's body.

### What was reused

- `process_webhook_event` skeleton (claim → lock → validate) — reused verbatim from M4.
- `schedule_webhook_retry` (M4) — reused for transient resolution failures.
- `mark_webhook_dead_letter` (M4) — reused for terminal resolution failures.
- `get_webhook_queue_stats` (M4) — reused for M5 health checks (no change).
- `webhook_events.linked_user_id` (migration 52) — reused for the resolution output. Already FK'd to `auth.users`.

### What new code is required inside `process_webhook_event`

```
+-- Step 3b-1: Extract buyer_email + buyer_name from raw_payload via provider adapter
+-- Step 3b-2: Resolve user via resolve_or_create_user_from_purchase()
+-- Step 3b-3: If resolved → UPDATE linked_user_id, status='verified'
+--            If guest    → UPDATE linked_user_id=NULL, status='awaiting_claim'
+--            If failed   → dead-letter or retry (existing path)
```

The `resolve_or_create_user_from_purchase` call is the only genuinely new logic; everything else is a status assignment and a column update.

---

## 5. Final M5 Architecture (Approved)

### 5.1 Schema additions

**File: `supabase/migrations/57_user_resolution.sql`**

```sql
begin;

-- 1. Extend webhook_events with resolution columns
alter table public.webhook_events
  add column if not exists provider_customer_id          text,
  add column if not exists resolution_attempted_at       timestamptz,
  add column if not exists resolution_outcome            text
    constraint webhook_events_resolution_outcome_check
      check (resolution_outcome is null or resolution_outcome in (
        'resolved_existing_user',
        'marked_guest_awaiting_claim',
        'resolution_failed'
      )),
  add column if not exists resolution_buyer_email_hash   text;

-- 2. Indexes for M5 queries
create index if not exists idx_webhook_events_resolution_outcome
  on public.webhook_events (resolution_outcome, resolution_attempted_at desc)
  where resolution_outcome is not null;

create index if not exists idx_webhook_events_resolution_email_hash
  on public.webhook_events (resolution_buyer_email_hash)
  where resolution_buyer_email_hash is not null;

-- 3. Replace M1 stub with real implementation
create or replace function public.resolve_or_create_user_from_purchase(
  p_buyer_email          text,
  p_buyer_name           text,
  p_provider_id          text,
  p_provider_customer_id text default null,
  p_create_if_missing    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  -- (Implementation TBD — see §5.3)
$$;

grant execute on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) to service_role;

-- 4. Extend M4 worker to call M5 resolution step
create or replace function public.process_webhook_event(
  p_webhook_event_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  -- (Implementation TBD — see §5.3)
$$;

grant execute on function public.process_webhook_event(uuid) to service_role;

commit;
```

### 5.2 What is NOT added (and why)

| Not added | Reason |
|---|---|
| `webhook_events.status = 'identity_resolved'` | Reuse `verified` + `awaiting_claim` (see §1). |
| `user_resolution_log` table | Reuse `webhook_events` columns (see §2). |
| `provider_customer_links` table | Defer to M6/M7 when a non-WarriorPlus provider ships (see §3). |
| `recalculate_user_effective_plan` implementation | Out of M5 scope. M5 spec excludes plan switching / entitlement granting. M6 owns it. |
| New `resolve_webhook_user_identity` RPC | Inline into `process_webhook_event` (see §4). |
| New indexes beyond the two above | Existing `idx_webhook_events_queue` and `idx_webhook_events_retry` cover M5's scan patterns. |

### 5.3 RPC behavioral contracts

#### `resolve_or_create_user_from_purchase(p_buyer_email, p_buyer_name, p_provider_id, p_provider_customer_id, p_create_if_missing)`

| Input | Treatment |
|---|---|
| `p_buyer_email` | Trimmed + lowercased before matching. NULL → error. Empty → error. |
| `p_buyer_name` | Stored only when guest flow triggers. NULL allowed. |
| `p_provider_id` | Must exist in `payment_providers` (FK validates via existing constraint elsewhere). NULL → error. |
| `p_provider_customer_id` | Stored only on the calling row when non-NULL. NULL allowed (WarriorPlus). |
| `p_create_if_missing` | M5 always passes `false`. M9 (claim flow) will pass `true`. Stub for forward compat. |

| Output | jsonb |
|---|---|
| Existing user found | `{"outcome": "resolved_existing_user", "user_id": "<uuid>", "buyer_email": "<lower>", "matched_by": "email"}` |
| No match | `{"outcome": "marked_guest_awaiting_claim", "user_id": null, "buyer_email": "<lower>", "buyer_name": "<name or null>", "provider_customer_id": "<id or null>"}` |
| Multiple matches | `{"outcome": "resolution_failed", "error": "ambiguous_match", "match_count": N}` — caller treats as terminal/dead-letter. |

#### `process_webhook_event(p_webhook_event_id)`

Same M4 contract. M5 changes:
- After successful validation, call `resolve_or_create_user_from_purchase`.
- On `resolved_existing_user`: set `linked_user_id`, `resolution_outcome='resolved_existing_user'`, `resolution_attempted_at=now()`, `provider_customer_id=<value or null>`, `resolution_buyer_email_hash=<sha256(email)>`, `status='verified'`.
- On `marked_guest_awaiting_claim`: set `linked_user_id=null`, `resolution_outcome='marked_guest_awaiting_claim'`, `resolution_attempted_at=now()`, `provider_customer_id=<value or null>`, `resolution_buyer_email_hash=<sha256(email)>`, `status='awaiting_claim'`.
- On `resolution_failed` (ambiguous_match): dead-letter via `mark_webhook_dead_letter` (same path as M4 validation failures).
- Transient errors (DB blip, etc.): `schedule_webhook_retry` (same path as M4 transient failures).

### 5.4 Worker integration

**File: `supabase/functions/process-webhook-worker/index.ts`**

**Zero changes required.** The TS worker calls `process_webhook_event()` in a loop; the M5 logic is inside the SQL function. The worker's structured log events gain one new optional field (`resolution_outcome` from the RPC JSONB response) but the loop structure is unchanged.

### 5.5 Idempotency guarantees

- **Per-webhook**: `process_webhook_event` is wrapped in a transaction (migration 56). Resolution either fully completes or fully rolls back.
- **Per-user-resolution**: `resolve_or_create_user_from_purchase` is read-only against `auth.users`. No row is created. Repeated calls with the same email return the same `user_id`.
- **Cross-webhook**: Two webhooks for the same buyer resolve to the same `user_id` independently. No state is shared.
- **Retry safety**: A row in `failed_retryable` from a transient resolution error re-runs both validation and resolution on the next worker tick. Outcomes are deterministic given the same input.

### 5.6 Security posture

| Threat | Defense |
|---|---|
| Attacker claims victim's purchase by spoofing email | Attacker cannot reach M5; M3 requires valid webhook signature. Email lookup uses only verified webhook data. |
| Ambiguous identity (multiple `auth.users` match the same email) | Resolution fails with `ambiguous_match`; webhook dead-letters; admin must investigate via M11 diagnostics. No silent merging. |
| Account hijacking via email collision | M5 only reads; M9 is the only flow that ever creates `auth.users` rows from a purchase email. M5 never calls `auth.admin.createUser`. |
| Trusting client-provided identifiers | Resolution uses `webhook_events.raw_payload` which is the provider-verified body. No HTTP request body, no header, no query param enters the lookup. |
| Audit tampering | Resolution state lives on `webhook_events` which is append-mostly and admin-audited. No separate log to tamper with. |

### 5.7 Observability

- `select resolution_outcome, count(*) from webhook_events where resolution_attempted_at > now() - interval '1 day' group by 1;` — daily M5 outcome distribution.
- `select count(*) from webhook_events where status='awaiting_claim';` — guest-claim backlog (M9 input).
- `select count(*) from webhook_events where resolution_outcome='resolution_failed';` — admin intervention queue (M11).
- `webhook_events.linked_user_id IS NOT NULL` — existing users linked.

---

## 6. Out of Scope (Unchanged from M5 Spec)

M5 does NOT implement:
- Purchase creation (M6)
- Payment recording (M6)
- Subscription creation (M6)
- Plan switching (M6)
- Entitlement granting (M6)
- Refund handling (M7)
- Dispute handling (M8)
- Affiliate commissions (M10)
- Email sending (M9)
- Account creation (M9) — `auth.users` rows are never created by M5

---

## 7. Deliverables Checklist (Reaffirmed)

- [ ] Migration 57 (additive, no destructive changes)
- [ ] Updated M4 RPC `process_webhook_event` (real M5 logic inline)
- [ ] Real implementation of `resolve_or_create_user_from_purchase`
- [ ] Stub for `recalculate_user_effective_plan` UNCHANGED (M6 owns)
- [ ] Vitest test suite for M5 logic (TS unit tests where possible; SQL integration tests via psql)
- [ ] Rollback section appended to migration 57
- [ ] `.kimchi/docs/milestone-5-rollout-runbook.md` (staging → prod)
- [ ] `.kimchi/docs/milestone-5-testing-checklist.md` (operator + automated)

---

## 8. Open Decisions Deferred

These were considered and explicitly deferred to later milestones:

| Decision | Owner | Why deferred |
|---|---|---|
| `provider_customer_links` table design | M6/M7 | No second provider in M5; speculative modeling rejected. |
| Email normalization rules (e.g., Gmail dot/`+alias` handling) | M5 impl detail | Implementation will use `lower(trim())`. Alias handling is a separate audit task. |
| `recalculate_user_effective_plan` semantic | M6 | M5 doesn't grant entitlements; this stub stays until M6 owns it. |
| Guest claim token TTL / claim URL design | M9 | M5 only stores `awaiting_claim`; M9 builds the claim flow. |

---

## 9. Review Sign-Off

This document reviewed against the principle: **Reuse first. Extend second. Create new structures only when there is a clear long-term benefit.**

Result: 4 columns added, 0 tables created, 0 status values added, 2 RPCs replaced. The entire M5 schema footprint fits in one migration file.

**Awaiting approval to proceed with implementation.**
