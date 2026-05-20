import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";

export type BusinessControls = {
  id: string;
  creator_price: number;
  pro_creator_price: number;
  agency_price: number;
  public_affiliate_recurring_percent: number;
  jvzoo_launch_percent: number;
  launch_promotions_enabled: boolean;
  limited_time_offer_enabled: boolean;
  affiliate_campaign_enabled: boolean;
  minimum_withdrawal_amount: number;
  payout_delay_days: number;
  recurring_duration_months: number;
  seasonal_campaign_name: string | null;
  seasonal_campaign_bonus_percent: number | null;
  exclusive_offer_label: string | null;
  published_at: string | null;
  updated_at: string;
};

export function useBusinessControls() {
  return useQuery({
    queryKey: ["business-controls-live"],
    queryFn: async (): Promise<BusinessControls | null> => {
      const { data, error } = await db.rpc("get_live_business_controls");
      if (error) throw error;
      if (Array.isArray(data)) return (data[0] ?? null) as BusinessControls | null;
      return (data ?? null) as BusinessControls | null;
    },
    staleTime: 30 * 1000,
  });
}
