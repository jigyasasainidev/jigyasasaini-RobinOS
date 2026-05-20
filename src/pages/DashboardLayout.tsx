import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { useFreeTrialStatus, useSubscriptionExpiry } from "@/hooks/useProfile";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { OnboardingPopup } from "@/components/OnboardingPopup";
import { db } from "@/lib/cloudDb";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import robinosLogo from "@/assets/robinos-logo.png";

const DashboardLayout = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { expired: freeExpired, isFree } = useFreeTrialStatus();
  const { expired: subExpired, tier } = useSubscriptionExpiry();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Free trial expired → show upgrade
  useEffect(() => {
    if (isFree && freeExpired) {
      setShowUpgrade(true);
    }
  }, [isFree, freeExpired]);

  // Paid subscription expired → downgrade to free and show upgrade
  useEffect(() => {
    if (subExpired && user && tier !== "free") {
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
  }, [subExpired, user, tier, queryClient]);

  // Show onboarding for new users
  useEffect(() => {
    if (user && !loading) {
      const permanent = localStorage.getItem("robinos_onboarding_done_permanent");
      const session = localStorage.getItem("robinos_onboarding_done");
      if (!permanent && !session) {
        setShowOnboarding(true);
      }
    }
  }, [user, loading]);

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

  return (
    <div className="min-h-screen flex bg-background grain select-none-all">
      <div className="ambient-glow" />
      <DashboardSidebar />

      <main className="flex-1 min-h-screen overflow-y-auto relative z-10 pb-24 md:pb-0">
        <div className="px-4 py-6 md:p-10 max-w-5xl mx-auto md:mx-0">
          <Outlet />
        </div>
      </main>

      {/* Forced upgrade for expired users (free trial OR paid subscription) */}
      <UpgradeDialog open={showUpgrade} forced onOpenChange={setShowUpgrade} />

      {/* Onboarding popup for new users */}
      {showOnboarding && <OnboardingPopup onComplete={() => setShowOnboarding(false)} />}
    </div>
  );
};

export default DashboardLayout;
