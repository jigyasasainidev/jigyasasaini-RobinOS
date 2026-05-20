
-- Table to store user scan history
CREATE TABLE public.scan_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  niche TEXT NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scans" ON public.scan_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scans" ON public.scan_history FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_scan_history_user ON public.scan_history(user_id, created_at DESC);

-- Table to store generated scripts
CREATE TABLE public.script_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  topic TEXT NOT NULL,
  tone TEXT NOT NULL,
  length TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.script_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scripts" ON public.script_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scripts" ON public.script_history FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_script_history_user ON public.script_history(user_id, created_at DESC);
