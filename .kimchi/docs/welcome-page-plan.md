# Welcome Page Plan — `/welcome`

## Goal
Create a lightweight, conversion-focused public post-purchase onboarding page at `/welcome` that confirms purchase success and guides customers to log in.

## Chunk 1 — Create WelcomePage component
**File:** `src/pages/public/WelcomePage.tsx`

### Layout
- Wrap in `<PublicLayout>` (existing public page wrapper with navbar + footer)
- Use `<PageSeo>` with title/description/canonical
- Centered, card-based layout matching existing RobinOS dark SaaS aesthetic

### Content (exactly as specified)
- **Headline:** 🎉 Welcome to RobinOS
- **Subheadline:** Your purchase was successful and your account is ready.
- **Description:** Thank you for joining RobinOS. You can now log in and start using your dashboard immediately.
- **Primary CTA:** "Login to RobinOS" → `/login` (uses `<Button asChild>` with `<Link>`)
- **Secondary CTA:** "Back to Home" → `/` (uses `<Button variant="outline" asChild>` with `<Link>`)
- **Success Checklist:**
  - ✅ Purchase Completed
  - ✅ Account Created
  - ✅ Dashboard Ready

### Styling Requirements
- Match existing public page palette: dark background, primary blue accents, card surfaces with `bg-card/40`
- Use existing components: `PublicLayout`, `PageSeo`, `Button`, `Link` from react-router-dom
- Use `CheckCircle2` icon from lucide-react for checklist items (green tint)
- Responsive: centered layout, max-width container (`max-w-lg`), proper padding
- Extremely light animation: only `motion.div` with `initial={{ opacity: 0, y: 12 }}` animate to visible, 0.4s easeOut — no heavy/large animations
- No new dependencies

## Chunk 2 — Register route
**File:** `src/App.tsx`

### Changes
1. Add lazy import: `const WelcomePage = lazy(() => import("./pages/public/WelcomePage"));`
2. Add route: `<Route path="/welcome" element={<WelcomePage />} />` within the `<Routes>` block (near other public routes like `/about`, `/contact`)

## Acceptance Criteria
1. `src/pages/public/WelcomePage.tsx` exists and exports `WelcomePage` component
2. `src/App.tsx` registers `<Route path="/welcome" element={<WelcomePage />} />`
3. Page renders `PublicLayout`, headline, subheadline, description, two CTAs, checklist
4. "Login to RobinOS" button navigates to `/login`
5. "Back to Home" button navigates to `/`
6. Page is public (no auth required)
7. No other pages or systems modified
8. Vite dev build compiles without errors
