# Milestone 3 — Webhook Receiver Design

**Status:** Design only. No code yet — awaiting review.
**Owner:** Backend / payments
**Scope:** Production webhook receiver for the generic payment-provider architecture introduced in Milestone 1. First concrete provider adapter: WarriorPlus.

---

## 0. Executive Summary

The M3 webhook receiver is a single Supabase Edge Function (`payment-webhook`) that accepts HTTP requests from any registered payment provider, verifies authenticity, persists the raw event to the existing `webhook_events` table atomically, and returns `200 OK` immediately. Processing (purchase record, user resolution, entitlement granting) happens **asynchronously** in a cron-driven worker that consumes the same `webhook_events` queue.

This design:
- Reuses 100% of the M1 schema and M54-fixed `enqueue_webhook_event` RPC. No DB migration is required for M3.
- Adds one edge function (`payment-webhook`), one shared provider-adapter directory (`_shared/providers/`), and one async worker edge function (`process-webhook-worker`).
- Treats the webhook as **untrusted public input** — authentication is signature-based, not JWT-based.
- Is fully provider-agnostic: the M3 code path is identical for any provider that implements the `ProviderAdapter` interface.

**First provider implemented:** WarriorPlus. Other providers get a stub adapter that returns `501 NOT_IMPLEMENTED`.

---

## 1. Exact Webhook Endpoint(s)

### 1.1 Production endpoint (the only endpoint to expose)

```
POST https://<project-ref>.supabase.co/functions/v1/payment-webhook/:provider_id
```

- `:provider_id` is the path segment that matches a row in `public.payment_providers` (e.g. `warriorplus`, `stripe`, `lemonsqueezy`).
- Single dispatcher endpoint, not per-provider endpoints. Reason: keeps routing centralized, makes auditing one URL, and matches the M51 design intent.
- The endpoint is configured per-product in the WarriorPlus dashboard:
  ```
  Notification URL : https://<project-ref>.supabase.co/functions/v1/payment-webhook/warriorplus
  ```
  This URL is shown in the M2 admin UI on the provider's `webhook_url` field for admin reference.

### 1.2 Internal worker endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/process-webhook-worker
```

- Cron-invoked (Supabase scheduled function), no public access.
- Triggers `process_pending_webhook_events` (currently a stub from M53; implemented in M4) and/or a batch of `process_webhook_event` calls (also M4 stub; M4 implements the worker).
- For M3 the worker is **not yet implemented**. M3 only receives and persists events; the worker fires on the M4 implementation of the stub RPCs.

### 1.3 Why a single dispatcher

- Clean adapter dispatch by path segment.
- One URL to allowlist in WarriorPlus's vendor dashboard.
- New providers do not require new endpoints or DNS changes.
- Easier to monitor (single function's logs, metrics, alerts).

---

## 2. WarriorPlus Request Flow (HTTP → Database)

### 2.1 Synchronous path (must complete within the HTTP request)

```
1. OPTIONS preflight
   → return 204 with CORS headers (no actual CORS needed for webhooks, but we
     keep the header set for symmetry with other edge functions).

2. Method check
   → if not POST: return 405 METHOD_NOT_ALLOWED.

3. Path extraction
   → :provider_id = path segment.
   → if missing or empty: return 400 INVALID_REQUEST.

4. Content-Type check
   → must be application/x-www-form-urlencoded (WarriorPlus) or
     application/json (future providers). If neither: 415 UNSUPPORTED_MEDIA_TYPE.

5. Raw body read (text, not JSON.parse yet)
   → must preserve the EXACT bytes for signature verification AND for the
     raw_payload column (which is jsonb — parsed after signature verification).

6. Load provider config (single SELECT)
   → SELECT is_enabled, require_signature_verification, allowed_ip_ranges,
            is_test_mode, adapter_version
       FROM payment_providers WHERE id = :provider_id;
   → if not found: 404 PROVIDER_NOT_FOUND.
   → if !is_enabled: 503 PROVIDER_DISABLED (we don't accept while disabled).

7. IP allowlist (optional)
   → if allowed_ip_ranges is non-null:
       check X-Forwarded-For (or req.cf?.clientIp or remote addr) against cidr[].
     If mismatch: 403 IP_NOT_ALLOWED.

8. Resolve provider adapter
   → const adapter = getProviderAdapter(provider_id);
   → if null: 501 PROVIDER_ADAPTER_NOT_IMPLEMENTED (placeholder for future providers).

9. Parse body via adapter
   → adapter.parseBody(rawBody, contentType) → Record<string, string>
   → adapter.extractEventFields(body) → { providerEventId, providerTransactionId,
                                          providerEventType, standardizedEventType,
                                          rawEventType }
   → if any required field missing: 400 INVALID_PAYLOAD (with specific field name).

10. Signature verification (adapter-driven)
    → if require_signature_verification:
        - load active secret: SELECT secret_value_encrypted FROM
          payment_provider_secrets WHERE provider_id = :provider_id
          AND secret_name = adapter.signatureSecretName() AND is_active = true;
        - decrypt secret using project-level AES-256-GCM key from Supabase
          Edge Function Secrets.
        - adapter.verifySignature(decryptedSecret, body, rawBody, headers)
          → { isValid, reason? }
        - if invalid: 401 SIGNATURE_INVALID (do NOT log the secret value).
    → else (require_signature_verification = false):
        log a WARN: "provider has signature verification disabled".

11. Compute payload_hash
    → payload_hash = SHA-256(rawBody) (hex).

12. Enqueue atomically
    → svc.rpc("enqueue_webhook_event", {
        p_provider_id:             provider_id,
        p_provider_event_id:       providerEventId,         // IPN_ID
        p_provider_event_type:     providerEventType,        // raw WP_ACTION
        p_raw_payload:             parsedBody,               // jsonb
        p_raw_headers:             headersSnapshot,          // jsonb
        p_provider_transaction_id: providerTransactionId,    // WP_SALE
        p_trace_id:                gen_random_uuid(),
      })
    → result: { id, is_duplicate, status }

13. If is_duplicate:
    → return 200 OK with body { received: true, duplicate: true, id }
       (WarriorPlus stops retrying on 2xx; this acknowledges we already had it.)

14. If new event:
    → return 200 OK with body { received: true, id }
       (Worker will pick this up asynchronously.)

15. Error path:
    → if any step throws an unexpected error: log + return 500 INTERNAL_ERROR.
       (WarriorPlus will retry on 5xx; our enqueue RPC is idempotent so retries
       are safe.)
```

### 2.2 Asynchronous path (worker — implemented in M4, stubbed in M3)

The worker (separate edge function, cron-invoked) reads rows from `webhook_events` where `status IN ('received', 'verified', 'failed_retryable')` and calls the M53/M54 stub RPCs in order:

```
1. SELECT FOR UPDATE SKIP LOCKED  → claim event row.
2. validate event (already validated by M3; mostly a status check).
3. process_webhook_event(p_webhook_event_id)
   - adapter-specific pipeline:
     a. resolve provider → provider_products mapping (by provider_product_id, offer_id)
     b. validate product exists + is_enabled
     c. resolve_or_create_user_from_purchase(buyer_email, buyer_name, provider_id)
        (STUB M5)
     d. record_purchase_from_webhook(p_webhook_event_id)
        (STUB M6)
     e. grant_entitlement_from_purchase(p_purchase_id)
        (STUB M6 — reads provider_products.duration_value + duration_unit)
     f. update webhook_events.status = 'processed', linked_purchase_id, linked_user_id
4. On success: COMMIT, return { success: true }.
5. On retryable failure: increment retry_count, set next_retry_at with backoff,
   set status = 'failed_retryable'.
6. On terminal failure: status = 'failed_terminal' (dead letter).
7. On non-retryable failure (e.g. invalid product mapping): status = 'failed_terminal'
   immediately (no retries).
```

> **M3 delivers steps 1–2 (sync receive + enqueue). M4 implements the worker (steps 3–7) by replacing the M53 stubs.** Until M4 ships, events accumulate in `webhook_events` with `status = 'received'` and the admin sees them in the diagnostics page (M11).

---

## 3. Signature Verification Strategy

### 3.1 WarriorPlus specifics

WarriorPlus uses a **body-field signature**, not a header signature:
- Field name: `WP_SECURITYKEY`
- Format: the raw secret string set in the vendor's account security settings.
- Comparison: plain string equality (not a hash). The secret is shared out-of-band via the vendor dashboard.

This is unusual compared to Stripe (`Stripe-Signature` HMAC header) or Dodo (`Dodo-Signature` header). The adapter pattern accommodates this — each provider has its own signature strategy.

### 3.2 Storage and decryption

- The plaintext secret is **never** stored. The vendor enters it once in the M2 admin UI (out of scope for M3 — see M2 deferred items) or via SQL bootstrap.
- The secret is encrypted at rest in `payment_provider_secrets.secret_value_encrypted` (AES-256-GCM, format `iv::tag::ciphertext`, base64).
- The encryption key is a project-level secret in Supabase Edge Function Secrets: `PAYMENT_PROVIDER_ENCRYPTION_KEY` (32-byte, base64).
- Decryption happens **inside** the edge function at the moment of verification. Plaintext is held in a local variable and never logged.
- Only the active secret (`is_active = true`) is used. Rotation: insert new row with `is_active = true` and old row with `is_active = false`.

### 3.3 Timing-safe comparison

```typescript
const enc = new TextEncoder();
const a = enc.encode(providedKey);
const b = enc.encode(expectedSecret);
if (a.length !== b.length) return { isValid: false, reason: "length_mismatch" };
// constant-time comparison — implementation detail, but must NOT short-circuit
// on the first byte difference (vulnerable to timing attacks).
```

A constant-time byte-comparison helper lives in `_shared/crypto.ts` (already implied by M51 docs but not yet implemented).

### 3.4 When verification is skipped

- `payment_providers.require_signature_verification = false` (NOT recommended; admin must explicitly opt in).
- Provider test mode AND payload has `is_test_mode: true` — skip if admin sets the test-mode override flag in M2 (out of scope for M3; defer to M2.1 if needed).
- Default: verification is ON, and missing/invalid signature → 401.

### 3.5 What we return on failure

- **401 SIGNATURE_INVALID** with body `{ received: false, code: "SIGNATURE_INVALID" }`.
- We do NOT leak which check failed (length mismatch vs. content mismatch) in production logs.
- A debug log line records the failure with `reason` for engineering triage but never the secret value or the provided key.

---

## 4. Required Headers and POST Fields

### 4.1 HTTP Headers

| Header | Required | Purpose |
|---|---|---|
| `Content-Type` | YES | Must be `application/x-www-form-urlencoded` for WP. The dispatcher rejects other types with 415. |
| `User-Agent` | YES (logged) | Logged for diagnostics. WP identifies as `WarriorPlus.com` or `PayPal IPN` (since WP forwards PayPal IPN). |
| `X-Forwarded-For` | NO | Real client IP behind Supabase's edge. Used for IP allowlist. |
| `CF-Connecting-IP` | NO | Supabase runs on Cloudflare; this is an alternate source for client IP. |
| `Authorization` | NO | Public endpoint — we do NOT use Supabase JWTs for webhook auth. Signature IS the auth. |

### 4.2 Required WarriorPlus POST Fields

These fields MUST be present in the form-encoded body:

| Field | Type | Maps to (DB column / adapter field) | Notes |
|---|---|---|---|
| `WP_ACTION` | enum | `provider_event_type` | `sale`, `refund`, `dispute`, or `subscr_*` |
| `IPN_ID` | string | `provider_event_id` | Unique per IPN. Required for idempotency. |
| `WP_ITEM_NUMBER` | string | `provider_product_id` (lookup) | Maps to a row in `provider_products` |
| `WP_SECURITYKEY` | string | signature | Required when `require_signature_verification = true` |
| `WP_BUYER_EMAIL` | string | `payments.buyer_email` (deferred to M6) | Required for user resolution (M5) |
| `WP_SALE_AMOUNT` | decimal | `payments.amount` | |
| `WP_SALE_CURRENCY` | string (3) | `payments.currency` | WP docs say "currently always USD" |
| `WP_PAYMENT_STATUS` | enum | mapped to `payment_status` | `Completed`, `Pending`, `Refunded`, etc. |

### 4.3 Optional WarriorPlus POST Fields

Captured to `raw_payload` (jsonb) for audit; consumed by M4-M9:

- `WP_SALE`, `WP_TXNID` → `provider_transaction_id` (prefer `WP_SALE`)
- `IPN_RCPT_TYPE` (`vend` | `aff`) → used to filter or branch processing
- `WP_AFFID`, `WP_AFFUSER`, `WP_SID`, `WP_TID`, `WP_HOP_SID`, `WP_HOP_TID`, `WP_CHECKOUT_CUSTOM` → affiliate tracking (M10)
- `WP_BUYER_NAME`, `WP_BUYER_IP`, `WP_BUYER_ADDRESS*` → user profile (M5)
- Subscription fields: `WP_SUBSCR_ID`, `WP_SUBSCR_STATUS`, `WP_SUBSCR_PAYMENT_NUM`, `WP_SUBSCR_PAYMENT_AMOUNT`, `WP_SUBSCR_PAYMENT_TXNID`, `WP_SUBSCR_NEXT_PAYMENT_DATE` → subscription tracking (M6)
- `WP_ITEM_NAME` → display_name (display only)

### 4.4 Field validation in the adapter

The adapter validates ONLY the required fields above. If any is missing or empty:
- 400 INVALID_PAYLOAD with `{ field: "WP_ACTION" }` in the response.
- Log a WARN with provider_event_id (if extractable) and the missing field name.
- 4xx stops WP from retrying — this is correct: a missing required field will not become valid on retry.

---

## 5. Idempotency Strategy

### 5.1 Primary idempotency key

`(payment_providers.id, webhook_events.provider_event_id)` — uniquely indexed (M52 UNIQUE constraint).

For WarriorPlus, `provider_event_id = IPN_ID`. This is a UUID-like alphanumeric generated by WP per message and is the canonical idempotency token.

### 5.2 How we enforce atomicity

We use the M54-fixed `enqueue_webhook_event` RPC which does:

```sql
INSERT INTO webhook_events (...) VALUES (...)
ON CONFLICT (provider_id, provider_event_id) DO NOTHING
RETURNING id, (xmax = 0);
```

Two near-simultaneous deliveries with the same `IPN_ID`:
- First wins, returns `is_duplicate: false`.
- Second loses the ON CONFLICT, returns `is_duplicate: true`.
- No duplicate row; no 500; no race.

### 5.3 What we return to WarriorPlus on duplicate

- **200 OK** with `{ received: true, duplicate: true, id: "<uuid>" }`.
- We must NOT return 4xx or 5xx on a duplicate. WP would interpret 5xx as "please retry" and we'd be back here in minutes.
- We must NOT return 409 Conflict. WP's behavior on non-2xx is to retry; we want WP to stop retrying immediately.

### 5.4 Worker-side idempotency

The worker (M4) uses `SELECT FOR UPDATE SKIP LOCKED` on `webhook_events` rows. Multiple worker invocations cannot claim the same row. Within the worker, side-effecting RPCs (record_purchase_from_webhook, grant_entitlement_from_purchase) are themselves idempotent — designed so re-running them on the same webhook_event produces the same outcome.

### 5.5 Duplicate detection at deeper layers

- `payments` table has a UNIQUE-ish constraint via `(provider, provider_payment_id)` — the M53 index `idx_payments_provider_event` on `(provider, provider_payment_id)` provides fast lookup. The worker can check before inserting a payment row.
- Affiliate commission tables (M10) use `(referred_user_id, subscription_id)` uniqueness.
- Even if we somehow process a duplicate end-to-end, the design avoids double-grant because:
  - User resolution (M5) is keyed on buyer email + provider + transaction ID, returning the same user_id.
  - Entitlement grant (M6) uses `safe_plan_switch` from M31 which is itself idempotent.

---

## 6. Retry Behavior

### 6.1 WarriorPlus-side retry (we don't control this)

Per WarriorPlus docs and the PayPal IPN model WP inherits, when our endpoint returns a non-2xx:
- WP retries the same `IPN_ID` message up to **15 additional attempts** over approximately **4 days**.
- Retry interval increases with each attempt (not specified exactly, but PayPal's interval grows from minutes to hours).
- WP stops retrying once we return 200, OR after 4 days, OR after 15 retries.

Our design's contract:
- 2xx → WP stops retrying immediately.
- 4xx (other than 408/429) → WP stops retrying (these signal "your request is malformed, no point retrying").
- 408 (timeout) → WP may retry.
- 429 → WP may retry (rate limit).
- 5xx → WP retries.

### 6.2 Worker-side retry (we control this)

The M4 worker has its own retry mechanism with state in `webhook_events`:

| Column | Purpose |
|---|---|
| `status` | enum: `received`, `validating`, `verified`, `processing`, `processed`, `duplicate`, `failed_retryable`, `failed_terminal`, `blocked`, `awaiting_claim`, `awaiting_admin` |
| `retry_count` | integer, default 0 |
| `max_retries` | integer, default 5 |
| `next_retry_at` | timestamptz, when the worker should pick this row up next |
| `last_error` | text, last error message (truncated) |
| `error_history` | jsonb, array of `{ error, timestamp }` |

Retry schedule (exponential backoff with jitter):

| retry_count | next_retry_at delay |
|---|---|
| 0 (initial failure) | +1 minute |
| 1 | +5 minutes |
| 2 | +30 minutes |
| 3 | +2 hours |
| 4 | +12 hours |
| 5 (terminal) | status → `failed_terminal` |

- Jitter: ±20% random to prevent thundering herd.
- After `failed_terminal`: admin can manually retry via `retry_webhook_event` RPC (M55 M2 already added).
- The admin diagnostics UI (M11) shows the queue with status, retry_count, and last_error.

### 6.3 Cron schedule for the worker

- Run `process_pending_webhook_events(50, 25000)` every 5 minutes.
- Cron job defined in Supabase `cron.job` (managed separately; M4 sets it up).
- Per-call: claim up to 50 rows, with a 25-second per-call wall budget.

---

## 7. Response Codes WarriorPlus Expects

### 7.1 Mapping our responses to WP behavior

| Our status | HTTP | Body | WP behavior |
|---|---|---|---|
| Event received, new | 200 | `{ received: true, id }` | Stops retrying |
| Event received, duplicate | 200 | `{ received: true, duplicate: true, id }` | Stops retrying |
| Provider not found | 404 | `{ received: false, code: "PROVIDER_NOT_FOUND" }` | Stops retrying (4xx) |
| Provider disabled | 503 | `{ received: false, code: "PROVIDER_DISABLED" }` | Retries (5xx) |
| Signature invalid | 401 | `{ received: false, code: "SIGNATURE_INVALID" }` | Stops retrying (4xx — we choose to terminate on bad signature; an attacker who spoofs a signature should not be able to retry into success) |
| Missing/invalid required field | 400 | `{ received: false, code: "INVALID_PAYLOAD", field: "..." }` | Stops retrying (4xx) |
| Unsupported content-type | 415 | `{ received: false, code: "UNSUPPORTED_MEDIA_TYPE" }` | Stops retrying (4xx) |
| IP not allowed | 403 | `{ received: false, code: "IP_NOT_ALLOWED" }` | Stops retrying (4xx) |
| Rate limit | 429 | `{ received: false, code: "RATE_LIMITED" }` + `Retry-After` header | Retries |
| Internal error (enqueue failed) | 500 | `{ received: false, code: "INTERNAL_ERROR" }` | Retries |
| Provider adapter not implemented | 501 | `{ received: false, code: "PROVIDER_ADAPTER_NOT_IMPLEMENTED" }` | Stops retrying (we don't want a stub to retry forever; admin needs to deploy the adapter) |

### 7.2 Headers we set on every response

- `Content-Type: application/json` for non-2xx.
- For 2xx, body can be JSON or empty (WP accepts both).
- `Cache-Control: no-store`.
- `Strict-Transport-Security` (handled by Supabase gateway).
- `X-Trace-Id: <uuid>` on every response (echoes the trace_id used for logging).

### 7.3 Why we stop retrying on 401

If a request has a bad signature, retrying won't help (the secret hasn't changed). Returning 5xx would burn through WP's retry budget on something we know will never succeed. WP's retry policy treats 4xx as "permanent failure" — that's correct behavior for us here.

---

## 8. Logging Strategy

### 8.1 What we log

Structured JSON to stdout (Deno `console.info`, `console.warn`, `console.error`):

```typescript
const LOG = (level: "info" | "warn" | "error", event: string, meta: object) =>
  console[level](JSON.stringify({
    fn: "payment-webhook",
    provider_id: providerId,   // not PII
    event,
    trace_id,
    ...meta,
    ts: Date.now(),
  }));
```

### 8.2 Log events

| Event | Level | Meta |
|---|---|---|
| `REQUEST_RECEIVED` | info | `method, content_type, has_signature_field, remote_ip_cidr` |
| `PROVIDER_RESOLVED` | info | `provider_id, is_enabled, require_signature_verification` |
| `PROVIDER_NOT_FOUND` | warn | `provider_id` |
| `PROVIDER_DISABLED` | warn | `provider_id` |
| `IP_NOT_ALLOWED` | warn | `remote_ip` (we log this because it's a security event; no buyer data) |
| `SIGNATURE_VERIFIED` | info | `secret_id` (uuid only — never the plaintext) |
| `SIGNATURE_INVALID` | warn | `reason` (one of: missing, length_mismatch, mismatch); NOT the provided key |
| `INVALID_PAYLOAD` | warn | `missing_field, raw_event_type` (when extractable) |
| `ENQUEUED` | info | `webhook_event_id, payload_hash, retry_count` |
| `DUPLICATE_DETECTED` | info | `webhook_event_id, original_received_at` |
| `ENQUEUE_FAILED` | error | `error_code, error_message` (truncated) |
| `RATE_LIMITED` | warn | `limit_per_minute` |
| `RESPONSE_SENT` | info | `status, elapsed_ms` |
| `INTERNAL_ERROR` | error | `error_message, stack_first_line` (Deno truncates stack to 5 frames) |

### 8.3 What we never log

- Buyer email, name, IP (except as a one-way hash for diagnostics — see below).
- IPN_ID in plaintext when it could be replayed (we log the hash, not the raw).
- Decrypted secret value, ever.
- The provided WP_SECURITYKEY value, ever.
- Raw request body (it may contain PII).

For security-event correlation, we MAY log a SHA-256 of the buyer email or IPN_ID, but only in fields explicitly marked `_hash` so we can grep for them and exclude from any forwarder.

### 8.4 Log forwarding

Supabase forwards edge-function logs to its log explorer. We additionally POST a summary to a `payment_webhook_events` audit table for admin visibility (deferred — not in M3 scope; M11 implements the diagnostics UI).

### 8.5 Sampling

Default: log every request. (Volume from WarriorPlus is low — tens of events per day, not thousands.) No sampling needed for M3. If volume grows, we add 1-in-N sampling for `REQUEST_RECEIVED` only.

---

## 9. Failure Handling

### 9.1 Failure categories

| Category | Examples | Handling |
|---|---|---|
| Permanent (4xx) | Bad signature, malformed body, unknown provider, unsupported content-type | Return 4xx, do NOT enqueue, do NOT retry |
| Rate limit (429) | Too many requests from same IP or same provider | Return 429 with Retry-After, do NOT enqueue, WP will retry |
| Transient infrastructure (5xx) | DB unreachable, secret store unreachable | Return 5xx, do NOT enqueue, WP will retry |
| Async processing failure (worker) | Product mapping not found, user resolution failed, entitlement grant failed | Status → `failed_retryable`, schedule next_retry_at, worker retries |
| Terminal async failure | Provider sent unknown WP_ACTION, product is disabled, entitlement grant exhausted | Status → `failed_terminal`, admin must intervene (M11) |
| Unknown error | Unhandled exception in edge function | Return 500, log `INTERNAL_ERROR`, WP retries |

### 9.2 Worker failure (M4 design — informs M3 enqueue shape)

The M53 `webhook_events.status` enum has these states we rely on:

```
'received',           -- just enqueued (M3 ends here)
'validating',         -- worker checking payload shape
'verified',           -- adapter pipeline passed
'processing',         -- side effects in flight
'processed',          -- terminal success
'duplicate',          -- superseded by another event with same key (rare)
'failed_retryable',   -- will retry
'failed_terminal',    -- dead-letter
'blocked',            -- admin blocked this product/provider
'awaiting_claim',     -- guest user claim flow (M9)
'awaiting_admin',     -- admin must intervene (M11)
```

The M3 enqueue sets `status = 'received'`. All subsequent transitions happen in M4.

### 9.3 What we do when enqueue itself fails

If the RPC call fails (network blip, DB unavailable):
- We catch the exception, log `ENQUEUE_FAILED` with the error code.
- Return 500 INTERNAL_ERROR.
- WP retries, and on the next attempt we may succeed — OR if the same payload comes back, our idempotency makes it a no-op duplicate.

If `enqueue_webhook_event` returns a `DUPLICATE_PRODUCT_MAPPING`-style error (it shouldn't — that's only on products, not events), we log and return 500 (this is a true internal bug).

### 9.4 Timeout within the edge function

Supabase edge functions have a hard 60-second timeout (configurable up to 300s for Pro plan). Our sync path is designed to finish in well under 5 seconds:

| Step | Estimated latency |
|---|---|
| Read body | 5 ms |
| Load provider config | 50 ms |
| IP allowlist | 1 ms |
| Parse body | 5 ms |
| Decrypt secret | 5 ms |
| Verify signature | 5 ms |
| Compute payload_hash | 10 ms |
| Enqueue (INSERT) | 100 ms |
| **Total** | ~200 ms p99 |

If anything exceeds 5s, we have a bug — most likely the DB is slow or the secret store is timing out. We add `AbortSignal.timeout(5000)` on the enqueue RPC and surface a 500 INTERNAL_ERROR.

---

## 10. Security Protections Against Spoofed Requests

### 10.1 Defense in depth

| Layer | Defense |
|---|---|
| 1 | HTTPS only (Supabase gateway enforces). No HTTP allowed. |
| 2 | Path validation: provider_id must exist in DB (404 otherwise). |
| 3 | Provider must be `is_enabled = true` (503 otherwise). |
| 4 | Signature verification (401 on bad signature, no body content leak). |
| 5 | Timing-safe signature comparison. |
| 6 | IP allowlist (CIDR[] from DB) — optional but recommended. |
| 7 | Rate limit (429 on abuse). |
| 8 | Decrypted secrets held in memory only; never logged, never persisted. |
| 9 | `raw_payload` is the untrusted provider payload — never executed, never eval'd. |
| 10 | Headers from the provider (e.g. X-Forwarded-For) are logged as raw values but never trusted for security decisions without validation. |
| 11 | No CORS — the endpoint is not browser-callable. |
| 12 | All admin endpoints require JWT; webhook endpoint requires signature. No "service_role bypass" path on the webhook. |

### 10.2 Spoofing scenarios and our defenses

**Scenario A: Attacker sends a forged IPN with valid-looking fields but no signature.**
- If `require_signature_verification = true`: 401. Attack fails.
- If admin disabled it: attack succeeds. → Document this risk in the M2 admin UI ("Disabling signature verification is dangerous").

**Scenario B: Attacker replays a captured valid IPN.**
- `enqueue_webhook_event` sees the duplicate `IPN_ID` and returns `is_duplicate = true`.
- Worker (M4) sees the row already in `processed` status and skips.
- The attacker cannot re-grant an entitlement. Idempotency holds.

**Scenario C: Attacker sends IPNs from a non-WarriorPlus IP range.**
- If `allowed_ip_ranges` is set on the provider (admin's responsibility to populate — M2 UI exposes this field): 403.
- Otherwise: relies on signature alone. WarriorPlus does not publish their IP ranges; we cannot include a sensible default. → Assumption: admin sets the IP allowlist manually based on WarriorPlus support contact, OR we proceed without IP allowlist and rely on signature.

**Scenario D: Attacker compromises the edge function secret store.**
- Out of scope; same threat model as every Supabase function. Mitigated by Supabase SOC2 + our key rotation policy (out of M3 scope).

**Scenario E: Attacker brute-forces signatures.**
- Infeasible for HMAC-equivalent secrets with sufficient entropy. Our secret format requires the vendor to set a high-entropy secret in the WP dashboard. We document this in admin onboarding.

**Scenario F: Replay attack between M3 and M4 (event received, processed, but M4 fails before marking processed).**
- M4's worker is designed to be safely re-runnable: `record_purchase_from_webhook` and `grant_entitlement_from_purchase` are idempotent. Re-processing the same event after partial failure produces the same end state.

### 10.3 Replay window

- For the ~minutes between M3 enqueue and M4 processing, the same event cannot be replayed successfully because `enqueue_webhook_event` rejects duplicates.
- For events that have already been marked `processed`, the worker's "skip if processed" guard handles it.

---

## 11. Rate Limiting Strategy

### 11.1 Layers

**Layer 1: Supabase platform-level.**
- Supabase enforces 100 requests/second per IP at the gateway. Beyond that, requests get 429 before reaching our function.

**Layer 2: Per-provider in-memory counter.**
- For M3, a simple per-(provider_id, minute-bucket) counter held in the edge function's module-level state.
- Default limit: 60 requests/minute per provider.
- On exceed: 429 with `Retry-After: <seconds-until-next-minute>` header.
- The counter resets every minute.

**Layer 3: Per-IP allowlist enforcement (orthogonal).**
- If `allowed_ip_ranges` is set on the provider, the IP check is effectively a rate limiter (only legitimate WP IPs can reach us).

### 11.2 Why in-memory and not distributed

- Edge functions are short-lived and may run in multiple instances; we accept that the per-provider counter is approximate.
- For real DDoS, Layer 1 (Supabase gateway) is the right place.
- The counter is best-effort, not security-critical.

### 11.3 Worker-side rate limiting

The worker (M4) processes at most 50 events per cron tick (5-minute interval). For M3 this is configured but unused (worker is a stub). No additional rate limiting needed at M3.

### 11.4 Logging rate-limit hits

Rate-limit hits are logged with `RATE_LIMITED` at WARN level. We do NOT auto-blacklist IPs (admin responsibility; M11).

---

## 12. Timeout Handling

### 12.1 Edge function timeout

- Supabase default: 60 seconds (free) / 300 seconds (Pro).
- We configure the function with `verify_jwt = false` and `timeout = 30` (Deno-deploy equivalent).
- Our sync path targets <5 seconds, leaving ample headroom.

### 12.2 Per-call timeouts

- DB RPC call: 5 seconds (`AbortSignal.timeout(5000)`).
- Supabase JS client: default fetch timeout, but we wrap calls in `AbortController` for explicit control.
- No external HTTP calls in the sync path (we don't call out to WarriorPlus — they call us).

### 12.3 Worker timeout

- Worker batch limit: 25 seconds (per the M53 stub signature `p_max_runtime_ms`).
- Cron interval: 5 minutes.
- If a single event takes >25 seconds to process, the worker marks it `failed_retryable` with `last_error = "processing_timeout"` and moves on.

### 12.4 What happens on timeout

- If the HTTP response hasn't been sent yet, the function times out and the platform returns 504 to the caller (WP). WP retries.
- If we've already enqueued, the row is persisted; the worker will pick it up regardless.
- If we time out after enqueue but before sending the response, the next WP retry will hit our `is_duplicate` branch and return 200 immediately. Net effect: zero data loss.

---

## 13. Synchronous vs Asynchronous Boundary

### 13.1 Sync (in the HTTP request — completes within 5 seconds)

| Step | Why sync | Why not async |
|---|---|---|
| Read raw body | Required for signature verification | N/A |
| Verify signature | Auth gate — must reject before persisting anything | Async would mean persisting unauthenticated data |
| Parse provider fields | Required to compute idempotency key | N/A |
| Compute payload_hash | Required to detect duplicates via the M54 ON CONFLICT path | N/A |
| `enqueue_webhook_event` | Atomic INSERT with ON CONFLICT | Worker is downstream |
| Return 200 to WP | Required to stop WP retries | N/A |

**Hard constraint:** if any sync step fails (other than enqueue), we do NOT enqueue. Returning 5xx without persisting is safe: WP retries with the same `IPN_ID`, and on success the event lands in the queue.

### 13.2 Async (worker — M4 implementation)

| Step | Why async |
|---|---|
| Load product mapping | DB read; could be slow under contention |
| Resolve or create user | May trigger external flows (auth, email) |
| Record purchase row | Multiple related writes; better in transaction |
| Grant entitlement | Calls `safe_plan_switch` (existing complex RPC) |
| Send claim email (M9) | External HTTP call to email provider |
| Update webhook_events status | Final terminal write |

**Why async is necessary:**
- The full processing can take 5–30 seconds per event (especially on the first purchase, which triggers user creation + welcome email).
- We must return 200 to WP within a few seconds — not 30.
- Idempotent retries require an isolated, replayable pipeline.
- Failure isolation: a bad product mapping shouldn't block other events.

### 13.3 Cron-driven vs on-demand

- Cron: every 5 minutes. Picks up events where `status IN ('received', 'failed_retryable') AND next_retry_at <= now()`.
- Manual retry (admin UI in M11): calls `retry_webhook_event(p_webhook_event_id)` which resets status to `received` and `retry_count` to 0.

---

## 14. Provider-Agnostic Integration

### 14.1 The adapter interface

```typescript
// supabase/functions/_shared/providers/types.ts

export interface ProviderAdapter {
  /** Stable provider id; matches payment_providers.id. */
  readonly id: string;

  /** Display name (for logs only). */
  readonly displayName: string;

  /** What Content-Type this adapter expects. */
  readonly expectedContentType: string;

  /**
   * Parse the raw request body into a structured record.
   * For WP: returns the form-encoded key/value pairs.
   * For Stripe: returns the JSON-parsed body.
   */
  parseBody(rawBody: string, contentType: string): Record<string, string>;

  /**
   * Extract the canonical idempotency key, transaction id, and event type.
   * Must throw { code: "INVALID_PAYLOAD", field: "..." } if a required field
   * is missing.
   */
  extractEventFields(body: Record<string, string>): {
    providerEventId: string;
    providerTransactionId: string | null;
    providerEventType: string;        // raw provider event type (e.g. "sale")
    standardizedEventType: string | null;  // internal taxonomy (e.g. "purchase.created")
  };

  /**
   * Verify the signature. Returns { isValid: true } or
   * { isValid: false, reason: "..." } where reason is a short code,
   * not the secret or provided key.
   */
  verifySignature(
    decryptedSecret: string,
    body: Record<string, string>,
    rawBody: string,
    headers: Headers,
  ): { isValid: boolean; reason?: string };

  /**
   * Which secret in payment_provider_secrets to use for signature verification.
   * Most providers use "webhook_secret"; WP uses "ipn_security_key".
   */
  signatureSecretName(): string;
}
```

### 14.2 The dispatcher

```typescript
// payment-webhook/index.ts (sketch — for design review only)

const ADAPTERS: Record<string, ProviderAdapter> = {
  warriorplus: new WarriorPlusAdapter(),
  // lemonsqueezy: new LemonSqueezyAdapter(),   // future
  // stripe: new StripeAdapter(),                // future
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const providerId = pathParam(req.url, "provider_id");
  if (!providerId) return invalidRequest("provider_id missing");

  const adapter = ADAPTERS[providerId];
  if (!adapter) return notImplemented(providerId);

  // ... steps 4-14 from §2.1 ...
});
```

### 14.3 WarriorPlus adapter (only full implementation in M3)

Location: `supabase/functions/_shared/providers/warriorplus.ts`.

Implements:
- `parseBody`: URL-decode form data.
- `extractEventFields`: pull `IPN_ID`, `WP_SALE`, `WP_ACTION` and map to canonical fields.
- `verifySignature`: compare `WP_SECURITYKEY` body field to decrypted secret using timing-safe equality.
- `signatureSecretName()`: returns `"ipn_security_key"`.

Maps `WP_ACTION` to standardized events:

| WP_ACTION | standardized_event_type |
|---|---|
| `sale` | `purchase.created` |
| `refund` | `purchase.refunded` |
| `dispute` | `purchase.disputed` |
| `subscr_created` | `subscription.created` |
| `subscr_completed` | `subscription.renewed` |
| `subscr_cancelled` | `subscription.cancelled` |
| `subscr_refunded` | `subscription.refunded` |
| `subscr_failed_invalid` | `subscription.payment_failed` |
| `subscr_failed_declined` | `subscription.payment_failed` |
| `subscr_suspended` | `subscription.suspended` |
| `subscr_reactivated` | `subscription.reactivated` |
| `subscr_ended` | `subscription.ended` |

### 14.4 What lives outside the adapter

- **Provider enable/disable checks** → dispatcher (DB-backed, provider-agnostic).
- **IP allowlist** → dispatcher (DB-backed).
- **Secret retrieval** → dispatcher (`payment_provider_secrets` is provider-agnostic).
- **Decryption** → dispatcher (`_shared/crypto.ts`, provider-agnostic).
- **Idempotency / enqueue** → dispatcher (uses the M54 RPC, provider-agnostic).
- **Async worker / processing pipeline** → out of M3 scope (M4 implements).

### 14.5 Adding a new provider (post-M3)

To add Stripe, for example:
1. Add a `payment_providers` row via M2 admin UI (id=`stripe`, enabled=later).
2. Add the Stripe secret via M2 admin UI (or SQL bootstrap).
3. Implement `StripeAdapter` in `_shared/providers/stripe.ts` matching the interface.
4. Register it in `ADAPTERS` in the dispatcher.
5. Deploy.

No DB migration needed. No webhook endpoint change. The dispatcher + worker + admin UI are 100% provider-agnostic.

---

## 15. Open Assumptions Requiring User Confirmation

Before implementation, please confirm or correct the following:

### 15.1 WarriorPlus retry semantics
**Assumption:** WP retries non-2xx responses up to 15 times over ~4 days, following PayPal IPN behavior.
**Risk:** If WP has different retry behavior (e.g. exponential backoff is steeper, or they retry on 4xx too), our response code strategy (§7) may need adjustment.
**How to confirm:** Test in WP staging environment with deliberately bad endpoint, observe retries; or contact WP support.

### 15.2 `WP_SECURITYKEY` format
**Assumption:** The `WP_SECURITYKEY` field contains the raw shared secret set by the vendor in the WP account security settings, and we compare it directly with the stored secret using timing-safe equality.
**Risk:** If WP sends a hash (e.g. SHA256 of the secret) instead of the raw secret, our comparison would always fail.
**How to confirm:** Capture a real WP test IPN and inspect the WP_SECURITYKEY value; or read WP's advanced integration docs for "security key verification".

### 15.3 WarriorPlus IP ranges
**Assumption:** WP does not publish a stable IP allowlist. Admin must populate `allowed_ip_ranges` manually (or leave it NULL and rely on signature only).
**Risk:** Without IP allowlist, an attacker who steals a valid IPN_ID + signature can replay it (but cannot create new events).
**How to confirm:** Ask WP support for their outbound IP ranges; if available, hard-code a sensible default and let admin override.

### 15.4 Affiliate webhooks
**Assumption:** `IPN_RCPT_TYPE = 'aff'` events will be received and should be persisted but NOT processed by M3. M10 (affiliate commissions) implements their processing.
**Risk:** If we should reject affiliate IPNs entirely (e.g. 4xx them so WP stops sending), the dispatcher behavior changes.
**How to confirm:** Decide whether affiliate IPNs should be accepted-and-stored or rejected at the edge.

### 15.5 Dispute and chargeback handling
**Assumption:** `WP_ACTION = 'dispute'` is enqueued and processed in M7/M8 (refund handling). M3 just persists.
**Risk:** If we want to immediately downgrade entitlements on dispute, that's a M3+ concern; if not, we defer.
**How to confirm:** Confirm the desired M3 boundary: enqueue-only, or enqueue + auto-downgrade on dispute.

### 15.6 Subscription IPNs
**Assumption:** `subscr_*` events are enqueued. M6 implements subscription-specific handling (multiple grants per subscr_payment_num).
**Risk:** If subscription renewals should not extend entitlements in M3, the worker's behavior must be deferred entirely (which it is — M3 doesn't run the worker).
**How to confirm:** Verify the M3 boundary: enqueue-only.

### 15.7 Currency assumption
**Assumption:** WP always sends `WP_SALE_CURRENCY = "USD"`. We accept any 3-letter ISO code in the schema but only USD is expected in practice for M3.
**Risk:** If a vendor sells in EUR via WP somehow, we need to handle currency conversion at entitlement-grant time. (Not in M3 scope.)
**How to confirm:** Confirm WP only supports USD today; our schema already supports multi-currency for future providers.

### 15.8 `provider_customer_id` source
**Assumption:** WP does not send a stable customer identifier. User resolution in M5 will key on `WP_BUYER_EMAIL` alone.
**Risk:** If a buyer uses multiple emails across purchases, M5 will create multiple `auth.users` rows. This is a known M5 design constraint, not an M3 issue.
**How to confirm:** Verify WP has no `WP_BUYER_ID` or similar stable identifier we should capture.

### 15.9 Encryption key bootstrap
**Assumption:** `PAYMENT_PROVIDER_ENCRYPTION_KEY` is provisioned in Supabase Edge Function Secrets before M3 ships. The M2 admin UI for entering/updating secrets is explicitly out of scope for M2 (deferred).
**Risk:** Until we have a way to enter the WP_SECURITYKEY into `payment_provider_secrets`, M3 will reject all webhooks with 401 (signature verification will fail with "no active secret").
**How to confirm:** Decide whether M3 ships with a SQL bootstrap path for the secret, or whether we MUST implement the M2 secret-rotation UI before M3 can be tested end-to-end.

### 15.10 Edge function concurrency
**Assumption:** Supabase runs our function in multiple concurrent instances. The in-memory rate-limit counter (§11) is approximate.
**Risk:** In a burst, we may slightly exceed the configured rate limit per provider. This is acceptable — Supabase's gateway is the real gate.
**How to confirm:** This is a known limitation; no action needed.

### 15.11 Content-Type variants
**Assumption:** WP sends `application/x-www-form-urlencoded`. We reject other types with 415.
**Risk:** If WP sometimes sends `multipart/form-data` or `application/x-www-form-urlencoded; charset=utf-8`, we may need to parse both.
**How to confirm:** Test with real WP traffic.

### 15.12 Test mode
**Assumption:** WP has no native "test mode" toggle for IPNs. We use `is_test_mode` on `payment_providers` to mark the provider row for sandbox behavior, but this is admin-controlled, not WP-controlled.
**Risk:** Tests against real WP require real WP test accounts.
**How to confirm:** Confirm we will provision a WP sandbox vendor account for staging tests.

---

## 16. Implementation Outline (for the M3 plan, not actual code)

When approved, the M3 implementation will produce:

### 16.1 Files to create

| Path | Purpose |
|---|---|
| `supabase/functions/_shared/crypto.ts` | AES-256-GCM encrypt/decrypt, constant-time byte comparison |
| `supabase/functions/_shared/providers/types.ts` | `ProviderAdapter` interface |
| `supabase/functions/_shared/providers/registry.ts` | `ADAPTERS` map + lookup helper |
| `supabase/functions/_shared/providers/warriorplus.ts` | WP-specific adapter |
| `supabase/functions/payment-webhook/index.ts` | Single dispatcher edge function |
| `supabase/functions/process-webhook-worker/index.ts` | (Stub for M4 — M3 only logs "no worker yet") |
| `scripts/test-webhook-warriorplus.ts` | Local test harness that posts a simulated WP IPN |
| `.kimchi/docs/milestone-3-webhook-receiver-design.md` | (this file) |
| `.kimchi/docs/milestone-3-testing-checklist.md` | M3 testing checklist |
| `.kimchi/docs/milestone-3-rollout-runbook.md` | Staging → production rollout steps |

### 16.2 Files to modify

| Path | Change |
|---|---|
| `supabase/migrations/55_admin_payment_provider_rpcs.sql` | (already exists from M2 — no changes for M3) |
| `supabase/config.toml` | Register `payment-webhook` function with appropriate config |

### 16.3 DB migration

**None.** M3 reuses everything from M1-M2. The `enqueue_webhook_event` RPC from M54 is exactly what M3 calls.

### 16.4 Env vars to provision

| Var | Where | Purpose |
|---|---|---|
| `PAYMENT_PROVIDER_ENCRYPTION_KEY` | Supabase Edge Function Secrets | 32-byte AES key (base64) for decrypting `payment_provider_secrets.secret_value_encrypted` |
| `WP_IPN_SECURITY_KEY` (WarriorPlus) | Supabase Edge Function Secrets OR `payment_provider_secrets` row | The vendor's shared secret (raw string from WP dashboard). Stored encrypted via M2 admin UI (out of scope for M3) or seeded via SQL for first deploy. |

### 16.5 M3 exit criteria

- [ ] `payment-webhook` deployed to staging and responds 200 to a real (or simulated) WP test IPN.
- [ ] Signature verification works with a real WP secret.
- [ ] Duplicate IPN_ID returns 200 with `duplicate: true` (no row inserted).
- [ ] Invalid signature returns 401.
- [ ] Unknown provider_id returns 404.
- [ ] Disabled provider returns 503.
- [ ] All 12 log events emit structured JSON with no PII.
- [ ] No payment_provider_secrets row is ever exposed in any response.
- [ ] Build green; no new lint errors on M3 files.
- [ ] Open assumptions in §15 confirmed by user.

---

## 17. References

- WarriorPlus IPN documentation: <https://help.warriorplus.com/en/articles/1658556-ipn-and-keygen-variables>
- PayPal IPN retry behavior (inherited by WarriorPlus): <https://www.paypal.com/us/cshelp/article/how-do-I-troubleshoot-instant-payment-notification-ipn-ts2082>
- RobinOS M1 design (migration 51–54): `supabase/migrations/51_payment_providers.sql`, `52_provider_products_and_webhook_events.sql`, `53_payments_extension_and_rpcs.sql`, `54_fix_milestone_1_critical_bugs.sql`
- RobinOS M2 design: `.kimchi/docs/milestone-2-testing-checklist.md`

---

**Awaiting review. Once approved and §15 assumptions confirmed, M3 implementation begins.**
