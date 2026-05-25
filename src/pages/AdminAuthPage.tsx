import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandMark } from "@/components/BrandMark";
import { PageSeo } from "@/components/seo/PageSeo";

const AdminAuthPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const unauthorized = searchParams.get("unauthorized") === "1";
  const expired      = searchParams.get("expired") === "1";

  useEffect(() => {
    let mounted = true;
    const checkExistingAdminSession = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!sessionData.session?.user?.id) {
        setCheckingSession(false);
        return;
      }

      const { data, error } = await (supabase as any).rpc("get_admin_access");
      const access = (data ?? {}) as { is_admin?: boolean };
      if (!error && access.is_admin) {
        navigate("/adminsh/dashboard", { replace: true });
        return;
      }

      await supabase.auth.signOut();
      setCheckingSession(false);
    };

    void checkExistingAdminSession();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleGoogleAdminSignIn = async () => {
    setLoading(true);

    try {
      const callbackUrl = `${window.location.origin}/adminsh/auth/callback`;
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
      toast.error(err?.message || "Unable to continue with Google");
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verifying admin session...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
      <PageSeo
        title="Admin Access | RobinOS"
        description="Restricted RobinOS admin authentication portal."
        canonicalPath="/adminsh/auth"
        noindex
      />
      <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <BrandMark size={26} withWordmark={false} className="drop-shadow-[0_0_16px_hsl(217_91%_60%/0.28)]" />
          </div>
          <h1 className="text-chrome text-2xl font-semibold">RobinOS Admin Access</h1>
          <p className="text-muted-foreground text-xs mt-1 font-mono">Restricted Area — Role Verified</p>
          {unauthorized ? <p className="text-destructive text-xs mt-2 font-mono">Unauthorized Access</p> : null}
          {expired      ? <p className="text-amber-400/80 text-xs mt-2 font-mono">Session expired — please sign in again</p> : null}
        </div>

        <div className="glass-strong rounded-xl p-6 sm:p-8 border border-border/50">
          <motion.button
            whileHover={{ scale: 1.005 }}
            whileTap={{ scale: 0.995 }}
            type="button"
            onClick={handleGoogleAdminSignIn}
            disabled={loading}
            className="w-full h-11 rounded-lg border border-primary/25 bg-background/45 text-foreground text-sm font-medium backdrop-blur-md transition-colors hover:border-primary/35 hover:bg-background/55 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.6v2.99h3.86c2.26-2.09 3.58-5.17 3.58-8.62z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-2.99c-1.07.72-2.44 1.14-4.07 1.14-3.13 0-5.79-2.12-6.74-4.96H1.27v3.12A12 12 0 0 0 12 24z"/>
                <path fill="#FBBC05" d="M5.26 14.28A7.2 7.2 0 0 1 4.88 12c0-.79.14-1.56.38-2.28V6.6H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.4l3.99-3.12z"/>
                <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.81l3.44-3.44C17.95 1.14 15.24 0 12 0A12 12 0 0 0 1.27 6.6l3.99 3.12c.95-2.84 3.61-4.95 6.74-4.95z"/>
              </svg>
            )}
            {loading ? "Authorizing..." : "Continue with Google"}
          </motion.button>

          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] font-mono text-muted-foreground/80">
            <Lock className="w-3 h-3" />
            Secure admin verification required
          </div>

          <p className="mt-5 text-center text-[10px] text-muted-foreground/45 font-mono">
            Only verified administrator accounts can access the command center.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminAuthPage;
