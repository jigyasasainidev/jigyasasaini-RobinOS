import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSeo } from "@/components/seo/PageSeo";

/**
 * TEMPORARY REVIEWER LOGIN — WarriorPlus review only.
 *
 * Isolated email + password sign-in using Supabase Auth. Does not touch the
 * Google OAuth flow. Account provisioning (subscription tier, etc.) is done
 * manually in the Supabase Dashboard / database — this page does NOT call
 * initializeUserAccount() so manually-set plans are preserved.
 *
 * Remove this route and its App.tsx registration after WarriorPlus approval.
 */
const ReviewLoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // If a reviewer is already signed in, send them straight to the dashboard
  // so refreshing the page doesn't bounce them back to the form.
  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user?.id) {
        navigate("/dashboard", { replace: true });
        return;
      }
      setCheckingSession(false);
    });
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        setError(signInError.message || "Sign-in failed. Check your credentials.");
        return;
      }

      if (!data?.user?.id) {
        setError("Sign-in failed. No active session was returned.");
        return;
      }

      // Reviewer account is pre-provisioned (user + subscription) in Supabase
      // manually, so we skip initializeUserAccount() to avoid touching their
      // manually-set plan. AuthContext's onAuthStateChange will hydrate the
      // session; just route into the app.
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error during sign-in.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking session...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain px-4">
      <PageSeo
        title="Reviewer Sign In"
        description="Temporary reviewer access."
        canonicalPath="/review-login"
        noindex
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="glass-strong rounded-xl p-6 sm:p-8 border border-border/50">
          <div className="text-center mb-6">
            <h1 className="text-chrome text-xl font-semibold">Reviewer Sign In</h1>
            <p className="mt-2 text-xs text-muted-foreground font-mono">
              WarriorPlus review access only
            </p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="review-email" className="text-xs font-mono text-muted-foreground">
                Email
              </Label>
              <Input
                id="review-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="reviewer@example.com"
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="review-password" className="text-xs font-mono text-muted-foreground">
                Password
              </Label>
              <Input
                id="review-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                disabled={loading}
                required
              />
            </div>

            {error ? (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono"
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-[10px] text-muted-foreground/45 font-mono">
            Temporary route — removed after WarriorPlus approval.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default ReviewLoginPage;
