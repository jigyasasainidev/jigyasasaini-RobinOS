// ============================================================
// TREND RADAR — Structured Error Utilities
// ============================================================

export type ErrorCode =
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TEMPORARY_UNAVAILABLE"
  | "METHOD_NOT_ALLOWED";

export interface ApiError {
  success: false;
  error: {
    code:               ErrorCode;
    message:            string;
    retryAfterSeconds?: number;
  };
}

export function errInvalidPayload(detail: string): ApiError {
  return { success: false, error: { code: "INVALID_PAYLOAD", message: `Invalid request: ${detail}` } };
}

export function errRateLimited(retryAfterSeconds: number): ApiError {
  return { success: false, error: { code: "RATE_LIMITED", message: "Rate limit exceeded. Max 20 requests per 60 seconds.", retryAfterSeconds } };
}

export function errUnavailable(detail?: string): ApiError {
  return { success: false, error: { code: "TEMPORARY_UNAVAILABLE", message: detail || "Service temporarily unavailable." } };
}

export function errMethodNotAllowed(): ApiError {
  return { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and POST are supported." } };
}

export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "INVALID_PAYLOAD":       return 400;
    case "RATE_LIMITED":          return 429;
    case "METHOD_NOT_ALLOWED":    return 405;
    case "UPSTREAM_ERROR":        return 503;
    case "TEMPORARY_UNAVAILABLE": return 503;
    default:                      return 500;
  }
}
