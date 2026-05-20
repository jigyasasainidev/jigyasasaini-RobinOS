
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS trending_scans_used integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS trending_scans_reset_at timestamptz DEFAULT now();
