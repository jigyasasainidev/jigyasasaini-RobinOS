import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

// ── useAnimatedNumber ──────────────────────────────────────
// Smoothly interpolates from previous value to next value.
// Uses framer-motion's animate() for spring-like easing.
// Respects prefers-reduced-motion — returns value instantly if set.
//
// Usage:
//   const display = useAnimatedNumber(value, { duration: 0.8 });
//
export function useAnimatedNumber(
  target: number,
  options: {
    duration?: number;   // seconds, default auto-scaled by magnitude
    decimals?: number;   // decimal places to display
  } = {}
): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  // Auto-scale duration: small numbers animate faster, large ones slower
  const duration = options.duration ?? Math.min(1.6, Math.max(0.5, Math.log10(Math.abs(target) + 2) * 0.5));

  useEffect(() => {
    // Respect prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      prevRef.current = target;
      return;
    }

    const from = prevRef.current;
    prevRef.current = target;

    if (from === target) return;

    const controls = animate(from, target, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });

    return () => controls.stop();
  }, [target, duration]);

  return display;
}

// ── AnimatedCounter ────────────────────────────────────────
// Drop-in replacement for any static number display.
// Renders the number with optional prefix/suffix and formatting.
//
// Usage:
//   <AnimatedCounter value={1234} prefix="$" decimals={2} />
//   <AnimatedCounter value={98.5} suffix="%" decimals={1} />
//   <AnimatedCounter value={42000} compact />
//
interface AnimatedCounterProps {
  value:     number;
  prefix?:   string;
  suffix?:   string;
  decimals?: number;
  compact?:  boolean;   // 1.2K / 4.5M notation
  duration?: number;
  className?: string;
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  compact = false,
  duration,
  className = "",
}: AnimatedCounterProps) {
  const display = useAnimatedNumber(value, { duration, decimals });

  const formatted = compact
    ? formatCompact(display)
    : decimals > 0
      ? display.toFixed(decimals)
      : String(Math.round(display));

  return (
    // tabular-nums prevents layout shift as digits change width
    <span
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
      aria-live="polite"
      aria-atomic="true"
    >
      {prefix}{formatted}{suffix}
    </span>
  );
}

// ── MetricPill ─────────────────────────────────────────────
// Compact usage pill: "12 / 100 used today"
// Animates both the used and quota numbers.
//
// Usage:
//   <MetricPill used={12} quota={100} label="used today" />
//
interface MetricPillProps {
  used:      number;
  quota:     number | null;
  label?:    string;
  className?: string;
}

export function MetricPill({ used, quota, label = "used today", className = "" }: MetricPillProps) {
  const animUsed  = useAnimatedNumber(used,  { duration: 0.7 });
  const animQuota = useAnimatedNumber(quota ?? 0, { duration: 0.7 });

  return (
    <span
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
      aria-live="polite"
      aria-atomic="true"
    >
      {Math.round(animUsed)}{quota != null ? `/${Math.round(animQuota)}` : ""} {label}
    </span>
  );
}
