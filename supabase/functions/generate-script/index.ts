import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  createErrorResponse,
} from "../_shared/entitlement.ts";
import {
  validateAIConfig,
  callAI,
  aiErrorResponse,
  AI_MODEL_DEFAULT,
} from "../_shared/ai-provider.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ============================================================
// STRUCTURED LOGGER — no secrets, no tokens, no API keys
// ============================================================
function log(phase: string, meta: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ fn: "generate-script", phase, ...meta, ts: Date.now() }));
}

function logError(phase: string, meta: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ fn: "generate-script", phase, ...meta, ts: Date.now() }));
}

// ============================================================
// MAIN HANDLER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Startup: validate AI provider config ──────────────────
  const configError = validateAIConfig();
  if (configError) return configError;

  const startMs = Date.now();

  try {
  log("REQUEST_RECEIVED", { method: req.method });

  // ── PHASE 1: Auth + request parsing ──────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    logError("AUTH_MISSING");
    return createErrorResponse("AUTH_REQUIRED", "Authorization header required", 401);
  }

  let topic: string, tone: string, length: string, request_id: string | undefined;
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").trim();
    tone = String(body?.tone ?? "Casual");
    length = String(body?.length ?? "60s Reel");
    request_id = body?.request_id ? String(body.request_id) : undefined;
  } catch {
    logError("REQUEST_PARSE_ERROR");
    return createErrorResponse("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }

  if (!topic) {
    logError("TOPIC_MISSING");
    return createErrorResponse("INVALID_REQUEST", "Topic is required", 400);
  }

  const requestId = request_id || crypto.randomUUID();

  // ── PHASE 2: Entitlement check + atomic quota increment ───
  const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
    authHeader,
    FEATURES.SCRIPT_GENERATION,
    requestId,
  );

  if (entitlementError) {
    if (entitlement && !entitlement.success) {
      logError("ENTITLEMENT_DENIED", {
        code: entitlement.code,
        plan: entitlement.plan,
        feature: entitlement.feature,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: entitlement.message ?? "Daily limit reached — upgrade to continue creating",
          code: entitlement.code,
          feature: entitlement.feature,
          plan: entitlement.plan,
          limit: entitlement.limit,
          used: entitlement.used,
          remaining: entitlement.remaining,
          reset_at: entitlement.reset_at,
        }),
        { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    logError("ENTITLEMENT_ERROR");
    return entitlementError;
  }

  log("ENTITLEMENT_PASSED", {
    plan: entitlement.plan,
    used: entitlement.used,
    remaining: entitlement.remaining,
    code: entitlement.code,
    elapsed_ms: Date.now() - startMs,
  });

  // ── PHASE 3: User resolution ──────────────────────────────
  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user?.id) {
    logError("USER_RESOLUTION_FAILED");
    return createErrorResponse("UNAUTHORIZED", "Invalid or expired token", 401);
  }

  log("AUTH_VERIFIED", { user_id: user.id, elapsed_ms: Date.now() - startMs });

  // ── PHASE 4: AI generation via provider adapter ───────────
  log("AI_REQUEST_STARTED", { model: AI_MODEL_DEFAULT, topic_length: topic.length });

  const aiStart = Date.now();
  const aiResult = await callAI({
    model: AI_MODEL_DEFAULT,
    messages: [
      {
        role: "system",
        content: `You are an elite viral script writer for short-form and long-form content. You write scripts that maximize retention, emotional impact, and shareability.

When given a topic, tone, and length, generate:

1. **3 HOOKS** (opening lines that stop the scroll — each should be a different style: question, bold statement, story opener)
2. **FULL SCRIPT** (structured with timestamps, pattern interrupts every 3-5 seconds for short-form, clear sections for long-form. Include [VISUAL CUE] directions inline.)
3. **EDITING DIRECTIONS** (5-7 specific visual editing instructions: b-roll suggestions, text overlays, transitions, sound effects, pacing notes)

Format the output clearly with markdown headers. Be specific, actionable, and ruthlessly engaging. The script should feel like it was written by a top-tier content strategist.`,
      },
      {
        role: "user",
        content: `Topic: "${topic}"\nTone: ${tone}\nLength: ${length}`,
      },
    ],
  });

  const aiElapsed = Date.now() - aiStart;

  if (!aiResult.ok) {
    logError("AI_PROVIDER_ERROR", { code: aiResult.code, status: aiResult.status, elapsed_ms: aiElapsed });
    return aiErrorResponse(aiResult);
  }

  const content = String(aiResult.data?.choices?.[0]?.message?.content ?? "").trim() || null;

  if (!content) {
    logError("AI_EMPTY_CONTENT", { model: AI_MODEL_DEFAULT, elapsed_ms: aiElapsed });
    // Non-fatal persist of empty result for debugging
    await supabase.from("script_generations").insert({
      user_id: user.id,
      request_id: requestId,
      prompt: topic,
      tone,
      content_length: length,
      generated_output: "",
      generation_status: "empty",
    }).then(({ error }) => { if (error) logError("PERSISTENCE_ERROR", { table: "script_generations", note: "empty_record" }); });

    return new Response(
      JSON.stringify({ success: false, code: "AI_UNAVAILABLE", error: "Generation returned empty result. Please try again." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  log("AI_RESPONSE_OK", { content_length: content.length, elapsed_ms: aiElapsed });

  // ── PHASE 5: Persistence + analytics (non-fatal fire-and-forget) ──
  Promise.all([
    supabase.from("script_generations").insert({
      user_id: user.id,
      request_id: requestId,
      prompt: topic,
      tone,
      content_length: length,
      generated_output: content,
      generation_status: "succeeded",
    }),
    supabase.from("script_history").insert({
      user_id: user.id,
      topic,
      tone,
      length,
      output: content,
    }),
  ]).then(([genResult, histResult]) => {
    if (genResult.error) logError("PERSISTENCE_ERROR", { table: "script_generations", error_code: genResult.error.code });
    if (histResult.error) logError("PERSISTENCE_ERROR", { table: "script_history", error_code: histResult.error.code });
    else log("PERSISTENCE_DONE", { request_id: requestId });
  });

  // Analytics — silent, never blocks response
  trackFeatureUsage({ supabase, userId: user.id, feature: FEATURES.SCRIPT_GENERATION });

  // ── PHASE 6: Response ────────────────────────────────────
  const totalElapsed = Date.now() - startMs;
  log("RESPONSE_SENT", { status: 200, elapsed_ms: totalElapsed });

  const streamPayload = `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
    usage: entitlement,
  })}\n\ndata: [DONE]\n\n`;

  return new Response(streamPayload, {
    headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream" },
  });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown runtime error";
    logError("FATAL_ERROR", { category: "INTERNAL_RUNTIME_ERROR", message });
    return new Response(
      JSON.stringify({ success: false, code: "INTERNAL_RUNTIME_ERROR", error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
