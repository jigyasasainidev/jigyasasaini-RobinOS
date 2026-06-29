# Marketplace Audit & WarriorPlus Architecture — June 29, 2026

**Status:** Audit + design only. No code modified. Awaiting approval.
**Goal:** Add an independent `/warriorplus` marketplace sales page that coexists with `/jvzoo` and is supported by a reusable, future-ready multi-marketplace architecture.
**Author:** This audit was produced by re-reading every relevant file in the repo on 2026-06-29 and cross-checking against the existing prior audit at `.kimchi/docs/marketplace-architecture-audit.md`. New findings are flagged with **[NEW]**.

---

## 0. TL;DR

RobinOS has exactly **one** marketplace sales page today (`/jvzoo`) and **one** affiliate landing page (`/launch-partners`, aliased `/jvzooaffiliate`). The `/jvzoo` hide/unhide toggle works for normal users but is enforced **only client-side via an in-page `useEffect → navigate("/")`**, with no router-level guard and no server-side check. Footer link, `robots.txt`, `sitemap.xml`, tracking pixel, and stale tabs leak the page even when "hidden". **[NEW]**

Three JVZoo-specific components (`JVZooCTA`, `JVZooTrackingPixel`, `JVZooDisclaimer`) hardcode the JVZoo checkout URL, pixel URL, and disclaimer text. The page itself is a 649-line monolith with no reusable sections. Adding `/warriorplus` via the current pattern would require ~12 file edits (SQL, types, hook, page copy, three new components, route, navbar, SEO, robots, sitemap, admin UI). **[NEW]**

The recommended architecture is a **registry-driven design**: a single `src/config/marketplaces.ts` defines every marketplace, with one SQL JSONB column (`marketplace_registry`) replacing per-marketplace columns, one `<MarketplacePage>` shell composing reusable `<MarketplaceHero>`/`<MarketplacePricingSection>`/`<MarketplaceFinalCTA>`/etc. sub-components, one registry-driven admin card, and a registry-driven navbar. `/warriorplus` (and future `/clickbank`, `/digistore24`, `/appsumo`, `/whop`) becomes a thin wrapper plus one registry entry — zero component duplication.

This audit was produced alongside (and cross-validates) the prior `.kimchi/docs/marketplace-architecture-audit.md`. Where this document agrees with the prior audit, it cites it; where it adds new findings, it flags them **[NEW]**.

---

## 1. Current Architecture Audit

### 1.1 Files involved in `/jvzoo`

| Layer | Path | Role |
|---|---|---|
| Route | `src/App.tsx:69, 258` | Lazy-imports `CreatorOSPage`, mounts it at `/jvzoo` (no guard) |
| Page | `src/pages/public/CreatorOSPage.tsx` (649 lines) | The full sales page; gates itself with `creator_os_page_enabled` |
| CTA component | `src/components/public/JVZooCTA.tsx` | Hardcoded `JVZOO_CTA_DESTINATION = "https://www.jvzoo.com/b/0/442467/99"` |
| Tracking pixel | `src/components/public/JVZooTrackingPixel.tsx` | Hardcoded `JVZOO_TRACKING_PIXEL_URL = "https://i.jvzoo.com/0/442467/99"` |
| Disclaimer | `src/components/public/JVZooDisclaimer.tsx` | Hardcoded `JVZOO_DISCLAIMER_TEXT` placeholder |
| Settings hook | `src/hooks/usePlatformSettings.ts` | React Query fetch of `platform_settings` row + realtime invalidation |
| Types | `src/types/platform-config.ts` (137 lines) | `PlatformSettingsRow`, `PlatformSettingsDraft`, `PlatformSettingsLive`, `PLATFORM_SETTINGS_DEFAULTS` |
| Navbar | `src/components/public/PublicNavbar.tsx:9, 30-40` | `BASE_LINKS` filter with `requiresSetting` |
| Footer | `src/components/public/PublicFooter.tsx:6-13` | `productLinks` — **no gating, always shows `/jvzoo`** **[NEW]** |
| SEO | `src/components/seo/PageSeo.tsx:106-109` | `PAGE_SEO["/jvzoo"]` entry — **defined but never rendered** **[NEW]** |
| Admin UI | `src/pages/AdminDashboard.tsx:861-914, 1335-1372, 1980-2070` | Settings draft, save payload, visibility toggle UI |
| SQL | `scripts/sql/bootstrap_platform_settings.sql` sections 2-3 + `supabase/migrations/23_*.sql`, `24_*.sql`, `25_*.sql` | Adds `creator_os_*` and `jvzoo_affiliate_*` columns |
| Robots | `public/robots.txt:31` | `Allow: /jvzoo` — **always, even when hidden** **[NEW]** |
| Sitemap | `public/sitemap.xml:275-279` | `/jvzoo` at priority 0.9 — **always, even when hidden** **[NEW]** |

### 1.2 Files involved in the hide/unhide mechanism

The hide/unhide flow uses the same path as every other setting:

1. **DB** — `public.platform_settings` singleton row, column `creator_os_page_enabled boolean default true`
2. **Hook** — `usePlatformSettings()` (React Query key `["platform-settings-live-v1"]`, `staleTime: 15s`, realtime via `subscribePostgresChanges`)
3. **Enforcement** — Inside the page (no router guard):
   ```tsx
   useEffect(() => {
     if (!isLoading && settings && settings.creator_os_page_enabled === false) {
       navigate("/", { replace: true });
     }
   }, [settings, isLoading, navigate]);
   if (isLoading) return null;
   if (settings && settings.creator_os_page_enabled === false) return null;
   ```
4. **Navbar** — `PublicNavbar.tsx` filters the `/jvzoo` link out when the flag is `false`.

### 1.3 Critical naming observation (also in prior audit §1.3)

Two distinct JVZoo-named flags control two different routes:

| Flag | Default | Route gated | Page |
|---|---|---|---|
| `creator_os_page_enabled` | `true` | `/jvzoo` | `CreatorOSPage` |
| `jvzoo_affiliate_enabled` | `false` | `/launch-partners` (also `/jvzooaffiliate`) | `LaunchPartnersPage` |

The second flag is mis-named — it gates a generic launch-partners landing, not a JVZoo-specific affiliate program. This will create confusion when `/warriorplus` is added.

### 1.4 Routing map for public pages (relevant extracts from `src/App.tsx`)

| Path | Element | Guard |
|---|---|---|
| `/` | `<EntryPage />` | none |
| `/pricing` | `<EntryPage initialSection="pricing" />` | none |
| `/login` | `<AuthPage />` | none |
| `/dashboard/*` | `<DashboardLayout />` (auth-gated by layout) | (auth) |
| `/adminsh/*` | `<AdminDashboard />` | `<AdminRouteGuard>` |
| `/resources` | `<ResourceVaultPage />` | `<VaultRouteGuard>` (`resource_vault_enabled`) |
| `/resources/:slug` | `<ResourceDetailPage />` | `<VaultRouteGuard>` |
| **`/jvzoo`** | **`<CreatorOSPage />`** | **none at route level — enforced inside page** |
| `/jvzooaffiliate` | `<LaunchPartnersPage />` | none |
| `/launch-partners` | `<LaunchPartnersPage />` | none |
| `/blog`, `/blog/:slug` | `<BlogPage>`, `<BlogPostPage>` | none |
| (other `/about`, `/contact`, `/privacy`, ...) | matching `PublicInfoPages.*` | none |

### 1.5 `platform_settings` table schema (full)

All columns, from `scripts/sql/bootstrap_platform_settings.sql` and additive migrations:

| # | Column | Type | Default | Migration |
|---|---|---|---|---|
| 1 | `id` | `uuid PK` | `gen_random_uuid()` | section 1 |
| 2 | `creator_price` | `numeric not null` | `19` | section 1 |
| 3 | `pro_price` | `numeric not null` | `39` | section 1 |
| 4 | `agency_price` | `numeric not null` | `99` | section 1 |
| 5 | `free_scripts_limit` | `integer not null` | `3` | section 1 |
| 6 | `free_scans_limit` | `integer not null` | `20` | section 1 |
| 7 | `affiliate_commission_percent` | `numeric not null` | `30` | section 1 |
| 8 | `minimum_withdrawal` | `numeric not null` | `25` | section 1 |
| 9 | `payout_delay_days` | `integer not null` | `7` | section 1 |
| 10 | `maintenance_mode` | `boolean not null` | `false` | section 1 |
| 11 | `announcement_banner` | `text` | `null` | section 1 |
| 12 | `platform_domain` | `text` | `null` | section 1 |
| 13 | `support_email` | `text` | `null` | section 1 |
| 14 | `created_at` | `timestamptz not null` | `now()` | section 1 |
| 15 | `updated_at` | `timestamptz not null` | `now()` | section 1 |
| 16 | `creator_os_page_enabled` | `boolean not null` | `true` | 23 |
| 17 | `creator_os_demo_video_url` | `text` | `null` | 23 |
| 18 | `jvzoo_affiliate_enabled` | `boolean not null` | `false` | 24 |
| 19 | `jvzoo_affiliate_demo_video_url` | `text` | `null` | 24 |
| 20 | `jvzoo_affiliate_cta_url` | `text` | `null` | 24 (dead — see §3.8) **[NEW]** |
| 21 | `jvzoo_affiliate_button_text` | `text` | `'Join Affiliate Program'` | 24 |
| 22 | `jvzoo_affiliate_login_url` | `text` | `'https://www.tryrobin.xyz/login'` | 25 |
| 23 | `affiliate_resources_url` | `text` | `null` | 46 |
| 24 | `resource_vault_enabled` | `boolean not null` | `true` | 48 |

RLS: `public SELECT true` + `service_role ALL`.

### 1.6 Data flow (textual)

```
[ Supabase: public.platform_settings (singleton row) ]
            │ REST select + Postgres realtime
            ▼
[ usePlatformSettings() — React Query, key="platform-settings-live-v1",
                          staleTime=15s, realtime invalidate ]
            │ { data: settings, isLoading }
            ├──► CreatorOSPage.tsx       → uses creator_os_page_enabled + creator_os_demo_video_url
            │                                in-page useEffect redirect + render guard
            ├──► LaunchPartnersPage.tsx  → uses jvzoo_affiliate_enabled + jvzoo_affiliate_*
            │                                in-page useEffect redirect + render guard
            ├──► PublicNavbar.tsx        → filters /jvzoo link via requiresSetting
            ├──► PublicFooter.tsx        → /jvzoo link is NOT gated (bug)         [NEW]
            ├──► PublicLayout.tsx        → maintenance banner
            ├──► VaultRouteGuard (App.tsx:141) → /resources/* guard
            └──► AdminDashboard.tsx      → hydrates settingsDraft, save persists + invalidates
```

**Side channels (hardcoded, not in flow):**
- `JVZOO_CTA_DESTINATION` (`JVZooCTA.tsx:7`)
- `JVZOO_TRACKING_PIXEL_URL` (`JVZooTrackingPixel.tsx:2`)
- `JVZOO_DISCLAIMER_TEXT` (`JVZooDisclaimer.tsx:3`)
- `PAGE_SEO["/jvzoo"]` (`PageSeo.tsx:106`) — defined but not rendered **[NEW]**

---

## 2. Current Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       SUPABASE                                   │
│  public.platform_settings                                        │
│  ┌────────────────────────────────────────────────────────┐      │
│  │ creator_os_page_enabled        boolean default true    │      │
│  │ creator_os_demo_video_url      text                     │      │
│  │ jvzoo_affiliate_enabled        boolean default false   │      │
│  │ jvzoo_affiliate_demo_video_url text                     │      │
│  │ jvzoo_affiliate_cta_url        text  ← DEAD (unread)   │      │
│  │ jvzoo_affiliate_button_text    text                     │      │
│  │ jvzoo_affiliate_login_url      text                     │      │
│  │ resource_vault_enabled         boolean default true    │      │
│  │ maintenance_mode               boolean                  │      │
│  │ announcement_banner            text                     │      │
│  │ (creator_price, pro_price, ...)                        │      │
│  └────────────────────────────────────────────────────────┘      │
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
            │              │              │                          │
            ▼              ▼              ▼                          ▼
       navigate("/")   navigate("/")   hide link           navigate("/")
       (in-page)       (in-page)       when false          (route-level)
```

**Hardcoded side-channels (not in main flow):**
- `JVZooCTA` → `https://www.jvzoo.com/b/0/442467/99` (constant)
- `JVZooTrackingPixel` → `https://i.jvzoo.com/0/442467/99` (constant)
- `PAGE_SEO["/jvzoo"]` exists but `<PageSeo>` is not rendered in `CreatorOSPage`
- `robots.txt` Allow + `sitemap.xml` entry are static

---

## 3. Problems in the Current Implementation

### 3.1 No abstraction layer (prior audit §3.1)
JVZoo appears by name in three component files, two constant strings, four admin fields, and three SQL migrations. No `Marketplace` type, no `MarketplaceConfig`, no registry.

### 3.2 Schema duplication (prior audit §3.2)
Each marketplace needs ~5 columns. With 6 marketplaces this is ~25+ columns on a singleton row, growing linearly.

### 3.3 Settings hydration is per-column (prior audit §3.3)
`usePlatformSettings.ts:38` has a long `.select(...)` string; every new flag touches 3 files.

### 3.4 Admin UI is hand-rolled per flag (prior audit §3.4)
Each new flag = new JSX block. No data-driven rendering.

### 3.5 Visibility gating pattern is repeated, not extracted (prior audit §3.5)
The same `useEffect → navigate("/")` block appears in every gated page. No `<MarketplaceRouteGuard>` exists.

### 3.6 Navbar requires explicit per-link config (prior audit §3.6)
`BASE_LINKS` array in `PublicNavbar.tsx` requires `requiresSetting` on every conditional link.

### 3.7 SEO is path-keyed with no shared template (prior audit §3.7)
`PAGE_SEO` is a flat Record keyed by literal path string. No factory for marketplaces.

### 3.8 Dead/disconnected SEO **[NEW]**
`PAGE_SEO["/jvzoo"]` is defined (`PageSeo.tsx:106-109`) but `CreatorOSPage.tsx` does not render `<PageSeo>` anywhere (grep confirms: 0 matches for `PageSeo`, `Helmet`, `react-helmet-async` in `CreatorOSPage.tsx`). SEO metadata for `/jvzoo` is effectively absent.

### 3.9 Naming inconsistency (prior audit §3.9)
`jvzoo_affiliate_enabled` controls `/launch-partners`, not a JVZoo-specific affiliate page.

### 3.10 Tracking pixel is not gated
`<JVZooTrackingPixel />` always renders at the bottom of `CreatorOSPage`. No setting controls it. **[NEW]** Tracking continues to fire even when the page is "hidden" between the render and the `useEffect` redirect.

### 3.11 Checkout URL is hardcoded, not in settings (prior audit §3.11)
`JVZOO_CTA_DESTINATION` is a module constant. Admin UI has a `jvzoo_affiliate_cta_url` field, but it's never read by code — see §3.12.

### 3.12 `jvzoo_affiliate_cta_url` is dead code **[NEW]**
DB column exists, type covers it, admin UI lets you edit it, save payload includes it, `PlatformSettingsLive` exposes it. But **no consuming component reads it** (grep across `src/` and `api/` returns zero non-admin reads). The page uses the hardcoded `JVZooCTA` constant instead.

### 3.13 Footer `/jvzoo` link is always visible **[NEW]**
`PublicFooter.tsx:6-13` — `productLinks` is a module-level constant with no `requiresSetting` filter. When admin hides `/jvzoo`, the footer still says "Creator OS → /jvzoo" and the user is silently bounced to `/`. The link looks broken.

### 3.14 Navbar `/launch-partners` link is always visible **[NEW]**
`PublicNavbar.tsx:13` lists `/launch-partners` without `requiresSetting`. When `jvzoo_affiliate_enabled = false`, the link still appears but the page redirects to `/`. Same UX bug as §3.13.

### 3.15 `robots.txt` and `sitemap.xml` are not gated **[NEW]**
Both static files always list `/jvzoo` at full priority, regardless of `creator_os_page_enabled`. Search engines and crawlers can index a "hidden" page.

### 3.16 No server-side enforcement **[NEW]**
Edge functions and Supabase are not consulted when serving `/jvzoo`. `api/` has zero JVZoo handlers. A non-JS crawler or stale cache sees whatever Vercel serves for `index.html`. The hide/unhide toggle is purely client-side JS.

### 3.17 Admin UI labels are inconsistent **[NEW]**
`AdminDashboard.tsx:1988` titles the Creator OS section `"Marketing / Launch Controls"`; `:2013` titles the affiliate section `"Public Page Controls"`. Same feature (marketplace visibility), two different visual groupings, no cross-link.

### 3.18 `/jvzooaffiliate` alias is unused legacy **[NEW]**
`App.tsx:259` defines `<Route path="/jvzooaffiliate" element={<LaunchPartnersPage />} />`. Not in `robots.txt`, not in `sitemap.xml`, zero inbound links in the codebase. Likely a leftover alias.

### 3.19 `usePlatformSettings` reads fields no page consumes **[NEW]**
The `.select(...)` pulls `jvzoo_affiliate_cta_url` (dead, §3.12) plus pricing columns read by other hooks (`EntryPage`, `UpgradeDialog`). The live consumer set is smaller than the schema set.

---

## 4. Recommended Scalable Architecture

### 4.1 Core principle: **Registry over hardcoding**

A single typed config object — `MARKETPLACES: Record<MarketplaceId, MarketplaceConfig>` — describes every marketplace. The registry holds:

- Route path
- Display label + branding accent
- CTA URL, tracking pixel URL, disclaimer text
- SEO defaults (title, description, keywords)
- Default enabled/disabled state
- Section overrides (optional, for marketplaces that need bespoke layouts)

Everything else (page rendering, route generation, navbar, SEO, admin UI) iterates the registry.

### 4.2 Target directory layout

```
src/
├── config/
│   └── marketplaces.ts                    ← NEW: REGISTRY
│
├── components/
│   ├── marketplace/                       ← NEW shared directory
│   │   ├── MarketplacePage.tsx            ← Generic page shell
│   │   ├── MarketplaceRouteGuard.tsx      ← Visibility + redirect
│   │   ├── MarketplaceHero.tsx
│   │   ├── MarketplaceWorkflow.tsx
│   │   ├── MarketplaceFeatureGrid.tsx
│   │   ├── MarketplaceSecondaryBlock.tsx
│   │   ├── MarketplaceOutputsGrid.tsx
│   │   ├── MarketplaceUseCases.tsx
│   │   ├── MarketplaceFeatureList.tsx
│   │   ├── MarketplaceDemoVideo.tsx
│   │   ├── MarketplaceWhy.tsx
│   │   ├── MarketplaceFinalCTA.tsx
│   │   ├── MarketplaceTrackingPixel.tsx   ← Config-driven URL
│   │   ├── MarketplaceDisclaimer.tsx      ← Config-driven text
│   │   └── MarketplaceSEO.tsx
│   │
│   ├── admin/
│   │   └── MarketplaceSettingsCard.tsx    ← NEW: registry-driven admin UI
│   │
│   ├── public/
│   │   ├── PublicNavbar.tsx               ← MODIFIED: registry-driven
│   │   ├── PublicFooter.tsx               ← MODIFIED: registry-driven (fixes §3.13)
│   │   └── (JVZooCTA / JVZooTrackingPixel / JVZooDisclaimer → DELETED)
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
│   └── platform-config.ts                 ← MODIFIED: add MarketplaceConfig types
│
└── App.tsx                                ← MODIFIED: registry-driven marketplace routes

supabase/migrations/
└── 2026XXXX_marketplace_registry.sql      ← NEW: JSONB column + backfill

scripts/sql/bootstrap_platform_settings.sql  ← MODIFIED: include marketplace_registry column
public/robots.txt                            ← MODIFIED: build-time generated (or kept static, see Q below)
public/sitemap.xml                           ← MODIFIED: build-time generated (or kept static)
```

### 4.3 Registry shape

```ts
// src/config/marketplaces.ts
export type MarketplaceId =
  | "jvzoo" | "warriorplus" | "clickbank"
  | "digistore24" | "appsumo" | "whop";

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
    accentAltHsl?: string;
  };
  seo: {
    title: string;
    description: string;
    keywords?: string;
  };
  /** Optional copy overrides — data only, no JSX. */
  copyOverrides?: Partial<{
    heroEyebrow: string;
    heroHeadline: string;
    heroSubhead: string;
    features: { title: string; description: string }[];
  }>;
}
```

### 4.4 Database: JSONB over per-marketplace columns

```sql
alter table public.platform_settings
  add column if not exists marketplace_registry jsonb
    not null default '{}'::jsonb;
```

JSONB shape (validated by Zod in `usePlatformSettings`):
```jsonc
{
  "jvzoo":       { "enabled": true,  "demo_video_url": "...", "cta_url": "...", ... },
  "warriorplus": { "enabled": false, "demo_video_url": null,  "cta_url": "...", ... },
  "clickbank":   { "enabled": false, ... },
  "digistore24": { "enabled": false, ... },
  "appsumo":     { "enabled": false, ... },
  "whop":        { "enabled": false, ... }
}
```

JSONB is safe because `platform_settings` is a singleton row, writes are admin-only via `service_role`, reads are public. No referential integrity is needed.

### 4.5 Reusable page shell

```tsx
// src/components/marketplace/MarketplacePage.tsx
export function MarketplacePage({ config }: { config: MarketplaceConfig }) {
  const live = useMarketplaceLiveSettings(config.id); // from usePlatformSettings().marketplace_registry[config.id]
  return (
    <PublicLayout>
      <MarketplaceSEO config={config} />
      <MarketplaceRouteGuard enabled={live.enabled}>
        <MarketplaceHero config={config} live={live} />
        <MarketplaceWorkflow config={config} />
        <MarketplaceFeatureGrid config={config} />
        <MarketplaceSecondaryBlock config={config} />
        <MarketplaceOutputsGrid config={config} />
        <MarketplaceUseCases config={config} />
        <MarketplaceFeatureList config={config} />
        <MarketplaceDemoVideo url={live.demo_video_url} />
        <MarketplaceWhy config={config} />
        <MarketplaceFinalCTA config={config} />
        <MarketplaceTrackingPixel config={config} />
        <MarketplaceDisclaimer config={config} />
      </MarketplaceRouteGuard>
    </PublicLayout>
  );
}
```

Each page becomes a thin wrapper:
```tsx
// src/pages/public/CreatorOSPage.tsx  (~30 lines)
export default function CreatorOSPage() {
  return <MarketplacePage config={MARKETPLACES.jvzoo} />;
}

// src/pages/public/WarriorPlusPage.tsx  (NEW, ~30 lines)
export default function WarriorPlusPage() {
  return <MarketplacePage config={MARKETPLACES.warriorplus} />;
}
```

Where WarriorPlus needs different copy or layout, it can:
1. Override **data only** via `copyOverrides` on the registry (no code change), or
2. Pass `children` slots to specific `<MarketplacePage>` sections (small code change, no duplication).

### 4.6 Registry-driven routing

```tsx
// src/App.tsx
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

This eliminates per-marketplace `<Route>` and lazy import entries. `mp.PageComponent` is an optional override registered alongside the config — defaults to a `<MarketplacePage config={mp} />` wrapper.

### 4.7 Registry-driven navbar + footer

```tsx
// PublicNavbar.tsx
const marketplaceLinks = useMemo(
  () => listEnabledMarketplaces(settings).map((mp) => ({
    label: mp.label, to: mp.path, requiresMarketplace: mp.id,
  })),
  [settings],
);
const links = [...BASE_LINKS, ...marketplaceLinks].filter(/* existing requiresSetting logic */);
```

`PublicFooter.tsx` gets the same treatment, fixing §3.13.

### 4.8 Registry-driven SEO

```tsx
// PageSeo.tsx
export const PAGE_SEO: Record<string, PageSeoEntry> = {
  ...Object.fromEntries(
    Object.values(MARKETPLACES).map((mp) => [mp.path, {
      title: mp.seo.title,
      description: mp.seo.description,
      keywords: mp.seo.keywords,
    }]),
  ),
  /* non-marketplace entries */
};
```

`<MarketplacePage>` renders `<PageSeo {...config.seo} canonicalPath={config.path} />`, fixing the dormant SEO bug (§3.8).

### 4.9 Registry-driven admin UI

```tsx
// src/components/admin/MarketplaceSettingsCard.tsx
export function MarketplaceSettingsCard() {
  const { registry, updateRegistry } = useMarketplaceRegistry();
  return (
    <SectionCard title="Marketplace Pages">
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
    </SectionCard>
  );
}
```

This is one card per marketplace, generated from the registry. Adding `/clickbank` later requires only an entry in `MARKETPLACES` — admin UI auto-renders the new toggle.

---

## 5. Database Impact

### 5.1 New column

```sql
-- supabase/migrations/2026XXXX_marketplace_registry.sql
alter table public.platform_settings
  add column if not exists marketplace_registry jsonb
    not null default '{}'::jsonb;
```

### 5.2 Backfill

```sql
update public.platform_settings
set marketplace_registry = jsonb_build_object(
  'jvzoo', jsonb_build_object(
    'enabled', creator_os_page_enabled,
    'demo_video_url', creator_os_demo_video_url,
    'cta_url', 'https://www.jvzoo.com/b/0/442467/99',
    'tracking_pixel_url', 'https://i.jvzoo.com/0/442467/99',
    'disclaimer_text', 'JVZoo compliance disclaimer will be inserted before product submission.'
  ),
  'warriorplus', jsonb_build_object(
    'enabled', false,
    'demo_video_url', null,
    'cta_url', 'https://warriorplus.com/o/PLACEHOLDER',
    'tracking_pixel_url', null,
    'disclaimer_text', 'WarriorPlus compliance disclaimer placeholder.'
  )
)
where marketplace_registry = '{}'::jsonb;
```

### 5.3 Legacy column policy

**Recommended: keep legacy columns read-only during cutover, dual-write from admin UI, drop after parity is confirmed.** This avoids breaking the existing `/adminsh/settings` UX during rollout. See §7 for the phase plan.

### 5.4 RLS

No change. Existing policies apply to the new column automatically.

### 5.5 Validation **[NEW consideration]**

Because the schema moves into JSONB, drift becomes possible. **Mitigation:** parse with Zod in `usePlatformSettings.queryFn`; log + fall back to defaults on validation error. This is the new contract.

---

## 6. Route Impact

| Current | New | Notes |
|---|---|---|
| `/jvzoo` (hardcoded `<Route>`) | `/jvzoo` (registry-generated) | behavior unchanged |
| `/launch-partners` (hardcoded) | `/launch-partners` (kept) | not a marketplace, untouched |
| `/jvzooaffiliate` (hardcoded alias) | **delete** | unused legacy (§3.18) **[NEW]** |
| (none) | `/warriorplus` (registry-generated) | new, behavior follows JVZoo template |

**Lazy load keys** — `lazyWithRetry(\`marketplace-${mp.id}\`)` for cache bucketing.

**NotFound** — removing a marketplace from the registry removes its route. Clean.

**Robots / sitemap** — see Open Question Q7.

---

## 7. Admin Settings Impact

### Before

- `AdminDashboard.tsx ~1980-2023` — `<SectionCard>` titled `"Marketing / Launch Controls"` with `creator_os_page_enabled` toggle + demo video URL.
- `AdminDashboard.tsx ~2025-2075` — `<SectionCard>` titled `"Public Page Controls"` with `jvzoo_affiliate_enabled`, demo video, CTA URL, button text, login URL.
- `resource_vault_enabled` lives in a separate card.
- Launch Partners / affiliate program sits awkwardly between marketplace controls.

### After

- **One** `<SectionCard>` titled `"Marketplace Pages"` with a data-driven list:
  ```
  ✓ JVZoo           [toggle]   [expand: demo video, CTA URL, button text, disclaimer]
  ✓ WarriorPlus     [toggle]   [expand: ...]
  ✗ ClickBank       [toggle]   [expand: ...]
  ✗ Digistore24     [toggle]   [expand: ...]
  ✗ AppSumo         [toggle]   [expand: ...]
  ✗ Whop            [toggle]   [expand: ...]
  ```
- Each row is independent. Toggling one does not affect any other.
- The "Resource Vault" toggle stays in its own section (it is not a marketplace).
- Launch Partners gets renamed and clarified — it is a generic affiliate program, not JVZoo-specific (fixes §1.3).

### Save flow

Admin save → `update platform_settings set marketplace_registry = $1` → `invalidateQueries(["platform-settings-live-v1"])`. Same round-trip as today, no extra network hops.

### Dual-write window (Phase 4)

During cutover the admin UI writes to **both** the legacy columns and `marketplace_registry`. After parity is confirmed, the legacy columns become read-only and a follow-up migration drops them.

---

## 8. Component Structure (target state)

```
src/components/marketplace/         ← NEW shared library
├── MarketplacePage.tsx              ← Shell that composes everything below
├── MarketplaceRouteGuard.tsx        ← Visibility + redirect (extracts §1.2 pattern)
├── MarketplaceHero.tsx              ← Eyebrow, headline, subhead, primary/secondary CTA, disclaimer, stats, mockup slot
├── MarketplaceWorkflow.tsx          ← Vertical stepper (WorkflowStep → MarketplaceStep)
├── MarketplaceFeatureGrid.tsx       ← 3-column grid of feature cards
├── MarketplaceSecondaryBlock.tsx    ← Two-column: copy + mini feature grid
├── MarketplaceOutputsGrid.tsx       ← Mock-output showcase cards
├── MarketplaceUseCases.tsx          ← Use case grid (Faceless YT, TikTok Shop, ...)
├── MarketplaceFeatureList.tsx       ← 4×3 feature bullet grid
├── MarketplaceDemoVideo.tsx         ← Video embed resolver (already exists as local helper today)
├── MarketplaceWhy.tsx               ← Left reasons + right stats
├── MarketplaceFinalCTA.tsx          ← Primary CTA + secondary link + disclaimer
├── MarketplaceTrackingPixel.tsx     ← Config-driven <img>
├── MarketplaceDisclaimer.tsx        ← Config-driven text block
└── MarketplaceSEO.tsx               ← Thin wrapper around <PageSeo> (fixes §3.8)
```

Each component:
- Accepts `{ config: MarketplaceConfig, live?: MarketplaceLiveState }` as needed
- Reads no hardcoded marketplace-specific strings
- Uses `config.branding.accentHsl` for accent colors
- Renders nothing for sections that have no data (e.g. no demo video → section omitted)

`MarketplacePage` also accepts a `children` slot for per-marketplace section overrides — used only when a marketplace genuinely needs different structure (e.g., future AppSumo "lifetime deal" block).

---

## 9. File Structure (final state)

```
RobinOS-main/
├── supabase/
│   └── migrations/
│       ├── 2026XXXX_marketplace_registry.sql   ← NEW
│       └── ... (existing 1-48)
├── scripts/
│   └── sql/
│       └── bootstrap_platform_settings.sql     ← MODIFIED (adds marketplace_registry)
├── public/
│   ├── robots.txt                              ← MODIFIED (build-time generated, see Q7)
│   └── sitemap.xml                             ← MODIFIED (build-time generated, see Q7)
└── src/
    ├── config/
    │   └── marketplaces.ts                     ← NEW: REGISTRY
    ├── components/
    │   ├── marketplace/                        ← NEW shared library
    │   │   └── (15 components, see §8)
    │   ├── admin/
    │   │   └── MarketplaceSettingsCard.tsx     ← NEW
    │   ├── public/
    │   │   ├── PublicNavbar.tsx                ← MODIFIED (registry-driven)
    │   │   ├── PublicFooter.tsx                ← MODIFIED (registry-driven, fixes §3.13)
    │   │   └── (JVZooCTA / JVZooTrackingPixel / JVZooDisclaimer → DELETED)
    │   └── seo/
    │       └── PageSeo.tsx                     ← MODIFIED (registry-driven)
    ├── pages/
    │   └── public/
    │       ├── CreatorOSPage.tsx               ← REFACTORED (thin wrapper)
    │       ├── WarriorPlusPage.tsx             ← NEW (thin wrapper)
    │       └── LaunchPartnersPage.tsx          ← UNCHANGED
    ├── hooks/
    │   └── usePlatformSettings.ts              ← MODIFIED (parses marketplace_registry)
    ├── types/
    │   └── platform-config.ts                  ← MODIFIED (MarketplaceConfig types)
    └── App.tsx                                 ← MODIFIED (registry-driven routes)
```

---

## 10. Migration Plan

### Phase 0 — Pre-flight (read-only)
1. Confirm with stakeholder: official WarriorPlus checkout URL, tracking pixel URL, disclaimer text, branding color.
2. Confirm: is the team OK with a transitional state where legacy columns and JSONB coexist (recommended)?
3. Decide: keep `/jvzooaffiliate` alias or remove it (recommend remove).
4. Decide: how should `robots.txt` and `sitemap.xml` be generated — static (current) or build-time (recommended, fixes §3.15)?

### Phase 1 — Schema (no code change)
1. Write `supabase/migrations/2026XXXX_marketplace_registry.sql` — add JSONB column + backfill from existing columns + hardcoded constants.
2. Verify: `select marketplace_registry from platform_settings;` returns object with `jvzoo` + `warriorplus` entries.
3. Update `scripts/sql/bootstrap_platform_settings.sql` so fresh installs create the same column with the same defaults.

### Phase 2 — Read path (additive, no break)
1. Add `MarketplaceConfig` type and `MARKETPLACES` registry at `src/config/marketplaces.ts` (hardcoded values mirror current JVZoo state).
2. Update `usePlatformSettings()` to parse `marketplace_registry` with Zod and expose `useMarketplaceLiveSettings(id)`.
3. Add `<MarketplaceRouteGuard>` and `<MarketplacePage>` shell composing the shared sub-components.
4. Wire `/warriorplus` route to a new thin `WarriorPlusPage` wrapper.
5. Verify `/jvzoo` still behaves identically (no UI change yet).

### Phase 3 — Refactor existing page (no user-visible change)
1. Replace hardcoded `JVZooCTA` / `JVZooTrackingPixel` / `JVZooDisclaimer` imports in `CreatorOSPage` with shared `MarketplaceFinalCTA` / `MarketplaceTrackingPixel` / `MarketplaceDisclaimer`.
2. Replace `JVZOO_*` constants with registry lookups.
3. Refactor `CreatorOSPage` to be a thin wrapper around `<MarketplacePage config={MARKETPLACES.jvzoo} />`.
4. Snapshot `/jvzoo` HTML before/after; diff to confirm zero visual regression.
5. Delete `src/components/public/JVZooCTA.tsx`, `JVZooTrackingPixel.tsx`, `JVZooDisclaimer.tsx`.

### Phase 4 — Admin UI cutover
1. Build `<MarketplaceSettingsCard>` from the registry.
2. Add to `AdminDashboard` alongside (not replacing) the existing controls.
3. Verify admin can toggle `/jvzoo` and `/warriorplus` independently.
4. Switch admin save to dual-write (legacy columns + JSONB) during cutover.
5. Remove the legacy hand-rolled admin sections once parity is confirmed.

### Phase 5 — Cleanup
1. Remove deprecated `JVZooCTA.tsx` / `JVZooTrackingPixel.tsx` / `JVZooDisclaimer.tsx` (if not done in Phase 3).
2. (Optional) Drop legacy `creator_os_*` and `jvzoo_affiliate_*` columns in a follow-up migration after admin has fully migrated to JSONB.
3. Update `bootstrap_platform_settings.sql` so fresh installs create the registry with all six marketplaces.
4. Decide on `robots.txt` / `sitemap.xml` strategy (static vs build-time).

---

## 11. Step-by-Step Implementation Plan (after approval)

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | Add JSONB column + backfill migration | `supabase/migrations/2026XXXX_*.sql` | `select marketplace_registry from platform_settings;` returns object with jvzoo + warriorplus |
| 2 | Add `MarketplaceConfig` type + registry | `src/config/marketplaces.ts` (new) | `bun run build` (type check passes) |
| 3 | Extend `usePlatformSettings` to return parsed registry | `src/hooks/usePlatformSettings.ts`, `src/types/platform-config.ts` | `bun run test` |
| 4 | Build `MarketplaceRouteGuard` | `src/components/marketplace/MarketplaceRouteGuard.tsx` (new) | Unit test: passes through when enabled, redirects when disabled |
| 5 | Build reusable `Marketplace*` components (15 files per §8) | `src/components/marketplace/*.tsx` (new) | Visual parity with current `/jvzoo` |
| 6 | Add `/warriorplus` thin wrapper + route | `src/pages/public/WarriorPlusPage.tsx` (new), `src/App.tsx` | `curl localhost:5173/warriorplus` returns page |
| 7 | Registry-driven navbar + footer | `src/components/public/PublicNavbar.tsx`, `PublicFooter.tsx` | `/jvzoo` link still appears; `/warriorplus` link appears when enabled; footer no longer leaks hidden pages |
| 8 | Registry-driven SEO + actually render `<PageSeo>` | `src/components/seo/PageSeo.tsx`, `MarketplacePage.tsx` | View source on `/jvzoo` + `/warriorplus` shows correct meta tags |
| 9 | Admin `MarketplaceSettingsCard` | `src/components/admin/MarketplaceSettingsCard.tsx` (new), `src/pages/AdminDashboard.tsx` | Admin can toggle both marketplaces independently; pages react to toggles |
| 10 | Refactor `CreatorOSPage` to use shared components | `src/pages/public/CreatorOSPage.tsx`, delete 3 JVZoo component files | Visual + functional parity with current `/jvzoo` |
| 11 | Build-time `robots.txt` + `sitemap.xml` (optional) | `public/robots.txt`, `public/sitemap.xml`, Vite plugin or build script | Hidden marketplaces are excluded from both files |
| 12 | Cleanup legacy admin controls + bootstrap SQL | `src/pages/AdminDashboard.tsx`, `scripts/sql/bootstrap_platform_settings.sql` | Fresh install creates all 6 marketplace entries with safe defaults |
| 13 | E2E verification | All | Manual: load `/jvzoo`, `/warriorplus`, admin toggles both, navbar updates, tracking pixels fire, SEO correct, robots/sitemap correct |

Each step is independently shippable. Phases 1-3 ship the `/warriorplus` page. Phase 4 ships the admin cutover. Phase 5 cleans up legacy.

---

## 12. Risks & Open Questions

### Risks

1. **JSONB validation drift** — schema is now in code, not in DB. **Mitigation:** Zod-validate `marketplace_registry` in `usePlatformSettings.queryFn`; log + fall back to defaults on validation error.
2. **Realtime broadcast size** — JSONB column broadcasts the whole registry on any settings update. **Mitigation:** settings writes are rare (admin only); not a perf concern in practice.
3. **Bundle size** — generic components live in every marketplace bundle. **Mitigation:** lazy-load each marketplace page via `lazyWithRetry`, code-split as today.
4. **SEO regression** — refactoring risks losing existing meta tags. **Mitigation:** snapshot current `/jvzoo` HTML before Phase 3, diff after.
5. **Backward compatibility** — existing admin UI edits legacy columns. **Mitigation:** dual-write during Phase 4, drop legacy in Phase 5.
6. **Dual-write inconsistency** — if legacy and JSONB drift, two sources of truth. **Mitigation:** Phase 5 drops legacy columns.
7. **No server-side guard** — even with all client fixes, a non-JS crawler sees `index.html`. **Mitigation:** build-time `robots.txt` + `sitemap.xml`; consider Vercel middleware redirect for hidden paths.

### Open questions for the user (BLOCKING)

These need answers before Phase 1 can start:

- **Q1. WarriorPlus checkout URL** — Do you have the official WarriorPlus checkout link yet, or should we use a placeholder?
- **Q2. WarriorPlus tracking pixel URL** — Same question. Compliance often requires a specific pixel pattern.
- **Q3. WarriorPlus disclaimer text** — Required by WarriorPlus. Placeholder until you provide?
- **Q4. WarriorPlus branding color** — Default to neutral gray, or pick an accent (orange is common for WarriorPlus)?
- **Q5. WarriorPlus-specific sections** — Does WarriorPlus need different copy / different bonuses / different pricing than JVZoo, or is "same product, different marketplace" good enough for the generic default?

### Open questions for the user (NON-BLOCKING)

These can be answered during or after implementation:

- **Q6. Affiliate page strategy** — Keep one shared `/launch-partners` page, or split per marketplace (`/jvzoo-affiliate`, `/warriorplus-affiliate`)? Recommend: keep shared for now, split later only if copy diverges.
- **Q7. robots.txt + sitemap.xml** — Static (current) or build-time generated? Build-time fixes the leak bug but requires a build hook.
- **Q8. Tracking pixel toggle** — Should each marketplace's pixel be admin-controllable (on/off), or always-on for compliance? Recommend: always-on, gated only by the page being enabled.
- **Q9. CTA URL admin override** — Today `jvzoo_affiliate_cta_url` is editable in admin but unread by code. The new architecture makes CTA URLs registry-driven; admin override per marketplace is feasible. Want it?
- **Q10. `jvzoo_affiliate_cta_url` column** — Already dead code today. Drop it now or keep during cutover? Recommend: keep during cutover, drop in Phase 5.
- **Q11. `/jvzooaffiliate` alias** — Delete? Recommend yes (unused legacy).
- **Q12. `jvzoo_affiliate_enabled` naming** — Rename to `launch_partners_enabled` or keep? Recommend rename during Phase 5.
- **Q13. Cutover tolerance** — OK with a transitional dual-write state (recommended)? Or hard cutover on the same day?

---

## 13. Approval Gate

This is a **planning artifact only**. No files have been modified. Awaiting explicit approval before any implementation begins.

**Recommended next action:** review §4 (architecture), §7 (admin UI), §10 (migration plan), §11 (implementation steps), and §12 (open questions). Answer Q1-Q5 (blocking) before Phase 1 can start. Q6-Q13 can be answered progressively.

**Cross-references:**
- Existing prior audit: `.kimchi/docs/marketplace-architecture-audit.md` (33 KB, dated 2026-06-29) — overlapping, cross-validated by this audit.
- JVZoo integration plan: `.kimchi/docs/jvzoo-integration-plan.md` — original 3-chunk integration plan that produced current JVZoo components.
- Whop phase plans: `.kimchi/docs/whop-phase*.md` — orthogonal Whop payment-provider work (NOT a sales page).

**Validation evidence for the audit:** every claim about a file references a verified path:line. Code quoted in §1.2 and §1.6 was read directly from the source on 2026-06-29. New findings (§3.8, §3.10-§3.19) are flagged **[NEW]**.
