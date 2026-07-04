# Milestone 3 — Staging Verification & Production Rollout Runbook

**Status:** Implementation complete. Operator-facing guide.
**Companion to:** `.kimchi/docs/milestone-3-webhook-receiver-design.md`, `.kimchi/docs/milestone-3-verification-and-readiness.md`, `.kimchi/docs/milestone-3-testing-checklist.md`.

This runbook covers the deploy-time gates and staging-to-production promotion of the M3 webhook receiver. The implementation is code-complete; the runbook is the bridge to a running, tested receiver.

---

## 1. Pre-Deployment Checklist

Before deploying M3, confirm all of the following:

- [ ] Migrations 51–55 are applied to staging and production databases.
- [ ] `payment_providers` row for `warriorplus` exists (M51 seed).
- [ ] `webhook_events` table is empty (or contains only legacy rows).
- [ ] `enqueue_webhook_event` RPC exists and is `SECURITY DEFINER` with `service_role` grant only.
- [ ] Admin role exists (super_admin / admin) for the operator running the deploy.
- [ ] Local Deno CLI is installed: `deno --version` ≥ 1.40.
- [ ] Local Supabase CLI is installed and logged in: `supabase --version` ≥ 1.180.
- [ ] Local `psql` or Supabase Studio access is available for SQL verification.

If any of the above is incomplete, **stop and resolve before proceeding**.

---

## 2. Provisioning the Encryption Key

M3 requires a project-level AES-256-GCM key, stored as a Supabase Edge Function Secret.

### 2.1 Generate

```bash
openssl rand -base64 32
# Example output: 8b2p1xV4rY... (44 chars including padding)
```

### 2.2 Set in Supabase

```bash
# Staging
supabase secrets set PAYMENT_PROVIDER_ENCRYPTION_KEY="<the-44-char-base64>" \
  --project-ref <staging-ref>

# Production (separate key)
supabase secrets set PAYMENT_PROVIDER_ENCRYPTION_KEY="<different-44-char-base64>" \
  --project-ref <prod-ref>
```

**Do NOT reuse the staging key in production.** If the staging key leaks, blast radius is one environment.

### 2.3 Verify

```bash
supabase secrets list --project-ref <staging-ref> | grep PAYMENT_PROVIDER_ENCRYPTION_KEY
```

- [ ] The secret is listed.

---

## 3. Seeding the WarriorPlus Shared Secret

The `WP_SECURITYKEY` from the WP vendor dashboard is stored encrypted in `payment_provider_secrets`. Until M2's secret-rotation UI ships (deferred), use the Deno helper below.

### 3.1 Get the secret from WarriorPlus

1. Log in to the WP vendor dashboard.
2. Navigate to **Account → Security**.
3. Copy the security key string. (For staging, use the WP sandbox vendor account.)

### 3.2 Encrypt and insert

Create a one-off Deno script:

```bash
mkdir -p /tmp/seed-secret
cat > /tmp/seed-secret/main.ts <<'EOF'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encryptSecret } from "/Users/ashadali/Documents/RobinOS-main/supabase/functions/_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED       = Deno.env.get("WP_SHARED_SECRET")!;
const PROVIDER_ID  = "warriorplus";
const SECRET_NAME  = "ipn_security_key";

if (!SHARED) { console.error("WP_SHARED_SECRET env var required"); Deno.exit(1); }

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
  description: `Seeded via runbook on ${new Date().toISOString()}`,
});
if (error) { console.error("Insert failed:", error); Deno.exit(1); }
console.log("Secret seeded successfully.");
EOF
```

Run it:

```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>" \
WP_SHARED_SECRET="<the-actual-wp-key>" \
deno run --allow-env --allow-net=/Users/ashadali/Documents/RobinOS-main \
  /tmp/seed-secret/main.ts
```

### 3.3 Verify in DB

```sql
SELECT id, provider_id, secret_name, is_active, created_at
FROM public.payment_provider_secrets
WHERE provider_id = 'warriorplus'
  AND secret_name = 'ipn_security_key';
```

- [ ] Exactly one row with `is_active = true`
- [ ] `secret_value_encrypted` is a base64 string ~50–200 chars (depends on plaintext length)
- [ ] No `secret_value_encrypted` value appears in any logs (run a tail of the Deno output to confirm)

### 3.4 Clean up

```bash
rm -rf /tmp/seed-secret
unset WP_SHARED_SECRET
unset SUPABASE_SERVICE_ROLE_KEY
```

Never leave these env vars in shell history. Use `unset` or a one-off `env -i` invocation if needed.

---

## 4. Deploy the Edge Functions

### 4.1 Deploy the receiver

```bash
cd /Users/ashadali/Documents/RobinOS-main
supabase functions deploy payment-webhook --project-ref <staging-ref>
```

Expected output:
```
Deploying function payment-webhook...
Function payment-webhook deployed successfully.
URL: https://<staging-ref>.supabase.co/functions/v1/payment-webhook
```

### 4.2 Deploy the worker stub

```bash
supabase functions deploy process-webhook-worker --project-ref <staging-ref>
```

### 4.3 Verify the deployment

```bash
# OPTIONS preflight
curl -i -X OPTIONS \
  'https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus'

# Worker stub
curl -i -X POST \
  'https://<staging-ref>.supabase.co/functions/v1/process-webhook-worker'
```

- [ ] OPTIONS returns 204 with CORS headers.
- [ ] Worker stub returns 200 with `"implemented": false`.

---

## 5. Enable the WarriorPlus Provider

The M51 seed sets `is_enabled = false`. Enable via M2 admin UI:

1. Sign in to `https://<staging-host>/adminsh/payment-providers`.
2. Find the WarriorPlus card.
3. Toggle the enable switch.
4. Verify the status badge changes to "Enabled".

OR via SQL:

```sql
UPDATE public.payment_providers
SET is_enabled = true, updated_at = now()
WHERE id = 'warriorplus';

SELECT id, is_enabled FROM public.payment_providers WHERE id = 'warriorplus';
-- Expected: warriorplus | true
```

---

## 6. Run the Local Simulation Script

```bash
cd /Users/ashadali/Documents/RobinOS-main
SUPABASE_URL="https://<staging-ref>.supabase.co" \
WP_SHARED_SECRET="<the-actual-wp-key>" \
node scripts/test-webhook-warriorplus.cjs valid
```

**Expected:**
- HTTP 200
- Body: `{ received: true, id: "<uuid>" }`

**Verify the row in `webhook_events`:**

```sql
SELECT id, provider_id, provider_event_id, provider_event_type,
       standardized_event_type, status, payload_hash
FROM public.webhook_events
ORDER BY received_at DESC LIMIT 1;
```

- [ ] `provider_id = 'warriorplus'`
- [ ] `standardized_event_type = 'purchase.created'`
- [ ] `status = 'received'`
- [ ] `payload_hash` is 64 hex chars

**Run the rest of the simulation modes:**

```bash
for mode in duplicate invalid-sig missing-required unknown-provider \
             wrong-content-type method-not-allowed options-preflight; do
  echo "=== $mode ==="
  SUPABASE_URL="..." WP_SHARED_SECRET="..." \
    node scripts/test-webhook-warriorplus.cjs $mode
done
```

All should pass with the assertions in the script.

---

## 7. Real WarriorPlus Staging Test

This step requires a real WP sandbox vendor account.

### 7.1 Configure the IPN URL in WP

In the WP vendor dashboard, set the notification URL for your test product to:

```
https://<staging-ref>.supabase.co/functions/v1/payment-webhook/warriorplus
```

WP saves and tests the URL on save. You should see a "verified" indicator.

### 7.2 Trigger a real test IPN

Option A — manual test purchase:
1. Place a sandbox test purchase for $1 against your test product.
2. Watch Supabase Edge Function logs in real time.
3. Verify a row appears in `webhook_events` with `status = 'received'`.

Option B — use WP's "Resend IPN" feature (if available):
1. Find a recent IPN in the WP transaction log.
2. Click "Resend".
3. Confirm the second delivery is detected as `duplicate: true`.

### 7.3 Confirm the design assumptions

The verification doc lists three staging gates that resolve real-WP-only:

**Assumption 1 — WP retry semantics:**
- Deliberately return a 5xx (temporarily disable the provider via the admin UI, then re-enable).
- Observe whether WP retries, on what cadence, and for how long.
- Document the observed behaviour in `.kimchi/docs/milestone-3-verification-and-readiness.md` (replace the "C3" line with the actuals).
- If WP retries indefinitely on 4xx, plan a post-deploy fix to the §7 response mapping.

**Assumption 2 — `WP_SECURITYKEY` format:**
- Inspect a captured IPN body. Note the length and shape of `WP_SECURITYKEY`.
- If 64 hex chars: WP sends a SHA-256 hash. The fallback path in the adapter handles this automatically.
- If the raw secret length: WP sends the secret directly. Primary path handles this.
- If something else: document and update the adapter.

**Assumption 11 — Content-Type:**
- Inspect a captured IPN's `Content-Type` header.
- If it's `application/x-www-form-urlencoded` (with or without charset): no action needed.
- If it's `application/x-www-form-urlencoded; charset=utf-8`: no action needed (we accept the prefix).
- If it's `multipart/form-data`: open a follow-up task; WP is deviating from documented behaviour.

### 7.4 Inspect raw payload

```sql
SELECT raw_payload
FROM public.webhook_events
WHERE provider_id = 'warriorplus'
ORDER BY received_at DESC LIMIT 1;
```

- [ ] Every `WP_*` field sent by WP is present in `raw_payload`
- [ ] Field names match WP's documentation exactly (case-sensitive)

### 7.5 Inspect logs

In the Supabase Dashboard → Edge Functions → payment-webhook → Logs:

- [ ] `REQUEST_RECEIVED`, `PROVIDER_RESOLVED`, `SIGNATURE_VERIFIED`, `ENQUEUED` events all fire
- [ ] No log line contains buyer email, raw IPN_ID, decrypted secret, or provided `WP_SECURITYKEY` value
- [ ] `trace_id` is consistent across all log lines for one request

---

## 8. Production Rollout

Production promotion is a copy of staging with the production values.

### 8.1 Pre-production gates

- [ ] All staging tests (1–21 in the testing checklist) pass.
- [ ] At least 24 hours of staging traffic observed without PII or secret leak.
- [ ] Real WP staging test (§7 above) confirms the design assumptions.
- [ ] Operator runbook reviewed by on-call team.
- [ ] Engineering Lead approval.
- [ ] Security review (signature verification, secret leak, IP allowlist).

### 8.2 Promote to production

```bash
# 1. Generate production encryption key (different from staging)
PROD_KEY=$(openssl rand -base64 32)

# 2. Set the secret
supabase secrets set PAYMENT_PROVIDER_ENCRYPTION_KEY="$PROD_KEY" \
  --project-ref <prod-ref>

# 3. Store the production key securely (1Password, vault, etc.)
echo "$PROD_KEY" | pbcopy  # then paste into 1Password; clear clipboard after

# 4. Deploy the functions
supabase functions deploy payment-webhook --project-ref <prod-ref>
supabase functions deploy process-webhook-worker --project-ref <prod-ref>

# 5. Seed the production WP secret via the same Deno helper (§3.2)
SUPABASE_URL="https://<prod-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<prod-service-role-key>" \
WP_SHARED_SECRET="<prod-wp-key>" \
deno run --allow-env --allow-net=/Users/ashadali/Documents/RobinOS-main \
  /tmp/seed-secret/main.ts

# 6. Enable the provider via admin UI

# 7. Update the IPN URL in WP production vendor dashboard to:
#    https://<prod-ref>.supabase.co/functions/v1/payment-webhook/warriorplus
```

### 8.3 Smoke-test production

```bash
SUPABASE_URL="https://<prod-ref>.supabase.co" \
WP_SHARED_SECRET="<prod-wp-key>" \
node scripts/test-webhook-warriorplus.cjs valid
```

- [ ] HTTP 200
- [ ] DB row appears in production `webhook_events`

### 8.4 Monitor for 1 hour

- [ ] Watch for unexpected 4xx / 5xx in Edge Function logs
- [ ] Verify no PII / secret material in any log line
- [ ] Confirm a real WP test purchase enqueues a row

---

## 9. Rollback Procedures

### 9.1 Quick rollback: disable the provider

If something is wrong but the function is technically working:

```sql
UPDATE public.payment_providers
SET is_enabled = false
WHERE id = 'warriorplus';
```

WP will receive 503 and start retrying per its own policy. Once the issue is fixed, re-enable.

### 9.2 Full rollback: remove the endpoint from WP

If the function itself is broken or compromised:

1. In the WP vendor dashboard, remove the IPN URL.
2. WP stops sending events.
3. Existing rows in `webhook_events` are untouched.
4. Investigate the function logs to diagnose.
5. Fix and redeploy.
6. Re-register the IPN URL in WP.

### 9.3 Database rollback

There is **no database migration for M3**. No rollback needed at the DB layer.

### 9.4 Secret rotation

If a secret is suspected to be compromised:

```sql
-- Mark the current secret inactive
UPDATE public.payment_provider_secrets
SET is_active = false, rotated_at = now()
WHERE provider_id = 'warriorplus'
  AND secret_name = 'ipn_security_key'
  AND is_active = true;

-- Seed a new secret using the §3.2 helper
```

- [ ] New secret inserted with `is_active = true`
- [ ] Old secret marked `is_active = false` (still in DB for audit, never read again)
- [ ] The dispatcher uses the partial unique index `idx_payment_provider_secrets_unique_active` to pick the active row

### 9.5 Encryption key rotation

If `PAYMENT_PROVIDER_ENCRYPTION_KEY` is compromised:

1. Generate a new key: `openssl rand -base64 32`.
2. Set the new secret in Supabase Edge Function Secrets.
3. Re-encrypt and re-insert ALL `payment_provider_secrets` rows:
   - For each active row: decrypt with old key (manually, via a one-off Deno script), re-encrypt with new key, update row.
4. Verify by sending a test IPN.
5. Document the rotation in the runbook change log.

The edge function will read the env var on next cold start. Until then, decryption fails → 401. Plan for ~30 seconds of failed webhooks during the rotation.

---

## 10. Open Assumptions to Monitor

Per `.kimchi/docs/milestone-3-verification-and-readiness.md`:

| Assumption | What to monitor | Where |
|---|---|---|
| WP retry semantics | Production retry count and interval | Edge function logs (5xx rate) |
| WP_SECURITYKEY format | Length of the value in raw_payload | SQL query on `raw_payload->>'WP_SECURITYKEY'` |
| WP IP ranges | Source IP distribution in raw_headers | Edge function logs |
| Currency is USD | `WP_SALE_CURRENCY` value distribution | SQL aggregation |
| Test mode effectiveness | Whether `is_test_mode` affects production traffic | Admin UI toggle test |

Add a check at the 30-day mark: review each of these and update the runbook.

---

## 11. Change Log

| Date | Change | Operator |
|---|---|---|
| YYYY-MM-DD | Initial rollout to staging | <name> |
| YYYY-MM-DD | Promoted to production | <name> |
