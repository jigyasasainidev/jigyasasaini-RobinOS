REVOKE ALL ON FUNCTION public.apply_referral_commission_for_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_referral_commission_for_subscription() FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_referral_commission_for_subscription() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_referral_commission_for_subscription() FROM service_role;

ALTER FUNCTION public.initialize_user_account(text) SECURITY INVOKER;
ALTER FUNCTION public.initialize_user_account() SECURITY INVOKER;