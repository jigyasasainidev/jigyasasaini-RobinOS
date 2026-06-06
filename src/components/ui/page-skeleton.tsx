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

// ── Trend Scanner skeleton ─────────────────────────────────
// Matches: header + search card + 3 result cards
export function TrendScannerSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading Trend Scanner">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-2.5 w-24 rounded-full" />
        <Skeleton className="h-8 w-52 rounded-lg" />
        <Skeleton className="h-3 w-80 rounded-md" />
      </div>
      {/* Search card */}
      <div className="rounded-2xl p-5 mb-5 space-y-3"
        style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
        <Skeleton className="h-12 rounded-xl" />
      </div>
      {/* Result cards */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 space-y-3"
            style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-6 rounded" />
              <Skeleton className="h-4 w-40 rounded-md" />
              <Skeleton className="h-4 w-10 rounded-full ml-auto" />
            </div>
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-3 w-3/4 rounded-md" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Script Engine skeleton ─────────────────────────────────
// Matches: header + input card + output area
export function ScriptEngineSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading Script Engine">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-2.5 w-20 rounded-full" />
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-3 w-72 rounded-md" />
      </div>
      {/* Input card */}
      <div className="rounded-2xl p-5 mb-6 space-y-4"
        style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
        <div className="flex gap-3">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="h-12 w-36 rounded-xl shrink-0" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-lg" />
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-lg" />
          ))}
        </div>
      </div>
      {/* Output area */}
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

// ── Settings skeleton ──────────────────────────────────────
// Matches: header + subscription card + usage cards + BYOK card
export function SettingsSkeleton() {
  return (
    <div className="pt-14 md:pt-0 animate-fade-in" aria-busy="true" aria-label="Loading Settings">
      <div className="mb-8 space-y-2">
        <Skeleton className="h-2.5 w-28 rounded-full" />
        <Skeleton className="h-8 w-52 rounded-lg" />
      </div>
      <div className="space-y-6 max-w-4xl">
        {/* Subscription card */}
        <div className="rounded-xl p-5 space-y-4"
          style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
          <Skeleton className="h-4 w-36 rounded-md" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-2.5 w-20 rounded" />
                <Skeleton className="h-4 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </div>
        {/* Usage cards */}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl p-5 space-y-3"
            style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-48 rounded-md" />
          </div>
        ))}
        {/* BYOK card */}
        <div className="rounded-2xl p-5 space-y-5"
          style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
