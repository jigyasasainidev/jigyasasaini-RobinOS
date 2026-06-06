# Affiliate Resource Library Implementation Plan

## Objective
Add a single Google Drive Folder URL (`affiliate_resources_url`) to `platform_settings`, manageable from the admin panel, accessible from the affiliate dashboard, and used on the Launch Partners page.

## Production Safety
- NO changes to commission/payout/withdrawal/referral/analytics/subscription/auth logic
- NO changes to existing database behavior beyond adding one nullable TEXT column
- NO refactoring of unrelated code
- All changes are additive only

---

## Chunk 1: Database Migration + Types + Hooks

### 1.1 Migration
**New file:** `supabase/migrations/46_affiliate_resources_url.sql`
```sql
-- Add affiliate_resources_url to platform_settings
alter table public.platform_settings
  add column if not exists affiliate_resources_url text;

comment on column public.platform_settings.affiliate_resources_url is
  'Google Drive folder URL shared with affiliates for promotional assets, templates, and videos.';
```
- **Reversible:** `alter table drop column if exists`
- **Safe:** `IF NOT EXISTS` prevents conflicts

### 1.2 Types
**File:** `src/types/platform-config.ts`
- Add `affiliate_resources_url: string | null` to `PlatformSettingsRow`
- Add `affiliate_resources_url: string` to `PlatformSettingsDraft`
- Add `affiliate_resources_url: ""` to `PLATFORM_SETTINGS_DEFAULTS`

### 1.3 Hooks
**File:** `src/hooks/usePlatformSettings.ts`
- Add `affiliate_resources_url` to the `.select()` column list

**File:** `src/hooks/useReferralData.ts`
- Add `affiliate_resources_url` to the platform_settings select query (used by ReferralsPage)

---

## Chunk 2: Admin Panel

**File:** `src/pages/AdminDashboard.tsx`

### Changes
1. **Loading state** (around line 889): Add `affiliate_resources_url: platformSettings.affiliate_resources_url ?? ""`
2. **Save payload** (around line 1313): Add `affiliate_resources_url: settingsDraft.affiliate_resources_url?.trim() || null`
3. **UI Input** (after Affiliate Parameters section, around line 1912):
   - New section titled **"Affiliate Resources"**
   - Input field labeled **"Google Drive Folder URL"**
   - Bound to `settingsDraft.affiliate_resources_url`
   - Placeholder: `https://drive.google.com/drive/folders/...`
   - No custom validation required

### Why after Affiliate Parameters
Existing sections are in a grid layout. This will be a single standalone input below the existing 3-column Affiliate Parameters grid.

---

## Chunk 3: Affiliate Dashboard (ReferralsPage)

**File:** `src/pages/ReferralsPage.tsx`

### Changes
1. Import `ExternalLink` from `lucide-react`
2. Add `usePlatformSettings` hook import
3. After the **"Withdrawal History"** section (closing `</section>` at end of file around line 390+), insert a new section:

```tsx
<section className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-5">
  <p className="text-sm text-foreground font-medium mb-2">Affiliate Resources</p>
  <p className="text-[11px] text-muted-foreground mb-4">
    Access promotional assets, templates, videos, and marketing resources provided by RobinOS.
  </p>
  {resourcesUrl ? (
    <a
      href={resourcesUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
    >
      Open Resource Library <ExternalLink className="w-3.5 h-3.5" />
    </a>
  ) : (
    <div className="flex flex-col items-center justify-center py-8 gap-2 text-center rounded-xl"
      style={{ background: "hsl(222 28% 6%)", border: "1px dashed hsl(217 28% 13%)" }}>
      <p className="text-xs text-muted-foreground/40 font-mono">No resource library configured</p>
      <p className="text-[10px] text-muted-foreground/25 leading-relaxed">Check back later for promotional assets and marketing materials.</p>
    </div>
  )}
</section>
```

4. Read `affiliate_resources_url` from `useReferralData` (already added to hook in Chunk 1) or `usePlatformSettings`.

### Decision
Since `useReferralData` already has a `settingsQuery` that reads `platform_settings`, I'll add `affiliate_resources_url` there and expose it from the hook. This avoids adding another hook call in ReferralsPage.

---

## Chunk 4: Launch Partners Page

**File:** `src/pages/public/LaunchPartnersPage.tsx`

### Changes
In the **"Promotional Assets"** section (around line 580+):

1. Import `usePlatformSettings` hook (or derive from settings)
2. The page already uses `usePlatformSettings()` — add `affiliate_resources_url` to destructured values
3. **In dynamic asset cards:** Update the button behavior:
   - Instead of using `asset.button_url`, use `affiliate_resources_url || asset.button_url`
   - If `affiliate_resources_url` exists, all cards link to it
   - If not, fall back to existing `asset.button_url`
4. **Remove disabled/Coming Soon badges:** Remove the badge rendering block or make it conditional
5. **Empty state:** When `promoAssets.length === 0`, show an "Open Resource Library" button linking to `affiliate_resources_url` (or the existing empty state if no URL)

Wait — the user said "Keep existing design and layout unchanged. Do not redesign cards." So I should NOT redesign the cards. I should only change their link behavior and remove disabled state/badges.

Looking at the current code:
- Each dynamic promo asset card renders `asset.button_url` as a link
- Some have `asset.badge` (shown at top right)
- The empty state is a dashed box with "Promo resources will appear here"

### Exact changes:
1. In the dynamic asset card map (around line 610+), change the `<a>` href from `asset.button_url` to `affiliate_resources_url || asset.button_url`
2. Remove the badge rendering block entirely (or make it only show non-"Coming Soon" badges — simplest to remove the badge block entirely per "Remove all Coming Soon badges")
3. In empty state (when `promoAssets.length === 0`), add:
   - If `affiliate_resources_url` exists: show "Open Resource Library" button linking to it
   - Else: keep existing empty state
4. Keep card styling/layout exactly the same

---

## Order of Execution

1. **Chunk 1 first** (migration, types, hooks) — provides data foundation
2. **Chunk 2** (admin panel) — provides data entry
3. **Chunk 3** (referrals page) — consumes new field
4. **Chunk 4** (launch partners page) — consumes new field

All chunks are sequential dependency chains. No parallel work.

---

## Verification Checklist

- [ ] Migration file exists and uses `IF NOT EXISTS`
- [ ] `platform_settings` select queries include `affiliate_resources_url`
- [ ] Admin panel loads existing value correctly
- [ ] Admin panel saves value to database
- [ ] ReferralsPage shows resource button when URL is set
- [ ] ReferralsPage shows empty state when URL is empty
- [ ] LaunchPartnersPage promo cards link to resource URL
- [ ] No commission logic modified
- [ ] No payout logic modified
- [ ] No withdrawal logic modified
- [ ] No analytics modified
- [ ] No auth modified
