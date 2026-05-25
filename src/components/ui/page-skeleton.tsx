import { SkeletonCard, SkeletonRow, Skeleton } from "@/components/ui/skeleton";

// ── Generic dashboard page skeleton ───────────────────────
// Shown as the Suspense fallback while a route chunk lazy-loads.
// Matches the dimensions of a typical dashboard page to prevent
// layout shifts when content arrives.
export function PageSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading page">
      {/* Page header */}
      <div className="mb-8 space-y-2">
        <Skeleton className="h-2.5 w-24 rounded-full" />
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-3 w-72 rounded-md" />
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Content rows */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

// ── Split layout skeleton (2-col like Voice / Video studios) ──
export function SplitPageSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading page">
      {/* Header */}
      <div className="mb-8 space-y-2">
        <Skeleton className="h-2.5 w-20 rounded-full" />
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-3 w-80 rounded-md" />
      </div>

      {/* 2-column layout */}
      <div className="grid md:grid-cols-2 gap-6 max-w-5xl">
        {/* Left: input area */}
        <div className="space-y-5">
          <Skeleton className="h-40 rounded-xl" />
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-11 rounded-xl" />
        </div>
        {/* Right: output area */}
        <Skeleton className="min-h-[420px] rounded-2xl" />
      </div>
    </div>
  );
}

// ── Grid page skeleton (Audio & Hashtag, Trend Scanner results) ──
export function GridPageSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading page">
      {/* Header */}
      <div className="mb-7 space-y-3">
        <Skeleton className="h-2.5 w-28 rounded-full" />
        <Skeleton className="h-8 w-64 rounded-lg" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
      </div>

      {/* Controls card */}
      <Skeleton className="h-28 rounded-2xl mb-6" />

      {/* Card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
