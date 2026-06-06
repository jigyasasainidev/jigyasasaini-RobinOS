// ============================================================
// DISABLE-ADMIN-2FA — Disable 2FA for an admin user
// ============================================================
// Requires a valid TOTP code to confirm intent before disabling.
// Clears secret, backup codes, and resets all counters.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_HEX  = Deno.env.get("ADMIN_2FA_ENCRYPTION_KEY") ?? "";

// ── Reuse decrypt + TOTP from verify function ──────────────
async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function decryptSecret(encrypted: string, hexKey: string): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(":");
  const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await importKey(hexKey);
  const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return new TextDecoder().decode(pt);
}

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTOTP(secretBase32: string, code: string): Promise<boolean> {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (safeEqual(code, await generateTOTP(secretBase32, counter + delta))) return true;
  }
  return false;
}

async function verifyAdmin(authHeader: string): Promise<{ userId: string } | null> {
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
  if (!(data as any)?.is_admin) return null;
  return { userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const admin = await verifyAdmin(authHeader);
    if (!admin) return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const { code } = await req.json();
    if (!code) return new Response(JSON.stringify({ error: "Confirmation code required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: record } = await supabase.from("admin_2fa").select("*").eq("user_id", admin.userId).maybeSingle();

    if (!record?.is_enabled) return new Response(JSON.stringify({ error: "2FA is not enabled" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const secret = await decryptSecret(record.secret_encrypted, ENC_KEY_HEX);
    if (!await verifyTOTP(secret, String(code).replace(/\s/g, ""))) {
      return new Response(JSON.stringify({ error: "Invalid confirmation code" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Wipe all 2FA data
    await supabase.from("admin_2fa").delete().eq("user_id", admin.userId);
    await supabase.from("admin_2fa_audit").insert({ user_id: admin.userId, event: "disabled" });

    return new Response(JSON.stringify({ success: true, message: "2FA disabled successfully." }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[disable-admin-2fa]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
