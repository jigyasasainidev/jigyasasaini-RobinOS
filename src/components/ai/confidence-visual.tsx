import { memo } from "react";
import { motion } from "framer-motion";

// ============================================================
// ROBINOS CONFIDENCE VISUAL — Heat/signal strength indicator
//
// Renders a compact animated confidence bar for trend cards.
// Maps the 0-100 heat score to a visual signal strength display.
//
// Usage:
//   <ConfidenceBar heat={87} />
//   <ConfidenceBar heat={72} label="Signal Strength" />
// ============================================================

interface ConfidenceBarProps {
  heat:      number;   // 0–100
  label?:    string;
  compact?:  boolean;  // single-line variant
  className?: string;
}

// Color tiers matching the heat score
function heatColor(heat: number): { bar: string; text: string; label: string } {
  if (heat >= 90) return { bar: "hsl(0 80% 60%)",    text: "hsl(0 80% 68%)",    label: "Exploding"  };
  if (heat >= 80) return { bar: "hsl(38 90% 55%)",   text: "hsl(38 90% 62%)",   label: "High Signal" };
  if (heat >= 70) return { bar: "hsl(217 91% 60%)",  text: "hsl(217 91% 68%)",  label: "Rising"     };
  if (heat >= 60) return { bar: "hsl(142 65% 50%)",  text: "hsl(142 65% 58%)",  label: "Emerging"   };
  return              { bar: "hsl(215 16% 45%)",  text: "hsl(215 16% 52%)",  label: "Stable"     };
}

export const ConfidenceBar = memo(({ heat, label, compact = false, className = "" }: ConfidenceBarProps) => {
  const pct   = Math.min(100, Math.max(0, heat));
  const cfg   = heatColor(pct);
  const tiers = [20, 40, 60, 80, 100]; // 5 segment thresholds

  if (compact) {
    // Single-line: 5 segment dots + score
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="flex gap-0.5">
          {tiers.map((t, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              style={{
                width: 5, height: 5,
                background: pct >= t ? cfg.bar : "hsl(217 28% 12%)",
              }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.06, duration: 0.25 }}
            />
          ))}
        </div>
        <span className="text-[9px] font-mono" style={{ color: cfg.text, fontVariantNumeric: "tabular-nums" }}>
          {pct}
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-[0.15em]"
          style={{ color: "hsl(215 16% 35%)" }}>
          {label ?? "Signal Confidence"}
        </span>
        <span className="text-[9px] font-mono" style={{ color: cfg.text, fontVariantNumeric: "tabular-nums" }}>
          {cfg.label} · {pct}
        </span>
      </div>

      {/* Bar track */}
      <div className="relative h-[3px] rounded-full overflow-hidden"
        style={{ background: "hsl(217 28% 10%)" }}>
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${cfg.bar}88, ${cfg.bar})` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
        />
        {/* Shimmer on the filled portion */}
        <motion.div
          className="absolute inset-y-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, transparent 0%, ${cfg.bar}40 50%, transparent 100%)`,
          }}
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "linear", delay: 0.9 }}
        />
      </div>
    </div>
  );
});
