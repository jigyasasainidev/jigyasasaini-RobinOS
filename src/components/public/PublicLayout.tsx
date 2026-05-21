import { ReactNode } from "react";
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
      {showMaintenance ? (
        <div className="relative z-20 border-b border-primary/35 bg-card/90 px-4 py-2 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1240px] items-start gap-2 sm:px-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">{maintenanceMessage}</p>
          </div>
        </div>
      ) : null}
      <main className="relative z-10">{children}</main>
      <PublicFooter />
    </div>
  );
}