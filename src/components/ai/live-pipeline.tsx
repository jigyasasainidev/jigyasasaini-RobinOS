import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

// ============================================================
// ROBINOS LIVE PIPELINE — Realtime operational step display
//
// Shows a vertical list of steps that tick off as AI processes.
// Designed to sit alongside the existing radar animation.
//
// Usage:
//   <LivePipeline active={loading} steps={TREND_PIPELINE} />
// ============================================================

export interface PipelineStep {
  label: string;
  ms:    number;   // ms after start when this step completes
}

// Trend Scanner pipeline — matches real Groq processing phases
export const TREND_PIPELINE: PipelineStep[] = [
  { label: "Connecting signal sources",          ms: 400  },
  { label: "Scanning creator velocity",          ms: 1200 },
  { label: "Analyzing engagement hooks",         ms: 2200 },
  { label: "Cross-checking trend confidence",    ms: 3400 },
  { label: "Ranking breakout momentum",          ms: 4600 },
  { label: "Filtering low-signal noise",         ms: 5800 },
  { label: "Finalizing creator intelligence",    ms: 7200 },
];

// Audio & Hashtag pipeline
export const AUDIO_PIPELINE: PipelineStep[] = [
  { label: "Connecting platform signals",        ms: 400  },
  { label: "Scanning audio velocity",            ms: 1100 },
  { label: "Analyzing creator usage patterns",   ms: 2200 },
  { label: "Ranking trending momentum",          ms: 3400 },
  { label: "Finalizing audio intelligence",      ms: 4800 },
];

export const HASHTAG_PIPELINE: PipelineStep[] = [
  { label: "Connecting platform signals",        ms: 400  },
  { label: "Scanning hashtag velocity",          ms: 1100 },
  { label: "Analyzing engagement patterns",      ms: 2200 },
  { label: "Ranking trending momentum",          ms: 3400 },
  { label: "Finalizing hashtag intelligence",    ms: 4800 },
];

// ── Step status ────────────────────────────────────────────
type StepStatus = "pending" | "active" | "done";

interface LivePipelineProps {
  active:  boolean;
  steps:   PipelineStep[];
  className?: string;
}

export const LivePipeline = memo(({ active, steps, className = "" }: LivePipelineProps) => {
  const [statuses, setStatuses] = useState<StepStatus[]>(() => steps.map(() => "pending"));
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startRef  = useRef<number>(0);

  useEffect(() => {
    // Clear all timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!active) {
      setStatuses(steps.map(() => "pending"));
      return;
    }

    startRef.current = Date.now();

    // Set first step active immediately
    setStatuses(steps.map((_, i) => (i === 0 ? "active" : "pending")));

    steps.forEach((step, i) => {
      // Mark step as done at its scheduled ms
      const doneTimer = setTimeout(() => {
        setStatuses((prev) => {
          const next = [...prev];
          next[i] = "done";
          if (i + 1 < steps.length) next[i + 1] = "active";
          return next;
        });
      }, step.ms);

      timersRef.current.push(doneTimer);
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [active, steps]);

  if (!active) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.3 }}
      className={`space-y-2 ${className}`}
      role="status"
      aria-label="AI processing pipeline"
      aria-live="polite"
    >
      {steps.map((step, i) => {
        const status = statuses[i] ?? "pending";
        return (
          <motion.div
            key={step.label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}
            className="flex items-center gap-2.5"
          >
            {/* Status indicator */}
            <div className="shrink-0 w-4 h-4 flex items-center justify-center">
              {status === "done" ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 25 }}
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(142 65% 50% / 0.15)", border: "1px solid hsl(142 65% 50% / 0.35)" }}
                >
                  <Check className="w-2.5 h-2.5" style={{ color: "hsl(142 65% 55%)" }} strokeWidth={2.5} />
                </motion.div>
              ) : status === "active" ? (
                <div className="relative w-4 h-4 flex items-center justify-center">
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ border: "1px solid hsl(217 91% 60% / 0.4)" }}
                    animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(217 91% 62%)" }} />
                </div>
              ) : (
                <div className="w-1.5 h-1.5 rounded-full mx-auto"
                  style={{ background: "hsl(217 28% 16%)" }} />
              )}
            </div>

            {/* Label */}
            <span
              className="text-[10.5px] font-mono leading-none transition-colors duration-300"
              style={{
                color: status === "done"
                  ? "hsl(142 65% 55% / 0.7)"
                  : status === "active"
                  ? "hsl(217 91% 68%)"
                  : "hsl(215 16% 28%)",
              }}
            >
              {step.label}
            </span>

            {/* Active shimmer */}
            {status === "active" && (
              <motion.div
                className="h-px flex-1 rounded-full"
                style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.4), transparent)" }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
});
