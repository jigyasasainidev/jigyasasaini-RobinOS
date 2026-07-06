# Edge Function Deployment Report

## Scope
Deploy the three existing Edge Functions that are currently **not deployed** to the RobinOS Supabase production project:

- `payment-webhook`
- `process-webhook-worker`
- `admin-payment-providers`

**No code changes are required.** This report provides the exact commands, secrets, verification steps, migration prerequisites, and expected URLs.

## Project reference
- **Project ID:** `iitfxyasjizlbneevwsa`
- **Production URL base:** `https://iitfxyasjizlbneevwsa.supabase.co`
- **Edge Function base path:** `/functions/v1/`

## Prerequisite: database migrations

**Yes — migrations MUST be applied before deployment.**

All three functions rely on database objects introduced in migrations 51–60:

| Function | Required DB objects |
|---|---|
| `payment-webhook` | `public.payment_providers`, `public.payment_provider_secrets`, `public.webhook_events`, `enqueue_webhook_event` RPC |
| `process-webhook-worker` | `public.webhook_events`, `process_webhook_event` RPC, `get_webhook_queue_stats` RPC |
| `admin-payment-providers` | `public.payment_providers`, `public.provider_products`, M55 admin RPCs (`admin_get_payment_provider_summary`, `admin_list_providers`, etc.) |

**Recommended order:**
1. Apply migrations 59 and 60 (reconciliation migrations) if not already applied.
2. Verify RPCs exist with `\df public.process_webhook_event`, `\df public.enqueue_webhook_event`, etc.
3. Deploy the Edge Functions.
4. Run post-deployment verification.

## Required environment secrets

These secrets must be set as **Edge Function Secrets** in the Supabase project (not in `.env` files, which are not bundled).

| Secret | Required by | Purpose | How to obtain |
|---|---|---|---|
| `SUPABASE_URL` | All three | Supabase project URL | Project Settings → API → URL, or `https://iitfxyasjizlbneevwsa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | All three | Service role client inside functions | Project Settings → API → service_role key (⚠️ never expose in client) |
| `SUPABASE_ANON_KEY` | `admin-payment-providers` only | User-scoped client for `get_admin_access` RPC | Project Settings → API → anon/public key |
| `PAYMENT_PROVIDER_ENCRYPTION_KEY` | `payment-webhook`, `admin-payment-providers` | AES-256-GCM key for `payment_provider_secrets` | Generate a fresh 32-byte base64 key (see below) |

### Generating `PAYMENT_PROVIDER_ENCRYPTION_KEY`
Run locally:

```bash
openssl rand -base64 32
```

Example output:
```
AbCdEf1234567890...==
```

This value must be stored once and backed up securely. Loss of this key means all stored provider secrets become undecryptable.

## Deployment commands

### 1. Deploy all three functions at once

```bash
cd /Users/ashadali/Documents/RobinOS-main
supabase functions deploy payment-webhook process-webhook-worker admin-payment-providers \
  --project-ref iitfxyasjizlbneevwsa
```

### 2. Deploy individually (alternative)

```bash
supabase functions deploy payment-webhook --project-ref iitfxyasjizlbneevwsa
supabase functions deploy process-webhook-worker --project-ref iitfxyasjizlbneevwsa
supabase functions deploy admin-payment-providers --project-ref iitfxyasjizlbneevwsa
```

### 3. Set Edge Function Secrets

Option A — set all at once from an env file:

```bash
# Create a temporary env file (do NOT commit this file)
cat > /tmp/robinos-prod-secrets.env <<'EOF'
SUPABASE_URL=https://iitfxyasjizlbneevwsa.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<production-service-role-key>
SUPABASE_ANON_KEY=<production-anon-key>
PAYMENT_PROVIDER_ENCRYPTION_KEY=<base64-32-byte-key>
EOF

supabase secrets set --project-ref iitfxyasjizlbneevwsa --env-file /tmp/robinos-prod-secrets.env
rm /tmp/robinos-prod-secrets.env
```

Option B — set individually:

```bash
supabase secrets set --project-ref iitfxyasjizlbneevwsa SUPABASE_URL="https://iitfxyasjizlbneevwsa.supabase.co"
supabase secrets set --project-ref iitfxyasjizlbneevwsa SUPABASE_SERVICE_ROLE_KEY="<production-service-role-key>"
supabase secrets set --project-ref iitfxyasjizlbneevwsa SUPABASE_ANON_KEY="<production-anon-key>"
supabase secrets set --project-ref iitfxyasjizlbneevwsa PAYMENT_PROVIDER_ENCRYPTION_KEY="<base64-32-byte-key>"
```

## Expected function URLs

| Function | URL |
|---|---|
| `payment-webhook` | `https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/payment-webhook/{provider_id}` |
| `process-webhook-worker` | `https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=process` |
| `admin-payment-providers` | `https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/admin-payment-providers` |

## Post-deployment verification

### 1. Confirm functions are deployed

```bash
supabase functions list --project-ref iitfxyasjizlbneevwsa
```

Expected output should include:

```
payment-webhook
process-webhook-worker
admin-payment-providers
```

### 2. Confirm secrets are set

```bash
supabase secrets list --project-ref iitfxyasjizlbneevwsa
```

Expected:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
PAYMENT_PROVIDER_ENCRYPTION_KEY
```

### 3. Test `process-webhook-worker` health endpoint

```bash
curl -X POST \
  "https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=health" \
  -H "Content-Type: application/json"
```

Expected: `200 OK` with JSON queue stats (`queue_depth`, `received_count`, etc.).

### 4. Test `admin-payment-providers` summary endpoint

```bash
curl -X POST \
  "https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/admin-payment-providers" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"action":"summary"}'
```

Expected: `200 OK` with `{ "success": true, "summary": {...} }`.

### 5. Test `payment-webhook` with an invalid provider

```bash
curl -X POST \
  "https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/payment-webhook/unknown-provider" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `404 Not Found` with `{ "received": false, "code": "PROVIDER_NOT_FOUND" }`.

This confirms the function deployed and can connect to `payment_providers`.

### 6. Verify `payment-webhook` can decrypt secrets

After creating a provider secret in the admin UI or DB, send a test webhook with a valid signature. Expected: `200 OK` and a new row in `webhook_events`.

### 7. Verify `process-webhook-worker` processes rows

Insert or retry a `received` row in `webhook_events`, then invoke:

```bash
curl -X POST \
  "https://iitfxyasjizlbneevwsa.supabase.co/functions/v1/process-webhook-worker?action=process&batch_size=1" \
  -H "Content-Type: application/json"
```

Expected: `200 OK` with `processed_count >= 0` and no `rpc_failure`.

## Security notes
- `payment-webhook` and `process-webhook-worker` run with `verify_jwt = false` (already configured in `supabase/config.toml`).
- `admin-payment-providers` validates the admin JWT inside the function via `get_admin_access` RPC.
- `PAYMENT_PROVIDER_ENCRYPTION_KEY` is used only at runtime to encrypt/decrypt provider secrets; it is never logged.

## Rollback (if needed)

Undeploy a single function:

```bash
supabase functions delete payment-webhook --project-ref iitfxyasjizlbneevwsa
```

Undeploy all three:

```bash
supabase functions delete payment-webhook --project-ref iitfxyasjizlbneevwsa
supabase functions delete process-webhook-worker --project-ref iitfxyasjizlbneevwsa
supabase functions delete admin-payment-providers --project-ref iitfxyasjizlbneevwsa
```

## Approval required

Do not proceed with deployment until explicit approval is given. No deployment commands have been executed.
