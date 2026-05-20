
-- Add video_api_key column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS video_api_key text DEFAULT NULL;
