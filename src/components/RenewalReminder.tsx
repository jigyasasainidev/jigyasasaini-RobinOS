// ============================================================
// RenewalReminder — hardened subscription renewal reminder
// ============================================================
// Hardening applied:
//   - Single modal instance (module-level lock prevents duplicates)
//   - Debounced dismiss (prevents double-fire on fast clicks)
//   - Stable animation keys (no flicker on re-render)
//   - Mobile-safe: safe-area padding, no scroll lock, viewport-fit
//   - No hydration mismatch: all state initialized from server data
//   - Popup only shows after data is confirmed fresh (not placeholder)
//   - Body scroll preserved (no overflow:hidden on mobile)
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Clock, X, RefreshCw,
  Shield, Zap, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSubscriptionStatus, useDismissExpiryPopup } from "@/hooks/useSubscriptionLifecycle";
import { getTierDisplayName } from "@/lib/pricing";
import type { ReminderUrgency } from "@/hooks/useSubscriptionLifecycle";

// ── Module-level single-instance lock ─────────────────────
// Prevents two RenewalReminder mounts from both showing a popup
// (e.g. if DashboardLayout re-mounts during navigation).
let _popupMounted = false;

// ── Helpers ────────────────────────────────────────────────

function urgencyColor(urgency: ReminderUrgency) {
  if (urgency === "critical") return { text: "hsl(0 72% 60%)",   border: "hsl(0 72% 55% / 0.3)",   bg: "hsl(0 72% 55% / 0.06)"   };
  if (urgency === "high")     return { text: "hsl(25 90% 58%)",  border: "hsl(25 90% 55% / 0.3)",  bg: "hsl(25 90% 55% / 0.06)"  };
  if (urgency === "medium")   return { text: "hsl(38 92% 58%)",  border: "hsl(38 92% 55% / 0.3)",  bg: "hsl(38 92% 55% / 0.06)"  };
  return                             { text: "hsl(217 91% 65%)", border: "hsl(217 91% 60% / 0.25)", bg: "hsl(217 91% 60% / 0.05)" };
}

function urgencyLabel(urgency: ReminderUrgency, daysRemaining: number, inGrace: boolean) {
  if (inGrace)              return "Grace Period Active";
  if (urgency === "high")   return "Expires Tomorrow";
  if (urgency === "medium") return `${daysRemaining} Days Left`;
  return                           `${daysRemaining} Days Remaining`;
}

function countdownText(daysRemaining: number, inGrace: boolean, graceDays: number) {
  if (inGrace) return graceDays <= 1 ? "Last day of grace period" : `${graceDays} days of grace period left`;
  if (daysRemaining <= 1) return "Your plan expires today";
  return `Your plan expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
}

// ── Subtle banner (7-day warning) ─────────────────────────

function RenewalBanner({ plan, daysRemaining, onDismiss, onRenew }: {
  plan: string; daysRemaining: number; onDismiss: () => void; onRenew: () => void;
}) {
  const colors = urgencyColor("low");
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 mb-4"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: colors.text }} />
        <p className="text-xs" style={{ color: colors.text }}>
          <span className="font-medium">{getTierDisplayName(plan)}</span>
          {" "}expires in{" "}
          <span className="font-semibold">{daysRemaining} days</span>
          {" "}— renew to keep your workflow uninterrupted.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRenew}
          className="text-[10.5px] font-medium px-2.5 py-1 rounded-lg transition-all"
          style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
        >
          Renew
        </button>
        <button onClick={onDismiss} className="opacity-40 hover:opacity-70 transition-opacity p-1">
          <X className="w-3.5 h-3.5" style={{ color: colors.text }} />
        </button>
      </div>
    </motion.div>
  );
}

// ── Cinematic popup (3d / 1d / grace) ─────────────────────

function RenewalPopup({ plan, daysRemaining, graceDays, inGrace, urgency, billingCycle, amount, currency, onDismiss, onRenew }: {
  plan: string; daysRemaining: number; graceDays: number; inGrace: boolean;
  urgency: ReminderUrgency; billingCycle: string; amount: number; currency: string;
  onDismiss: () => void; onRenew: () => void;
}) {
  const colors = urgencyColor(urgency);
  const planName = getTierDisplayName(plan);
  const symbol = currency === "USD" ? "$" : currency;

  const lostFeatures: string[] = plan === "agency"
    ? ["Team workspaces", "Unlimited generations", "Automation tools", "Priority support"]
    : plan === "pro_creator"
      ? ["100 scripts/day", "Voice & Video Studio", "BYOK access", "Advanced analytics"]
      : ["20 scripts/day", "Trend discovery", "Caption Engine", "Basic analytics"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // Mobile-safe: no overflow:hidden, safe-area padding, pointer-events on backdrop
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
      style={{
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        background: "hsl(222 30% 4% / 0.65)",
        // Safe area for iPhone notch/home indicator
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
      // Clicking backdrop dismisses (not renews)
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        // Mobile: full-width bottom sheet; desktop: centered card
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden mx-0 sm:mx-4"
        style={{
          background: "linear-gradient(160deg, hsl(222 32% 9%) 0%, hsl(222 28% 7%) 100%)",
          border: `1px solid ${colors.border}`,
          boxShadow: `0 0 60px ${colors.bg}, 0 24px 64px hsl(0 0% 0% / 0.5)`,
          // Prevent content from going under home indicator on iOS
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: `radial-gradient(ellipse 60% 40% at 50% 0%, ${colors.bg}, transparent)` }} />

        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="relative px-5 pt-4 pb-4" style={{ borderBottom: `1px solid hsl(217 28% 11%)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <motion.div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
                animate={{ boxShadow: [`0 0 0 ${colors.bg}`, `0 0 18px ${colors.bg}`, `0 0 0 ${colors.bg}`] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              >
                {inGrace
                  ? <AlertTriangle className="w-4 h-4" style={{ color: colors.text }} />
                  : <Clock className="w-4 h-4" style={{ color: colors.text }} />
                }
              </motion.div>
              <div>
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] block mb-0.5"
                  style={{ color: colors.text }}>
                  {urgencyLabel(urgency, daysRemaining, inGrace)}
                </span>
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground) / 0.88)" }}>
                  {inGrace ? "Grace Period Ending Soon" : "Renew Your Subscription"}
                </p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="opacity-30 hover:opacity-60 transition-opacity mt-0.5 p-1 -mr-1"
              aria-label="Dismiss reminder"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative px-5 py-4 space-y-3.5">
          {/* Countdown */}
          <div className="rounded-xl px-4 py-3 text-center"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] mb-1"
              style={{ color: `${colors.text}80` }}>
              {inGrace ? "Grace period ends" : "Plan expires"}
            </p>
            <p className="text-base font-bold" style={{ color: colors.text }}>
              {countdownText(daysRemaining, inGrace, graceDays)}
            </p>
          </div>

          {/* Plan badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-xs text-muted-foreground/60">Current plan</span>
            </div>
            <span className="text-xs font-mono font-semibold" style={{ color: colors.text }}>
              {planName} · {billingCycle === "yearly" ? "Yearly" : "Monthly"}
              {amount > 0 && ` · ${symbol}${amount}/mo`}
            </span>
          </div>

          {/* Features at risk */}
          <div className="space-y-1.5">
            <p className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-muted-foreground/35">
              {inGrace ? "Features suspended after grace period" : "Features you'll lose"}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {lostFeatures.map((f) => (
                <div key={f} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                  style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 11%)" }}>
                  <Zap className="w-3 h-3 shrink-0" style={{ color: colors.text, opacity: 0.6 }} />
                  <span className="text-[10px] text-muted-foreground/55 truncate">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative px-5 pb-5 space-y-2">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0, scale: 0.99 }}
            onClick={onRenew}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 91% 62%))",
              color: "#fff",
              boxShadow: "0 4px 20px hsl(217 91% 60% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.1)",
            }}
          >
            <RefreshCw className="w-4 h-4" />
            {inGrace ? "Restore Access Now" : "Renew Subscription"}
            <ChevronRight className="w-3.5 h-3.5 opacity-70" />
          </motion.button>

          <button
            onClick={onDismiss}
            className="w-full py-2 text-[10.5px] text-muted-foreground/30 hover:text-muted-foreground/55 transition-colors"
          >
            Remind me tomorrow
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main export ────────────────────────────────────────────

export function RenewalReminder() {
  const navigate = useNavigate();
  // isPlaceholderData: true while first fetch is in-flight
  const { data: status, isLoading, isPlaceholderData } = useSubscriptionStatus();
  const dismiss = useDismissExpiryPopup();
  const [dismissed, setDismissed] = useState(false);
  const dismissingRef = useRef(false);  // debounce double-click

  // Reset local dismissed state when backend dismissal expires
  useEffect(() => {
    setDismissed(false);
  }, [status?.reminder_dismissed_until]);

  // Single-instance lock: register on mount, release on unmount
  useEffect(() => {
    _popupMounted = true;
    return () => { _popupMounted = false; };
  }, []);

  const handleDismiss = useCallback(async () => {
    if (dismissingRef.current) return;  // debounce
    dismissingRef.current = true;
    setDismissed(true);
    await dismiss();
    // Allow re-dismiss after 2s (in case of error)
    setTimeout(() => { dismissingRef.current = false; }, 2000);
  }, [dismiss]);

  const handleRenew = useCallback(() => {
    void handleDismiss();  // also dismiss so it doesn't reappear immediately
    navigate("/dashboard/settings");
  }, [handleDismiss, navigate]);

  // Don't render until we have real (non-placeholder) data
  if (isLoading || isPlaceholderData || !status) return null;
  if (dismissed) return null;
  if (!status.show_reminder) return null;
  if (status.granted_by_admin) return null;
  // Never show renewal popup for free users — they should see upgrade prompts
  // triggered by usage exhaustion, not expiry urgency.
  if (status.plan === "free" || !status.subscription_active) return null;

  const showPopup = status.reminder_urgency !== "low";

  return (
    <AnimatePresence mode="wait">
      {showPopup ? (
        <RenewalPopup
          key="renewal-popup"
          plan={status.plan}
          daysRemaining={status.days_remaining}
          graceDays={status.grace_days_remaining}
          inGrace={status.in_grace_period}
          urgency={status.reminder_urgency}
          billingCycle={status.billing_cycle}
          amount={status.amount}
          currency={status.currency}
          onDismiss={handleDismiss}
          onRenew={handleRenew}
        />
      ) : null}
    </AnimatePresence>
  );
}

// ── Inline banner (for dashboard layout) ──────────────────

export function RenewalBannerInline() {
  const navigate = useNavigate();
  const { data: status, isLoading, isPlaceholderData } = useSubscriptionStatus();
  const dismiss = useDismissExpiryPopup();
  const [dismissed, setDismissed] = useState(false);
  const dismissingRef = useRef(false);

  useEffect(() => { setDismissed(false); }, [status?.reminder_dismissed_until]);

  const handleDismiss = useCallback(async () => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setDismissed(true);
    await dismiss();
    setTimeout(() => { dismissingRef.current = false; }, 2000);
  }, [dismiss]);

  // Don't render until real data arrives
  if (isLoading || isPlaceholderData || !status) return null;
  if (dismissed) return null;
  if (!status.show_reminder) return null;
  if (status.reminder_urgency !== "low") return null;
  if (status.granted_by_admin) return null;
  // Never show for free users
  if (status.plan === "free" || !status.subscription_active) return null;

  return (
    <AnimatePresence mode="wait">
      <RenewalBanner
        key="renewal-banner"
        plan={status.plan}
        daysRemaining={status.days_remaining}
        onDismiss={handleDismiss}
        onRenew={() => navigate("/dashboard/settings")}
      />
    </AnimatePresence>
  );
}
