DROP POLICY IF EXISTS "No direct access to usage events" ON public.feature_usage_events;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='feature_usage_events' AND policyname='Users can view own usage events'
  ) THEN
    CREATE POLICY "Users can view own usage events"
      ON public.feature_usage_events
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='feature_usage_events' AND policyname='Users can insert own usage events'
  ) THEN
    CREATE POLICY "Users can insert own usage events"
      ON public.feature_usage_events
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

ALTER FUNCTION public.consume_feature_quota(text, integer, text) SECURITY INVOKER;
ALTER FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) SECURITY INVOKER;