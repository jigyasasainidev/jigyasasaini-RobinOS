# RobinOS — Roadmap

## Post-Launch Improvements

These improvements were identified during production audits and should be scheduled for upcoming sprints.

### 1. Mobile Admin Dashboard Responsiveness
**Source**: TODO-MOBILE-RESPONSIVENESS.md  
**Files**: `AdminDashboard.tsx`, `DashboardSidebar.tsx`, `AdminNotifications.tsx`  
**Scope**: UI-only. No backend changes required.
- Fix horizontal table overflow (`min-w-[760px]` → responsive min-width)
- Scale sidebar drawer width for screens < 320px (`w-72` → `w-64 sm:w-72`)
- Add safe area padding `env(safe-area-inset-bottom)` to mobile drawer
- Increase touch targets to 44×44px minimum

### 2. Table Optimization
**Source**: TODO-MOBILE-RESPONSIVENESS.md  
**Files**: `AdminDashboard.tsx` (DataTable component)  
**Scope**: UI-only.
- Wrap tables in `overflow-x-auto` with mobile-first `min-w`
- Remove `whitespace-nowrap` on amount/date columns for mobile
- Scale `text-xs` to `text-sm` on larger screens

### 3. Chart Scaling
**Source**: TODO-MOBILE-RESPONSIVENESS.md  
**Files**: `AdminDashboard.tsx` (TerminalChart, MultiAreaChart, BarChart)  
**Scope**: UI-only.
- Replace fixed pixel heights with responsive breakpoints
- Reduce default height on mobile to ~150px vs. 220px on desktop
- Use container queries or `useMediaQuery` hook

### 4. Safe Area Handling
**Source**: TODO-MOBILE-RESPONSIVENESS.md  
**Files**: `DashboardSidebar.tsx`  
**Scope**: UI-only.
- Add `padding-bottom: env(safe-area-inset-bottom)` to drawer
- Ensure `viewport-fit=cover` is on admin PWA meta tag
- Test on iPhone Safari with Dynamic Island / notch

### 5. Touch Target Improvements
**Source**: TODO-MOBILE-RESPONSIVENESS.md  
**Files**: `AdminNotifications.tsx`, `DashboardSidebar.tsx`, `AdminDashboard.tsx`  
**Scope**: UI-only.
- Bell button: `h-7 w-7` → `h-9 w-9`
- Sidebar hamburger: add `min-h-[44px] min-w-[44px]`
- Data table row tap targets: add `min-h-[44px]`
- Column filter toggle targets: increase padding

---

## Future (Backlog)
- [ ] Admin PWA offline capabilities
- [ ] Advanced analytics drill-down (click-to-expand on charts)
- [ ] Real-time notification push (Web Push API)
- [ ] Dark-mode only optimization for OLED

---

*Roadmap created: 2026-06-07*  
*Last updated: 2026-06-07*
