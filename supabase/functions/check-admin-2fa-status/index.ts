// ============================================================
// CHECK-ADMIN-2FA-STATUS — Read-only 2FA status check
// ============================================================
// Returns whether 2FA is configured and enabled for the caller.
// NO side effects — does not create or modify any records.
// Used by AdminRouteGuard to decide which screen to show.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function verifyAdmin(authHeader: string): Promise<{ userId: string } | null> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !user) return null;
  const { data } = await supabase.rpc("get_admin_access");
  if (!(data as any)?.is_admin) return null;
  return { userId: user.id };
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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: record, error: dbErr } = await supabase
      .from("admin_2fa")
      .select("is_enabled, locked_until, failed_attempts")
      .eq("user_id", admin.userId)
      .maybeSingle();

    if (dbErr) {
      console.error("[check-admin-2fa-status] db error:", dbErr.message, dbErr.code);
      // PGRST205 = table doesn't exist (migration not run yet)
      // Treat as not_configured so setup screen shows
      if (dbErr.code === "PGRST205" || dbErr.message?.includes("admin_2fa") || dbErr.message?.includes("does not exist")) {
        return new Response(JSON.stringify({ status: "not_configured" }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Status check failed", detail: dbErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // No record at all → 2FA never set up
    if (!record) {
      return new Response(JSON.stringify({ status: "not_configured" }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Record exists but not yet enabled (setup started, not verified)
    if (!record.is_enabled) {
      return new Response(JSON.stringify({ status: "setup_pending" }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fully enabled
    return new Response(JSON.stringify({
      status:          "enabled",
      locked_until:    record.locked_until ?? null,
      failed_attempts: record.failed_attempts ?? 0,
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[check-admin-2fa-status] unexpected:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
