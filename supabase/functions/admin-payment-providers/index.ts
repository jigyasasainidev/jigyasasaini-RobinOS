// ============================================================
// ADMIN-PAYMENT-PROVIDERS — Admin UI action dispatcher
// ============================================================
// Single endpoint that the /adminsh/payment-providers page calls
// to manage payment provider configuration. The page sends an
// `action` discriminator; this function dispatches to the
// appropriate SECURITY DEFINER RPC from migration 55.
//
// Authentication: Bearer JWT in Authorization header.
// Authorization: caller must be admin/super_admin/support per
// get_admin_access RPC.
// Secrets: payment_provider_secrets is NEVER touched.
//
// ADDITIVE ONLY — no existing edge function is modified.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CORS_HEADERS,
  createServiceClient,
  createUserClient,
} from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// ── JSON helpers ────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function err(code: string, message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ success: false, code, message, ...extra }, status);
}

// ── Admin verification ──────────────────────────────────────
async function verifyAdmin(authHeader: string): Promise<{ userId: string } | null> {
  const token = authHeader.replace("Bearer ", "");
  const serviceClient = createServiceClient();
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
  if (authError || !user) return null;

  // Use the user-scoped client so auth.uid() works inside get_admin_access.
  const userClient = createUserClient(authHeader);
  const { data } = await userClient.rpc("get_admin_access");
  const payload = (data ?? {}) as { role?: string | null; is_admin?: boolean };
  const isAdmin = Boolean(payload.is_admin) || ["super_admin", "admin", "support"].includes(payload.role ?? "");
  if (!isAdmin) return null;

  return { userId: user.id };
}

// ── SQL-state → HTTP mapping ────────────────────────────────
// Translates Postgres error codes raised by the M55 RPCs into
// structured HTTP responses.
function mapPgError(message: string, code: string): { http: number; appCode: string } {
  if (code === "P0001" && message.startsWith("DUPLICATE_PRODUCT_MAPPING:")) {
    return { http: 409, appCode: "DUPLICATE_PRODUCT_MAPPING" };
  }
  if (message.startsWith("admin_") && message.includes(": admin access required")) {
    return { http: 403, appCode: "ADMIN_REQUIRED" };
  }
  if (code === "23505") {
    return { http: 409, appCode: "DUPLICATE" };
  }
  if (code === "23514") {
    return { http: 400, appCode: "CHECK_CONSTRAINT" };
  }
  if (code === "PGRST116") {
    return { http: 404, appCode: "NOT_FOUND" };
  }
  return { http: 500, appCode: "INTERNAL_ERROR" };
}

// ── Action handlers ─────────────────────────────────────────
// Each action calls exactly one M55 RPC. The pattern is uniform:
//   1. Parse + sanity-check body
//   2. Call RPC
//   3. Map any PG error to HTTP envelope
//   4. Return success with the RPC's return value

async function handleSummary(svc: ReturnType<typeof createServiceClient>) {
  const { data, error } = await svc.rpc("admin_get_payment_provider_summary");
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, summary: data });
}

async function handleListProviders(svc: ReturnType<typeof createServiceClient>) {
  const { data, error } = await svc.rpc("admin_list_providers");
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, providers: data ?? [] });
}

async function handleGetProvider(svc: ReturnType<typeof createServiceClient>, body: any) {
  const id = body?.id;
  if (typeof id !== "string" || id.length === 0) {
    return err("INVALID_REQUEST", "id is required", 400);
  }
  const { data, error } = await svc.rpc("admin_get_provider", { p_id: id });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return err("NOT_FOUND", `provider '${id}' not found`, 404);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return json({ success: true, provider: row });
}

async function handleUpsertProvider(svc: ReturnType<typeof createServiceClient>, body: any) {
  const {
    id,
    display_name,
    is_enabled,
    is_test_mode,
    require_signature_verification,
    webhook_url,
    notes,
    config,
    allowed_ip_ranges,
  } = body ?? {};
  if (typeof id !== "string" || id.length === 0) {
    return err("INVALID_REQUEST", "id is required", 400);
  }
  if (typeof display_name !== "string" || display_name.trim().length === 0) {
    return err("INVALID_REQUEST", "display_name is required", 400);
  }

  const { data, error } = await svc.rpc("admin_upsert_provider", {
    p_id:                          id,
    p_display_name:                display_name,
    p_is_enabled:                  Boolean(is_enabled),
    p_is_test_mode:                Boolean(is_test_mode),
    p_require_signature_verification: require_signature_verification !== false,
    p_webhook_url:                 webhook_url ?? null,
    p_notes:                       notes ?? null,
    p_config:                      config ?? {},
    p_allowed_ip_ranges:           allowed_ip_ranges ?? null,
  });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, provider: data });
}

async function handleToggleProvider(svc: ReturnType<typeof createServiceClient>, body: any) {
  const { id, is_enabled } = body ?? {};
  if (typeof id !== "string" || id.length === 0) {
    return err("INVALID_REQUEST", "id is required", 400);
  }
  if (typeof is_enabled !== "boolean") {
    return err("INVALID_REQUEST", "is_enabled must be a boolean", 400);
  }
  const { data, error } = await svc.rpc("admin_toggle_provider", {
    p_id:         id,
    p_is_enabled: is_enabled,
  });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, provider: data });
}

async function handleListProducts(svc: ReturnType<typeof createServiceClient>, body: any) {
  const providerId = body?.provider_id;
  if (typeof providerId !== "string" || providerId.length === 0) {
    return err("INVALID_REQUEST", "provider_id is required", 400);
  }
  const { data, error } = await svc.rpc("admin_list_provider_products", { p_provider_id: providerId });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, products: data ?? [] });
}

async function handleUpsertProduct(svc: ReturnType<typeof createServiceClient>, body: any) {
  const {
    id,
    provider_id,
    provider_product_id,
    provider_offer_id,
    plan_key,
    billing_cycle,
    duration_value,
    duration_unit,
    amount,
    currency,
    is_subscription,
    is_enabled,
    display_name,
    description,
    metadata,
  } = body ?? {};

  // Minimal server-side sanity (DB-level validation also runs inside the RPC)
  if (id == null && typeof provider_id !== "string") {
    return err("INVALID_REQUEST", "provider_id is required for new products", 400);
  }
  if (id == null && typeof provider_product_id !== "string") {
    return err("INVALID_REQUEST", "provider_product_id is required for new products", 400);
  }

  const { data, error } = await svc.rpc("admin_upsert_provider_product", {
    p_id:                  id ?? null,
    p_provider_id:         provider_id ?? null,
    p_provider_product_id: provider_product_id ?? null,
    p_provider_offer_id:   provider_offer_id ?? null,
    p_plan_key:            plan_key ?? null,
    p_billing_cycle:       billing_cycle ?? null,
    p_duration_value:      duration_value ?? null,
    p_duration_unit:       duration_unit ?? null,
    p_amount:              amount ?? null,
    p_currency:            typeof currency === "string" ? currency.toUpperCase() : "USD",
    p_is_subscription:     Boolean(is_subscription),
    p_is_enabled:          is_enabled !== false,
    p_display_name:        display_name ?? null,
    p_description:         description ?? null,
    p_metadata:            metadata ?? {},
  });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    if (m.appCode === "DUPLICATE_PRODUCT_MAPPING") {
      const existingId = error.message.replace("DUPLICATE_PRODUCT_MAPPING:", "").trim();
      return err(m.appCode, "A product mapping already exists for this (provider, product_id, offer_id) combination.", m.http, { existing_id: existingId });
    }
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, product: data });
}

async function handleDeleteProduct(svc: ReturnType<typeof createServiceClient>, body: any) {
  const { id } = body ?? {};
  if (typeof id !== "string" || id.length === 0) {
    return err("INVALID_REQUEST", "id is required", 400);
  }
  const { data, error } = await svc.rpc("admin_delete_provider_product", { p_id: id });
  if (error) {
    const m = mapPgError(error.message, String(error.code ?? ""));
    return err(m.appCode, error.message, m.http);
  }
  return json({ success: true, product: data });
}

// ── Dispatcher ──────────────────────────────────────────────
async function dispatch(action: string, body: any, svc: ReturnType<typeof createServiceClient>): Promise<Response> {
  switch (action) {
    case "summary":              return handleSummary(svc);
    case "list_providers":       return handleListProviders(svc);
    case "get_provider":         return handleGetProvider(svc, body);
    case "upsert_provider":      return handleUpsertProvider(svc, body);
    case "toggle_provider":      return handleToggleProvider(svc, body);
    case "list_products":        return handleListProducts(svc, body);
    case "upsert_product":       return handleUpsertProduct(svc, body);
    case "delete_product":       return handleDeleteProduct(svc, body);
    default:
      return err("UNKNOWN_ACTION", `Unknown action '${action}'`, 400);
  }
}

// ── Main handler ────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return err("METHOD_NOT_ALLOWED", "POST required", 405);
  }

  // Step 1: auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return err("UNAUTHORIZED", "Authorization header required", 401);
  }

  const admin = await verifyAdmin(authHeader);
  if (!admin) {
    return err("ADMIN_REQUIRED", "Admin access required", 403);
  }

  // Step 2: parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const action = body?.action;
  if (typeof action !== "string" || action.length === 0) {
    return err("INVALID_REQUEST", "action is required", 400);
  }

  // Step 3: dispatch (service client bypasses RLS; M55 RPCs check admin role themselves)
  const svc = createServiceClient();

  try {
    console.info("[admin-payment-providers] action=%s user=%s", action, admin.userId);
    const response = await dispatch(action, body, svc);
    console.info("[admin-payment-providers] action=%s status=%d", action, response.status);
    return response;
  } catch (err) {
    console.error("[admin-payment-providers] unexpected:", err);
    return err("INTERNAL_ERROR", err instanceof Error ? err.message : "Internal error", 500);
  }
});
