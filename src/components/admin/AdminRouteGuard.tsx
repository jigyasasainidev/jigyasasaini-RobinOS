import { ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useAdmin2FA } from "@/hooks/useAdmin2FA";
import { Admin2FASetup } from "@/components/admin/Admin2FASetup";
import { Admin2FAVerify } from "@/components/admin/Admin2FAVerify";

// ── 2FA status from backend ────────────────────────────────
type TwoFAStatus = "loading" | "not_configured" | "enabled" | "error";

async function fetch2FAStatus(token: string): Promise<TwoFAStatus> {
  try {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    // We check the admin_2fa table via a lightweight edge function call.
    // We reuse verify-admin-2fa with a status-check mode to avoid
    // exposing the table directly to the client.
    // Simpler: call generate-admin-2fa — if it returns 409, 2FA is enabled.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-admin-2fa`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 409) return "enabled";   // already enabled
    if (res.status === 200) return "not_configured"; // secret generated, not yet enabled
    if (res.status === 403) return "error";
    return "not_configured";
  } catch {
    return "error";
  }
}

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuth();
  const { data: adminAccess, isLoading: adminLoading } = useAdminAccess();
  const { isVerified, clearVerified } = useAdmin2FA();

  const [twoFAStatus, setTwoFAStatus] = useState<TwoFAStatus>("loading");
  const [twoFAChecked, setTwoFAChecked] = useState(false);

  // Step 1: Redirect if not authenticated or not admin
  useEffect(() => {
    if (loading || adminLoading) return;
    if (!user) { navigate("/adminsh/auth", { replace: true }); return; }
    if (!adminAccess?.isAdmin) {
      void supabase.auth.signOut();
      navigate("/adminsh/auth?unauthorized=1", { replace: true });
    }
  }, [loading, adminLoading, user, adminAccess?.isAdmin, navigate]);

  // Step 2: Check 2FA status once admin is confirmed
  useEffect(() => {
    if (loading || adminLoading || !user || !adminAccess?.isAdmin) return;
    if (twoFAChecked) return;

    const check = async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { setTwoFAStatus("error"); setTwoFAChecked(true); return; }
      const status = await fetch2FAStatus(token);
      setTwoFAStatus(status);
      setTwoFAChecked(true);
    };
    void check();
  }, [loading, adminLoading, user, adminAccess?.isAdmin, twoFAChecked]);

  const handleSignOut = async () => {
    clearVerified();
    await supabase.auth.signOut();
    navigate("/adminsh/auth", { replace: true });
  };

  // ── Loading states ─────────────────────────────────────────
  if (loading || adminLoading || !twoFAChecked) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {!twoFAChecked && adminAccess?.isAdmin ? "Checking security status..." : "Validating admin session..."}
        </div>
      </div>
    );
  }

  if (!user || !adminAccess?.isAdmin) return null;

  // ── 2FA not configured — show setup ───────────────────────
  if (twoFAStatus === "not_configured") {
    return (
      <Admin2FASetup
        onComplete={() => {
          // After setup, re-check status — will now be "enabled"
          // and user will need to verify on next load
          setTwoFAChecked(false);
          setTwoFAStatus("loading");
        }}
      />
    );
  }

  // ── 2FA enabled but not verified this session ──────────────
  if (twoFAStatus === "enabled" && !isVerified()) {
    return (
      <Admin2FAVerify
        onVerified={() => {
          // Session token stored by Admin2FAVerify — re-render will pass through
          setTwoFAStatus("enabled");
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  // ── All checks passed — render dashboard ──────────────────
  return <>{children}</>;
}
