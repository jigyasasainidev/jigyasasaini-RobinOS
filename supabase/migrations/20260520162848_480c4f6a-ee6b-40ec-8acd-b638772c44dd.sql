-- Keep usage-status function least-privilege and callable by signed-in users
ALTER FUNCTION public.get_usage_status(text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.get_usage_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_status(text) TO service_role;

-- Allow authenticated clients to read entitlement limits required by get_usage_status
DROP POLICY IF EXISTS "Authenticated users can view entitlements" ON public.subscription_entitlements;
CREATE POLICY "Authenticated users can view entitlements"
ON public.subscription_entitlements
FOR SELECT
TO authenticated
USING (true);