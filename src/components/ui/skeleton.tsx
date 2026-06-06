import { cn } from "@/lib/utils";

// ── Base skeleton ──────────────────────────────────────────
// Uses a translateX shimmer sweep over a dark glass base.
// The sweep is GPU-friendly (transform only) and respects
// prefers-reduced-motion by falling back to a gentle opacity pulse.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        // Base: dark glass matching RobinOS palette
        "relative overflow-hidden rounded-lg",
        "bg-white/[0.03] border border-white/[0.05]",
        // Reduced-motion: simple opacity pulse
        "motion-reduce:animate-pulse motion-reduce:before:hidden",
        className
      )}
      {...props}
    >
      {/* Shimmer sweep — hidden when prefers-reduced-motion */}
      <div
        className="absolute inset-0 -translate-x-full animate-shimmer"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.07) 40%, hsl(217 91% 60% / 0.12) 50%, hsl(217 91% 60% / 0.07) 60%, transparent 100%)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}

// ── Preset variants ────────────────────────────────────────

/** Single text line */
const SkeletonText = ({ className, width = "w-full" }: { className?: string; width?: string }) => (
  <Skeleton className={cn("h-3.5 rounded-md", width, className)} />
);

/** Metric value block (large number area) */
const SkeletonValue = ({ className }: { className?: string }) => (
  <Skeleton className={cn("h-8 w-24 rounded-lg", className)} />
);

/** Avatar / icon circle */
const SkeletonCircle = ({ size = "w-8 h-8", className }: { size?: string; className?: string }) => (
  <Skeleton className={cn("rounded-full shrink-0", size, className)} />
);

/** Dashboard stat card skeleton */
const SkeletonCard = ({ className }: { className?: string }) => (
  <div
    className={cn("relative overflow-hidden rounded-xl p-4 space-y-3", className)}
    style={{
      background: "linear-gradient(145deg, hsl(222 28% 7.5%) 0%, hsl(222 26% 6%) 100%)",
      border: "1px solid hsl(217 28% 11%)",
      boxShadow: "0 2px 12px hsl(0 0% 0% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.025)",
    }}
    role="status"
    aria-busy="true"
    aria-label="Loading card"
  >
    {/* Shimmer */}
    <div
      className="absolute inset-0 -translate-x-full animate-shimmer pointer-events-none"
      style={{
        background:
          "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.05) 40%, hsl(217 91% 60% / 0.10) 50%, hsl(217 91% 60% / 0.05) 60%, transparent 100%)",
      }}
      aria-hidden="true"
    />
    <Skeleton className="h-3 w-16 rounded-md" />
    <Skeleton className="h-7 w-20 rounded-md" />
    <Skeleton className="h-2.5 w-28 rounded-md" />
  </div>
);

/** History / table row skeleton */
const SkeletonRow = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "flex items-center gap-3 px-4 py-3.5 rounded-xl",
      className
    )}
    style={{ background: "hsl(222 28% 6.5%)", border: "1px solid hsl(217 28% 11%)" }}
    role="status"
    aria-busy="true"
    aria-label="Loading row"
  >
    <Skeleton className="w-7 h-7 rounded-md shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-3 w-2/3 rounded-md" />
      <Skeleton className="h-2.5 w-1/3 rounded-md" />
    </div>
    <Skeleton className="h-5 w-12 rounded-full shrink-0" />
  </div>
);

export { Skeleton, SkeletonText, SkeletonValue, SkeletonCircle, SkeletonCard, SkeletonRow };
