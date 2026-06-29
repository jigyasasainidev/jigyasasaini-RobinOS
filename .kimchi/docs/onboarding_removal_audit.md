# RobinOS Onboarding Flow — Removal Audit

> Scope: the post-login "Set up my workspace" onboarding guide / card / modal experience.
> Status: read-only audit. No code was modified.

---

## 1. Routes involved

**Finding: there is no dedicated onboarding route.** The onboarding UI is rendered as an overlay inside the dashboard layout.

- `src/App.tsx` routes use **react-router-dom** (not TanStack Router as stated in the task brief).
- Dashboard route: `<Route path="/dashboard" element={<DashboardLayout />}>`.
- `/dashboard` index redirects to `/dashboard/trend-scanner` (`App.tsx:178`).
- There is **no** `/onboarding`, `/setup`, `/welcome`, or similar route file.
- The popup is mounted inside `DashboardLayout` and therefore appears on every `/dashboard/*` path until dismissed.

---

## 2. React components involved

| File | Role |
|------|------|
| `src/components/OnboardingPopup.tsx` | The entire onboarding modal (welcome → goals → platform → style → activation). **Becomes fully unused after removal.** |
| `src/pages/DashboardLayout.tsx` | Imports `OnboardingPopup`, owns `showOnboarding` state, decides when to show it, and renders it. |
| `src/pages/AuthPage.tsx` | Button text says `"Setting up your workspace..."` while auth initializes (`AuthPage.tsx:146`). This is **cosmetic only** and unrelated to the popup logic, but uses onboarding language. |

No other components import or render `OnboardingPopup`.

---

## 3. Modal / card / dialog components

- `src/components/OnboardingPopup.tsx` — the only onboarding modal.
  - Uses `framer-motion` `AnimatePresence`/`motion.div` for backdrop + panel.
  - Fixed z-index `z-[100]` overlay with blurred backdrop.
  - 5-step wizard (welcome, goals, platform, style, activation).
  - CTA buttons: `"Set up my workspace"`, `"Activate workspace"`, `"Go to dashboard →"`.

No separate dialog, sheet, or card components are reused from the onboarding flow.

---

## 4. Onboarding context / provider

**None found.**

There is no `OnboardingContext`, `OnboardingProvider`, or equivalent. The only relevant providers are:
- `AuthProvider` (`src/contexts/AuthContext.tsx`) — only exposes session/user/loading/signOut.
- `CurrencyProvider` — unrelated.

---

## 5. Onboarding hooks

**No dedicated onboarding hooks.**

- `OnboardingPopup.tsx` uses plain `useState`, `useEffect`, `useCallback`, `useNavigate`.
- `DashboardLayout.tsx` uses plain `useState`/`useEffect` to toggle the popup.
- `useProfile`, `useFreeTrialStatus`, `useSubscriptionExpiry`, `useEntitlementsLoading`, `useIsFree` are used in `DashboardLayout.tsx` but are unrelated to onboarding display logic.

---

## 6. Onboarding state management

### Frontend state
- `DashboardLayout.tsx:30` — `const [showOnboarding, setShowOnboarding] = useState(false);`
- `DashboardLayout.tsx:95-113` — `useEffect` checks localStorage and sets `showOnboarding(true)`.
- `OnboardingPopup.tsx:81` — local `useState<OnboardingPrefs>({ goals: [], platform: null, style: null })`.

### Persistence
- Three `localStorage` keys are written by `OnboardingPopup.tsx`:
  - `robinos_onboarding_prefs` — JSON-stringified `{ goals, platform, style }`.
  - `robinos_onboarding_done` — `"true"` (session-style done flag).
  - `robinos_onboarding_done_permanent` — `"true"` (only written when user finishes via the final CTA).

No global store (Zustand, Redux, Jotai, etc.) touches onboarding.

---

## 7. Onboarding database fields

### `public.profiles`
- Column: `onboarding_completed boolean not null default false` (`supabase/migrations/01_master_backend_architecture.sql:220`).
- **Status: appears unused by the frontend.** No read/write of this column found in `src/`.

### `public.onboarding_states`
- Defined in `supabase/migrations/01_master_backend_architecture.sql:613-621`.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null unique`
  - `step_key text not null default 'account_created'`
  - `completed boolean not null default false`
  - `metadata jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign key: `onboarding_states_user_id_fkey` → `public.profiles(user_id)` on delete cascade.
- Trigger: `trg_onboarding_states_updated_at` (`01_master_backend_architecture.sql:846-848`).
- **Status: no frontend query found** (`grep` for `onboarding_states` in `src/` returned no matches).

---

## 8. Supabase tables / columns related to onboarding

| Object | File | Notes |
|--------|------|-------|
| `public.onboarding_states` table | `01_master_backend_architecture.sql:613-621` | Dead from frontend perspective. |
| `public.profiles.onboarding_completed` | `01_master_backend_architecture.sql:220` | Dead from frontend perspective. |
| RLS policies on `onboarding_states` | `01_master_backend_architecture.sql:1848-1853` | Dead if table is dropped. |
| `trg_onboarding_states_updated_at` | `01_master_backend_architecture.sql:846-848` | Dead if table is dropped. |
| `public.initialize_user_account(...)` insert into `onboarding_states` | `01_master_backend_architecture.sql:981`, `03_fix_onboarding_rls_policies.sql:106`, `09_fix_initialize_user_account_security_definer.sql:107`, `34_fix_free_expiry_and_referral.sql:294`, `39_fix_affiliate_conversions_schema.sql:179` | Account-creation RPC seeds a row. **Must be removed if the table is dropped.** |
| Test cleanup `delete from public.onboarding_states` | `45_production_reset.sql:142` | Only for staging/dev reset. |

---

## 9. localStorage / sessionStorage flags

| Key | File | Purpose |
|-----|------|---------|
| `robinos_onboarding_prefs` | `OnboardingPopup.tsx:21` | Stores selected goals/platform/style. |
| `robinos_onboarding_done` | `OnboardingPopup.tsx:22`, `DashboardLayout.tsx:102,106` | Session-style flag; set on skip or finish. Prevents re-showing. |
| `robinos_onboarding_done_permanent` | `OnboardingPopup.tsx:23`, `DashboardLayout.tsx:101,105` | Set only when user completes the final step. Prevents re-showing across sessions. |
| `robinos_return_to` | `AuthCallbackPage.tsx:84-88` | Post-auth redirect target. **Not onboarding-specific**; keep. |
| `maintenance-dismissed:${updatedAt}` | `DashboardLayout.tsx:135` | Maintenance banner dismissal. **Not onboarding-specific**; keep. |

No `sessionStorage` onboarding flags exist.

---

## 10. Feature flags

**None found.**

No feature-flag check gates the onboarding popup. The only platform settings consumed are `maintenance_mode` and `announcement_banner` (via `platform_settings` table) and unrelated entitlement/feature flags.

---

## 11. Redirect logic after login

- `src/pages/AuthCallbackPage.tsx` handles OAuth callback:
  1. Exchanges code for session.
  2. Calls `initializeUserAccount(storedReferral)`.
  3. Reads `sessionStorage.getItem("robinos_return_to")`.
  4. Redirects to `returnTo` if present, otherwise `/dashboard`.
- `src/lib/authInitialization.ts:17` calls `supabase.rpc("initialize_user_account", { referred_by: ... })`.
- `src/hooks/useReferralData.ts:62` also calls `db.rpc("initialize_user_account")`.
- No redirect to `/onboarding` exists; users always land on `/dashboard`, and the popup overlays the dashboard.

---

## 12. Middleware / guards

- `DashboardLayout.tsx:43-47` redirects unauthenticated users to `/auth` if `!loading && !user`.
- `AdminRouteGuard` (`src/components/admin/AdminRouteGuard.tsx`) is unrelated.
- `VaultRouteGuard` (`src/App.tsx:137-145`) gates `/resources` by `resource_vault_enabled` — unrelated.
- **No onboarding-specific route guard or middleware.**

---

## 13. Dashboard logic that decides whether onboarding is shown

`src/pages/DashboardLayout.tsx:95-113`:

```tsx
useEffect(() => {
  console.log("[DashboardLayout] onboarding useEffect executed", { ... });
  if (user && !loading) {
    const permanent = localStorage.getItem("robinos_onboarding_done_permanent");
    const session   = localStorage.getItem("robinos_onboarding_done");
    if (!permanent && !session) {
      console.log("[DashboardLayout] about to call setShowOnboarding(true)");
      setShowOnboarding(true);
    }
  }
}, [user, loading]);
```

The popup is rendered at `DashboardLayout.tsx:283-290`:

```tsx
{showOnboarding && (
  <OnboardingPopup onComplete={() => { setShowOnboarding(false); }} />
)}
```

---

## 14. Analytics / events tied to onboarding

**None found.**

- No `track()`, `posthog`, `segment`, `gtag`, or `mixpanel` calls reference onboarding.
- The only analytics references in the codebase are generic dashboard/marketing copy and unrelated admin RPCs.

---

## 15. API / server functions involved

| Function | Location | Role |
|----------|----------|------|
| `initialize_user_account(p_referred_by text)` | `supabase/migrations/01_master_backend_architecture.sql`, `03_fix_onboarding_rls_policies.sql`, `09_fix_initialize_user_account_security_definer.sql`, `34_fix_free_expiry_and_referral.sql`, `39_fix_affiliate_conversions_schema.sql` | Creates profile, affiliate profile, subscription, and **inserts a row into `public.onboarding_states`**. |
| `initialize_user_account()` (no-args overload) | `01_master_backend_architecture.sql`, `03_fix_onboarding_rls_policies.sql` | Wrapper that calls the parameterized version. |

No Edge Functions, server actions, or REST endpoints specifically for onboarding.

---

## 16. Types / interfaces related to onboarding

- `OnboardingPopupProps` — `src/components/OnboardingPopup.tsx:11`.
- `OnboardingPrefs` — `src/components/OnboardingPopup.tsx:15`.
- No exported types, no `types/onboarding.ts`, no shared enum.

---

## 17. Files that become unused if onboarding is removed

### Definitely unused
1. `src/components/OnboardingPopup.tsx` — entire component.

### Partially unused (need cleanup)
2. `src/pages/DashboardLayout.tsx` — remove:
   - `import { OnboardingPopup } from "@/components/OnboardingPopup";`
   - `const [showOnboarding, setShowOnboarding] = useState(false);`
   - The onboarding `useEffect` (lines ~95-113).
   - The `{showOnboarding && <OnboardingPopup ... />}` block (lines ~283-290).

### Backend dead objects (if fully removing the data layer)
3. `public.onboarding_states` table + trigger + RLS policies.
4. `public.profiles.onboarding_completed` column.
5. The `insert into public.onboarding_states(...)` line inside the current `initialize_user_account()` function.

### Non-code artifacts
6. The three `robinos_onboarding_*` localStorage keys.

---

## Trigger analysis

### What triggers the onboarding screen?
1. User signs in via Google OAuth.
2. `AuthCallbackPage` calls `initializeUserAccount()` RPC, then navigates to `/dashboard`.
3. `DashboardLayout` mounts for `/dashboard/*`.
4. Its onboarding `useEffect` runs once `user` exists and `loading` is false.
5. If neither `robinos_onboarding_done_permanent` nor `robinos_onboarding_done` exist in `localStorage`, `setShowOnboarding(true)` is called and `OnboardingPopup` renders.

### Why do users land here instead of the dashboard?
They **do** land on the dashboard (`/dashboard/trend-scanner` by default). The onboarding UI is a modal overlay, not a separate landing page. It appears because the done flags are absent in `localStorage`.

---

## Impact analysis

### What would break if the onboarding UI is removed?
- **Nothing functional** in the current codebase. The popup only:
  - Collects user preferences (goals, platform, style).
  - Writes them to `localStorage`.
  - Offers navigation shortcuts to `/dashboard/trend-scanner`, `/dashboard/studio`, `/dashboard/audio-hashtag`.
- No other code reads `robinos_onboarding_prefs`.
- No analytics events depend on onboarding.
- No backend query depends on the popup being shown.

### What would break if the backend data layer is removed without updating the RPC?
- `initialize_user_account()` inserts into `public.onboarding_states`. If the table is dropped first, new user sign-up will fail until that insert is removed from the RPC.

### What needs to be updated after removal?
1. Delete `src/components/OnboardingPopup.tsx`.
2. Clean `src/pages/DashboardLayout.tsx`.
3. Decide whether to drop `public.onboarding_states` and `profiles.onboarding_completed`.
4. If dropping the table, update `initialize_user_account()` to remove the insert.
5. Regenerate Supabase types if a generated types file exists.
6. Run lint/tests.

### Will dead code remain?
- If you only remove the React UI, the Supabase table/column and the RPC insert remain as dead backend data.
- If you also drop the DB objects, no onboarding-specific dead code remains.
- Old migrations (`01`, `03`, `09`, `34`, `39`, `45`) will still reference onboarding historically. **Do not edit old migrations.** They are the schema history. Use a new migration to drop obsolete objects.

---

## Ordered removal plan

### Phase A — Frontend removal
1. **Remove `OnboardingPopup` from `DashboardLayout.tsx`.**
   - Delete import.
   - Delete `showOnboarding` state.
   - Delete the onboarding `useEffect`.
   - Delete the `{showOnboarding && ...}` render block.
2. **Delete `src/components/OnboardingPopup.tsx`.**
3. **Verify no frontend references remain.**
   - Grep for `OnboardingPopup`, `robinos_onboarding`, `onboarding_done`, `onboarding_prefs`.
4. **Optional copy change.**
   - In `src/pages/AuthPage.tsx`, change `"Setting up your workspace..."` to `"Setting up your account..."` or similar to remove onboarding wording.

### Phase B — Backend cleanup (optional but recommended for complete removal)
5. **Create a new Supabase migration** (e.g., `49_remove_onboarding.sql`) to:
   - Drop RLS policies on `public.onboarding_states`.
   - Drop trigger `trg_onboarding_states_updated_at` on `public.onboarding_states`.
   - Drop `public.onboarding_states` table.
   - Drop `onboarding_completed` column from `public.profiles`.
6. **Update the active `initialize_user_account()` function** (in the new migration or latest function definition) to remove the `insert into public.onboarding_states(...)` statement.
7. **Apply migration and regenerate Supabase types.**

### Phase C — Verification
8. **Run the test suite / lint.**
9. **Smoke-test the login flow:**
   - Sign in with a fresh/incognito session.
   - Confirm redirect lands on `/dashboard/trend-scanner` with no overlay.
   - Confirm no `robinos_onboarding_*` keys are written to `localStorage`.
10. **Smoke-test new user creation** (if backend was changed):
    - Confirm `initialize_user_account` returns `ok: true` and does not error.

---

## Quick-reference grep commands used

```bash
# Frontend references
grep -Rin "onboarding\|robinos_onboarding\|OnboardingPopup" src/ --include="*.{ts,tsx}"

# Database references
grep -Rin "onboarding_states\|onboarding_completed\|has_completed_onboarding" supabase/ src/ --include="*.{ts,tsx,sql}"

# Analytics / tracking references
grep -Rin "track\|posthog\|segment\|gtag\|mixpanel" src/ --include="*.{ts,tsx}"

# Routes
grep -Rin "path=.*onboard\|onboarding" src/App.tsx src/routeTree* --include="*.tsx"
```

---

## Note on routing framework

The codebase currently uses **react-router-dom** (`BrowserRouter`, `Routes`, `Route`, `useNavigate`). No TanStack Router route tree or generated `routeTree.gen.ts` file was found. The onboarding flow is therefore implemented as a conditional overlay inside `DashboardLayout`, not as a TanStack route.
