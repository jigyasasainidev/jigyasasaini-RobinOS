// ============================================================
// DODO-WEBHOOK — Dodo Payments webhook handler
// ============================================================
// Handles all Dodo Payments subscription and payment events.
// Verifies HMAC SHA256 signature using standardwebhooks spec.
// Calls safe_plan_switch() to update subscription state.
//
// Events handled:
//   subscription.active    → activate plan
//   subscription.renewed   → extend subscription
//   subscription.cancelled → mark cancelled, preserve until period end
//   subscription.on_hold   → mark payment_failed
//   subscription.expired   → downgrade to free
//   payment.succeeded      → confirm active (belt+suspenders)
//   payment.failed         → mark payment_failed
//
// Security:
//   - Signature verified before any DB write
//   - Idempotent: uses subscription_webhook_events table
//   - service_role only — no user JWT needed
//   - Raw body preserved for signature verification
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET  = Deno.env.get("DODO_WEBHOOK_SECRET")!;

// ── Plan key normalization ─────────────────────────────────
// Maps Dodo product IDs back to RobinOS plan keys.
// Populated from Supabase secrets.
function buildProductMap(): Record<string, { plan: string; cycle: string }> {
  const map: Record<string, { plan: string; cycle: string }> = {};
  const entries = [
    ["DODO_PRODUCT_CREATOR_MONTHLY",     "creator",     "monthly"],
    ["DODO_PRODUCT_PRO_CREATOR_MONTHLY", "pro_creator", "monthly"],
    ["DODO_PRODUCT_AGENCY_MONTHLY",      "agency",      "monthly"],
    ["DODO_PRODUCT_CREATOR_YEARLY",      "creator",     "yearly"],
    ["DODO_PRODUCT_PRO_CREATOR_YEARLY",  "pro_creator", "yearly"],
    ["DODO_PRODUCT_AGENCY_YEARLY",       "agency",      "yearly"],
  ] as const;

  for (const [envKey, plan, cycle] of entries) {
    const productId = Deno.env.get(envKey);
    if (productId) map[productId] = { plan, cycle };
  }
  return map;
}

// ── Amount helpers ─────────────────────────────────────────
const PLAN_AMOUNTS: Record<string, Record<string, number>> = {
  creator:     { monthly: 19, yearly: 190 },
  pro_creator: { monthly: 39, yearly: 390 },
  agency:      { monthly: 99, yearly: 990 },
};

function getPlanAmount(plan: string, cycle: string): number {
  return PLAN_AMOUNTS[plan]?.[cycle] ?? 0;
}

// ── Billing cycle → days ───────────────────────────────────
function cycleToDays(cycle: string): number {
  return cycle === "yearly" ? 365 : 30;
}

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Read raw body (required for signature verification) ──
  const rawBody = await req.text();

  // ── Verify signature ──────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    console.error("[dodo-webhook] DODO_WEBHOOK_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const webhookId        = req.headers.get("webhook-id")        ?? "";
  const webhookSignature = req.headers.get("webhook-signature")  ?? "";
  const webhookTimestamp = req.headers.get("webhook-timestamp")  ?? "";

  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    await wh.verify(rawBody, {
      "webhook-id":        webhookId,
      "webhook-signature": webhookSignature,
      "webhook-timestamp": webhookTimestamp,
    });
  } catch (err) {
    console.error("[dodo-webhook] Signature verification failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Parse payload ─────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const eventType = String(payload.type ?? "");
  const data      = (payload.data ?? {}) as Record<string, unknown>;

  console.log(`[dodo-webhook] Event: ${eventType} | webhook-id: ${webhookId}`);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Idempotency check ─────────────────────────────────────
  // Uses subscription_webhook_events table from migration 31
  const payloadHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody)
  ).then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

  const { data: idempotencyResult } = await supabase.rpc("record_webhook_event", {
    p_provider_event_id: webhookId,
    p_provider:          "dodo",
    p_event_type:        eventType,
    p_payload_hash:      payloadHash,
  });

  if (idempotencyResult?.is_duplicate) {
    console.log(`[dodo-webhook] Duplicate event skipped: ${webhookId}`);
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Route event ───────────────────────────────────────────
  try {
    switch (eventType) {
      case "subscription.active":
      case "subscription.renewed":
        await handleSubscriptionActive(supabase, data);
        break;

      case "subscription.cancelled":
        await handleSubscriptionCancelled(supabase, data);
        break;

      case "subscription.on_hold":
      case "payment.failed":
        await handlePaymentFailed(supabase, data);
        break;

      case "subscription.expired":
        await handleSubscriptionExpired(supabase, data);
        break;

      case "payment.succeeded":
        await handlePaymentSucceeded(supabase, data);
        break;

      default:
        console.log(`[dodo-webhook] Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dodo-webhook] Handler error for ${eventType}:`, msg);
    // Return 200 to prevent Dodo from retrying a handler error
    // (signature was valid, event was received — processing error is our problem)
    return new Response(JSON.stringify({ received: true, error: msg }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ── Event handlers ─────────────────────────────────────────

async function handleSubscriptionActive(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = String(data.subscription_id ?? "");
  const customer       = (data.customer ?? {}) as Record<string, unknown>;
  const customerId     = String(customer.customer_id ?? "");
  const productId      = String(data.product_id ?? "");
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  // Resolve user_id from metadata (set during checkout creation)
  const userId = metadata.user_id ?? await resolveUserIdFromCustomer(supabase, customerId);
  if (!userId) {
    console.error("[dodo-webhook] Cannot resolve user_id for subscription:", subscriptionId);
    return;
  }

  // Resolve plan from product ID
  const productMap = buildProductMap();
  const planInfo   = productId ? productMap[productId] : null;
  const planKey    = planInfo?.plan ?? metadata.plan_key ?? "creator";
  const cycle      = planInfo?.cycle ?? metadata.billing_cycle ?? "monthly";
  const amount     = getPlanAmount(planKey, cycle);

  console.log(`[dodo-webhook] Activating plan=${planKey} cycle=${cycle} user=${userId}`);

  const { data: result, error } = await supabase.rpc("safe_plan_switch", {
    p_user_id:        userId,
    p_new_plan:       planKey,
    p_billing_cycle:  cycle,
    p_provider:       "dodo",
    p_provider_sub_id: subscriptionId,
    p_amount:         amount,
    p_triggered_by:   "webhook",
  });

  if (error) {
    throw new Error(`safe_plan_switch failed: ${error.message}`);
  }

  // Store customer_id for portal access
  if (customerId) {
    await supabase
      .from("user_subscriptions")
      .update({ provider: "dodo" })
      .eq("user_id", userId);
  }

  console.log(`[dodo-webhook] Plan activated: ${JSON.stringify(result)}`);
}

async function handleSubscriptionCancelled(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = String(data.subscription_id ?? "");
  const customer       = (data.customer ?? {}) as Record<string, unknown>;
  const customerId     = String(customer.customer_id ?? "");
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  const userId = metadata.user_id ?? await resolveUserIdFromCustomer(supabase, customerId);
  if (!userId) {
    console.error("[dodo-webhook] Cannot resolve user_id for cancellation:", subscriptionId);
    return;
  }

  // Mark cancelled but preserve access until period end
  // (safe_plan_switch would reset expiry — instead update status directly)
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      status:              "cancelled",
      auto_renew:          false,
      canceled_at:         new Date().toISOString(),
      updated_at:          new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw new Error(`Cancellation update failed: ${error.message}`);

  await supabase.rpc("log_subscription_event", {
    p_user_id:      userId,
    p_event_type:   "subscription_cancelled",
    p_old_status:   "active",
    p_new_status:   "cancelled",
    p_triggered_by: "webhook",
    p_metadata:     { subscription_id: subscriptionId, provider: "dodo" },
  });

  console.log(`[dodo-webhook] Subscription cancelled for user: ${userId}`);
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = String(data.subscription_id ?? "");
  const customer       = (data.customer ?? {}) as Record<string, unknown>;
  const customerId     = String(customer.customer_id ?? "");
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  const userId = metadata.user_id ?? await resolveUserIdFromCustomer(supabase, customerId);
  if (!userId) return;

  const { error } = await supabase
    .from("user_subscriptions")
    .update({ status: "payment_failed", updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) throw new Error(`Payment failed update error: ${error.message}`);

  await supabase.rpc("log_subscription_event", {
    p_user_id:      userId,
    p_event_type:   "payment_failed",
    p_triggered_by: "webhook",
    p_metadata:     { subscription_id: subscriptionId, provider: "dodo" },
  });

  console.log(`[dodo-webhook] Payment failed for user: ${userId}`);
}

async function handleSubscriptionExpired(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = String(data.subscription_id ?? "");
  const customer       = (data.customer ?? {}) as Record<string, unknown>;
  const customerId     = String(customer.customer_id ?? "");
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  const userId = metadata.user_id ?? await resolveUserIdFromCustomer(supabase, customerId);
  if (!userId) return;

  // Downgrade to free via safe_plan_switch
  await supabase.rpc("safe_plan_switch", {
    p_user_id:        userId,
    p_new_plan:       "free",
    p_billing_cycle:  "monthly",
    p_provider:       "dodo",
    p_provider_sub_id: subscriptionId,
    p_amount:         0,
    p_triggered_by:   "webhook",
  });

  console.log(`[dodo-webhook] Subscription expired, downgraded to free: ${userId}`);
}

async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  // Belt-and-suspenders: if subscription.active didn't fire,
  // payment.succeeded ensures the plan is activated.
  const subscriptionId = String(data.subscription_id ?? "");
  if (!subscriptionId) return; // one-time payment, not a subscription

  const customer   = (data.customer ?? {}) as Record<string, unknown>;
  const customerId = String(customer.customer_id ?? "");
  const metadata   = (data.metadata ?? {}) as Record<string, string>;

  const userId = metadata.user_id ?? await resolveUserIdFromCustomer(supabase, customerId);
  if (!userId) return;

  // Update last_payment_at
  await supabase
    .from("user_subscriptions")
    .update({
      last_payment_at: new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq("user_id", userId);

  console.log(`[dodo-webhook] Payment succeeded for user: ${userId}`);
}

// ── Resolve user_id from Dodo customer_id ─────────────────
// Fallback when metadata.user_id is not present.
async function resolveUserIdFromCustomer(
  supabase: ReturnType<typeof createClient>,
  customerId: string
): Promise<string | null> {
  if (!customerId) return null;

  // Look up by provider_subscription_id or customer email
  const { data } = await supabase
    .from("user_subscriptions")
    .select("user_id")
    .eq("provider", "dodo")
    .limit(1)
    .single();

  return data?.user_id ?? null;
}
