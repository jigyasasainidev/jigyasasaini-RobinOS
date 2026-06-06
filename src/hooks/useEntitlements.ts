// ============================================================
// ROBINOS CENTRALIZED ENTITLEMENT HOOK
// useEntitlements() — SINGLE source of truth for all feature access
// ============================================================
// Rules:
//   1. Frontend NEVER decides access — this hook is display-only
//   2. Backend is authoritative — get_user_entitlements RPC
//   3. Edge functions enforce — this hook drives UI only
//   4. ZERO scattered plan === 'pro_creator' checks anywhere
//   5. useTierLevel() DELEGATES here — not to profile cache
//   6. Split-brain is structurally impossible because every
//      component reads the same cached query key.
// ============================================================

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeMultiTable } from "@/lib/realtime/channelManager";
import type { FeatureKey } from "@/lib/pricing";

// ── Types ──────────────────────────────────────────────────

export interface FeatureEntitlement {
  enabled: boolean;
  limit: number;       // -1 = unlimited, 0 = disabled, >0 = capped
  period: string;      // day | 24h | lifetime | fair_usage
  unlimited: boolean;
  fair_usage: boolean;
  metadata?: Record<string, unknown>;
}

export interface UserEntitlements {
  plan: string;
  subscription_active: boolean;
  features: Partial<Record<FeatureKey, FeatureEntitlement>>;
}

// ── Empty fallback (shown while loading) ─────────────────────

const FREE_FALLBACK: UserEntitlements = {
  plan: "free",
  subscription_active: false,
  features: {
    script_generation:  { enabled: true,  limit: 2,  period: "24h",      unlimited: false, fair_usage: false },
    caption_generation: { enabled: true,  limit: 2,  period: "day",      unlimited: false, fair_usage: false },
    trend_scan:         { enabled: true,  limit: 1,  period: "lifetime", unlimited: false, fair_usage: false },
    hashtag_scan:       { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    tts_generation:     { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    video_generation:   { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    byok_access:        { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    analytics_access:   { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    watermark_removal:  { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    automation_tools:   { enabled: false, limit: 0,  period: "day",      unlimited: false, fair_usage: false },
    export_access:      { enabled: true,  limit: 3,  period: "day",      unlimited: false, fair_usage: false },
    team_workspaces:    { enabled: true,  limit: 1,  period: "lifetime", unlimited: false, fair_usage: false },
  },
};

// ── Core hook ─────────────────────────────────────────────────

export function useEntitlements() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Subscribe to profile changes for realtime plan propagation.
  // When admin upgrades/downgrades a user, profiles.subscription_tier
  // is updated → realtime event fires → entitlements query is invalidated
  // → hook refetches → entire dashboard reflects new plan instantly.
  useEffect(() => {
    if (!user?.id) return;

    // Single channel, all listeners registered before .subscribe()
    // Using subscribeMultiTable ensures correct Supabase lifecycle order.
    const unsub = subscribeMultiTable({
      channelName: `entitlements-sync-${user.id}`,
      listeners: [
        {
          table: "profiles",
          event: "UPDATE",
          filter: `user_id=eq.${user.id}`,
          callback: () => {
            void queryClient.invalidateQueries({ queryKey: ["entitlements", user.id] });
            void queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
          },
        },
        {
          table: "user_subscriptions",
          event: "*",
          filter: `user_id=eq.${user.id}`,
          callback: () => {
            void queryClient.invalidateQueries({ queryKey: ["entitlements", user.id] });
          },
        },
      ],
    });

    return unsub;
  }, [user?.id, queryClient]);

  return useQuery({
    queryKey: ["entitlements", user?.id],
    queryFn: async (): Promise<UserEntitlements> => {
      if (!user?.id) return FREE_FALLBACK;

      const { data, error } = await (supabase as any).rpc("get_user_entitlements", {
        p_user_id: user.id,
      });

      if (error || !data) {
        console.warn("[useEntitlements] RPC failed, falling back to free:", error?.message);
        return FREE_FALLBACK;
      }

      return data as UserEntitlements;
    },
    enabled: !!user,
    staleTime: 30 * 1000,        // 30s — fresh enough for interactive use
    gcTime: 5 * 60 * 1000,       // 5 min cache
    placeholderData: FREE_FALLBACK,
  });
}

// ── Derived selectors (no re-fetch, computed from the single query) ──

/** Returns true while entitlements are loading for the first time */
export function useEntitlementsLoading() {
  const { isLoading } = useEntitlements();
  return isLoading;
}

/** Active plan key: 'free' | 'creator' | 'pro_creator' | 'agency' */
export function usePlanKey(): string {
  const { data } = useEntitlements();
  return data?.plan ?? "free";
}

/** Raw feature entitlement object — use for limit/period values */
export function useFeatureEntitlement(feature: FeatureKey): FeatureEntitlement {
  const { data } = useEntitlements();
  return (
    data?.features[feature] ??
    FREE_FALLBACK.features[feature] ?? { enabled: false, limit: 0, period: "day", unlimited: false, fair_usage: false }
  );
}

/** Boolean: is this feature enabled on the user's plan? */
export function useFeatureEnabled(feature: FeatureKey): boolean {
  return useFeatureEntitlement(feature).enabled;
}

/** Daily/period limit for a feature (-1 = unlimited, 0 = disabled) */
export function useFeatureLimit(feature: FeatureKey): number {
  return useFeatureEntitlement(feature).limit;
}

// ── Named convenience selectors ───────────────────────────────

/** Voice engine: requires tts_generation enabled */
export function useIsVoiceEnabled(): boolean {
  return useFeatureEnabled("tts_generation");
}

/** Video engine: requires video_generation enabled */
export function useIsVideoEnabled(): boolean {
  return useFeatureEnabled("video_generation");
}

/** BYOK: bring your own API key access */
export function useIsByokEnabled(): boolean {
  return useFeatureEnabled("byok_access");
}

/** Long-form scripts: pro_creator+ */
export function useIsLongFormEnabled(): boolean {
  const plan = usePlanKey();
  return plan === "pro_creator" || plan === "agency" || plan === "scale_agency";
}

/** Advanced analytics access */
export function useIsAnalyticsEnabled(): boolean {
  return useFeatureEnabled("analytics_access");
}

/** Team workspaces */
export function useIsTeamWorkspacesEnabled(): boolean {
  const ent = useFeatureEntitlement("team_workspaces");
  return ent.enabled && (ent.limit === -1 || ent.limit > 1);
}

/** Pro Creator or higher */
export function useIsProOrAbove(): boolean {
  const plan = usePlanKey();
  return plan === "pro_creator" || plan === "agency" || plan === "scale_agency";
}

/** Agency plan */
export function useIsAgency(): boolean {
  const plan = usePlanKey();
  return plan === "agency" || plan === "scale_agency";
}

/** All platforms unlocked (pro_creator+) */
export function useAllPlatformsUnlocked(): boolean {
  return useIsProOrAbove();
}

/** Script generation daily limit */
export function useScriptDailyLimit(): number {
  return useFeatureLimit("script_generation");
}

/** Caption generation daily limit */
export function useCaptionDailyLimit(): number {
  return useFeatureLimit("caption_generation");
}

/** Trend scan daily limit */
export function useTrendScanLimit(): number {
  const ent = useFeatureEntitlement("trend_scan");
  if (ent.fair_usage || ent.unlimited) return -1;
  return ent.limit;
}

/** Hashtag scan daily limit */
export function useHashtagScanLimit(): number {
  const ent = useFeatureEntitlement("hashtag_scan");
  if (ent.fair_usage || ent.unlimited) return -1;
  return ent.limit;
}

// ── Additional selectors used across the app ─────────────────

/** True if subscription is currently active (non-expired) */
export function useSubscriptionActive(): boolean {
  const { data } = useEntitlements();
  return data?.subscription_active ?? false;
}

/** True if user is on free plan */
export function useIsFree(): boolean {
  return usePlanKey() === "free";
}

/** Script generation limit as a display string */
export function useScriptLimitDisplay(): string {
  const plan = usePlanKey();
  const ent = useFeatureEntitlement("script_generation");
  if (ent.fair_usage) return "Unlimited (fair usage)";
  if (ent.unlimited) return "Unlimited";
  if (ent.limit <= 0) return "0";
  return `${ent.limit}/day`;
}

/** Max trend scan topics to show in UI (not backend enforcement) */
export function useMaxTrendTopics(): number {
  const plan = usePlanKey();
  if (plan === "agency" || plan === "scale_agency") return 999;
  if (plan === "pro_creator") return 5;
  if (plan === "creator") return 3;
  return 1; // free
}

/** Script lengths available for the Studio page */
export function useAvailableScriptLengths(
  allLengths: string[],
  freeLengths: string[],
  creatorLengths: string[]
): string[] {
  const plan = usePlanKey();
  const isFree = plan === "free";
  const isCreator = plan === "creator";
  if (isFree) return freeLengths;
  if (isCreator) return creatorLengths;
  return allLengths;
}

// ── useFeatureUsage — live usage status for a single feature ──
// Calls get_usage_status_v2 RPC. Used by pages to show counters.
// Refreshes after every generation via queryClient.invalidateQueries.

export interface FeatureUsageStatus {
  allowed:    boolean;
  used:       number;
  quota:      number | null;
  remaining:  number;
  near_limit: boolean;
  fair_usage: boolean;
  unlimited:  boolean;
  reset_at:   string | null;
  message:    string;
}

const USAGE_FALLBACK: FeatureUsageStatus = {
  allowed: true, used: 0, quota: null, remaining: 999,
  near_limit: false, fair_usage: false, unlimited: false,
  reset_at: null, message: "",
};

export function useFeatureUsage(featureKey: string): {
  data: FeatureUsageStatus;
  isLoading: boolean;
  refetch: () => void;
} {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["feature-usage", user?.id, featureKey],
    queryFn: async (): Promise<FeatureUsageStatus> => {
      if (!user?.id) return USAGE_FALLBACK;
      const { data, error } = await (supabase as any).rpc("get_usage_status_v2", {
        p_user_id:    user.id,
        p_feature_key: featureKey,
      });
      if (error || !data) return USAGE_FALLBACK;
      return {
        allowed:    Boolean(data.allowed),
        used:       Number(data.used    ?? 0),
        quota:      data.quota != null ? Number(data.quota) : null,
        remaining:  Number(data.remaining ?? 0),
        near_limit: Boolean(data.near_limit),
        fair_usage: Boolean(data.fair_usage),
        unlimited:  Boolean(data.unlimited),
        reset_at:   data.reset_at ?? null,
        message:    String(data.message ?? ""),
      };
    },
    enabled: !!user,
    staleTime: 15 * 1000,   // 15s — refresh frequently after generation
    gcTime:    2 * 60 * 1000,
    placeholderData: USAGE_FALLBACK,
  });

  return {
    data:      query.data ?? USAGE_FALLBACK,
    isLoading: query.isLoading,
    refetch:   query.refetch,
  };
}
