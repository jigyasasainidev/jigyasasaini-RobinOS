import { db } from "@/lib/cloudDb";
import type { AdminAuditAction } from "@/types/admin";

let adminAuditUnavailable = false;

export async function logAdminAction(action: AdminAuditAction, targetId: string, details: Record<string, unknown> = {}) {
  if (adminAuditUnavailable) return;

  const { error } = await db.rpc("admin_write_log", {
    p_action_type: action,
    p_target_id: targetId,
    p_details: details,
  });

  if (error) {
    const normalized = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
    const isMissingAuditRpc =
      (error as { code?: string }).code === "PGRST202" ||
      normalized.includes("admin_write_log") ||
      normalized.includes("could not find the function") ||
      normalized.includes("404");

    if (isMissingAuditRpc) {
      adminAuditUnavailable = true;
      console.warn("Admin audit RPC is unavailable; continuing without blocking admin actions.");
      return;
    }

    throw error;
  }
}