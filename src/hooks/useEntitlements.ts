// ============================================================
// ROBINOS CENTRALIZED ENTITLEMENT HOOK
// useEntitlements() — single source of truth for all feature access
// ============================================================
// Rules:
//   1. Frontend NEVER decides access — this hook displays only
//   2. Backend is authoritative — values come from get_user_entitlements RPC
//   3. Edge functions enforce — this hook is for UI display only
//   4. No scattered plan === 'pro_creator' checks anywhere
//   5. Every feature check goes through this hook
//
// Usage:
//   const { plan, isVoiceEnabled, isByokEnabled, scriptLimit } = useEntitlements();
//
// Admin upgrade propagation:
//   When admin changes a user's plan, the profiles table is updated.
//   Supabase realtime broadcasts the change, which invalidates the
//   ["entitlements", userId] query key, causing an automatic refetch
//   so the user's dashboard reflects the new plan instantly.
// ============================================================

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
