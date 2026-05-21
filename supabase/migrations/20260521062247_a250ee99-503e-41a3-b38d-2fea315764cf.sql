ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trending_scans_used integer,
  ADD COLUMN IF NOT EXISTS trending_scans_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS hashtag_scans_used integer,
  ADD COLUMN IF NOT EXISTS hashtag_scans_reset_at timestamptz;

UPDATE public.profiles
SET
  trending_scans_used = COALESCE(trending_scans_used, 0),
  trending_scans_reset_at = COALESCE(trending_scans_reset_at, now()),
  hashtag_scans_used = COALESCE(hashtag_scans_used, 0),
  hashtag_scans_reset_at = COALESCE(hashtag_scans_reset_at, now())
WHERE
  trending_scans_used IS NULL
  OR trending_scans_reset_at IS NULL
  OR hashtag_scans_used IS NULL
  OR hashtag_scans_reset_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN trending_scans_used SET DEFAULT 0,
  ALTER COLUMN trending_scans_reset_at SET DEFAULT now(),
  ALTER COLUMN hashtag_scans_used SET DEFAULT 0,
  ALTER COLUMN hashtag_scans_reset_at SET DEFAULT now();

ALTER TABLE public.profiles
  ALTER COLUMN trending_scans_used SET NOT NULL,
  ALTER COLUMN trending_scans_reset_at SET NOT NULL,
  ALTER COLUMN hashtag_scans_used SET NOT NULL,
  ALTER COLUMN hashtag_scans_reset_at SET NOT NULL;