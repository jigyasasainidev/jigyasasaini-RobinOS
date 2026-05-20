-- Ensure usage-status can read protected entitlement rows while still enforcing caller identity via auth.uid()
ALTER FUNCTION public.get_usage_status(text) SECURITY DEFINER;

-- Keep execution scoped to trusted roles
REVOKE ALL ON FUNCTION public.get_usage_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_status(text) TO service_role;