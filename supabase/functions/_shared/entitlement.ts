// ============================================================
// ROBINOS CENTRALIZED ENTITLEMENT LAYER
// Shared utilities for ALL edge functions
// ============================================================
// This is the ONLY place where entitlement logic lives.
// Edge functions MUST import from here — never duplicate.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type EntitlementResult = {
  success: boolean;
  code: string;
  feature: string;
  plan: string;
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
  reset_at?: string | null;
  unlimited?: boolean;
  fair_usage?: boolean;
  message?: string;
};

export type UsageStatusResult = {
  allowed: boolean;
  used: number;
  quota: number | null;
  remaining: number;
  near_limit: boolean;
  fair_usage: boolean;
  unlimited: boolean;
  byok_enabled: boolean;
  message: string;
};

export type FeatureCheckResult = {
  granted: boolean;
  plan: string;
  feature: string;
  message: string;
  entitlement?: EntitlementResult;
};

// ============================================================
// FEATURE KEY CONSTANTS
// Single source of truth for feature key strings
// ============================================================
export const FEATURES = {
  SCRIPT_GENERATION: "script_generation",
  CAPTION_GENERATION: "caption_generation",
  TREND_SCAN: "trend_scan",
  HASHTAG_SCAN: "hashtag_scan",
  TTS_GENERATION: "tts_generation",
  VIDEO_GENERATION: "video_generation",
  BYOK_ACCESS: "byok_access",
  ANALYTICS_ACCESS: "analytics_access",
  WATERMARK_REMOVAL: "watermark_removal",
  AUTOMATION_TOOLS: "automation_tools",
  EXPORT_ACCESS: "export_access",
} as const;

// ============================================================
// SUPABASE CLIENT FACTORIES
// ============================================================
export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceRoleKey);
}

export function createUserClient(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

// ============================================================
// AUTH VERIFICATION
// ============================================================
export async function verifyAuth(authHeader: string | null): Promise<{ userId: string; error: Response | null }> {
  if (!authHeader) {
    return {
      userId: "",
      error: new Response(
        JSON.stringify({ success: false, code: "AUTH_REQUIRED", message: "Authorization header required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user?.id) {
    return {
      userId: "",
      error: new Response(
        JSON.stringify({ success: false, code: "UNAUTHORIZED", message: "Invalid or expired token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  return { userId: user.id, error: null };
}

// ============================================================
// CORS HEADERS
// ============================================================
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// STANDARDIZED ERROR RESPONSES
// ============================================================
export function createErrorResponse(code: string, message: string, status: number = 400, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ success: false, code, message, ...extra }),
    { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

export function createEntitlementDeniedResponse(result: EntitlementResult): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: result.code,
      feature: result.feature,
      plan: result.plan,
      limit: result.limit,
      used: result.used,
      remaining: result.remaining,
      reset_at: result.reset_at,
      message: result.message || "Usage limit reached. Upgrade your plan to continue.",
    }),
    { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

// ============================================================
// ENTITLEMENT CHECK + ATOMIC INCREMENT
// The primary function all edge functions call.
// Validates usage and atomically increments in one RPC call.
// ============================================================
export async function checkAndIncrementUsage(
  authHeader: string,
  featureKey: string,
  idempotencyKey?: string
): Promise<{ result: EntitlementResult; error: Response | null }> {
  const { userId, error: authError } = await verifyAuth(authHeader);
  if (authError) {
    return { result: { success: false, code: "AUTH_REQUIRED", feature: featureKey, plan: "" }, error: authError };
  }

  const supabase = createUserClient(authHeader);

  const { data, error: rpcError } = await supabase.rpc("check_and_increment_usage", {
    p_user_id: userId,
    p_feature_key: featureKey,
    p_increment: 1,
    p_idempotency_key: idempotencyKey || null,
  });

  if (rpcError) {
    console.error(`[Entitlement] RPC error for ${featureKey}:`, rpcError);
    return {
      result: { success: false, code: "INTERNAL_ERROR", feature: featureKey, plan: "" },
      error: createErrorResponse("INTERNAL_ERROR", "Unable to verify usage limits right now.", 503),
    };
  }

  const result = data as EntitlementResult;

  if (!result.success) {
    return { result, error: createEntitlementDeniedResponse(result) };
  }

  return { result, error: null };
}

// ============================================================
// USAGE STATUS CHECK (READ-ONLY, NO INCREMENT)
// For displaying current usage in UI without consuming
// ============================================================
export async function getUsageStatus(
  authHeader: string,
  featureKey: string
): Promise<{ status: UsageStatusResult | null; error: Response | null }> {
  const { userId, error: authError } = await verifyAuth(authHeader);
  if (authError) {
    return { status: null, error: authError };
  }

  const supabase = createUserClient(authHeader);

  const { data, error: rpcError } = await supabase.rpc("get_usage_status_v2", {
    p_user_id: userId,
    p_feature_key: featureKey,
  });

  if (rpcError) {
    console.error(`[Entitlement] get_usage_status_v2 error for ${featureKey}:`, rpcError);
    return {
      status: null,
      error: createErrorResponse("INTERNAL_ERROR", "Unable to fetch usage status.", 503),
    };
  }

  return { status: data as UsageStatusResult, error: null };
}

// ============================================================
// PLAN CHECK (READ-ONLY)
// Checks if user has minimum required plan tier
// ============================================================
export async function checkPlanMinimum(
  authHeader: string,
  featureKey: string,
  minimumTier: string = "pro_creator"
): Promise<FeatureCheckResult> {
  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);

  if (!user?.id) {
    return { granted: false, plan: "", feature: featureKey, message: "Authentication required" };
  }

  const userSupabase = createUserClient(authHeader);
  const { data } = await userSupabase.rpc("get_entitlement", {
    p_user_id: user.id,
    p_feature_key: featureKey,
  });

  if (!data) {
    return { granted: false, plan: "", feature: featureKey, message: "Unable to verify plan" };
  }

  const plan = (data as Record<string, unknown>).plan as string;
  const enabled = (data as Record<string, unknown>).enabled as boolean;
  const limitValue = (data as Record<string, unknown>).limit_value as number;

  const granted = enabled && (limitValue !== 0);

  return {
    granted,
    plan,
    feature: featureKey,
    message: granted ? "Feature available" : `${featureKey} requires ${minimumTier} plan or higher.`,
    entitlement: data as unknown as EntitlementResult,
  };
}

// ============================================================
// FEATURE ACCESS CHECK (for frontend synchronization)
// Pure entitlement check without incrementing usage
// ============================================================
export function isFeatureEnabled(tier: string, featureKey: string, planEntitlements: Record<string, Record<string, { limit: number; enabled: boolean }>>): boolean {
  const plan = planEntitlements[tier];
  if (!plan) return false;
  const feature = plan[featureKey];
  if (!feature) return false;
  return feature.enabled && feature.limit !== 0;
}

export function getFeatureLimit(tier: string, featureKey: string, planEntitlements: Record<string, Record<string, { limit: number; enabled: boolean }>>): number {
  const plan = planEntitlements[tier];
  if (!plan) return 0;
  const feature = plan[featureKey];
  if (!feature) return 0;
  return feature.limit;
}

// ============================================================
// STANDARD EDGE FUNCTION HANDLER
// Helper that wraps the common pattern for all AI generation functions
// ============================================================
export async function handleGenerationRequest(
  req: Request,
  featureKey: string,
  generationFn: (userId: string, supabase: ReturnType<typeof createServiceClient>) => Promise<Response>
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("authorization");

  // Step 1: Verify auth + check entitlement + increment atomically
  const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
    authHeader || "",
    featureKey,
    crypto.randomUUID()
  );

  if (entitlementError) {
    return entitlementError;
  }

  // Step 2: Execute generation with service client
  const supabase = createServiceClient();
  const token = (authHeader || "").replace("Bearer ", "");

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user?.id) {
      return new Response(
        JSON.stringify({ success: false, code: "UNAUTHORIZED", message: "Invalid token" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const generationResponse = await generationFn(user.id, supabase);

    // Attach usage info to response if it's JSON
    const cloned = generationResponse.clone();
    const contentType = cloned.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await cloned.json();
      const enriched = { ...body, usage: entitlement };
      return new Response(JSON.stringify(enriched), {
        status: generationResponse.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return generationResponse;
  } catch (err) {
    console.error(`[${featureKey}] Generation error:`, err);
    return new Response(
      JSON.stringify({
        success: false,
        code: "GENERATION_FAILED",
        message: err instanceof Error ? err.message : "Generation failed",
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}