CREATE POLICY "Users can create own affiliate wallet"
ON public.affiliate_wallets
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);