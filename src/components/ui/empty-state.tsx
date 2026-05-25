import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";

// ── Base EmptyState ────────────────────────────────────────
// Core building block — use directly or via named presets below.
interface EmptyStateProps {
  icon:        LucideIcon;
  iconColor?:  string;         // hsl string for icon + ambient glow
  label?:      string;         // eyebrow label (e.g. "Creator Intelligence")
  title:       string;
  description: string;
  primaryAction?: {
    label:   string;
    onClick: () => void;
  };
  secondaryAction?: {
    label:   string;
    onClick: () => void;
  };
  hint?: string;               // small helper text below actions
  className?: string;
}

export function EmptyState({
  icon: Icon,
  iconColor = "hsl(217 91% 60%)",
  label,
  title,
  description,
  primaryAction,
  secondaryAction,
  hint,
  className = "",
}: EmptyStateProps) {
  const glowBg  = iconColor.replace(")", " / 0.07)").replace("hsl(", "hsl(");
  const glowBdr = iconColor.replace(")", " / 0.18)").replace("hsl(", "hsl(");
  const glowAmb = iconColor.replace(")", " / 0.06)").replace("hsl(", "hsl(");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`relative flex flex-col items-center justify-center text-center px-6 py-14 rounded-2xl overflow-hidden ${className}`}
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)",
        border: "1px solid hsl(217 28% 12%)",
      }}
      aria-label={title}
    >
      {/* Ambient radial glow behind icon */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-40 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(ellipse, ${glowAmb} 0%, transparent 70%)` }}
        aria-hidden
      />

      {/* Icon */}
      <motion.div
        className="relative mb-5 flex items-center justify-center w-14 h-14 rounded-2xl"
        style={{ background: glowBg, border: `1px solid ${glowBdr}` }}
        animate={{
          boxShadow: [
            `0 0 0 ${iconColor.replace(")", " / 0")}`,
            `0 0 24px ${iconColor.replace(")", " / 0.12")}`,
            `0 0 0 ${iconColor.replace(")", " / 0")}`,
          ],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Icon className="w-6 h-6" style={{ color: iconColor }} strokeWidth={1.6} />
      </motion.div>

      {/* Label */}
      {label && (
        <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] mb-2"
          style={{ color: `${iconColor.replace(")", " / 0.55)")}` }}>
          {label}
        </p>
      )}

      {/* Title */}
      <h3 className="text-sm font-semibold text-foreground/85 mb-2 leading-snug max-w-[280px]">
        {title}
      </h3>

      {/* Description */}
      <p className="text-[11px] text-muted-foreground/50 leading-relaxed max-w-[300px] mb-6">
        {description}
      </p>

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {primaryAction && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={primaryAction.onClick}
              className="px-5 py-2.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: iconColor.replace(")", " / 0.12)"),
                border: `1px solid ${iconColor.replace(")", " / 0.28)")}`,
                color: iconColor,
                boxShadow: `0 4px 16px ${iconColor.replace(")", " / 0.1)")}`,
              }}
            >
              {primaryAction.label}
            </motion.button>
          )}
          {secondaryAction && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={secondaryAction.onClick}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)" }}
            >
              {secondaryAction.label}
            </motion.button>
          )}
        </div>
      )}

      {/* Hint */}
      {hint && (
        <p className="mt-4 text-[10px] font-mono text-muted-foreground/28">{hint}</p>
      )}
    </motion.div>
  );
}

// ── Inline empty state — for small containers (history sidebar, etc.) ──
interface InlineEmptyProps {
  icon:        LucideIcon;
  title:       string;
  action?: { label: string; onClick: () => void };
}

export function InlineEmpty({ icon: Icon, title, action }: InlineEmptyProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-10 gap-3 text-center"
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)" }}>
        <Icon className="w-4 h-4 text-primary/25" strokeWidth={1.5} />
      </div>
      <p className="text-xs text-muted-foreground/40 font-mono">{title}</p>
      {action && (
        <button onClick={action.onClick}
          className="text-[11px] font-mono text-primary/55 hover:text-primary transition-colors">
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
