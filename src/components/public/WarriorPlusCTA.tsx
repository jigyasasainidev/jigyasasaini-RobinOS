import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — REPLACE AFTER WARRIORPLUS MARKETPLACE APPROVAL
// ─────────────────────────────────────────────────────────────────────────
// Once the RobinOS product is approved on the WarriorPlus marketplace, the
// official WarriorPlus checkout URL (or hoplink) must be inserted in place
// of the value below. The same string is used everywhere WarriorPlusCTA
// is rendered on /warriorplus, so changing it here is sufficient.
//
// Today the button points to https://tryrobin.xyz/warriorplus (the
// sales-page URL itself) so visitors can still preview the page without
// being bounced by a broken external link.
// ─────────────────────────────────────────────────────────────────────────
const WARRIORPLUS_CTA_DESTINATION = "https://tryrobin.xyz/warriorplus";

export interface WarriorPlusCTAProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary";
  size?: "default" | "sm";
  fullWidth?: boolean;
}

export function WarriorPlusCTA({
  children,
  className,
  variant = "primary",
  size = "default",
  fullWidth = false,
}: WarriorPlusCTAProps) {
  const isPrimary = variant === "primary";

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn("inline-block", fullWidth && "w-full")}
    >
      <Link
        to={WARRIORPLUS_CTA_DESTINATION}
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
      </Link>
    </motion.div>
  );
}
