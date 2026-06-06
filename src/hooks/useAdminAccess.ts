import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";
import type { AdminAccessResponse, AdminRole } from "@/types/admin";

export function useAdminAccess() {
  const { user } = useAuth();

  return useQuery<AdminAccessResponse>({
    queryKey: ["admin-access", user?.id],
    queryFn: async () => {
      if (!user) {
        return { role: null, isAdmin: false, isSuperAdmin: false };
      }

      const { data, error } = await db.rpc("get_admin_access");

      if (error) {
        return { role: null, isAdmin: false, isSuperAdmin: false };
      }

      const payload = (data ?? {}) as { role?: AdminRole | null; is_admin?: boolean; allowlisted?: boolean };
      const role = payload.role ?? null;
      const isAdmin = Boolean(payload.is_admin) || role === "super_admin" || role === "admin" || role === "support";

      return {
        role,
        isAdmin,
        isSuperAdmin: role === "super_admin",
        allowlisted: Boolean(payload.allowlisted),
      };
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });
}