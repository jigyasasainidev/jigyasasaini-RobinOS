CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS TABLE (
  creator_price numeric,
  pro_price numeric,
  agency_price numeric,
  free_scripts_limit integer,
  free_scans_limit integer,
  affiliate_commission_percent numeric,
  minimum_withdrawal numeric,
  payout_delay_days integer,
  maintenance_mode boolean,
  announcement_banner text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ps.creator_price,
    ps.pro_price,
    ps.agency_price,
    ps.free_scripts_limit,
    ps.free_scans_limit,
    ps.affiliate_commission_percent,
    ps.minimum_withdrawal,
    ps.payout_delay_days,
    ps.maintenance_mode,
    ps.announcement_banner,
    ps.updated_at
  FROM public.platform_settings ps
  ORDER BY ps.updated_at DESC
  LIMIT 1;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_settings'
      AND policyname = 'Public can read platform settings'
  ) THEN
    CREATE POLICY "Public can read platform settings"
      ON public.platform_settings
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;