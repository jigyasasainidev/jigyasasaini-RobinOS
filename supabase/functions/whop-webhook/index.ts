// ============================================================
// WHOP-WEBHOOK — Whop membership webhook handler (Phase 2B)
// ============================================================
// Phase 2B: Full database integration via safe_plan_switch RPC.
//
// Handled events:
//   membership.activated   → handleMembershipActivated
//   membership.deactivated → handleMembershipDeactivated
//   membership.cancelled   → handleMembershipDeactivated
//
// Security:
//   - verify_jwt = false (configured in supabase/config.toml)
//   - service_role only — no user JWT
//   - Raw body preserved for future HMAC signature verification
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WHOP_WEBHOOK_SECRET = Deno.env.get("WHOP_WEBHOOK_SECRET");

const PLAN_AMOUNTS: Record<string, number> = {
  creator:     19,
  pro_creator: 39,
  agency:      99,
};

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!WHOP_WEBHOOK_SECRET) {
    console.warn("[whop-webhook] WHOP_WEBHOOK_SECRET not set — proceeding without signature verification");
  }

  // Read raw body — preserved for future HMAC signature verification
  const rawBody = await req.text();

  // Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const eventType = String(payload.event ?? "");
  const data      = (payload.data  ?? {}) as Record<string, unknown>;
  const id        = String(data.id    ?? payload.id ?? "unknown");

  console.log(`[whop-webhook] ${eventType} | id=${id}`);

  // Route event to handler
  try {
    switch (eventType) {
      case "membership.activated":
        return new Response(JSON.stringify(await handleMembershipActivated(data)), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      case "membership.cancelled":
      case "membership.deactivated":
        return new Response(JSON.stringify(await handleMembershipDeactivated(data)), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      default:
        console.log(`[whop-webhook] Unhandled event: ${eventType}`);
        return new Response(JSON.stringify({ received: true, unhandled: true }), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whop-webhook] Handler error (${eventType}):`, msg);
    return new Response(JSON.stringify({ received: true, processing_error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});

// ── Helpers ────────────────────────────────────────────────

function extractUserId(data: Record<string, unknown>): string | null {
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  return metadata.user_id ?? null;
}

function extractPlanKey(data: Record<string, unknown>): string | null {
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  return metadata.plan_key ?? null;
}

async function resolveUserByMembership(
  supabase: ReturnType<typeof createClient>,
  membershipId: string
): Promise<string | null> {
  if (!membershipId) return null;
  const { data } = await supabase
    .from("user_subscriptions")
    .select("user_id")
    .eq("provider_subscription_id", membershipId)
    .eq("provider", "whop")
    .maybeSingle();
  return data?.user_id ?? null;
}

async function resolveUserByEmail(
  supabase: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  if (!email) return null;
  const { data } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function resolveUserIdFromData(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>
): Promise<string | null> {
  // Priority 1: metadata.user_id
  const fromMetadata = extractUserId(data);
  if (fromMetadata) return fromMetadata;

  // Priority 2: membership ID lookup
  const membership = (data.membership ?? {}) as Record<string, unknown>;
  const membershipId = String(membership.id ?? "");
  const fromMembership = await resolveUserByMembership(supabase, membershipId);
  if (fromMembership) return fromMembership;

  // Priority 3: email fallback
  const customer  = (data.customer ?? {}) as Record<string, unknown>;
  const email     = String(customer.email ?? "");
  return await resolveUserByEmail(supabase, email);
}

// ── Event handlers ─────────────────────────────────────────

async function handleMembershipActivated(
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  const userId   = metadata.user_id ?? null;
  const planKey  = metadata.plan_key ?? null;
  const billingCycle = metadata.billing_cycle ?? "monthly";

  console.log(`[whop-webhook] membership.activated metadata: user_id=${userId} plan_key=${planKey} billing_cycle=${billingCycle}`);

  // Validate required fields
  if (!userId || !planKey) {
    throw new Error(`Missing required metadata: user_id=${userId}, plan_key=${planKey}`);
  }

  // Validate plan key
  if (!["creator", "pro_creator", "agency"].includes(planKey)) {
    throw new Error(`Invalid plan_key: ${planKey}`);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const membership   = (data.membership ?? {}) as Record<string, unknown>;
  const membershipId = String(membership.id ?? "");

  const { data: result, error } = await supabase.rpc("safe_plan_switch", {
    p_user_id:         userId,
    p_new_plan:        planKey,
    p_billing_cycle:   billingCycle,
    p_provider:        "whop",
    p_provider_sub_id: membershipId,
    p_amount:          PLAN_AMOUNTS[planKey],
    p_triggered_by:    "webhook",
  });

  if (error) throw new Error(`safe_plan_switch failed: ${error.message}`);

  console.log(`[whop-webhook] Plan activated: ${JSON.stringify(result)}`);

  return { success: true, activated: result };
}

async function handleMembershipDeactivated(
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const userId = await resolveUserIdFromData(supabase, data);
  if (!userId) {
    console.error("[whop-webhook] Cannot resolve user_id for cancellation");
    return { success: false, error: "cannot_resolve_user" };
  }

  const membership   = (data.membership ?? {}) as Record<string, unknown>;
  const membershipId = String(membership.id ?? "");

  // Mark cancelled — preserve access until current period ends
  const { error: updateError } = await supabase
    .from("user_subscriptions")
    .update({
      status:      "cancelled",
      auto_renew:  false,
      canceled_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateError) throw new Error(`Cancellation update failed: ${updateError.message}`);

  // Audit log
  await supabase.rpc("log_subscription_event", {
    p_user_id:      userId,
    p_event_type:   "subscription_cancelled",
    p_old_status:   "active",
    p_new_status:   "cancelled",
    p_triggered_by: "webhook",
    p_metadata:     { membership_id: membershipId, provider: "whop" },
  });

  console.log(`[whop-webhook] Cancelled for user: ${userId}`);

  return { success: true, cancelled: true };
}