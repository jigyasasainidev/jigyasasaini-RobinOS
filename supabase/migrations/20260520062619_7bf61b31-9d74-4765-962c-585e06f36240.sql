CREATE OR REPLACE FUNCTION public.get_live_business_controls()
RETURNS public.platform_settings
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.platform_settings
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_live_business_controls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_business_controls() TO authenticated;