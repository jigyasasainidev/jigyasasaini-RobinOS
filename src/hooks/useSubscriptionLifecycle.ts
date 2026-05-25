// ============================================================
// useSubscriptionLifecycle — full billing/expiry data
// useSubscriptionStatus   — renewal reminder state
// ============================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { subscribeMultiTable } from "@/lib/realtime/channelManager";

// ── Types ──────────────────────────────────────────────────

export type ExpiryState =
  | "active" | "expiring_7d" | "expiring_3d" | "expiring_1d"
  | "grace_period" | "expired" | "none";

export type ReminderUrgency = "none" | "low" | "medium" | "high" | "critical";

export interface SubscriptionLifecycle {
  plan: string;
  subscription_active: boolean;
  expires_soon: boolean;
  expiry_state: ExpiryState;
  in_grace_period: boolean;
  days_remaining: number;
  grace_days_remaining: number;

  subscription_id: string | null;
  billing_cycle: "monthly" | "yearly";
  starts_at: string | null;
  expires_at: string | null;
  grace_period_ends_at: string | null;
  status: string;
  cancel_at_period_end: boolean;
  granted_by_admin: boolean;
  granted_reason: string | null;
  subscription_source: string;
  amount: number;
  currency: string;
  last_payment_at: string | null;
  next_billing_at: string | null;
  auto_renew: boolean;
  provider: string | null;
  canceled_at: string | null;

  cooldown_active: boolean;
  cooldown_until: string | null;
  cooldown_days_remaining: number;
  last_plan_change_at: string | null;
  days_until_expiry: number | null;
  reminder_dismissed_until: string | null;

  script_usage: { usage_count: number; period_key: string } | null;
  caption_usage: { usage_count: number; period_key: string } | null;
}

export interface SubscriptionStatus {
  plan: string;
  subscription_active: boolean;
  expiry_state: ExpiryState;
  in_grace_period: boolean;
  days_remaining: number;
  grace_days_remaining: number;
  billing_cycle: "monthly" | "yearly";
  expires_at: string | null;
  grace_period_ends_at: string | null;
  next_billing_at: string | null;
  last_payment_at: string | null;
  auto_renew: boolean;
  provider: string | null;
  amount: number;
  currency: string;
  status: string;
  granted_by_admin: boolean;
  show_reminder: boolean;
  reminder_urgency: ReminderUrgency;
  reminder_dismissed_until: string | null;
  checked_at: string;
}

const FREE_LIFECYCLE: SubscriptionLifecycle = {
  plan: "free", subscription_active: false, expires_soon: false,
  expiry_state: "none", in_grace_period: false, days_remaining: 0,
  grace_days_remaining: 0, subscription_id: null, billing_cycle: "monthly",
  starts_at: null, expires_at: null, grace_period_ends_at: null,
  status: "none", cancel_at_period_end: false, granted_by_admin: false,
  granted_reason: null, subscription_source: "manual_admin", amount: 0,
  currency: "USD", last_payment_at: null, next_billing_at: null,
  auto_renew: true, provider: null, canceled_at: null,
  cooldown_active: false, cooldown_until: null, cooldown_days_remaining: 0,
  last_plan_change_at: null, days_until_expiry: null,
  reminder_dismissed_until: null, script_usage: null, caption_usage: null,
};

const FREE_STATUS: SubscriptionStatus = {
  plan: "free", subscription_active: false, expiry_state: "none",
  in_grace_period: false, days_remaining: 0, grace_days_remaining: 0,
  billing_cycle: "monthly", expires_at: null, grace_period_ends_at: null,
  next_billing_at: null, last_payment_at: null, auto_renew: true,
  provider: null, amount: 0, currency: "USD", status: "none",
  granted_by_admin: false, show_reminder: false, reminder_urgency: "none",
  reminder_dismissed_until: null, checked_at: new Date().toISOString(),
};

// ── Shared realtime invalidation ───────────────────────────
function useSubRealtime(userId: string | undefined, keys: string[][]) {
  const queryClient = useQueryClient();
  // Stable ref for keys to avoid re-subscribing on every render
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeMultiTable({
      channelName: `lifecycle-sync-${userId}`,
      listeners: [
        {
          table: "user_subscriptions", event: "*",
          filter: `user_id=eq.${userId}`,
          callback: () => keysRef.current.forEach(k => void queryClient.invalidateQueries({ queryKey: k })),
        },
        {
          table: "profiles", event: "UPDATE",
          filter: `user_id=eq.${userId}`,
          callback: () => keysRef.current.forEach(k => void queryClient.invalidateQueries({ queryKey: k })),
        },
      ],
    });
    return unsub;
  // Only re-subscribe when userId changes — not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient]);
}

// ── useSubscriptionLifecycle — Settings page data ──────────
export function useSubscriptionLifecycle() {
  const { user } = useAuth();
  useSubRealtime(user?.id, [
    ["subscription-lifecycle", user?.id],
    ["subscription-status", user?.id],
  ]);

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

// ── useSubscriptionStatus — renewal reminder data ──────────
// Lighter call, used by the reminder banner/popup.
// Stale time is shorter so reminder state stays fresh.
export function useSubscriptionStatus() {
  const { user } = useAuth();
  useSubRealtime(user?.id, [["subscription-status", user?.id]]);

  return useQuery({
    queryKey: ["subscription-status", user?.id],
    queryFn: async (): Promise<SubscriptionStatus> => {
      if (!user?.id) return FREE_STATUS;
      const { data, error } = await (supabase as any).rpc("get_subscription_status", {
        p_user_id: user.id,
      });
      if (error || !data) return FREE_STATUS;
      return data as SubscriptionStatus;
    },
    enabled: !!user,
    staleTime: 60 * 1000,   // 1 min — reminder state doesn't need to be instant
    gcTime: 5 * 60 * 1000,
    placeholderData: FREE_STATUS,
  });
}

// ── useDismissExpiryPopup — 24h snooze ─────────────────────
export function useDismissExpiryPopup() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useCallback(async () => {
    if (!user?.id) return;
    await (supabase as any).rpc("dismiss_expiry_popup", { p_user_id: user.id });
    // Invalidate so reminder disappears immediately
    void queryClient.invalidateQueries({ queryKey: ["subscription-status", user.id] });
    void queryClient.invalidateQueries({ queryKey: ["subscription-lifecycle", user.id] });
  }, [user?.id, queryClient]);
}

export function useCooldownActive(): boolean {
  const { data } = useSubscriptionLifecycle();
  return data?.cooldown_active ?? false;
}

export function useCooldownDaysRemaining(): number {
  const { data } = useSubscriptionLifecycle();
  return data?.cooldown_days_remaining ?? 0;
}

export function useExpiresSoon(): boolean {
  const { data } = useSubscriptionLifecycle();
  return data?.expires_soon ?? false;
}

export function useDaysUntilExpiry(): number | null {
  const { data } = useSubscriptionLifecycle();
  return data?.days_until_expiry ?? null;
}

// ── useInvalidateSubscriptionQueries ──────────────────────
// Call after payment success, plan switch, or webhook sync.
// Invalidates ALL subscription-related caches simultaneously.
export function useInvalidateSubscriptionQueries() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useCallback(() => {
    if (!user?.id) return;
    void queryClient.invalidateQueries({ queryKey: ["subscription-status",    user.id] });
    void queryClient.invalidateQueries({ queryKey: ["subscription-lifecycle", user.id] });
    void queryClient.invalidateQueries({ queryKey: ["entitlements",           user.id] });
    void queryClient.invalidateQueries({ queryKey: ["profile",                user.id] });
    void queryClient.invalidateQueries({ queryKey: ["feature-usage",          user.id] });
  }, [user?.id, queryClient]);
}
