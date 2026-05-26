// ============================================================
// CREATE-CHECKOUT — Dodo Payments checkout session
// ============================================================
// Monthly billing only. Three plans: creator, pro_creator, agency.
//
// Product IDs (set in Supabase Edge Function Secrets):
//   DODO_PRODUCT_CREATOR_MONTHLY     = pdt_0NfedFf5yWQuYuZUPsomx
//   DODO_PRODUCT_PRO_CREATOR_MONTHLY = pdt_0NfedaK1KKBVDs37xrAO5
//   DODO_PRODUCT_AGENCY_MONTHLY      = pdt_0Nfedwj3D80bkMnHQWfoI
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DODO_API_KEY = Deno.env.get("DODO_SECRET_KEY")!;
const DODO_ENV     = (Deno.env.get("DODO_ENVIRONMENT") ?? "live_mode") as "test_mode" | "live_mode";
const APP_URL      = Deno.env.get("APP_URL") ?? "https://tryrobin.xyz";

// ── Monthly product IDs only ───────────────────────────────
const PRODUCT_IDS: Record<string, string> = {
  creator:     Deno.env.get("DODO_PRODUCT_CREATOR_MONTHLY")     ?? "pdt_0NfedFf5yWQuYuZUPsomx",
  pro_creator: Deno.env.get("DODO_PRODUCT_PRO_CREATOR_MONTHLY") ?? "pdt_0NfedaK1KKBVDs37xrAO5",
  agency:      Deno.env.get("DODO_PRODUCT_AGENCY_MONTHLY")      ?? "pdt_0Nfedwj3D80bkMnHQWfoI",
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
    const body      = await req.json();
    const planKey   = String(body?.planKey   ?? "").toLowerCase();
    const userEmail = String(body?.userEmail ?? user.email ?? "");
    const userName  = String(body?.userName  ?? "");

    if (!VALID_PLANS.includes(planKey as typeof VALID_PLANS[number])) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${planKey}` }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Prevent duplicate: same plan already active ──────
    // Allow upgrades/downgrades — only block if buying the exact same plan
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("plan, status, provider")
      .eq("user_id", user.id)
      .single();

    if (
      existingSub &&
      ["active", "trialing", "expiring"].includes(existingSub.status ?? "") &&
      existingSub.plan === planKey &&
      existingSub.provider === "dodo"
    ) {
      return new Response(JSON.stringify({
        error: `You're already on the ${planKey.replace("_", " ")} plan. Manage your subscription from settings.`,
        code:  "ALREADY_ON_PLAN",
      }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Resolve product ID ────────────────────────────────
    const productId = PRODUCT_IDS[planKey];
    if (!productId) {
      console.error(`[create-checkout] Missing product ID for plan: ${planKey}`);
      return new Response(JSON.stringify({
        error: "This plan is not available for purchase. Please contact support.",
        code:  "PRODUCT_NOT_CONFIGURED",
      }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Create Dodo checkout session ──────────────────────
    const dodo = new DodoPayments({ bearerToken: DODO_API_KEY, environment: DODO_ENV });

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
        billing_cycle: "monthly",
        source:        "robinos_web",
      },
    });

    console.log(`[create-checkout] Session created user=${user.id} plan=${planKey}`);

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
