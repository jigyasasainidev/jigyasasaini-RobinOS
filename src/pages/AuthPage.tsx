import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { PageSeo } from "@/components/seo/PageSeo";
import { initializeUserAccount } from "@/lib/authInitialization";
import { referralCoordinator } from "@/services/affiliate/referralCoordinator";

const AuthPage = () => {
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get("ref") || "";
  const initializedForUserRef = useRef<string | null>(null);

  const initializeAccount = async (userId: string) => {
    if (initializedForUserRef.current === userId) return;
    initializedForUserRef.current = userId;

    setInitializing(true);
    const init = await initializeUserAccount(ref || null);

    if (!init.ok) {
      initializedForUserRef.current = null;
      toast.error(init.error || "Unable to initialize account");
      setInitializing(false);
      return;
    }

    navigate("/dashboard");
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user?.id) {
        void initializeAccount(session.user.id);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        void initializeAccount(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, ref]);

  const handleGoogleSignIn = async () => {
    setLoading(true);

    try {
      if (ref) {
        const captured = referralCoordinator.captureFromUrl(ref);
        if (captured) {
          const { overwriteBlocked } = referralCoordinator.persist(captured);
          if (overwriteBlocked) {
            console.info(`[Auth] Referral overwrite blocked — existing first-touch preserved (incoming=${ref})`);
          }
        }
      }

      const callbackUrl = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (oauthError) throw oauthError;
    } catch (err: any) {
      console.error("[Auth] OAuth start failed", err);
      toast.error(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain select-none-all px-4">
      <PageSeo
        title="Login | RobinOS"
        description="Continue with Google to access RobinOS and manage your AI content workflows."
        canonicalPath="/login"
        keywords="robinos login, continue with google, creator dashboard login"
      />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, filter: "blur(12px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="glass-strong rounded-xl p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <div className="flex justify-center mb-3">
              <BrandMark size={34} withWordmark={false} className="drop-shadow-[0_0_20px_hsl(217_91%_60%/0.25)]" />
            </div>
            <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-2">RobinOS</p>
            <h1 className="text-chrome text-2xl font-semibold">Continue with Google</h1>
            <p className="mt-2 text-xs text-muted-foreground">Sign in to RobinOS in one click.</p>
            {ref && <p className="mt-2 text-[10px] text-primary font-mono">Referral: {ref}</p>}
          </div>

          <div className="space-y-4">
            <motion.div
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full"
            >
              <Button
                onClick={handleGoogleSignIn}
                disabled={loading || initializing}
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue"
              >
                {loading || initializing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Redirecting..." : initializing ? "Setting up your workspace..." : "Continue with Google"}
              </Button>
            </motion.div>
          </div>

          {/* Built by a 10th grade founder */}
          <p className="mt-6 text-center text-[10px] text-muted-foreground/40 font-mono">
            AI Content Operating System
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
