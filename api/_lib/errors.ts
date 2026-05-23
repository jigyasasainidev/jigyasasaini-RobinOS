// ============================================================
// TREND RADAR — Structured Error Utilities
// Stable external error envelope: { success, error: { code, message } }
// ============================================================

export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TEMPORARY_UNAVAILABLE"
  | "METHOD_NOT_ALLOWED";

export interface ApiError {
  success: false;
  error: {
    code:                ErrorCode;
    message:             string;
    retryAfterSeconds?:  number;
  };
}

export function errUnauthorized(): ApiError {
  return {
    success: false,
    error: {
      code:    "UNAUTHORIZED",
      message: "Invalid or missing API key. Pass via x-api-key header or Authorization: Bearer <key>.",
    },
  };
}

export function errInvalidPayload(detail: string): ApiError {
  return {
    success: false,
    error: {
      code:    "INVALID_PAYLOAD",
      message: `Invalid request: ${detail}`,
    },
  };
}

export function errRateLimited(retryAfterSeconds: number): ApiError {
  return {
    success: false,
    error: {
      code:               "RATE_LIMITED",
      message:            "Rate limit exceeded. Max 20 requests per 60 seconds.",
      retryAfterSeconds,
    },
  };
}

export function errUnavailable(detail?: string): ApiError {
  return {
    success: false,
    error: {
      code:    "TEMPORARY_UNAVAILABLE",
      message: detail || "Service temporarily unavailable. Please retry.",
    },
  };
}

export function errMethodNotAllowed(): ApiError {
  return {
    success: false,
    error: {
      code:    "METHOD_NOT_ALLOWED",
      message: "Only GET and POST are supported on this endpoint.",
    },
  };
}

export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":          return 401;
    case "INVALID_PAYLOAD":       return 400;
    case "RATE_LIMITED":          return 429;
    case "METHOD_NOT_ALLOWED":    return 405;
    case "UPSTREAM_ERROR":        return 503;
    case "TEMPORARY_UNAVAILABLE": return 503;
    default:                      return 500;
  }
}
