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

      const { data, error } = await db.rpc("get_admin_role", {
        user_uuid: user.id,
      });

      if (error) {
        return { role: null, isAdmin: false, isSuperAdmin: false };
      }

      const role = (data as AdminRole | null) ?? null;
      return {
        role,
        isAdmin: role === "super_admin" || role === "admin" || role === "support",
        isSuperAdmin: role === "super_admin",
      };
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });
}