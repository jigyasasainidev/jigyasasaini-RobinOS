import { ErrorBoundary } from "react-error-boundary";
import { motion } from "framer-motion";
import { Crown, Check, Zap, AlertTriangle } from "lucide-react";
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
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => onOpenChange?.(false)}
        className="mt-4 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
      >
        Close
      </motion.button>
    </DialogContent>
  </Dialog>
);

const UpgradeDialogInner = ({ onOpenChange, forced, open }: UpgradeDialogProps) => {
  const navigate = useNavigate();
  const { currency } = useCurrency();
  const { data: platformSettings } = usePlatformSettings();

  // Defensive: safe defaults for all data dependencies
  const safeCurrency = currency ?? "USD";
  const safeSettings = platformSettings ?? null;

  const plans = getPlans(safeCurrency, {
    creator_price: safeSettings?.creator_price,
    pro_price: safeSettings?.pro_price,
    agency_price: safeSettings?.agency_price,
  });
  const symbol = getCurrencySymbol(safeCurrency);

  const dialogPlans = (plans ?? []).slice(0, 3).map((plan) => {
    // Defensive: safe optional chaining on every property
    const p = plan;
    if (!p) {
      return {
        name: "Plan",
        price: `${symbol}0`,
        tier: "free",
        badge: undefined,
        features: [] as string[],
        borderClass: "border-border",
        bgClass: "bg-card/50",
        checkClass: "text-primary",
      };
    }

    const colors = p.isAgency
      ? { borderClass: "border-amber-500/30" as const, bgClass: "bg-amber-500/5" as const, checkClass: "text-amber-400" as const }
      : p.popular
        ? { borderClass: "border-primary/30" as const, bgClass: "bg-primary/5" as const, checkClass: "text-primary" as const }
        : { borderClass: "border-border" as const, bgClass: "bg-card/50" as const, checkClass: "text-primary" as const };

    return {
      name: p.name ?? "Plan",
      price: `${symbol}${(p.monthlyPrice ?? 0).toLocaleString()}`,
      tier: p.tier ?? "free",
      badge: p.badge,
      features: (p.features ?? []).slice(0, 4),
      ...colors,
    };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-card border-border max-w-lg"
        onPointerDownOutside={forced ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={forced ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Crown className="w-5 h-5 text-primary" />
            {forced ? "Your Free Trial Has Ended" : "Upgrade Your Plan"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {forced
              ? "Your current access has ended. Choose a plan to continue in RobinOS."
              : "Unlock more features and remove limits by upgrading your plan."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-3">
          {dialogPlans.map((plan) => (
            <div key={plan.name} className={`rounded-lg border ${plan.borderClass} ${plan.bgClass} p-4`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-semibold text-foreground">{plan.name} — {plan.price}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </div>
                {plan.badge && (
                  <span className={`text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-full ${
                    plan.badge === "PREMIUM" ? "bg-amber-500/20 text-amber-400" : "bg-primary/20 text-primary"
                  }`}>
                    {plan.badge}
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Check className={`w-3 h-3 shrink-0 ${plan.checkClass}`} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => {
            onOpenChange?.(false);
            navigate("/dashboard/settings");
          }}
          className="mt-4 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4" />
          Choose a Plan
        </motion.button>
      </DialogContent>
    </Dialog>
  );
};

export const UpgradeDialog = (props: UpgradeDialogProps) => {
  return (
    <ErrorBoundary
      fallback={<UpgradeDialogFallback onOpenChange={props.onOpenChange} />}
      onError={(error) => {
        if (import.meta.env.DEV) {
          console.error("[UpgradeDialog] Crash caught by ErrorBoundary:", error);
        }
      }}
    >
      <UpgradeDialogInner {...props} />
    </ErrorBoundary>
  );
};
