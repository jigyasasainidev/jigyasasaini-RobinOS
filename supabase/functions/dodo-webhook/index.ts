// ============================================================
// DODO-WEBHOOK — Dodo Payments webhook handler
// ============================================================
// Monthly billing only. Handles 5 events:
//   subscription.active    → activate plan
//   subscription.renewed   → extend subscription (same as active)
//   subscription.cancelled → mark cancelled, preserve until period end
//   payment.succeeded      → stamp last_payment_at
//   payment.failed         → mark payment_failed
//
// Security:
//   - HMAC SHA256 signature verified (standardwebhooks spec)
//   - Idempotent via subscription_webhook_events table
//   - service_role only — no user JWT
//   - Raw body preserved for signature verification
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("DODO_WEBHOOK_SECRET")!;

// ── Product ID → plan key map (monthly only) ───────────────
// Read exclusively from Supabase secrets — no hardcoded fallbacks
function buildProductMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const entries: [string, string][] = [
    ["DODO_PRODUCT_CREATOR_MONTHLY",     "creator"],
    ["DODO_PRODUCT_PRO_CREATOR_MONTHLY", "pro_creator"],
    ["DODO_PRODUCT_AGENCY_MONTHLY",      "agency"],
  ];
  for (const [envKey, plan] of entries) {
    const id = Deno.env.get(envKey);
    if (id) {
      map[id] = plan;
      console.log(`[dodo-webhook] Mapped product ${id} → ${plan}`);
    } else {
      console.warn(`[dodo-webhook] Secret ${envKey} not set`);
    }
  }
  return map;
}

// ── Plan amounts (monthly) ─────────────────────────────────
const PLAN_AMOUNTS: Record<string, number> = {
  creator:     19,
  pro_creator: 39,
  agency:      99,
};

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Read raw body — required for signature verification
  const rawBody = await req.text();

  // Verify signature
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

  // Parse payload
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

  console.log(`[dodo-webhook] ${eventType} | id=${webhookId}`);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Idempotency — uses subscription_webhook_events table (migration 31)
  const payloadHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

  const { data: idempotencyResult } = await supabase.rpc("record_webhook_event", {
    p_provider_event_id: webhookId,
    p_provider:          "dodo",
    p_event_type:        eventType,
    p_payload_hash:      payloadHash,
  });

  if (idempotencyResult?.is_duplicate) {
    console.log(`[dodo-webhook] Duplicate skipped: ${webhookId}`);
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Route event
  try {
    switch (eventType) {
      case "subscription.active":
      case "subscription.renewed":
        await handleSubscriptionActive(supabase, data);
        break;
      case "subscription.cancelled":
        await handleSubscriptionCancelled(supabase, data);
        break;
      case "payment.succeeded":
        await handlePaymentSucceeded(supabase, data);
        break;
      case "payment.failed":
        await handlePaymentFailed(supabase, data);
        break;
      default:
        console.log(`[dodo-webhook] Unhandled event: ${eventType}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dodo-webhook] Handler error (${eventType}):`, msg);
    // Return 200 — signature was valid, processing error is ours to fix
    return new Response(JSON.stringify({ received: true, processing_error: msg }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ── Helpers ────────────────────────────────────────────────

function extractUserId(data: Record<string, unknown>): string | null {
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  return metadata.user_id ?? null;
}

function extractSubscriptionId(data: Record<string, unknown>): string {
  return String(data.subscription_id ?? "");
}

// Fallback: look up user by provider_subscription_id
async function resolveUserBySubscriptionId(
  supabase: ReturnType<typeof createClient>,
  subscriptionId: string
): Promise<string | null> {
  if (!subscriptionId) return null;
  const { data } = await supabase
    .from("user_subscriptions")
    .select("user_id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("provider", "dodo")
    .maybeSingle();
  return data?.user_id ?? null;
}

// ── Event handlers ─────────────────────────────────────────

async function handleSubscriptionActive(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = extractSubscriptionId(data);
  const productId      = String(data.product_id ?? "");
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  // Log full data for debugging
  console.log(`[dodo-webhook] subscription.active data: ${JSON.stringify({
    subscription_id: subscriptionId,
    product_id: productId,
    metadata,
    customer: data.customer,
  })}`);

  // Resolve user_id — metadata is the primary source (set at checkout creation)
  const userId = extractUserId(data) ?? await resolveUserBySubscriptionId(supabase, subscriptionId);
  if (!userId) {
    console.error(`[dodo-webhook] Cannot resolve user_id. sub=${subscriptionId} metadata=${JSON.stringify(metadata)}`);
    return;
  }

  const productMap = buildProductMap();
  const planKey = productMap[productId] ?? metadata.plan_key ?? "creator";
  const amount  = PLAN_AMOUNTS[planKey] ?? 0;

  console.log(`[dodo-webhook] Activating plan=${planKey} user=${userId} sub=${subscriptionId}`);

  const { data: result, error } = await supabase.rpc("safe_plan_switch", {
    p_user_id:         userId,
    p_new_plan:        planKey,
    p_billing_cycle:   "monthly",
    p_provider:        "dodo",
    p_provider_sub_id: subscriptionId,
    p_amount:          amount,
    p_triggered_by:    "webhook",
  });

  if (error) throw new Error(`safe_plan_switch failed: ${error.message}`);

  console.log(`[dodo-webhook] Plan activated: ${JSON.stringify(result)}`);
}

async function handleSubscriptionCancelled(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = extractSubscriptionId(data);
  const metadata       = (data.metadata ?? {}) as Record<string, string>;

  const userId = extractUserId(data) ?? await resolveUserBySubscriptionId(supabase, subscriptionId);
  if (!userId) {
    console.error(`[dodo-webhook] Cannot resolve user_id for cancellation: ${subscriptionId}`);
    return;
  }

  // Mark cancelled — preserve access until current period ends (expires_at unchanged)
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      status:      "cancelled",
      auto_renew:  false,
      canceled_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw new Error(`Cancellation update failed: ${error.message}`);

  // Audit log
  await supabase.rpc("log_subscription_event", {
    p_user_id:      userId,
    p_event_type:   "subscription_cancelled",
    p_old_status:   "active",
    p_new_status:   "cancelled",
    p_triggered_by: "webhook",
    p_metadata:     { subscription_id: subscriptionId, provider: "dodo" },
  });

  console.log(`[dodo-webhook] Cancelled for user: ${userId}`);
}

async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = extractSubscriptionId(data);
  const metadata       = (data.metadata ?? {}) as Record<string, string>;
  const productId      = String(data.product_id ?? "");

  // payment.succeeded always carries metadata.user_id from checkout session
  const userId = extractUserId(data) ?? await resolveUserBySubscriptionId(supabase, subscriptionId);
  if (!userId) {
    console.error(`[dodo-webhook] payment.succeeded: cannot resolve user_id. sub=${subscriptionId} metadata=${JSON.stringify(metadata)}`);
    return;
  }

  // If this is a subscription payment, activate the plan
  // (belt-and-suspenders in case subscription.active didn't fire or metadata was missing)
  if (subscriptionId) {
    const productMap = buildProductMap();
    const planKey    = productMap[productId] ?? metadata.plan_key ?? null;
    const amount     = planKey ? (PLAN_AMOUNTS[planKey] ?? 0) : 0;

    if (planKey) {
      console.log(`[dodo-webhook] payment.succeeded activating plan=${planKey} user=${userId}`);
      const { error } = await supabase.rpc("safe_plan_switch", {
        p_user_id:         userId,
        p_new_plan:        planKey,
        p_billing_cycle:   "monthly",
        p_provider:        "dodo",
        p_provider_sub_id: subscriptionId,
        p_amount:          amount,
        p_triggered_by:    "webhook",
      });
      if (error) throw new Error(`safe_plan_switch (payment.succeeded) failed: ${error.message}`);

      // ── Affiliate commission attribution ──────────────────
      // If this user was referred, calculate and record 30% commission
      const referralCode = metadata.referral_code ?? null;
      if (referralCode && amount > 0) {
        await recordAffiliateCommission(supabase, userId, referralCode, amount, subscriptionId);
      } else {
        // Fallback: check profiles.referred_by_code (set at signup)
        const { data: profile } = await supabase
          .from("profiles")
          .select("referred_by_code")
          .eq("user_id", userId)
          .maybeSingle();

        if (profile?.referred_by_code && amount > 0) {
          await recordAffiliateCommission(supabase, userId, profile.referred_by_code, amount, subscriptionId);
        }
      }
    }
  }

  // Stamp last_payment_at
  await supabase
    .from("user_subscriptions")
    .update({ last_payment_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  console.log(`[dodo-webhook] Payment succeeded processed for user: ${userId}`);
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
) {
  const subscriptionId = extractSubscriptionId(data);
  const userId = extractUserId(data) ?? await resolveUserBySubscriptionId(supabase, subscriptionId);
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

// ── Affiliate commission recording ────────────────────────
// Called on every successful payment for a referred user.
// Commission rate is read live from platform_settings (admin-controlled).
// Idempotent: unique constraint on (affiliate_user_id, referred_user_id, subscription_id).

async function recordAffiliateCommission(
  supabase: ReturnType<typeof createClient>,
  referredUserId: string,
  referralCode:   string,
  paymentAmount:  number,
  subscriptionId: string
): Promise<void> {
  try {
    // 1. Find affiliate by referral code
    const { data: affiliateProfile } = await supabase
      .from("affiliate_profiles")
      .select("user_id, referral_code")
      .eq("referral_code", referralCode.toUpperCase())
      .maybeSingle();

    if (!affiliateProfile?.user_id) {
      console.warn(`[dodo-webhook] Referral code not found: ${referralCode}`);
      return;
    }

    const affiliateUserId = affiliateProfile.user_id;

    // Prevent self-referral
    if (affiliateUserId === referredUserId) {
      console.warn(`[dodo-webhook] Self-referral blocked: ${affiliateUserId}`);
      return;
    }

    // 2. Read live commission rate from platform_settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("affiliate_commission_percent")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const commissionPercent = Number(settings?.affiliate_commission_percent ?? 30);
    const commissionRate    = commissionPercent / 100;
    const commissionAmount  = Math.round(paymentAmount * commissionRate * 100) / 100;

    console.log(`[dodo-webhook] Commission: affiliate=${affiliateUserId} referred=${referredUserId} amount=$${paymentAmount} rate=${commissionPercent}% commission=$${commissionAmount}`);

    // 3. Insert commission record (idempotent via dodo_subscription_id)
    const { error: commErr } = await supabase
      .from("affiliate_commissions")
      .insert({
        affiliate_user_id:   affiliateUserId,
        referred_user_id:    referredUserId,
        dodo_subscription_id: subscriptionId,
        amount:              commissionAmount,
        status:              "pending",
      })
      .select("id")
      .single();

    if (commErr) {
      // Unique constraint violation = already recorded (idempotent)
      if (commErr.code === "23505") {
        console.log(`[dodo-webhook] Commission already recorded (idempotent)`);
        return;
      }
      throw new Error(`Commission insert failed: ${commErr.message}`);
    }

    // 4. Update affiliate_profiles totals atomically
    await supabase.rpc("increment_affiliate_balance", {
      p_affiliate_user_id: affiliateUserId,
      p_amount:            commissionAmount,
    });

    console.log(`[dodo-webhook] Commission recorded: $${commissionAmount} for affiliate ${affiliateUserId}`);

  } catch (err) {
    // Never let commission recording crash the payment flow
    console.error(`[dodo-webhook] Commission recording failed (non-fatal):`, err instanceof Error ? err.message : err);
  }
}
