import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

// ── LockedFeature ──────────────────────────────────────────
// Elegant preview overlay for premium-only features.
// Shows a blurred preview of the content with a soft lock overlay.
// Never hides the feature entirely — shows it as aspirational.
//
// Usage:
//   <LockedFeature
//     title="Advanced Viral Probability"
//     description="Cross-platform confidence scoring and momentum analysis."
//     requiredPlan="Pro Creator"
//   >
//     <YourPreviewContent />
//   </LockedFeature>

interface LockedFeatureProps {
  title:        string;
  description:  string;
  requiredPlan?: string;   // "Pro Creator" | "Agency"
  children?:    React.ReactNode;  // blurred preview content
  compact?:     boolean;
  className?:   string;
}

export function LockedFeature({
  title,
  description,
  requiredPlan = "Pro Creator",
  children,
  compact = false,
  className = "",
}: LockedFeatureProps) {
  const navigate = useNavigate();

  const isAgency = requiredPlan.toLowerCase().includes("agency");
  const accentColor = isAgency ? "hsl(48 90% 55%)" : "hsl(217 91% 60%)";
  const accentBg    = isAgency ? "hsl(48 90% 55% / 0.08)" : "hsl(217 91% 60% / 0.08)";
  const accentBdr   = isAgency ? "hsl(48 90% 55% / 0.22)" : "hsl(217 91% 60% / 0.22)";

  if (compact) {
    return (
      <div className={`relative rounded-xl overflow-hidden ${className}`}
        style={{ border: `1px solid ${accentBdr}` }}>
        {/* Blurred preview */}
        {children && (
          <div className="pointer-events-none select-none" style={{ filter: "blur(4px)", opacity: 0.35 }}>
            {children}
          </div>
        )}
        {/* Lock overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl"
          style={{ background: `${accentBg}`, backdropFilter: "blur(2px)" }}>
          <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} strokeWidth={1.5} />
          <span className="text-[10.5px] font-mono" style={{ color: accentColor }}>
            {requiredPlan}
          </span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)",
        border: `1px solid ${accentBdr}`,
      }}
    >
      {/* Blurred preview content */}
      {children && (
        <div className="pointer-events-none select-none p-5"
          style={{ filter: "blur(5px)", opacity: 0.25 }}>
          {children}
        </div>
      )}

      {/* Lock overlay */}
      <div className={`${children ? "absolute inset-0" : ""} flex flex-col items-center justify-center text-center px-6 py-10`}
        style={{ backdropFilter: children ? "blur(2px)" : undefined }}>

        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 pointer-events-none"
          style={{ background: `radial-gradient(ellipse, ${accentBg} 0%, transparent 70%)` }} />

        {/* Icon */}
        <motion.div
          className="relative w-11 h-11 rounded-xl flex items-center justify-center mb-4"
          style={{ background: accentBg, border: `1px solid ${accentBdr}` }}
          animate={{ boxShadow: [`0 0 0 ${accentColor.replace(")", " / 0")}`, `0 0 20px ${accentColor.replace(")", " / 0.12")}`, `0 0 0 ${accentColor.replace(")", " / 0")}`] }}
          transition={{ duration: 3.5, repeat: Infinity }}
        >
          <Lock className="w-4.5 h-4.5" style={{ color: accentColor }} strokeWidth={1.5} />
        </motion.div>

        {/* Plan badge */}
        <span className="text-[8.5px] font-mono uppercase tracking-[0.22em] mb-2"
          style={{ color: `${accentColor.replace(")", " / 0.55)")}` }}>
          {requiredPlan} Feature
        </span>

        {/* Title + description */}
        <p className="text-sm font-semibold text-foreground/80 mb-1.5 leading-snug max-w-[240px]">{title}</p>
        <p className="text-[11px] text-muted-foreground/45 leading-relaxed max-w-[260px] mb-5">{description}</p>

        {/* CTA */}
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => navigate("/dashboard/settings")}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all"
          style={{
            background: accentBg,
            border: `1px solid ${accentBdr}`,
            color: accentColor,
            boxShadow: `0 4px 16px ${accentColor.replace(")", " / 0.1)")}`,
          }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Unlock {requiredPlan}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── UsageNudge ─────────────────────────────────────────────
// Contextual upgrade nudge shown after value creation moments.
// Appears inline — never as a popup or modal.
//
// Usage:
//   <UsageNudge
//     used={8} quota={10}
//     feature="trend scans"
//     upgradeMessage="Pro creators get 100 scans/day + realtime trend memory."
//   />

interface UsageNudgeProps {
  used:            number;
  quota:           number;
  feature:         string;
  upgradeMessage?: string;
  className?:      string;
}

export function UsageNudge({ used, quota, feature, upgradeMessage, className = "" }: UsageNudgeProps) {
  const navigate   = useNavigate();
  const remaining  = Math.max(0, quota - used);
  const pct        = Math.min(100, (used / quota) * 100);

  // Only show when ≥ 70% used
  if (pct < 70) return null;

  const isNearLimit = pct >= 90;
  const color = isNearLimit ? "hsl(38 90% 55%)" : "hsl(217 91% 60%)";
  const bg    = isNearLimit ? "hsl(38 90% 55% / 0.06)" : "hsl(217 91% 60% / 0.06)";
  const bdr   = isNearLimit ? "hsl(38 90% 55% / 0.18)" : "hsl(217 91% 60% / 0.18)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl px-4 py-3 ${className}`}
      style={{ background: bg, border: `1px solid ${bdr}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium mb-0.5" style={{ color }}>
            {remaining === 0
              ? `${feature} limit reached`
              : `${remaining} ${feature} remaining today`}
          </p>
          {upgradeMessage && (
            <p className="text-[10px] text-muted-foreground/45 leading-relaxed">{upgradeMessage}</p>
          )}
          {/* Usage bar */}
          <div className="mt-2 h-[2px] rounded-full overflow-hidden" style={{ background: "hsl(217 28% 10%)" }}>
            <motion.div className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${color}88, ${color})` }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => navigate("/dashboard/settings")}
          className="shrink-0 text-[10px] font-mono px-3 py-1.5 rounded-lg transition-all"
          style={{ background: `${color.replace(")", " / 0.1)")}`, border: `1px solid ${bdr}`, color }}
        >
          Upgrade
        </motion.button>
      </div>
    </motion.div>
  );
}
