const routeImporters: Array<{ match: RegExp; load: () => Promise<unknown> }> = [
  { match: /^\/dashboard\/intelligence(?:\/|$)/, load: () => import("@/pages/IntelligencePage") },
  { match: /^\/dashboard\/studio(?:\/|$)/, load: () => import("@/pages/StudioPage") },
  { match: /^\/dashboard\/caption-engine(?:\/|$)/, load: () => import("@/pages/CaptionEnginePage") },
  { match: /^\/dashboard\/voice(?:\/|$)/, load: () => import("@/pages/VoiceOverStudioPage") },
  { match: /^\/dashboard\/trending(?:\/|$)/, load: () => import("@/pages/TrendingAudioPage") },
  { match: /^\/dashboard\/video(?:\/|$)/, load: () => import("@/pages/VideoStudioPage") },
  { match: /^\/dashboard\/history(?:\/|$)/, load: () => import("@/pages/HistoryPage") },
  { match: /^\/dashboard\/referrals(?:\/|$)/, load: () => import("@/pages/ReferralsPage") },
  { match: /^\/dashboard\/settings(?:\/|$)/, load: () => import("@/pages/SettingsPage") },
  { match: /^\/adminsh\/auth(?:\/|$)/, load: () => import("@/pages/AdminAuthPage") },
  { match: /^\/adminsh(?:\/|$)/, load: () => import("@/pages/AdminDashboard") },
  { match: /^\/auth\/callback(?:\/|$)/, load: () => import("@/pages/AuthCallbackPage") },
  { match: /^\/about(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.AboutPage) },
  { match: /^\/contact(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.ContactPage) },
  { match: /^\/affiliates(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.AffiliatesProgramPage) },
  { match: /^\/(api|docs)(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.DocsPage) },
  { match: /^\/api-access(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.ApiAccessPage) },
  { match: /^\/changelog(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.ChangelogPage) },
  { match: /^\/resources(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.ResourcesPage) },
  { match: /^\/roadmap(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.RoadmapPage) },
  { match: /^\/(help|support)(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.SupportPage) },
  { match: /^\/status(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.StatusPage) },
  { match: /^\/creator-guide(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.CreatorGuidePage) },
  { match: /^\/affiliate-guide(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.AffiliateGuidePage) },
  { match: /^\/privacy(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.PrivacyPolicyPage) },
  { match: /^\/terms(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.TermsOfServicePage) },
  { match: /^\/refund-policy(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.RefundPolicyPage) },
  { match: /^\/cookie-policy(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.CookiePolicyPage) },
  { match: /^\/ai-transparency(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.AITransparencyPage) },
  { match: /^\/affiliate-terms(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.AffiliateTermsPage) },
  { match: /^\/disclaimer(?:\/|$)/, load: () => import("@/pages/public/PublicInfoPages").then((m) => m.DisclaimerPolicyPage) },
];

const prefetched = new Set<string>();

const normalizePath = (to: string) => to.split("#")[0]?.split("?")[0] || "/";

export const prefetchRoute = (to: string) => {
  const path = normalizePath(to);
  if (!path || prefetched.has(path)) return;

  const matches = routeImporters.filter((route) => route.match.test(path));
  if (!matches.length) return;

  prefetched.add(path);
  for (const entry of matches) {
    void entry.load();
  }
};

export const warmCriticalRoutes = () => {
  [
    "/login",
    "/dashboard/intelligence",
    "/dashboard/studio",
    "/dashboard/caption-engine",
    "/dashboard/trending",
    "/affiliates",
    "/docs",
    "/api-access",
    "/changelog",
    "/pricing",
    "/minidemo",
  ].forEach(prefetchRoute);
};