import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";

export interface ScanRecord {
  id: string;
  niche: string;
  topics: { title: string; description: string; platforms: string; heat: number }[];
  created_at: string;
}

export interface ScriptRecord {
  id: string;
  topic: string;
  tone: string;
  length: string;
  output: string;
  created_at: string;
}

export function useHistory() {
  const { user } = useAuth();

  const scansQuery = useQuery({
    queryKey: ["scans", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("scan_history")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as ScanRecord[]) ?? [];
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const scriptsQuery = useQuery({
    queryKey: ["scripts", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("script_history")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as ScriptRecord[]) ?? [];
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  return {
    scans: scansQuery.data ?? [],
    scripts: scriptsQuery.data ?? [],
    loading: scansQuery.isLoading || scriptsQuery.isLoading,
  };
}
