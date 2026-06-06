// ============================================================
// CREATE-WHOP-CHECKOUT — Whop Payments checkout session
// ============================================================
// Monthly billing only. Three plans: creator, pro_creator, agency.
//
// Product IDs (set in Supabase Edge Function Secrets):
//   WHOP_PLAN_CREATOR  = whop plan ID for creator
//   WHOP_PLAN_PRO      = whop plan ID for pro_creator
//   WHOP_PLAN_AGENCY   = whop plan ID for agency
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHOP_API_KEY  = Deno.env.get("WHOP_API_KEY")!;
const APP_URL       = Deno.env.get("APP_URL") ?? "https://tryrobin.xyz";

// ── Monthly plan IDs — read from Supabase secrets only ─
// Set these in Supabase Dashboard → Edge Functions → Secrets:
//   WHOP_PLAN_CREATOR
//   WHOP_PLAN_PRO
//   WHOP_PLAN_AGENCY
const WHOP_PRODUCT_IDS: Record<string, string | undefined> = {
  creator:     Deno.env.get("WHOP_PLAN_CREATOR"),
  pro_creator: Deno.env.get("WHOP_PLAN_PRO"),
  agency:      Deno.env.get("WHOP_PLAN_AGENCY"),
};

const VALID_PLANS = ["creator", "pro_creator", "agency"] as const;

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
    const body        = await req.json();
    const planKey     = String(body?.planKey   ?? "").toLowerCase();
    const userEmail   = String(body?.userEmail ?? user.email ?? "");
    const userName    = String(body?.userName  ?? "");
    const referralCode = body?.referralCode ? String(body.referralCode).trim().toUpperCase() : null;

    console.log(`[create-whop-checkout] user=${user.id} plan=${planKey} referral=${referralCode ?? "none"}`);

    if (!VALID_PLANS.includes(planKey as typeof VALID_PLANS[number])) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${planKey}` }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Prevent duplicate: same plan already active ──────
    // Block if buying the exact same plan with any active-status
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("plan, status, provider")
      .eq("user_id", user.id)
      .single();

    if (
      existingSub &&
      ["active", "trialing", "expiring"].includes(existingSub.status ?? "") &&
      existingSub.plan === planKey &&
      existingSub.provider === "whop"
    ) {
      return new Response(JSON.stringify({
        error: `You're already on the ${planKey.replace("_", " ")} plan. Manage your subscription from settings.`,
        code:  "ALREADY_ON_PLAN",
      }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Resolve Whop product ID ───────────────────────────
    const whopPlanId = WHOP_PRODUCT_IDS[planKey];
    if (!whopPlanId) {
      console.error(`[create-whop-checkout] Missing Whop plan ID for plan: ${planKey}. Set WHOP_PLAN_${planKey.toUpperCase()} in Supabase secrets.`);
      return new Response(JSON.stringify({
        error: "This plan is not available for purchase. Please contact support.",
        code:  "PRODUCT_NOT_CONFIGURED",
      }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    console.log(`[create-whop-checkout] Using whop_plan_id=${whopPlanId} for plan=${planKey}`);

    // ── Build metadata ────────────────────────────────────
    const metadata: Record<string, string> = {
      user_id:       user.id,
      plan_key:      planKey,
      billing_cycle: "monthly",
      source:        "robinos_web",
    };
    if (referralCode) {
      metadata.referral_code = referralCode;
    }

    // ── Create Whop checkout configuration ───────────────
    const returnUrl = `${APP_URL}/dashboard/settings?checkout=success&plan=${planKey}`;

    const whopResponse = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHOP_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        plan: {
          id:         whopPlanId,
          plan_type:  "renewal",
          currency:   "usd",
        },
        metadata:   metadata,
        return_url: returnUrl,
      }),
    });

    if (!whopResponse.ok) {
      const errBody = await whopResponse.text();
      console.error(`[create-whop-checkout] Whop API error: ${whopResponse.status} ${errBody}`);
      return new Response(JSON.stringify({
        error: "Failed to create checkout session. Please try again.",
        code:  "CHECKOUT_CREATION_FAILED",
      }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const whopData = await whopResponse.json();
    const checkoutUrl = whopData.purchase_url ?? whopData.redirect_url ?? "";
    const sessionId   = whopData.id ?? "";

    if (!checkoutUrl) {
      console.error(`[create-whop-checkout] Whop response missing purchase_url: ${JSON.stringify(whopData)}`);
      return new Response(JSON.stringify({
        error: "Invalid response from payment provider.",
        code:  "INVALID_WHOP_RESPONSE",
      }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    console.log(`[create-whop-checkout] Checkout created user=${user.id} plan=${planKey} session=${sessionId}`);

    return new Response(JSON.stringify({
      checkoutUrl,
      sessionId,
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-whop-checkout] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});