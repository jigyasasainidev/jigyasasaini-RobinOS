// ============================================================
// ROBINOS — Affiliate Promo Assets hook
// Reads affiliate_promo_assets table with realtime updates.
// Used by /jvzooaffiliate page to render dynamic resource cards.
// ============================================================

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { subscribePostgresChanges } from "@/lib/realtime/channelManager";

export interface AffiliatePromoAsset {
  id:            string;
  title:         string;
  description:   string;
  badge:         string | null;
  button_text:   string;
  button_url:    string | null;
  icon_name:     string;
  display_order: number;
  is_enabled:    boolean;
  created_at:    string;
}

export function useAffiliatePromoAssets() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["affiliate-promo-assets-v1"],
    queryFn: async (): Promise<AffiliatePromoAsset[]> => {
      const { data, error } = await db
        .from("affiliate_promo_assets")
        .select("id,title,description,badge,button_text,button_url,icon_name,display_order,is_enabled,created_at")
        .eq("is_enabled", true)
        .order("display_order", { ascending: true });

      if (error) {
        // Table may not exist yet — return empty gracefully
        if (error.code === "PGRST205" || error.message?.toLowerCase().includes("affiliate_promo_assets")) {
          return [];
        }
        throw error;
      }
      return (data ?? []) as AffiliatePromoAsset[];
    },
    staleTime: 30 * 1000,
  });

  // Realtime: invalidate on any table change
  useEffect(() => {
    const unsubscribe = subscribePostgresChanges({
      channelName: "affiliate-promo-assets-live",
      table:       "affiliate_promo_assets",
      event:       "*",
      callback: () => {
        queryClient.invalidateQueries({ queryKey: ["affiliate-promo-assets-v1"] });
      },
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}
