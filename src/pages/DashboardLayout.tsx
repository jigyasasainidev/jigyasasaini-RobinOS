import { Suspense, useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { useFreeTrialStatus, useProfile, useSubscriptionExpiry } from "@/hooks/useProfile";
import { useEntitlementsLoading, useIsFree } from "@/hooks/useEntitlements";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { RenewalReminder, RenewalBannerInline } from "@/components/RenewalReminder";
import { db } from "@/lib/cloudDb";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import robinosLogo from "@/assets/robinos-logo.png";
import { AlertTriangle, ShieldX, X } from "lucide-react";
import { subscribePostgresChanges } from "@/lib/realtime/channelManager";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { RouteErrorBoundary } from "@/components/ui/error-boundary";

const DashboardLayout = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { expired: freeExpired, isFree } = useFreeTrialStatus();
  const { expired: subExpired, tier } = useSubscriptionExpiry();
  const isEntitlementsLoading = useEntitlementsLoading();
  const isFreeEntitlement = useIsFree();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [maintenanceDismissed, setMaintenanceDismissed] = useState(false);

  const maintenanceQuery = useQuery({
    queryKey: ["platform-maintenance-v1"],
    queryFn: async () => {
      const { data, error } = await db
        .from("platform_settings")
        .select("maintenance_mode,announcement_banner,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Free trial expired → show upgrade.
  // Guard: only evaluate AFTER entitlements have resolved from the backend.
  // Without this guard, placeholderData (plan: "free") would fire the
  // paywall immediately on mount, before the RPC returns the real plan.
  useEffect(() => {
    if (!isEntitlementsLoading && isFree && freeExpired) {
      setShowUpgrade(true);
    }
  }, [isEntitlementsLoading, isFree, freeExpired]);

  // Reverse-dismiss: if entitlements resolve to a paid plan, close the
  // paywall unconditionally. This handles the admin-upgrade case where
  // the user was briefly shown the paywall during the loading window.
  useEffect(() => {
    if (!isEntitlementsLoading && !isFreeEntitlement) {
      setShowUpgrade(false);
    }
  }, [isEntitlementsLoading, isFreeEntitlement]);

  // Paid subscription expired → downgrade to free and show upgrade.
  // Guard: only runs after entitlements loaded AND user is confirmed free tier.
  // Without this guard, a briefly-loading placeholder could trigger a spurious
  // downgrade write against a valid paid profile row.
  useEffect(() => {
    if (!isEntitlementsLoading && subExpired && user && tier !== "free") {
      const downgrade = async () => {
        await db
          .from("profiles")
          .update({
            subscription_tier: "free",
            free_trial_expired: true,
            subscription_expires_at: null,
          } as any)
          .eq("user_id", user.id);
        queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
        setShowUpgrade(true);
      };
      downgrade();
    }
  }, [isEntitlementsLoading, subExpired, user, tier, queryClient]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribePostgresChanges({
      channelName: "platform-maintenance-live",
      table: "platform_settings",
      event: "*",
      callback: () => queryClient.invalidateQueries({ queryKey: ["platform-maintenance-v1"] }),
    });

    return unsubscribe;
  }, [user, queryClient]);

  useEffect(() => {
    const updatedAt = maintenanceQuery.data?.updated_at;
    if (!updatedAt) return;

    const dismissed = sessionStorage.getItem(`maintenance-dismissed:${updatedAt}`) === "1";
    setMaintenanceDismissed(dismissed);
  }, [maintenanceQuery.data?.updated_at]);

  const dismissMaintenance = () => {
    const updatedAt = maintenanceQuery.data?.updated_at;
    if (updatedAt) {
      sessionStorage.setItem(`maintenance-dismissed:${updatedAt}`, "1");
    }
    setMaintenanceDismissed(true);
  };

  const maintenanceActive = !!maintenanceQuery.data?.maintenance_mode;
  const maintenanceMessage = maintenanceQuery.data?.announcement_banner?.trim() || "Platform maintenance is in progress. Some features may be temporarily limited.";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(217_91%_60%/0.14),transparent_65%)]" />
        <motion.img
          src={robinosLogo}
          alt="RobinOS loading logo"
          width={88}
          height={88}
          className="relative z-10 w-20 h-20 object-contain"
          animate={{ opacity: [0.75, 1, 0.75], scale: [0.98, 1.04, 0.98], filter: ["drop-shadow(0 0 16px hsl(217 91% 60% / 0.25))", "drop-shadow(0 0 30px hsl(217 91% 60% / 0.45))", "drop-shadow(0 0 16px hsl(217 91% 60% / 0.25))"] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    );
  }

  if (!user) return null;

  // ── Suspension screen — shown to suspended users before anything else ──
  if (profile && profile.is_suspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background grain px-4">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(0_72%_51%/0.06),transparent_60%)] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative z-10 w-full max-w-sm"
          style={{
            background: "hsl(0 0% 6% / 0.9)",
            border: "1px solid hsl(0 72% 51% / 0.2)",
            borderRadius: "1rem",
            backdropFilter: "blur(24px)",
            boxShadow: "0 0 48px hsl(0 72% 51% / 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
          }}
        >
          <div className="p-7 text-center">
            <div className="flex justify-center mb-5">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "hsl(0 72% 51% / 0.1)", border: "1px solid hsl(0 72% 51% / 0.25)" }}
              >
                <ShieldX className="w-5 h-5" style={{ color: "hsl(0 72% 64%)" }} />
              </div>
            </div>
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] mb-3" style={{ color: "hsl(0 72% 64% / 0.7)" }}>
              Account Suspended
            </p>
            <h1 className="text-chrome text-lg font-semibold mb-3 leading-snug">
              Your account has been suspended
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
              Access to the RobinOS platform has been restricted due to a violation of our platform policies. If you believe this is an error, please contact support.
            </p>
            <div className="space-y-2">
              <a
                href="mailto:support@tryrobin.xyz"
                className="w-full flex items-center justify-center h-10 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "hsl(0 72% 51% / 0.12)",
                  border: "1px solid hsl(0 72% 51% / 0.3)",
                  color: "hsl(0 72% 74%)",
                }}
              >
                Contact Support → support@tryrobin.xyz
              </a>
              <button
                onClick={() => { void signOut(); navigate("/login", { replace: true }); }}
                className="w-full h-10 rounded-lg text-xs font-medium text-muted-foreground border border-border/60 hover:text-foreground hover:border-border transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background grain select-none-all">
      {/* Dashboard pages are private — never index them */}
      <Helmet>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="ambient-glow" />
      <DashboardSidebar />

      <main className="flex-1 min-h-screen overflow-y-auto relative z-10">
        <div className="px-4 py-6 md:p-10 max-w-5xl mx-auto md:mx-0">
          <AnimatePresence>
            {maintenanceActive && !maintenanceDismissed ? (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4 rounded-lg border border-primary/40 bg-card/95 p-3"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Maintenance Notice</p>
                    <p className="text-xs text-muted-foreground">{maintenanceMessage}</p>
                  </div>
                  <button
                    onClick={dismissMaintenance}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Dismiss maintenance message"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
          {/* Renewal banner — 7-day warning, inline above content */}
          <RenewalBannerInline />

              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </div>
      </main>

      {/* Forced upgrade for expired users (free trial OR paid subscription) */}
      <UpgradeDialog open={showUpgrade} forced onOpenChange={setShowUpgrade} />

      {/* Renewal reminder — popup for 3d/1d/grace, banner for 7d */}
      <RenewalReminder />

    </div>
  );
};

export default DashboardLayout;
