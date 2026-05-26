// ============================================================
// CREATE-CHECKOUT — Dodo Payments checkout session
// ============================================================
// Creates a hosted checkout session for a subscription plan.
// Called by the frontend dodo.ts service layer.
//
// Security:
//   - Requires authenticated user (JWT verified)
//   - DODO_SECRET_KEY never exposed to browser
//   - Prevents duplicate active subscriptions
//   - Attaches user_id as metadata for webhook attribution
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DODO_API_KEY  = Deno.env.get("DODO_SECRET_KEY")!;
const DODO_ENV      = (Deno.env.get("DODO_ENVIRONMENT") ?? "test_mode") as "test_mode" | "live_mode";
const APP_URL       = Deno.env.get("APP_URL") ?? "https://tryrobin.xyz";

// ── Plan → Dodo Product ID map ─────────────────────────────
// Populated from Supabase secrets. Set these in your Supabase
// project: Settings → Edge Functions → Secrets
const PRODUCT_IDS: Record<string, string> = {
  creator_monthly:     Deno.env.get("DODO_PRODUCT_CREATOR_MONTHLY")     ?? "",
  pro_creator_monthly: Deno.env.get("DODO_PRODUCT_PRO_CREATOR_MONTHLY") ?? "",
  agency_monthly:      Deno.env.get("DODO_PRODUCT_AGENCY_MONTHLY")      ?? "",
  creator_yearly:      Deno.env.get("DODO_PRODUCT_CREATOR_YEARLY")      ?? "",
  pro_creator_yearly:  Deno.env.get("DODO_PRODUCT_PRO_CREATOR_YEARLY")  ?? "",
  agency_yearly:       Deno.env.get("DODO_PRODUCT_AGENCY_YEARLY")       ?? "",
};

const VALID_PLANS    = ["creator", "pro_creator", "agency"] as const;
const VALID_CYCLES   = ["monthly", "yearly"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    // ── Auth ──────────────────────────────────────────────
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

    // ── Parse body ────────────────────────────────────────
    const body = await req.json();
    const planKey:      string = String(body?.planKey      ?? "").toLowerCase();
    const billingCycle: string = String(body?.billingCycle ?? "monthly").toLowerCase();
    const userEmail:    string = String(body?.userEmail    ?? user.email ?? "");
    const userName:     string = String(body?.userName     ?? "");

    if (!VALID_PLANS.includes(planKey as typeof VALID_PLANS[number])) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${planKey}` }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!VALID_CYCLES.includes(billingCycle as typeof VALID_CYCLES[number])) {
      return new Response(JSON.stringify({ error: `Invalid billing cycle: ${billingCycle}` }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Prevent duplicate active subscriptions ────────────
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("plan, status, provider")
      .eq("user_id", user.id)
      .single();

    if (
      existingSub &&
      ["active", "trialing", "expiring"].includes(existingSub.status ?? "") &&
      existingSub.plan !== "free"
    ) {
      return new Response(JSON.stringify({
        error: "You already have an active subscription. Manage it from your settings.",
        code:  "ALREADY_SUBSCRIBED",
      }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Resolve product ID ────────────────────────────────
    const productKey = `${planKey}_${billingCycle}`;
    const productId  = PRODUCT_IDS[productKey];

    if (!productId) {
      console.error(`[create-checkout] Missing product ID for key: ${productKey}`);
      return new Response(JSON.stringify({
        error: "This plan is not yet available for purchase. Please contact support.",
        code:  "PRODUCT_NOT_CONFIGURED",
      }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Create Dodo checkout session ──────────────────────
    const dodo = new DodoPayments({
      bearerToken: DODO_API_KEY,
      environment: DODO_ENV,
    });

    const session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: userEmail,
        ...(userName ? { name: userName } : {}),
      },
      return_url: `${APP_URL}/dashboard/settings?checkout=success&plan=${planKey}`,
      metadata: {
        user_id:       user.id,
        plan_key:      planKey,
        billing_cycle: billingCycle,
        source:        "robinos_web",
      },
    });

    console.log(`[create-checkout] Session created for user ${user.id} plan=${planKey} cycle=${billingCycle}`);

    return new Response(JSON.stringify({
      checkoutUrl: session.checkout_url,
      sessionId:   session.session_id,
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-checkout] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
