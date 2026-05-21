DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_generations' AND policyname='Users can view own script generations'
  ) THEN
    CREATE POLICY "Users can view own script generations"
      ON public.script_generations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='feature_usage_events' AND policyname='No direct access to usage events'
  ) THEN
    CREATE POLICY "No direct access to usage events"
      ON public.feature_usage_events
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

ALTER FUNCTION public.consume_feature_quota(text, integer, text) SECURITY INVOKER;
ALTER FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) SECURITY INVOKER;