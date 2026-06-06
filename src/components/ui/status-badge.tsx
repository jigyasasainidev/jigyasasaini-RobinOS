import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";

// ============================================================
// ROBINOS STATUS BADGE SYSTEM
// Centralised realtime status indicators for the whole platform.
//
// Usage:
//   <StatusBadge status="live" />
//   <StatusBadge status="scanning" label="Analyzing trends" />
//   <StatusBadge status="connected" label="ElevenLabs" compact />
//   <AIStatusBadge phase="Generating hooks..." />
//   <PlanBadge plan="pro_creator" />
// ============================================================

// ── Variant definitions ────────────────────────────────────
type StatusVariant =
  // Success / operational
  | "live" | "active" | "synced" | "operational" | "connected"
  | "verified" | "completed" | "protected"
  // Processing / AI
  | "scanning" | "analyzing" | "generating" | "syncing"
  | "processing" | "streaming" | "indexing" | "updating"
  // Warning
  | "delayed" | "rate_limited" | "reconnecting" | "partial"
  // Error
  | "offline" | "failed" | "disconnected" | "unavailable";

interface VariantConfig {
  dot:      string;   // dot fill color (hsl)
  bg:       string;   // pill background
  border:   string;   // pill border
  text:     string;   // label color
  pulse:    boolean;  // whether the dot pulses
  label:    string;   // default label if none provided
}

const VARIANTS: Record<StatusVariant, VariantConfig> = {
  // ── Success ────────────────────────────────────────────
  live:          { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:true,  label:"Live"            },
  active:        { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:true,  label:"Active"          },
  synced:        { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:false, label:"Synced"          },
  operational:   { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:true,  label:"Operational"     },
  connected:     { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:false, label:"Connected"       },
  verified:      { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:false, label:"Verified"        },
  completed:     { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:false, label:"Completed"       },
  protected:     { dot:"hsl(142 65% 52%)", bg:"hsl(142 65% 50% / 0.07)", border:"hsl(142 65% 50% / 0.2)",  text:"hsl(142 65% 60%)", pulse:false, label:"Protected"       },
  // ── Processing ─────────────────────────────────────────
  scanning:      { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Scanning"        },
  analyzing:     { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Analyzing"       },
  generating:    { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Generating"      },
  syncing:       { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Syncing"         },
  processing:    { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Processing"      },
  streaming:     { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Streaming"       },
  indexing:      { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Indexing"        },
  updating:      { dot:"hsl(217 91% 62%)", bg:"hsl(217 91% 60% / 0.08)", border:"hsl(217 91% 60% / 0.22)", text:"hsl(217 91% 68%)", pulse:true,  label:"Updating"        },
  // ── Warning ─────────────────────────────────────────────
  delayed:       { dot:"hsl(38 90% 55%)",  bg:"hsl(38 90% 55% / 0.07)",  border:"hsl(38 90% 55% / 0.2)",  text:"hsl(38 90% 62%)",  pulse:true,  label:"Delayed"         },
  rate_limited:  { dot:"hsl(38 90% 55%)",  bg:"hsl(38 90% 55% / 0.07)",  border:"hsl(38 90% 55% / 0.2)",  text:"hsl(38 90% 62%)",  pulse:false, label:"Rate Limited"    },
  reconnecting:  { dot:"hsl(38 90% 55%)",  bg:"hsl(38 90% 55% / 0.07)",  border:"hsl(38 90% 55% / 0.2)",  text:"hsl(38 90% 62%)",  pulse:true,  label:"Reconnecting"    },
  partial:       { dot:"hsl(38 90% 55%)",  bg:"hsl(38 90% 55% / 0.07)",  border:"hsl(38 90% 55% / 0.2)",  text:"hsl(38 90% 62%)",  pulse:false, label:"Partial Data"    },
  // ── Error ───────────────────────────────────────────────
  offline:       { dot:"hsl(0 72% 58%)",   bg:"hsl(0 72% 55% / 0.07)",   border:"hsl(0 72% 55% / 0.2)",   text:"hsl(0 72% 65%)",   pulse:false, label:"Offline"         },
  failed:        { dot:"hsl(0 72% 58%)",   bg:"hsl(0 72% 55% / 0.07)",   border:"hsl(0 72% 55% / 0.2)",   text:"hsl(0 72% 65%)",   pulse:false, label:"Failed"          },
  disconnected:  { dot:"hsl(0 72% 58%)",   bg:"hsl(0 72% 55% / 0.07)",   border:"hsl(0 72% 55% / 0.2)",   text:"hsl(0 72% 65%)",   pulse:false, label:"Disconnected"    },
  unavailable:   { dot:"hsl(0 72% 58%)",   bg:"hsl(0 72% 55% / 0.07)",   border:"hsl(0 72% 55% / 0.2)",   text:"hsl(0 72% 65%)",   pulse:false, label:"Unavailable"     },
};

// ── StatusBadge ────────────────────────────────────────────
interface StatusBadgeProps {
  status:   StatusVariant;
  label?:   string;      // override default label
  compact?: boolean;     // dot only — no label text
  className?: string;
}

export function StatusBadge({ status, label, compact = false, className = "" }: StatusBadgeProps) {
  const cfg = VARIANTS[status] ?? VARIANTS.operational;
  const text = label ?? cfg.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono ${compact ? "px-1.5 py-0.5" : "px-2.5 py-1"} ${className}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text }}
      role="status"
      aria-label={text}
    >
      {/* Dot */}
      <span className="relative flex shrink-0" style={{ width: 6, height: 6 }}>
        {cfg.pulse && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ background: cfg.dot }}
            animate={{ scale: [1, 2.2, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className="relative rounded-full w-full h-full" style={{ background: cfg.dot }} />
      </span>
      {/* Label */}
      {!compact && (
        <span className="text-[9.5px] leading-none tracking-wide">{text}</span>
      )}
    </span>
  );
}

// ── AIStatusBadge — cycling generation phase display ──────
// Shows a rotating phrase while AI is working. Matches the
// cinematic pattern already used in TrendScanner / VoiceStudio.
interface AIStatusBadgeProps {
  phase:    string;   // current phase message from parent
  active:   boolean;  // whether generation is in progress
  className?: string;
}

export function AIStatusBadge({ phase, active, className = "" }: AIStatusBadgeProps) {
  if (!active) return null;
  return (
    <motion.span
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[10px] ${className}`}
      style={{
        background: "hsl(217 91% 60% / 0.07)",
        border:     "1px solid hsl(217 91% 60% / 0.2)",
        color:      "hsl(217 91% 68%)",
      }}
      role="status"
      aria-label={phase}
    >
      {/* Tri-dot pulse */}
      <span className="flex gap-[3px] items-end shrink-0">
        {[0, 1, 2].map((i) => (
          <motion.span key={i}
            className="rounded-full"
            style={{ width: 3, height: 3, background: "hsl(217 91% 62%)" }}
            animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
          />
        ))}
      </span>
      <motion.span
        key={phase}
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(4px)" }}
        transition={{ duration: 0.25 }}
      >
        {phase}
      </motion.span>
    </motion.span>
  );
}

// ── PlanBadge — plan tier indicator ───────────────────────
type PlanTier = "free" | "creator" | "pro_creator" | "agency" | "scale_agency";

const PLAN_CFG: Record<PlanTier, { label: string; bg: string; border: string; color: string }> = {
  free:         { label: "Free",       bg: "hsl(217 28% 9%)",             border: "hsl(217 28% 16%)",           color: "hsl(215 16% 45%)"  },
  creator:      { label: "Creator",    bg: "hsl(217 91% 60% / 0.08)",     border: "hsl(217 91% 60% / 0.22)",    color: "hsl(217 91% 68%)"  },
  pro_creator:  { label: "Pro",        bg: "hsl(217 91% 60% / 0.1)",      border: "hsl(217 91% 60% / 0.28)",    color: "hsl(217 91% 72%)"  },
  agency:       { label: "Agency",     bg: "hsl(48 90% 55% / 0.08)",      border: "hsl(48 90% 55% / 0.25)",     color: "hsl(48 90% 62%)"   },
  scale_agency: { label: "Agency",     bg: "hsl(48 90% 55% / 0.08)",      border: "hsl(48 90% 55% / 0.25)",     color: "hsl(48 90% 62%)"   },
};

interface PlanBadgeProps {
  plan:     PlanTier | string;
  className?: string;
}

export function PlanBadge({ plan, className = "" }: PlanBadgeProps) {
  const cfg = PLAN_CFG[plan as PlanTier] ?? PLAN_CFG.free;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] font-mono uppercase tracking-wider ${className}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
    >
      {plan !== "free" && (
        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: cfg.color }} />
      )}
      {cfg.label}
    </span>
  );
}

// ── LiveDot — minimal pulsing presence indicator ──────────
// The smallest possible "alive" signal. Use inline anywhere.
interface LiveDotProps {
  color?:   "green" | "blue" | "amber" | "red";
  size?:    "sm" | "md";
  className?: string;
}

const DOT_COLORS = {
  green: "hsl(142 65% 52%)",
  blue:  "hsl(217 91% 62%)",
  amber: "hsl(38 90% 55%)",
  red:   "hsl(0 72% 58%)",
};

export function LiveDot({ color = "blue", size = "sm", className = "" }: LiveDotProps) {
  const c   = DOT_COLORS[color];
  const dim = size === "sm" ? 6 : 8;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: dim, height: dim }}>
      <motion.span className="absolute inset-0 rounded-full"
        style={{ background: c }}
        animate={{ scale: [1, 2.4, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      />
      <span className="relative rounded-full w-full h-full" style={{ background: c }} />
    </span>
  );
}

// ── SystemStatusRow — compact operational health row ──────
// Used in page headers to communicate "systems are working".
interface SystemStatusRowProps {
  items: { label: string; status: StatusVariant }[];
  className?: string;
}

export function SystemStatusRow({ items, className = "" }: SystemStatusRowProps) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {items.map((item) => (
        <StatusBadge key={item.label} status={item.status} label={item.label} />
      ))}
    </div>
  );
}
