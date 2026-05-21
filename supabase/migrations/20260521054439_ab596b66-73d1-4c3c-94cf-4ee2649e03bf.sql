CREATE TABLE IF NOT EXISTS public.script_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic text NOT NULL,
  tone text NOT NULL DEFAULT 'Casual',
  length text NOT NULL DEFAULT '60s Reel',
  output text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.script_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_id text NOT NULL,
  prompt text NOT NULL,
  tone text NOT NULL DEFAULT 'Casual',
  content_length text NOT NULL DEFAULT '60s Reel',
  generated_output text NOT NULL DEFAULT '',
  generation_status text NOT NULL DEFAULT 'succeeded',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, request_id)
);

CREATE TABLE IF NOT EXISTS public.caption_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_id text NOT NULL,
  platform text NOT NULL,
  generation_style text NOT NULL,
  prompt text NOT NULL,
  generated_caption text NOT NULL,
  generated_hashtags text[] NOT NULL DEFAULT '{}',
  generated_keywords text[] NOT NULL DEFAULT '{}',
  is_saved boolean NOT NULL DEFAULT false,
  generation_status text NOT NULL DEFAULT 'succeeded',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, request_id)
);

CREATE TABLE IF NOT EXISTS public.feature_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature_name text NOT NULL,
  increment_by integer NOT NULL DEFAULT 1,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, feature_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_script_history_user_created_at ON public.script_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_script_generations_user_created_at ON public.script_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caption_generations_user_created_at ON public.caption_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_events_user_created_at ON public.feature_usage_events(user_id, created_at DESC);

ALTER TABLE public.script_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caption_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_usage_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_history' AND policyname='Users can view own scripts'
  ) THEN
    CREATE POLICY "Users can view own scripts"
      ON public.script_history
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='script_history' AND policyname='Users can insert own scripts'
  ) THEN
    CREATE POLICY "Users can insert own scripts"
      ON public.script_history
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='caption_generations' AND policyname='Users can view own caption generations'
  ) THEN
    CREATE POLICY "Users can view own caption generations"
      ON public.caption_generations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='caption_generations' AND policyname='Users can insert own caption generations'
  ) THEN
    CREATE POLICY "Users can insert own caption generations"
      ON public.caption_generations
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='caption_generations' AND policyname='Users can update own caption generations'
  ) THEN
    CREATE POLICY "Users can update own caption generations"
      ON public.caption_generations
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_caption_generations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caption_generations_updated_at ON public.caption_generations;
CREATE TRIGGER trg_caption_generations_updated_at
BEFORE UPDATE ON public.caption_generations
FOR EACH ROW
EXECUTE FUNCTION public.touch_caption_generations_updated_at();

CREATE OR REPLACE FUNCTION public.consume_feature_quota(
  p_feature_name text,
  p_increment integer DEFAULT 1,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_status_before jsonb;
  v_status_after jsonb;
  v_existing_event uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF COALESCE(p_increment, 0) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid increment');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_event
    FROM public.feature_usage_events
    WHERE user_id = v_user_id
      AND feature_name = p_feature_name
      AND idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing_event IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'status', public.get_usage_status(p_feature_name)
      );
    END IF;
  END IF;

  v_status_before := public.get_usage_status(p_feature_name);

  IF COALESCE((v_status_before->>'allowed')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'status', v_status_before);
  END IF;

  UPDATE public.profiles
  SET
    scripts_used_this_month = COALESCE(scripts_used_this_month, 0) + p_increment,
    updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.feature_usage_events (user_id, feature_name, increment_by, idempotency_key)
  VALUES (v_user_id, p_feature_name, p_increment, p_idempotency_key)
  ON CONFLICT (user_id, feature_name, idempotency_key) DO NOTHING;

  v_status_after := public.get_usage_status(p_feature_name);

  RETURN jsonb_build_object('ok', true, 'status', v_status_after);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_feature_quota(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_feature_quota(text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_caption_generation_if_allowed(
  p_request_id text,
  p_platform text,
  p_generation_style text,
  p_prompt text,
  p_generated_caption text,
  p_generated_hashtags text[] DEFAULT '{}',
  p_generated_keywords text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_consume_result jsonb;
  v_status jsonb;
  v_generation public.caption_generations;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  v_consume_result := public.consume_feature_quota('captions', 1, COALESCE(NULLIF(trim(p_request_id), ''), gen_random_uuid()::text));

  IF COALESCE((v_consume_result->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', COALESCE(v_consume_result->'status', public.get_usage_status('captions'))
    );
  END IF;

  INSERT INTO public.caption_generations (
    user_id,
    request_id,
    platform,
    generation_style,
    prompt,
    generated_caption,
    generated_hashtags,
    generated_keywords,
    generation_status
  )
  VALUES (
    v_user_id,
    COALESCE(NULLIF(trim(p_request_id), ''), gen_random_uuid()::text),
    lower(trim(p_platform)),
    lower(trim(p_generation_style)),
    p_prompt,
    p_generated_caption,
    COALESCE(p_generated_hashtags, '{}'),
    COALESCE(p_generated_keywords, '{}'),
    'succeeded'
  )
  ON CONFLICT (user_id, request_id)
  DO UPDATE SET
    generated_caption = EXCLUDED.generated_caption,
    generated_hashtags = EXCLUDED.generated_hashtags,
    generated_keywords = EXCLUDED.generated_keywords,
    generation_status = 'succeeded',
    updated_at = now()
  RETURNING * INTO v_generation;

  v_status := public.get_usage_status('captions');

  RETURN jsonb_build_object(
    'ok', true,
    'generation', to_jsonb(v_generation),
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_caption_generation_if_allowed(text, text, text, text, text, text[], text[]) TO authenticated;