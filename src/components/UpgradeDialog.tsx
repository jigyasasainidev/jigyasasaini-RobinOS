import { ErrorBoundary } from "react-error-boundary";
import { motion } from "framer-motion";
import { Sparkles, Check, AlertTriangle, TrendingUp, PenTool, Mic, Film, Hash, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCurrency } from "@/hooks/useCurrency";
import { getPlans, getCurrencySymbol } from "@/lib/pricing";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  forced?: boolean;
}

// ── Capability highlights shown in the dialog ──────────────
const CAPABILITIES = [
  { icon: TrendingUp, label: "Unlimited trend scans",          plan: "creator"     },
  { icon: PenTool,    label: "100 scripts/day",                plan: "creator"     },
  { icon: Hash,       label: "Trending audio & hashtags",      plan: "creator"     },
  { icon: Mic,        label: "Voice Studio (BYOK)",            plan: "pro_creator" },
  { icon: Film,       label: "Video Studio (BYOK)",            plan: "pro_creator" },
  { icon: Zap,        label: "Realtime trend intelligence",    plan: "pro_creator" },
];

const UpgradeDialogFallback = ({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) => (
  <Dialog open={true} onOpenChange={onOpenChange}>
    <DialogContent className="bg-card border-border max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-foreground">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          Unable to Load Plans
        </DialogTitle>
        <DialogDescription className="text-muted-foreground">
          Please try again later. If the issue persists, contact support.
        </DialogDescription>
      </DialogHeader>
      <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
        onClick={() => onOpenChange?.(false)}
        className="mt-4 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
        Close
      </motion.button>
    </DialogContent>
  </Dialog>
);

const UpgradeDialogInner = ({ onOpenChange, forced, open }: UpgradeDialogProps) => {
  const navigate = useNavigate();
  const { currency } = useCurrency();
  const { data: platformSettings } = usePlatformSettings();

  const safeCurrency = currency ?? "USD";
  const safeSettings = platformSettings ?? null;

  const plans = getPlans(safeCurrency, {
    creator_price: safeSettings?.creator_price,
    pro_price:     safeSettings?.pro_price,
    agency_price:  safeSettings?.agency_price,
  });
  const symbol = getCurrencySymbol(safeCurrency);

  const dialogPlans = (plans ?? []).slice(0, 3).map((plan) => {
    if (!plan) return null;
    const isAgency  = !!plan.isAgency;
    const isPro     = plan.tier === "pro_creator";
    const isPopular = !!plan.popular;
    return {
      name:     plan.name ?? "Plan",
      price:    `${symbol}${(plan.monthlyPrice ?? 0).toLocaleString()}`,
      tier:     plan.tier ?? "free",
      badge:    plan.badge,
      features: (plan.features ?? []).slice(0, 3),
      isAgency, isPro, isPopular,
    };
  }).filter(Boolean) as NonNullable<ReturnType<typeof dialogPlans[0]>>[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden"
        style={{
          background: "linear-gradient(160deg, hsl(222 28% 8%) 0%, hsl(222 26% 6%) 100%)",
          border: "1px solid hsl(217 28% 14%)",
          boxShadow: "0 0 80px hsl(217 91% 60% / 0.08), 0 24px 64px hsl(0 0% 0% / 0.5)",
        }}
        onPointerDownOutside={forced ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={forced ? (e) => e.preventDefault() : undefined}
      >
        {/* Top ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-20 pointer-events-none"
          style={{ background: "radial-gradient(ellipse, hsl(217 91% 60% / 0.1) 0%, transparent 70%)" }} />

        <div className="relative p-6">
          <DialogHeader className="mb-5">
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <motion.div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)" }}
                animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 24px hsl(217 91% 60% / 0.2)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <Sparkles className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </motion.div>
            </div>

            <DialogTitle className="text-center text-foreground/90 text-base font-semibold">
              {forced
                ? "Your free access has ended"
                : "Unlock deeper creator intelligence"}
            </DialogTitle>
            <DialogDescription className="text-center text-muted-foreground/55 text-xs mt-1 leading-relaxed">
              {forced
                ? "Choose a plan to continue building with RobinOS."
                : "Advanced AI workflows, realtime trend intelligence, and creator tools — all in one OS."}
            </DialogDescription>
          </DialogHeader>

          {/* Capability chips */}
          <div className="flex flex-wrap gap-1.5 justify-center mb-5">
            {CAPABILITIES.slice(0, 4).map(({ icon: Icon, label }) => (
              <span key={label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9.5px] font-mono"
                style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 65%)" }}>
                <Icon className="w-3 h-3" strokeWidth={1.5} />{label}
              </span>
            ))}
          </div>

          {/* Plan cards */}
          <div className="space-y-2 mb-5">
            {dialogPlans.map((plan) => (
              <div key={plan.name}
                className="rounded-xl p-3.5 flex items-center justify-between gap-3"
                style={plan.isPro || plan.isPopular ? {
                  background: "hsl(217 91% 60% / 0.07)",
                  border: "1px solid hsl(217 91% 60% / 0.25)",
                } : plan.isAgency ? {
                  background: "hsl(48 90% 55% / 0.06)",
                  border: "1px solid hsl(48 90% 55% / 0.22)",
                } : {
                  background: "hsl(222 28% 7%)",
                  border: "1px solid hsl(217 28% 12%)",
                }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground/88">{plan.name}</span>
                    {plan.badge && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                        style={plan.isAgency
                          ? { background: "hsl(48 90% 55% / 0.12)", color: "hsl(48 90% 62%)", border: "1px solid hsl(48 90% 55% / 0.25)" }
                          : { background: "hsl(217 91% 60% / 0.12)", color: "hsl(217 91% 68%)", border: "1px solid hsl(217 91% 60% / 0.25)" }}>
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {plan.features.map((f) => (
                      <span key={f} className="text-[10px] text-muted-foreground/45 flex items-center gap-1">
                        <Check className="w-2.5 h-2.5 text-primary/50 shrink-0" />{f}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-foreground/80">{plan.price}</p>
                  <p className="text-[9px] text-muted-foreground/35 font-mono">/month</p>
                </div>
              </div>
            ))}
          </div>

          {/* Primary CTA */}
          <motion.button
            whileHover={{ scale: 1.01, boxShadow: "0 8px 32px hsl(217 91% 60% / 0.28)" }}
            whileTap={{ scale: 0.99 }}
            onClick={() => { onOpenChange?.(false); navigate("/dashboard/settings"); }}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 52%) 0%, hsl(217 91% 62%) 100%)",
              color: "#fff",
              boxShadow: "0 4px 20px hsl(217 91% 60% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
            }}
          >
            <Sparkles className="w-4 h-4" />
            View Plans & Upgrade
          </motion.button>

          {!forced && (
            <button onClick={() => onOpenChange?.(false)}
              className="w-full mt-2 py-2 text-[10.5px] text-muted-foreground/35 hover:text-muted-foreground/55 transition-colors">
              Continue with current plan
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const UpgradeDialog = (props: UpgradeDialogProps) => (
  <ErrorBoundary
    fallback={<UpgradeDialogFallback onOpenChange={props.onOpenChange} />}
    onError={(error) => { if (import.meta.env.DEV) console.error("[UpgradeDialog]", error); }}
  >
    <UpgradeDialogInner {...props} />
  </ErrorBoundary>
);
