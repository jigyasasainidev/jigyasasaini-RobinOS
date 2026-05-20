import { useAdminAccess } from "@/hooks/useAdminAccess";

export function useAdminRole() {
  const query = useAdminAccess();

  return {
    ...query,
    data: query.data?.isAdmin ?? false,
  };
}
