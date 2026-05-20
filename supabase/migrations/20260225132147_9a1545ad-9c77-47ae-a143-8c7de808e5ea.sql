
-- Create global_settings table
CREATE TABLE public.global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read settings (needed for Razorpay key on frontend)
CREATE POLICY "Authenticated users can read settings"
ON public.global_settings FOR SELECT
TO authenticated
USING (true);

-- Only admins can insert settings
CREATE POLICY "Admins can insert settings"
ON public.global_settings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update settings
CREATE POLICY "Admins can update settings"
ON public.global_settings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create payments table
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  plan TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Users can view own payments
CREATE POLICY "Users can view own payments"
ON public.payments FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can view all payments
CREATE POLICY "Admins can view all payments"
ON public.payments FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Service role inserts payments (from edge functions)
CREATE POLICY "Service can insert payments"
ON public.payments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Service can update payments
CREATE POLICY "Service can update payments"
ON public.payments FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Insert initial Razorpay key
INSERT INTO public.global_settings (key, value) VALUES ('razorpay_key_id', 'rzp_live_SKONUTitWuK9dY');
