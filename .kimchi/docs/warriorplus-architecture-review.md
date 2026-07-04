# RobinOS — WarriorPlus Architecture Review

**Review-only document. No code modified, no migrations generated, no implementation.**

**Document under review:** `.kimchi/docs/warriorplus-architecture-design.md` (1,810 lines)
**Reviewer perspective:** Principal Software Architect preparing for production
**Review date:** 2026-07-03
**Verdict:** See §9

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Correctness Review](#1-correctness-review)
3. [Security Review](#2-security-review)
4. [Reliability Review](#3-reliability-review)
5. [Scalability Review](#4-scalability-review)
6. [Maintainability Review](#5-maintainability-review)
7. [Data Integrity Review](#6-data-integrity-review)
8. [Architecture Smells](#7-architecture-smells)
9. [Production Readiness Scoring](#8-production-readiness-scoring)
10. [Final Verdict](#9-final-verdict)
11. [Required Changes Before Implementation](#10-required-changes-before-implementation)

---

## Executive Summary

The architecture design demonstrates strong understanding of marketplace payment flows, the existing RobinOS payment infrastructure, and security fundamentals. The **hybrid identity strategy**, **9-state IPN pipeline**, and **default-suppress-commission** decision are all defensible.

However, the document contains **5 critical bugs** that would cause production incidents, **3 high-impact missing components** that block implementation, **11 medium-severity gaps**, and several **architectural smells** that will create maintenance burden. The design also has a **single unverified assumption** that the entire security model depends on, and **3 logical inconsistencies** between sections.

The design is **not ready for implementation** as written. It needs targeted fixes to the critical bugs and additions for the missing components before any code is written.

---

## 1. Correctness Review

### 1.1 Critical Bugs (Must Fix)

#### Bug #1: Out-of-Order Event Handling Has Data Loss
**Location:** §3.4, §9.5 (Out-of-Order Events)
**Severity:** CRITICAL

The design says: "What if RFND arrives before SALE? ... RFND IPN: try to find subscription → not found → log + notify admin. ... SALE IPN: process → grant plan (after admin manually resolves refund)."

**Problem:** This loses the refund. The SALE IPN will grant a plan to a user who already received a refund. The buyer gets free access with no record of the refund existing.

**Real-world scenario:** WP retry storm after network partition sends RFND first (oldest event), then SALE (newest, was previously failed). Order is non-deterministic.

**Fix:** Create the subscription record FIRST (in pending state) when RFND arrives for a non-existent subscription, then apply SALE. Or: queue events per `txn_id` in order, process sequentially.

**Recommendation:** Use a per-`txn_id` event log table that records all events in order, with a state machine that replays events in sequence. Or, defer RFND/CGBK processing until the SALE has been applied (using a retry queue with backoff).

---

#### Bug #2: Composite Event ID Collisions for Repeated Partial Refunds
**Location:** §9.2 (Idempotency Strategy)
**Severity:** CRITICAL

The `provider_event_id` is computed as `txn_id + ":" + event_type + ":" + amount`.

**Problem:** If WP sends two RFND events for the same amount (e.g. two $10 partial refunds of a $20 sale), they have the SAME `provider_event_id`. The second one is deduplicated as a "duplicate" — but it's a distinct financial event.

**Real-world scenario:** Customer refunds $10 twice (e.g. dispute resolution + new refund request). Both legitimately processed by WP. RobinOS only records the first.

**Fix:** Include a sequence number or timestamp from WP in the composite ID. For example: `sha256(txn_id + ":" + event_type + ":" + amount + ":" + timestamp)`. Or use a WP-provided event sequence number if available.

---

#### Bug #3: Assumption That WarriorPlus Preserves URL Query Params
**Location:** §1.3, §2.2 Step 5
**Severity:** CRITICAL — entire identity strategy depends on this

The signed `rbin_uid` mechanism requires WarriorPlus to preserve custom query parameters through their checkout flow. **This is not documented in WP's vendor documentation as a guaranteed behavior** — many networks strip or filter unrecognized parameters for security reasons.

**Problem:** If WP strips `rbin_uid`, `rbin_sig`, `rbin_email`, `rbin_exp`, `rbin_ref`, then the entire signed URL strategy fails and EVERY purchase falls back to email matching (Option A) — which is the spoofable path.

**Fix:** Before implementation, conduct a test purchase and verify all 5 custom params survive through to the IPN. If they don't, the architecture must be redesigned around email-only identity + claim workflow.

**Recommendation:** Treat signed params as **best-effort optimization**, not the primary identity path. The PRIMARY identity path must be email matching with a strong claim workflow. Signed params become a UX enhancement, not a security control.

---

#### Bug #4: One-Time Refund Doesn't Revert to Free
**Location:** §7.2 (Refund Lifecycle), Step 3 (FULL REFUND)
**Severity:** HIGH

The design says: "FULL REFUND: ... DO NOT immediately revert to free (preserve access until current period ends — matches Dodo behavior)."

**Problem:** This logic only makes sense for subscriptions. For one-time purchases (lifetime access), there is no "current period end" — the access is permanent. A full refund of a one-time purchase should immediately revert to free. Otherwise, the user has full access forever despite being refunded.

**Fix:** Branch the refund handler on `billing_cycle`:
- `billing_cycle IN ('monthly', 'yearly')`: preserve access until `expires_at` (current behavior)
- `billing_cycle = 'one_time'`: immediately revert to free + revoke access

**Related issue:** The audit shows `expires_at` would be set to ~36500 days for one-time. A refund check needs to handle this. Better: use `NULL` `expires_at` for lifetime.

---

#### Bug #5: Subscription Overwrite Logic Breaks Upgrades
**Location:** §6.5 (Edge Cases — "User Already Has Dodo Subscription → Buys on WarriorPlus")
**Severity:** HIGH

The design says: "do not overwrite — return 200 to WP (acknowledged) but log 'duplicate subscription attempted'."

**Problem:** This breaks legitimate upgrade flows. If a user is on Creator ($19) via Dodo and wants to upgrade to Pro Creator ($39) via WarriorPlus, the purchase is silently rejected. The user paid money but got nothing.

**Fix:** Detect plan tier, not just existence of subscription:
- Same plan + same provider → reject (true duplicate)
- Same plan + different provider → allow (user chose different provider)
- Higher tier (upgrade) → allow
- Lower tier (downgrade) → allow with cooldown check
- Any existing paid plan + new WP purchase of any tier → grant and update (consistent with Dodo behavior)

---

### 1.2 Logical Flaws

#### Flaw #1: Guest Claim Email Goes to Wrong Recipient
**Location:** §1.3 (Tertiary: Claim token fallback), §5.5
**Severity:** HIGH

The claim email is sent to `buyer_email` from the WP IPN. But this is the email the buyer used **on WarriorPlus**, which may be different from the email they use (or want to use) on RobinOS.

**Scenario:** Buyer purchases on WP using `personal@gmail.com`. They have a RobinOS account under `work@gmail.com`. The claim email goes to personal@gmail.com. The buyer never sees it.

**Fix:** The claim workflow must:
1. Allow the buyer to enter a DIFFERENT email during claim (the one they want to use on RobinOS)
2. Verify ownership of that email (magic link sent to the entered email)
3. Match the WP purchase to the RobinOS account only after BOTH emails are verified

Or simpler: the claim page asks "What email did you use on RobinOS?" and the buyer enters it. RobinOS sends a confirmation to THAT email. Only when the buyer confirms does the claim complete.

---

#### Flaw #2: Default "Suppress Commission" Breaks Affiliate Expectations
**Location:** §6.2, §6.3
**Severity:** MEDIUM (business impact)

The design defaults to **suppressing** RobinOS affiliate commission for all WP sales. But existing RobinOS affiliates expect to be credited for any sale they refer — they don't know which provider the buyer ultimately uses.

**Problem:** Affiliate Joe shares his `?ref=JOE001` link. Buyer clicks, buys on RobinOS via WarriorPlus (not knowing about the dual-provider setup). Joe gets no credit. Joe complains.

**Fix options:**
- Document this clearly in the affiliate program terms (acceptable but may reduce affiliate recruitment)
- Track WP sales separately and offer affiliates a different commission rate for WP-driven sales
- Always attribute to RobinOS affiliate if `rbin_ref` was set (regardless of provider), and only suppress if buyer came directly via WP without RobinOS referral

**Recommendation:** Adopt the third option. The `rbin_ref` is a clear signal that RobinOS affiliate was involved. If absent, suppress. If present, pay commission (potentially at a reduced rate like 15% instead of 30% to account for WP's commission).

---

#### Flaw #3: Chargeback "Preserve Access During Dispute" Is a Loss
**Location:** §8.2
**Severity:** HIGH (financial)

The design says: "DO NOT revert to free yet — wait for dispute resolution."

**Problem:** The buyer's bank has taken the money back from RobinOS. The buyer keeps full access for 60-120 days during dispute. The user has every incentive to maximize usage of the (now free) service. Even if RobinOS wins the dispute eventually, the buyer has been using the service without paying for 2-4 months.

**Fix:** Immediate downgrade to free on chargeback. If dispute is won, restore subscription via `safe_plan_switch`. This is the standard practice for SaaS companies.

---

#### Flaw #4: Normalized Event Type "subscription.activated" Not in Canonical Set
**Location:** §4.3 (Event Type Mapping)
**Severity:** LOW (cosmetic but reveals design gap)

The mapping shows `SALE → subscription.activated` but RobinOS's canonical status values are: `active`, `trialing`, `expiring`, `grace_period`, `expired`, `cancelled`, `canceled`, `payment_failed`, `past_due`, `suspended`, `paused`. There is no `activated`.

**Problem:** When `safe_plan_switch` is called with `status = 'active'`, the audit log will show `new_status = 'active'`, not `activated`. The mapping is inconsistent.

**Fix:** Map `SALE → subscription.active` (the actual DB status) for clarity.

---

### 1.3 Missing Edge Cases

1. **WP sends event for a subscription that was already cancelled/refunded** — No handler defined. What happens?
2. **User changes email between purchase and claim** — Buyer purchases on WP with email A, then changes email to B before claiming. Claim workflow needs to handle this.
3. **Concurrent IPNs for the same txn_id** — Two IPNs arrive in parallel (SALE + BILL). The race between `record_webhook_event` calls is handled, but the race between state mutations is not explicitly addressed.
4. **IPN arrives with negative amount** — Data validation should reject, but not specified.
5. **IPN with amount in different currency than expected** — No FX handling. If WP sends EUR and plan is priced in USD, what conversion is used?
6. **WP sends multiple SALE events for same txn_id** — Possible if there's a system bug on WP side. Idempotency catches this, but worth documenting.
7. **Buyer uses a temporary/disposable email** — Claim emails bounce. Purchase remains unclaimed. No retry strategy.
8. **Admin manually grants subscription that conflicts with WP sale** — Race condition. Two paths to grant entitlement.
9. **Buyer purchases multiple WP products in same transaction** — Single txn_id with multiple item_ids. Not handled.
10. **User has multiple RobinOS accounts with same email** — Mentioned as "rare but possible" but no resolution strategy.
11. **WP changes their event type names or payload format** — No version handling. Schema changes break the integration.
12. **IPN arrives for a product that was removed from WP** — Should not grant entitlement even if item_id exists in RobinOS registry.

### 1.4 Invalid Assumptions

1. **Assumption:** WarriorPlus preserves URL query params. (See Bug #3)
2. **Assumption:** WarriorPlus uses `sha256(api_key + ":" + txn_id + ":" + amount)` for cverify. (See §12.1 — explicitly noted as assumption)
3. **Assumption:** WarriorPlus retries with the documented exponential backoff. (May differ in practice)
4. **Assumption:** WP provides `dispute.won` and `dispute.lost` events. (Not confirmed)
5. **Assumption:** WP charges $15-25 chargeback fees. (May vary by region/payment method)
6. **Assumption:** The 1-year signature expiry (1h) is sufficient. (Some users complete checkout slowly)
7. **Assumption:** Buyers will check the email address WP used. (They often don't)
8. **Assumption:** WP sends `PYMT-REBILL` for all subscription rebills. (Some providers don't)

### 1.5 Race Conditions

1. **Two IPNs for same buyer arrive in parallel** — Both try to create pending claim simultaneously. Need unique constraint on `(provider, provider_txn_id)` for `warriorplus_pending_claims`.
2. **IPN arrives while user is being created via claim flow** — Race between auto-grant and claim-initiated grant. Double entitlement possible.
3. **Admin manually links a purchase while IPN processing is in flight** — Two grants of same entitlement.
4. **Subscription plan downgrade race** — If user downgrades via Dodo (sets cooldown_until = now + 14d) and simultaneously receives WP IPN for higher tier, the WP grant may fail the cooldown check.
5. **Email match race** — Two IPNs for different WP purchases from the same buyer arrive simultaneously. Both attempt email-based identity resolution. Should be serialized or use row-level locking.

---

## 2. Security Review

### 2.1 HMAC Verification — Critical Gap

**The ENTIRE security model depends on the verification algorithm being correct.** The design admits (§12.1): "This is an **assumption** based on standard IPN patterns. WP may use a different algorithm."

**Problem:** Building production security on an unverified assumption is unacceptable. The verification function will likely be implemented as a placeholder, then "fixed" later when the actual algorithm is discovered. This is exactly how security incidents happen.

**Mandatory pre-implementation step:** Contact WarriorPlus vendor support, request the exact IPN verification algorithm documentation, and confirm before any code is written. If they don't provide it, the integration should not proceed with high-trust operations.

**Backup plan if WP doesn't document:** Use IPN URL whitelisting (only accept POSTs from WP's known IP ranges) + manual verification of first 100 transactions.

### 2.2 Replay Attacks

**Layer 2 (timestamp validation) has a weakness** (§12.2): "Include a timestamp in the signed payload (`rbin_exp` from RobinOS-signed params, or WP's own timestamp field)."

**Problem:** WP's own timestamp field is NOT signed (only the cverify is signed). An attacker who intercepts a valid IPN could:
1. Capture the IPN
2. Replay it later with the original cverify
3. RobinOS's timestamp check would either:
   - Use the original timestamp (allow replay) — if validation is "reject if older than 24h from now", and attacker replays within 24h, it passes
   - Use current time as the reference (still allows replay because the IPN is processed again with the same business logic)

**Fix:** Combined timestamp + idempotency is necessary. The `subscription_webhook_events` table already provides this (the unique constraint prevents duplicate processing). So the timestamp check is actually redundant given the idempotency table exists. **The idempotency table is the real replay protection.**

**Recommendation:** Remove timestamp validation as a separate concern. Document that `subscription_webhook_events.unique(provider, provider_event_id)` IS the replay protection. Layer 2 is unnecessary.

### 2.3 Signature Validation — Timing Attacks

The design mentions constant-time comparison (§12.1) but doesn't specify which library/function to use.

**Recommendation:** Explicitly require use of:
- Node.js/Deno: `crypto.timingSafeEqual()` (built-in)
- Never use `===` or `==` for signature comparison
- Never use `Buffer.compare()` (not constant-time)

### 2.4 URL Tampering

The signed URL strategy (§1.3) protects against URL tampering via HMAC. **Good.** But:

**Gap:** The signed URL is generated once per click. If the user clicks twice (open in two tabs), they get TWO different signed URLs with the same params. Both are valid. Both can be used to purchase. The user could end up buying twice.

**Fix:** Either:
- Generate a unique `nonce` per click that's part of the signed payload AND stored server-side (one-time-use URLs)
- Or, rely on WP's idempotency at their end (most networks won't charge twice for the same buyer within minutes)

### 2.5 Guest Claim Abuse

**Vectors not addressed:**

1. **Claim chain attacks:** Buyer purchases on WP, claims purchase, gets access. Then files chargeback. RobinOS eats the cost.
2. **Email interception:** If buyer_email on WP is compromised, attacker can claim the purchase.
3. **Mass claim abuse:** Attacker creates 100 WP purchases (with stolen credit cards), claims all 100, uses service, abandons. RobinOS eats 100x chargebacks.
4. **Re-claim attempts:** Claim token is single-use but no rate limiting on claim attempts. Attacker could brute-force claim tokens.
5. **Account squatting:** Attacker purchases on WP, claims purchase, abandons account. RobinOS account sits unused. Repeated at scale.

**Fixes:**
- Limit unclaimed purchase window to 7 days (not 30)
- Rate limit claim attempts per IP (10/hour) and per email (5/hour)
- Verify buyer's email via magic link BEFORE granting entitlement (don't grant on claim click)
- Fraud detection: alert if same buyer_email has > 3 unclaimed purchases

### 2.6 Fraud Vectors — Missing

The threat model (§12.8) lists 11 threats but misses:

1. **Card testing** — Attacker uses WP checkout to test stolen card numbers. RobinOS has no visibility.
2. **Refund fraud** — Serial refunder abuses refund policy.
3. **Affiliate fraud** — Self-referral via different emails. Mitigated for Dodo via `profiles.referred_by_code`, not addressed for WP.
4. **Promo abuse** — Future WP promo codes not handled.
5. **Gift purchases** — Buyer A buys as gift for Buyer B. Currently treated as Buyer's purchase.
6. **Multi-account abuse** — Same person creates multiple RobinOS accounts to claim multiple WP purchases. Detection: same device fingerprint, same payment method, same IP.

### 2.7 Webhook Spoofing

**Mitigation:** cverify signature verification (assumed correct — see §2.1).

**Gap:** The design says "anyone can hit the URL" because JWT is disabled. This is true. Signature is the only gate.

**Additional hardening not specified:**
- IP whitelisting (WP's known IP ranges)
- Cloudflare or similar WAF in front of the webhook endpoint
- Rate limiting per IP
- TLS 1.3 only
- Request size limits (reject > 10KB bodies)

### 2.8 Secret Management Gaps

The design mentions secrets but doesn't fully specify:

1. **Where are secrets stored?** Supabase Edge Function Secrets (good) — but should be confirmed.
2. **Who can rotate secrets?** Admins only — RLS on `secrets` table needed.
3. **What if WP rotates their API key?** RobinOS receives new key, must update secret. No rotation workflow specified.
4. **What if RobinOS signing secret is leaked?** No incident response procedure specified.
5. **Audit log of secret access?** Not specified.

### 2.9 Security Improvements Summary

| Finding | Severity | Recommendation |
|---------|----------|---------------|
| Verification algorithm is an assumption | CRITICAL | Confirm with WP before implementation |
| Replay protection via timestamp is redundant | LOW | Remove; rely on idempotency table |
| Constant-time comparison not specified | LOW | Mandate `crypto.timingSafeEqual()` |
| Click-twice URL reuse | LOW | Add nonce or rely on WP dedup |
| Guest claim abuse vectors | HIGH | Add rate limits + magic-link verification |
| Fraud vectors missing | MEDIUM | Add 6 vectors to threat model |
| No IP whitelisting/WAF | MEDIUM | Add to deployment plan |
| No secret rotation procedure | MEDIUM | Document SOP |

---

## 3. Reliability Review

### 3.1 Duplicate Deliveries

**Strength:** The `record_webhook_event` RPC with unique constraint catches duplicates.

**Weakness:** The composite event ID bug (#2 in §1.1) means some duplicates are incorrectly merged.

**Missing:** If `record_webhook_event` itself fails (e.g. DB connection issue), the IPN returns 500. WP retries. But what if WP sends the retry while the first attempt is still running? Race condition — both might pass the idempotency check simultaneously. The unique constraint protects but error handling needs to be verified.

### 3.2 Lost Webhooks

**Weakness:** The design says "Always return 200 for valid signatures" (§10.3). This means:

**Problem:** If our handler fails AFTER `record_webhook_event` recorded the event, we return 200. WP thinks we got it. But our internal state is inconsistent. The event is lost from WP's perspective but recorded as processed. WP will NOT retry.

**Concrete scenario:**
1. WP sends SALE IPN
2. Handler: `record_webhook_event` succeeds (event recorded as processed)
3. Handler: `safe_plan_switch` fails (DB blip)
4. Handler returns 200 (acknowledged)
5. WP does NOT retry
6. User has no subscription. No record in our system indicates a problem.

**Fix:** Move `record_webhook_event` to the END of processing, not the beginning. Or use a two-phase commit:
1. Phase 1: Verify signature + idempotency check (read-only)
2. Phase 2: Record event + apply state change (atomic transaction)
3. If phase 2 fails, return 500 so WP retries

**Better fix:** Use a transactional outbox pattern:
- Record event in `subscription_webhook_events` with status='received'
- Apply state changes
- Mark event as 'processed'
- Only return 200 when both phases succeed

If processing fails, return 500 (so WP retries). The event row remains in 'received' state and can be manually re-driven from admin if needed.

### 3.3 Retry Behavior

The design documents WP's retry behavior (7 days, exponential backoff). **Good.**

**Missing:** What about events that succeed in the handler but where the response is lost (network blip before reaching WP)? WP will retry. The retry will be deduplicated by `record_webhook_event`. **Good.**

**Missing:** What if WP retries with a slightly different payload (e.g. amount field rounded differently)? The payload hash would differ, but the event ID would be the same → processed again with stale data.

**Fix:** Hash the event ID + key business fields, not the full payload. Or compare field-by-field.

### 3.4 Partial Failures

**Scenario:** Handler succeeds for `safe_plan_switch` but fails for `push_admin_notification`.

**Behavior in design:** Retry `push_admin_notification` 2 times, then "fail gracefully" (§10.2).

**Problem:** The notification is lost. Admin doesn't know a sale happened.

**Fix:** Notifications should be queued, not inline. Use the same outbox pattern. Failed notifications are retried by a background job.

### 3.5 Database Failures

**Scenario:** DB is down for 10 minutes. 50 IPNs arrive during this time.

**Behavior in design:** Each IPN tries to verify, fails on DB call, returns 200 (acknowledged). WP stops retrying. 50 sales are lost.

**Fix:** Return 503 when DB is unavailable. WP will retry. The Edge Function should check DB health before returning 200.

**Implementation:** A simple DB ping at the start of the handler. If fails, return 503 immediately.

### 3.6 Network Failures

**Scenario:** The Edge Function is deployed but the WP-to-RobinOS network path is blocked.

**Behavior:** WP retries fail. WP marks the IPN as failed after 7 days. RobinOS has no record.

**Fix:** This is an operational concern. WP-side retry count should be monitored. If WP marks our endpoint as unreachable, alert admin.

### 3.7 Event Ordering

**Strength:** The design addresses out-of-order events (§9.5).

**Weakness:** The proposed handling (SALE after RFND loses the refund — see Bug #1) is incorrect.

**Better approach:** Per-txn_id event log with sequential processing:

```sql
CREATE TABLE warriorplus_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warriorplus_txn_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  UNIQUE (warriorplus_txn_id, sequence_number)
);
```

Each IPN appends to this log. A separate process (cron or trigger) reads pending events in sequence and applies them to the subscription state. Out-of-order events wait until prior events arrive.

**This is the only correct way to handle out-of-order events.** The current "handle out-of-order inline" approach is fundamentally broken.

### 3.8 Reliability Improvements Summary

| Finding | Severity | Recommendation |
|---------|----------|---------------|
| `record_webhook_event` at start causes lost events on later failure | HIGH | Move to end of handler OR use transactional outbox |
| Event ordering has data loss bug | CRITICAL | Use per-txn_id event log + sequential processor |
| Failed notifications lost | MEDIUM | Queue notifications |
| DB down returns 200 (lost sales) | HIGH | Return 503 when DB unavailable |
| No monitoring of WP retry storms | LOW | Add metric |

---

## 4. Scalability Review

### 4.1 Future Payment Providers

**Current state:** Architecture is designed for one provider (WarriorPlus). Adding another would require a parallel set of Edge Functions.

**Concern:** This pattern doesn't scale. Each provider = N Edge Functions + N normalization layers + N product registries + N claim workflows.

**Better architecture:** Provider abstraction layer:
```
Generic IPN Handler
    ↓
Provider-Specific Normalizer (one per provider)
    ↓
Generic Event Processor (reusable)
    ↓
Subscription State Machine (provider-agnostic)
```

The normalization layer should be a plug-in, not embedded in the main handler. The main handler should orchestrate, not normalize.

**Recommendation:** Refactor to a provider interface pattern. Even if only WP is implemented now, design for the abstraction.

### 4.2 Multiple WarriorPlus Products

The architecture references a "product registry" 8+ times but never designs it.

**Required schema:**
```sql
CREATE TABLE warriorplus_product_registry (
  item_id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time')),
  amount_usd NUMERIC NOT NULL,
  is_subscription BOOLEAN NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Required API:**
- `register_product(item_id, plan_key, billing_cycle, amount, is_subscription)` — admin RPC
- `lookup_product(item_id)` — internal lookup, called from IPN handler
- `disable_product(item_id)` — admin RPC for deprecation
- `list_products()` — admin UI query

**Required admin UI:**
- Page to manage product mappings
- Auto-detect new products (suggest mapping based on amount)
- Bulk import from WP dashboard

### 4.3 Multiple Subscriptions

The current schema has `unique (user_id)` on `user_subscriptions` (one subscription per user). This works for Dodo but breaks WP scenarios:

- User buys WP product → subscription created
- User then buys a DIFFERENT WP product → second subscription needed (or upgrade/downgrade?)
- User upgrades via Dodo while WP sub is active → conflict

**Design question:** Should WP purchases replace existing subscriptions, stack alongside, or reject?

The current design says "do not overwrite" (§6.5). But this means users can't have multiple products.

**Recommendation:** Allow stacking for different products. Use `user_subscriptions` as the "active" row + a new `user_product_grants` table for individual product grants.

### 4.4 High Webhook Volume

**Current capacity:** Edge Functions scale horizontally. No explicit bottleneck.

**Concern:** At 1000 IPNs/minute:
- DB writes per IPN: ~3-5 (subscription update, audit log, commission event if applicable, claim record if guest, admin notification)
- 5000 DB writes/minute = 83/sec — well within Postgres capacity
- Edge Function cold starts may cause latency spikes — should set minimum instances

**Recommendation:**
- Set minimum 2 instances for the IPN handler
- Monitor DB connection count
- Use Supabase connection pooler

### 4.5 Horizontal Scaling

**Strength:** Edge Functions scale horizontally by default.

**Weakness:** DB is a single bottleneck. At high volume, read replicas needed for analytics queries.

**Missing:** No read replica strategy, no caching layer (Redis for `resolve_user_plan` results).

### 4.6 Queue Compatibility

**Gap:** The architecture uses inline processing. No queue (SQS, pg_queue, etc.) for deferring work.

**When a queue helps:**
- DB is slow → enqueue, process async
- Notification fails → enqueue for retry
- Out-of-order events → queue with delay
- Burst traffic → smooth out via worker pool

**Recommendation:** Add a simple `warriorplus_processing_queue` table with worker invocation via Supabase cron or external worker. Don't introduce a new queue technology (Kafka, etc.) — too much complexity for current scale.

### 4.7 Scalability Summary

| Finding | Severity | Recommendation |
|---------|----------|------------|
| Provider abstraction missing | MEDIUM | Design for multiple providers from day 1 |
| Product registry not designed | HIGH | Schema + admin UI + RPCs |
| Multiple subscriptions not supported | MEDIUM | Decide: stack or replace |
| No queue for deferred processing | MEDIUM | Add simple queue table |
| No caching layer | LOW | Add Redis for entitlement reads |
| No read replica strategy | LOW | Document at higher volumes |

---

## 5. Maintainability Review

### 5.1 Reusability

**Strengths:**
- Reuses `safe_plan_switch`, `record_webhook_event`, `log_subscription_event`, `push_admin_notification`, `reverse_commission`, `increment_affiliate_balance` — all without modification (except optional `p_auto_renew` parameter)
- Reuses existing RLS policies
- Reuses existing logging infrastructure

**Weaknesses:**
- "Record affiliate commission" logic is duplicated between Dodo and Whop webhooks. WP webhook would add a third copy. Should be a shared utility.
- The "build signed URL" logic is specific to WP. Should be a separate utility, not inline in the Edge Function.

### 5.2 Logic Duplication

1. **HMAC signature verification** — Will exist in Dodo, Whop, and WP handlers (with provider-specific algorithms). Should be a single utility that takes provider + raw body + signature + secret.
2. **Identity resolution** — Currently only WP needs it, but future providers may too. Should be a shared service.
3. **Audit logging** — Each handler calls `log_subscription_event` separately. Could be wrapped in a higher-level operation.
4. **Admin notification patterns** — Each handler has its own notification calls. Could be templated.

### 5.3 Responsibilities

**The proposed Edge Function (`warriorplus-webhook`) has too many responsibilities:**
1. HMAC verification
2. Payload normalization
3. Idempotency
4. Identity resolution
5. Product resolution
6. State mutation (subscription)
7. Commission attribution
8. Audit logging
9. Admin notification

This violates Single Responsibility Principle. A 600-line Edge Function is hard to test, hard to debug, hard to evolve.

**Better decomposition:**
- `warriorplus-webhook` (entry point, signature verification, idempotency)
- `warriorplus-normalize` (payload → normalized event)
- `identity-resolver` (resolve buyer → user_id)
- `product-resolver` (item_id → plan)
- `subscription-grantor` (apply entitlement)
- `commission-handler` (commission logic)
- `notifier` (admin alerts)

Each is a separate module/function, testable in isolation.

### 5.4 Provider-Specific Logic Isolation

**Current state:** Each provider has its own Edge Function directory. Provider logic is somewhat isolated.

**Better:** Use a `providers/` directory with subdirectories per provider, each containing:
- `webhook.ts` — entry point
- `normalize.ts` — payload → normalized
- `product-registry.ts` — provider-specific mappings
- `signature.ts` — provider-specific verification

And a shared `core/` directory for provider-agnostic logic.

### 5.5 Documentation Debt

The design document is 1,810 lines. The implementation will likely be 5,000-10,000 lines across multiple files. Without inline documentation matching the architecture doc, maintenance will suffer.

**Recommendation:**
- Architecture doc should be the source of truth for "why"
- Each implementation file should have a header comment linking to the architecture doc section
- Add ADRs (Architecture Decision Records) for each major decision

### 5.6 Maintainability Improvements Summary

| Finding | Severity | Recommendation |
|---------|----------|------------|
| HMAC verification duplicated | MEDIUM | Extract to shared utility |
| Identity resolver not reusable | LOW | Move to shared service |
| Single 600-line Edge Function | HIGH | Decompose into modules |
| No ADR format | LOW | Adopt ADR template |
| Provider logic not isolated | MEDIUM | Reorganize to providers/ pattern |

---

## 6. Data Integrity Review

### 6.1 Idempotency

**Strength:** `subscription_webhook_events` table with unique constraint.

**Weakness:** The composite event ID bug (#2) means some duplicates are incorrectly merged.

**Gap:** No idempotency for the OUTBOX pattern. If processing fails after event recording, retry will be deduplicated.

**Recommendation:** Two-tier idempotency:
1. `subscription_webhook_events` — prevents duplicate processing of same event
2. `warriorplus_event_log` (per-txn_id sequence) — ensures ordered processing

### 6.2 Transaction Boundaries

**Current state:** `safe_plan_switch` is atomic (single RPC transaction). Other operations (`increment_affiliate_balance`, `log_subscription_event`, `push_admin_notification`) are separate calls.

**Problem:** If `safe_plan_switch` succeeds but `increment_affiliate_balance` fails, we have a subscription without proper affiliate attribution (if commission was supposed to be created).

**Fix:** Use database transactions explicitly:
```typescript
await db.rpc('safe_plan_switch', {...});
// This is atomic inside the RPC
// But the next RPC is not in the same transaction
await db.rpc('increment_affiliate_balance', {...});
```

**Better:** Create a single RPC `process_warriorplus_sale` that handles all state changes in one transaction:
- Upsert subscription
- Create commission (if applicable)
- Log audit event
- Emit notification (queue)

### 6.3 Referential Integrity

**Concerns:**
- `warriorplus_pending_claims` references `warriorplus_txn_id` — what if WP reuses txn_ids? (Should not happen, but worth a unique constraint.)
- `warriorplus_chargebacks` references `user_id` — what if user is deleted? Should the chargeback record survive?
- `warriorplus_sales_ledger` references `user_id` — same question.

**Recommendation:**
- All WP tables: `ON DELETE SET NULL` for `user_id` (preserve records)
- Unique constraint on `warriorplus_txn_id` everywhere
- Index on `(provider, provider_event_id)` — already exists from migration 31

### 6.4 Subscription Consistency

**Scenario:** User has Dodo subscription (active, expires_at = T). WP SALE arrives for same user.

**Current design (§6.5):** "do not overwrite — return 200 to WP (acknowledged) but log 'duplicate subscription attempted'"

**Problem:** This is broken (see Bug #5). User paid WP, got nothing.

**Better:** Define explicit behavior:
- Same provider + same plan → reject (true duplicate)
- Same provider + different plan → upgrade/downgrade via `safe_plan_switch`
- Different provider + any plan → grant if not in cooldown, otherwise queue
- Active subscription + new WP purchase → upgrade if higher tier, else append as additional grant

### 6.5 Commission Consistency

**Current state:** `affiliate_commissions` has unique `(affiliate_user_id, referred_user_id, subscription_id)`. This prevents duplicate commissions per subscription.

**Gap:** What about partial refunds? If a $39 purchase generates $11.70 commission, and then a $10 partial refund happens, should the commission be reduced? The current design reverses the entire commission on any refund.

**Recommendation:** Partial refunds should NOT reverse commission. Only full refunds and chargebacks should. The commission represents the value of the acquisition, not the transaction amount.

### 6.6 Data Integrity Summary

| Finding | Severity | Recommendation |
|---------|----------|------------|
| Composite event ID bug | CRITICAL | Fix per Bug #2 |
| No transaction boundary across RPCs | HIGH | Create composite RPC |
| Multiple subscription rules undefined | HIGH | Define explicit behavior matrix |
| Partial refund reverses entire commission | MEDIUM | Only full refund + chargeback reverses |
| FK strategy for WP tables not defined | LOW | Document ON DELETE behavior |

---

## 7. Architecture Smells

### 7.1 Overengineering

1. **Layer 3 nonce tracking** (§12.2) — Recommended to skip, which is correct. But including it as an option is unnecessary.
2. **PII redaction in logs** (§11.8) — Good practice but goes beyond current architecture scope. Most other components don't redact PII (e.g. Dodo webhook logs full customer data). Inconsistent scope.
3. **5 ASCII sequence diagrams** — Useful for documentation but excessive for a design review. One canonical diagram + narrative would suffice.

### 7.2 Underengineering

1. **No product registry design** — Referenced 8+ times, never designed. **Critical gap.**
2. **No claim database schema** — `warriorplus_pending_claims` mentioned 6+ times, never designed.
3. **No chargeback table schema** — Mentioned 4+ times, never designed.
4. **No admin UI design** — Admin needs to manage products, link purchases, view chargebacks. Not specified.
5. **No error response codes from Edge Function** — What does the client (WP) see on different failures? Not specified.
6. **No monitoring/alerting design** — Mentioned metrics but no actual dashboards or alert rules.
7. **No capacity planning** — What scale does this support? No numbers.
8. **No rollback plan** — How do we disable WP integration if it causes issues?
9. **No test plan** — How do we validate the integration before going live?
10. **No staging environment strategy** — Test with WP test mode? Sandbox?

### 7.3 Tight Coupling

1. **`safe_plan_switch` modification** — Adding `p_auto_renew` parameter couples WP requirements to a Dodo-era RPC. Alternative: new wrapper RPC for WP grants.
2. **`increment_affiliate_balance` called from webhook** — Couples webhook logic to balance mechanics. Should be inside a transaction-wrapped operation.
3. **Product registry coupled to IPN handler** — IPN handler knows about plan_key mappings. Should be abstracted.

### 7.4 Hidden Dependencies

1. **Email service** — Claim emails are sent "via email service" (§13.2 sad path). Which service? Resend? SendGrid? SMTP? Not specified.
2. **Trace ID propagation** — UUID v7 used across logs but no library/function specified for generation. Depends on Deno's crypto API.
3. **Admin notification triggers** — `push_admin_notification` is called but the UI for admins to see notifications is not specified.

### 7.5 Circular Dependencies

1. **`referralCoordinator`** depends on `authInitialization` (loaded dynamically). Not circular, but coupling.
2. **WP webhook → identity resolver → user lookup → profile → ...** — Linear chain, not circular. Good.

### 7.6 Single Points of Failure

1. **Single Edge Function for WP IPN** — All WP traffic goes through one function. If it's misconfigured, all WP sales fail. Should have backup monitoring.
2. **Email service for claims** — If email service is down, claims don't work. Need fallback (e.g. admin notification "buyer needs to claim").
3. **WP vendor API for product registry lookup** — If WP API is down, we can't validate items. Need local cache.
4. **DB for `record_webhook_event`** — If DB is down, all WP IPNs return errors. Acceptable but should be monitored.

### 7.7 Code Smells

1. **Plan amounts hardcoded in webhook** (`PLAN_AMOUNTS: Record<string, number>`) — Inherited from Dodo design. Should be removed in favor of `platform_settings` lookup.
2. **Console.log for structured logging** — Insufficient for production observability. Use a real logger.
3. **Multiple `if/else` for status transitions** — Could be a state machine library.

---

## 8. Production Readiness Scoring

### 8.1 Architecture — 7.0 / 10

**Strengths:**
- Clear pipeline with 9 states
- Reuse of existing infrastructure
- Good separation of concerns (mostly)

**Weaknesses:**
- 5 critical bugs would cause production incidents
- 3 missing core components (product registry, claim table, chargeback table)
- Under-specified transaction boundaries
- Under-designed for multiple providers / multiple subscriptions
- No rollback plan
- No test/staging strategy

### 8.2 Security — 6.0 / 10

**Strengths:**
- HMAC verification approach (if algorithm is correct)
- Idempotency-based replay protection
- Constant-time comparison mentioned
- Good threat model section (mostly)

**Weaknesses:**
- Entire security model based on unverified assumption about WP's algorithm
- Guest claim abuse vectors not addressed
- 6 fraud vectors missing from threat model
- No IP whitelisting, no WAF, no rate limiting specified
- No secret rotation procedure
- No incident response plan
- Flaw in replay protection (timestamp check is redundant and weak)

### 8.3 Maintainability — 6.5 / 10

**Strengths:**
- Good documentation in design doc
- Reuse of existing RPCs
- Logging strategy is clear

**Weaknesses:**
- Single 600+ line Edge Function (SRP violation)
- Duplicated HMAC verification pattern (Dodo, Whop, WP)
- Logic duplication across webhooks (commission recording)
- No ADR format
- Provider logic not isolated via abstraction

### 8.4 Scalability — 7.5 / 10

**Strengths:**
- Edge Functions scale horizontally
- DB write volume well within capacity
- Idempotency prevents duplicate processing

**Weaknesses:**
- No product registry → can't support multiple products efficiently
- Multiple subscriptions not supported
- No queue for deferred processing
- No caching layer
- No read replica strategy

### 8.5 Reliability — 5.5 / 10

**Strengths:**
- Idempotency table prevents duplicate processing
- Out-of-order event handling is documented

**Weaknesses:**
- 5 critical bugs in event handling
- Lost webhooks on partial failure (record_webhook_event at start)
- No dead letter queue
- DB down → 200 → lost sales
- Out-of-order handling has data loss bug
- No queue for retry/backoff
- No monitoring of WP retry storms

### 8.6 Developer Experience — 7.0 / 10

**Strengths:**
- Architecture doc is detailed
- Existing patterns are reusable
- Clear naming conventions

**Weaknesses:**
- No ADR template
- No inline code documentation strategy
- No local development setup instructions
- No staging environment plan
- No test fixtures for WP scenarios

### 8.7 Overall Score

| Category | Score |
|----------|-------|
| Architecture | 7.0 |
| Security | 6.0 |
| Maintainability | 6.5 |
| Scalability | 7.5 |
| Reliability | 5.5 |
| Developer Experience | 7.0 |
| **Average** | **6.6 / 10** |

This is below the "ready for production" threshold (typically 8.5+).

---

## 9. Final Verdict

### **C) Needs redesign.**

The architecture contains **5 critical bugs** that would cause production incidents within hours of launch. Specifically:

1. **Out-of-order events lose refunds** (data loss + revenue leak)
2. **Duplicate detection breaks for repeated partial refunds** (financial inaccuracy)
3. **Entire security model based on unverified assumption** (cannot ship until confirmed)
4. **One-time refund doesn't revert to free** (permanent access after refund)
5. **Subscription overwrite logic breaks upgrades** (customers paying for nothing)

Beyond the critical bugs, the design has **3 missing core components** (product registry schema, pending claims table, chargebacks table) that block implementation. There are also **11 medium-severity gaps** ranging from missing fraud vectors to undefined transaction boundaries.

The good news: most issues are **fixable within the current architecture**, not requiring a fundamental redesign. The hybrid identity strategy, the 9-state IPN pipeline, and the default-suppress-commission decision are all defensible.

### Recommended Path Forward

**Phase 1: Pre-implementation validation (1 week)**
- Contact WarriorPlus vendor support and confirm:
  - Exact cverify algorithm
  - URL param preservation behavior
  - Available event types (especially dispute.won/lost)
  - Test mode availability
- Conduct 5 test purchases to verify behavior

**Phase 2: Architecture fixes (1 week)**
- Fix the 5 critical bugs
- Design the missing product registry, pending claims, and chargebacks tables
- Add the transactional outbox pattern
- Define explicit subscription stacking behavior matrix

**Phase 3: Re-review**
- Submit revised architecture for second review
- Expect verdict to be "B" (Ready with minor adjustments) after fixes

**Do NOT proceed to implementation until at least Phase 1 and Phase 2 are complete and a second review approves the design.**

---

## 10. Required Changes Before Implementation

### Critical (Block Implementation)

- [ ] **CONFIRM WP cverify algorithm** — Contact WP support, get documentation, implement verified algorithm before any code is written
- [ ] **CONFIRM WP preserves URL params** — Test purchase with all 5 rbin_* params
- [ ] **Fix Bug #1 (out-of-order events)** — Use per-txn_id event log with sequential processing
- [ ] **Fix Bug #2 (composite event ID)** — Add timestamp or sequence number to event ID
- [ ] **Fix Bug #3 (URL param assumption)** — Treat signed params as enhancement, email match as primary
- [ ] **Fix Bug #4 (one-time refund)** — Revert to free immediately for one-time purchases on full refund
- [ ] **Fix Bug #5 (subscription overwrite)** — Define upgrade/downgrade matrix, allow tier changes
- [ ] **Design `warriorplus_product_registry` table** — Schema + RPCs + admin UI
- [ ] **Design `warriorplus_pending_claims` table** — Schema + claim workflow
- [ ] **Design `warriorplus_chargebacks` table** — Schema + dispute workflow

### High Priority (Must Address Before Launch)

- [ ] **Reorder `record_webhook_event` to end of handler** — Use transactional outbox
- [ ] **Return 503 when DB unavailable** — Don't return 200 on infrastructure failures
- [ ] **Verify claim email via magic link** — Don't grant entitlement on click
- [ ] **Fix chargeback access preservation** — Immediate downgrade, restore on dispute win
- [ ] **Add magic-link verification for claim workflow** — Prevent claim abuse
- [ ] **Add rate limiting on claim attempts** — Per IP and per email
- [ ] **Decompose monolithic webhook handler** — Split into modules
- [ ] **Define subscription stacking behavior matrix** — Allow or reject multiple subs per user
- [ ] **Add commission partial refund logic** — Only reverse on full refund/chargeback
- [ ] **Add gift purchase handling** — Or document that gift purchases are not supported
- [ ] **Add WP marketplace listing → RobinOS tracking** — For "no signed params" attribution

### Medium Priority (Address Within 3 Months of Launch)

- [ ] **Add IP whitelisting** — WP's known IP ranges
- [ ] **Add WAF (Cloudflare) in front of webhook** — DDoS protection
- [ ] **Add secret rotation procedure** — Document SOP
- [ ] **Add admin UI for product registry** — CRUD interface
- [ ] **Add admin UI for pending claims** — Manual linking fallback
- [ ] **Add admin UI for chargebacks** — Dispute management
- [ ] **Add monitoring dashboards** — IPN volume, error rate, signature failures, pending claims
- [ ] **Add queue for notifications** — Avoid lost notifications
- [ ] **Add Redis caching for entitlement reads** — Reduce DB load
- [ ] **Add ADR format for future decisions** — Document the "why"
- [ ] **Add fraud detection rules** — Same payment method across accounts, etc.
- [ ] **Add staging environment strategy** — Test mode for WP

### Low Priority (Nice to Have)

- [ ] **Add read replicas** — At higher scale
- [ ] **Refactor provider abstraction** — Support multiple providers cleanly
- [ ] **Add 6 missing fraud vectors** — Card testing, refund fraud, affiliate fraud, etc.
- [ ] **Add unit test coverage** — Aim for 80%+ on new code
- [ ] **Add integration test fixtures** — Mock WP IPNs for testing
- [ ] **Add load testing** — Verify 1000 IPN/min capacity
- [ ] **Add chaos testing** — Verify graceful degradation

---

## Appendix A — Comparison to Industry Standards

| Practice | This Design | Industry Standard |
|----------|-------------|-------------------|
| HMAC verification | Yes (algorithm assumed) | Yes (algorithm verified) |
| Idempotency table | Yes | Yes |
| Constant-time comparison | Mentioned | Required |
| Transactional outbox | No | Recommended |
| Dead letter queue | "Future" | Required from day 1 |
| Per-event sequence log | No | Recommended |
| Magic link verification | No | Standard for high-trust flows |
| Rate limiting per IP | No | Standard |
| WAF in front of webhook | No | Standard |
| Secret rotation procedure | No | Standard |
| Audit log of admin actions | Yes (via existing infrastructure) | Standard |
| Rollback plan | No | Required |
| Staging environment | Not specified | Required |
| Test fixtures | No | Standard |

## Appendix B — Reference to Existing RobinOS Strengths

This review identifies gaps; it does not diminish the strong foundation. The audit confirmed:

- ✅ Battle-tested `safe_plan_switch` RPC
- ✅ Hardened webhook idempotency (`record_webhook_event`)
- ✅ Atomic entitlement engine (`plan_entitlements` + `usage_tracking`)
- ✅ Mature affiliate lifecycle (pending → approved → paid → reversed)
- ✅ Immutable audit trails (`subscription_audit_log`, `commission_events`)
- ✅ 14-day commission cooldown for refund safety
- ✅ Grace period expiry handling
- ✅ Renewal reminder system

These strengths mean the WP integration can lean on proven infrastructure. The review focuses on gaps specific to the WP integration itself.

---

**End of Review.**
