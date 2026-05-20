import { ReactNode, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: adminAccess, isLoading: adminLoading } = useAdminAccess();

  useEffect(() => {
    if (loading || adminLoading) return;

    if (!user) {
      navigate("/adminsh/auth", { replace: true });
      return;
    }

    if (!adminAccess?.isAdmin) {
      void supabase.auth.signOut();
      navigate("/adminsh/auth?unauthorized=1", { replace: true });
    }
  }, [loading, adminLoading, user, adminAccess?.isAdmin, navigate]);

  if (loading || adminLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Validating admin session...
        </div>
      </div>
    );
  }

  if (!user || !adminAccess?.isAdmin) {
    return null;
  }

  return <>{children}</>;
}