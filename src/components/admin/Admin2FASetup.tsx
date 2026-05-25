import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Copy, Check, Download, AlertTriangle, Loader2, KeyRound, QrCode } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin2FA } from "@/hooks/useAdmin2FA";

// QR code rendered via a lightweight canvas approach — no heavy library
// We use the otpauth URI directly and render it via an img tag pointing
// to a free QR API (or the user can use the manual key)
const QR_API = (data: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}&bgcolor=0b1220&color=60a5fa&margin=10`;

interface Admin2FASetupProps {
  onComplete: () => void;
}

type SetupStep = "intro" | "qr" | "verify" | "backup" | "done";

export function Admin2FASetup({ onComplete }: Admin2FASetupProps) {
  const { setVerified } = useAdmin2FA();
  const [step,         setStep]         = useState<SetupStep>("intro");
  const [loading,      setLoading]      = useState(false);
  const [secret,       setSecret]       = useState("");
  const [otpauth,      setOtpauth]      = useState("");
  const [code,         setCode]         = useState("");
  const [backupCodes,  setBackupCodes]  = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [savedBackup,  setSavedBackup]  = useState(false);
  const [error,        setError]        = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate secret on mount
  useEffect(() => {
    void generateSecret();
  }, []);

  useEffect(() => {
    if (step === "verify") setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const generateSecret = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-admin-2fa`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey":         SUPABASE_ANON_KEY,
          "Content-Type":   "application/json",
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate 2FA secret");
      setSecret(data.secret);
      setOtpauth(data.otpauth);
    } catch (err: any) {
      setError(err.message || "Failed to initialize 2FA");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) { setError("Enter the 6-digit code from your authenticator app."); return; }
    setLoading(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-admin-2fa`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey":         SUPABASE_ANON_KEY,
          "Content-Type":   "application/json",
        },
        body: JSON.stringify({ code, mode: "setup" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");

      setBackupCodes(data.backup_codes ?? []);
      setStep("backup");
    } catch (err: any) {
      setError(err.message || "Verification failed. Check your code and try again.");
    } finally {
      setLoading(false);
    }
  };

  const downloadBackupCodes = () => {
    const text = [
      "RobinOS Admin — 2FA Backup Recovery Codes",
      "Generated: " + new Date().toISOString(),
      "IMPORTANT: Each code can only be used once.",
      "Store these in a secure password manager.",
      "",
      ...backupCodes.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "robinos-admin-backup-codes.txt"; a.click();
    URL.revokeObjectURL(url);
    setSavedBackup(true);
  };

  const copySecret = async () => {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const finishSetup = () => {
    toast.success("2FA enabled. Your admin account is now secured.");
    onComplete();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
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
          <h1 className="text-chrome text-xl font-semibold mb-1">Secure Your Admin Account</h1>
          <p className="text-muted-foreground/55 text-xs font-mono">
            Two-factor authentication required for admin access
          </p>
        </div>

        <div className="rounded-2xl p-6 space-y-5"
          style={{ background: "linear-gradient(160deg, hsl(222 28% 8%) 0%, hsl(222 26% 6%) 100%)", border: "1px solid hsl(217 28% 14%)" }}>

          <AnimatePresence mode="wait">

            {/* Step: Intro */}
            {step === "intro" && (
              <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="space-y-4">
                <p className="text-sm text-foreground/75 leading-relaxed">
                  RobinOS requires Google Authenticator (or any TOTP app) to access the admin panel.
                </p>
                <div className="space-y-2">
                  {[
                    "Install Google Authenticator, Authy, or Microsoft Authenticator",
                    "Scan the QR code on the next screen",
                    "Enter the 6-digit code to confirm",
                    "Save your backup recovery codes",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-mono"
                        style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
                        {i + 1}
                      </span>
                      <p className="text-xs text-muted-foreground/60 leading-relaxed">{step}</p>
                    </div>
                  ))}
                </div>
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={() => setStep("qr")}
                  disabled={loading || !secret}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</> : <><QrCode className="w-4 h-4" /> Show QR Code</>}
                </motion.button>
              </motion.div>
            )}

            {/* Step: QR */}
            {step === "qr" && (
              <motion.div key="qr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="space-y-4">
                <p className="text-xs text-muted-foreground/55 text-center">
                  Scan this QR code with your authenticator app
                </p>
                {/* QR code */}
                <div className="flex justify-center">
                  <div className="rounded-xl p-3" style={{ background: "hsl(222 28% 5%)", border: "1px solid hsl(217 28% 12%)" }}>
                    {otpauth ? (
                      <img src={QR_API(otpauth)} alt="2FA QR Code" width={200} height={200}
                        className="rounded-lg" loading="eager" />
                    ) : (
                      <div className="w-[200px] h-[200px] flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-primary animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
                {/* Manual key */}
                <div className="rounded-xl p-3 space-y-1.5"
                  style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">
                    Manual entry key
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-primary/80 flex-1 break-all">{secret}</code>
                    <button onClick={copySecret}
                      className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all"
                      style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)" }}>
                      {copiedSecret ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                    </button>
                  </div>
                </div>
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={() => setStep("verify")}
                  className="w-full py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
                  I've scanned it — Continue
                </motion.button>
              </motion.div>
            )}

            {/* Step: Verify */}
            {step === "verify" && (
              <motion.div key="verify" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="space-y-4">
                <p className="text-xs text-muted-foreground/55 text-center">
                  Enter the 6-digit code from your authenticator app to confirm setup
                </p>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                  placeholder="000000"
                  className="w-full text-center text-2xl font-mono tracking-[0.5em] rounded-xl py-4 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(217 91% 68%)" }}
                />
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400/80">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
                  </div>
                )}
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={verifyCode}
                  disabled={loading || code.length !== 6}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : "Verify & Enable 2FA"}
                </motion.button>
                <button onClick={() => setStep("qr")}
                  className="w-full text-[10.5px] text-muted-foreground/35 hover:text-muted-foreground/55 transition-colors">
                  ← Back to QR code
                </button>
              </motion.div>
            )}

            {/* Step: Backup codes */}
            {step === "backup" && (
              <motion.div key="backup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="space-y-4">
                <div className="flex items-start gap-2.5 p-3 rounded-xl"
                  style={{ background: "hsl(38 90% 55% / 0.07)", border: "1px solid hsl(38 90% 55% / 0.2)" }}>
                  <AlertTriangle className="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" strokeWidth={1.5} />
                  <p className="text-[11px] text-amber-400/70 leading-relaxed">
                    Save these backup codes now. They will not be shown again. Each code can only be used once.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {backupCodes.map((c, i) => (
                    <div key={i} className="rounded-lg px-3 py-2 text-center"
                      style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
                      <code className="text-[11px] font-mono text-foreground/70">{c}</code>
                    </div>
                  ))}
                </div>
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={downloadBackupCodes}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 55%)" }}>
                  <Download className="w-4 h-4" /> Download Backup Codes
                </motion.button>
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={finishSetup}
                  disabled={!savedBackup}
                  className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
                  style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
                  {savedBackup ? "I've saved my codes — Enter Dashboard" : "Download codes to continue"}
                </motion.button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
