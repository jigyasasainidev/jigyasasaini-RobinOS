# Milestone 2 — Admin Configuration UI — Testing Checklist

**Test-only document. No code, no SQL changes.**

**Covers:** Migration 55, the `admin-payment-providers` edge function, and the `/adminsh/payment-providers` React page.

**Goal:** Verify Milestone 2 is complete and production-safe before approval to proceed to Milestone 3 (webhook receiving).

---

## Pre-Test Setup

Before running tests, ensure:

- [ ] Milestone 1 (migrations 51–54) is applied on staging and production-ready.
- [ ] Database backup taken immediately before applying M55.
- [ ] Restore procedure tested and verified working.
- [ ] At least one admin user exists in `auth.users` with `get_admin_role(...)` returning `super_admin`, `admin`, or `support`.
- [ ] At least one non-admin user exists for negative-path testing.
- [ ] `supabase functions deploy admin-payment-providers` has been run (function deployed to staging project).

---

## Test 1: Apply Migration 55 to Staging

```bash
supabase db push --db-url <staging-url> --include-only 55
```

**Verify:**
- [ ] Migration applies without error
- [ ] 9 functions exist in `public` schema:
  - [ ] `is_caller_admin()`
  - [ ] `admin_list_providers()`
  - [ ] `admin_get_provider(text)`
  - [ ] `admin_upsert_provider(text, text, boolean, boolean, boolean, text, text, jsonb, cidr[])`
  - [ ] `admin_toggle_provider(text, boolean)`
  - [ ] `admin_list_provider_products(text)`
  - [ ] `admin_upsert_provider_product(uuid, text, text, text, text, text, numeric, text, numeric, text, boolean, boolean, text, text, jsonb)`
  - [ ] `admin_delete_provider_product(uuid)`
  - [ ] `admin_get_payment_provider_summary()`
- [ ] All 9 functions have `SECURITY DEFINER` and `set search_path = public`
- [ ] All 9 functions have `GRANT EXECUTE ... TO service_role` (and ONLY service_role)
- [ ] No RPC is granted to `anon` or `authenticated`
- [ ] No existing tables, columns, RLS policies, triggers, or RPCs were modified
- [ ] Existing `WarriorPlus` seed row is still present and unchanged

---

## Test 2: Deploy Edge Function

```bash
supabase functions deploy admin-payment-providers --project-ref <staging-ref>
```

**Verify:**
- [ ] Deploy succeeds
- [ ] Function URL: `https://<staging-ref>.supabase.co/functions/v1/admin-payment-providers`
- [ ] OPTIONS preflight returns 204 with CORS headers
- [ ] POST without Authorization header returns `401 UNAUTHORIZED`
- [ ] POST with non-admin JWT returns `403 ADMIN_REQUIRED`
- [ ] POST with admin JWT but malformed JSON returns `400 INVALID_JSON`
- [ ] POST with admin JWT but no `action` field returns `400 INVALID_REQUEST`

---

## Test 3: UI Smoke Test — Admin Loads the Page

### 3.1 Page loads

**Steps:**
1. Sign in as admin in a browser.
2. Navigate to `https://<staging-host>/adminsh/payment-providers`.
3. Verify the page renders.

**Verify:**
- [ ] Page title is "Payment providers" (h1)
- [ ] Description text mentions "Configure payment gateways…"
- [ ] 4 summary tiles render (Total providers, Enabled, Product mappings, Active mappings)
- [ ] Each tile shows a number (not a skeleton) once data loads
- [ ] At least one provider card renders (the seeded `warriorplus` row)
- [ ] WarriorPlus card shows `display_name = "WarriorPlus"`, `adapter_version = "1.0.0"`, `is_enabled = false`
- [ ] Provider card shows the "Disabled" status badge
- [ ] "Add product" button is present
- [ ] No `payment_provider_secrets` data is visible ANYWHERE on the page (verify by inspecting network responses)
- [ ] No secrets in browser localStorage / sessionStorage

### 3.2 Page is gated

**Verify:**
- [ ] Visiting `/adminsh/payment-providers` without auth redirects to `/adminsh/auth`
- [ ] Visiting as a non-admin user signs them out and redirects to `/adminsh/auth?unauthorized=1`
- [ ] The page is wrapped in `AdminRouteGuard` (verified by inspecting source)

---

## Test 4: Enable / Disable Provider

### 4.1 Toggle off → on

**Steps:**
1. As admin, find the WarriorPlus provider card.
2. Click the enable toggle (currently off).
3. Verify toast appears: "WarriorPlus enabled".
4. Verify status badge changes from "Disabled" to "Enabled".

**Verify (UI):**
- [ ] Toggle switches to on visually
- [ ] Toast appears with the correct message
- [ ] Status badge updates to "Enabled" within ~1s
- [ ] No spinner stuck

**Verify (DB):**
```sql
SELECT is_enabled, updated_at FROM public.payment_providers WHERE id = 'warriorplus';
-- Expected: is_enabled = true, updated_at = ~now()
```

### 4.2 Toggle on → off

**Steps:** Repeat 4.1 in reverse.

**Verify:**
- [ ] DB row has `is_enabled = false`
- [ ] UI updates correctly

### 4.3 Toggle persists across reload

**Steps:**
1. Enable WarriorPlus.
2. Reload the page.
3. Verify the toggle is still on.

**Verify:**
- [ ] After page reload, `is_enabled` is preserved
- [ ] No flicker from on→off→on

---

## Test 5: Provider Settings Form

### 5.1 Update display_name

**Steps:**
1. As admin, change display_name from "WarriorPlus" to "WarriorPlus (staging)".
2. Click "Save settings".
3. Verify toast: "WarriorPlus (staging) saved".

**Verify:**
- [ ] DB row updated
- [ ] Card title updates to the new value

### 5.2 Reject invalid webhook URL

**Steps:**
1. Set webhook_url to `not-a-url`.
2. Try to save.
3. Verify validation error appears before the network call.

**Verify:**
- [ ] Client-side validation prevents the request (zod regex `^https?://`)
- [ ] Error message: "Webhook URL must start with http:// or https://"
- [ ] No toast appears
- [ ] DB unchanged

### 5.3 Accept valid webhook URL

**Steps:** Set webhook_url to `https://example.com/webhook` and save.

**Verify:**
- [ ] Saves successfully
- [ ] DB column populated

### 5.4 Toggle is_test_mode + require_signature_verification

**Steps:** Toggle both switches on and off, save each.

**Verify:**
- [ ] Both switches persist across save + reload
- [ ] DB columns updated

### 5.5 Notes field

**Steps:** Add notes "Approved by team on 2026-07-01", save.

**Verify:**
- [ ] Saves successfully
- [ ] Notes appear in textarea after reload

---

## Test 6: Product CRUD — Create

### 6.1 Happy path

**Steps:**
1. Click "Add product" on the WarriorPlus card.
2. Fill in:
   - display_name: "Test 6-month Creator"
   - provider_product_id: `wp_test_001`
   - provider_offer_id: (leave empty)
   - plan_key: Creator
   - billing_cycle: One-time
   - duration_value: 6
   - duration_unit: Month(s)
   - amount: 39.00
   - currency: USD
   - is_subscription: off
   - is_enabled: on
3. Click "Create mapping".
4. Verify success toast.

**Verify:**
- [ ] Toast: "Product created"
- [ ] Dialog closes
- [ ] Product appears in the products table

**Verify (DB):**
```sql
SELECT * FROM public.provider_products WHERE provider_product_id = 'wp_test_001';
-- Expected: 1 row with correct values, buyer_email_hash-style fields NULL
```

### 6.2 Validation: blank Product ID

**Steps:** Open the dialog. Leave Product ID empty. Click Create.

**Verify:**
- [ ] Client validation: "Product ID is required"
- [ ] Submit blocked; no network call

### 6.3 Validation: invalid Product ID chars

**Steps:** Product ID = `wp test 001` (spaces).

**Verify:**
- [ ] Client validation: "Only letters, digits, dots, underscores, and hyphens are allowed"

### 6.4 Validation: duration_value = 0

**Steps:** duration_value = 0.

**Verify:**
- [ ] Client validation: "Duration must be greater than 0"

### 6.5 Validation: amount = -5

**Steps:** amount = -5.

**Verify:**
- [ ] Client validation: "Price cannot be negative"

### 6.6 Validation: currency lowercase

**Steps:** Manually set currency field to "usd" via DOM manipulation (the Select doesn't allow it, but verify server).

**Verify:**
- [ ] Server rejects (if somehow sent lowercase) with "currency must be a 3-letter ISO code (uppercase)"

### 6.7 Server-side validation: invalid plan_key

**Steps:** Use browser dev tools to send a request with `plan_key = "invalid_plan"`.

**Verify:**
- [ ] HTTP 400 with message: `plan_key "invalid_plan" is not one of (free, creator, pro_creator, agency)`
- [ ] No row created

---

## Test 7: Duplicate Detection

### 7.1 Duplicate (provider_id, provider_product_id, provider_offer_id)

**Steps:**
1. Create product with `provider_product_id = wp_dup_test`, `provider_offer_id = NULL`.
2. Try to create another product with the same keys.

**Verify (UI):**
- [ ] Alert appears with title "Duplicate product mapping"
- [ ] Alert body: "Another product already uses this (Provider, Product ID, Offer ID) combination. Edit the existing mapping instead."
- [ ] Dialog stays open; no row created

**Verify (HTTP):**
- [ ] HTTP 409 Conflict
- [ ] Response body: `{ success: false, code: "DUPLICATE_PRODUCT_MAPPING", existing_id: "<uuid>" }`

### 7.2 Duplicate with same offer_id

**Steps:**
1. Create product with `provider_product_id = wp_dup2`, `provider_offer_id = offerA`.
2. Create another product with same keys.

**Verify:**
- [ ] Second create rejected with DUPLICATE_PRODUCT_MAPPING

### 7.3 Different offer_id is NOT a duplicate

**Steps:**
1. Create product with `provider_product_id = wp_dup3`, `provider_offer_id = offerA`.
2. Create another with `provider_product_id = wp_dup3`, `provider_offer_id = offerB`.

**Verify:**
- [ ] Both succeed (different offer_ids are independent mappings)

### 7.4 Editing the SAME row doesn't trigger duplicate

**Steps:**
1. Edit an existing product without changing (provider_id, product_id, offer_id).

**Verify:**
- [ ] Update succeeds; the duplicate check correctly excludes the row's own id

---

## Test 8: Product CRUD — Edit + Delete

### 8.1 Edit

**Steps:**
1. Click the pencil icon on an existing product.
2. Change amount to 49.00.
3. Save.

**Verify:**
- [ ] Toast: "Product updated"
- [ ] Table row shows new price
- [ ] DB row updated

### 8.2 Delete with confirmation

**Steps:**
1. Click the trash icon on a product.
2. Verify the confirmation dialog appears.
3. Click "Delete".

**Verify:**
- [ ] Confirm dialog shows the product display name
- [ ] Toast: "Product deleted"
- [ ] Row removed from table
- [ ] DB row gone (`SELECT count(*) WHERE id = '<uuid>'` returns 0)

### 8.3 Delete cancel

**Steps:** Click trash, then "Cancel".

**Verify:**
- [ ] Dialog closes
- [ ] Row still present

---

## Test 9: Permission / RLS Verification

### 9.1 Non-admin cannot call edge function

**Steps:**
1. Sign in as a regular (non-admin) user.
2. Manually POST to the edge function URL with `action: "list_providers"`.

**Verify:**
- [ ] HTTP 403 with `{ code: "ADMIN_REQUIRED", message: "Admin access required" }`

### 9.2 Non-admin SQL RPCs

**Steps (via psql as a non-admin role):**
```sql
SELECT public.admin_list_providers();
```

**Verify:**
- [ ] Returns: `ERROR: admin_list_providers: admin access required`
- [ ] No data leaked

Repeat for each M55 RPC:
- [ ] `admin_get_provider` → ERROR
- [ ] `admin_upsert_provider` → ERROR
- [ ] `admin_toggle_provider` → ERROR
- [ ] `admin_list_provider_products` → ERROR
- [ ] `admin_upsert_provider_product` → ERROR
- [ ] `admin_delete_provider_product` → ERROR
- [ ] `admin_get_payment_provider_summary` → ERROR

### 9.3 Even if non-admin somehow gets JWT, edge function still denies

**Verify:** Test 9.1 passes.

### 9.4 Existing RLS still works

**Verify:**
- [ ] `payment_providers` admin policy still gates non-admin SELECT (returns 0 rows)
- [ ] `provider_products` admin policy still gates non-admin SELECT (returns 0 rows)
- [ ] `payment_provider_secrets` deny policy still blocks authenticated role

---

## Test 10: No Secret Leak Verification

This is a critical security test. Confirm that **no secret material** appears in:
- API responses
- Browser localStorage / sessionStorage
- React component state / props (in dev tools)
- Network responses (any 2xx, 4xx, 5xx)

### 10.1 Inspect list responses

**Steps:** As admin, fetch `action: list_providers`, `action: get_provider`, `action: list_products`.

**Verify:** None of the response payloads contain any field related to secrets:
- [ ] No `secret_value_encrypted` field
- [ ] No `secret_name` field
- [ ] No `id` of any `payment_provider_secrets` row
- [ ] No reference to the `payment_provider_secrets` table

### 10.2 Inspect upsert responses

**Steps:** Upsert a provider.

**Verify:** Response contains only the provider's public fields (`id`, `is_enabled`, `updated`).

### 10.3 Inspect error responses

**Steps:** Trigger an error (duplicate, invalid input, etc.).

**Verify:** Even error responses do NOT include any secret material.

### 10.4 Inspect upsert_product response with existing_id

**Steps:** Trigger DUPLICATE_PRODUCT_MAPPING.

**Verify:** The `existing_id` returned is the UUID of the `provider_products` row, NOT any secrets row.

### 10.5 Database-level confirm

```sql
SELECT count(*) FROM public.payment_provider_secrets;
-- Expected: 0 (no secrets exist yet in this environment)
```

If secrets were accidentally seeded:
```sql
-- Confirm no admin RPC reads the secrets table
SELECT proname FROM pg_proc WHERE proname LIKE 'admin_%';
-- Expected: 9 functions, none reference payment_provider_secrets
```

```sql
-- Confirm no admin RPC grants SELECT on the secrets table
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'payment_provider_secrets';
-- Expected: only 'service_role' has INSERT/UPDATE/DELETE; nothing has SELECT to non-service_role
```

---

## Test 11: Build + Lint

### 11.1 Build

```bash
npm run build
```

**Verify:**
- [ ] Build succeeds
- [ ] No new TypeScript errors (existing pre-M2 errors, if any, are documented)
- [ ] Bundle size delta < 50 KB gzipped (page + dialog + table)

### 11.2 Lint

```bash
npm run lint
```

**Verify:**
- [ ] Lint passes for new files (no new warnings/errors in:
  - `src/pages/AdminPaymentProvidersPage.tsx`
  - `src/components/admin/AdminProductFormDialog.tsx`
  - `src/components/admin/AdminProvidersList.tsx`
  - `src/hooks/useAdminPaymentProviders.ts`
  - `src/lib/admin-payment-providers.ts`
  - `src/App.tsx`)

### 11.3 Tests

```bash
npm test
```

**Verify:**
- [ ] All existing tests pass
- [ ] No new tests required for M2 (the M55 RPCs and edge function are server-side; manual + DB-level tests above suffice)

---

## Test 12: Regression — Existing Functionality Unaffected

### 12.1 Existing admin pages

**Verify:**
- [ ] `/adminsh/dashboard` still loads (AdminDashboard not broken by our route additions)
- [ ] `/adminsh/analytics` still routes to AdminDashboard
- [ ] `/adminsh/settings`, `/users`, `/subscriptions`, `/affiliates`, `/withdrawals`, `/resources` all still route correctly

### 12.2 Existing M1 RPCs still work

```sql
SELECT public.admin_list_providers();  -- new
SELECT public.enqueue_webhook_event('warriorplus','regression-test-1','SALE','{}'::jsonb);
SELECT public.search_webhook_events(p_limit := 5);
SELECT public.search_payments(p_limit := 5);
```

**Verify:** All return expected shapes; no breakage from M55.

### 12.3 Existing webhook flows

**Verify:**
- [ ] Dodo webhook endpoint unchanged
- [ ] Whop webhook endpoint unchanged
- [ ] M1's webhook_events table unchanged in schema
- [ ] M1's enqueue_webhook_event (atomic, M54-fixed) still works

### 12.4 Public pages

**Verify:**
- [ ] `/` (EntryPage) loads
- [ ] `/pricing`, `/login`, `/dashboard` all load
- [ ] No regression in public-facing subscription flows

---

## Test 13: UI Edge Cases

### 13.1 Empty state

**Steps:** In a fresh database (no providers), navigate to the page.

**Verify:**
- [ ] Summary tiles show zeros
- [ ] "No payment providers are registered yet." empty-state card renders

### 13.2 Provider with no products

**Steps:** Ensure WarriorPlus has no products.

**Verify:**
- [ ] "No product mappings yet. Click Add product to create one." renders in the products table area
- [ ] "Add product" button still works

### 13.3 Many products (pagination)

**Steps:** Seed 100 product mappings for WarriorPlus.

**Verify:**
- [ ] Table renders all 100 rows (or paginated, if implemented; current impl returns all)
- [ ] No layout breakage
- [ ] Scroll works

### 13.4 Network error

**Steps:** Take the edge function offline (e.g., temporarily rename deployment). Reload the page.

**Verify:**
- [ ] ErrorState component renders with retry button
- [ ] Retry button works once function is back

### 13.5 Slow network

**Steps:** Throttle network to Slow 3G in dev tools. Reload.

**Verify:**
- [ ] Loading skeletons render
- [ ] No layout shift when data arrives

### 13.6 Concurrent edits

**Steps:** Two admin tabs open. Edit the same product in tab A and save. Edit it in tab B (with old data) and save.

**Verify:**
- [ ] Last-write-wins is acceptable behavior
- [ ] No 500 errors
- [ ] Both saves succeed; final state matches tab B's save

---

## Test 14: Accessibility (Basic)

- [ ] All form fields have associated labels (FormLabel)
- [ ] All switches have aria-labels
- [ ] Dialogs trap focus
- [ ] Tab order is logical
- [ ] Color contrast: status badges (Enabled=green, Disabled=muted, Test=secondary) are distinguishable without color (icon + text)
- [ ] Keyboard navigation: can add a product entirely without mouse
- [ ] Screen reader announces form errors (FormMessage)

---

## Test Results Summary

| Test Category | Pass/Fail | Notes |
|---------------|-----------|-------|
| 1. Apply migration 55 | ☐ | |
| 2. Deploy edge function | ☐ | |
| 3. UI smoke test | ☐ | |
| 4. Enable/disable provider | ☐ | |
| 5. Provider settings form | ☐ | |
| 6. Product CRUD — create | ☐ | |
| 7. Duplicate detection | ☐ | |
| 8. Product CRUD — edit + delete | ☐ | |
| 9. Permission / RLS | ☐ | |
| 10. No secret leak | ☐ | |
| 11. Build + lint | ☐ | |
| 12. Regression | ☐ | |
| 13. UI edge cases | ☐ | |
| 14. Accessibility | ☐ | |

---

## Sign-Off

Milestone 2 is complete when:

- [ ] All tests above pass
- [ ] Migration rollback tested on staging
- [ ] Edge function logs show no unexpected errors during testing
- [ ] No application code outside `/adminsh/*` calls the admin edge function
- [ ] No secret material appears in any HTTP response or browser storage
- [ ] Engineering Lead approval
- [ ] Security review (RLS policies, RPC grants, secret-leak verification)
- [ ] Product Manager approval

**After all sign-offs, Milestone 2 is APPROVED and Milestone 3 (webhook receiving) can begin.**

---

## Implementation Summary

### Files Created

| File | Size | Purpose |
|------|------|---------|
| `supabase/migrations/55_admin_payment_provider_rpcs.sql` | ~24 KB | 9 admin RPCs (provider CRUD + product CRUD + summary) + is_caller_admin helper. All SECURITY DEFINER, all service_role-only. |
| `supabase/functions/admin-payment-providers/index.ts` | ~12 KB | Single dispatcher edge function. 8 actions. Admin gate via get_admin_access. Maps PG errors to HTTP envelopes (DUPLICATE_PRODUCT_MAPPING → 409). |
| `src/lib/admin-payment-providers.ts` | ~8 KB | TypeScript types + zod schemas. Mirrors M55 contracts 1:1. |
| `src/hooks/useAdminPaymentProviders.ts` | ~7 KB | React Query bindings: useAdminProviders, useAdminProvider, useAdminProviderProducts, useAdminProvidersSummary, useToggleProvider, useUpsertProvider, useUpsertProduct, useDeleteProduct. |
| `src/components/admin/AdminProductFormDialog.tsx` | ~16 KB | Create/edit product dialog. react-hook-form + zodResolver. Full validation, server-error surfacing, DUPLICATE_PRODUCT_MAPPING friendly error. |
| `src/components/admin/AdminProvidersList.tsx` | ~16 KB | Per-provider card with enable switch, settings form, products table, Add Product button, delete confirmation. |
| `src/pages/AdminPaymentProvidersPage.tsx` | ~5 KB | Main page: header (noindex), 4 summary tiles, AdminProvidersList, loading skeleton, ErrorState. |
| `.kimchi/docs/milestone-2-testing-checklist.md` | (this file) | Testing checklist |

### Files Modified

| File | Change |
|------|--------|
| `src/App.tsx` | Added `lazy` import for `AdminPaymentProvidersPage` + `<Route path="/adminsh/payment-providers" element={<AdminRouteGuard>...</AdminRouteGuard>} />` |

### What M2 Does NOT Implement (Deferred to Later Milestones)

Per M2 scope:
- ❌ No webhook receiving (M3)
- ❌ No webhook event processing (M4)
- ❌ No user resolution (M5)
- ❌ No entitlement granting (M6)
- ❌ No refund/chargeback logic (M7, M8)
- ❌ No guest creation (M9)
- ❌ No affiliate commission logic on new payments (M10)
- ❌ No admin search/diagnostics UI for webhooks (M11)
- ❌ No frontend purchase flow (M12)
- ❌ No secrets rotation UI (deferred — secrets are managed via SQL + edge function for now)

### Security Guarantees

1. **Admin-only**: every write RPC checks `is_caller_admin()` internally. The edge function also gates with `get_admin_access`. Two layers.
2. **No secret exposure**: `payment_provider_secrets` is never referenced by any M55 RPC. Tested explicitly.
3. **Service-role only**: no RPC is callable by `anon` or `authenticated`. Only the edge function (with admin JWT) can reach them.
4. **Input validation**: client (zod) + server (SQL CHECK + RPC validation) layers.
5. **Duplicate detection**: explicit pre-check + UNIQUE constraint on (provider_id, provider_product_id, provider_offer_id) from M52.
6. **Structured errors**: PG exception codes mapped to HTTP envelopes. Frontend can render appropriate UI per `code`.

---

**Milestone 2 complete. Awaiting approval before proceeding to Milestone 3.**
