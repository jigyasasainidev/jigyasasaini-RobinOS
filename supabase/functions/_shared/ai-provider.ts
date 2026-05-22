// ============================================================
// ROBINOS — CENTRALIZED AI PROVIDER ADAPTER
// ============================================================
// ALL edge functions must import AI calls from here.
// No function should know the provider URL, model name,
// or API key — those are this module's responsibility only.
//
// CURRENT PROVIDER: Groq (OpenAI-compatible)
//
// Future migration path:
//   - swap PROVIDER_URL / DEFAULT_MODEL constants
//   - edge functions need zero changes
//
// STARTUP VALIDATION:
//   Call validateAIConfig() at the top of every edge function
//   handler (after OPTIONS check). It returns a 503 Response
//   if the key is missing, so the function fails fast with a
//   structured error instead of a mystery 500 mid-execution.
// ============================================================

import { CORS_HEADERS } from "./entitlement.ts";

// ── Provider constants — change here only ──────────────────
const PROVIDER_URL = "https://api.groq.com/openai/v1/chat/completions";

// Default model for generation tasks (tool calling, structured output)
export const AI_MODEL_DEFAULT   = "llama-3.3-70b-versatile";
// Lightweight model for simple text transformations (no tool calls)
export const AI_MODEL_FAST      = "llama-3.1-8b-instant";

// ── Types ───────────────────────────────────────────────────

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AICallOptions {
  model?: string;
  messages: AIMessage[];
  tools?: AITool[];
  tool_choice?: { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" };
  timeoutMs?: number;
}

export type AICallResult =
  | { ok: true;  data: Record<string, unknown> }
  | { ok: false; code: string; status: number; message: string };

// ── Startup validation ──────────────────────────────────────

/**
 * Call at the top of every handler (after OPTIONS check).
 * Returns null if the provider is configured, or a 503 Response
 * to return immediately if the key is missing.
 *
 * Usage:
 *   const configError = validateAIConfig();
 *   if (configError) return configError;
 */
export function validateAIConfig(): Response | null {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) {
    console.error(JSON.stringify({
      fn: "ai-provider",
      phase: "STARTUP_VALIDATION_FAILED",
      var: "GROQ_API_KEY",
      ts: Date.now(),
    }));
    return new Response(
      JSON.stringify({
        success: false,
        code: "PROVIDER_CONFIG_ERROR",
        message: "AI provider unavailable — configuration missing",
      }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
  return null;
}

/**
 * Returns the validated API key. Only call after validateAIConfig() passed.
 * Throws if missing (should never happen after validateAIConfig).
 */
export function getAIKey(): string {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY not found — call validateAIConfig() first");
  return key;
}

// ── Core provider call ──────────────────────────────────────

/**
 * Single provider-aware fetch.
 * Edge functions call this — never fetch() directly.
 *
 * Returns a typed result union:
 *   { ok: true, data }   — parsed JSON from provider
 *   { ok: false, code, status, message } — categorized error, ready to forward
 */
export async function callAI(options: AICallOptions): Promise<AICallResult> {
  const apiKey = getAIKey();
  const timeoutMs = options.timeoutMs ?? 45_000;
  const model = options.model ?? AI_MODEL_DEFAULT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
  };
  if (options.tools)         body.tools = options.tools;
  if (options.tool_choice)   body.tool_choice = options.tool_choice;
  if (options.response_format) body.response_format = options.response_format;

  try {
    const response = await fetch(PROVIDER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED",        status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    }
    if (response.status === 402) {
      return { ok: false, code: "CREDITS_EXHAUSTED",   status: 402, message: "AI provider credits exhausted." };
    }
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => "");
      console.error(JSON.stringify({ fn: "ai-provider", phase: "AUTH_ERROR", status: response.status }));
      return { ok: false, code: "PROVIDER_AUTH_ERROR", status: 503, message: "AI provider authentication failed." };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(JSON.stringify({ fn: "ai-provider", phase: "PROVIDER_ERROR", status: response.status }));
      return { ok: false, code: "AI_UNAVAILABLE",      status: 503, message: "AI provider returned an error. Please try again." };
    }

    const data = await response.json();
    return { ok: true, data };

  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (isAbort) {
      return { ok: false, code: "AI_TIMEOUT",     status: 503, message: "Generation timed out. Please try again." };
    }
    console.error(JSON.stringify({ fn: "ai-provider", phase: "NETWORK_ERROR", message: err instanceof Error ? err.message : "unknown" }));
    return { ok: false, code: "AI_UNAVAILABLE",   status: 503, message: "AI provider unreachable. Please try again." };
  }
}

/**
 * Build a structured 503 Response from an AICallResult error.
 * Use this in edge functions after checking result.ok === false.
 */
export function aiErrorResponse(result: Extract<AICallResult, { ok: false }>): Response {
  return new Response(
    JSON.stringify({ success: false, code: result.code, error: result.message }),
    { status: result.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}
