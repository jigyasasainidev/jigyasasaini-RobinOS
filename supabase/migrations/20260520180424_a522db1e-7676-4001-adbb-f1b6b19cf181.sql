CREATE TABLE IF NOT EXISTS public.admin_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_admin_allowlist_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_allowlist_updated_at ON public.admin_allowlist;
CREATE TRIGGER trg_admin_allowlist_updated_at
BEFORE UPDATE ON public.admin_allowlist
FOR EACH ROW
EXECUTE FUNCTION public.set_admin_allowlist_updated_at();

CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  v_role text := NULL;
  v_allowlisted boolean := false;
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'role', NULL,
      'allowlisted', false,
      'is_admin', false
    );
  END IF;

  SELECT ur.role::text
  INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_user_id
  ORDER BY CASE ur.role
    WHEN 'super_admin' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'support' THEN 1
    ELSE 0
  END DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_allowlist a
    WHERE lower(a.email) = v_email
      AND a.is_active = true
  )
  INTO v_allowlisted;

  v_is_admin := (v_role IS NOT NULL) OR v_allowlisted;

  RETURN jsonb_build_object(
    'role', v_role,
    'allowlisted', v_allowlisted,
    'is_admin', v_is_admin
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_role(user_uuid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  v_allowlisted boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF user_uuid IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;

  SELECT ur.role::text
  INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = user_uuid
  ORDER BY CASE ur.role
    WHEN 'super_admin' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'support' THEN 1
    ELSE 0
  END DESC
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_allowlist a
    WHERE lower(a.email) = v_email
      AND a.is_active = true
  )
  INTO v_allowlisted;

  IF v_allowlisted THEN
    RETURN 'admin';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO authenticated;