# RobinOS Codebase Exploration Summary

## 1. Overall Architecture

**Framework**: React 18 + TypeScript + Vite (not Next.js)
- `vite.config.ts` shows Vite with React SWC plugin
- `package.json` has `"type": "module"` with Vite build scripts
- Client-side routing via `react-router-dom` v6
- State management: TanStack React Query v5 + React Context (AuthContext)
- UI: Radix UI primitives + Tailwind CSS + shadcn patterns
- No server-side rendering — purely SPA deployed to Vercel (`vercel.json` present)

**Project structure**:
```
/supabase           # Supabase Edge Functions + migrations
/src                # React frontend
  /components       # UI components
  /hooks            # Custom hooks (useEntitlements, useSubscriptionLifecycle, etc.)
  /services         # Business logic services (affiliate, trendRadarClient, ideaStream)
  /integrations/supabase  # Auto-generated Supabase client + types
  /contexts         # React contexts (AuthContext)
  /lib              # Utilities (realtime, pricing, etc.)
  /pages            # Route pages
/api                # Vercel serverless functions (separate from Supabase Edge Functions)
  /_lib             # Shared API utilities (engine, pipeline, sources, auth)
  /public/trends    # Public trend API endpoints
/trend-engine       # Standalone Bun service (separate deployment - Railway)
```

---

## 2. Supabase Usage

### Client (Frontend)
- **File**: `src/integrations/supabase/client.ts`
- Uses `@supabase/supabase-js` v2
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Auth config: localStorage persistence, auto-refresh tokens

### Edge Functions (Server-side)
Located in `/supabase/functions/` — **27 functions** total:

| Function | Purpose | Auth |
|----------|---------|------|
| `create-checkout` | Dodo Payments checkout session | User JWT |
| `dodo-webhook` | Dodo Payments webhook handler (HMAC verified) | Service role |
| `create-whop-checkout` | Whop checkout session | User JWT |
| `whop-webhook` | Whop membership webhook | Service role |
| `cancel-subscription` | Cancel subscription | User JWT |
| `customer-portal` | Billing portal | User JWT |
| `generate-script` | AI script generation | User JWT |
| `generate-caption` | AI caption generation | User JWT |
| `generate-video` | AI video generation | User JWT |
| `elevenlabs-tts` | Text-to-speech | User JWT |
| `poll-video` | Poll video generation status | User JWT |
| `scan-trends` / `collect-trends` | Trend collection | Internal |
| `trending-audio` | Get trending audio | User JWT |
| `safety-intake` | Safety reporting | User JWT |
| `submit-abuse-report` | Abuse reporting | User JWT |
| `record-referral` | Record referral | User JWT |
| `check-signup` | Check signup status | User JWT |
| `admin-create-user` | Admin user creation | Service role |
| `check-admin-2fa-status` / `generate-admin-2fa` / `verify-admin-2fa` / `disable-admin-2fa` | Admin 2FA | Service role |
| `simplify-script` | Script simplification | User JWT |

### Shared Edge Function Utilities (`/supabase/functions/_shared/`)
- **entitlement.ts** — Centralized entitlement layer (feature checks, usage increments, CORS, error responses)
- **affiliate.ts** — Shared affiliate commission recording (used by both dodo-webhook & whop-webhook)
- **feature-usage.ts** — Feature usage tracking
- **gemini.ts** — Gemini AI integration
- **trend-engine-client.ts** — Client for standalone trend-engine service

### Database
- **35+ migrations** in `/supabase/migrations/`
- Key tables: `user_subscriptions`, `affiliate_profiles`, `affiliate_commissions`, `affiliate_conversions`, `withdrawal_requests`, `payout_history`, `platform_settings`, `profiles`, `feature_usage`, `trend_audios`, `trend_hashtags`
- Extensive RPC functions for entitlement checks (`check_and_increment_usage`, `get_user_entitlements`, `safe_plan_switch`, `get_affiliate_dashboard`, etc.)

---

## 3. Edge Function Patterns

### Standard structure (from `create-checkout`):
```typescript
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  
  // 1. Auth verification via service client + user JWT
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  
  // 2. Parse body, validate
  // 3. Business logic (often calling RPC functions)
  // 4. Return JSON response with CORS headers
});
```

### Key patterns:
- **CORS_HEADERS** from shared entitlement module
- **Service role client** for DB operations (bypasses RLS)
- **User JWT verification** via `supabase.auth.getUser(token)`
- **Environment variables** via `Deno.env.get("SECRET_NAME")` — all secrets in Supabase Dashboard
- **Idempotency** via `subscription_webhook_events` table with payload hashing
- **Webhook signature verification** using `standardwebhooks` (Dodo) or planned HMAC (Whop)

### Webhook-specific (`dodo-webhook`, `whop-webhook`):
- `verify_jwt = false` in `config.toml`
- Raw body read for signature verification
- Idempotency via `record_webhook_event` RPC
- Event routing via switch on `payload.type`
- Commission attribution via shared `recordAffiliateCommission()`

---

## 4. Environment Variables / Secrets Management

### Frontend (Vite)
- **Prefix**: `VITE_` required for client exposure
- Defined in: `.env` (local, not committed), Vercel project settings
- Used in: `src/integrations/supabase/client.ts` → `import.meta.env.VITE_SUPABASE_URL`

### Supabase Edge Functions
- **No prefix** — raw secret names
- Set in: Supabase Dashboard → Edge Functions → Secrets
- Accessed via: `Deno.env.get("SECRET_NAME")`
- Key secrets:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (auto-injected)
  - `DODO_SECRET_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_ENVIRONMENT`, `DODO_PRODUCT_CREATOR_MONTHLY`, etc.
  - `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PLAN_CREATOR`, etc.
  - `APP_URL` (frontend URL for redirects)
  - `IDEA_STREAM_API_KEY` (for trend-engine service auth)

### Trend Engine (Standalone Bun Service)
- Separate deployment (Railway)
- Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IDEA_STREAM_API_KEY` (or legacy `TREND_ENGINE_INTERNAL_API_KEY`), `PORT`

### No `.env` files found in repo — all secrets managed via platform dashboards.

---

## 5. Conversion Tracking & Third-Party Integration Patterns

### Payment Providers
1. **Dodo Payments** (primary)
   - Checkout: `create-checkout` edge function → Dodo Checkout Sessions API
   - Webhook: `dodo-webhook` handles `subscription.active`, `subscription.renewed`, `subscription.cancelled`, `payment.succeeded`, `payment.failed`, `payment.refunded`
   - Product IDs stored as Supabase secrets (not hardcoded)

2. **Whop** (secondary)
   - Checkout: `create-whop-checkout` → Whop Checkout Configurations API
   - Webhook: `whop-webhook` handles `membership.activated`, `membership.cancelled/deactivated`
   - Plan IDs stored as Supabase secrets

### Affiliate/Referral System
- **First-touch attribution** — captured at signup via `initialize_user_account(p_referred_by)`
- **Persistence layers** (client-side, in `referralCoordinator.ts`):
  1. URL param `?ref=`
  2. `sessionStorage` (`robinos_referral_code`)
  3. `localStorage` backup (`robinos_referral_backup`)
  4. Signed cookie (`rbn_ref` — HMAC-signed)
- **Commission recording** (server-side, in webhooks):
  - Triggered on `payment.succeeded` (Dodo) or `membership.activated` (Whop)
  - Reads live commission rate from `platform_settings.affiliate_commission_percent`
  - 14-day cooldown before withdrawable (`eligible_at`)
  - Idempotent via unique constraint on `dodo_subscription_id` / `whop_membership_id`
- **Conversion tracking**:
  - `affiliate_conversions` table tracks signup + paid conversions
  - Unique constraint: `(affiliate_user_id, referred_user_id, plan_code)`
  - Status: `pending` → `approved` → `paid` / `reversed` / `cancelled`

### Trend Engine (External Service)
- **Standalone Bun service** (`/trend-engine`) — deployed separately (Railway)
- **HTTP API contract**:
  - `GET /health` — public
  - `GET /trends?platform=X&type=Y` — key-protected
  - `POST /refresh` — key-protected (triggers cache refresh)
  - `GET /metrics` — key-protected
- **Auth**: `x-idea-stream-key` header (timing-safe comparison)
- **Data sources**: Apple Music RSS, Deezer API, Google Trends RSS
- **Caching**: 6-hour TTL in Supabase (`trend_audios`, `trend_hashtags`)
- **Frontend access**: Via `supabase/functions/trend-engine-client.ts` (edge function proxy)

---

## 6. API Routes / Edge Functions File Structure

```
/supabase/functions/
├── _shared/
│   ├── entitlement.ts        # Core entitlement utilities (REQUIRED import)
│   ├── affiliate.ts          # Shared commission recording
│   ├── feature-usage.ts      # Usage tracking
│   ├── gemini.ts             # AI integration
│   └── trend-engine-client.ts# Trend engine service client
├── create-checkout/
│   └── index.ts              # Dodo checkout
├── dodo-webhook/
│   └── index.ts              # Dodo webhook handler
├── create-whop-checkout/
│   └── index.ts              # Whop checkout
├── whop-webhook/
│   └── index.ts              # Whop webhook handler
├── ... (23 more functions)
```

```
/api/ (Vercel serverless)
├── _lib/
│   ├── auth.ts               # Auth helpers
│   ├── engine.ts             # Core engine logic
│   ├── pipeline.ts           # Processing pipeline
│   ├── sources.ts            # Data sources
│   ├── fetch.ts              # Hardened fetch with retry
│   └── schema.ts             # Type definitions
└── public/trends/            # Public trend endpoints
```

---

## Key Architectural Decisions

1. **Entitlement enforcement is server-side only** — frontend `useEntitlements` hook is display-only; edge functions call `check_and_increment_usage` RPC for atomic validation + increment

2. **Two payment providers** — Dodo (primary) + Whop (secondary), both with identical webhook patterns and shared commission logic

3. **Standalone trend engine** — separate service with stable HTTP contract; RobinOS never calls trend sources directly

4. **First-touch referral attribution** — deterministic, multi-layer persistence (URL → sessionStorage → localStorage → cookie) with 7-day expiry

5. **Payout ledger with atomic reservations** — `pending_balance` deducted on withdrawal submit, restored on reject, `paid_balance` incremented on paid

6. **Realtime entitlement propagation** — profile/subscription changes invalidate React Query cache via Supabase Realtime