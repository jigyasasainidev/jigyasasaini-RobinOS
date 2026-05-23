// ============================================================
// TREND RADAR — Structured Error Utilities
// ============================================================

export type ErrorCode =
  | "unauthorized"
  | "invalid_payload"
  | "rate_limited"
  | "upstream_error"
  | "temporary_unavailable"
  | "method_not_allowed";

export interface ApiError {
  ok: false;
  code: ErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export function errUnauthorized(): ApiError {
  return { ok: false, code: "unauthorized", message: "Missing or invalid API key. Pass via x-api-key header or Authorization: Bearer <key>." };
}

export function errInvalidPayload(detail: string): ApiError {
  return { ok: false, code: "invalid_payload", message: `Invalid request: ${detail}` };
}

export function errRateLimited(retryAfterSeconds: number): ApiError {
  return { ok: false, code: "rate_limited", message: `Rate limit exceeded. Max 20 requests per 60 seconds.`, retryAfterSeconds };
}

export function errUpstream(detail?: string): ApiError {
  return { ok: false, code: "upstream_error", message: detail || "One or more upstream sources failed. Partial results may be available." };
}

export function errUnavailable(detail?: string): ApiError {
  return { ok: false, code: "temporary_unavailable", message: detail || "Service temporarily unavailable." };
}

export function errMethodNotAllowed(): ApiError {
  return { ok: false, code: "method_not_allowed", message: "Only GET and POST are supported on this endpoint." };
}

// Map error codes to HTTP status codes
export function statusForError(code: ErrorCode): number {
  switch (code) {
    case "unauthorized":       return 401;
    case "invalid_payload":    return 400;
    case "rate_limited":       return 429;
    case "method_not_allowed": return 405;
    case "upstream_error":     return 503;
    case "temporary_unavailable": return 503;
    default:                   return 500;
  }
}
