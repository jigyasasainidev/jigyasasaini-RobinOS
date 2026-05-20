import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAdminAction } from "@/lib/adminAudit";

const AdminAuthCallbackPage = () => {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const verifyAdminCallback = async () => {
      const url = new URL(window.location.href);
      const oauthError = url.searchParams.get("error");
      const oauthErrorDescription = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");

      if (oauthError) {
        toast.error(oauthErrorDescription || "Google sign-in failed.");
        navigate("/adminsh/auth", { replace: true });
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          toast.error(exchangeError.message || "Unable to complete admin sign-in.");
          navigate("/adminsh/auth", { replace: true });
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        toast.error("Session not found. Please try again.");
        navigate("/adminsh/auth", { replace: true });
        return;
      }

      const { data, error } = await (supabase as any).rpc("get_admin_access");
      const access = (data ?? {}) as { role?: string | null; is_admin?: boolean };

      if (error || !access.is_admin) {
        await supabase.auth.signOut();
        toast.error("Unauthorized Access");
        navigate("/adminsh/auth?unauthorized=1", { replace: true });
        return;
      }

      try {
        await logAdminAction("admin_login", session.user.id, {
          email: session.user.email ?? null,
          role: access.role ?? "admin",
          route: "/adminsh/auth/callback",
          provider: "google",
        });
      } catch {
        // don't block login on audit write failure
      }

      navigate("/adminsh/dashboard", { replace: true });
    };

    void verifyAdminCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
        <Loader2 className="w-4 h-4 animate-spin" />
        Verifying administrator access...
      </div>
    </div>
  );
};

export default AdminAuthCallbackPage;