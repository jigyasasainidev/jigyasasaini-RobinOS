// ============================================================
// PROVIDER ADAPTER INTERFACE
// ============================================================
// Contract that every payment-provider adapter implements.
//
// The payment-webhook dispatcher loads the adapter by
// payment_providers.id (the URL path segment) and delegates
// provider-specific work to it. Everything else — provider
// enable/disable, IP allowlist, secret loading, decryption,
// idempotency, enqueue, response codes — lives in the dispatcher
// and is provider-agnostic.
//
// Adding a new provider requires:
//   1. Implement this interface
//   2. Register the adapter in _shared/providers/registry.ts
//   3. Add a row in payment_providers via admin UI
//   4. Store the provider's secret via admin UI or SQL bootstrap
//   5. Deploy the edge function — no schema changes required
// ============================================================

export interface ExtractedEventFields {
  /** Provider's canonical event id (used for idempotency). */
  providerEventId: string;

  /** Provider's transaction / sale / subscription id, if any. */
  providerTransactionId: string | null;

  /** Raw provider event type (e.g. "sale", "subscr_cancelled"). */
  providerEventType: string;

  /**
   * Provider-agnostic event type after adapter mapping
   * (e.g. "purchase.created", "subscription.cancelled").
   * May be null if the raw type is unrecognised.
   */
  standardizedEventType: string | null;

  /** How confident the mapping is: "exact" | "inferred" | "unknown". */
  eventMappingConfidence: "exact" | "inferred" | "unknown";
}

export interface SignatureVerificationResult {
  isValid: boolean;

  /**
   * Short code when isValid=false. NEVER includes the secret or
   * the provided key. Allowed values:
   *   - "missing_secret_field"   — provider field absent from body
   *   - "missing_stored_secret"  — no active secret in DB
   *   - "length_mismatch"        — stored vs provided length differ
   *   - "mismatch"               — values differ
   *   - "decrypt_failed"         — could not decrypt stored secret
   *   - "unsupported_format"     — provider returned unexpected shape
   */
  reason?: string;
}

export interface ProviderAdapter {
  /** Stable provider id; matches payment_providers.id and URL path. */
  readonly id: string;

  /** Human-readable name for logs only. Never included in responses. */
  readonly displayName: string;

  /** Content-Type prefix this adapter accepts (e.g. "application/x-www-form-urlencoded"). */
  readonly expectedContentType: string;

  /**
   * Parse the raw request body into a structured record.
   * Must throw { code: "INVALID_PAYLOAD", field } if the body
   * cannot be parsed or is empty.
   */
  parseBody(rawBody: string, contentType: string): Record<string, string>;

  /**
   * Extract the canonical idempotency + event-type fields.
   * Must throw { code: "INVALID_PAYLOAD", field } if any required
   * field is missing or empty.
   */
  extractEventFields(body: Record<string, string>): ExtractedEventFields;

  /**
   * Verify the signature using the decrypted secret + raw body +
   * provider-specific signature strategy. Must use timing-safe
   * comparison internally.
   */
  verifySignature(
    decryptedSecret: string,
    body: Record<string, string>,
    rawBody: string,
    headers: Headers,
  ): SignatureVerificationResult;

  /**
   * Which row in payment_provider_secrets to use for signature
   * verification. Most providers use "webhook_secret"; WP uses
   * "ipn_security_key".
   */
  signatureSecretName(): string;
}

// ── Adapter error shape ────────────────────────────────────
// Adapters throw these to signal a 4xx-class failure with a
// specific field name. The dispatcher catches them and maps
// to HTTP 400 INVALID_PAYLOAD with { field }.

export interface AdapterPayloadError extends Error {
  code: "INVALID_PAYLOAD";
  field: string;
}

export function payloadError(field: string, message?: string): AdapterPayloadError {
  const err = new Error(message ?? `Missing or invalid required field: ${field}`) as AdapterPayloadError;
  err.code = "INVALID_PAYLOAD";
  err.field = field;
  return err;
}
