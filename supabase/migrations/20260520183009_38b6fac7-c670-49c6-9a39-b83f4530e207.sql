DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Admins can update all profiles'
  ) THEN
    CREATE POLICY "Admins can update all profiles"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'))
      WITH CHECK (public.get_admin_role(auth.uid()) IN ('super_admin', 'admin', 'support'));
  END IF;
END $$;