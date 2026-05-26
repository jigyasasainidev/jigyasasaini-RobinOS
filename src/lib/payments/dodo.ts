// ============================================================
// ROBINOS DODO PAYMENTS CLIENT — FRONTEND SERVICE LAYER
// ============================================================
// All payment operations go through this module.
// No direct SDK usage in UI components.
// Server-side secrets never touch this file.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  BillingCycle,
  PlanKey,
} from "./types";

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── Internal helper: call a Supabase edge function ─────────
async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "apikey":         SUPABASE_ANON_KEY,
      "Content-Type":   "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error ?? json?.message ?? `Edge function ${name} failed (${res.status})`);
  }

  return json as T;
}

// ── Create checkout session ────────────────────────────────
// Calls the create-checkout edge function which uses the
// Dodo SDK server-side (secret key never exposed to browser).
export async function createCheckoutSession(
  req: CheckoutSessionRequest
): Promise<CheckoutSessionResponse> {
  return callEdgeFunction<CheckoutSessionResponse>("create-checkout", {
    planKey:      req.planKey,
    billingCycle: req.billingCycle,
    userId:       req.userId,
    userEmail:    req.userEmail,
    userName:     req.userName ?? "",
  });
}

// ── Redirect to Dodo hosted checkout ──────────────────────
export async function redirectToCheckout(
  planKey: PlanKey,
  billingCycle: BillingCycle,
  userEmail: string,
  userName?: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { checkoutUrl } = await createCheckoutSession({
    planKey,
    billingCycle,
    userId:    user.id,
    userEmail: userEmail || user.email || "",
    userName,
  });

  window.location.href = checkoutUrl;
}

// ── Open customer portal ───────────────────────────────────
// Calls the customer-portal edge function which returns a
// Dodo-hosted portal URL for managing billing.
export async function openCustomerPortal(): Promise<void> {
  const { portalUrl } = await callEdgeFunction<{ portalUrl: string }>(
    "customer-portal",
    {}
  );
  window.open(portalUrl, "_blank", "noopener,noreferrer");
}

// ── Cancel subscription ────────────────────────────────────
export async function cancelSubscription(): Promise<{ success: boolean }> {
  return callEdgeFunction<{ success: boolean }>("cancel-subscription", {});
}
