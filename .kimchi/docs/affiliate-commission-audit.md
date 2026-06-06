# Affiliate Commission Architecture Audit

## Executive Summary

The admin panel "Commission %" value **IS** connected to the live payout system. Changing it from 30 to 60 **WILL** affect all **NEW** commissions going forward. No migration is required. Existing commissions stored in the database will NOT retroactively change because the commission `amount` is pre-calculated and stored at payment time.

---

## 1. Commission Percentage Storage

| Field | Table | Type |
|-------|-------|------|
| `affiliate_commission_percent` | `platform_settings` | `numeric` |

**Location:** `public.platform_settings` (single-row settings table, ordered by `updated_at DESC LIMIT 1`)

**Admin UI binding:** `src/pages/AdminDashboard.tsx:1909` — Input field `"Commission %"` directly bound to `settingsDraft.affiliate_commission_percent`. Saved via UPDATE to `platform_settings` row.

---

## 2. Full Commission Flow

```
[Admin Panel Input]
        ↓ (saves to)
[platform_settings.affiliate_commission_percent]
        ↓ (read live by)
┌─────────────────────────────────────────────┐
│  1. record-referral edge function           │
│  2. dodo-webhook edge function              │
│  3. SQL function in migration 34            │
└─────────────────────────────────────────────┘
        ↓ (calculates)
[commission_amount = paymentAmount × (rate / 100)]
        ↓ (stores in)
[affiliate_commissions.amount]
        ↓ (used by)
[payout / withdrawal / analytics functions]
```

---

## 3. Exact Files Involved

### Backend — Commission Calculation

#### a) `supabase/functions/record-referral/index.ts`
- **Role:** Records conversion when a referral code is used
- **Reads:** `platform_settings.affiliate_commission_percent`
- **Fallback:** `FALLBACK_COMMISSION_RATE = 0.30` (30%) if settings row missing
- **Writes:** `affiliate_conversions` table (stores `commission_rate` for tracking)
- **Lines 40-53:**
```ts
const { data: settings } = await supabaseAdmin
  .from("platform_settings")
  .select("affiliate_commission_percent")
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const commissionPercent = Number(settings?.affiliate_commission_percent ?? (FALLBACK_COMMISSION_RATE * 100));
const commissionRate = commissionPercent / 100;
```

#### b) `supabase/functions/dodo-webhook/index.ts`
- **Role:** Records actual commission $ amount when a payment succeeds
- **Reads:** `platform_settings.affiliate_commission_percent`
- **Fallback:** Hardcoded `30` if settings row missing
- **Calculates:** `Math.round(paymentAmount * commissionRate * 100) / 100`
- **Writes:** `affiliate_commissions` table (pre-calculated `amount` stored)
- **Lines 440-450:**
```ts
const commissionPercent = Number(settings?.affiliate_commission_percent ?? 30);
const commissionRate    = commissionPercent / 100;
const commissionAmount  = Math.round(paymentAmount * commissionRate * 100) / 100;
```
- **Also calls:** `increment_affiliate_balance` RPC with the pre-calculated amount

#### c) `supabase/migrations/34_fix_free_expiry_and_referral.sql`
- **Role:** SQL function that handles referral signup conversions
- **Reads:** `platform_settings.affiliate_commission_percent`
- **Fallback:** `coalesce(affiliate_commission_percent, 30) / 100.0`
- **Secondary fallback:** `coalesce(v_commission_rate, 0.30)`
- **Lines 254-261:**
```sql
select coalesce(affiliate_commission_percent, 30) / 100.0
  into v_commission_rate
  from public.platform_settings
 order by updated_at desc
 limit 1;

v_commission_rate := coalesce(v_commission_rate, 0.30);
```

### Backend — Payout / Withdrawal (uses stored amount, NOT percentage)

#### d) `supabase/migrations/42_fix_withdraw_request.sql`
- **Role:** Handles withdrawal requests
- **Reads:** `affiliate_profiles.pending_balance` (pre-computed sum)
- **Does NOT read:** `affiliate_commission_percent`
- **Uses:** Already-calculated commission amounts from `affiliate_commissions.amount`

#### e) `supabase/migrations/43_payout_ledger.sql`
- **Role:** Payout ledger and balance repair
- **Reads:** `affiliate_commissions.amount` (sum of approved/pending/paid statuses)
- **Does NOT read:** `affiliate_commission_percent`
- **Lines 448-455:**
```sql
select
  coalesce(sum(amount) filter (where status = 'approved'), 0),
  coalesce(sum(amount) filter (where status = 'pending'), 0),
  coalesce(sum(amount) filter (where status = 'paid'), 0),
  coalesce(sum(amount) filter (where status not in ('reversed', 'cancelled')), 0)
into v_approved_commissions, v_pending_commissions, v_paid_commissions, v_total_earned
from public.affiliate_commissions
where affiliate_user_id = v_user_id;
```

#### f) `supabase/migrations/38_commission_state_machine.sql`
- **Role:** `increment_affiliate_balance` RPC — adds pre-calculated amount to profile totals
- **Input:** `p_amount` (already-calculated commission dollar amount)
- **Does NOT know:** commission percentage
- **Action:** Atomically increments `locked_balance` and `total_earned`

### Frontend — Admin Panel (Read + Write)

#### g) `src/pages/AdminDashboard.tsx`
- **Reads:** `platformSettings.affiliate_commission_percent` (line 889, 2045)
- **Writes:** `settingsDraft.affiliate_commission_percent` → saved to `platform_settings` (line 1313)
- **Display:** Status bar shows `Commission: X%` (line 2045)
- **Input:** `Commission %` number input (line 1909-1910)

#### h) `src/hooks/usePlatformSettings.ts`
- **Reads:** `platform_settings` row including `affiliate_commission_percent`
- **Used by:** Landing page (to display commission rate from DB) and admin panel

### Frontend — Display Only

#### i) `src/pages/public/LaunchPartnersPage.tsx`
- **Role:** Landing page (marketing display)
- **Previously had hardcoded 50%** — but the actual rate displayed in the hero badge/mock dashboard comes from `usePlatformSettings` if connected
- **Note:** The displayed amounts (`$11.40/mo`, `$23.40/mo`, `$59.40/mo`) are **hardcoded marketing text**, not live calculations. If admin changes commission %, these display values will NOT auto-update unless manually edited.

---

## 4. File Classification (Read / Write / Calc / Display)

| File | Type | Action | Notes |
|------|------|--------|-------|
| `record-referral/index.ts` | Read + Calc | Reads `%` from DB, calculates rate | Stores rate in `affiliate_conversions` |
| `dodo-webhook/index.ts` | Read + Calc + Write | Reads `%`, calculates `$`, writes to `affiliate_commissions` | **Primary commission recorder** |
| `migrations/34_fix_free_expiry_and_referral.sql` | Read + Calc | SQL function reads `%` and computes rate | Handles signup conversion |
| `migrations/42_fix_withdraw_request.sql` | Read only | Reads pre-calculated amounts | No percentage knowledge |
| `migrations/43_payout_ledger.sql` | Read only | Reads pre-calculated amounts | No percentage knowledge |
| `migrations/38_commission_state_machine.sql` | Write only | Receives `$` amount, updates balances | No percentage knowledge |
| `AdminDashboard.tsx` | Read + Write | Admin input ↔ `platform_settings` | The control panel |
| `usePlatformSettings.ts` | Read only | Frontend hook reads settings | For display purposes |
| `LaunchPartnersPage.tsx` | Display only | Marketing text (some hardcoded) | `$11.40/mo` etc. are static |

---

## 5. Hardcoded Values Audit

| Location | Value | Context |
|----------|-------|---------|
| `record-referral/index.ts:21` | `FALLBACK_COMMISSION_RATE = 0.30` | Fallback if DB row missing — should never fire |
| `record-referral/index.ts:50` | `?? (FALLBACK_COMMISSION_RATE * 100)` | Uses fallback above |
| `dodo-webhook/index.ts:448` | `?? 30` | Fallback if DB row missing |
| `migrations/34:255` | `coalesce(..., 30)` | SQL fallback if DB row missing |
| `migrations/34:261` | `coalesce(..., 0.30)` | SQL secondary fallback |
| `LaunchPartnersPage.tsx` | `$11.40`, `$23.40`, `$59.40` | **Hardcoded marketing amounts** — will NOT auto-update if admin changes % |

**Critical finding:** The marketing page shows `$11.40/mo` (60% of $19) but if admin changes commission % to 30, the actual commission drops to $5.70 while the landing page still shows $11.40.

---

## 6. Answer to Questions

### A) If I change Commission % from 30 to 60 in the admin panel, will all affiliate commissions and payouts use 60% automatically?

**Partially YES:**
- ✅ **All NEW commissions** (from the next payment) WILL use 60% automatically.
- ✅ The edge functions (`record-referral`, `dodo-webhook`) read the rate **live** from `platform_settings` on every execution.
- ❌ **Existing commissions** already stored in `affiliate_commissions` table will NOT change. The `amount` was pre-calculated and stored at payment time.
- ❌ **Payouts** of existing commissions remain the same because payouts reference the stored `amount` column, not the percentage.

### B) If not, exactly what is preventing it?

**Nothing prevents new commissions** — the system is correctly wired.

**The only thing "preventing" retroactive change is intentional design:**
- The `affiliate_commissions.amount` column stores the **pre-calculated dollar amount** at payment time.
- Payout/withdrawal functions read `affiliate_commissions.amount`, not `platform_settings.affiliate_commission_percent`.
- This is correct behavior — you don't want to retroactively change commissions already earned.

### C) What database value is currently authoritative?

```
platform_settings.affiliate_commission_percent
```

This is queried live by both edge functions on every payment event. The `platform_settings` table is the single source of truth.

### D) What migration (if any) would actually be required?

**None.** Changing the commission percentage is a simple UPDATE to the `platform_settings` row — no schema migration needed.

However, if you want the **landing page** (`LaunchPartnersPage.tsx`) to reflect the new rate:
- You must manually edit the hardcoded values (`$11.40/mo`, `$23.40/mo`, `$59.40/mo`, example math `$1,170/month`).
- These are static marketing strings, not dynamically calculated from the database.

---

## 7. Recommendations

| # | Issue | Recommendation |
|---|-------|----------------|
| 1 | Landing page displays hardcoded commission amounts | Connect `LaunchPartnersPage.tsx` to `usePlatformSettings` to dynamically calculate and display live commission rates, or establish a manual update process when admin changes % |
| 2 | Three separate fallback values (30%) | Consider standardizing to a single fallback constant shared across edge functions |
| 3 | `get_live_business_controls` RPC exists in frontend but SQL definition not found in migrations | Verify if this is dead code or imported from another module |
