-- RobinOS: Fix affiliate_wallets RLS insert policy
-- Issue: authenticated users cannot INSERT into affiliate_wallets during account initialization
--   because no INSERT policy exists for regular users.
-- Fix: add user-scoped INSERT policy matching the pattern used by affiliate_profiles
--   and all other user-owned tables in the codebase.
-- Security: users can ONLY insert rows where user_id = their own auth.uid()

-- Add insert policy for authenticated users to create their own wallet
drop policy if exists "Users can insert own affiliate wallet" on public.affiliate_wallets;
create policy "Users can insert own affiliate wallet"
  on public.affiliate_wallets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Verify existing policies remain intact
-- "Users can view own affiliate wallet" - select using (auth.uid() = user_id) ✓
-- "Admins can manage affiliate wallets" - all for admins ✓
-- The new policy is scoped to INSERT only, with row-level check
-- preventing users from creating wallets for other users.