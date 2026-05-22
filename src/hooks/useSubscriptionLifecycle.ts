// ============================================================
// ROBINOS SUBSCRIPTION LIFECYCLE HOOK
// Single RPC call → all billing/expiry data for the Settings page
// ============================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeMultiTable } from "@/lib/realtime/channelManager";

export interface SubscriptionLifecycle {
  // Resolved plan (expires_at enforced)
  plan: string;
  subscription_active: boolean;
  expires_soon: boolean;

  // Raw subscription data
  subscription_id: string | null;
  billing_cycle: "monthly" | "yearly";
  starts_at: string | null;
  expires_at: string | null;
  status: "active" | "expired" | "cancelled" | "past_due" | "suspended" | "none";
  cancel_at_period_end: boolean;
  granted_by_admin: boolean;
  granted_reason: string | null;
  subscription_source: string;
  amount: number;
  currency: string;

  // Cooldown
  cooldown_active: boolean;
  cooldown_until: string | null;
  cooldown_days_remaining: number;
  last_plan_change_at: string | null;

  // Expiry countdown
  days_until_expiry: number | null;

  // Usage snapshots
  script_usage: { usage_count: number; period_key: string } | null;
  caption_usage: { usage_count: number; period_key: string } | null;
}

const FREE_LIFECYCLE: SubscriptionLifecycle = {
  plan: "free",
  subscription_active: false,
  expires_soon: false,
  subscription_id: null,
  billing_cycle: "monthly",
  starts_at: null,
  expires_at: null,
  status: "none",
  cancel_at_period_end: false,
  granted_by_admin: false,
  granted_reason: null,
  subscription_source: "manual_admin",
  amount: 0,
  currency: "USD",
  cooldown_active: false,
  cooldown_until: null,
  cooldown_days_remaining: 0,
  last_plan_change_at: null,
  days_until_expiry: null,
  script_usage: null,
  caption_usage: null,
};

export function useSubscriptionLifecycle() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Realtime: subscription change → refetch lifecycle
  useEffect(() => {
    if (!user?.id) return;

    const unsub = subscribeMultiTable({
      channelName: `lifecycle-sync-${user.id}`,
      listeners: [
        {
          table: "user_subscriptions",
          event: "*",
          filter: `user_id=eq.${user.id}`,
          callback: () => {
            void queryClient.invalidateQueries({ queryKey: ["subscription-lifecycle", user.id] });
          },
        },
        {
          table: "profiles",
          event: "UPDATE",
          filter: `user_id=eq.${user.id}`,
          callback: () => {
            void queryClient.invalidateQueries({ queryKey: ["subscription-lifecycle", user.id] });
          },
        },
      ],
    });

    return unsub;
  }, [user?.id, queryClient]);

  return useQuery({
    queryKey: ["subscription-lifecycle", user?.id],
    queryFn: async (): Promise<SubscriptionLifecycle> => {
      if (!user?.id) return FREE_LIFECYCLE;

      const { data, error } = await (supabase as any).rpc("get_subscription_lifecycle", {
        p_user_id: user.id,
      });

      if (error || !data) {
        console.warn("[useSubscriptionLifecycle] RPC failed:", error?.message);
        return FREE_LIFECYCLE;
      }

      return data as SubscriptionLifecycle;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: FREE_LIFECYCLE,
  });
}

// ── Convenience selectors ─────────────────────────────────

/** True if plan change is currently blocked by 14-day cooldown */
export function useCooldownActive(): boolean {
  const { data } = useSubscriptionLifecycle();
  return data?.cooldown_active ?? false;
}

/** Days until cooldown expires (0 if not in cooldown) */
export function useCooldownDaysRemaining(): number {
  const { data } = useSubscriptionLifecycle();
  return data?.cooldown_days_remaining ?? 0;
}

/** True if subscription expires within 7 days */
export function useExpiresSoon(): boolean {
  const { data } = useSubscriptionLifecycle();
  return data?.expires_soon ?? false;
}

/** Days until subscription expires (null if no expiry or free plan) */
export function useDaysUntilExpiry(): number | null {
  const { data } = useSubscriptionLifecycle();
  return data?.days_until_expiry ?? null;
}
