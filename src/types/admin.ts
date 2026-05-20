export type AdminRole = "super_admin" | "admin" | "support";

export type AdminAccessResponse = {
  role: AdminRole | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

export type AdminAuditAction =
  | "admin_login"
  | "admin_logout"
  | "role_change"
  | "subscription_plan_updated"
  | "user_suspended"
  | "user_activated"
  | "withdrawal_status_updated"
  | "platform_settings_updated"
  | "manual_action";