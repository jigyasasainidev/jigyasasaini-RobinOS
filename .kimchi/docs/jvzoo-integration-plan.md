# JVZoo Buy Button Integration Plan

## Objective
Integrate the official JVZoo checkout into the `/jvzoo` sales page while preserving the existing RobinOS premium design.

## URLs Provided
- **Checkout URL:** `https://www.jvzoo.com/b/0/442467/99`
- **Tracking Pixel URL:** `https://i.jvzoo.com/0/442467/99`

## Files Involved

### Create
- `src/components/public/JVZooTrackingPixel.tsx`

### Modify
- `src/components/public/JVZooCTA.tsx`
- `src/pages/public/CreatorOSPage.tsx`

## Chunk 1: Centralize checkout URL and update JVZooCTA
**Complexity:** simple
**Files:** `src/components/public/JVZooCTA.tsx`

### Changes
1. Replace the temporary `JVZOO_CTA_DESTINATION = "/login"` constant with the official JVZoo checkout URL.
2. Keep the constant centralized at the top of the file so future updates require changing only one location.
3. Preserve all existing props, gradient styling, Framer Motion hover/tap animations, sizing, typography, and accessibility.
4. Continue using `<Link>` (external URLs are supported by react-router-dom).

### Acceptance Criteria
- `JVZOO_CTA_DESTINATION` equals `https://www.jvzoo.com/b/0/442467/99`
- Hero CTA "Start Creating" redirects to JVZoo checkout
- Final CTA "Launch Creator OS" redirects to JVZoo checkout
- Visual styling unchanged
- TypeScript compiles
- Lint passes

## Chunk 2: Create JVZoo tracking pixel component
**Complexity:** simple
**Files:** `src/components/public/JVZooTrackingPixel.tsx`

### Changes
1. Create a single-responsibility invisible tracking pixel component.
2. Render an `<img>` with `src={JVZOO_TRACKING_PIXEL_URL}`, `width="1"`, `height="1"`, `alt=""`, and `aria-hidden="true"`.
3. Centralize the tracking pixel URL as a constant in the component file.
4. No styling, no business logic, no duplicate rendering.

### Acceptance Criteria
- Component file exists at `src/components/public/JVZooTrackingPixel.tsx`
- Component renders an invisible 1x1 pixel image
- URL is `https://i.jvzoo.com/0/442467/99`
- TypeScript compiles
- Lint passes

## Chunk 3: Mount tracking pixel on /jvzoo only
**Complexity:** simple
**Files:** `src/pages/public/CreatorOSPage.tsx`

### Changes
1. Import `JVZooTrackingPixel`.
2. Mount it once near the end of the page content, inside `PublicLayout` but outside the main sections, before the closing `</PublicLayout>`.
3. Do NOT mount it in `PublicLayout` (avoid loading on other public pages).

### Acceptance Criteria
- Tracking pixel renders only on `/jvzoo`
- Pixel renders exactly once
- No visual change to the page
- TypeScript compiles
- Lint passes

## Test Strategy
- Run TypeScript type check: `tsc --noEmit` or project equivalent
- Run lint: `eslint` or project equivalent
- Manual verification: inspect rendered output to confirm pixel image exists and CTAs link to JVZoo URL

## Compliance Checklist
- [ ] Official checkout destination in use
- [ ] Tracking pixel present on `/jvzoo` only
- [ ] Existing disclaimer remains
- [ ] No non-JVZoo payment links on `/jvzoo`
- [ ] Hero CTA points to JVZoo
- [ ] Final CTA points to JVZoo
- [ ] Unrelated CTAs unchanged
