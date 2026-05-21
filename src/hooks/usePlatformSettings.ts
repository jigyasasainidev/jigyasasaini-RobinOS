import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { supabase } from "@/integrations/supabase/client";

export type PlatformSettingsLive = {
  creator_price: number;
  pro_price: number;
  agency_price: number;
  free_scripts_limit: number;
  free_scans_limit: number;
  affiliate_commission_percent: number;
  minimum_withdrawal: number;
  payout_delay_days: number;
  maintenance_mode: boolean;
  announcement_banner: string | null;
  updated_at: string;
};

export function usePlatformSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["platform-settings-live-v1"],
    queryFn: async (): Promise<PlatformSettingsLive | null> => {
      const { data, error } = await db.rpc("get_public_platform_settings");
      if (error) {
        const isMissingRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          error.message?.toLowerCase().includes("get_public_platform_settings") ||
          error.message?.toLowerCase().includes("not found");

        if (!isMissingRpc) throw error;

        const { data: fallbackData, error: fallbackError } = await db
          .from("platform_settings")
          .select(
            "creator_price,pro_price,agency_price,free_scripts_limit,free_scans_limit,affiliate_commission_percent,minimum_withdrawal,payout_delay_days,maintenance_mode,announcement_banner,updated_at",
          )
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackError) throw fallbackError;
        return (fallbackData ?? null) as PlatformSettingsLive | null;
      }
      if (Array.isArray(data)) return (data[0] ?? null) as PlatformSettingsLive | null;
      return (data ?? null) as PlatformSettingsLive | null;
    },
    staleTime: 15 * 1000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("platform-settings-live-global")
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_settings" }, () => {
        queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
