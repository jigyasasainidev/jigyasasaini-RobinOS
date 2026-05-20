import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { motion } from "framer-motion";
import robinosLogo from "@/assets/robinos-logo.png";
import { AdminRouteGuard } from "@/components/admin/AdminRouteGuard";
import { warmCriticalRoutes } from "@/lib/routePrefetch";
import { TopScrollProgress } from "@/components/TopScrollProgress";

const EntryPage = lazy(() => import("./pages/EntryPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const DashboardLayout = lazy(() => import("./pages/DashboardLayout"));

// Lazy load dashboard pages
const IntelligencePage = lazy(() => import("./pages/IntelligencePage"));
const StudioPage = lazy(() => import("./pages/StudioPage"));
const CaptionEnginePage = lazy(() => import("./pages/CaptionEnginePage"));
const VoiceOverStudioPage = lazy(() => import("./pages/VoiceOverStudioPage"));
const TrendingAudioPage = lazy(() => import("./pages/TrendingAudioPage"));
const VideoStudioPage = lazy(() => import("./pages/VideoStudioPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const ReferralsPage = lazy(() => import("./pages/ReferralsPage"));

// Lazy load other pages
const AboutPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.AboutPage })));
const ContactPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.ContactPage })));
const AffiliatesProgramPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.AffiliatesProgramPage })));
const PrivacyPolicyPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.TermsOfServicePage })));
const RefundPolicyPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.RefundPolicyPage })));
const CookiePolicyPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.CookiePolicyPage })));
const AITransparencyPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.AITransparencyPage })));
const AffiliateTermsPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.AffiliateTermsPage })));
const DisclaimerPolicyPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.DisclaimerPolicyPage })));
const HelpCenterPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.HelpCenterPage })));
const DocsPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.DocsPage })));
const ApiAccessPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.ApiAccessPage })));
const ChangelogPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.ChangelogPage })));
const StatusPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.StatusPage })));
const CreatorGuidePage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.CreatorGuidePage })));
const AffiliateGuidePage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.AffiliateGuidePage })));
const ResourcesPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.ResourcesPage })));
const RoadmapPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.RoadmapPage })));
const SupportPage = lazy(() => import("./pages/public/PublicInfoPages").then((m) => ({ default: m.SupportPage })));
const AdminAuthPage = lazy(() => import("./pages/AdminAuthPage"));
const AdminAuthCallbackPage = lazy(() => import("./pages/AdminAuthCallbackPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <motion.img
      src={robinosLogo}
      alt="RobinOS loading logo"
      width={72}
      height={72}
      className="w-14 h-14 object-contain"
      animate={{ opacity: [0.75, 1, 0.75], scale: [0.98, 1.03, 0.98], filter: ["drop-shadow(0 0 14px hsl(217 91% 60% / 0.2))", "drop-shadow(0 0 24px hsl(217 91% 60% / 0.4))", "drop-shadow(0 0 14px hsl(217 91% 60% / 0.2))"] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
    />
  </div>
);

const ScrollManager = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    if ("requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (callback: IdleRequestCallback) => number }).requestIdleCallback(() => warmCriticalRoutes());
    } else {
      timeoutId = globalThis.setTimeout(() => warmCriticalRoutes(), 300);
    }

    return () => {
      if (typeof timeoutId === "number") {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TopScrollProgress />
        <ScrollManager />
        <AuthProvider>
          <CurrencyProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<EntryPage />} />
              <Route path="/pricing" element={<EntryPage initialSection="pricing" />} />
              <Route path="/minidemo" element={<EntryPage initialSection="mini-demo" />} />
              <Route path="/login" element={<AuthPage />} />
              <Route path="/auth" element={<Navigate to="/login" replace />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/dashboard" element={<DashboardLayout />}>
                <Route index element={<Navigate to="intelligence" replace />} />
                <Route path="intelligence" element={<IntelligencePage />} />
                <Route path="studio" element={<StudioPage />} />
                <Route path="caption-engine" element={<CaptionEnginePage />} />
                <Route path="voice" element={<VoiceOverStudioPage />} />
                <Route path="trending" element={<TrendingAudioPage />} />
                <Route path="video" element={<VideoStudioPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="referrals" element={<ReferralsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="/adminsh/auth" element={<AdminAuthPage />} />
              <Route path="/adminsh/callback" element={<AdminAuthCallbackPage />} />
              <Route path="/adminsh" element={<Navigate to="/adminsh/dashboard" replace />} />
              <Route path="/adminsh/dashboard" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/analytics" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/settings" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/users" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/subscriptions" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/affiliates" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/adminsh/withdrawals" element={<AdminRouteGuard><AdminDashboard /></AdminRouteGuard>} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/affiliates" element={<AffiliatesProgramPage />} />
              <Route path="/api" element={<DocsPage />} />
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/roadmap" element={<RoadmapPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/help" element={<HelpCenterPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/api-access" element={<ApiAccessPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/creator-guide" element={<CreatorGuidePage />} />
              <Route path="/affiliate-guide" element={<AffiliateGuidePage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfServicePage />} />
              <Route path="/refund-policy" element={<RefundPolicyPage />} />
              <Route path="/cookie-policy" element={<CookiePolicyPage />} />
              <Route path="/ai-transparency" element={<AITransparencyPage />} />
              <Route path="/affiliate-terms" element={<AffiliateTermsPage />} />
              <Route path="/disclaimer" element={<DisclaimerPolicyPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </CurrencyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
