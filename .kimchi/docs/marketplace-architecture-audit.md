# Marketplace Architecture Audit — WarriorPlus Introduction

**Status:** Audit only. No implementation performed. Awaiting approval.
**Scope:** `/jvzoo` audit, JVZoo hide/unhide flow, scalable multi-marketplace architecture.
**Date:** 2026-06-29

---

## TL;DR

RobinOS today has **exactly one** sales-page-style public route (`/jvzoo`) and **one** affiliate landing route (`/launch-partners`, also aliased `/jvzooaffiliate`). Both are gated by boolean columns on the `platform_settings` Supabase table, read via `usePlatformSettings()` and enforced client-side by `useEffect` redirects.

**Three concrete JVZoo components are hardcoded** to JVZoo endpoints (CTA URL, tracking pixel URL, disclaimer text). Three places in the codebase know about JVZoo by name: the route entry, the navbar link, and the SEO record.

The current pattern is **manageable for one marketplace but will not scale**. Every new marketplace requires (a) a new SQL column, (b) a new entry in the types layer, (c) a new entry in the settings draft, (d) a new admin UI section, (e) a new lazy route, (f) a new hardcoded component trio, (g) a new navbar entry, and (h) a new SEO record.

A **registry-driven architecture** removes all of the per-marketplace hardcoding and lets `/warriorplus` (and future `/clickbank`, `/digistore24`, `/appsumo`, `/whop`) plug in via a single config file.

---

## 1. Current Architecture Map

### 1.1 Files involved in the `/jvzoo` flow

| Layer | File | Role |
|---|---|---|
| Route | `src/App.tsx` (line 69, 258) | Lazy-imports `CreatorOSPage` as `CreatorOSPage`, mounts it at `/jvzoo` |
| Page | `src/pages/public/CreatorOSPage.tsx` (650 lines) | The full sales page. Gates itself with `creator_os_page_enabled` |
| CTA component | `src/components/public/JVZooCTA.tsx` | Hardcoded `JVZOO_CTA_DESTINATION = https://www.jvzoo.com/b/0/442467/99` |
| Tracking pixel | `src/components/public/JVZooTrackingPixel.tsx` | Hardcoded `JVZOO_TRACKING_PIXEL_URL = https://i.jvzoo.com/0/442467/99` |
| Disclaimer | `src/components/public/JVZooDisclaimer.tsx` | Hardcoded `JVZOO_DISCLAIMER_TEXT` |
| Settings hook | `src/hooks/usePlatformSettings.ts` | React Query fetch of `platform_settings` row; realtime subscription via `channelManager` |
| Types | `src/types/platform-config.ts` | `PlatformSettingsRow`, `PlatformSettingsDraft`, `PlatformSettingsLive`, `PLATFORM_SETTINGS_DEFAULTS` |
| Navbar | `src/components/public/PublicNavbar.tsx` | `BASE_LINKS` array with `requiresSetting` filter |
| SEO | `src/components/seo/PageSeo.tsx` | `PAGE_SEO` Record keyed by path; entry for `/jvzoo` |
| Admin UI | `src/pages/AdminDashboard.tsx` (lines 861–914, 1335–1372, 1980–2070) | `settingsDraft` state, hydration, save payload, visibility toggle |
| SQL | `scripts/sql/bootstrap_platform_settings.sql` (sections 2 & 3) | `creator_os_page_enabled`, `creator_os_demo_video_url`, `jvzoo_affiliate_*` columns |

### 1.2 Files involved in the hide/unhide mechanism

The hide/unhide mechanism is **the same code path** that hydrates all platform settings. Three touch points:

1. **Database** — `public.platform_settings` table with boolean columns (`creator_os_page_enabled`, `jvzoo_affiliate_enabled`, `resource_vault_enabled`, etc.)
2. **Read path** — `usePlatformSettings()` React Query hook returns `{ data: settings, isLoading }`. Subscribes to realtime changes via `subscribePostgresChanges()` and invalidates the query.
3. **Enforcement** — Each gated page does:
   ```tsx
   useEffect(() => {
     if (!isLoading && settings && settings.creator_os_page_enabled === false) {
       navigate("/", { replace: true });
     }
   }, [settings, isLoading, navigate]);
   if (isLoading) return null;
   if (settings && settings.creator_os_page_enabled === false) return null;
   ```
   Plus the **navbar** filters out the link when the flag is `false`.

### 1.3 Critical naming observation

The codebase has **two distinct JVZoo-related toggles that mean different things**:

| Flag | Route gated | Actual semantics |
|---|---|---|
| `creator_os_page_enabled` | `/jvzoo` (CreatorOSPage) | The main JVZoo sales page |
| `jvzoo_affiliate_enabled` | `/launch-partners` (LaunchPartnersPage, alias `/jvzooaffiliate`) | The affiliate / launch partner landing page |

The second flag is mis-named — it controls a generic launch-partners page, not a JVZoo-specific affiliate program. This will create confusion when WarriorPlus is added (you'd expect `warriorplus_affiliate_enabled` to control a WarriorPlus affiliate page, but the pattern is actually "one affiliate page per marketplace landing").

---

## 2. Current Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                  │
│  public.platform_settings                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ creator_os_page_enabled        boolean default true      │    │
│  │ creator_os_demo_video_url      text                       │    │
│  │ jvzoo_affiliate_enabled        boolean default false     │    │
│  │ jvzoo_affiliate_demo_video_url text                       │    │
│  │ jvzoo_affiliate_cta_url        text                       │    │
│  │ jvzoo_affiliate_button_text    text                       │    │
│  │ jvzoo_affiliate_login_url      text                       │    │
│  │ resource_vault_enabled         boolean default true      │    │
│  │ maintenance_mode               boolean default false     │    │
│  │ announcement_banner            text                       │    │
│  │ (creator_price, pro_price, ... business config)          │    │
│  └──────────────────────────────────────────────────────────┘    │
│  RLS: public SELECT true | service_role ALL                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │ realtime + REST
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              usePlatformSettings()  (React Query)                │
│  queryKey: ["platform-settings-live-v1"]                         │
│  staleTime: 15s                                                   │
│  Realtime: subscribePostgresChanges("platform_settings","*")     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ { data: settings, isLoading }
            ┌──────────────┼──────────────┬──────────────────────────┐
            ▼              ▼              ▼                          ▼
       CreatorOSPage  LaunchPartners  PublicNavbar           VaultRouteGuard
       /jvzoo         /launch-partners   filters links        /resources
       uses           uses jvzoo_       with requiresSetting
       creator_os_     affiliate_*      field
       page_enabled   settings
            │              │              │                          │
            ▼              ▼              ▼                          ▼
       navigate("/")   navigate("/")   hide link           navigate("/")
       when false      when false      when false          when false
```

### Side-channels (not in main flow but relevant)

- **Hardcoded JVZoo URLs** (constants in component files) — never read from settings, never gated:
  - `JVZOO_CTA_DESTINATION = "https://www.jvzoo.com/b/0/442467/99"` in `JVZooCTA.tsx`
  - `JVZOO_TRACKING_PIXEL_URL = "https://i.jvzoo.com/0/442467/99"` in `JVZooTrackingPixel.tsx`
- **SEO** — `/jvzoo` is a literal key in `PAGE_SEO` Record at `PageSeo.tsx:106`. The `CreatorOSPage` does **not** actually render a `<PageSeo>` component — the SEO record is dormant/unused for that route today.
- **Route prefetch** — `src/lib/routePrefetch.ts` (warmCriticalRoutes) is called from `App.tsx` ScrollManager. Need to inspect for how `jvzoo` prefetch key is registered.
- **Lazy load** — `lazyWithRetry(() => import(...), "jvzoo")` uses `"jvzoo"` as the retry-cache key.

---

## 3. Problems in the Current Implementation

### 3.1 No abstraction layer

JVZoo appears in **three component files by name** (`JVZooCTA`, `JVZooTrackingPixel`, `JVZooDisclaimer`) and in **two constant strings**. There is no `Marketplace` type, no `MarketplaceConfig` interface, no registry. Every new marketplace would require copy-pasting this triplet.

### 3.2 Schema duplication

Each marketplace needs:
- `creator_os_page_enabled` style boolean for "is this route public"
- 3–5 text columns for `*_demo_video_url`, `*_cta_url`, `*_button_text`, `*_login_url`

With 5 marketplaces this is **~25 new columns** on a singleton row, growing linearly with each launch. Migration churn becomes painful (one ALTER TABLE per marketplace).

### 3.3 Settings hydration is per-column

`usePlatformSettings.ts` has the column list as a **single long comma-separated string** in the `.select(...)` call. Adding a new flag means editing three files (this hook, `PlatformSettingsLive` type, `PlatformSettingsDraft` type) plus the SQL.

### 3.4 Admin UI is hand-rolled per flag

The Admin Dashboard has hand-coded `<select>` blocks for each flag (`AdminDashboard.tsx:1995-2023` for `creator_os_page_enabled`, `:2017-2023` for `jvzoo_affiliate_enabled`). Each new flag = new JSX block. No data-driven rendering.

### 3.5 Visibility gating pattern is repeated, not extracted

The same `useEffect → navigate("/")` pattern appears in **every gated page**. No `<MarketplaceRouteGuard>` component exists. Each page reimplements the visibility check inline.

### 3.6 Navbar requires explicit per-link config

`BASE_LINKS` in `PublicNavbar.tsx` requires a `requiresSetting` field on every link that should be conditionally visible. Adding a marketplace = editing this array.

### 3.7 SEO is path-keyed with no shared template

`PAGE_SEO` in `PageSeo.tsx` is a flat Record keyed by path string. No factory function for "build SEO for a marketplace page".

### 3.8 Dead/disconnected SEO

The `/jvzoo` entry in `PAGE_SEO` exists, but `CreatorOSPage.tsx` does **not** render `<PageSeo>` anywhere — the SEO metadata is effectively unused today. This is a latent bug.

### 3.9 Naming inconsistency

`jvzoo_affiliate_enabled` controls `/launch-partners`, not a JVZoo-specific affiliate program. When WarriorPlus is added, the natural extension (`warriorplus_affiliate_enabled`) will mean something different again unless this is fixed.

### 3.10 Tracking pixels are not gated

The `<JVZooTrackingPixel />` always renders at the bottom of `CreatorOSPage` — there's no way to disable tracking without removing the component from JSX. Should be a settings flag (and for a multi-marketplace world, one flag per marketplace).

### 3.11 Checkout URL is hardcoded, not in settings

`JVZOO_CTA_DESTINATION` is a module-level constant. Admin cannot change it. This is by design (compliance), but for a WarriorPlus page you'll need the equivalent constant for WarriorPlus — and the pattern is "edit source code to change URL". A future improvement is to put safe-to-expose URLs in settings and keep only compliance-critical ones hardcoded.

---

## 4. Recommended Scalable Architecture

### 4.1 Core principle: **Registry over hardcoding**

Replace every per-marketplace hardcoded value with a single source-of-truth **marketplace registry** — a typed config object that describes every marketplace the platform supports. The registry knows:

- Route path
- Display label
- CTA destination URL
- Tracking pixel URL
- Disclaimer text
- Branding (color tokens)
- Settings key prefix (for visibility toggle + content)
- SEO defaults
- Component overrides (optional)

### 4.2 Layer breakdown

```
┌─────────────────────────────────────────────────────────────────┐
│ src/config/marketplaces.ts  ← REGISTRY (single source of truth) │
│   MARKETPLACES: Record<MarketplaceId, MarketplaceConfig>        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
       ┌───────────────────┼────────────────────┬──────────────────┐
       ▼                   ▼                    ▼                  ▼
   Registry helpers    Page components      Admin UI          DB layer
   (getMarketplace,    (<MarketplacePage>   (<Marketplace-    (JSONB column)
    listMarketplaces,   consuming registry    SettingsCard>)
    resolveConfig)     + reusable parts)
```

### 4.3 Database schema — JSONB pattern

**Replace** the per-marketplace boolean/text columns with **two** new columns:

```sql
alter table public.platform_settings
  add column if not exists marketplace_registry jsonb
    not null default '{}'::jsonb;
```

Shape of `marketplace_registry`:

```jsonc
{
  "jvzoo": {
    "enabled": true,
    "demo_video_url": "https://...",
    "cta_url": "https://www.jvzoo.com/...",
    "tracking_pixel_url": "https://i.jvzoo.com/...",
    "disclaimer_text": "JVZoo compliance disclaimer...",
    "seo": {
      "title": "Creator OS — AI-Powered Content Operating System",
      "description": "...",
      "keywords": "..."
    },
    "branding": {
      "accent": "hsl(217 91% 60%)",
      "label": "JVZoo"
    }
  },
  "warriorplus": {
    "enabled": false,
    "demo_video_url": null,
    "cta_url": "https://warriorplus.com/...",
    "tracking_pixel_url": "https://warriorplus.com/...",
    "disclaimer_text": "WarriorPlus compliance disclaimer...",
    "seo": { ... },
    "branding": { "accent": "hsl(28 92% 55%)", "label": "WarriorPlus" }
  },
  "clickbank":   { "enabled": false, ... },
  "digistore24": { "enabled": false, ... },
  "appsumo":     { "enabled": false, ... },
  "whop":        { "enabled": false, ... }
}
```

**Why JSONB over columns:**
- Adding a new marketplace = one config entry, zero migrations.
- Per-marketplace config is bounded & uniform — no column sprawl.
- Indexed via GIN if we ever want to query "which marketplaces have tracking enabled".
- Single source of truth — no drift between code and DB.

**Why JSONB is safe here:** settings is a singleton row, writes are admin-only via service_role, reads are public. There is no need for per-field referential integrity.

### 4.4 Registry module

**New file:** `src/config/marketplaces.ts`

```ts
export type MarketplaceId = "jvzoo" | "warriorplus" | "clickbank" | "digistore24" | "appsumo" | "whop";

export interface MarketplaceConfig {
  id: MarketplaceId;
  path: string;                          // "/jvzoo"
  label: string;                         // "JVZoo"
  defaultEnabled: boolean;
  ctaUrl: string;                        // compliance-grade URL
  trackingPixelUrl: string | null;
  disclaimerText: string;
  branding: {
    accentHsl: string;                   // "hsl(217 91% 60%)"
    accentAltHsl?: string;               // gradient endpoint
    label: string;
  };
  seo: {
    title: string;
    description: string;
    keywords?: string;
  };
  /** Optional per-marketplace page override (e.g. for drastically different layouts) */
  pageComponent?: () => Promise<{ default: React.ComponentType<{ config: MarketplaceConfig }> }>;
}

export const MARKETPLACES: Record<MarketplaceId, MarketplaceConfig> = {
  jvzoo:        { /* current values */ },
  warriorplus:  { /* new */ },
  clickbank:    { /* placeholder, disabled by default */ },
  digistore24:  { /* placeholder, disabled by default */ },
  appsumo:      { /* placeholder, disabled by default */ },
  whop:         { /* placeholder, disabled by default */ },
};

export function getMarketplace(id: MarketplaceId): MarketplaceConfig { ... }
export function listEnabledMarketplaces(settings: { marketplace_registry: Record<string, MarketplaceEnabled> }): MarketplaceConfig[] { ... }
```

### 4.5 Reusable page layer

**New component:** `src/components/marketplace/MarketplacePage.tsx`

Generic page shell that:
- Reads `usePlatformSettings()` to get `marketplace_registry[marketplaceId]`
- Renders `<MarketplaceRouteGuard>` (handles the navigate("/") effect)
- Composes reusable sub-components: `<MarketplaceHero>`, `<MarketplaceFeatureGrid>`, `<MarketplacePricingSection>`, `<MarketplaceBonusesSection>`, `<MarketplaceFinalCTA>`, `<MarketplaceTrackingPixel>`, `<MarketplaceDisclaimer>`, `<MarketplaceSEO>`
- Each sub-component reads the same config — no per-marketplace duplication
- A marketplace can override **specific sections** by passing children, but the default layout is shared

**Per-marketplace page files** become thin wrappers:

```ts
// src/pages/public/CreatorOSPage.tsx  (refactored, ~30 lines)
export default function CreatorOSPage() {
  return <MarketplacePage config={MARKETPLACES.jvzoo} />;
}
```

```ts
// src/pages/public/WarriorPlusPage.tsx  (new, ~30 lines)
export default function WarriorPlusPage() {
  return <MarketplacePage config={MARKETPLACES.warriorplus} />;
}
```

This lets WarriorPlus **share structure** with JVZoo (hero, pricing, bonuses, CTA, tracking pixel, disclaimer, SEO) **without cloning** — sections are data-driven from the registry. Where WarriorPlus needs different copy or layout, it can either override the registry values (no code change) or pass `children` to specific section slots (small code change, no duplication).

### 4.6 Route layer — registry-driven

**Refactor:** `src/App.tsx`

Replace hand-rolled lazy routes with a generated set:

```tsx
{Object.values(MARKETPLACES).map((mp) => (
  <Route
    key={mp.id}
    path={mp.path}
    element={
      <ErrorBoundary name={`marketplace-${mp.id}`}>
        <Suspense fallback={<PageLoader />}>
          <mp.PageComponent config={mp} />
        </Suspense>
      </ErrorBoundary>
    }
  />
))}
```

This eliminates the per-marketplace `<Route>` entry.

### 4.7 Navigation layer — registry-driven

**Refactor:** `src/components/public/PublicNavbar.tsx`

Replace the hardcoded `BASE_LINKS` "JVZoo" entry with a registry-driven iteration:

```tsx
const marketplaceLinks = listEnabledMarketplaces(settings).map((mp) => ({
  label: mp.label,
  to: mp.path,
  requiresMarketplace: mp.id,
}));
const links = [...BASE_LINKS, ...marketplaceLinks].filter(/* existing requiresSetting logic */);
```

### 4.8 SEO layer — registry-driven

**Refactor:** `src/components/seo/PageSeo.tsx`

The `PAGE_SEO` Record grows from the registry:

```ts
export const PAGE_SEO: Record<string, PageSeoEntry> = Object.fromEntries(
  Object.values(MARKETPLACES).map((mp) => [mp.path, { title: mp.seo.title, description: mp.seo.description, keywords: mp.seo.keywords }])
);
```

And `<MarketplacePage>` renders `<PageSeo {...config.seo} canonicalPath={config.path} />` so SEO actually fires (fixing today's latent bug).

### 4.9 Settings hook layer

**Refactor:** `src/hooks/usePlatformSettings.ts`

Replace the long `.select(...)` column list with:
- A `.select(...)` that includes `marketplace_registry` (and the legacy columns we'll keep during migration for backward compatibility).
- Add a typed TypeScript view: `MarketplaceSettings = Record<MarketplaceId, MarketplaceEnabledState>`.

The hook returns both the legacy fields (so existing code keeps working) and the new `marketplace_registry` parsed view.

### 4.10 Admin UI layer

**New component:** `src/components/admin/MarketplaceSettingsCard.tsx`

Data-driven admin section:

```tsx
{Object.values(MARKETPLACES).map((mp) => (
  <MarketplaceToggleRow
    key={mp.id}
    label={mp.label}
    enabled={registry[mp.id]?.enabled ?? mp.defaultEnabled}
    demoVideoUrl={registry[mp.id]?.demo_video_url ?? ""}
    ctaUrl={registry[mp.id]?.cta_url ?? mp.ctaUrl}
    onToggle={(v) => updateRegistry(mp.id, { enabled: v })}
    onFieldChange={(field, val) => updateRegistry(mp.id, { [field]: val })}
  />
))}
```

This is **one card per marketplace, generated from the registry**. Adding `/clickbank` later requires:
- Add to `MARKETPLACES` registry
- Admin UI auto-renders the new toggle

No JSX edits needed.

### 4.11 Tracking & analytics — independent per marketplace

Each marketplace has:
- Its own tracking pixel URL (config-driven)
- Its own CTA URL (config-driven)
- A consistent place to inject marketplace-specific analytics events (`window.dataLayer.push({ event: 'marketplace_cta_click', marketplace: 'warriorplus' })`)
- SEO metadata independent of other marketplaces

---

## 5. Database Impact

### 5.1 New column

```sql
alter table public.platform_settings
  add column if not exists marketplace_registry jsonb
    not null default '{}'::jsonb;
```

### 5.2 Backfill (seed defaults)

Migration script populates `marketplace_registry` from the existing per-marketplace columns:

```sql
update public.platform_settings
set marketplace_registry = jsonb_build_object(
  'jvzoo', jsonb_build_object(
    'enabled', creator_os_page_enabled,
    'demo_video_url', creator_os_demo_video_url,
    'cta_url', '<hardcoded JVZoo URL>',
    'tracking_pixel_url', '<hardcoded JVZoo pixel URL>',
    'disclaimer_text', '<hardcoded JVZoo disclaimer>'
  ),
  'warriorplus', jsonb_build_object(
    'enabled', false,
    'demo_video_url', null,
    'cta_url', '<hardcoded WarriorPlus URL>',
    'tracking_pixel_url', null,
    'disclaimer_text', '<WarriorPlus placeholder>'
  )
)
where marketplace_registry = '{}'::jsonb;
```

### 5.3 Legacy column policy

Two options, recommend **Option A**:

**Option A — Keep legacy columns read-only, write new code against JSONB.**
- Pro: zero-risk migration, old admin UI keeps working during cutover.
- Con: schema has both representations temporarily.

**Option B — Drop legacy columns after cutover.**
- Pro: clean schema.
- Con: requires admin UI rollout + cutover plan.

Recommend **Option A** with a follow-up cleanup migration.

### 5.4 RLS

No change. The existing policies (public SELECT, service_role ALL) apply to the new column automatically.

---

## 6. Route Impact

| Current | New |
|---|---|
| `/jvzoo` (hardcoded `<Route>`) | `/jvzoo` (registry-generated) |
| `/jvzooaffiliate` (hardcoded) | `/launch-partners` (kept, since it's the affiliate landing not JVZoo-specific) |
| `/launch-partners` (hardcoded) | `/launch-partners` (kept) |
| (none) | `/warriorplus` (new, registry-generated) |

**Lazy load keys** — `lazyWithRetry(name)` becomes `lazyWithRetry(`marketplace-${mp.id}`)`.

**NotFound handling** — `/warriorplus` will return the standard `<NotFound />` only if removed from the registry. Registry removal = route removal. Clean.

---

## 7. Admin Settings Impact

### Before

- One `<SectionCard>` titled "Marketing / Launch Controls" with `creator_os_page_enabled` toggle + demo video URL field (AdminDashboard.tsx ~1980–2023).
- One `<SectionCard>` titled "Public Page Controls" with `jvzoo_affiliate_enabled`, resource vault, demo video, CTA URL, button text, login URL fields (AdminDashboard.tsx ~2025–2080).
- Mixed semantics — some are "is this page visible", some are "what does this page say".

### After

- One `<SectionCard>` titled **"Marketplace Pages"** with a data-driven grid/list of marketplaces. Each row:
  ```
  ✓ JVZoo           [toggle]   [expand for: demo video URL, CTA URL, button text]
  ✓ WarriorPlus     [toggle]   [expand for: ...]
  ✗ ClickBank       [toggle]   [expand for: ...]
  ✗ Digistore24     [toggle]   [expand for: ...]
  ✗ AppSumo         [toggle]   [expand for: ...]
  ✓ Whop            [toggle]   [expand for: ...]
  ```
- The "Resource Vault" toggle stays as its own section (it's not a marketplace).
- Launch Partners / affiliate program gets its own section, renamed to clarify it's a generic affiliate program, not JVZoo-specific.

The Admin UI reduces from ~100 lines of hand-rolled JSX to ~30 lines of registry-driven JSX.

---

## 8. Component Structure (final state)

```
src/
├── config/
│   └── marketplaces.ts                    ← REGISTRY (new)
│
├── components/
│   ├── marketplace/                       ← NEW shared dir
│   │   ├── MarketplacePage.tsx            ← Generic page shell
│   │   ├── MarketplaceRouteGuard.tsx      ← Visibility + redirect
│   │   ├── MarketplaceHero.tsx            ← Reusable hero block
│   │   ├── MarketplaceFeatureGrid.tsx     ← Reusable feature grid
│   │   ├── MarketplacePricingSection.tsx  ← Reusable pricing block
│   │   ├── MarketplaceBonusesSection.tsx  ← Reusable bonuses block
│   │   ├── MarketplaceFinalCTA.tsx        ← Reusable CTA + tracking pixel + disclaimer
│   │   ├── MarketplaceTrackingPixel.tsx   ← Generic tracking pixel (config-driven URL)
│   │   ├── MarketplaceDisclaimer.tsx      ← Generic disclaimer (config-driven text)
│   │   ├── MarketplaceSEO.tsx             ← Thin wrapper around <PageSeo>
│   │   └── MarketplaceDemoVideo.tsx       ← Reusable video embed resolver (already exists in pages today)
│   │
│   ├── admin/
│   │   └── MarketplaceSettingsCard.tsx    ← NEW: registry-driven admin UI
│   │
│   ├── public/
│   │   ├── PublicNavbar.tsx               ← MODIFIED: iterates registry
│   │   ├── JVZooCTA.tsx                   ← DELETED (replaced by MarketplaceFinalCTA)
│   │   ├── JVZooTrackingPixel.tsx         ← DELETED
│   │   └── JVZooDisclaimer.tsx            ← DELETED
│   │
│   └── seo/
│       └── PageSeo.tsx                    ← MODIFIED: registry-driven PAGE_SEO
│
├── pages/
│   └── public/
│       ├── CreatorOSPage.tsx              ← REFACTORED: thin wrapper (~30 lines)
│       ├── WarriorPlusPage.tsx            ← NEW: thin wrapper (~30 lines)
│       └── LaunchPartnersPage.tsx         ← UNCHANGED (separate feature)
│
├── hooks/
│   └── usePlatformSettings.ts             ← MODIFIED: returns parsed marketplace_registry
│
├── types/
│   └── platform-config.ts                 ← MODIFIED: add MarketplaceEnabledState type, keep legacy for compat
│
└── App.tsx                                ← MODIFIED: registry-driven marketplace routes

supabase/migrations/
└── 2026XXXX_marketplace_registry.sql      ← NEW: add JSONB column + backfill

scripts/sql/bootstrap_platform_settings.sql  ← MODIFIED: include new column
```

---

## 9. Migration / Cutover Plan

### Phase 0 — Pre-flight (read-only)
1. Confirm with stakeholders: WarriorPlus URL, pixel URL, disclaimer text, branding color.
2. Verify the existing `creator_os_page_enabled` actually maps to `/jvzoo` (vs the misnamed `jvzoo_affiliate_enabled`).

### Phase 1 — Schema (no code change)
1. Write SQL migration `add_marketplace_registry_jsonb.sql`:
   - Add `marketplace_registry jsonb not null default '{}'::jsonb`
   - Backfill from existing columns + hardcoded constants
2. Verify via `select marketplace_registry from platform_settings;`

### Phase 2 — Read path (additive, no break)
1. Add `MarketplaceConfig` type and `MARKETPLACES` registry at `src/config/marketplaces.ts`.
2. Update `usePlatformSettings()` to return parsed `marketplace_registry`.
3. Add `MarketplaceRouteGuard` and `MarketplacePage` shell.
4. Wire `/warriorplus` route to a new thin `WarriorPlusPage` wrapper.
5. Add a navbar entry that reads from the registry.
6. Verify both `/jvzoo` and `/warriorplus` render with the existing functionality intact.

### Phase 3 — Cutover (refactor)
1. Replace hardcoded `JVZooCTA` / `JVZooTrackingPixel` / `JVZooDisclaimer` imports in `CreatorOSPage` with the shared `Marketplace*` components.
2. Replace hardcoded `JVZOO_*` constants with registry lookups.
3. Refactor `CreatorOSPage` to be a thin wrapper around `MarketplacePage`.

### Phase 4 — Admin UI cutover
1. Build `MarketplaceSettingsCard` from the registry.
2. Add to AdminDashboard alongside (not replacing) the existing controls.
3. Verify admin can toggle `/jvzoo` and `/warriorplus` independently via the new card.
4. Remove the legacy hand-rolled admin sections once parity is confirmed.

### Phase 5 — Cleanup
1. Remove the deprecated `JVZooCTA.tsx`, `JVZooTrackingPixel.tsx`, `JVZooDisclaimer.tsx` files.
2. (Optional) Drop the legacy `creator_os_*` and `jvzoo_affiliate_*` columns in a follow-up migration once all admin UI reads from JSONB.
3. Update `bootstrap_platform_settings.sql` so a fresh install creates the registry with all six marketplaces.

---

## 10. Step-by-Step Implementation Plan (after approval)

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | Add JSONB column + backfill migration | `supabase/migrations/2026XXXX_*.sql` | `select marketplace_registry from platform_settings;` returns object with jvzoo + warriorplus |
| 2 | Add `MarketplaceConfig` type + registry | `src/config/marketplaces.ts` (new) | `bun run build` (type check) |
| 3 | Extend `usePlatformSettings` to return parsed registry | `src/hooks/usePlatformSettings.ts`, `src/types/platform-config.ts` | `bun run test` |
| 4 | Build `MarketplaceRouteGuard` | `src/components/marketplace/MarketplaceRouteGuard.tsx` (new) | Unit test: passes through when enabled, redirects when disabled |
| 5 | Build reusable `Marketplace*` components | `src/components/marketplace/*.tsx` (new) | Visual parity with current `/jvzoo` |
| 6 | Add `/warriorplus` thin wrapper + route | `src/pages/public/WarriorPlusPage.tsx` (new), `src/App.tsx` | `curl localhost:5173/warriorplus` returns page |
| 7 | Registry-driven navbar | `src/components/public/PublicNavbar.tsx` | `/jvzoo` link still appears; `/warriorplus` link appears when enabled |
| 8 | Registry-driven SEO | `src/components/seo/PageSeo.tsx` | View source on `/warriorplus` shows correct meta tags |
| 9 | Admin `MarketplaceSettingsCard` | `src/components/admin/MarketplaceSettingsCard.tsx` (new), `src/pages/AdminDashboard.tsx` | Admin can toggle both marketplaces independently; `/jvzoo` and `/warriorplus` react to toggles |
| 10 | Refactor `CreatorOSPage` to use shared components | `src/pages/public/CreatorOSPage.tsx`, delete `src/components/public/JVZooCTA.tsx`, `JVZooTrackingPixel.tsx`, `JVZooDisclaimer.tsx` | Visual + functional parity with current `/jvzoo` |
| 11 | Cleanup legacy admin controls + bootstrap SQL | `src/pages/AdminDashboard.tsx`, `scripts/sql/bootstrap_platform_settings.sql` | Fresh install creates all 6 marketplace entries with safe defaults |
| 12 | E2E verification | All | Manual: load `/jvzoo`, `/warriorplus`, admin toggles both, navbar updates, tracking pixels fire |

---

## 11. Risks & Open Questions

### Risks

1. **JSONB validation drift** — schema is now in code, not in DB. Mitigation: Zod-validate `marketplace_registry` in `usePlatformSettings` queryFn.
2. **Realtime broadcast size** — JSONB column will broadcast the whole registry on any settings update. Mitigation: settings writes are rare (admin only); not a perf concern in practice.
3. **Bundle size** — generic components live in every marketplace bundle. Mitigation: lazy-load each marketplace page via `lazyWithRetry`, code-split as today.
4. **SEO regression** — refactoring risks losing existing meta tags. Mitigation: snapshot current `/jvzoo` HTML, diff after refactor.
5. **Backward compatibility** — existing admin UI edits the legacy columns. Mitigation: dual-write (save to both legacy columns and JSONB) during Phase 4, drop legacy in Phase 5.

### Open questions for the user

1. **WarriorPlus URL & pixel** — do you have the official WarriorPlus checkout link and tracking pixel URL yet, or should we use placeholders?
2. **WarriorPlus branding color** — pick a hue (orange/red is common for WarriorPlus) or default to neutral until brand assets land?
3. **WarriorPlus-specific sections** — does WarriorPlus need different bonuses, different pricing tiers, or a different hero than JVZoo? (This determines whether `<MarketplacePage>` defaults are enough or per-marketplace overrides are needed.)
4. **Launch Partners / affiliate program** — keep it as a single shared `/launch-partners` route, or split per marketplace (`/jvzoo-affiliate`, `/warriorplus-affiliate`)? The current naming suggests it was intended to be JVZoo-specific but actually isn't.
5. **Tracking pixel toggle** — should each marketplace's pixel be admin-controllable (on/off), or always-on for compliance?
6. **Cutover tolerance** — is the team OK with a transitional state where both legacy columns and JSONB exist (recommended), or do you want a hard cutover on the same day?

---

## 12. Approval Gate

This is a **planning artifact only**. No files have been modified. Awaiting explicit approval before any implementation begins.

Recommended next action: review sections 4 (architecture), 9 (migration plan), 10 (implementation steps), and 11 (open questions). Answer the open questions in section 11 so the implementation plan can be tightened.

