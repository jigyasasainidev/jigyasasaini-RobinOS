import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  createErrorResponse,
} from "../_shared/entitlement.ts";
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
// GROQ CONSTANTS
// ============================================================
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// Groq decommissioned llama-3.3-70b-versatile on 2026-08-16.
// openai/gpt-oss-120b is the recommended replacement (tool use + JSON).
const GROQ_MODEL    = "openai/gpt-oss-120b";

// ============================================================
// GROQ API CALL (OpenAI-compatible)
// ============================================================
async function callGroq(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 25_000
): Promise<string> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:                 GROQ_MODEL,
        temperature:           0.7,
        max_completion_tokens: 4096,
        reasoning_effort:      "low",
        messages,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? "Groq request timed out" : `Groq network error: ${err}`);
  }
  clearTimeout(timer);

  if (res.status === 429) throw new Error("Groq rate limit exceeded. Please retry shortly.");
  if (res.status === 401 || res.status === 403) throw new Error("Groq API key invalid or quota exhausted.");
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[generate-script] Groq HTTP error", res.status, errText.slice(0, 200));
    throw new Error(`Groq returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const content: string | null = data?.choices?.[0]?.message?.content?.trim() ?? null;

  if (!content) {
    console.error("[generate-script] Groq empty response:", JSON.stringify(data).slice(0, 400));
    throw new Error("Groq returned empty content");
  }

  log("GROQ_RESPONSE_OK", { content_length: content.length });
  return content;
}

// ============================================================
// MAIN HANDLER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Startup: validate Groq key ────────────────────────────
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    logError("MISSING_GROQ_KEY");
    return new Response(
      JSON.stringify({ success: false, code: "PROVIDER_CONFIG_ERROR", error: "AI provider not configured." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

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

  // ── PHASE 2 + 3: Entitlement check AND user resolution in parallel ──
  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");

  const [entitlementResult, userResult] = await Promise.all([
    checkAndIncrementUsage(authHeader, FEATURES.SCRIPT_GENERATION, requestId),
    supabase.auth.getUser(token),
  ]);

  const { result: entitlement, error: entitlementError } = entitlementResult;

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
    elapsed_ms: Date.now() - startMs,
  });

  const { data: { user }, error: authError } = userResult;
  if (authError || !user?.id) {
    logError("USER_RESOLUTION_FAILED");
    return createErrorResponse("UNAUTHORIZED", "Invalid or expired token", 401);
  }

  log("AUTH_VERIFIED", { user_id: user.id, elapsed_ms: Date.now() - startMs });

  // ── PHASE 4: AI generation via Groq ─────────────────────────
  log("AI_REQUEST_STARTED", { model: GROQ_MODEL, topic_length: topic.length });

  const aiStart = Date.now();
  let content: string;

  try {
    content = await callGroq(groqKey, [
      {
        role: "system",
        content: `You are an elite viral script writer for short-form and long-form content. Write scripts that maximize retention, emotional impact, and shareability. When a trend signal is mentioned in the topic, reference it naturally to make the script feel current.

Generate:
1. **3 HOOKS** (different styles: question, bold statement, story opener)
2. **FULL SCRIPT** (with timestamps and [VISUAL CUE] directions)
3. **EDITING DIRECTIONS** (5 specific visual instructions)

Be specific, concise, and ruthlessly engaging.`,
      },
      {
        role: "user",
        content: `Topic: "${topic}"\nTone: ${tone}\nLength: ${length}`,
      },
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown AI error";
    logError("AI_PROVIDER_ERROR", { error: msg, elapsed_ms: Date.now() - aiStart });
    const status = msg.includes("rate limit") ? 429 : 503;
    return new Response(
      JSON.stringify({ success: false, code: "AI_UNAVAILABLE", error: msg }),
      { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  const aiElapsed = Date.now() - aiStart;
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

  return new Response(JSON.stringify({
    success: true,
    output: content,
    usage: entitlement,
  }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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