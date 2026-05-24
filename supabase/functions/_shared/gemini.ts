// ============================================================
// ROBINOS — GEMINI AI PROVIDER (lean, single-file)
// ============================================================
// Single env var required: GEMINI_API_KEY
// Model: gemini-2.0-flash (fast, cheap, tool-calling support)
// OpenAI-compatible interface via Google's REST API
// ============================================================

import { CORS_HEADERS } from "./entitlement.ts";

// ── Config ─────────────────────────────────────────────────
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_MODEL_DEFAULT = "gemini-2.0-flash";
export const GEMINI_MODEL_FAST    = "gemini-2.0-flash-lite";

// ── Types ───────────────────────────────────────────────────
export interface GeminiMessage {
  role:    "user" | "model";
  parts:   Array<{ text: string }>;
}

export interface GeminiTool {
  functionDeclarations: Array<{
    name:        string;
    description: string;
    parameters:  Record<string, unknown>;
  }>;
}

export interface GeminiCallOptions {
  model?:         string;
  systemPrompt?:  string;
  messages:       Array<{ role: "system" | "user" | "assistant" | "model"; content: string }>;
  tools?:         Array<{
    type: "function";
    function: {
      name:        string;
      description: string;
      parameters:  Record<string, unknown>;
    };
  }>;
  tool_choice?:   { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" };
  timeoutMs?:     number;
}

export type GeminiResult =
  | { ok: true;  data: GeminiResponseData }
  | { ok: false; code: string; status: number; message: string };

export interface GeminiResponseData {
  // Normalized to OpenAI-compatible shape for minimal call-site changes
  choices: Array<{
    message: {
      content:    string | null;
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

// ── Startup validation ──────────────────────────────────────
export function validateGeminiConfig(): Response | null {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    console.error(JSON.stringify({ fn: "gemini", phase: "MISSING_KEY", ts: Date.now() }));
    return new Response(
      JSON.stringify({ success: false, code: "PROVIDER_CONFIG_ERROR", message: "AI provider unavailable — GEMINI_API_KEY not configured." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
  return null;
}

// ── Core call ───────────────────────────────────────────────
export async function callGemini(opts: GeminiCallOptions): Promise<GeminiResult> {
  const apiKey     = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return { ok: false, code: "PROVIDER_CONFIG_ERROR", status: 503, message: "GEMINI_API_KEY not set." };

  const model      = opts.model ?? GEMINI_MODEL_DEFAULT;
  const timeoutMs  = opts.timeoutMs ?? 25_000;

  // ── Convert OpenAI-style messages → Gemini contents format ──
  // System prompt → systemInstruction (separate field)
  let systemInstruction: string | undefined;
  const contents: GeminiMessage[] = [];

  for (const msg of opts.messages) {
    if (msg.role === "system") {
      systemInstruction = (systemInstruction ? systemInstruction + "\n" : "") + msg.content;
    } else {
      contents.push({
        role:  msg.role === "assistant" || msg.role === "model" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  // Gemini requires alternating user/model turns — ensure first is user
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Start." }] });
  }

  // ── Build request body ────────────────────────────────────
  const body: Record<string, unknown> = { contents };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // JSON mode → add to system instruction
  if (opts.response_format?.type === "json_object") {
    const jsonNote = "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences.";
    body.systemInstruction = {
      parts: [{ text: (systemInstruction ?? "") + jsonNote }],
    };
  }

  // Tools (function calling)
  if (opts.tools && opts.tools.length > 0) {
    body.tools = [{
      functionDeclarations: opts.tools.map((t) => ({
        name:        t.function.name,
        description: t.function.description,
        parameters:  t.function.parameters,
      })),
    }];

    if (opts.tool_choice) {
      body.toolConfig = {
        functionCallingConfig: {
          mode:                    "ANY",
          allowedFunctionNames:    [opts.tool_choice.function.name],
        },
      };
    }
  }

  // Generation config
  body.generationConfig = { temperature: 0.7, maxOutputTokens: 2048 };

  // ── Fetch ────────────────────────────────────────────────
  const endpoint = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const ctrl     = new AbortController();
  const timer    = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) return { ok: false, code: "RATE_LIMITED",        status: 429, message: "Gemini rate limit exceeded. Retry shortly." };
    if (res.status === 403) return { ok: false, code: "PROVIDER_AUTH_ERROR", status: 503, message: "Gemini API key invalid or quota exhausted." };
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(JSON.stringify({ fn: "gemini", phase: "HTTP_ERROR", status: res.status, body: errText.slice(0, 200) }));
      return { ok: false, code: "AI_UNAVAILABLE", status: 503, message: `Gemini returned HTTP ${res.status}.` };
    }

    const raw = await res.json();

    // ── Normalize to OpenAI-compatible shape ─────────────
    const candidate   = raw?.candidates?.[0];
    const parts       = candidate?.content?.parts ?? [];
    const textContent = parts.find((p: any) => p.text)?.text ?? null;
    const fnCall      = parts.find((p: any) => p.functionCall);

    const normalized: GeminiResponseData = {
      choices: [{
        message: {
          content:    textContent,
          tool_calls: fnCall ? [{
            function: {
              name:      fnCall.functionCall.name,
              arguments: JSON.stringify(fnCall.functionCall.args ?? {}),
            },
          }] : undefined,
        },
      }],
    };

    return { ok: true, data: normalized };

  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok:      false,
      code:    isTimeout ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
      status:  503,
      message: isTimeout ? "Gemini timed out. Try again." : (err instanceof Error ? err.message : "Network error"),
    };
  }
}

// ── Error response helper ────────────────────────────────────
export function geminiErrorResponse(result: Extract<GeminiResult, { ok: false }>): Response {
  return new Response(
    JSON.stringify({ success: false, code: result.code, error: result.message }),
    { status: result.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}
