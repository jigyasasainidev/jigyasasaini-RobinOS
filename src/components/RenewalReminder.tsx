// ============================================================
// RenewalReminder — cinematic subscription renewal reminder
// ============================================================
// Shows as:
//   - Subtle banner (7 days): dismissible, non-intrusive
//   - Popup modal (3 days, 1 day, grace): glassmorphism, urgent
//
// Rules:
//   - Never shows for admin-granted plans
//   - Respects 24h dismissal (backend-synced)
//   - Never interrupts active generation
//   - Reappears after dismissal window expires
// ============================================================

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Clock, Sparkles, X, RefreshCw,
  Shield, Zap, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSubscriptionStatus, useDismissExpiryPopup } from "@/hooks/useSubscriptionLifecycle";
import { getTierDisplayName } from "@/lib/pricing";
import type { ReminderUrgency } from "@/hooks/useSubscriptionLifecycle";

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
        <button onClick={onDismiss} className="opacity-40 hover:opacity-70 transition-opacity">
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(12px)", background: "hsl(222 30% 4% / 0.7)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, hsl(222 32% 9%) 0%, hsl(222 28% 7%) 100%)",
          border: `1px solid ${colors.border}`,
          boxShadow: `0 0 60px ${colors.bg}, 0 24px 64px hsl(0 0% 0% / 0.5)`,
        }}
      >
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: `radial-gradient(ellipse 60% 40% at 50% 0%, ${colors.bg}, transparent)` }} />

        {/* Header */}
        <div className="relative px-5 pt-5 pb-4" style={{ borderBottom: `1px solid hsl(217 28% 11%)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <motion.div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
                animate={{ boxShadow: [`0 0 0 ${colors.bg}`, `0 0 20px ${colors.bg}`, `0 0 0 ${colors.bg}`] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              >
                {inGrace
                  ? <AlertTriangle className="w-4.5 h-4.5" style={{ color: colors.text }} />
                  : <Clock className="w-4.5 h-4.5" style={{ color: colors.text }} />
                }
              </motion.div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em]"
                    style={{ color: colors.text }}>
                    {urgencyLabel(urgency, daysRemaining, inGrace)}
                  </span>
                </div>
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground) / 0.88)" }}>
                  {inGrace ? "Grace Period Ending Soon" : "Renew Your Subscription"}
                </p>
              </div>
            </div>
            <button onClick={onDismiss}
              className="opacity-30 hover:opacity-60 transition-opacity mt-0.5">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative px-5 py-4 space-y-4">
          {/* Countdown */}
          <div className="rounded-xl px-4 py-3 text-center"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] mb-1"
              style={{ color: `${colors.text}80` }}>
              {inGrace ? "Grace period ends" : "Plan expires"}
            </p>
            <p className="text-lg font-bold" style={{ color: colors.text }}>
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
        <div className="relative px-5 pb-5 space-y-2.5">
          <motion.button
            whileHover={{ y: -1, boxShadow: `0 8px 28px ${colors.bg}` }}
            whileTap={{ y: 0 }}
            onClick={onRenew}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            style={{
              background: `linear-gradient(135deg, hsl(217 91% 52%), hsl(217 91% 62%))`,
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
  const { data: status, isLoading } = useSubscriptionStatus();
  const dismiss = useDismissExpiryPopup();
  const [dismissed, setDismissed] = useState(false);

  // Reset local dismissed state when reminder_dismissed_until changes
  useEffect(() => { setDismissed(false); }, [status?.reminder_dismissed_until]);

  if (isLoading || !status || dismissed) return null;
  if (!status.show_reminder) return null;
  if (status.granted_by_admin) return null;

  const handleDismiss = async () => {
    setDismissed(true);  // instant local hide
    await dismiss();     // sync to backend
  };

  const handleRenew = () => {
    navigate("/dashboard/settings");
  };

  const showPopup = status.reminder_urgency !== "low";

  return (
    <AnimatePresence>
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
// Renders a subtle top banner for 7-day warning.
// Import and place inside DashboardLayout above the main content.

export function RenewalBannerInline() {
  const navigate = useNavigate();
  const { data: status, isLoading } = useSubscriptionStatus();
  const dismiss = useDismissExpiryPopup();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(false); }, [status?.reminder_dismissed_until]);

  if (isLoading || !status || dismissed) return null;
  if (!status.show_reminder) return null;
  if (status.reminder_urgency !== "low") return null; // popup handles higher urgency
  if (status.granted_by_admin) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await dismiss();
  };

  return (
    <AnimatePresence>
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
