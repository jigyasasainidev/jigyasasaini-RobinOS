// Centralized global USD pricing configuration

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

export function getLimitsForTier(tier: string | null | undefined) {
  const normalized = normalizeTier(tier);
  return PLAN_LIMITS[normalized] || PLAN_LIMITS.free;
}

export function getCaptionLimitText(tier: string | null | undefined): string {
  const normalized = normalizeTier(tier);
  const limit = (PLAN_LIMITS[normalized] || PLAN_LIMITS.free).captionLimit;
  return normalized === "agency" || normalized === "scale_agency" ? "Near-unlimited daily caption generations" : `${limit} caption generations / day`;
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
    dailyScans: 10,
    dailyScripts: 20,
    dailyCaptions: 20,
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
    dailyScans: 40,
    dailyScripts: 100,
    dailyCaptions: 100,
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
    "2 scripts in 24h trial",
    "1 trend scan in trial",
    "1 workspace",
    "Watermarked exports",
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
