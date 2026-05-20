DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_allowlist' AND policyname = 'No direct access to admin allowlist'
  ) THEN
    CREATE POLICY "No direct access to admin allowlist"
    ON public.admin_allowlist
    FOR ALL
    USING (false)
    WITH CHECK (false);
  END IF;
END
$$;