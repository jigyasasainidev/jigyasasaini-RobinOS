# Milestone 3 — Webhook Receiver — Testing Checklist

**Status:** Implementation complete. Awaiting sign-off before Milestone 4.

**Scope:** Synchronous webhook receiver (no async processing).
**Companion to:** `.kimchi/docs/milestone-3-webhook-receiver-design.md`, `.kimchi/docs/milestone-3-verification-and-readiness.md`, `.kimchi/docs/milestone-3-rollout-runbook.md`.

**Reuses:** Milestone 1 schema (`payment_providers`, `payment_provider_secrets`, `webhook_events`) and the M54-fixed `enqueue_webhook_event` RPC. **No DB migrations required for M3.**

---

## Pre-Test Setup

Before running the tests:

- [ ] Milestone 1 (migrations 51–54) is applied on staging.
- [ ] Milestone 2 (migration 55 + admin UI) is applied on staging.
- [ ] Database backup taken immediately before testing.
- [ ] `PAYMENT_PROVIDER_ENCRYPTION_KEY` provisioned in staging Edge Function Secrets.
  - Generate with: `openssl rand -base64 32`
  - Must be exactly 32 bytes (44 base64 chars including padding).
- [ ] At least one `payment_providers` row with `id='warriorplus'` exists (seeded by M51).
- [ ] `payment_provider_secrets` row seeded with the WP shared secret under `secret_name='ipn_security_key'`.
  - Use the bootstrap SQL in the rollout runbook OR use the encrypt-and-insert helper below.
- [ ] `supabase functions deploy payment-webhook` has been run on staging.
- [ ] `supabase functions deploy process-webhook-worker` has been run on staging (stub body).
- [ ] `scripts/test-webhook-warriorplus.cjs` is in the repo and executable.

### Helper: Encrypt + insert the WP secret locally

If you don't want to run SQL, use this one-off Deno script (drop in a temp file and run):

```ts
// Save as tmp/encrypt-secret.ts, run with: deno run --allow-env --allow-net tmp/encrypt-secret.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encryptSecret } from "../supabase/functions/_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED       = Deno.env.get("WP_SHARED_SECRET")!;
const PROVIDER_ID  = "warriorplus";
const SECRET_NAME  = "ipn_security_key";

const encrypted = await encryptSecret(SHARED);
const supabase  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Deactivate any prior active row.
await supabase.from("payment_provider_secrets")
  .update({ is_active: false })
  .eq("provider_id", PROVIDER_ID)
  .eq("secret_name", SECRET_NAME)
  .eq("is_active", true);

const { error } = await supabase.from("payment_provider_secrets").insert({
  provider_id: PROVIDER_ID,
  secret_name: SECRET_NAME,
  secret_value_encrypted: encrypted,
  is_active: true,
  description: "Seeded via tmp/encrypt-secret.ts",
});
if (error) {
  console.error("Insert failed:", error);
  Deno.exit(1);
}
console.log("Secret seeded.");
```

---

## Test 1: Function deployment

```bash
supabase functions deploy payment-webhook --project-ref <staging-ref>
supabase functions deploy process-webhook-worker --project-ref <staging-ref>
```

**Verify:**
- [ ] Both functions deploy without error
- [ ] Function URL: `https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus`
- [ ] `verify_jwt = false` for both (visible in `supabase/functions/*/index.ts` and `supabase/config.toml`)
- [ ] Worker URL exists: `https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker`

---

## Test 2: OPTIONS preflight

```bash
curl -i -X OPTIONS \
  'https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus'
```

**Verify:**
- [ ] HTTP 204
- [ ] `Access-Control-Allow-Origin: *` header present
- [ ] `Access-Control-Allow-Methods` includes POST

---

## Test 3: Method check (GET)

```bash
curl -i -X GET \
  'https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus'
```

**Verify:**
- [ ] HTTP 405
- [ ] `Allow: POST, OPTIONS` header present
- [ ] No body required, no body returned

---

## Test 4: Valid WP IPN (happy path)

```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
WP_SHARED_SECRET="<your-staging-secret>" \
node scripts/test-webhook-warriorplus.cjs valid
```

**Verify (HTTP):**
- [ ] HTTP 200
- [ ] Response body: `{ "received": true, "id": "<uuid>" }`
- [ ] `X-Trace-Id` header present (matches the body id would be a coincidence — trace_id is internal)

**Verify (DB):**
```sql
SELECT id, provider_id, provider_event_id, provider_event_type,
       standardized_event_type, status, payload_hash, trace_id,
       raw_payload->>'WP_BUYER_EMAIL' AS email_captured,
       raw_payload->>'WP_SALE_AMOUNT' AS amount_captured
FROM public.webhook_events
WHERE id = '<id from response>';
```

- [ ] `provider_id = 'warriorplus'`
- [ ] `provider_event_type = 'sale'`
- [ ] `standardized_event_type = 'purchase.created'`
- [ ] `status = 'received'`
- [ ] `payload_hash` is a 64-char SHA-256 hex of the raw body
- [ ] `trace_id` is a non-null UUID
- [ ] `email_captured = 'test-buyer@example.com'` (form field present in raw_payload)
- [ ] `amount_captured = '39.00'`

---

## Test 5: Duplicate detection

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs duplicate
```

**Verify (script output):**
- [ ] Both calls return HTTP 200
- [ ] First body has `id`, no `duplicate` key
- [ ] Second body has same `id`, `duplicate: true`
- [ ] Both bodies have `received: true`

**Verify (DB):**
```sql
SELECT count(*) FROM public.webhook_events
WHERE provider_id = 'warriorplus'
  AND provider_event_id = '<the-ipn-id-from-the-test>';
-- Expected: 1
```

- [ ] Exactly one row exists for the duplicate IPN_ID
- [ ] No new row created by the second delivery

---

## Test 6: Invalid signature (401)

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs invalid-sig
```

**Verify:**
- [ ] HTTP 401
- [ ] Response body: `{ "received": false, "code": "SIGNATURE_INVALID" }`
- [ ] No field reveals whether the key length matched or the value matched

**Verify (DB):**
```sql
-- Use the IPN_ID printed by the script
SELECT count(*) FROM public.webhook_events
WHERE provider_id = 'warriorplus'
  AND provider_event_id = '<the-ipn-id-from-the-test>';
-- Expected: 0
```

- [ ] No row inserted on signature failure
- [ ] Edge function logs (Supabase dashboard) show `SIGNATURE_INVALID` with `reason=mismatch`

---

## Test 7: Missing required field (400)

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs missing-required
```

**Verify:**
- [ ] HTTP 400
- [ ] Response body: `{ "received": false, "code": "INVALID_PAYLOAD", "field": "WP_ACTION" }`
- [ ] No DB row inserted

---

## Test 8: Unknown provider (404)

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs unknown-provider
```

**Verify:**
- [ ] HTTP 404
- [ ] Response body: `{ "received": false, "code": "PROVIDER_NOT_FOUND" }`
- [ ] No DB row inserted

---

## Test 9: Wrong Content-Type (415)

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs wrong-content-type
```

**Verify:**
- [ ] HTTP 415
- [ ] Response body: `{ "received": false, "code": "UNSUPPORTED_MEDIA_TYPE", "expected": "application/x-www-form-urlencoded" }`
- [ ] No DB row inserted

---

## Test 10: Provider disabled (503)

```sql
-- Disable the provider
UPDATE public.payment_providers
SET is_enabled = false
WHERE id = 'warriorplus';
```

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs valid
```

**Verify:**
- [ ] HTTP 503
- [ ] Response body: `{ "received": false, "code": "PROVIDER_DISABLED" }`
- [ ] No DB row inserted

**After test:**
```sql
UPDATE public.payment_providers SET is_enabled = true WHERE id = 'warriorplus';
```

---

## Test 11: Provider missing (re-create row scenario)

```sql
DELETE FROM public.payment_providers WHERE id = 'warriorplus';
```

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs valid
```

**Verify:**
- [ ] HTTP 404
- [ ] Response body: `{ "received": false, "code": "PROVIDER_NOT_FOUND" }`

**After test:** Restore the row (use M2 admin UI to recreate, or apply the seed insert from M51 migration).

---

## Test 12: IP allowlist (403)

```sql
-- Add the test client IP to the deny list.
-- X-Forwarded-For sent by the test script is 203.0.113.42 (RFC 5737 TEST-NET-3).
UPDATE public.payment_providers
SET allowed_ip_ranges = ARRAY['10.0.0.0/8']::cidr[]
WHERE id = 'warriorplus';
```

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs valid
```

**Verify:**
- [ ] HTTP 403
- [ ] Response body: `{ "received": false, "code": "IP_NOT_ALLOWED" }`
- [ ] No DB row inserted

**After test:**
```sql
UPDATE public.payment_providers SET allowed_ip_ranges = NULL WHERE id = 'warriorplus';
```

---

## Test 13: Rate limiting (429)

```bash
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs bulk --count 75
```

**Verify:**
- [ ] First 60 calls return HTTP 200 with `received: true`
- [ ] Calls 61–75 return HTTP 429 with `code: "RATE_LIMITED"`
- [ ] 429 responses include `Retry-After: <seconds>` header

**Note:** The in-memory rate limiter is best-effort and resets every minute. This test is reliable when run against a single function instance; multi-instance deployments may not enforce the limit strictly. Document the observed behaviour.

---

## Test 14: Raw payload integrity

After running any valid-mode test, inspect the persisted row:

```sql
SELECT raw_payload
FROM public.webhook_events
WHERE provider_id = 'warriorplus'
ORDER BY received_at DESC
LIMIT 1;
```

**Verify the jsonb contains every WP_* field sent in the test body:**
- [ ] `WP_ACTION`
- [ ] `IPN_ID`
- [ ] `WP_SALE` / `WP_TXNID`
- [ ] `WP_ITEM_NUMBER`
- [ ] `WP_SECURITYKEY` (we store it — it's the provider's value, not our stored secret; the dispatcher does NOT log it but DOES store it in raw_payload for audit)
- [ ] `WP_BUYER_EMAIL`
- [ ] `WP_SALE_AMOUNT`
- [ ] `WP_SALE_CURRENCY`
- [ ] `WP_PAYMENT_STATUS`
- [ ] `IPN_RCPT_TYPE`
- [ ] `IPN_DATE`
- [ ] `WP_ITEM_NAME`

**Verify:**
- [ ] Every field is exactly as sent (no truncation, no transformation)
- [ ] Field names are case-preserved

---

## Test 15: Log output verification

Trigger one of each event type and inspect Supabase Edge Function logs:

| Mode | Expected `event` log line |
|---|---|
| valid | `REQUEST_RECEIVED` → `PROVIDER_RESOLVED` → `SIGNATURE_VERIFIED` → `ENQUEUED` |
| duplicate | `REQUEST_RECEIVED` → `PROVIDER_RESOLVED` → `SIGNATURE_VERIFIED` → `DUPLICATE_DETECTED` |
| invalid-sig | `REQUEST_RECEIVED` → `PROVIDER_RESOLVED` → `SIGNATURE_INVALID` |
| unknown-provider | `REQUEST_RECEIVED` → `PROVIDER_NOT_FOUND` |
| wrong-content-type | `REQUEST_RECEIVED` → `UNSUPPORTED_MEDIA_TYPE` |
| method-not-allowed | (no log — rejected before adapter resolution) |

**For every log line, verify:**
- [ ] Is valid JSON with `fn: "payment-webhook"`, `event`, `provider_id`, `trace_id`, `ts`
- [ ] Does NOT contain: `WP_BUYER_EMAIL`, `WP_BUYER_NAME`, `WP_BUYER_IP`, decrypted secret, provided `WP_SECURITYKEY` value, raw IPN_ID value (the script prints IPN_ID; the LOG line must use a hash)
- [ ] PII fields use `_hash` suffix (e.g. `provider_event_id_hash`)
- [ ] `trace_id` is consistent across all log lines for one request

---

## Test 16: No secret leak in any response

For every test above, capture the full response and verify:
- [ ] No field contains the WP shared secret value (the literal string from `WP_SHARED_SECRET`)
- [ ] No field contains the encrypted ciphertext from `payment_provider_secrets.secret_value_encrypted`
- [ ] No field contains any `payment_provider_secrets` row id

For invalid-signature responses specifically:
- [ ] The `reason` field is one of: `missing_secret_field`, `missing_stored_secret`, `length_mismatch`, `mismatch`, `decrypt_failed`
- [ ] No reason field reveals the provided key value or the stored secret value

---

## Test 17: Worker stub returns "not implemented"

```bash
curl -i -X POST \
  'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker'
```

**Verify:**
- [ ] HTTP 200
- [ ] Response body includes `"implemented": false`
- [ ] Function logs include `STUB_CALLED` event with note about M4
- [ ] No DB writes

---

## Test 18: Concurrent delivery race

Open two terminals and run simultaneously (use the same IPN_ID):

```bash
# Terminal A
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs valid &

# Terminal B
SUPABASE_URL="..." WP_SHARED_SECRET="..." \
  node scripts/test-webhook-warriorplus.cjs valid &
```

To force the race, set the IPN_ID manually by editing the script (or use a unique IPN_ID per run and check the second-by-second ordering in `webhook_events`).

**Verify:**
- [ ] Exactly one row in `webhook_events` for the duplicated IPN_ID
- [ ] Both calls returned 200
- [ ] One call returned `duplicate: true` and the other did not

This validates the M54 atomic `ON CONFLICT` fix is doing its job.

---

## Test 19: Standardized event mapping coverage

Insert test IPNs for each `WP_ACTION` value and verify the mapping:

| WP_ACTION | Expected `standardized_event_type` | Expected `event_mapping_confidence` |
|---|---|---|
| `sale` | `purchase.created` | `exact` |
| `refund` | `purchase.refunded` | `exact` |
| `dispute` | `purchase.disputed` | `exact` |
| `subscr_created` | `subscription.created` | `exact` |
| `subscr_completed` | `subscription.renewed` | `exact` |
| `subscr_cancelled` | `subscription.cancelled` | `exact` |
| `subscr_refunded` | `subscription.refunded` | `exact` |
| `subscr_failed_invalid` | `subscription.payment_failed` | `exact` |
| `subscr_failed_declined` | `subscription.payment_failed` | `exact` |
| `subscr_suspended` | `subscription.suspended` | `exact` |
| `subscr_reactivated` | `subscription.reactivated` | `exact` |
| `subscr_ended` | `subscription.ended` | `exact` |
| `unknown_action` | `NULL` | `unknown` |

**Verify:**
- [ ] Each row persists with the expected mapping
- [ ] Unknown actions persist with `standardized_event_type = NULL` and `event_mapping_confidence = 'unknown'`
- [ ] No row is rejected for an unknown action (we enqueue regardless)

---

## Test 20: Build + lint

```bash
npm run build
npm run lint
```

**Verify:**
- [ ] Build succeeds
- [ ] No new TypeScript errors in:
  - `supabase/functions/_shared/crypto.ts`
  - `supabase/functions/_shared/providers/types.ts`
  - `supabase/functions/_shared/providers/registry.ts`
  - `supabase/functions/_shared/providers/warriorplus.ts`
  - `supabase/functions/payment-webhook/index.ts`
  - `supabase/functions/process-webhook-worker/index.ts`
  - `scripts/test-webhook-warriorplus.cjs`

---

## Test 21: Regression — existing webhook flows

- [ ] `dodo-webhook` endpoint unchanged: a real Dodo test event still returns 200 and processes correctly.
- [ ] `whop-webhook` endpoint unchanged: a real Whop test event still returns 200 and processes correctly.
- [ ] Existing admin RPCs (`admin_list_providers`, etc.) still work.
- [ ] `/adminsh/payment-providers` UI still renders and updates providers.
- [ ] No existing RPC, table, column, RLS policy, or trigger has been modified.

---

## Test Results Summary

| Test | Pass/Fail | Notes |
|---|---|---|
| 1. Function deployment | ☐ | |
| 2. OPTIONS preflight | ☐ | |
| 3. Method check (GET) | ☐ | |
| 4. Valid WP IPN | ☐ | |
| 5. Duplicate detection | ☐ | |
| 6. Invalid signature | ☐ | |
| 7. Missing required field | ☐ | |
| 8. Unknown provider | ☐ | |
| 9. Wrong Content-Type | ☐ | |
| 10. Provider disabled | ☐ | |
| 11. Provider missing | ☐ | |
| 12. IP allowlist | ☐ | |
| 13. Rate limiting | ☐ | |
| 14. Raw payload integrity | ☐ | |
| 15. Log output | ☐ | |
| 16. No secret leak | ☐ | |
| 17. Worker stub | ☐ | |
| 18. Concurrent race | ☐ | |
| 19. Standardized mapping | ☐ | |
| 20. Build + lint | ☐ | |
| 21. Regression | ☐ | |

---

## Sign-Off

Milestone 3 is complete when:

- [ ] All tests above pass
- [ ] Edge function logs reviewed; no PII or secret material observed in 24 hours of staging traffic
- [ ] At least one real WP staging traffic observation logged (see rollout runbook §3)
- [ ] Engineering Lead approval
- [ ] Security review (signature verification, secret leak, IP allowlist)
- [ ] Product Manager approval

**After all sign-offs, Milestone 3 is APPROVED and Milestone 4 (async worker) can begin.**
