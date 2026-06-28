import React from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

// ── Props ──────────────────────────────────────────────────
interface ErrorBoundaryProps {
  children:   React.ReactNode;
  fallback?:  React.ReactNode;       // custom fallback — uses built-in if absent
  onError?:   (error: Error, info: React.ErrorInfo) => void;
  isolate?:   boolean;               // true = fill parent, false = full-page
  name?:      string;                // optional identifier for logging/debugging
}

interface ErrorBoundaryState {
  hasError:   boolean;
  error:      Error | null;
}

// ── Class boundary ─────────────────────────────────────────
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const boundaryName = this.props.name ? `[${this.props.name}] ` : "";
    console.error(`[ErrorBoundary] ${boundaryName}caught error:`, error);
    console.error(`[ErrorBoundary] ${boundaryName}error stack:`, error.stack);
    console.error(`[ErrorBoundary] ${boundaryName}component stack:`, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <BoundaryFallback
        error={this.state.error}
        onReset={this.reset}
        isolate={this.props.isolate}
      />
    );
  }
}

// ── Built-in fallback UI ───────────────────────────────────
// Matches RobinOS dark-glass premium aesthetic.
// Never shows a stack trace to the user.
function BoundaryFallback({
  error,
  onReset,
  isolate,
}: {
  error:    Error | null;
  onReset:  () => void;
  isolate?: boolean;
}) {
  console.error("[ErrorBoundary] BoundaryFallback rendered for error:", error);
  console.error("[ErrorBoundary] BoundaryFallback error stack:", error?.stack);
  const containerCls = isolate
    ? "flex flex-col items-center justify-center px-6 py-12 rounded-2xl text-center"
    : "min-h-[50vh] flex flex-col items-center justify-center px-6 py-16 text-center";

  return (
    <div
      className={containerCls}
      style={{
        background: isolate
          ? "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)"
          : undefined,
        border: isolate ? "1px solid hsl(217 28% 12%)" : undefined,
        borderRadius: isolate ? "1rem" : undefined,
      }}
      role="alert"
      aria-live="assertive"
    >
      {/* Ambient glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-32 pointer-events-none"
        style={{ background: "radial-gradient(ellipse, hsl(38 90% 55% / 0.06) 0%, transparent 70%)" }}
        aria-hidden
      />

      {/* Icon */}
      <div
        className="relative w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{
          background: "hsl(38 90% 55% / 0.07)",
          border:     "1px solid hsl(38 90% 55% / 0.2)",
        }}
      >
        <AlertTriangle className="w-5 h-5" style={{ color: "hsl(38 90% 55%)" }} strokeWidth={1.5} />
      </div>

      {/* Copy */}
      <p className="text-xs font-semibold text-foreground/80 mb-2 max-w-xs leading-snug">
        This section needs a moment to recover
      </p>
      <p className="text-[11px] text-muted-foreground/45 leading-relaxed max-w-sm mb-6">
        An unexpected issue occurred in this module. The rest of RobinOS is working normally. Click below to reload this section.
      </p>

      {/* Retry */}
      <button
        onClick={onReset}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium transition-all"
        style={{
          background: "hsl(217 91% 60% / 0.1)",
          border:     "1px solid hsl(217 91% 60% / 0.28)",
          color:      "hsl(217 91% 68%)",
        }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Reload this section
      </button>

      {/* Dev hint — only in dev mode */}
      {process.env.NODE_ENV === "development" && error?.message && (
        <p className="mt-4 text-[9.5px] font-mono text-muted-foreground/25 max-w-xs break-all">
          {error.message}
        </p>
      )}
    </div>
  );
}

// ── Convenience functional wrapper ────────────────────────
// <RouteErrorBoundary> — wraps a route's rendered content
export function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary name="RouteErrorBoundary">{children}</ErrorBoundary>;
}

// <SectionErrorBoundary> — isolates a card/section
export function SectionErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary name="SectionErrorBoundary" isolate>{children}</ErrorBoundary>;
}
