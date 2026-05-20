
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS hashtag_scans_used integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS hashtag_scans_reset_at timestamp with time zone DEFAULT now();
