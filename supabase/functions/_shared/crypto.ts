// ============================================================
// CRYPTO UTILITIES — shared by all payment-provider edge functions
// ============================================================
// Provides:
//   1. AES-256-GCM encrypt/decrypt for payment_provider_secrets
//      (format: base64(iv::tag::ciphertext))
//   2. SHA-256 hex digest helper
//   3. Constant-time byte comparison (timing-safe equality)
//
// The encryption key is provisioned as PAYMENT_PROVIDER_ENCRYPTION_KEY
// in Supabase Edge Function Secrets (32-byte, base64-encoded).
//
// Decryption happens ONLY inside edge functions with the service role.
// Plaintext never appears in logs.
//
// Used by:
//   - payment-webhook (M3) to decrypt WP IPN security key
//   - admin-payment-providers (M2 follow-up) to encrypt secrets on save
//   - Future provider adapters that need to verify signatures
// ============================================================

const IV_BYTES = 12; // 96 bits — recommended for GCM
const KEY_BYTES = 32; // 256 bits

// ── Base64 helpers (URL-safe not required; standard b64 only) ──
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Key loading ─────────────────────────────────────────────
// Loads and decodes the project-level AES-256-GCM key from
// Supabase Edge Function Secrets. Throws on missing/invalid key
// so misconfiguration fails loudly at first use, not silently.

let cachedKey: Uint8Array | null = null;

export function loadEncryptionKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const b64 = Deno.env.get("PAYMENT_PROVIDER_ENCRYPTION_KEY");
  if (!b64) {
    throw new Error(
      "PAYMENT_PROVIDER_ENCRYPTION_KEY not configured in Edge Function Secrets",
    );
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(b64);
  } catch {
    throw new Error(
      "PAYMENT_PROVIDER_ENCRYPTION_KEY is not valid base64",
    );
  }

  if (keyBytes.byteLength !== KEY_BYTES) {
    throw new Error(
      `PAYMENT_PROVIDER_ENCRYPTION_KEY must be exactly ${KEY_BYTES} bytes (got ${keyBytes.byteLength})`,
    );
  }

  cachedKey = keyBytes;
  return keyBytes;
}

// ── AES-256-GCM encrypt/decrypt ─────────────────────────────
// Ciphertext format: base64(iv || tag || ciphertext)
// - iv:      12 bytes
// - tag:     16 bytes
// - ciphertext: N bytes

const TAG_BYTES = 16;

export async function encryptSecret(plaintext: string): Promise<string> {
  const keyBytes = loadEncryptionKey();
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
    key,
    plaintextBytes,
  );

  const tag = new Uint8Array(ciphertextWithTag.slice(
    ciphertextWithTag.byteLength - TAG_BYTES,
  ));
  const ciphertext = new Uint8Array(ciphertextWithTag.slice(
    0,
    ciphertextWithTag.byteLength - TAG_BYTES,
  ));

  // Format: iv :: tag :: ciphertext
  const combined = new Uint8Array(iv.length + tag.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(tag, iv.length);
  combined.set(ciphertext, iv.length + tag.length);

  return bytesToBase64(combined);
}

export async function decryptSecret(stored: string): Promise<string> {
  if (!stored || typeof stored !== "string") {
    throw new Error("decryptSecret: stored value is empty or not a string");
  }

  let combined: Uint8Array;
  try {
    combined = base64ToBytes(stored);
  } catch {
    throw new Error("decryptSecret: stored value is not valid base64");
  }

  if (combined.byteLength < IV_BYTES + TAG_BYTES) {
    throw new Error("decryptSecret: stored value is too short to be valid");
  }

  const iv = combined.slice(0, IV_BYTES);
  const tag = combined.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.slice(IV_BYTES + TAG_BYTES);

  const keyBytes = loadEncryptionKey();
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext, 0);
  ciphertextWithTag.set(tag, ciphertext.length);

  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
      key,
    ciphertextWithTag,
    );
  } catch {
    // Decryption failure could be wrong key, tampered ciphertext, or corrupt tag.
    // Never include the stored value in the thrown message.
    throw new Error("decryptSecret: decryption failed (wrong key or tampered data)");
  }

  return new TextDecoder().decode(plaintextBytes);
}

// ── SHA-256 hex digest ──────────────────────────────────────
// Used to compute payload_hash for webhook_events.raw_payload.
// The enqueue_webhook_event RPC also computes payload_hash
// internally on the canonicalized jsonb; this helper is for
// diagnostic / signature pre-checks only.

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

// ── Constant-time comparison ────────────────────────────────
// Compares two strings in constant time. Returns false on
// length mismatch WITHOUT short-circuiting on the first byte
// difference. Used to verify signatures / shared secrets against
// attacker-controlled input to prevent timing attacks.

export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);

  // Pad the shorter buffer so length mismatch still touches every byte.
  const len = Math.max(aBytes.byteLength, bBytes.byteLength);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(aBytes, 0);
  bPadded.set(bBytes, 0);

  let diff = aBytes.byteLength ^ bBytes.byteLength; // 0 only if lengths match
  for (let i = 0; i < len; i++) {
    diff |= aPadded[i] ^ bPadded[i];
  }
  return diff === 0;
}

// ── Test-only exports (not used in production paths) ────────
// These exist so unit tests / debug scripts can re-encrypt
// a known plaintext and verify round-trip parity.
export const _internal = {
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
};
