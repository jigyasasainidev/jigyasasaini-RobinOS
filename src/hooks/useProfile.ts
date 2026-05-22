import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeTier, getLimitsForTier } from "@/lib/pricing";

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
        display_name: (user.user_metadata as Record<string, unknown> | undefined)?.display_name as string | undefined ?? user.email ?? null,
        full_name: (user.user_metadata as Record<string, unknown> | undefined)?.display_name as string | undefined ?? user.email ?? null,
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

export function useTierLevel(): TierLevel {
  const { data: profile } = useProfile();
  const raw = profile?.subscription_tier;
  const normalized = normalizeTier(raw);
  if (["agency", "scale_agency", "pro_creator", "creator"].includes(normalized)) return normalized as TierLevel;
  return "free";
}

export function useIsProUser() {
  const tier = useTierLevel();
  return tier === "pro_creator" || tier === "agency" || tier === "scale_agency";
}

export function useIsAgencyUser() {
  const tier = useTierLevel();
  return tier === "agency" || tier === "scale_agency";
}

export function useByokAccess() {
  const { user } = useAuth();
  const tier = useTierLevel();
  const tierFallback = tier === "pro_creator" || tier === "agency" || tier === "scale_agency";

  return useQuery({
    queryKey: ["byok-access", user?.id],
    queryFn: async () => {
      if (!user) return tierFallback;
      const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "scripts" });
      if (error) return tierFallback;
      return Boolean((data as any)?.byok_enabled ?? tierFallback);
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });
}

export function useFreeTrialStatus() {
  const { data: profile } = useProfile();
  const tier = useTierLevel();

  if (tier !== "free") {
    return { expired: false, scansLeft: 999, scriptsLeft: 999, isFree: false };
  }

  const expired = profile?.free_trial_expired ?? false;
  const scansUsed = profile?.free_scans_used ?? 0;
  const scriptsUsed = profile?.free_scripts_used ?? 0;

  const trialStart = profile?.free_trial_started_at ? new Date(profile.free_trial_started_at) : new Date();
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

export function useSubscriptionExpiry() {
  const { data: profile } = useProfile();
  const tier = useTierLevel();

  // Only relevant for paid users
  if (tier === "free" || !profile?.subscription_expires_at) {
    return { expired: false, expiresAt: null, tier };
  }

  const expiresAt = new Date(profile.subscription_expires_at);
  const now = new Date();
  const expired = now >= expiresAt;

  return { expired, expiresAt, tier };
}

export function useScriptLimits() {
  const { data: profile } = useProfile();
  const tier = useTierLevel();
  const limits = getLimitsForTier(profile?.subscription_tier);
  const isProOrAbove = tier === "pro_creator" || tier === "agency" || tier === "scale_agency";
  const isAgencyTier = tier === "agency" || tier === "scale_agency";

  const limit = limits.monthlyCap;
  const used = tier === "free"
    ? (profile?.free_scripts_used ?? 0)
    : (profile?.scripts_used_this_month ?? 0);
  const remaining = Math.max(0, limit - used);
  const limitReached = remaining <= 0;

  return {
    isPro: isProOrAbove,
    isAgency: isAgencyTier,
    tier,
    limit,
    used,
    remaining,
    limitReached,
    displayLimit: isAgencyTier ? "Unlimited (Fair Usage)" : String(limit),
  };
}
