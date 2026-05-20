import { db } from "@/lib/cloudDb";
import type { AdminAuditAction } from "@/types/admin";

export async function logAdminAction(action: AdminAuditAction, targetId: string, details: Record<string, unknown> = {}) {
  const { error } = await db.rpc("admin_write_log", {
    p_action_type: action,
    p_target_id: targetId,
    p_details: details,
  });

  if (error) {
    throw error;
  }
}