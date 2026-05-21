import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type DashboardRow = {
  profile_id: string;
  user_id: string;
  referral_code: string;
  referral_link: string | null;
  payout_method: "paypal" | "usdt_trc20" | null;
  payout_details: string | null;
  payout_verified: boolean;
  payout_updated_at: string | null;
  total_referrals: number;
  converted_referrals: number;
  referral_clicks: number;
  conversion_count: number;
  total_earned: number;
  pending_earnings: number;
  paid_out: number;
  available_balance: number;
  locked_balance: number;
};

type WithdrawalRow = {
  id: string;
  user_id: string;
  amount: number;
  fee_amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  payout_method: "paypal" | "usdt_trc20";
  payout_details: string;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
};

export function useReferralData() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery({
    queryKey: ["affiliate-dashboard", user?.id],
    queryFn: async (): Promise<DashboardRow | null> => {
      const { data: profileData, error: profileErr } = await db.rpc("ensure_affiliate_profile");
      if (profileErr) throw profileErr;
      if (!profileData?.user_id) return null;

      const { data, error } = await db.rpc("get_affiliate_dashboard");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as DashboardRow | null;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const withdrawalsQuery = useQuery({
    queryKey: ["withdrawals", user?.id],
    queryFn: async (): Promise<WithdrawalRow[]> => {
      const { data, error } = await db
        .from("withdrawal_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WithdrawalRow[];
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const settingsQuery = useQuery({
    queryKey: ["affiliate-settings", user?.id],
    queryFn: async (): Promise<{ minimum_withdrawal: number } | null> => {
      const { data, error } = await db
        .from("platform_settings")
        .select("minimum_withdrawal,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { minimum_withdrawal: number } | null;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!user?.id) return;

    const refreshAffiliateData = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["affiliate-dashboard", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["withdrawals", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["affiliate-settings", user.id] }),
      ]);
    };

    const channel = supabase
      .channel(`affiliate-dashboard-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "affiliate_profiles", filter: `user_id=eq.${user.id}` },
        refreshAffiliateData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "affiliate_commissions", filter: `affiliate_user_id=eq.${user.id}` },
        refreshAffiliateData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawal_requests", filter: `user_id=eq.${user.id}` },
        refreshAffiliateData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_subscriptions", filter: `user_id=eq.${user.id}` },
        refreshAffiliateData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        refreshAffiliateData,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  return {
    dashboard: dashboardQuery.data,
    withdrawals: withdrawalsQuery.data ?? [],
    minimumWithdrawal: Number(settingsQuery.data?.minimum_withdrawal ?? 25),
    loading: dashboardQuery.isLoading || withdrawalsQuery.isLoading,
    isRefetching: dashboardQuery.isRefetching || withdrawalsQuery.isRefetching || settingsQuery.isRefetching,
  };
}
