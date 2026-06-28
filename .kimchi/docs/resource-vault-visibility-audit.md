# Audit Report: Resource Vault Visibility Toggle

## EXECUTIVE SUMMARY

A single-column boolean addition to the existing `platform_settings` table is the correct, production-safe integration point. The codebase already has two page-visibility toggles (`creator_os_page_enabled`, `jvzoo_affiliate_enabled`) using this exact pattern. The recommended approach is to follow that pattern precisely.

---

## 1. CURRENT RESOURCES ARCHITECTURE

### Routes & Pages

| File | Role | Key Lines |
|------|------|-----------|
| `src/App.tsx` | Route registration | 222–228: `/adminsh/resources`, `/resources`, `/resources/:slug` |
| `src/pages/ResourceVaultPage.tsx` | Public vault listing page | Default export; fetches from `resources` table |
| `src/pages/ResourceDetailPage.tsx` | Public detail + download page | Default export; fetches by `slug`; download gating via `useAuth` |
| `src/pages/public/PublicInfoPages.tsx` | **OLD** Resources links hub | `ResourcesPage()` function still exists (legacy) |
| `src/components/admin/AdminResourcesPage.tsx` | Admin CRUD for resources | Mounted inside `AdminDashboard` at `/adminsh/resources` |
| `src/lib/routePrefetch.ts` | Route preloading | Line 21: regex `/^\/resources(?:\/|$)/` still points to legacy `ResourcesPage` import |

### Navigation References

| File | Context | Exact Reference |
|------|---------|-----------------|
| `src/components/public/PublicNavbar.tsx` | Top nav | `BASE_LINKS` array includes `{ label: "Resources", to: "/resources" }` |
| `src/components/public/PublicFooter.tsx` | Footer links | `resourceLinks` array includes `{ label: "Resource Vault", to: "/resources" }` |
| `src/pages/EntryPage.tsx` | Homepage CTA | Section "7.5. RESOURCE VAULT CTA" with `<Link to="/resources">` |

### Database / Storage

- **Table:** `public.resources` (defined in migration `47_resource_vault.sql`)
- **Storage buckets:** `resource-pdfs`, `resource-covers`
- **RLS:** Public read enabled; admin-only write

---

## 2. EXISTING CONFIGURATION SYSTEMS

### `platform_settings` — Singleton Configuration Table

| Property | Type | Purpose |
|----------|------|---------|
| `creator_os_page_enabled` | `boolean NOT NULL DEFAULT true` | Controls visibility of `/creator-os` page & navbar link |
| `jvzoo_affiliate_enabled` | `boolean NOT NULL DEFAULT false` | Controls visibility of Launch Partners page |
| `maintenance_mode` | `boolean NOT NULL DEFAULT false` | Global maintenance gate |

### Type System

All types live in `src/types/platform-config.ts`:
- `PlatformSettingsRow` — DB row shape (includes `id`, `created_at`, `updated_at`)
- `PlatformSettingsDraft` — Mutable subset for admin UI form state
- `PlatformSettingsLive` — Lightweight read-only shape for public consumers
- `PLATFORM_SETTINGS_DEFAULTS` — Canonical defaults (must match DB seed row)
- `validateSettingsDraft()` — Validation rules

### Data Fetching

| Hook | File | Selects From |
|------|------|--------------|
| `usePlatformSettings()` | `src/hooks/usePlatformSettings.ts` | `platform_settings` (live public read) |
| Admin settings query | `src/pages/AdminDashboard.tsx` (~864) | `platform_settings` (admin read, `select *`) |
| Settings save mutation | `src/pages/AdminDashboard.tsx` (~1343) | `update/insert platform_settings` |

### Realtime

`subscribeMultiTable()` in `AdminDashboard.tsx` listens to `platform_settings` changes and invalidates:
- `admin-platform-settings-v2`
- `platform-settings-live-v1`

---

## 3. BEST INTEGRATION POINT

### ✅ RECOMMENDED: Reuse `platform_settings` with new boolean column

**Rationale:**
1. **Pattern match:** `creator_os_page_enabled` already toggles a public page on/off *and* hides its navbar link. This is identical to the requirement.
2. **Single source of truth:** One row, one query, one subscription — no new tables or hooks.
3. **Admin UI already built:** The settings form in `AdminDashboard.tsx` already renders toggles for booleans.
4. **No performance impact:** The `platform_settings` row is already fetched on every page load by `usePlatformSettings()` (staleTime: 15s).
5. **Migration hygiene:** Follows the additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern used in migrations 23 and 46.

### ❌ Not Recommended: Create a new settings table
- Would require a new hook, new API, new subscription, new admin UI section.
- Massive overkill for a single boolean.

### ❌ Not Recommended: Use an existing page visibility system
- There is no centralized page visibility system beyond `platform_settings`. The only other gate is `maintenance_mode` which is global and not suitable.

---

## 4. REQUIRED CHANGES REPORT

### Database Changes

**New migration needed:** `supabase/migrations/48_resource_vault_settings.sql`

```sql
alter table public.platform_settings
  add column if not exists resource_vault_enabled boolean not null default true;

comment on column public.platform_settings.resource_vault_enabled is
  'When false, the /resources page returns 404/redirect, and navbar/footer links are hidden.';
```

**Also update:** `scripts/sql/bootstrap_platform_settings.sql` to include the new column (so new environments get it on bootstrap).

### Backend / API

No new API endpoints or RPC functions needed. The existing `platform_settings` RLS policies already grant public read access:
- `"Public read platform settings"` — `for select to public using (true)`

The `usePlatformSettings()` hook just needs the new column added to its `select` string.

### Type System Changes

| File | Changes |
|------|---------|
| `src/types/platform-config.ts` | Add `resource_vault_enabled: boolean` to `PlatformSettingsRow`, `PlatformSettingsDraft`, `PlatformSettingsLive`; add default `true` to `PLATFORM_SETTINGS_DEFAULTS`; no validation needed (boolean) |

### Hook Changes

| File | Changes |
|------|---------|
| `src/hooks/usePlatformSettings.ts` | Add `resource_vault_enabled` to the `.select(...)` string so it is fetched |

### Admin Panel Changes

| File | Changes |
|------|---------|
| `src/pages/AdminDashboard.tsx` | (1) Add `resource_vault_enabled` to `settingsDraft` hydrate block; (2) Add toggle to settings form UI; (3) Add to save payload; (4) Add to `onSuccess` draft update |

### Frontend Visibility Changes

| File | Changes |
|------|---------|
| `src/components/public/PublicNavbar.tsx` | Add `requiresSetting: "resource_vault_enabled"` to the "Resources" link in `BASE_LINKS`, following the exact pattern used for `creator_os_page_enabled` |
| `src/components/public/PublicFooter.tsx` | Conditionally render the "Resource Vault" link in `resourceLinks` array based on `usePlatformSettings().data?.resource_vault_enabled` |
| `src/pages/EntryPage.tsx` | Conditionally render the "7.5. RESOURCE VAULT CTA" section based on `usePlatformSettings().data?.resource_vault_enabled` |
| `src/App.tsx` | Conditionally route `/resources` and `/resources/:slug` — either render `NotFound` or redirect to `/` when disabled. **Alternatively**, keep routes but let ResourceVaultPage itself handle redirect/404 based on settings |
| `src/pages/ResourceVaultPage.tsx` | Add guard at top: if `resource_vault_enabled === false`, redirect to `/` or render `<NotFound />` |
| `src/pages/ResourceDetailPage.tsx` | Same guard — if vault disabled, redirect or 404 |
| `src/lib/routePrefetch.ts` | No functional change needed, but the `/^\/resources(?:\/|$)/` regex currently points to the OLD `ResourcesPage` import from `PublicInfoPages.tsx`. This is a pre-existing inconsistency (App.tsx overrides it). Not critical to fix for this feature, but should be aligned to prefetch `ResourceVaultPage` if desired |

---

## 5. RECOMMENDED IMPLEMENTATION PLAN

### Phase 1: Database & Types (safe, additive)
1. Create migration `48_resource_vault_settings.sql`
2. Update `scripts/sql/bootstrap_platform_settings.sql`
3. Update `src/types/platform-config.ts` (all 3 interfaces + defaults)
4. Update `src/hooks/usePlatformSettings.ts` select clause

### Phase 2: Admin Panel Toggle
1. Update `src/pages/AdminDashboard.tsx`:
   - Hydrate `resource_vault_enabled` from DB to draft
   - Add toggle UI in settings form (group near `creator_os_page_enabled`)
   - Include in save payload and `onSuccess` merge

### Phase 3: Frontend Visibility (parallel-safe)
1. **Navbar:** In `PublicNavbar.tsx`, add conditional filter using `requiresSetting`
2. **Footer:** In `PublicFooter.tsx`, filter `resourceLinks` conditionally
3. **EntryPage:** In `EntryPage.tsx`, wrap CTA in conditional
4. **Vault Page:** In `ResourceVaultPage.tsx`, add redirect-to-home guard when disabled
5. **Detail Page:** In `ResourceDetailPage.tsx`, same redirect guard

### Phase 4: Route Guard (optional reinforcement)
- In `App.tsx`, wrap the `/resources` routes in a conditional component that checks `usePlatformSettings` and renders `<NotFound />` or `<Navigate to="/" />` when disabled. This is the strongest defense against direct URL access.

### Safety Checklist
- [ ] Default `true` ensures existing behavior is preserved (backward compatible)
- [ ] No data migration needed — additive column only
- [ ] No breaking API changes — same table, same policies
- [ ] Realtime invalidation already wired — public pages refresh within 15s
- [ ] Pattern already proven by `creator_os_page_enabled`

---

## FILES SUMMARY

### Files that would need modification (11 files)

1. `supabase/migrations/48_resource_vault_settings.sql` **(NEW)**
2. `scripts/sql/bootstrap_platform_settings.sql` **(MODIFY)**
3. `src/types/platform-config.ts` **(MODIFY)**
4. `src/hooks/usePlatformSettings.ts` **(MODIFY)**
5. `src/pages/AdminDashboard.tsx` **(MODIFY)**
6. `src/components/public/PublicNavbar.tsx` **(MODIFY)**
7. `src/components/public/PublicFooter.tsx` **(MODIFY)**
8. `src/pages/EntryPage.tsx` **(MODIFY)**
9. `src/pages/ResourceVaultPage.tsx` **(MODIFY)**
10. `src/pages/ResourceDetailPage.tsx` **(MODIFY)**
11. `src/App.tsx` **(MODIFY — optional but recommended)**

### Files requiring NO changes but relevant to context

- `src/components/admin/AdminResourcesPage.tsx` — Admin CRUD is unaffected; toggling visibility does not delete resources
- `src/hooks/useResources.ts` — Hook only fetches data; visibility is a UI/routing concern
- `supabase/migrations/47_resource_vault.sql` — Table schema is correct as-is

---

*End of Audit. No files were modified.*
