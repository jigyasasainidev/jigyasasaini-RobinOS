// ============================================================
// WHOP-WEBHOOK — Whop membership webhook handler (Phase 1)
// ============================================================
// Phase 1: Isolated skeleton with placeholder handlers.
// No Supabase writes, no RPCs, no database operations.
//
// Handled events:
//   membership.activated  → handleMembershipActivated
//   membership.cancelled  → handleMembershipCancelled
//   membership.deactivated → handleMembershipDeactivated
//
// Security:
//   - verify_jwt = false (configured in supabase/config.toml)
//   - Raw body preserved for future signature verification
//   - service_role not used — reads only, no writes
// ============================================================

import { CORS_HEADERS } from "../_shared/entitlement.ts";

const WHOP_WEBHOOK_SECRET = Deno.env.get("WHOP_WEBHOOK_SECRET");

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

  // Route event to placeholder handler
  try {
    switch (eventType) {
      case "membership.activated":
        return new Response(JSON.stringify(await handleMembershipActivated(data)), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      case "membership.cancelled":
        return new Response(JSON.stringify(await handleMembershipCancelled(data)), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
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

// ── Payload extraction helper ──────────────────────────────

interface PayloadFields {
  membership_id: string;
  product_id:    string;
  email:         string;
}

function extractPayloadFields(data: Record<string, unknown>): PayloadFields {
  const membership = (data.membership  ?? {}) as Record<string, unknown>;
  const product    = (data.product     ?? {}) as Record<string, unknown>;
  const customer   = (data.customer    ?? {}) as Record<string, unknown>;

  return {
    membership_id: String(membership.id    ?? ""),
    product_id:    String(product.id       ?? ""),
    email:         String(customer.email   ?? ""),
  };
}

// ── Placeholder event handlers ─────────────────────────────

async function handleMembershipActivated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { membership_id, product_id, email } = extractPayloadFields(data);
  console.log(`[whop-webhook] membership.activated | id=${data.id} | membership=${membership_id} | product=${product_id} | email=${email}`);
  return { success: true, handled: "membership_activated" };
}

async function handleMembershipCancelled(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { membership_id, product_id, email } = extractPayloadFields(data);
  console.log(`[whop-webhook] membership.cancelled | id=${data.id} | membership=${membership_id} | product=${product_id} | email=${email}`);
  return { success: true, handled: "membership_cancelled" };
}

async function handleMembershipDeactivated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { membership_id, product_id, email } = extractPayloadFields(data);
  console.log(`[whop-webhook] membership.deactivated | id=${data.id} | membership=${membership_id} | product=${product_id} | email=${email}`);
  return { success: true, handled: "membership_deactivated" };
}