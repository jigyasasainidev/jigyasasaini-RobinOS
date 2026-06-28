# Phase 2A — create-whop-checkout Edge Function

## Goal
Create isolated edge function that: verifies auth → validates plan → maps to Whop product ID → calls Whop API → returns checkout URL.

## File(s)
1. `supabase/functions/create-whop-checkout/index.ts` — new edge function
2. `supabase/config.toml` — append `[functions.create-whop-checkout] verify_jwt = false`

## Template
Copy auth, body-parse, duplicate-prevention, CORS, error-response patterns from `supabase/functions/create-checkout/index.ts`.

## Whop API
Use raw `fetch()` to Whop REST API:
- Base: `https://api.whop.com/api/v1`
- Auth: `Authorization: Bearer ${WHOP_API_KEY}`
- Endpoint: `POST /checkout_configurations`
- Body: `{ plan: { initial_price, plan_type: "renewal", currency: "usd" }, metadata, return_url }`
- Response: `{ id, purchase_url, plan: { id } }`

If SDK preferred, use `import Whop from "npm:@whop/sdk";` (same npm pattern as Dodo).

## Env secrets
- `WHOP_API_KEY`
- `WHOP_ENVIRONMENT`
- `WHOP_PLAN_CREATOR`
- `WHOP_PLAN_PRO`
- `WHOP_PLAN_AGENCY`

## Metadata
```ts
metadata: {
  user_id:       user.id,
  plan_key:      planKey,
  billing_cycle: "monthly",
  source:        "robinos_web",
  ...(referralCode ? { referral_code: referralCode } : {}),
}
```

## Duplicate prevention
Exact same query as Dodo: `select plan, status, provider from user_subscriptions where user_id = ? single()` — block if same plan + active.

## Constraints
- No DB writes beyond read-only duplicate check
- No RPC calls
- No frontend changes
- No Dodo code touched
- No migration
