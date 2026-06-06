import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================
// ROBINOS AI GENERATION STATE SYSTEM
// Centralised multi-stage progress experience for all AI actions.
//
// Usage:
//   <GenerationState active={generating} stages={SCRIPT_STAGES} />
//   <GenerationState active={generating} stages={TREND_STAGES} compact />
// ============================================================

// ── Stage definitions ──────────────────────────────────────
export interface GenerationStage {
  label:    string;   // short operational label
  duration: number;   // approximate ms this stage takes
}

// Script Engine stages
export const SCRIPT_STAGES: GenerationStage[] = [
  { label: "Initializing AI systems",          duration: 600  },
  { label: "Analyzing trend signals",          duration: 900  },
  { label: "Structuring creator hook",         duration: 800  },
  { label: "Building narrative flow",          duration: 1000 },
  { label: "Optimizing engagement pacing",     duration: 900  },
  { label: "Generating CTA strategy",          duration: 700  },
  { label: "Finalizing creator output",        duration: 600  },
];

// Trend Scanner stages
export const TREND_STAGES: GenerationStage[] = [
  { label: "Connecting signal sources",        duration: 700  },
  { label: "Scanning creator trends",          duration: 1000 },
  { label: "Ranking momentum patterns",        duration: 900  },
  { label: "Calculating confidence scores",    duration: 800  },
  { label: "Building insight summary",         duration: 700  },
  { label: "Finalizing trend intelligence",    duration: 600  },
];

// Caption Engine stages
export const CAPTION_STAGES: GenerationStage[] = [
  { label: "Analyzing platform signals",       duration: 600  },
  { label: "Structuring caption flow",         duration: 800  },
  { label: "Optimizing hashtag strategy",      duration: 700  },
  { label: "Refining engagement hooks",        duration: 600  },
  { label: "Finalizing caption output",        duration: 500  },
];

// Voice Studio stages
export const VOICE_STAGES: GenerationStage[] = [
  { label: "Connecting ElevenLabs",            duration: 500  },
  { label: "Processing voice parameters",      duration: 700  },
  { label: "Synthesizing audio stream",        duration: 1200 },
  { label: "Optimizing audio quality",         duration: 600  },
  { label: "Preparing playback",               duration: 400  },
];

// ── Streaming placeholder lines ────────────────────────────
// Shown as fake "content arriving" shimmer blocks
const PLACEHOLDER_WIDTHS = [
  "w-full", "w-5/6", "w-4/5", "w-full", "w-3/4",
  "w-full", "w-5/6", "w-2/3", "w-full", "w-4/5",
];

// ── Main component ─────────────────────────────────────────
interface GenerationStateProps {
  active:    boolean;
  stages:    GenerationStage[];
  compact?:  boolean;   // smaller variant for inline use
  showStream?: boolean; // show streaming placeholder lines
}

export const GenerationState = memo(({
  active,
  stages,
  compact = false,
  showStream = true,
}: GenerationStateProps) => {
  const [stageIdx,  setStageIdx]  = useState(0);
  const [progress,  setProgress]  = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<number>(0);

  // Advance through stages while active
  useEffect(() => {
    if (!active) {
      setStageIdx(0);
      setProgress(0);
      return;
    }

    startRef.current = Date.now();
    let idx = 0;

    const advance = () => {
      if (idx < stages.length - 1) {
        idx++;
        setStageIdx(idx);
        timerRef.current = setTimeout(advance, stages[idx]?.duration ?? 800);
      }
    };

    timerRef.current = setTimeout(advance, stages[0]?.duration ?? 800);

    // Smooth progress bar — runs independently of stage timing
    const total = stages.reduce((s, st) => s + st.duration, 0);
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.min(92, (elapsed / total) * 100); // cap at 92% — final jump on complete
      setProgress(pct);
      if (pct < 92) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, stages]);

  if (!active) return null;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        className="flex items-center gap-2.5"
        role="status"
        aria-label={stages[stageIdx]?.label ?? "Generating"}
        aria-live="polite"
      >
        {/* Tri-dot */}
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
        <AnimatePresence mode="wait">
          <motion.span
            key={stageIdx}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.25 }}
            className="text-[10.5px] font-mono"
            style={{ color: "hsl(217 91% 68%)" }}
          >
            {stages[stageIdx]?.label}
          </motion.span>
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)",
        border: "1px solid hsl(217 91% 60% / 0.12)",
        boxShadow: "0 0 60px hsl(217 91% 60% / 0.05)",
      }}
      role="status"
      aria-label={stages[stageIdx]?.label ?? "Generating"}
      aria-live="polite"
    >
      {/* Progress bar */}
      <div className="h-[2px] w-full" style={{ background: "hsl(217 28% 10%)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: "linear-gradient(90deg, hsl(217 91% 50%), hsl(217 91% 68%))" }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      <div className="p-6 space-y-5">
        {/* Stage label */}
        <div className="flex items-center gap-3">
          {/* Pulse ring */}
          <div className="relative shrink-0 flex items-center justify-center w-8 h-8">
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ border: "1px solid hsl(217 91% 60% / 0.3)" }}
              animate={{ scale: [1, 1.6, 1.6], opacity: [0.6, 0, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
            <div className="w-2 h-2 rounded-full" style={{ background: "hsl(217 91% 62%)" }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] mb-0.5"
              style={{ color: "hsl(217 91% 60% / 0.5)" }}>
              AI Processing · Stage {stageIdx + 1}/{stages.length}
            </p>
            <AnimatePresence mode="wait">
              <motion.p
                key={stageIdx}
                initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.28 }}
                className="text-sm font-medium"
                style={{ color: "hsl(217 91% 72%)" }}
              >
                {stages[stageIdx]?.label}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Percentage */}
          <span className="text-[10px] font-mono shrink-0"
            style={{ color: "hsl(217 91% 60% / 0.45)", fontVariantNumeric: "tabular-nums" }}>
            {Math.round(progress)}%
          </span>
        </div>

        {/* Stage dots */}
        <div className="flex items-center gap-1.5">
          {stages.map((_, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              style={{
                height: 3,
                background: i < stageIdx
                  ? "hsl(217 91% 60%)"
                  : i === stageIdx
                  ? "hsl(217 91% 60% / 0.6)"
                  : "hsl(217 28% 12%)",
              }}
              animate={{ flex: i === stageIdx ? 2 : 1 }}
              transition={{ duration: 0.3 }}
            />
          ))}
        </div>

        {/* Streaming placeholder — fake content arriving */}
        {showStream && (
          <div className="space-y-2 pt-1" aria-hidden="true">
            {PLACEHOLDER_WIDTHS.slice(0, 6).map((w, i) => (
              <motion.div
                key={i}
                className={`relative overflow-hidden rounded-md h-3 ${w}`}
                style={{ background: "hsl(217 28% 9%)" }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
              >
                {/* Shimmer sweep */}
                <div
                  className="absolute inset-0 -translate-x-full animate-shimmer"
                  style={{
                    background: "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.08) 50%, transparent 100%)",
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
});
