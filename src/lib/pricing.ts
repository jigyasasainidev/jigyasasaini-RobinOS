// ============================================================
// ROBINOS PLAN ENTITLEMENTS — FRONTEND MIRROR
// These MUST match the backend plan_entitlements table.
// The backend is the SOURCE OF TRUTH.
// Frontend displays only — NEVER enforces.
// ============================================================

type PricingControls = {
  creator_price?: number;
  pro_price?: number;
  pro_creator_price?: number;
  agency_price?: number;
};

export type Currency = "USD";

export interface PlanFeature {
  text: string;
  locked?: boolean;
}

export interface PlanConfig {
  name: string;
  tier: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  popular?: boolean;
  isAgency?: boolean;
  badge?: string;
  dailyScans: number;
  dailyScripts: number;
  dailyCaptions: number;
  monthlyScriptsCap: number;
}

// ============================================================
// BACKEND-ALIGNED ENTITLEMENT MAP
// Mirrors the plan_entitlements table seed data.
// Used by frontend for display purposes only.
// ============================================================
export interface EntitlementConfig {
  limit: number;       // -1 = unlimited, 0 = disabled, >0 = capped
  enabled: boolean;
  period: string;      // day, 24h, lifetime, fair_usage
}

export type FeatureKey =
  | "script_generation"
  | "caption_generation"
  | "trend_scan"
  | "hashtag_scan"
  | "tts_generation"
  | "video_generation"
  | "byok_access"
  | "analytics_access"
  | "watermark_removal"
  | "automation_tools"
  | "export_access"
  | "team_workspaces";

export const PLAN_ENTITLEMENTS: Record<string, Record<FeatureKey, EntitlementConfig>> = {
  free: {
    script_generation: { limit: 100, enabled: true, period: "day" },
    caption_generation: { limit: 100, enabled: true, period: "day" },
    trend_scan: { limit: 1, enabled: true, period: "lifetime" },
    hashtag_scan: { limit: 3, enabled: true, period: "day" },
    tts_generation: { limit: 100, enabled: true, period: "day" },
    video_generation: { limit: 100, enabled: true, period: "day" },
    byok_access: { limit: -1, enabled: true, period: "day" },
    analytics_access: { limit: 0, enabled: false, period: "day" },
    watermark_removal: { limit: 0, enabled: false, period: "day" },
    automation_tools: { limit: 0, enabled: false, period: "day" },
    export_access: { limit: 3, enabled: true, period: "day" },
    team_workspaces: { limit: 1, enabled: true, period: "lifetime" },
  },
  creator: {
    script_generation: { limit: 20, enabled: true, period: "day" },
    caption_generation: { limit: 20, enabled: true, period: "day" },
    trend_scan: { limit: 10, enabled: true, period: "day" },
    hashtag_scan: { limit: 20, enabled: true, period: "day" },
    tts_generation: { limit: 0, enabled: false, period: "day" },
    video_generation: { limit: 0, enabled: false, period: "day" },
    byok_access: { limit: 0, enabled: false, period: "day" },
    analytics_access: { limit: 5, enabled: true, period: "day" },
    watermark_removal: { limit: 0, enabled: false, period: "day" },
    automation_tools: { limit: 0, enabled: false, period: "day" },
    export_access: { limit: 50, enabled: true, period: "day" },
    team_workspaces: { limit: 1, enabled: true, period: "lifetime" },
  },
  pro_creator: {
    script_generation: { limit: 100, enabled: true, period: "day" },
    caption_generation: { limit: 100, enabled: true, period: "day" },
    trend_scan: { limit: 100, enabled: true, period: "day" },
    hashtag_scan: { limit: 100, enabled: true, period: "day" },
    tts_generation: { limit: 200, enabled: true, period: "day" },
    video_generation: { limit: 50, enabled: true, period: "day" },
    byok_access: { limit: -1, enabled: true, period: "day" },
    analytics_access: { limit: -1, enabled: true, period: "day" },
    watermark_removal: { limit: 1, enabled: true, period: "day" },
    automation_tools: { limit: 0, enabled: false, period: "day" },
    export_access: { limit: 250, enabled: true, period: "day" },
    team_workspaces: { limit: 3, enabled: true, period: "lifetime" },
  },
  agency: {
    script_generation: { limit: -1, enabled: true, period: "fair_usage" },
    caption_generation: { limit: -1, enabled: true, period: "fair_usage" },
    trend_scan: { limit: -1, enabled: true, period: "fair_usage" },
    hashtag_scan: { limit: -1, enabled: true, period: "fair_usage" },
    tts_generation: { limit: -1, enabled: true, period: "fair_usage" },
    video_generation: { limit: -1, enabled: true, period: "fair_usage" },
    byok_access: { limit: -1, enabled: true, period: "day" },
    analytics_access: { limit: -1, enabled: true, period: "day" },
    watermark_removal: { limit: 1, enabled: true, period: "day" },
    automation_tools: { limit: -1, enabled: true, period: "day" },
    export_access: { limit: -1, enabled: true, period: "fair_usage" },
    team_workspaces: { limit: -1, enabled: true, period: "lifetime" },
  },
};

export const PLAN_LIMITS: Record<string, { dailyScans: number; dailyScripts: number; monthlyCap: number; trendingLimit: number; hashtagLimit: number; captionLimit: number; trendingPlatforms: string[] }> = {
  free: { dailyScans: 1, dailyScripts: 2, monthlyCap: 60, trendingLimit: 10, hashtagLimit: 10, captionLimit: 10, trendingPlatforms: ["Instagram"] },
  creator: { dailyScans: 10, dailyScripts: 20, monthlyCap: 620, trendingLimit: 200, hashtagLimit: 300, captionLimit: 20, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  starter: { dailyScans: 10, dailyScripts: 20, monthlyCap: 620, trendingLimit: 200, hashtagLimit: 300, captionLimit: 20, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  pro: { dailyScans: 40, dailyScripts: 100, monthlyCap: 3100, trendingLimit: 1000, hashtagLimit: 1200, captionLimit: 100, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  pro_creator: { dailyScans: 40, dailyScripts: 100, monthlyCap: 3100, trendingLimit: 1000, hashtagLimit: 1200, captionLimit: 100, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  agency: { dailyScans: 999, dailyScripts: 2000, monthlyCap: 62000, trendingLimit: 99999, hashtagLimit: 99999, captionLimit: 2000, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
  scale_agency: { dailyScans: 999, dailyScripts: 2000, monthlyCap: 62000, trendingLimit: 99999, hashtagLimit: 99999, captionLimit: 2000, trendingPlatforms: ["TikTok", "Instagram", "Facebook", "YouTube"] },
};

export function normalizeTier(tier: string | null | undefined): string {
  if (!tier) return "free";
  const t = tier.toLowerCase();
  if (t === "starter") return "creator";
  if (t === "pro") return "pro_creator";
  return t;
}

export function getTierDisplayName(tier: string): string {
  const normalized = normalizeTier(tier);
  const names: Record<string, string> = {
    free: "Free",
    creator: "Creator",
    starter: "Creator",
    pro_creator: "Pro Creator",
    pro: "Pro Creator",
    agency: "Agency",
    scale_agency: "Agency",
  };
  return names[normalized] || tier.charAt(0).toUpperCase() + tier.slice(1);
}

// ============================================================
// BACKEND-DRIVEN ENTITLEMENT HELPERS
// These use the backend-aligned entitlement map.
// ============================================================
export function getEntitlement(tier: string | null | undefined, feature: FeatureKey): EntitlementConfig {
  const normalized = normalizeTier(tier);
  const plan = PLAN_ENTITLEMENTS[normalized];
  if (!plan) return { limit: 0, enabled: false, period: "day" };
  return plan[feature] || { limit: 0, enabled: false, period: "day" };
}

export function isFeatureEnabled(tier: string | null | undefined, feature: FeatureKey): boolean {
  const ent = getEntitlement(tier, feature);
  return ent.enabled && ent.limit !== 0;
}

export function getFeatureLimit(tier: string | null | undefined, feature: FeatureKey): number {
  return getEntitlement(tier, feature).limit;
}

export function isFeatureUnlimited(tier: string | null | undefined, feature: FeatureKey): boolean {
  return getEntitlement(tier, feature).limit === -1;
}

export function isFairUsage(tier: string | null | undefined, feature: FeatureKey): boolean {
  return getEntitlement(tier, feature).period === "fair_usage";
}

export function getLimitsForTier(tier: string | null | undefined) {
  const normalized = normalizeTier(tier);
  return PLAN_LIMITS[normalized] || PLAN_LIMITS.free;
}

export function getCaptionLimitText(tier: string | null | undefined): string {
  const normalized = normalizeTier(tier);
  if (isFairUsage(normalized, "caption_generation")) {
    return "Near-unlimited daily caption generations (fair usage)";
  }
  if (isFeatureUnlimited(normalized, "caption_generation")) {
    return "Unlimited daily caption generations";
  }
  const limit = getFeatureLimit(normalized, "caption_generation");
  return `${limit} caption generations / day`;
}

export function getScriptLimitText(tier: string | null | undefined): string {
  const normalized = normalizeTier(tier);
  if (isFairUsage(normalized, "script_generation")) {
    return "Near-unlimited scripts (fair usage)";
  }
  if (isFeatureUnlimited(normalized, "script_generation")) {
    return "Unlimited scripts";
  }
  const limit = getFeatureLimit(normalized, "script_generation");
  return `${limit} scripts / day`;
}

const DEFAULT_PRICE_MAP = {
  creator: 19,
  pro_creator: 39,
  agency: 99,
};

function getPriceMap(controls?: PricingControls | null) {
  const resolvedProPrice = controls?.pro_creator_price ?? controls?.pro_price;
  return {
    creator: Number(controls?.creator_price ?? DEFAULT_PRICE_MAP.creator),
    pro_creator: Number(resolvedProPrice ?? DEFAULT_PRICE_MAP.pro_creator),
    agency: Number(controls?.agency_price ?? DEFAULT_PRICE_MAP.agency),
  };
}

function buildUsdPlans(controls?: PricingControls | null): PlanConfig[] {
  const prices = getPriceMap(controls);

  return [
  {
    name: "Creator",
    tier: "creator",
    monthlyPrice: prices.creator,
    yearlyPrice: prices.creator * 10,
    dailyScans: getFeatureLimit("creator", "trend_scan"),
    dailyScripts: getFeatureLimit("creator", "script_generation"),
    dailyCaptions: getFeatureLimit("creator", "caption_generation"),
    monthlyScriptsCap: 620,
    features: [
      "20 scripts/day",
      "20 captions/day",
      "Caption Engine included",
      "Trend discovery",
      "Basic hashtag research",
      "Platform-optimized captions",
      "Hook generation",
      "Basic analytics",
      "Multi-platform support",
      "No BYOK",
    ],
  },
  {
    name: "Pro Creator",
    tier: "pro_creator",
    monthlyPrice: prices.pro_creator,
    yearlyPrice: prices.pro_creator * 10,
    dailyScans: getFeatureLimit("pro_creator", "trend_scan"),
    dailyScripts: getFeatureLimit("pro_creator", "script_generation"),
    dailyCaptions: getFeatureLimit("pro_creator", "caption_generation"),
    monthlyScriptsCap: 3100,
    popular: true,
    badge: "MOST POPULAR",
    features: [
      "100 scripts/day",
      "100 captions/day",
      "BYOK enabled",
      "Caption Engine included",
      "Advanced SEO caption styles",
      "Advanced trend engine",
      "Long-form support",
      "AI optimization",
      "Priority generation",
      "Advanced analytics",
      "Multi-platform intelligence",
    ],
  },
  {
    name: "Agency",
    tier: "agency",
    monthlyPrice: prices.agency,
    yearlyPrice: prices.agency * 10,
    dailyScans: 999,
    dailyScripts: 2000,
    dailyCaptions: 2000,
    monthlyScriptsCap: 62000,
    isAgency: true,
    badge: "PREMIUM",
    features: [
      "Team workspaces",
      "Caption Engine included",
      "Near-unlimited usage (fair usage)",
      "Client management",
      "Shared generation history",
      "White-label exports",
      "Automation tools",
      "BYOK enabled",
      "Multi-user collaboration",
      "Priority support",
    ],
  },
  ];
}

export const FREE_PLAN = {
  name: "Free",
  price: "0",
  features: [
    "100 scripts/day",
    "100 captions/day",
    "Caption Engine included",
    "AI voice over included",
    "Video generation included",
    "BYOK enabled",
  ],
};

export function getPlans(_currency: Currency = "USD", controls?: PricingControls | null): PlanConfig[] {
  return buildUsdPlans(controls);
}

export function getCurrencySymbol(_currency: Currency = "USD"): string {
  return "$";
}

export function formatPrice(amount: number, _currency: Currency = "USD"): string {
  return `$${amount.toLocaleString()}`;
}

export function getLandingPricingPlans(
  currency: Currency,
  billingCycle: "monthly" | "yearly",
  controls?: PricingControls | null,
) {
  const plans = getPlans(currency, controls);
  const symbol = getCurrencySymbol(currency);

  const freePlan = {
    name: "Free",
    price: `${symbol}0`,
    period: "",
    features: FREE_PLAN.features,
    isFree: true,
  };

  const paidPlans = plans.map((plan) => {
    const monthlyPrice = plan.monthlyPrice;
    const yearlyMonthly = Math.round(plan.yearlyPrice / 12);
    const displayPrice = billingCycle === "yearly" ? yearlyMonthly : monthlyPrice;

    return {
      name: plan.name,
      price: `${symbol}${displayPrice.toLocaleString()}`,
      period: "/mo",
      yearlyTotal: billingCycle === "yearly" ? `${symbol}${plan.yearlyPrice.toLocaleString()}/yr` : undefined,
      features: plan.features,
      featured: plan.popular,
      badge: plan.badge,
      isAgency: plan.isAgency,
      tier: plan.tier,
    };
  });

  return [freePlan, ...paidPlans];
}

// ============================================================
// FRONTEND USAGE FETCHER (reads from backend, NEVER stores locally)
// ============================================================
export async function fetchUsageStatus(
  sb: typeof import("@/integrations/supabase/client").supabase,
  featureKey: FeatureKey
): Promise<{ allowed: boolean; used: number; quota: number | null; remaining: number }> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return { allowed: false, used: 0, quota: 0, remaining: 0 };
  }

  // Use the old get_usage_status RPC which exists in the types
  // This is a read-only check - no incrementing occurs
  const { data, error } = await (sb as any).rpc("get_usage_status_v2", {
    p_user_id: user.id,
    p_feature_key: featureKey,
  });

  if (error) {
    console.error(`[pricing] Failed to fetch usage for ${featureKey}:`, error);
    return { allowed: false, used: 0, quota: 0, remaining: 0 };
  }

  return {
    allowed: (data as any)?.allowed ?? false,
    used: (data as any)?.used ?? 0,
    quota: (data as any)?.quota ?? null,
    remaining: (data as any)?.remaining ?? 0,
  };
}
