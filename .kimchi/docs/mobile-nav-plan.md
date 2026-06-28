# Mobile Navigation Refactor Plan

## Goal
Replace the overcrowded mobile bottom navigation bar with a premium full-screen slide-in drawer that mirrors the desktop sidebar structure using existing navigation data and styling.

## Architecture Audit Summary

**Current State:**
- `src/components/DashboardSidebar.tsx` contains BOTH:
  1. Mobile bottom nav (`<nav className="md:hidden">` — fixed bottom, 7-item grid)
  2. Desktop sidebar (`<aside className="hidden md:flex">` — left sidebar)
- `src/pages/DashboardLayout.tsx` wraps `<DashboardSidebar />` + `<main>` with `pb-24 md:pb-0` (mobile padding compensates for bottom nav)
- Navigation data: `sidebarSections` (CREATE/GROW/SYSTEM) is the canonical source. `bottomNavItems` is mobile-only.
- Desktop sidebar is already well-structured with sections, active state, prefetch, Report Abuse, and Sign Out.

## Chunk 1 — DashboardSidebar.tsx Refactor
**File:** `src/components/DashboardSidebar.tsx`

### Changes
1. **Remove** the entire mobile bottom nav block (`<nav className="md:hidden">...</nav>`)
2. **Remove** the `bottomNavItems` array (no longer needed)
3. **Add** a hamburger menu button (`Menu` icon from lucide-react) rendered only on mobile (`md:hidden`). Positioned fixed top-left with z-50, styled to match RobinOS dark theme (glass-strong, border border-border/50, rounded-lg, shadow).
4. **Add** mobile drawer state: `const [mobileOpen, setMobileOpen] = useState(false);`
5. **Add** full-screen mobile drawer overlay + panel:
   - Overlay: `fixed inset-0 bg-black/60 backdrop-blur-sm z-50` — click to close
   - Panel: `fixed inset-y-0 left-0 w-72 z-50` slide-in from left, dark card styling (`bg-card/95 backdrop-blur-xl border-r border-border/60`)
   - Header: BrandMark + close button (X)
   - Nav body: Reuses `sidebarSections` data structure identically (CREATE, GROW, SYSTEM sections with section labels and NavLink items)
   - Active highlighting same as desktop (primary accent, border)
   - Footer: Report Abuse + Sign Out buttons (same as desktop footer)
6. **Add** escape key listener: `useEffect` with `keydown` listener for Escape → close drawer
7. **Add** body scroll lock: when drawer open, `document.body.style.overflow = 'hidden'`
8. **Prefetch**: preserve existing `prefetchRoute` on hover/focus for desktop; for mobile, call prefetch on open or on focus
9. Desktop sidebar block (`<aside className="hidden md:flex">`) — **ZERO CHANGES**

### Drawer Sections (reuse sidebarSections data)
- **Header:** BrandMark + close button
- **CREATE:** Trend Scanner, Script Engine, Voice Studio, Video Studio, Audio & Hashtag, Caption
- **GROW:** Analytics, Referrals
- **SYSTEM:** History, Settings
- **Footer:** Report Abuse, Sign Out

### Close behaviors
- Click nav item → close drawer + navigate
- Click overlay backdrop → close drawer
- Press Escape → close drawer

## Chunk 2 — DashboardLayout.tsx minor padding fix
**File:** `src/pages/DashboardLayout.tsx`

### Changes
1. `<main className="flex-1 min-h-screen overflow-y-auto relative z-10 pb-24 md:pb-0">` → remove `pb-24` → `<main className="flex-1 min-h-screen overflow-y-auto relative z-10 md:pb-0">`
   - The `pb-24` was padding for the removed bottom nav. With the drawer, no bottom padding needed.
   - Keep `md:pb-0` for consistency or simplify to just no padding.

## No Other Files Modified
- No route changes
- No backend changes
- No auth changes
- No data changes
- No new dependencies

## Acceptance Criteria
1. Mobile shows ☰ hamburger button top-left, not bottom nav
2. Tapping ☰ opens full-screen drawer from left
3. Drawer has same 3 sections (CREATE, GROW, SYSTEM) matching desktop
4. Each nav item links to correct route
5. Active page highlighted in drawer
6. Drawer closes after navigation click
7. Drawer closes when tapping overlay
8. Drawer closes when pressing Escape
9. Sign Out works from drawer footer
10. Report Abuse works from drawer footer
11. Desktop sidebar is visually identical (unchanged)
12. Build passes (TypeScript + Vite)
13. No lint errors
