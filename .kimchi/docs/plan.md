# Resource Vault Download Gating — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Gate PDF downloads behind authentication with automatic redirect back to the resource page and auto-resume download after login.

**Architecture:** Use `sessionStorage` to persist the resource return URL and pending-download slug across the OAuth redirect cycle. After Supabase OAuth callback, redirect back to the exact resource URL. On resource detail page mount, detect the pending download flag and automatically trigger the download mutation for authenticated users.

**Tech Stack:** React 18, Vite, React Router v6, Supabase Auth, TanStack React Query, shadcn/ui

---

## Context

The RobinOS Resource Vault has two public pages:
- `/resources` — list of resources (already public)
- `/resources/:slug` — resource detail with Download PDF and Preview PDF buttons

Current behavior:
- Preview PDF opens the PDF in a new tab for anyone
- Download PDF checks `user`, and if missing navigates to `/login` with React Router `state: { from }` — but this `state` is lost during the OAuth redirect
- After OAuth callback, user is always redirected to `/dashboard`
- Download count is incremented by a `useMutation` that fires on button click, then the PDF opens immediately (even if mutation fails)

Auth flow:
- Supabase OAuth with Google provider
- OAuth redirect URI: `<origin>/auth/callback`
- `AuthCallbackPage` exchanges code for session, initializes account, redirects to `/dashboard`
- `AuthPage` also has `onAuthStateChange` + `getSession()` listeners that redirect logged-in users to `/dashboard`

## Files Modified

| File | Action | Rationale |
|------|--------|-----------|
| `src/pages/ResourceDetailPage.tsx` | Modify | Add sessionStorage persistence for pending download, auto-resume download after login, refactor mutation to only open PDF on success |
| `src/pages/AuthCallbackPage.tsx` | Modify | Read stored `returnTo` from sessionStorage and redirect there instead of `/dashboard` |
| `src/pages/AuthPage.tsx` | Modify | Read stored `returnTo` from sessionStorage and redirect there instead of `/dashboard` when user is already logged in |

## Session Storage Keys

- `robinos_return_to` — stores exact resource URL (e.g. `/resources/500-viral-hooks-collection`)
- `robinos_pending_download_slug` — stores the resource slug to auto-trigger download on return

> sessionStorage is per-tab and survives same-origin navigations within the same tab (including OAuth redirects). It is cleared when the tab closes.

---

## Task 1: ResourceDetailPage — Download Gating + Auto-Resume

**Files:** `src/pages/ResourceDetailPage.tsx`

### Step 1: Add download state persistence and refactor handleDownload

Modify `handleDownload` to:
- If no `user`: store `robinos_return_to` and `robinos_pending_download_slug` in sessionStorage, then `navigate("/login")`
- If `user`: just call `downloadMutation.mutate(resource.id)`

**Detailed modifications to ResourceDetailPage.tsx:**
- Add `const { user, loading } = useAuth();` (was missing `loading`)
- Add `const pendingDownloadTriggeredRef = useRef(false);` to prevent double fire
- Modify `handleDownload` to persist sessionStorage when user is not logged in, and remove redundant code that opens PDF and calls mutation
- Add `useEffect` for `pending download auto-resume`:
  - Dependency on `[loading, user, resource, slug]`.
  - When `!loading && user && resource && slug`:
    - get `pendingSlug` from `sessionStorage.getItem("robinos_pending_download_slug")`
    - if `pendingSlug === slug && !pendingDownloadTriggeredRef.current`:
      - `pendingDownloadTriggeredRef.current = true`
      - `sessionStorage.removeItem("robinos_pending_download_slug")`
      - `sessionStorage.removeItem("robinos_return_to")`
      - `downloadMutation.mutate(resource.id)`

### Step 2: Refactor downloadMutation

Modify `downloadMutation` to add `onSuccess` callback that opens the PDF:

```typescript
const downloadMutation = useMutation({
  mutationFn: async (resourceId: string) => {
    const { error } = await db
      .from("resources")
      .update({ download_count: (resource?.download_count ?? 0) + 1 })
      .eq("id", resourceId);
    if (error) throw error;
  },
  onSuccess: () => {
    if (!resource) return;
    const pdfUrl = getPublicUrl("resource-pdfs", resource.pdf_url);
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  },
});
```

This ensures the PDF only opens after the download count is successfully incremented. It also unifies the manual and auto-resume paths.

### Step 3: Update button behavior

The Download PDF button `onClick` stays `handleDownload`. The existing `disabled={downloadMutation.isPending}` stays.

No changes to Preview PDF button — it remains public and unchanged.

No UI layout or styling changes.

---

## Task 2: AuthCallbackPage — Preserve Return URL After OAuth

**Files:** `src/pages/AuthCallbackPage.tsx`

### Step 1: Read returnTo from sessionStorage before redirecting

After successful `initializeUserAccount`, read `sessionStorage.getItem("robinos_return_to")`.

```typescript
const returnTo = sessionStorage.getItem("robinos_return_to");
if (returnTo) {
  sessionStorage.removeItem("robinos_return_to");
  navigate(returnTo, { replace: true });
} else {
  navigate("/dashboard", { replace: true });
}
```

Replace all instances of `navigate("/dashboard", { replace: true })` with the conditional logic above.

In the error case, you may optionally keep `navigate("/login", { replace: true })` without reading returnTo.

---

## Task 3: AuthPage — Preserve Return URL for Already-Logged-In Users

**Files:** `src/pages/AuthPage.tsx`

### Step 1: Modify initializeAccount to check returnTo

Replace the `navigate("/dashboard")` at the end of `initializeAccount` with:

```typescript
const returnTo = sessionStorage.getItem("robinos_return_to");
if (returnTo) {
  sessionStorage.removeItem("robinos_return_to");
  navigate(returnTo);
} else {
  navigate("/dashboard");
}
```

This covers the edge case where an already-logged-in user visits `/login` while there's a pending download (e.g. they started the flow in another tab). sessionStorage is per-tab, so this is a narrow edge case, but implementing it makes the returnTo pattern consistent across both auth paths.

---

## Verification

### Case 1 — Authenticated User

- Log in via Google OAuth
- Navigate to `/resources/:slug`
- Click **Download PDF**
- Download mutation fires
- Download count in Supabase increments by 1
- PDF opens in new tab via `onSuccess`
- Page shows updated download count (React Query invalidation may show stale count until refetch)

### Case 2 — Unauthenticated User

- In an incognito window, navigate to `/resources/:slug`
- Click **Download PDF**
- User is redirected to `/login`
- `sessionStorage` contains:
  - `robinos_return_to` = `/resources/:slug`
  - `robinos_pending_download_slug` = `:slug`
- Click **Continue with Google**
- Complete OAuth
- Back on `/auth/callback`, session exchanged
- Redirected back to exact `/resources/:slug`
- `ResourceDetailPage` mounts, auth resolves, effect detects pending slug
- Download mutation fires automatically
- Download count increments
- PDF opens in new tab
- **Preview PDF** button remains public and unchanged

### Case 3 — Redirect Preservation

- Starting URL: `/resources/500-viral-hooks-collection`
- After login redirect: `/resources/500-viral-hooks-collection` (exact match)
- NOT `/dashboard`, `/`, or `/resources`

### Case 4 — Count Not Incremented for Anonymous Preview

- Anonymous user navigates to resource page
- Click **Preview PDF**
- PDF opens in new tab
- No download count increment

### Case 5 — Refresh Safety

- Authenticated user on `/resources/:slug` refreshes page
- No pending slug in sessionStorage (cleared after use)
- No auto-download triggered

---

## Spec Coverage Check

| Requirement | Task | Notes |
|-------------|------|-------|
| Preview PDF public | N/A — already public | No changes needed |
| Download requires auth | Task 1 | `handleDownload` redirects to `/login` when `!user` |
| Sign in with existing RobinOS auth | Task 2 | Uses existing Supabase OAuth flow |
| Return to exact resource URL | Tasks 1, 2, 3 | `sessionStorage` persists across OAuth redirect |
| Auto-continue download after login | Task 1 | `useEffect` detects pending slug and triggers mutation |
| Increment count only on authenticated download | Task 1 | Mutation only fires for authenticated users; preview untouched |
| Preserve UI exactly | All tasks | No layout, styling, or button text changes |

## Risk Notes

- **sessionStorage per-tab**: If user opens OAuth in a new tab, sessionStorage won't be shared. Supabase `signInWithOAuth` redirects in the same tab by default, so this is not an issue.
- **Double download on StrictMode**: `pendingDownloadTriggeredRef` prevents double-fire in React StrictMode.
- **Stale returnTo**: sessionStorage is cleared when tab closes. If a user leaves `/login` without completing OAuth, the returnTo remains until tab close or successful use. This is acceptable.
- **Mutation closure issue**: `onSuccess` uses `resource` from closure. `resource` is stable during mutation execution (fetched data doesn't change). This is the same pattern already used elsewhere.

## Commit Strategy

- **Commit 1**: Task 1 — ResourceDetailPage download gating + auto-resume
- **Commit 2**: Task 2 — AuthCallbackPage returnTo preservation
- **Commit 3**: Task 3 — AuthPage returnTo preservation
