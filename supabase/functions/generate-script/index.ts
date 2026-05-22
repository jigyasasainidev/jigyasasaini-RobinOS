import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
  createErrorResponse,
} from "../_shared/entitlement.ts";

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
// AI PROVIDER FETCH — with AbortController timeout
// ============================================================
async function fetchAICompletion(
  apiKey: string,
  topic: string,
  tone: string,
  length: string,
  timeoutMs = 45_000,
): Promise<{ content: string | null; error: string | null; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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
        stream: false,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { content: null, error: `HTTP_${response.status}`, status: response.status };
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content ?? "").trim();
    return { content: content || null, error: content ? null : "EMPTY_CONTENT", status: 200 };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      content: null,
      error: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
      status: 503,
    };
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

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
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) {
    logError("ENV_MISSING", { var: "GROQ_API_KEY" });
    return createErrorResponse("INTERNAL_ERROR", "AI provider not configured", 503);
  }

  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user?.id) {
    logError("USER_RESOLUTION_FAILED");
    return createErrorResponse("UNAUTHORIZED", "Invalid or expired token", 401);
  }

  log("AUTH_VERIFIED", { user_id: user.id, elapsed_ms: Date.now() - startMs });

  // ── PHASE 4: AI generation (with timeout) ─────────────────
  log("AI_REQUEST_STARTED", { model: "llama-3.3-70b-versatile", topic_length: topic.length });

  const aiStart = Date.now();
  const { content, error: aiError, status: aiStatus } = await fetchAICompletion(
    GROQ_API_KEY,
    topic,
    tone,
    length,
  );

  const aiElapsed = Date.now() - aiStart;

  if (aiError === "TIMEOUT") {
    logError("AI_TIMEOUT", { timeout_ms: 45000, elapsed_ms: aiElapsed });
    return new Response(
      JSON.stringify({ success: false, code: "AI_UNAVAILABLE", error: "Generation timed out. Please try again." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (aiError === "HTTP_429" || aiStatus === 429) {
    logError("AI_RATE_LIMITED", { elapsed_ms: aiElapsed });
    return new Response(
      JSON.stringify({ success: false, code: "RATE_LIMITED", error: "Rate limit exceeded. Please try again in a moment." }),
      { status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (aiError === "HTTP_402" || aiStatus === 402) {
    logError("AI_CREDITS_EXHAUSTED", { elapsed_ms: aiElapsed });
    return new Response(
      JSON.stringify({ success: false, code: "CREDITS_EXHAUSTED", error: "AI credits exhausted." }),
      { status: 402, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (aiError && aiError !== "EMPTY_CONTENT") {
    logError("AI_PROVIDER_ERROR", { error_code: aiError, status: aiStatus, elapsed_ms: aiElapsed });
    return new Response(
      JSON.stringify({ success: false, code: "AI_UNAVAILABLE", error: "AI processing failed. Please try again." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (!content) {
    logError("AI_EMPTY_CONTENT", { model: "llama-3.3-70b-versatile", elapsed_ms: aiElapsed });
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

  // ── PHASE 5: Persistence (non-fatal fire-and-forget) ──────
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
