// ============================================================
// AdminPWAInstall — Premium PWA install card for admin settings
// ============================================================
// Shown in the Platform Settings page under a dedicated section.
// Handles: Chrome/Edge/Android install prompt, iOS manual guide,
// already-installed state, and unsupported browsers.
// ============================================================

import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Smartphone,
  Monitor,
  CheckCircle2,
  Share,
  Plus,
  Zap,
  Shield,
  Wifi,
} from "lucide-react";
import { useAdminPWA } from "@/hooks/useAdminPWA";

export function AdminPWAInstall() {
  const { installState, triggerInstall, dismissInstall, swRegistered } = useAdminPWA();

  // ── Already installed ──────────────────────────────────
  if (installState === "installed") {
    return (
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3"
        style={{
          background: "hsl(142 70% 45% / 0.06)",
          border: "1px solid hsl(142 70% 45% / 0.18)",
        }}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "hsl(142 70% 55%)" }} />
        <div>
          <p className="text-[11px] font-medium" style={{ color: "hsl(142 70% 60%)" }}>
            RobinOS Admin is installed
          </p>
          <p className="text-[9.5px] font-mono mt-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
            Running as a native app · {swRegistered ? "Service worker active" : "Offline shell ready"}
          </p>
        </div>
      </div>
    );
  }

  // ── iOS manual instructions ────────────────────────────
  if (installState === "ios") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(222 32% 8%) 0%, hsl(222 28% 7%) 100%)",
          border: "1px solid hsl(217 28% 14%)",
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center gap-3"
          style={{ borderBottom: "1px solid hsl(217 28% 11%)" }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "hsl(217 91% 60% / 0.1)",
              border: "1px solid hsl(217 91% 60% / 0.22)",
            }}
          >
            <Smartphone className="w-4 h-4" style={{ color: "hsl(217 91% 65%)" }} />
          </div>
          <div>
            <p className="text-[12px] font-semibold" style={{ color: "hsl(var(--foreground) / 0.85)" }}>
              Install on iPhone / iPad
            </p>
            <p className="text-[9.5px] font-mono mt-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
              Add to Home Screen for native app experience
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 py-4 space-y-3">
          {[
            {
              icon: Share,
              step: "1",
              text: 'Tap the Share button at the bottom of Safari',
            },
            {
              icon: Plus,
              step: "2",
              text: 'Scroll down and tap "Add to Home Screen"',
            },
            {
              icon: CheckCircle2,
              step: "3",
              text: 'Tap "Add" — RobinOS Admin will appear on your home screen',
            },
          ].map(({ icon: Icon, step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: "hsl(217 91% 60% / 0.08)",
                  border: "1px solid hsl(217 91% 60% / 0.18)",
                }}
              >
                <span
                  className="text-[9px] font-mono font-bold"
                  style={{ color: "hsl(217 91% 65%)" }}
                >
                  {step}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--muted-foreground) / 0.55)" }}>
                {text}
              </p>
            </div>
          ))}
        </div>

        {/* Features */}
        <div
          className="px-5 py-3 flex flex-wrap gap-3"
          style={{ borderTop: "1px solid hsl(217 28% 11%)" }}
        >
          {[
            { icon: Zap, label: "Instant launch" },
            { icon: Shield, label: "Secure session" },
            { icon: Wifi, label: "Offline shell" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <Icon className="w-3 h-3" style={{ color: "hsl(217 91% 60% / 0.5)" }} />
              <span className="text-[9.5px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  // ── Available: show install prompt ────────────────────
  if (installState === "available" || installState === "installing") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden relative"
        style={{
          background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 40% 11%) 50%, hsl(222 28% 8%) 100%)",
          border: "1px solid hsl(217 30% 16%)",
          boxShadow: "0 8px 40px hsl(217 91% 60% / 0.06)",
        }}
      >
        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 90% 50%, hsl(217 91% 60% / 0.05), transparent)",
          }}
        />

        {/* Header */}
        <div
          className="relative px-5 py-4 flex items-center justify-between gap-3"
          style={{ borderBottom: "1px solid hsl(217 28% 12%)" }}
        >
          <div className="flex items-center gap-3">
            <motion.div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "hsl(217 91% 60% / 0.1)",
                border: "1px solid hsl(217 91% 60% / 0.25)",
              }}
              animate={{
                boxShadow: [
                  "0 0 0 hsl(217 91% 60% / 0)",
                  "0 0 20px hsl(217 91% 60% / 0.18)",
                  "0 0 0 hsl(217 91% 60% / 0)",
                ],
              }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Download className="w-4.5 h-4.5" style={{ color: "hsl(217 91% 65%)" }} />
            </motion.div>
            <div>
              <p className="text-[12.5px] font-semibold" style={{ color: "hsl(var(--foreground) / 0.88)" }}>
                Install RobinOS Admin
              </p>
              <p className="text-[9.5px] font-mono mt-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
                Native app experience · No browser chrome
              </p>
            </div>
          </div>

          <button
            onClick={dismissInstall}
            className="text-[9px] font-mono transition-colors"
            style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(var(--muted-foreground) / 0.5)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(var(--muted-foreground) / 0.25)"; }}
          >
            dismiss
          </button>
        </div>

        {/* Feature pills */}
        <div className="relative px-5 py-3 flex flex-wrap gap-2">
          {[
            { icon: Zap,     label: "Instant launch" },
            { icon: Monitor, label: "Fullscreen" },
            { icon: Shield,  label: "Secure 2FA" },
            { icon: Wifi,    label: "Offline shell" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1"
              style={{
                background: "hsl(217 91% 60% / 0.06)",
                border: "1px solid hsl(217 91% 60% / 0.14)",
              }}
            >
              <Icon className="w-3 h-3" style={{ color: "hsl(217 91% 60% / 0.6)" }} />
              <span className="text-[9.5px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div
          className="relative px-5 pb-5"
        >
          <motion.button
            onClick={triggerInstall}
            disabled={installState === "installing"}
            className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 80% 44%))",
              color: "#fff",
              boxShadow: "0 4px 20px hsl(217 91% 60% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.1)",
            }}
            whileHover={{ y: -1, boxShadow: "0 6px 28px hsl(217 91% 60% / 0.32)" }}
            whileTap={{ y: 0 }}
          >
            <Download className="w-4 h-4" />
            {installState === "installing" ? "Installing…" : "Install App"}
          </motion.button>
          <p className="text-center text-[9px] font-mono mt-2.5" style={{ color: "hsl(var(--muted-foreground) / 0.22)" }}>
            Works on Android · Chrome · Edge · Desktop
          </p>
        </div>
      </motion.div>
    );
  }

  // ── Idle / unsupported: show passive info card ─────────
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-3"
      style={{
        background: "hsl(222 28% 6%)",
        border: "1px solid hsl(217 28% 11%)",
      }}
    >
      <Monitor className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }} />
      <div>
        <p className="text-[11px] font-medium" style={{ color: "hsl(var(--foreground) / 0.55)" }}>
          Admin PWA
        </p>
        <p className="text-[9.5px] font-mono mt-0.5 leading-relaxed" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>
          {swRegistered
            ? "Service worker active · Open in Chrome or Edge to install as a native app"
            : "Open in Chrome, Edge, or Safari on iOS to install as a native app"}
        </p>
      </div>
    </div>
  );
}
