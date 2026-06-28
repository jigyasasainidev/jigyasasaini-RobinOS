# Whop Webhook Phase 1 — Skeleton Edge Function

## Scope
Create isolated `whop-webhook` edge function. No DB writes, no RPC calls, no Dodo changes.

## Files

### 1. `supabase/functions/whop-webhook/index.ts`
- POST only (OPTIONS returns CORS)
- Import `CORS_HEADERS` from `../_shared/entitlement.ts`
- `Deno.serve()` pattern matching existing edge functions
- Parse JSON body safely
- Extract fields: `id`, `event`, `data.membership_id`, `data.product_id`, `data.customer.email`
- Route by `event` string to placeholder handlers:
  - `membership_activated` → `handleMembershipActivated(data)`
  - `membership_cancelled` → `handleMembershipCancelled(data)`
  - `membership_deactivated` → `handleMembershipDeactivated(data)`
- Each handler: validate payload shape, `console.log` event info, return success JSON
- Return 200 `{received: true, event: type}` for valid requests
- Return 405 for non-POST, 400 for invalid JSON, 500 for unexpected errors
- Log all received payload data safely

### 2. `supabase/config.toml`
- Append `[functions.whop-webhook]\nverify_jwt = false` under existing dodo-webhook entry

## Constraints
- No Supabase client creation
- No DB writes
- No RPC calls
- No affiliate logic
- No Dodo references
- No frontend changes
- No migrations
