// ============================================================
// GENERATE-ADMIN-2FA — Setup TOTP for an admin user
// ============================================================
// Flow:
//   1. Verify caller is authenticated + admin-allowlisted
//   2. Generate cryptographically random TOTP secret (20 bytes)
//   3. Encrypt secret with AES-256-GCM using ADMIN_2FA_ENCRYPTION_KEY
//   4. Store encrypted secret (is_enabled = false until verified)
//   5. Return base32 secret + otpauth URI for QR code generation
//      (secret is ONLY returned here — never again after setup)
//
// Security:
//   - Secret never stored in plaintext
//   - Encryption key lives only in Supabase secrets
//   - If setup already complete (is_enabled=true), returns 409
//   - Idempotent: re-calling before verification regenerates secret
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_HEX   = Deno.env.get("ADMIN_2FA_ENCRYPTION_KEY") ?? "";

// ── AES-256-GCM helpers ────────────────────────────────────
async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(plaintext: string, hexKey: string): Promise<string> {
  const key  = await importKey(hexKey);
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  // Format: base64(iv):base64(ciphertext)
  const b64  = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `${b64(iv.buffer)}:${b64(ct)}`;
}

// ── Base32 encoding (RFC 4648) ─────────────────────────────
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function toBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

// ── Admin verification ─────────────────────────────────────
async function verifyAdmin(authHeader: string): Promise<{ userId: string; email: string } | null> {
  const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const token         = authHeader.replace("Bearer ", "");

  // Verify JWT with service client (has permission to call auth.getUser)
  const { data: { user }, error } = await serviceClient.auth.getUser(token);
  if (error || !user) return null;

  // Use anon key + user's JWT so auth.uid() works inside the RPC
  const ANON_KEY   = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await userClient.rpc("get_admin_access");
  const access = (data ?? {}) as { is_admin?: boolean };
  if (!access.is_admin) return null;

  return { userId: user.id, email: user.email ?? "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const admin = await verifyAdmin(authHeader);
    if (!admin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
      console.error("[generate-admin-2fa] ADMIN_2FA_ENCRYPTION_KEY not configured or wrong length");
      return new Response(JSON.stringify({ error: "2FA service not configured" }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Check if 2FA already fully enabled
    const { data: existing } = await supabase
      .from("admin_2fa")
      .select("is_enabled")
      .eq("user_id", admin.userId)
      .maybeSingle();

    if (existing?.is_enabled) {
      return new Response(JSON.stringify({ error: "2FA already enabled. Disable first to re-setup." }), {
        status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Generate 20-byte (160-bit) random secret — RFC 6238 recommended minimum
    const secretBytes  = crypto.getRandomValues(new Uint8Array(20));
    const secretBase32 = toBase32(secretBytes);

    // Encrypt before storage
    const secretEncrypted = await encryptSecret(secretBase32, ENC_KEY_HEX);

    // Upsert (idempotent — allows re-setup before verification)
    const { error: upsertErr } = await supabase
      .from("admin_2fa")
      .upsert({
        user_id:          admin.userId,
        secret_encrypted: secretEncrypted,
        is_enabled:       false,
        backup_codes:     [],
        failed_attempts:  0,
        locked_until:     null,
      }, { onConflict: "user_id" });

    if (upsertErr) {
      console.error("[generate-admin-2fa] upsert error:", upsertErr);
      return new Response(JSON.stringify({ error: "Failed to initialize 2FA" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Audit log
    await supabase.from("admin_2fa_audit").insert({
      user_id: admin.userId,
      event:   "setup_initiated",
    });

    // Build otpauth URI for QR code
    const issuer   = "RobinOS Admin";
    const label    = encodeURIComponent(`${issuer}:${admin.email}`);
    const otpauth  = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    // Return secret ONCE — never returned again after this
    return new Response(JSON.stringify({
      secret:  secretBase32,   // shown to user for manual entry
      otpauth,                 // encoded into QR code by frontend
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[generate-admin-2fa] unexpected:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
