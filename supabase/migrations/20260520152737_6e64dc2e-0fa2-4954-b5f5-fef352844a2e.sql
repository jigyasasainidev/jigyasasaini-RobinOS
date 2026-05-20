REVOKE EXECUTE ON FUNCTION public.initialize_user_account(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.initialize_user_account(text) TO authenticated;