import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PublicNavbar } from "@/components/public/PublicNavbar";
import { PublicFooter } from "@/components/public/PublicFooter";
import { AlertTriangle } from "lucide-react";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

export function PublicLayout({ children }: { children: ReactNode }) {
  const { data: platformSettings } = usePlatformSettings();
  const showMaintenance = !!platformSettings?.maintenance_mode;
  const maintenanceMessage =
    platformSettings?.announcement_banner?.trim() ||
    "Platform maintenance is in progress. Some features may be temporarily limited.";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background grain">
      <div className="ambient-glow" />
      <PublicNavbar />

      {/* Global Maintenance Banner */}
      <AnimatePresence>
        {showMaintenance && (
          <motion.div
            key="public-maintenance-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative z-20 border-b"
            style={{
              background:
                "linear-gradient(90deg, hsl(217 91% 60% / 0.08), hsl(217 91% 60% / 0.04), hsl(217 91% 60% / 0.08))",
              borderColor: "hsl(217 91% 60% / 0.22)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-4 py-2.5 sm:px-6">
              <span
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full animate-pulse"
                style={{
                  background: "hsl(217 91% 60%)",
                  boxShadow: "0 0 8px hsl(217 91% 60% / 0.6)",
                  animationDuration: "2s",
                }}
              />
              <AlertTriangle className="flex-shrink-0 h-3.5 w-3.5 text-primary/80" />
              <p className="text-[11px] font-mono text-muted-foreground flex-1 truncate">
                {maintenanceMessage}
              </p>
              <span className="flex-shrink-0 text-[9px] font-mono text-primary/60 uppercase tracking-widest">
                Operational Notice
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10">{children}</main>
      <PublicFooter />
    </div>
  );
}
