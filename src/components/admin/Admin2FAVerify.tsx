import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Loader2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin2FA } from "@/hooks/useAdmin2FA";

interface Admin2FAVerifyProps {
  onVerified: () => void;
  onSignOut:  () => void;
}

export function Admin2FAVerify({ onVerified, onSignOut }: Admin2FAVerifyProps) {
  const { setVerified } = useAdmin2FA();
  const [code,       setCode]       = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [locked,     setLocked]     = useState(false);
  const [lockedUntil,setLockedUntil]= useState<string | null>(null);
  const [useBackup,  setUseBackup]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, [useBackup]);

  const verify = async () => {
    const trimmed = code.replace(/\s/g, "");
    if (!useBackup && trimmed.length !== 6) { setError("Enter the 6-digit code from your authenticator app."); return; }
    if (useBackup && trimmed.length < 8)    { setError("Enter your backup recovery code."); return; }

    setLoading(true);
    setError("");

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-admin-2fa`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, mode: "login", is_backup_code: useBackup }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.locked) {
          setLocked(true);
          setLockedUntil(data.locked_until ?? null);
        }
        throw new Error(data.error ?? "Verification failed");
      }

      // Store signed session token
      setVerified({ session_token: data.session_token, expires_at: data.expires_at });
      onVerified();

    } catch (err: any) {
      setError(err.message || "Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const lockoutRemaining = lockedUntil
    ? Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000))
    : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="text-center mb-6">
          <motion.div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)" }}
            animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 28px hsl(217 91% 60% / 0.2)", "0 0 0 hsl(217 91% 60% / 0)"] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Shield className="w-6 h-6 text-primary" strokeWidth={1.5} />
          </motion.div>
          <h1 className="text-chrome text-xl font-semibold mb-1">Admin Verification</h1>
          <p className="text-muted-foreground/55 text-xs font-mono">
            {useBackup ? "Enter a backup recovery code" : "Enter the code from your authenticator app"}
          </p>
        </div>

        <div className="rounded-2xl p-6 space-y-4"
          style={{ background: "linear-gradient(160deg, hsl(222 28% 8%) 0%, hsl(222 26% 6%) 100%)", border: "1px solid hsl(217 28% 14%)" }}>

          {locked ? (
            <div className="text-center space-y-3 py-4">
              <div className="w-10 h-10 rounded-xl mx-auto flex items-center justify-center"
                style={{ background: "hsl(0 72% 50% / 0.08)", border: "1px solid hsl(0 72% 50% / 0.2)" }}>
                <AlertTriangle className="w-5 h-5 text-red-400/70" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-foreground/80">Account Temporarily Locked</p>
              <p className="text-xs text-muted-foreground/50 leading-relaxed">
                Too many failed attempts. Try again in {lockoutRemaining} minute{lockoutRemaining !== 1 ? "s" : ""}.
              </p>
              <button onClick={onSignOut}
                className="text-[10.5px] text-muted-foreground/35 hover:text-muted-foreground/55 transition-colors">
                Sign out and try again later
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type={useBackup ? "text" : "text"}
                inputMode={useBackup ? "text" : "numeric"}
                pattern={useBackup ? undefined : "[0-9]*"}
                maxLength={useBackup ? 20 : 6}
                value={code}
                onChange={(e) => {
                  const v = useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, "");
                  setCode(v);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                placeholder={useBackup ? "BACKUP CODE" : "000000"}
                className="w-full text-center font-mono rounded-xl py-4 focus:outline-none focus:ring-1 focus:ring-primary/40"
                style={{
                  background: "hsl(222 28% 6%)",
                  border: "1px solid hsl(217 28% 14%)",
                  color: "hsl(217 91% 68%)",
                  fontSize: useBackup ? "0.875rem" : "1.5rem",
                  letterSpacing: useBackup ? "0.1em" : "0.5em",
                }}
              />

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400/75">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
                </div>
              )}

              <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                onClick={verify}
                disabled={loading || (!useBackup && code.length !== 6) || (useBackup && code.length < 8)}
                className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : "Verify Access"}
              </motion.button>

              <div className="flex items-center justify-between pt-1">
                <button onClick={() => { setUseBackup(!useBackup); setCode(""); setError(""); }}
                  className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/40 hover:text-muted-foreground/65 transition-colors">
                  <KeyRound className="w-3 h-3" />
                  {useBackup ? "Use authenticator app" : "Use backup code"}
                </button>
                <button onClick={onSignOut}
                  className="text-[10.5px] text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors">
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
