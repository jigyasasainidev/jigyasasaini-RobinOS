import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Temporary destination while the official JVZoo Buy Button is being prepared.
// When the real JVZoo button is ready, change only this constant and every
// JVZooCTA across the site will use the new destination automatically.
const JVZOO_CTA_DESTINATION = "/login";

export interface JVZooCTAProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary";
  size?: "default" | "sm";
  fullWidth?: boolean;
}

export function JVZooCTA({
  children,
  className,
  variant = "primary",
  size = "default",
  fullWidth = false,
}: JVZooCTAProps) {
  const isPrimary = variant === "primary";

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn("inline-block", fullWidth && "w-full")}
    >
      <Link
        to={JVZOO_CTA_DESTINATION}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all duration-300 relative overflow-hidden group",
          size === "default" && "h-12 px-8",
          size === "sm" && "h-10 px-5 text-xs",
          fullWidth && "w-full",
          isPrimary &&
            "bg-gradient-to-br from-[hsl(217,91%,52%)] to-[hsl(217,80%,44%)] shadow-[0_4px_24px_hsl(217,91%,60%,0.4),inset_0_1px_0_hsl(0,0%,100%,0.1)]",
          className,
        )}
      >
        {isPrimary && (
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background:
                "linear-gradient(135deg, hsl(217 91% 58%), hsl(217 80% 50%))",
            }}
          />
        )}
        <span className="relative flex items-center gap-2">{children}</span>
      </Link>
    </motion.div>
  );
}
