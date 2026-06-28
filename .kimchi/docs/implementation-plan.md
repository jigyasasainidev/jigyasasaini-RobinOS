# Implementation Plan: Resource Vault Visibility Toggle

## Goal
Add a `resource_vault_enabled` boolean toggle to `platform_settings` that controls visibility of the Resource Vault (`/resources`) across navbar, footer, homepage CTA, and blocks direct access with redirect to `/`.

## Pattern
Follow the exact existing pattern used by `creator_os_page_enabled` in the same codebase.

---

## Chunk 1: Database + Types + Hook (Foundation)

### Files
1. **NEW** `supabase/migrations/48_resource_vault_settings.sql`
2. **MODIFY** `scripts/sql/bootstrap_platform_settings.sql`
3. **MODIFY** `src/types/platform-config.ts`
4. **MODIFY** `src/hooks/usePlatformSettings.ts`

### Details

#### Migration 48
```sql
alter table public.platform_settings
  add column if not exists resource_vault_enabled boolean not null default true;

comment on column public.platform_settings.resource_vault_enabled is
  'When false, the /resources page is unavailable and links are hidden.';
```

#### Bootstrap SQL
Add after the `affiliate_resources_url` column block:
```sql
alter table public.platform_settings
  add column if not exists resource_vault_enabled boolean not null default true;
```

#### platform-config.ts
- `PlatformSettingsRow`: add `resource_vault_enabled: boolean`
- `PlatformSettingsDraft`: add `resource_vault_enabled: boolean`
- `PlatformSettingsLive`: add `resource_vault_enabled: boolean`
- `PLATFORM_SETTINGS_DEFAULTS`: add `resource_vault_enabled: true`
- `validateSettingsDraft`: no validation needed (boolean)

#### usePlatformSettings.ts
- Add `resource_vault_enabled` to the `.select(...)` column list
- Add `resource_vault_enabled: boolean` to `PlatformSettingsLive` type in the file

### Acceptance Criteria
- [ ] `supabase/migrations/48_resource_vault_settings.sql` exists with additive column
- [ ] `bootstrap_platform_settings.sql` includes the column
- [ ] All three type interfaces include `resource_vault_enabled`
- [ ] `PLATFORM_SETTINGS_DEFAULTS` has `resource_vault_enabled: true`
- [ ] `usePlatformSettings` selects the new column

---

## Chunk 2: Admin Panel Settings UI

### Files
1. **MODIFY** `src/pages/AdminDashboard.tsx`

### Details

#### Hydration (~line 880)
In the `useEffect` that hydrates `settingsDraft` from `platformSettings`, add:
```ts
resource_vault_enabled: platformSettings.resource_vault_enabled ?? true,
```

#### Settings Form UI
Find the "Public Page Controls" section (currently "Launch Partners Page Controls" — rename to "Public Page Controls" per user note). Add a toggle for Resource Vault alongside Creator OS and Launch Partners.

The toggle should be a checkbox/switch using the same pattern as `creator_os_page_enabled`:
- Label: "Resource Vault"
- Bind to `settingsDraft.resource_vault_enabled`
- On change: `setSettingsDraft(prev => ({ ...prev, resource_vault_enabled: checked }))`

#### Save Mutation (~line 1343)
Add to the payload object:
```ts
resource_vault_enabled: !!settingsDraft.resource_vault_enabled,
```

#### onSuccess (~line 1350+)
Add to the `onSuccess` draft update:
```ts
resource_vault_enabled: savedPayload.resource_vault_enabled,
```

#### Rename Section Header
Rename "Launch Partners Page Controls" → "Public Page Controls"

### Acceptance Criteria
- [ ] Resource Vault toggle renders in admin settings
- [ ] Toggle saves correctly via existing mutation
- [ ] Section renamed to "Public Page Controls"
- [ ] Existing Creator OS and Launch Partners toggles still work

---

## Chunk 3: Public Components (Navbar, Footer, Homepage)

### Files
1. **MODIFY** `src/components/public/PublicNavbar.tsx`
2. **MODIFY** `src/components/public/PublicFooter.tsx`
3. **MODIFY** `src/pages/EntryPage.tsx`

### Details

#### PublicNavbar.tsx
Change the Resources link in `BASE_LINKS` to:
```ts
{ label: "Resources", to: "/resources", requiresSetting: "resource_vault_enabled" as const },
```

Update the `.filter()` callback to also handle `resource_vault_enabled`:
```ts
if (link.requiresSetting === "resource_vault_enabled") {
  return settings ? settings.resource_vault_enabled !== false : true;
}
```

#### PublicFooter.tsx
- Import `usePlatformSettings` from `@/hooks/usePlatformSettings`
- Call `const { data: settings } = usePlatformSettings();`
- Filter the `resourceLinks` array to conditionally include the Resource Vault link:
```ts
const resourceLinks = [
  { label: "Blog", to: "/blog" },
  { label: "Documentation", to: "/docs" },
  { label: "Help Center", to: "/help" },
  { label: "Creator Guide", to: "/creator-guide" },
  { label: "Affiliate Guide", to: "/affiliate-guide" },
  ...(settings?.resource_vault_enabled !== false ? [{ label: "Resource Vault", to: "/resources" }] : []),
];
```

#### EntryPage.tsx
- Import `usePlatformSettings` from `@/hooks/usePlatformSettings`
- Call `const { data: settings } = usePlatformSettings();`
- Wrap the "7.5. RESOURCE VAULT CTA" `<RevealSection>` in a conditional:
```tsx
{settings?.resource_vault_enabled !== false && (
  <RevealSection className="py-16 md:py-24 px-4 sm:px-6 max-w-4xl mx-auto">
    {/* ... existing CTA content ... */}
  </RevealSection>
)}
```

### Acceptance Criteria
- [ ] Resources link hidden from navbar when disabled
- [ ] Resource Vault link hidden from footer when disabled
- [ ] Homepage CTA hidden when disabled
- [ ] All three still show when enabled (default)

---

## Chunk 4: Page Guards + Route Protection

### Files
1. **MODIFY** `src/pages/ResourceVaultPage.tsx`
2. **MODIFY** `src/pages/ResourceDetailPage.tsx`
3. **MODIFY** `src/App.tsx`

### Details

#### ResourceVaultPage.tsx
- Import `useNavigate` from `react-router-dom`
- Import `usePlatformSettings` from `@/hooks/usePlatformSettings`
- At top of component:
```ts
const navigate = useNavigate();
const { data: settings } = usePlatformSettings();

if (settings && settings.resource_vault_enabled === false) {
  navigate("/", { replace: true });
  return null;
}
```
Do this BEFORE the `useQuery` call to avoid unnecessary data fetching when disabled.

#### ResourceDetailPage.tsx
- Same pattern as above:
```ts
const { data: settings } = usePlatformSettings();

if (settings && settings.resource_vault_enabled === false) {
  navigate("/", { replace: true });
  return null;
}
```
Do before the `useQuery` for the resource.

#### App.tsx
Wrap the `/resources` and `/resources/:slug` routes with a guard component. Create a small inline component `VaultRouteGuard`:
```tsx
const VaultRouteGuard = ({ children }: { children: React.ReactNode }) => {
  const { data: settings } = usePlatformSettings();
  if (settings && settings.resource_vault_enabled === false) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};
```

Then wrap routes:
```tsx
<Route path="/resources" element={<VaultRouteGuard><ResourceVaultPage /></VaultRouteGuard>} />
<Route path="/resources/:slug" element={<VaultRouteGuard><ResourceDetailPage /></VaultRouteGuard>} />
```

Make sure to import `usePlatformSettings` and `Navigate` in `App.tsx`.

### Acceptance Criteria
- [ ] `/resources` redirects to `/` when disabled
- [ ] `/resources/:slug` redirects to `/` when disabled
- [ ] Both pages work normally when enabled
- [ ] `App.tsx` route guard provides defense-in-depth

---

## Validation Commands (to run after all chunks)

```bash
# TypeScript
cd /Users/ashad/Documents/RobinOS-main && npx tsc --noEmit

# Build
cd /Users/ashad/Documents/RobinOS-main && npm run build

# Lint
cd /Users/ashad/Documents/RobinOS-main && npm run lint
```

## Chunk Order & Parallelism

1. **Chunk 1** (sequential) → types/hook must exist
2. **Chunk 2** (sequential, depends on Chunk 1)
3. **Chunk 3 + Chunk 4** (parallel, both depend on Chunk 1)

Maximum 2 concurrent build agents after Chunk 1+2 complete.
