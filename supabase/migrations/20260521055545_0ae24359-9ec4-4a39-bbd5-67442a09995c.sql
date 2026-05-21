REVOKE ALL ON FUNCTION public.consume_feature_quota(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.consume_feature_quota(text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.consume_feature_quota(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_feature_quota(text, integer, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) TO service_role;