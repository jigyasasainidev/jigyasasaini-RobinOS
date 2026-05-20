-- Allow admins to view all withdrawals
CREATE POLICY "Admins can view all withdrawals"
ON public.affiliate_withdrawals
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to update withdrawal status
CREATE POLICY "Admins can update withdrawals"
ON public.affiliate_withdrawals
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));