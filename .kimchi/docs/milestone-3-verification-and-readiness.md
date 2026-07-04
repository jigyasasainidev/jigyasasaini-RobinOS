# Milestone 3 — Final Verification + Implementation Readiness Checklist

**Status:** Design verification complete. Awaiting reviewer sign-off on classifications and safe-handling strategies.
**Companion to:** `.kimchi/docs/milestone-3-webhook-receiver-design.md` (the M3 design).

---

## Classification legend

For each assumption from M3 design §15, I classify it as exactly one of:

| Code | Category | Meaning |
|---|---|---|
| **C1** | Confirmed by official WarriorPlus documentation | The official WP help-center article explicitly states this. |
| **C2** | Can be confirmed from existing RobinOS architecture | We can answer this from the M1/M2 schema, RPCs, or platform constraints — no WP info needed. |
| **C3** | Requires real WarriorPlus sandbox/live testing | WP docs are silent or ambiguous; only an actual WP test (or vendor support contact) can confirm. |
| **C4** | Product decision we must make ourselves | WP is silent AND it's a RobinOS-side choice that nobody else can answer for us. |

If WP documentation is **silent** on a behavior, I explicitly state that and explain the safest implementation strategy. I do not guess.

---

## The 12 assumptions — classification and safe handling

### Assumption 1 — WP retry semantics (15 retries / 4 days, PayPal-IPN behavior)

**Classification: C3 — Requires real WP testing.**

**Evidence:**
- WP's official "IPN and Keygen Variables" article (<https://help.warriorplus.com/en/articles/1658556-ipn-and-keygen-variables>, accessed 2026-07-04) describes the POST fields and their meanings but **does not state** how many times WP retries a failed delivery, over what interval, or how it interprets non-2xx responses.
- A 2012 s2Member forum post (<https://www.s2member.com/forums/topic/s2-member-warrior-plus-integration/>) suggested WP inherits PayPal IPN retry behavior (15 retries over ~4 days). This post is 13 years old and is **third-party speculation**, not WP documentation.
- PayPal's own IPN troubleshooting article (<https://www.paypal.com/us/cshelp/article/how-do-i-troubleshoot-instant-payment-notification-ipn-ts2082>) confirms PayPal's retry semantics, but WP is a separate system that may or may not inherit them.

**What is undocumented:** exact retry count, retry interval, behavior on 4xx vs 5xx.

**Safest production handling:**

- **Default assumption:** WP treats non-2xx the way PayPal IPN does — retries on 5xx/408/429, stops on 2xx and on most 4xx.
- **Design is retry-safe regardless of WP's actual policy:** because `enqueue_webhook_event` uses atomic ON CONFLICT (M54 fix), duplicate `IPN_ID` deliveries are always a no-op at the database level.
- **Return 200 aggressively for recoverable cases:** 4xx is reserved for cases we are sure cannot succeed on retry (bad signature, unknown provider, malformed body). 5xx is reserved for transient infrastructure failures (DB unreachable, etc.). This minimizes wasted retries without breaking legitimate ones.
- **Real WP test required:** in staging, deliberately fail a signature check on a sandbox WP purchase and observe WP's retry behavior over 1 hour. Document the observed retry count + interval in this checklist once known.
- **Fallback if WP behaves unexpectedly:** if WP retries indefinitely on 4xx, we relax our response code mapping (M3 design §7) — but this is post-deployment tuning, not a blocker.

---

### Assumption 2 — `WP_SECURITYKEY` format (raw secret vs hashed)

**Classification: C3 — Requires real WP testing.**

**Evidence:**
- WP's official docs (same article) state only: *"WP_SECURITYKEY: If set in your account settings, this will be sent so you can validate the authenticity of the IPN message."* No specification of whether the value is the raw secret string, a hash, or signed.
- Third-party WooCommerce plugins (aronprins/warriorplus-for-wc, aronandsharon.com/plugins/warriorplus-for-woocommerce) reference "Security Key Verification" with "Timing-safe comparison prevents timing attacks." This implies **raw-string equality**, but it is third-party interpretation, not WP spec.

**What is undocumented:** exact format of `WP_SECURITYKEY` (raw secret / hex-encoded / base64 / hashed).

**Safest production handling:**

- **Primary path:** treat `WP_SECURITYKEY` as the raw secret string. Compare against the decrypted stored secret with constant-time equality. This is the simplest interpretation and the most consistent with how third-party plugins describe verification.
- **Fallback path:** if real WP testing shows the value is hashed, support a SHA-256 path (`provided_hash == SHA256(expected_secret)`). Detect at runtime by comparing lengths: a SHA-256 hex digest is always 64 chars; raw secrets vary. Choose the comparison strategy based on the length of the provided value.
- **Auto-discovery on first deploy:** when M3 ships and we have a real WP sandbox test, the first real signature check reveals the format. We document the observed behavior in this file and update the adapter.
- **Both paths reject mismatch as 401 SIGNATURE_INVALID** — same wire response, same log shape.

---

### Assumption 3 — WarriorPlus outbound IP ranges (for IP allowlist)

**Classification: C3 — Requires real WP testing AND/OR vendor contact.**

**Evidence:**
- Multiple searches for "WarriorPlus IP allowlist" / "WarriorPlus server IPs" / "WarriorPlus webhook source IPs" returned **no documentation** of WP-published outbound IP ranges.
- PayPal publishes IP ranges at <https://www.paypal.com/us/webapps/mpp/paypal-ipn-and-pdt>, but no equivalent WP page exists.
- The M51 schema includes `payment_providers.allowed_ip_ranges cidr[]` precisely because M2 anticipated IP allowlisting might be unavailable; the field is nullable.

**What is undocumented:** any stable IP ranges WP uses for outbound webhook delivery.

**Safest production handling:**

- **Default behavior: signature-only, no IP allowlist.** This is the correct baseline because signature verification is the cryptographically strong layer; IP allowlist is defense in depth.
- **Admin can populate `allowed_ip_ranges` in the M2 admin UI** (M2 deferred feature — out of M3 scope). Empty/null means "accept from any IP."
- **Periodic contact with WP support** to confirm whether they can publish IP ranges. If they do, hard-code a sensible default with admin override.
- **Detection-of-anomaly path (future, not M3):** in M11 diagnostics, alert admins if the source-IP distribution changes significantly. Not a M3 requirement.

---

### Assumption 4 — Affiliate webhooks (`IPN_RCPT_TYPE = 'aff'`) — accept vs reject

**Classification: C4 — Product decision.**

**Evidence:**
- WP docs explicitly say: *"These variables can also be used by Affiliate webhooks, with the exception of personal customer information."* So affiliate IPNs are a documented and real thing.
- The `IPN_RCPT_TYPE` field can be `'vend'` (vendor) or `'aff'` (affiliate).

**What is undocumented:** whether WP considers affiliate IPNs to be a separate "thing" the vendor MUST handle or an optional notification.

**Safest production handling:**

- **Default: accept-and-store all WP IPNs regardless of `IPN_RCPT_TYPE`.** Both 'vend' and 'aff' produce a row in `webhook_events`. No 4xx rejection. No data loss.
- **M3 scope: enqueue only.** No filtering by recipient type at receive time.
- **M10 scope:** affiliate commissions logic inspects `raw_payload->>'IPN_RCPT_TYPE'` and processes 'aff' events into the affiliate commission pipeline. M10 owns the semantics.
- **Why not reject 'aff' at the edge:** we may want them later for analytics, debugging, or commission verification. Storing them is essentially free; rejecting them is irreversible.

---

### Assumption 5 — Dispute / chargeback handling (auto-downgrade vs enqueue-only)

**Classification: C4 — Product decision.**

**Evidence:**
- WP docs include `WP_ACTION = 'dispute'` as a recognized value.
- M3 design intent (§2.2) is enqueue-only — no entitlement changes happen synchronously in M3.

**What is undocumented:** WP's expected behavior on dispute events (whether they imply immediate revocation, just notification, or human-review).

**Safest production handling:**

- **M3: enqueue-only.** Disputes land in `webhook_events` with `status = 'received'`, `provider_event_type = 'dispute'`, `standardized_event_type = 'purchase.disputed'`. No entitlement change.
- **M7/M8: implementation.** Those milestones replace `revoke_entitlement_from_purchase` (M53 stub) with the real revocation logic. M3 does not touch this.
- **M11: admin alerting.** When a dispute arrives, the M11 diagnostics page surfaces it prominently so an admin can review and trigger manual revocation if desired.

---

### Assumption 6 — Subscription IPNs (`subscr_*`) — enqueue-only

**Classification: C4 — Product decision (already aligned with M3 design intent).**

**Evidence:**
- WP docs document `subscr_created`, `subscr_completed`, `subscr_cancelled`, `subscr_failed_invalid`, `subscr_failed_declined`, `subscr_suspended`, `subscr_reactivated`, `subscr_ended`, `subscr_refunded`.
- M3 design §2.2 says async processing is M4's scope.

**What is undocumented:** WP's expectation on subscription lifecycle (do they expect immediate account creation on `subscr_created`? immediate revocation on `subscr_cancelled`?).

**Safest production handling:**

- **M3: enqueue-only for all subscription events.** Standardized event types set:
  - `subscr_created` → `subscription.created`
  - `subscr_completed` → `subscription.renewed`
  - `subscr_cancelled` → `subscription.cancelled`
  - `subscr_failed_invalid` / `subscr_failed_declined` → `subscription.payment_failed`
  - `subscr_suspended` → `subscription.suspended`
  - `subscr_reactivated` → `subscription.reactivated`
  - `subscr_ended` → `subscription.ended`
  - `subscr_refunded` → `subscription.refunded`
- **M6 (Entitlement Grant):** implements the subscription-specific logic (renewal → extend expires_at by duration_value/unit; cancellation → mark for expiry; failed → retry handling). M3 does not touch this.

---

### Assumption 7 — Currency is always USD

**Classification: C1 — Confirmed by official WP documentation.**

**Evidence:**
- WP's "IPN and Keygen Variables" article, under `WP_SALE_CURRENCY`: *"Currency the buyer paid with (currently always USD)."*

**What is documented:** WP sends `WP_SALE_CURRENCY = "USD"`.

**Safest production handling:**

- **Store whatever currency WP sends** (we don't hardcode USD; the schema accepts any 3-letter code).
- **M3 receive path: no conversion, no validation against an allowlist.** Capture as-is.
- **Future-proofing:** if WP adds EUR support tomorrow, our schema already supports it via `provider_products.currency`. No M3 code change needed.

---

### Assumption 8 — `provider_customer_id` source (WP doesn't send one)

**Classification: C2 — Can be confirmed from RobinOS architecture.**

**Evidence:**
- WP docs do not mention any `WP_CUSTOMER_ID`, `WP_USER_ID`, or equivalent stable customer identifier. The closest is `WP_BUYER_EMAIL`, which is mutable.
- RobinOS `payments` schema (M53) does have a `provider_customer_id text` column, but it is nullable precisely for providers that don't supply one.

**What is undocumented:** whether WP has any stable customer identifier we could capture.

**Safest production handling:**

- **M3: leave `provider_customer_id` NULL for WP events.** Capture only what WP sends. If WP later adds a customer ID, M3 receives it automatically (it's a column, not a constant).
- **M5 (User Resolution):** keys on `buyer_email` (case-insensitive, trimmed) using SHA-256 hash from `payments.buyer_email_hash` (M53 trigger). This is the canonical identity layer.
- **M5 + M9:** handle the "buyer uses multiple emails" case via the magic-link claim flow (M9 stubs already in place).

---

### Assumption 9 — Encryption key bootstrap (`PAYMENT_PROVIDER_ENCRYPTION_KEY`)

**Classification: C2 — Can be confirmed from RobinOS architecture.**

**Evidence:**
- M51 schema defines `payment_provider_secrets.secret_value_encrypted text` with comments: *"AES-256-GCM ciphertext, base64-encoded (format: iv::tag::ciphertext). Decryption happens only inside Edge Functions."*
- M51 design intent (header comments) explicitly states: *"The actual webhook signing secrets used by Edge Functions during request verification live in Supabase Edge Function Secrets (environment variables)."*
- The M2 admin UI for entering/updating secrets is **explicitly deferred** per M2 testing checklist §16.2.

**What is documented (RobinOS-internal):** the encryption scheme and where the key lives.

**Safest production handling:**

- **Pre-M3 deploy checklist:** provision `PAYMENT_PROVIDER_ENCRYPTION_KEY` in Supabase Edge Function Secrets (32-byte, base64). Generate via `openssl rand -base64 32`. Document in the operator runbook.
- **M3 deploy bootstrap path:** seed the WP secret via SQL (one-time) into `payment_provider_secrets` using a small bootstrap edge function OR a SQL script that uses the same encryption key. This is the **only** way to test M3 end-to-end without M2's secret UI.
- **M2.1 follow-up (out of M3 scope):** implement the secret-rotation UI in admin so admins can rotate WP's `WP_SECURITYKEY` without SQL. This is a UX improvement, not a correctness blocker.

**This is a deploy-time gate, not a code blocker.** M3 code can be written and reviewed; it just cannot be tested end-to-end until the key is provisioned AND the WP secret is seeded.

---

### Assumption 10 — Edge function concurrency / rate-limit accuracy

**Classification: C2 — Can be confirmed from RobinOS architecture.**

**Evidence:**
- Supabase edge functions run on Deno Deploy; multiple concurrent instances are expected. This is platform-level, not WP-specific.
- M3 design §11.2 explicitly acknowledges this is approximate.

**What is documented (platform):** edge functions are stateless and concurrent.

**Safest production handling:**

- **Treat the in-memory rate-limit counter as best-effort**, not security-critical. Document this in the function header.
- **Rely on Supabase's gateway-level rate limit** (100 req/s per IP) as the actual DDoS shield.
- **No action needed at M3.** This is a known trade-off.

---

### Assumption 11 — Content-Type variants

**Classification: C3 — Requires real WP testing.**

**Evidence:**
- WP docs do not specify the Content-Type header value WP sends.
- Standard form POSTs use `application/x-www-form-urlencoded`. Some implementations send `application/x-www-form-urlencoded; charset=utf-8` or `multipart/form-data`.

**What is undocumented:** the exact Content-Type WP sends.

**Safest production handling:**

- **Accept `application/x-www-form-urlencoded`** with optional parameters (e.g. `; charset=utf-8`). Parse the prefix before `;`.
- **Reject `multipart/form-data` with 415.** Multipart parsing is significantly different and adds attack surface. WP is documented to use form-encoded; if it ever sends multipart, we'll handle that as a follow-up.
- **Reject `application/json` with 415** for now (no JSON adapter in M3; future providers will).
- **Defense in depth:** parse the body both as form-encoded AND validate the result. If the parse yields zero fields, return 400 INVALID_PAYLOAD — protects against empty/wrong bodies.

---

### Assumption 12 — Test mode for WP IPNs

**Classification: C4 — Product decision.**

**Evidence:**
- WP docs do not mention any "test mode" toggle for IPN delivery. The WP dashboard has product-level "test purchase" buttons for manual QA, but no documented webhook test mode.
- M51 schema includes `payment_providers.is_test_mode boolean` (admin-controlled) precisely for this gap.

**What is undocumented:** whether WP supports any IPN test mode.

**Safest production handling:**

- **M3: do not rely on WP for test mode.** Use RobinOS's own `is_test_mode` flag on the provider config row (set via M2 admin UI). When `is_test_mode = true`:
  - WP's actual production endpoint receives traffic and we process it normally — but with extra logging (mark all events as `is_test = true` in `error_history`) so production data is never confused with sandbox data.
- **Real WP testing path:** in staging, use the WP vendor dashboard's "test purchase" button (if available) to fire a real IPN with a small amount. Observe and verify.
- **Production hard-cut:** `require_signature_verification` must be `true` on the production `warriorplus` row. M3 doesn't enforce this — it's an admin responsibility. The M2 admin UI surfaces a warning banner if signature verification is disabled.

---

## Summary table

| # | Assumption | Class | Blocker for M3 code? | Blocker for M3 E2E test? |
|---|---|---|---|---|
| 1 | WP retry semantics | C3 | No — design is retry-safe | Yes — staging test needed |
| 2 | WP_SECURITYKEY format | C3 | No — adapter handles both raw + SHA-256 paths | Yes — staging test reveals format |
| 3 | WP IP ranges | C3 | No — signature-only is the baseline | No — admin can populate later |
| 4 | Affiliate IPNs handling | C4 | No — accept-and-store is the safe default | No |
| 5 | Dispute handling | C4 | No — enqueue-only is M3 scope | No |
| 6 | Subscription IPNs | C4 | No — enqueue-only is M3 scope | No |
| 7 | Currency is USD | C1 | No — confirmed | No |
| 8 | provider_customer_id | C2 | No — null is fine | No |
| 9 | Encryption key bootstrap | C2 | No — code can be written | Yes — key + WP secret must be provisioned |
| 10 | Edge function concurrency | C2 | No — known trade-off | No |
| 11 | Content-Type variants | C3 | No — accept x-www-form-urlencoded, optional charset | Yes — staging test confirms header value |
| 12 | WP test mode | C4 | No — admin-controlled is the safe default | No |

**Result:** No C3 or C2 assumption is a code blocker. Three (1, 2, 11) require staging WP testing — which is expected and acceptable: these are integration concerns that can only be resolved by integration. Two are deploy-time gates (9, 1) for end-to-end testing — also expected.

---

## Implementation Readiness Checklist

### Code readiness (no blockers)

- [x] **Design documented and approved in principle** — `.kimchi/docs/milestone-3-webhook-receiver-design.md`
- [x] **M1 schema verified** — `webhook_events`, `payment_providers`, `payment_provider_secrets`, `provider_products` have all the columns we need
- [x] **M2 admin UI verified** — providers can be enabled/disabled, products can be mapped, secrets can be stored (M2 §16.2 notes the secret-rotation UI is deferred; SQL bootstrap covers this)
- [x] **M54 enqueue RPC verified** — `enqueue_webhook_event` is atomic via `ON CONFLICT (provider_id, provider_event_id) DO NOTHING`
- [x] **All 12 assumptions classified** with safe-handling strategies documented above
- [x] **No code or schema blockers** — every unconfirmed assumption has a safe production handling path that does not require WP-specific behavior to function

### Deploy-time gates (must be done before E2E test, not before code can be written)

- [ ] **Provision `PAYMENT_PROVIDER_ENCRYPTION_KEY` in Supabase Edge Function Secrets** (32-byte, base64). Generate with `openssl rand -base64 32`. Document in the operator runbook. *Required for: secret decryption in payment-webhook edge function.*
- [ ] **Seed WP `WP_SECURITYKEY` into `payment_provider_secrets`** via SQL bootstrap OR a one-time edge function. *Required for: signature verification to succeed.*
- [ ] **Acquire WP vendor sandbox account** with at least one product configured for IPN testing. *Required for: staging E2E tests.*
- [ ] **Configure IPN URL in WP product settings** to `https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus`. *Required for: WP to deliver events.*

### Staging E2E test gates (must complete before production rollout)

- [ ] **Confirm WP retry semantics (Assumption 1):** deliberately fail a signature check on a sandbox WP purchase; observe whether WP retries and on what cadence. Document the observed behavior. *If WP retries indefinitely on 4xx, relax §7 response mapping post-deploy.*
- [ ] **Confirm WP_SECURITYKEY format (Assumption 2):** inspect a real sandbox IPN body; document the value's length and shape. *If 64 hex chars, treat as SHA-256; otherwise raw equality.*
- [ ] **Confirm WP Content-Type (Assumption 11):** inspect a real sandbox IPN's Content-Type header. *Update the adapter's accept-prefix list if needed.*
- [ ] **Verify duplicate handling:** post the same IPN_ID twice. Expect: first → 200 + new row; second → 200 + duplicate flag, no new row.
- [ ] **Verify signature failure handling:** post a known IPN with a corrupted `WP_SECURITYKEY`. Expect: 401 SIGNATURE_INVALID, no row inserted.
- [ ] **Verify provider-disabled handling:** disable WarriorPlus in M2 admin UI. Post a real WP IPN. Expect: 503 PROVIDER_DISABLED, no row inserted.
- [ ] **Verify raw payload integrity:** inspect the `webhook_events.raw_payload` row after a real test. Verify all WP_* fields are captured.
- [ ] **Verify log output:** confirm all 12 log events fire with no PII (no buyer email, no raw IPN_ID value, no secret value).

### Production rollout gates (must complete before promoting from staging)

- [ ] **All staging tests pass.**
- [ ] **No PII in any log line over 24 hours of staging traffic.**
- [ ] **No payment_provider_secrets material appears in any HTTP response.**
- [ ] **Build green; no new lint errors on M3 files.**
- [ ] **Operator runbook reviewed by on-call team.**
- [ ] **WP retry behavior (Assumption 1) confirmed and design §7 response code mapping validated.**

---

## Verdict

Every assumption that can be resolved by WP documentation has been resolved. Every assumption that requires testing has a safe production handling strategy that does not block code writing. Every product decision has a recommended default that errs on the side of safety (accept-and-store, enqueue-only, signature-only, admin-controlled).

**There are no remaining blockers for Milestone 3 implementation.**

---

**Milestone 3 is ready for implementation.**

Implementation can begin immediately. The three deploy-time gates (encryption key, WP secret seed, WP sandbox account) and the three staging E2E gates (retry semantics, security-key format, content-type) are integration concerns that resolve themselves during the first end-to-end staging run. None of them gate the writing of code; they gate the promotion of code to production.
