# Endorsely Conversion Tracking — Implementation Plan

## Overview
Add secure server-side conversion tracking for Endorsely affiliate platform. The API key is stored in Supabase secrets and never exposed to the frontend.

## Architecture

```
Frontend (React)          Supabase Edge Function          Endorsely API
     |                            |                              |
     |  supabase.functions.invoke |                              |
     |  track-endorsely-conversion|                              |
     | -------------------------->|                              |
     |  { referralId, email,      |  POST /api/public/refer      |
     |    amount, name,           |  Authorization: Bearer <key> |
     |    customerId, status }    | ---------------------------->|
     |                            |                              |
     |  { success, data }         |  { success, data }           |
     | <--------------------------| <----------------------------|
```

## Chunks

### Chunk 1: Supabase Edge Function — `track-endorsely-conversion`
**File:** `supabase/functions/track-endorsely-conversion/index.ts`

- Reads `ENDORSELY_API_KEY` from `Deno.env.get()` (Supabase secret)
- Reads `ENDORSELY_ORGANIZATION_ID` from `Deno.env.get()` (defaults to `b9d35abf-aadb-4aee-86fe-c1ff3e3c3f35`)
- Authenticates request via `supabase.auth.getUser(token)`
- Accepts payload: `{ referralId, email?, amount?, name?, customerId?, status? }`
- Calls `POST https://app.endorsely.com/api/public/refer`
- Returns Endorsely response directly or wraps errors

### Chunk 2: Frontend Service — `endorsely.ts`
**File:** `src/services/endorsely.ts`

- `trackEndorselyConversion(params)` — calls Edge Function via `supabase.functions.invoke()`
- Never exposes API key
- Reuses existing `supabase` client from `src/integrations/supabase/client.ts`

### Chunk 3: Config + Secret Setup
**File:** `supabase/config.toml`

- Add `[functions.track-endorsely-conversion]` entry
- `verify_jwt = false` — this function handles JWT verification internally (same pattern as other functions)

**Secret setup (manual / CLI):**
```bash
supabase secrets set --project-ref iitfxyasjizlbneevwsa ENDORSELY_API_KEY=<your_api_key>
```

## API Key Storage
- **Name:** `ENDORSELY_API_KEY`
- **Access:** `Deno.env.get("ENDORSELY_API_KEY")` inside Edge Function only
- **Never** in frontend code, `.env`, or git

## Acceptance Criteria
- [ ] Edge Function exists and matches codebase patterns (CORS, auth, error handling)
- [ ] Frontend service calls Edge Function, never touches API key
- [ ] `config.toml` updated with function entry
- [ ] Secret setup command documented
