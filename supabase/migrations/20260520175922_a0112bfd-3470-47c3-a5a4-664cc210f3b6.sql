ALTER FUNCTION public.initialize_user_account(text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.initialize_user_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_user_account(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.initialize_user_account(text) TO authenticated;