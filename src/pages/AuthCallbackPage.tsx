import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { initializeUserAccount } from "@/lib/authInitialization";
import { referralCoordinator } from "@/services/affiliate/referralCoordinator";

const AuthCallbackPage = () => {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const handleCallback = async () => {
      const url = new URL(window.location.href);
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");
      const restored = referralCoordinator.restore();
      const storedReferral = restored.code;

      console.info("[AuthCallback] Started", {
        pathname: url.pathname,
        hasCode: !!code,
        hasError: !!error,
      });

      if (error) {
        console.error("[AuthCallback] OAuth error", { error, errorDescription });
        toast.error(errorDescription || "Google sign-in failed. Please try again.");
        navigate("/login", { replace: true });
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error("[AuthCallback] Session exchange failed", exchangeError);
          toast.error(exchangeError.message || "Unable to complete sign-in.");
          navigate("/login", { replace: true });
          return;
        }
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user?.id) {
        console.error("[AuthCallback] No active session", sessionError);
        toast.error("Session not found. Please sign in again.");
        navigate("/login", { replace: true });
        return;
      }

      const init = await initializeUserAccount(storedReferral || null);

      if (!init.ok) {
        console.error("[AuthCallback] Account initialization failed", init);
        toast.error(init.error || "Unable to initialize account");
        navigate("/login", { replace: true });
        return;
      }

      // Clean up all storage layers after successful attribution
      referralCoordinator.cleanup(restored.traceId);

      const returnTo = sessionStorage.getItem("robinos_return_to");
      if (returnTo) {
        sessionStorage.removeItem("robinos_return_to");
        console.info("[AuthCallback] Success, redirecting to", returnTo);
        navigate(returnTo, { replace: true });
      } else {
        console.info("[AuthCallback] Success, redirecting to dashboard");
        navigate("/dashboard", { replace: true });
      }
    };

    void handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Completing sign in...
      </div>
    </div>
  );
};

export default AuthCallbackPage;