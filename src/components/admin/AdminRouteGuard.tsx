import { ReactNode, useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useAdmin2FA } from "@/hooks/useAdmin2FA";
import { Admin2FASetup } from "@/components/admin/Admin2FASetup";
import { Admin2FAVerify } from "@/components/admin/Admin2FAVerify";

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── 2FA status values ──────────────────────────────────────
// "loading"       — not yet checked
// "not_configured"— no admin_2fa row exists
// "setup_pending" — row exists but is_enabled=false (setup started, not verified)
// "enabled"       — is_enabled=true, must verify each session
// "error"         — check failed (treat as not_configured to avoid lockout)
type TwoFAStatus = "loading" | "not_configured" | "setup_pending" | "enabled" | "error";

async function checkTwoFAStatus(token: string): Promise<TwoFAStatus> {
  try {
    console.debug("[AdminRouteGuard] checking 2FA status...");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-admin-2fa-status`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey":         SUPABASE_ANON_KEY,
        "Content-Type":   "application/json",
      },
    });

    console.debug("[AdminRouteGuard] 2FA status HTTP:", res.status);

    if (res.status === 500) {
      // 500 most likely means the admin_2fa table doesn't exist yet
      // (migration 27 not run). Treat as not_configured so setup screen shows.
      const body = await res.text();
      console.warn("[AdminRouteGuard] 2FA status 500 — table may not exist yet:", body.slice(0, 200));
      return "not_configured";
    }

    if (!res.ok) {
      const body = await res.text();
      console.warn("[AdminRouteGuard] 2FA status error body:", body.slice(0, 200));
      return "error";
    }

    const data = await res.json();
    console.debug("[AdminRouteGuard] 2FA status response:", data);
    return (data.status as TwoFAStatus) ?? "error";
  } catch (err) {
    console.error("[AdminRouteGuard] 2FA status fetch failed:", err);
    return "not_configured"; // network error → show setup (safer than blocking)
  }
}

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: adminAccess, isLoading: adminLoading } = useAdminAccess();
  const { isVerified, clearVerified } = useAdmin2FA();

  const [twoFAStatus,  setTwoFAStatus]  = useState<TwoFAStatus>("loading");
  const [twoFAChecked, setTwoFAChecked] = useState(false);
  // Force re-render after 2FA events by incrementing this counter
  const [renderKey,    setRenderKey]    = useState(0);

  const isAdminConfirmed = !authLoading && !adminLoading && !!user && !!adminAccess?.isAdmin;
  const isNotAdmin       = !authLoading && !adminLoading && (!user || !adminAccess?.isAdmin);

  // ── Step 1: Auth + admin check ─────────────────────────────
  useEffect(() => {
    if (authLoading || adminLoading) return;

    if (!user) {
      console.debug("[AdminRouteGuard] no user → redirect to auth");
      navigate("/adminsh/auth", { replace: true });
      return;
    }

    if (adminAccess !== undefined && !adminAccess?.isAdmin) {
      console.debug("[AdminRouteGuard] not admin → sign out + redirect");
      void supabase.auth.signOut();
      navigate("/adminsh/auth?unauthorized=1", { replace: true });
    }
  }, [authLoading, adminLoading, user, adminAccess, navigate]);

  // ── Step 2: 2FA status check (only once admin is confirmed) ──
  useEffect(() => {
    if (!isAdminConfirmed) return;
    if (twoFAChecked) return;

    const run = async () => {
      console.debug("[AdminRouteGuard] admin confirmed, fetching 2FA status");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        console.warn("[AdminRouteGuard] no access token for 2FA check");
        setTwoFAStatus("error");
        setTwoFAChecked(true);
        return;
      }

      const status = await checkTwoFAStatus(token);
      console.debug("[AdminRouteGuard] resolved 2FA status:", status);
      setTwoFAStatus(status);
      setTwoFAChecked(true);
    };

    void run();
  }, [isAdminConfirmed, twoFAChecked]);

  const handleSignOut = useCallback(async () => {
    console.debug("[AdminRouteGuard] signing out");
    clearVerified();
    await supabase.auth.signOut();
    navigate("/adminsh/auth", { replace: true });
  }, [clearVerified, navigate]);

  const handleSetupComplete = useCallback(() => {
    console.debug("[AdminRouteGuard] setup complete → re-checking 2FA status");
    // Reset so the status is re-fetched — will now return "enabled"
    // and the verify screen will appear
    setTwoFAChecked(false);
    setTwoFAStatus("loading");
    setRenderKey((k) => k + 1);
  }, []);

  const handleVerified = useCallback(() => {
    console.debug("[AdminRouteGuard] 2FA verified → forcing re-render");
    // isVerified() will now return true (sessionStorage was written by Admin2FAVerify)
    // Increment renderKey to force this component to re-evaluate
    setRenderKey((k) => k + 1);
  }, []);

  // ── Loading ────────────────────────────────────────────────
  const stillLoading = authLoading || adminLoading || (isAdminConfirmed && !twoFAChecked);

  if (stillLoading) {
    const msg = !twoFAChecked && isAdminConfirmed
      ? "Checking security configuration..."
      : "Validating admin session...";
    console.debug("[AdminRouteGuard] loading:", msg);
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {msg}
        </div>
      </div>
    );
  }

  // Not admin — render nothing (redirect handled by useEffect above)
  if (isNotAdmin) return null;

  // ── 2FA gate ───────────────────────────────────────────────
  console.debug("[AdminRouteGuard] gate check — twoFAStatus:", twoFAStatus, "isVerified:", isVerified());

  // Error fetching status — fail open to setup (safer than locking out)
  if (twoFAStatus === "error") {
    console.warn("[AdminRouteGuard] 2FA status error — showing setup");
    return <Admin2FASetup onComplete={handleSetupComplete} />;
  }

  // 2FA never configured
  if (twoFAStatus === "not_configured") {
    console.debug("[AdminRouteGuard] 2FA not configured → setup screen");
    return <Admin2FASetup onComplete={handleSetupComplete} />;
  }

  // Setup was started but not completed (is_enabled=false)
  if (twoFAStatus === "setup_pending") {
    console.debug("[AdminRouteGuard] 2FA setup pending → setup screen");
    return <Admin2FASetup onComplete={handleSetupComplete} />;
  }

  // 2FA enabled but not verified this session
  if (twoFAStatus === "enabled" && !isVerified()) {
    console.debug("[AdminRouteGuard] 2FA enabled, not verified → verify screen");
    return <Admin2FAVerify onVerified={handleVerified} onSignOut={handleSignOut} />;
  }

  // All checks passed
  console.debug("[AdminRouteGuard] all checks passed → rendering dashboard");
  return <>{children}</>;
}
