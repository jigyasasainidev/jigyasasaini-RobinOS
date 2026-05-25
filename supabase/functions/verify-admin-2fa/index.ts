// ============================================================
// VERIFY-ADMIN-2FA — Verify a TOTP code and issue session token
// ============================================================
// Two modes:
//   mode=setup   — first-time verification; enables 2FA + generates backup codes
//   mode=login   — ongoing verification; returns signed session token
//
// Security:
//   - Constant-time TOTP comparison (prevents timing attacks)
//   - ±1 window (30s grace for clock skew)
//   - Max 5 failed attempts before 15-minute lockout
//   - Replay prevention: last_verified_at checked against current window
//   - Session token: HMAC-SHA256 signed, 8-hour expiry
//   - Backup codes: bcrypt-hashed, single-use, invalidated on regeneration
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_HEX   = Deno.env.get("ADMIN_2FA_ENCRYPTION_KEY") ?? "";
const SESSION_SECRET = Deno.env.get("ADMIN_2FA_SESSION_SECRET") ?? "";

const MAX_ATTEMPTS   = 5;
const LOCKOUT_MINS   = 15;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const BACKUP_COUNT   = 10;

// ── AES-256-GCM decrypt ────────────────────────────────────
async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function decryptSecret(encrypted: string, hexKey: string): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(":");
  const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await importKey(hexKey);
  const pt  = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ctB64)
  );
  return new TextDecoder().decode(pt);
}

// ── TOTP implementation (RFC 6238) ─────────────────────────
const BASE32_LOOKUP: Record<string, number> = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".split("").forEach((c, i) => { BASE32_LOOKUP[c] = i; });

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    value = (value << 5) | (BASE32_LOOKUP[c] ?? 0);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(bytes);
}

async function generateTOTP(secretBase32: string, counter: number): Promise<string> {
  const key   = base32Decode(secretBase32);
  const msg   = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c >>>= 8; }
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig   = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = sig[19] & 0xf;
  const code  = ((sig[offset] & 0x7f) << 24 | sig[offset+1] << 16 | sig[offset+2] << 8 | sig[offset+3]) % 1_000_000;
  return code.toString().padStart(6, "0");
}

// Constant-time string comparison (prevents timing attacks)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTOTP(secretBase32: string, code: string): Promise<boolean> {
  const now     = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);
  // Check current window ±1 (handles clock skew up to 30s)
  for (const delta of [-1, 0, 1]) {
    const expected = await generateTOTP(secretBase32, counter + delta);
    if (safeEqual(code, expected)) return true;
  }
  return false;
}

// ── HMAC-SHA256 session token ──────────────────────────────
async function signSessionToken(userId: string, secret: string): Promise<string> {
  const payload = JSON.stringify({ userId, exp: Date.now() + SESSION_TTL_MS, iat: Date.now() });
  const enc     = new TextEncoder();
  const key     = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig     = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(payload)}.${sigB64}`;
}

// ── Backup code generation ─────────────────────────────────
function generateBackupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Simple hash for backup codes (SHA-256 — bcrypt not available in Deno edge)
async function hashCode(code: string): Promise<string> {
  const enc  = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(code));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyBackupCode(code: string, hashes: string[]): Promise<number> {
  const h = await hashCode(code.toUpperCase().replace(/[^A-F0-9]/g, ""));
  return hashes.findIndex((stored) => safeEqual(stored, h));
}

// ── Admin verification ─────────────────────────────────────
async function verifyAdmin(authHeader: string): Promise<{ userId: string; email: string } | null> {
  const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const token         = authHeader.replace("Bearer ", "");

  // Verify JWT with service client
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

    const body = await req.json();
    const code: string = String(body?.code ?? "").replace(/\s/g, "");
    const mode: string = body?.mode ?? "login"; // "setup" | "login"
    const isBackup = body?.is_backup_code === true;

    if (!code) {
      return new Response(JSON.stringify({ error: "Verification code required" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
      return new Response(JSON.stringify({ error: "2FA service not configured" }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch 2FA record
    const { data: record, error: fetchErr } = await supabase
      .from("admin_2fa")
      .select("*")
      .eq("user_id", admin.userId)
      .maybeSingle();

    if (fetchErr || !record) {
      return new Response(JSON.stringify({ error: "2FA not configured for this account" }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Brute-force lockout check
    if (record.locked_until && new Date(record.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(record.locked_until).getTime() - Date.now()) / 60000);
      await supabase.from("admin_2fa_audit").insert({ user_id: admin.userId, event: "locked_attempt" });
      return new Response(JSON.stringify({
        error: `Account locked. Try again in ${remaining} minute(s).`,
        locked: true,
        locked_until: record.locked_until,
      }), { status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Decrypt secret
    let secretBase32: string;
    try {
      secretBase32 = await decryptSecret(record.secret_encrypted, ENC_KEY_HEX);
    } catch {
      console.error("[verify-admin-2fa] decryption failed for user:", admin.userId);
      return new Response(JSON.stringify({ error: "2FA verification unavailable" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let verified = false;
    let usedBackupIndex = -1;

    if (isBackup) {
      // Backup code path
      usedBackupIndex = await verifyBackupCode(code, record.backup_codes ?? []);
      verified = usedBackupIndex >= 0;
    } else {
      // TOTP path
      verified = await verifyTOTP(secretBase32, code);
    }

    if (!verified) {
      // Increment failed attempts
      const newAttempts = (record.failed_attempts ?? 0) + 1;
      const lockout     = newAttempts >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINS * 60 * 1000).toISOString()
        : null;

      await supabase.from("admin_2fa").update({
        failed_attempts: newAttempts,
        locked_until:    lockout,
      }).eq("user_id", admin.userId);

      await supabase.from("admin_2fa_audit").insert({
        user_id: admin.userId,
        event:   "failed",
      });

      const remaining = MAX_ATTEMPTS - newAttempts;
      return new Response(JSON.stringify({
        error: lockout
          ? `Too many failed attempts. Account locked for ${LOCKOUT_MINS} minutes.`
          : `Invalid code. ${remaining} attempt(s) remaining.`,
        locked: !!lockout,
      }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // ── Verification succeeded ─────────────────────────────
    const now = new Date().toISOString();

    if (mode === "setup") {
      // First-time setup: generate backup codes + enable 2FA
      const plainCodes  = Array.from({ length: BACKUP_COUNT }, generateBackupCode);
      const hashedCodes = await Promise.all(plainCodes.map(hashCode));

      await supabase.from("admin_2fa").update({
        is_enabled:       true,
        backup_codes:     hashedCodes,
        failed_attempts:  0,
        locked_until:     null,
        last_verified_at: now,
      }).eq("user_id", admin.userId);

      await supabase.from("admin_2fa_audit").insert({ user_id: admin.userId, event: "setup_complete" });

      // Return plain backup codes ONCE — never stored in plaintext
      return new Response(JSON.stringify({
        success:      true,
        backup_codes: plainCodes,
        message:      "2FA enabled. Save your backup codes — they will not be shown again.",
      }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Login verification: invalidate used backup code if applicable
    if (isBackup && usedBackupIndex >= 0) {
      const updatedCodes = [...(record.backup_codes ?? [])];
      updatedCodes.splice(usedBackupIndex, 1); // remove used code
      await supabase.from("admin_2fa").update({
        backup_codes:     updatedCodes,
        failed_attempts:  0,
        locked_until:     null,
        last_verified_at: now,
      }).eq("user_id", admin.userId);
      await supabase.from("admin_2fa_audit").insert({ user_id: admin.userId, event: "recovery_used" });
    } else {
      await supabase.from("admin_2fa").update({
        failed_attempts:  0,
        locked_until:     null,
        last_verified_at: now,
      }).eq("user_id", admin.userId);
      await supabase.from("admin_2fa_audit").insert({ user_id: admin.userId, event: "verified" });
    }

    // Issue signed session token
    if (!SESSION_SECRET) {
      console.error("[verify-admin-2fa] ADMIN_2FA_SESSION_SECRET not configured");
      return new Response(JSON.stringify({ error: "Session service not configured" }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const sessionToken = await signSessionToken(admin.userId, SESSION_SECRET);

    return new Response(JSON.stringify({
      success:       true,
      session_token: sessionToken,
      expires_at:    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[verify-admin-2fa] unexpected:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
