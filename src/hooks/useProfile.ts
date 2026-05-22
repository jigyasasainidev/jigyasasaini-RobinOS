// ============================================================
// useProfile — profile data (API keys, display name, usage fields)
// ============================================================
// IMPORTANT: Plan/tier data is NOT authoritative here.
// useProfile() returns the profiles table row — useful for
// API keys, display info, and free-trial usage fields.
//
// For plan access, feature gates, and quota decisions:
//   → use useEntitlements() / usePlanKey() from useEntitlements.ts
//   → those delegate to get_user_entitlements RPC (backend auth)
//
// useTierLevel() remains for legacy compatibility but now
// delegates to usePlanKey() so there is exactly ONE source.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";
import { getLimitsForTier } from "@/lib/pricing";
import {
  useEntitlements,
  usePlanKey,
  useIsProOrAbove,
  useIsAgency,
  useIsByokEnabled,
  useIsFree,
} from "@/hooks/useEntitlements";

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  subscription_tier: string | null;
  referral_code: string | null;
  affiliate_balance: number;
  total_earnings: number;
  upi_id: string | null;
  openai_api_key: string | null;
  elevenlabs_api_key: string | null;
  scripts_used_this_month: number;
  scripts_reset_at: string;
  created_at: string;
  updated_at: string;
  free_scans_used: number;
  free_scripts_used: number;
  free_trial_started_at: string;
  free_trial_expired: boolean;
  subscription_expires_at: string | null;
  is_suspended: boolean;
}

export type TierLevel = "free" | "creator" | "pro_creator" | "agency" | "scale_agency";

export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async (): Promise<Profile | null> => {
      if (!user) return null;
      const { data, error } = await db
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (data) return data as unknown as Profile;

      const fallbackProfile = {
        user_id: user.id,
        email: user.email ?? null,
        display_name:
          (user.user_metadata as Record<string, unknown> | undefined)?.display_name as string | undefined ??
          user.email ??
          null,
        full_name:
          (user.user_metadata as Record<string, unknown> | undefined)?.display_name as string | undefined ??
          user.email ??
          null,
      };

      const { data: created, error: createError } = await db
        .from("profiles")
        .insert(fallbackProfile as any)
        .select("*")
        .single();

      if (createError) {
        const duplicateCode = (createError as { code?: string }).code;
        if (duplicateCode === "23505") {
          const { data: retried, error: retryError } = await db
            .from("profiles")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();
          if (retryError) throw retryError;
          return (retried ?? null) as Profile | null;
        }
        throw createError;
      }
      return created as unknown as Profile;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });
}

// ── Plan selectors — all delegate to useEntitlements() ───────
// This is the fix for the split-brain issue.
// Previously useTierLevel() read profiles.subscription_tier,
// which could be stale or differ from the entitlement resolver.
// Now everything reads the same backend-resolved entitlement.

/**
 * @deprecated Prefer usePlanKey() from useEntitlements.ts.
 * Kept for compatibility with pages not yet migrated.
 * Delegates to usePlanKey() — same source, no split-brain.
 */
export function useTierLevel(): TierLevel {
  const plan = usePlanKey();
  // Validate it's a known tier; unknown → free
  if (["agency", "scale_agency", "pro_creator", "creator"].includes(plan)) {
    return plan as TierLevel;
  }
  return "free";
}

/**
 * @deprecated Use useIsProOrAbove() from useEntitlements.ts
 */
export function useIsProUser(): boolean {
  return useIsProOrAbove();
}

/**
 * @deprecated Use useIsAgency() from useEntitlements.ts
 */
export function useIsAgencyUser(): boolean {
  return useIsAgency();
}

/**
 * @deprecated Use useIsByokEnabled() from useEntitlements.ts
 * Kept as a query wrapper for components that need the old shape.
 */
export function useByokAccess() {
  const isByok = useIsByokEnabled();
  // Return query-like shape for backward compatibility
  return { data: isByok, isLoading: false };
}

/**
 * Free trial status — reads from profile table for free users.
 * For feature gating, prefer useIsFree() from useEntitlements.ts.
 */
export function useFreeTrialStatus() {
  const { data: profile } = useProfile();
  const isFree = useIsFree();

  if (!isFree) {
    return { expired: false, scansLeft: 999, scriptsLeft: 999, isFree: false };
  }

  const expired = profile?.free_trial_expired ?? false;
  const scansUsed = profile?.free_scans_used ?? 0;
  const scriptsUsed = profile?.free_scripts_used ?? 0;

  const trialStart = profile?.free_trial_started_at
    ? new Date(profile.free_trial_started_at)
    : new Date();
  const now = new Date();
  const hoursElapsed = (now.getTime() - trialStart.getTime()) / (1000 * 60 * 60);
  const timeExpired = hoursElapsed >= 24;

  return {
    expired: expired || timeExpired || (scansUsed >= 1 && scriptsUsed >= 2),
    scansLeft: Math.max(0, 1 - scansUsed),
    scriptsLeft: Math.max(0, 2 - scriptsUsed),
    isFree: true,
  };
}

/**
 * Subscription expiry — now delegates to entitlements RPC result.
 * The entitlement resolver checks expires_at server-side.
 */
export function useSubscriptionExpiry() {
  const { data: entitlements } = useEntitlements();
  const plan = usePlanKey();
  const expiresAtStr = (entitlements as any)?.expires_at as string | null | undefined;
  const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;
  const expired = expiresAt ? new Date() >= expiresAt : false;
  return { expired, expiresAt, tier: plan };
}

/**
 * @deprecated Script limits from profile table.
 * The new quota system uses get_usage_status_v2 RPC.
 * This remains for legacy display in StudioPage.
 */
export function useScriptLimits() {
  const { data: profile } = useProfile();
  const plan = usePlanKey();
  const isProOrAbove = useIsProOrAbove();
  const isAgencyTier = useIsAgency();
  const limits = getLimitsForTier(plan);

  const limit = limits.monthlyCap;
  const used = plan === "free"
    ? (profile?.free_scripts_used ?? 0)
    : (profile?.scripts_used_this_month ?? 0);
  const remaining = Math.max(0, limit - used);
  const limitReached = remaining <= 0;

  return {
    isPro: isProOrAbove,
    isAgency: isAgencyTier,
    tier: plan,
    limit,
    used,
    remaining,
    limitReached,
    displayLimit: isAgencyTier ? "Unlimited (Fair Usage)" : String(limit),
  };
}
