// ============================================================
// CUSTOMER-PORTAL — Dodo Payments billing portal
// ============================================================
// Returns a Dodo-hosted portal URL for managing billing.
// The portal allows: cancel subscription, update payment method.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DODO_API_KEY = Deno.env.get("DODO_SECRET_KEY")!;
const DODO_ENV     = (Deno.env.get("DODO_ENVIRONMENT") ?? "test_mode") as "test_mode" | "live_mode";
const APP_URL      = Deno.env.get("APP_URL") ?? "https://tryrobin.xyz";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const token    = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

    if (authErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Get subscription to find provider_subscription_id
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("provider_subscription_id, provider, plan, status")
      .eq("user_id", user.id)
      .single();

    if (!sub?.provider_subscription_id || sub.provider !== "dodo") {
      return new Response(JSON.stringify({
        error: "No active Dodo subscription found. Please subscribe first.",
        code:  "NO_SUBSCRIPTION",
      }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Dodo doesn't have a dedicated portal endpoint — return the subscription
    // management URL. For now, return a deep link to the Dodo dashboard.
    // When Dodo releases a customer portal API, update this.
    const dodo = new DodoPayments({ bearerToken: DODO_API_KEY, environment: DODO_ENV });

    // Retrieve subscription to get customer_id
    const subscription = await dodo.subscriptions.retrieve(sub.provider_subscription_id);
    const customerId   = (subscription as any)?.customer?.customer_id;

    // Construct portal URL — Dodo's customer portal
    // Format: https://app.dodopayments.com/customer-portal/{customer_id}
    const portalUrl = customerId
      ? `https://app.dodopayments.com/customer-portal/${customerId}`
      : `${APP_URL}/dashboard/settings`;

    return new Response(JSON.stringify({ portalUrl }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[customer-portal] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
