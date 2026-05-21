import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { initializeUserAccount } from "@/lib/authInitialization";

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
      const storedReferral = sessionStorage.getItem("robinos_referral_code");

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
        // Use Lovable's library to complete the PKCE exchange since it
        // holds the code_verifier stored during OAuth initiation.
        const result = await lovable.auth.signInWithOAuth("google");

        if (result.error) {
          console.error("[AuthCallback] PKCE exchange failed", result.error);
          toast.error(result.error.message || "Unable to complete sign-in.");
          navigate("/login", { replace: true });
          return;
        }

        if (result.tokens) {
          const { error: sessionError } = await supabase.auth.setSession(result.tokens);
          if (sessionError) {
            console.error("[AuthCallback] Session set failed", sessionError);
            toast.error("Unable to establish session.");
            navigate("/login", { replace: true });
            return;
          }
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

      sessionStorage.removeItem("robinos_referral_code");
      console.info("[AuthCallback] Success, redirecting to dashboard");
      navigate("/dashboard", { replace: true });
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