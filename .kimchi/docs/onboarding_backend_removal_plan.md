# Backend Cleanup Plan — Remove Onboarding Infrastructure

> Scope: Supabase backend only. Do not touch dashboard UI or frontend components except generated types.

---

## Goal

Permanently remove all onboarding-related backend objects and ensure account creation still works.

---

## Constraints

- Do NOT modify `src/pages/DashboardLayout.tsx`, `src/components/OnboardingPopup.tsx` (already removed), or any other frontend component.
- Do NOT edit existing migration files (`01`, `03`, `09`, `34`, `39`, `45`). They are schema history.
- Do NOT drop or alter anything unrelated to onboarding.

---

## Objects to remove

1. `public.onboarding_states` table
2. RLS policies on `public.onboarding_states`:
   - `"Users can view own onboarding state"`
   - `"Users can manage own onboarding state"`
   - `"Admins can manage onboarding state"`
3. Trigger `trg_onboarding_states_updated_at` on `public.onboarding_states`
4. Column `public.profiles.onboarding_completed`

## Function to update

- `public.initialize_user_account(p_referred_by text default null)` — remove the `insert into public.onboarding_states(...)` statement; keep all other logic (profile upsert, affiliate profile, referral attribution, subscription insert).
- `public.initialize_user_account()` (no-arg overload) — keep as wrapper to the parameterized version.

---

## Migration file

**Path:** `supabase/migrations/49_remove_onboarding_infrastructure.sql`

### Order of operations

1. Recreate `initialize_user_account(p_referred_by text default null)` without the onboarding insert.
2. Recreate `initialize_user_account()` no-arg overload.
3. Drop RLS policies on `public.onboarding_states`.
4. Drop trigger `trg_onboarding_states_updated_at` on `public.onboarding_states`.
5. Drop table `public.onboarding_states`.
6. Drop column `onboarding_completed` from `public.profiles`.

Order matters because the current function body references `onboarding_states`. We replace the function first, then drop the table.

### Function body source

Copy the current definition from the latest migration that re-creates it (`supabase/migrations/39_fix_affiliate_conversions_schema.sql:60-185`), then delete only these lines:

```sql
  -- Ensure onboarding state exists
  insert into public.onboarding_states (user_id, step_key, completed)
  values (v_user_id, 'account_created', false)
  on conflict (user_id) do nothing;
```

Preserve grants and the no-arg overload.

---

## Generated types

- Attempt to regenerate `src/integrations/supabase/types.ts` using:
  ```bash
  npx supabase gen types typescript --project-id iitfxyasjizlbneevwsa --schema public > src/integrations/supabase/types.ts
  ```
- This requires a Supabase access token. If unavailable (e.g. Docker not running, no access token), note the limitation.
- As a safety check, confirm `src/integrations/supabase/types.ts` contains no `onboarding_states` or `onboarding_completed` references; if it does, remove them.

---

## Verification

1. `grep -Rin "onboarding_states\|onboarding_completed\|OnboardingPopup\|robinos_onboarding\|showOnboarding" src/ supabase/migrations/49_remove_onboarding_infrastructure.sql` — should only match historical migrations and unrelated marketing copy.
2. `npx tsc --noEmit` — must pass.
3. If a running Supabase instance is available:
   - `npx supabase migration up --local`
   - Smoke test: new signup via `initialize_user_account` RPC returns `ok: true`.
   - Smoke test: existing user can log in and access dashboard.

---

## Expected final state

- No `public.onboarding_states` table.
- No `onboarding_completed` column on `public.profiles`.
- `initialize_user_account()` no longer inserts into onboarding tables.
- Frontend references already removed; only historical migration references remain.
