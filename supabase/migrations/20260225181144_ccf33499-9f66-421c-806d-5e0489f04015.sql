
-- Create signup_ips table for IP-based anti-spam
CREATE TABLE public.signup_ips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS (service role only - no user policies)
ALTER TABLE public.signup_ips ENABLE ROW LEVEL SECURITY;

-- Add free trial columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_scans_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_scripts_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_trial_started_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS free_trial_expired boolean DEFAULT false;
