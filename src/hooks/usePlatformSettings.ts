import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { subscribePostgresChanges } from "@/lib/realtime/channelManager";

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
  creator_os_page_enabled: boolean;
  creator_os_demo_video_url: string | null;
  updated_at: string;
};

export function usePlatformSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["platform-settings-live-v1"],
    queryFn: async (): Promise<PlatformSettingsLive | null> => {
      const { data, error } = await db
        .from("platform_settings")
        .select(
          "creator_price,pro_price,agency_price,free_scripts_limit,free_scans_limit,affiliate_commission_percent,minimum_withdrawal,payout_delay_days,maintenance_mode,announcement_banner,creator_os_page_enabled,creator_os_demo_video_url,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        const isMissingTable =
          error.code === "PGRST205" ||
          error.message?.toLowerCase().includes("platform_settings") ||
          error.message?.toLowerCase().includes("schema cache");

        if (isMissingTable) return null;
        throw error;
      }
      return (data ?? null) as PlatformSettingsLive | null;
    },
    staleTime: 15 * 1000,
  });

  // Stable, deterministic realtime subscription via centralized manager
  useEffect(() => {
    const unsubscribe = subscribePostgresChanges({
      channelName: "platform-settings-live-global",
      table: "platform_settings",
      event: "*",
      callback: () => {
        queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      },
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}
