import { ReactNode, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: adminAccess, isLoading: adminLoading } = useAdminAccess();

  const isNotAdmin = !authLoading && !adminLoading && (!user || !adminAccess?.isAdmin);

  // ── Auth + admin check ─────────────────────────────────────
  useEffect(() => {
    if (authLoading || adminLoading) return;

    if (!user) {
      navigate("/adminsh/auth", { replace: true });
      return;
    }

    if (adminAccess !== undefined && !adminAccess?.isAdmin) {
      void supabase.auth.signOut();
      navigate("/adminsh/auth?unauthorized=1", { replace: true });
    }
  }, [authLoading, adminLoading, user, adminAccess, navigate]);

  // ── Loading ────────────────────────────────────────────────
  if (authLoading || adminLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Validating admin session...
        </div>
      </div>
    );
  }

  // Not admin — render nothing (redirect handled above)
  if (isNotAdmin) return null;

  return (
    <>
      {/* Swap manifest to admin-manifest.json so Chrome fires beforeinstallprompt
          for the admin PWA (scope /adminsh/, start_url /adminsh/dashboard) */}
      <Helmet>
        <link rel="manifest" href="/admin-manifest.json" />
      </Helmet>
      {children}
    </>
  );
}
