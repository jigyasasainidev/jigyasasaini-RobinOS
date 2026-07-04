// ============================================================
// WARRIORPLUS PROVIDER ADAPTER
// ============================================================
// Implements ProviderAdapter for WarriorPlus IPN webhooks.
//
// WarriorPlus IPN specifics (per WP docs):
//   - Content-Type: application/x-www-form-urlencoded
//   - Signature: WP_SECURITYKEY body field (raw shared secret)
//   - Idempotency key: IPN_ID (UUID-like alphanumeric)
//   - Transaction id: WP_SALE (preferred) or WP_TXNID
//   - Recipient type: IPN_RCPT_TYPE (vend | aff)
//
// Signature verification:
//   The vendor enters a shared secret in the WP account security
//   settings. WP forwards that exact string as the WP_SECURITYKEY
//   POST field. We compare it to the decrypted stored secret using
//   constant-time equality.
//
//   If real WP traffic reveals the value is a SHA-256 hex digest
//   (64 chars) rather than the raw secret, the dispatcher will
//   fall back to hash-mode comparison automatically — see the
//   design doc §15.2.
//
// What this adapter does NOT do (provider-agnostic; handled by
// the dispatcher):
//   - Provider enable/disable check
//   - IP allowlist
//   - Secret retrieval + decryption
//   - Idempotency / enqueue
//   - Response code selection
//   - Logging
// ============================================================

import {
  constantTimeEqual,
} from "../crypto.ts";
import {
  type ExtractedEventFields,
  type ProviderAdapter,
  type SignatureVerificationResult,
  payloadError,
} from "./types.ts";

// ── Content-Type handling ───────────────────────────────────
// WP sends application/x-www-form-urlencoded. We accept the
// type with optional parameters (e.g. "; charset=utf-8").
// multipart/form-data is rejected by the dispatcher with 415.

const EXPECTED_CONTENT_TYPE_PREFIX = "application/x-www-form-urlencoded";

// ── Field names (centralised so we don't typo them) ─────────

const F = {
  WP_ACTION:          "WP_ACTION",
  IPN_ID:             "IPN_ID",
  WP_SALE:            "WP_SALE",
  WP_TXNID:           "WP_TXNID",
  WP_ITEM_NUMBER:     "WP_ITEM_NUMBER",
  WP_SECURITYKEY:     "WP_SECURITYKEY",
  IPN_RCPT_TYPE:      "IPN_RCPT_TYPE",
} as const;

// ── WP_ACTION → standardized_event_type mapping ─────────────
// Per design doc §14.3. Confidence is "exact" for known values
// and "unknown" for anything not in this table (the event still
// gets enqueued, but standardized_event_type is null).

const WP_ACTION_MAP: Record<string, string> = {
  sale:                  "purchase.created",
  refund:                "purchase.refunded",
  dispute:               "purchase.disputed",

  subscr_created:        "subscription.created",
  subscr_completed:      "subscription.renewed",
  subscr_cancelled:      "subscription.cancelled",
  subscr_refunded:       "subscription.refunded",
  subscr_suspended:      "subscription.suspended",
  subscr_reactivated:    "subscription.reactivated",
  subscr_ended:          "subscription.ended",
  // Both payment-failure variants map to the same standardized type.
  subscr_failed_invalid:  "subscription.payment_failed",
  subscr_failed_declined: "subscription.payment_failed",
};

// ── Adapter implementation ──────────────────────────────────

export class WarriorPlusAdapter implements ProviderAdapter {
  readonly id = "warriorplus";
  readonly displayName = "WarriorPlus";
  readonly expectedContentType = EXPECTED_CONTENT_TYPE_PREFIX;

  /**
   * Accept the WP form-encoded content type. The dispatcher
   * already verified the prefix; this is the adapter's view of
   * "what it can handle".
   */
  matchesContentType(contentType: string): boolean {
    const ct = (contentType ?? "").trim().toLowerCase();
    return ct.startsWith(EXPECTED_CONTENT_TYPE_PREFIX);
  }

  // ── parseBody ─────────────────────────────────────────────
  // URL-decode the form-encoded body into a flat string map.
  // WP sends one value per key; we don't support multi-value
  // fields (WP doesn't use them).

  parseBody(rawBody: string, _contentType: string): Record<string, string> {
    if (!rawBody || rawBody.length === 0) {
      throw payloadError("_body", "Request body is empty");
    }

    const out: Record<string, string> = {};
    const pairs = rawBody.split("&");
    for (const pair of pairs) {
      if (!pair) continue;
      const eqIdx = pair.indexOf("=");
      let key: string;
      let value: string;
      if (eqIdx === -1) {
        key = pair;
        value = "";
      } else {
        key = pair.slice(0, eqIdx);
        value = pair.slice(eqIdx + 1);
      }
      try {
        const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
        const decodedValue = decodeURIComponent(value.replace(/\+/g, " "));
        // Last-wins on duplicate keys (defensive — WP doesn't dup).
        out[decodedKey] = decodedValue;
      } catch {
        throw payloadError("_body", "Body contains malformed percent-encoding");
      }
    }

    if (Object.keys(out).length === 0) {
      throw payloadError("_body", "Body parsed to zero fields");
    }

    return out;
  }

  // ── extractEventFields ────────────────────────────────────
  // Pull IPN_ID, WP_SALE (preferred) / WP_TXNID, WP_ACTION,
  // and map WP_ACTION → standardized_event_type.
  //
  // Required fields (per design doc §4.2):
  //   WP_ACTION, IPN_ID, WP_ITEM_NUMBER, WP_SECURITYKEY
  // Optional transaction id (WP_SALE / WP_TXNID).

  extractEventFields(body: Record<string, string>): ExtractedEventFields {
    const wpAction    = body[F.WP_ACTION]?.trim() ?? "";
    const ipnId       = body[F.IPN_ID]?.trim() ?? "";
    const wpItem      = body[F.WP_ITEM_NUMBER]?.trim() ?? "";
    const wpSecurity  = body[F.WP_SECURITYKEY] ?? "";

    if (!wpAction) {
      throw payloadError(F.WP_ACTION, "WP_ACTION is required");
    }
    if (!ipnId) {
      throw payloadError(F.IPN_ID, "IPN_ID is required");
    }
    if (!wpItem) {
      throw payloadError(F.WP_ITEM_NUMBER, "WP_ITEM_NUMBER is required");
    }
    if (!wpSecurity) {
      throw payloadError(F.WP_SECURITYKEY, "WP_SECURITYKEY is required");
    }

    // Transaction id: prefer WP_SALE, fall back to WP_TXNID.
    const transactionId =
      (body[F.WP_SALE]?.trim() || null) ??
      (body[F.WP_TXNID]?.trim() || null);

    const mapped = WP_ACTION_MAP[wpAction] ?? null;
    const standardizedEventType = mapped;
    const eventMappingConfidence: "exact" | "inferred" | "unknown" =
      mapped ? "exact" : "unknown";

    return {
      providerEventId: ipnId,
      providerTransactionId: transactionId,
      providerEventType: wpAction,
      standardizedEventType,
      eventMappingConfidence,
    };
  }

  // ── verifySignature ───────────────────────────────────────
  // Compares the WP_SECURITYKEY body field to the decrypted
  // stored secret using constant-time equality.
  //
  // Fallback: if the provided key is exactly 64 hex chars AND
  // the stored secret is NOT 64 hex chars, compare SHA-256(stored)
  // to the provided value. This handles the case where WP sends
  // a hash rather than the raw secret (see design doc §15.2).

  verifySignature(
    decryptedSecret: string,
    body: Record<string, string>,
    _rawBody: string,
    _headers: Headers,
  ): SignatureVerificationResult {
    const provided = body[F.WP_SECURITYKEY] ?? "";

    if (!provided) {
      return { isValid: false, reason: "missing_secret_field" };
    }
    if (!decryptedSecret) {
      return { isValid: false, reason: "missing_stored_secret" };
    }

    // Primary path: constant-time raw equality.
    if (constantTimeEqual(provided, decryptedSecret)) {
      return { isValid: true };
    }

    // Fallback path: provided looks like SHA-256 hex (64 chars,
    // 0-9a-f). Compare SHA-256(decryptedSecret) to it.
    if (
      provided.length === 64 &&
      /^[0-9a-fA-F]{64}$/.test(provided)
    ) {
      // Synchronous-style fallback that doesn't block Deno:
      // We compute SHA-256 synchronously via Web Crypto.
      // Since verifySignature is async-friendly, we return a
      // promise-friendly result by checking equality at the call
      // site. To keep the interface synchronous, we re-encode the
      // expected hash here.
      // NOTE: The dispatcher calls this synchronously; the
      // SHA-256 path is intentionally limited to a single check
      // — if it fails, signature is invalid. We compute the hash
      // inline using SubtleCrypto via a synchronous helper.
      const expectedHash = syncSha256Hex(decryptedSecret);
      if (constantTimeEqual(provided.toLowerCase(), expectedHash)) {
        return { isValid: true };
      }
    }

    return { isValid: false, reason: "mismatch" };
  }

  // ── signatureSecretName ───────────────────────────────────
  // WP's shared secret is stored under "ipn_security_key" so it
  // doesn't collide with other provider secrets.

  signatureSecretName(): string {
    return "ipn_security_key";
  }
}

// ── Synchronous SHA-256 hex ─────────────────────────────────
// SubtleCrypto.digest is async; this adapter's verifySignature
// is synchronous (per the ProviderAdapter interface). To keep
// the SHA-256 fallback path simple we expose a synchronous
// helper here. It uses a tiny pure-TS implementation; the
// fallback path is only consulted on a primary-path failure, so
// the perf cost is negligible.
//
// This is deliberately NOT exported from _shared/crypto.ts to
// keep the async/sync boundaries explicit.

function syncSha256Hex(input: string): string {
  return sha256Sync(input);
}

// ── Pure-TS SHA-256 (synchronous) ──────────────────────────
// Tiny, dependency-free implementation. Used only in the
// signature-fallback path of verifySignature. Not exported.

function sha256Sync(input: string): string {
  // Encode UTF-8 bytes.
  const bytes = new TextEncoder().encode(input);

  // SHA-256 constants.
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // Initial hash values.
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // Pre-processing: append 1 bit, pad with zeros, append length.
  const bitLen = bytes.byteLength * 8;
  const padLen = (bytes.byteLength + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  // Length in bits as 64-bit big-endian. We only support up to 2^32-1 bits.
  const lenHi = Math.floor(bitLen / 0x100000000);
  const lenLo = bitLen >>> 0;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, lenHi, false);
  dv.setUint32(padLen - 4, lenLo, false);

  // Process each 512-bit block.
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3;
    let e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  // Produce hex.
  const hex = (n: number) =>
    n.toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) +
         hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

function rotr(n: number, k: number): number {
  return ((n >>> k) | (n << (32 - k))) >>> 0;
}
