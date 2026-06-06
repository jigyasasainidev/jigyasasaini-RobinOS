# RobinOS — Affiliate Integrity Verification Suite

## Overview

Production-grade, read-only SQL verification infrastructure for the RobinOS affiliate attribution pipeline. Designed for **deterministic debugging**, **financial reconciliation**, and **operational observability**.

**Zero mutations.** Safe to run against production.

## File Structure

```
scripts/sql/
├── verify_affiliate_integrity.sql   # Main verification suite
└── README_affiliate_integrity.md    # This file
```

## Usage

### Option 1: Supabase SQL Editor (Recommended for ad-hoc checks)

1. Open your Supabase project → **SQL Editor**
2. Paste the entire file or a specific section
3. Run against your database

### Option 2: psql CLI

```bash
# Full suite
psql "$SUPABASE_DB_URL" -f scripts/sql/verify_affiliate_integrity.sql

# Single section (e.g., Section 10 — End-to-End Trace)
psql "$SUPABASE_DB_URL" -c "$(sed -n '/SECTION 10 —/,/SECTION 11 —/p' scripts/sql/verify_affiliate_integrity.sql)"
```

### Option 3: Supabase CLI

```bash
supabase db query --file scripts/sql/verify_affiliate_integrity.sql
```

## Section Reference

| # | Section | Purpose |
|---|---------|---------|
| 1 | **System Health Checks** | 15 deterministic PASS/WARN/FAIL checks covering the entire affiliate system |
| 2 | **Orphan Detection** | 9 orphan types: broken FK references across all affiliate tables |
| 3 | **Referral Integrity** | Validates referral code → profile → referral chain |
| 4 | **Commission Integrity** | Financial correctness: status distribution, duplicates, stuck pending, ratio anomalies |
| 5 | **Wallet & Ledger Integrity** | Balance reconciliation: wallet vs ledger sums, cross-table drift detection |
| 6 | **Trigger Verification Support** | Validates `trg_apply_referral_commission_for_subscription` fires correctly |
| 7 | **Expiry Validation** | 7-day window enforcement, stale referral detection, code reuse |
| 8 | **First-Touch Attribution** | Overwrite prevention, multi-affiliate attribution detection |
| 9 | **Duplicate Detection** | Duplicate referrals, conversions, commissions, ledger entries |
| 10 | **End-to-End Trace Queries** | **Primary debugging tool.** Full attribution chain in a single query |
| 11 | **Operational Metrics** | 20+ aggregate metrics for system monitoring |
| 12 | **Manual Debug Queries** | 15 commented-out quick-inspect snippets |
| 13 | **Consolidated Health Score** | Single PASS/WARN/FAIL with detailed breakdown |

## Key Tables Referenced

| Table | Role |
|-------|------|
| `profiles` | User profiles with `referred_by_code` and `referral_code` |
| `affiliate_profiles` | Affiliate accounts with referral codes and balances |
| `affiliate_referrals` | Referral records linking affiliate → referred user |
| `affiliate_conversions` | Conversion records (signup → subscription) |
| `affiliate_commissions` | Commission records with lifecycle (pending → approved → payable → paid) |
| `commission_events` | Immutable audit trail for commission lifecycle transitions |
| `affiliate_wallets` | Wallet balances (available, pending, lifetime) |
| `affiliate_wallet_ledger` | Immutable ledger of all financial movements |
| `user_subscriptions` | Subscription records that trigger commission generation |
| `withdrawal_requests` | Payout requests |
| `payout_history` | Completed payout records |

## Trigger Under Verification

**`trg_apply_referral_commission_for_subscription`** (defined in `apply_referral_commission_for_subscription()`)

- Fires on `INSERT` or `UPDATE of status, plan, amount` on `user_subscriptions`
- Creates commission + wallet ledger entry for eligible referred subscriptions
- Section 6 specifically validates this trigger's correctness

## Safety Guarantees

- **ONLY** `SELECT`, `WITH`, `CTE` — no data mutation
- No `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE`
- No triggers, no functions, no schema changes
- `LIMIT` clauses on detail queries to prevent runaway results
- Index-aware queries leveraging existing indexes

## Debugging Workflow

### 1. Quick Health Check
Run **Section 13** (Consolidated Health Score) for a single PASS/WARN/FAIL verdict.

### 2. Investigate Warnings
If WARN/FAIL, run **Section 1** (System Health Checks) to identify specific problem areas.

### 3. Deep Dive
- **Orphans** → Section 2
- **Commissions** → Section 4
- **Wallet drift** → Section 5
- **Trigger issues** → Section 6

### 4. Trace a Specific User
Use **Section 10b** (Trace by Specific User) with a user UUID or email.

### 5. Full Attribution Chain
Use **Section 10** (End-to-End Trace) with a subscription ID, user ID, or affiliate code.

## Example: Debugging a Missing Commission

```sql
-- 1. Check if the subscription exists and is eligible
SELECT * FROM public.user_subscriptions WHERE id = 'SUBSCRIPTION-UUID';

-- 2. Check if the user has a referred_by_code
SELECT user_id, referred_by_code FROM public.profiles
WHERE user_id = (SELECT user_id FROM public.user_subscriptions WHERE id = 'SUBSCRIPTION-UUID');

-- 3. Run Section 6 trigger verification
-- 4. Run Section 10d commission trace
```

## Maintenance

This file is **read-only verification infrastructure**. It should be updated when:

- New affiliate tables or columns are added
- The commission trigger logic changes
- New integrity checks are needed
- Schema migrations affect affiliate tables

**Do not** add mutation logic to this file. Create separate migration scripts for schema changes.