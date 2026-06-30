import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// WarriorPlus CTA — shared styled button used on /warriorplus.
//
// Behavior:
//   • default (no `scrollToId`) → opens the official WarriorPlus checkout
//     hoplink in the same tab. Single source of truth — update here only.
//   • `scrollToId` provided     → smoothly scrolls to the element with that
//     id on the page instead of opening checkout. Used for CTAs that must
//     NOT open checkout directly (e.g. Hero CTA, Final CTA) per WarriorPlus
//     compliance — the only checkout option on the page is the official
//     Buy Button image inserted into the pricing card.
//
// Visual styling, animations and hover effects are intentionally identical
// across both modes so the page chrome is preserved.
// ─────────────────────────────────────────────────────────────────────────
const WARRIORPLUS_CHECKOUT_URL = "https://warriorplus.com/o2/buy/k03rn0/qg7sz4/d144t7";

export interface WarriorPlusCTAProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary";
  size?: "default" | "sm";
  fullWidth?: boolean;
  /**
   * When provided, the button smoothly scrolls to the element with this id
   * instead of opening the WarriorPlus checkout. Used for compliance — the
   * only direct checkout on /warriorplus is the official Buy Button image
   * in the pricing card.
   */
  scrollToId?: string;
}

export function WarriorPlusCTA({
  children,
  className,
  variant = "primary",
  size = "default",
  fullWidth = false,
  scrollToId,
}: WarriorPlusCTAProps) {
  const isPrimary = variant === "primary";

  const handleClick = () => {
    if (scrollToId) {
      const target = document.getElementById(scrollToId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.location.href = WARRIORPLUS_CHECKOUT_URL;
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn("inline-block", fullWidth && "w-full")}
    >
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all duration-300 relative overflow-hidden group",
          size === "default" && "h-12 px-8",
          size === "sm" && "h-10 px-5 text-xs",
          fullWidth && "w-full",
          // WarriorPlus accent: warm amber/copper — distinct from JVZoo's blue.
          isPrimary &&
            "bg-gradient-to-br from-[hsl(28,92%,52%)] to-[hsl(18,85%,44%)] shadow-[0_4px_24px_hsl(28,92%,55%,0.4),inset_0_1px_0_hsl(0,0%,100%,0.1)]",
          className,
        )}
      >
        {isPrimary && (
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background:
                "linear-gradient(135deg, hsl(28 92% 58%), hsl(18 85% 50%))",
            }}
          />
        )}
        <span className="relative flex items-center gap-2">{children}</span>
      </button>
    </motion.div>
  );
}
