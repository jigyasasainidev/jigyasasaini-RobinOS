import { motion } from "framer-motion";
import { Crown, Check, Zap } from "lucide-react";
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

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  forced?: boolean;
}

export const UpgradeDialog = ({ open, onOpenChange, forced = false }: UpgradeDialogProps) => {
  const navigate = useNavigate();
  const { currency } = useCurrency();
  const plans = getPlans(currency);
  const symbol = getCurrencySymbol(currency);

  const dialogPlans = plans.slice(0, 3).map((plan) => {
    const colors = plan.isAgency
      ? { borderClass: "border-amber-500/30", bgClass: "bg-amber-500/5", checkClass: "text-amber-400" }
      : plan.popular
        ? { borderClass: "border-primary/30", bgClass: "bg-primary/5", checkClass: "text-primary" }
        : { borderClass: "border-border", bgClass: "bg-card/50", checkClass: "text-primary" };

    return {
      name: plan.name,
      price: `${symbol}${plan.monthlyPrice.toLocaleString()}`,
      tier: plan.tier,
      badge: plan.badge,
      features: plan.features.slice(0, 4),
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
            if (onOpenChange) onOpenChange(false);
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
