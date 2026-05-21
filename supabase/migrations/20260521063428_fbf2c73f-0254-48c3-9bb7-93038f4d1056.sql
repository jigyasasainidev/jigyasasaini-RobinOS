CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  action_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can manage admin audit logs"
  ON public.admin_audit_logs
  FOR ALL
  TO authenticated
  USING (
    public.get_admin_role(auth.uid()) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'support'::text])
  )
  WITH CHECK (
    public.get_admin_role(auth.uid()) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'support'::text])
  );

CREATE OR REPLACE FUNCTION public.admin_write_log(
  p_action_type text,
  p_target_id text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_admin_user_id uuid := auth.uid();
BEGIN
  IF v_admin_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF public.get_admin_role(v_admin_user_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_user_id,
    action_type,
    target_id,
    details
  )
  VALUES (
    v_admin_user_id,
    COALESCE(NULLIF(trim(p_action_type), ''), 'manual_action'),
    COALESCE(NULLIF(trim(p_target_id), ''), 'unknown'),
    COALESCE(p_details, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_write_log(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_write_log(text, text, jsonb) TO authenticated;