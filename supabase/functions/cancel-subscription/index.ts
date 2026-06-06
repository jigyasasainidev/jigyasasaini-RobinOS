// ============================================================
// CANCEL-SUBSCRIPTION — Cancel a Dodo Payments subscription
// ============================================================
// Cancels the user's active Dodo subscription via API.
// Access is preserved until the current billing period ends
// (Dodo cancels at period end, not immediately).
// The dodo-webhook handler will receive subscription.cancelled
// and update the DB status accordingly.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DODO_API_KEY = Deno.env.get("DODO_SECRET_KEY")!;
const DODO_ENV     = (Deno.env.get("DODO_ENVIRONMENT") ?? "test_mode") as "test_mode" | "live_mode";

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

    // ── Get active subscription ───────────────────────────
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("provider_subscription_id, provider, plan, status")
      .eq("user_id", user.id)
      .single();

    if (!sub?.provider_subscription_id || sub.provider !== "dodo") {
      return new Response(JSON.stringify({
        error: "No active Dodo subscription found.",
        code:  "NO_SUBSCRIPTION",
      }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (sub.status === "cancelled") {
      return new Response(JSON.stringify({
        error: "Subscription is already cancelled.",
        code:  "ALREADY_CANCELLED",
      }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Cancel via Dodo API ───────────────────────────────
    // Dodo cancels at period end — user keeps access until then.
    // The webhook (subscription.cancelled) will update DB status.
    const dodo = new DodoPayments({ bearerToken: DODO_API_KEY, environment: DODO_ENV });

    await dodo.subscriptions.update(sub.provider_subscription_id, {
      status: "cancelled",
    });

    console.log(`[cancel-subscription] Cancelled sub=${sub.provider_subscription_id} user=${user.id}`);

    // Optimistically mark as cancelled in DB so UI updates immediately.
    // The webhook will confirm and set canceled_at / auto_renew = false.
    await supabase
      .from("user_subscriptions")
      .update({
        status:     "cancelled",
        auto_renew: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    // Audit log
    await supabase.rpc("log_subscription_event", {
      p_user_id:      user.id,
      p_event_type:   "subscription_cancelled",
      p_old_status:   sub.status,
      p_new_status:   "cancelled",
      p_triggered_by: "user_request",
      p_metadata:     {
        subscription_id: sub.provider_subscription_id,
        provider:        "dodo",
        plan:            sub.plan,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cancel-subscription] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
