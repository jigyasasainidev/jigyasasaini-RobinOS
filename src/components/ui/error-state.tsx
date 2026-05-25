import { motion } from "framer-motion";
import { AlertTriangle, RefreshCw, Wifi, Clock, Shield } from "lucide-react";

// ── Error category config ──────────────────────────────────
type ErrorCategory =
  | "network"      // Internet / server unreachable
  | "timeout"      // Request took too long
  | "ai"           // AI provider failure
  | "rate_limit"   // Quota exceeded
  | "auth"         // Session expired
  | "not_found"    // Resource missing
  | "permission"   // Insufficient plan/access
  | "generic";     // Unknown error

interface CategoryConfig {
  icon:       typeof AlertTriangle;
  iconColor:  string;
  title:      string;
  description: string;
}

const CFG: Record<ErrorCategory, CategoryConfig> = {
  network: {
    icon: Wifi,
    iconColor: "hsl(38 90% 55%)",
    title: "Connection interrupted",
    description: "Realtime systems are temporarily reconnecting. Your data is safe.",
  },
  timeout: {
    icon: Clock,
    iconColor: "hsl(38 90% 55%)",
    title: "Request took longer than expected",
    description: "The AI system is under high load. Retrying automatically.",
  },
  ai: {
    icon: AlertTriangle,
    iconColor: "hsl(38 90% 55%)",
    title: "AI generation interrupted",
    description: "The generation engine hit an unexpected issue. Your input has been preserved.",
  },
  rate_limit: {
    icon: Shield,
    iconColor: "hsl(217 91% 62%)",
    title: "Generation limit reached",
    description: "You've reached your plan's daily limit. Upgrade to continue creating.",
  },
  auth: {
    icon: Shield,
    iconColor: "hsl(38 90% 55%)",
    title: "Session needs refresh",
    description: "Your session has expired for security. Sign in again to continue.",
  },
  not_found: {
    icon: AlertTriangle,
    iconColor: "hsl(215 16% 45%)",
    title: "Content unavailable",
    description: "This resource couldn't be found. It may have been moved or removed.",
  },
  permission: {
    icon: Shield,
    iconColor: "hsl(217 91% 62%)",
    title: "Feature requires upgrade",
    description: "This feature is available on higher plans.",
  },
  generic: {
    icon: AlertTriangle,
    iconColor: "hsl(38 90% 55%)",
    title: "Something needs attention",
    description: "An unexpected issue occurred. The system is working to recover.",
  },
};

// ── Detect category from error message/code ────────────────
export function detectCategory(err: unknown): ErrorCategory {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) return "network";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort"))       return "timeout";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many"))       return "rate_limit";
  if (msg.includes("unauthorized") || msg.includes("session") || msg.includes("401"))      return "auth";
  if (msg.includes("not found") || msg.includes("404"))                                    return "not_found";
  if (msg.includes("forbidden") || msg.includes("403") || msg.includes("upgrade"))        return "permission";
  if (msg.includes("ai") || msg.includes("groq") || msg.includes("generation"))           return "ai";
  return "generic";
}

// ── ErrorState — full panel ────────────────────────────────
interface ErrorStateProps {
  category?:   ErrorCategory;
  title?:      string;         // override
  description?: string;        // override
  onRetry?:    () => void;
  retryLabel?: string;
  secondaryAction?: { label: string; onClick: () => void };
  compact?:    boolean;        // smaller variant for inline use
  className?:  string;
}

export function ErrorState({
  category = "generic",
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  secondaryAction,
  compact = false,
  className = "",
}: ErrorStateProps) {
  const cfg      = CFG[category];
  const Icon     = cfg.icon;
  const finalTitle = title ?? cfg.title;
  const finalDesc  = description ?? cfg.description;
  const glowBg   = cfg.iconColor.replace("hsl(", "hsl(").replace(")", " / 0.07)");
  const glowBdr  = cfg.iconColor.replace(")", " / 0.2)");

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className={`flex items-start gap-3 px-4 py-3 rounded-xl ${className}`}
        style={{ background: glowBg.replace("0.07)", "0.05)"), border: `1px solid ${glowBdr.replace("0.2)", "0.15)")}` }}
        role="alert" aria-live="polite"
      >
        <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: cfg.iconColor }} strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground/80 leading-tight">{finalTitle}</p>
          <p className="text-[10.5px] text-muted-foreground/50 leading-relaxed mt-0.5">{finalDesc}</p>
        </div>
        {onRetry && (
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={onRetry}
            className="shrink-0 flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-lg transition-all"
            style={{ background: "hsl(217 28% 10%)", border: "1px solid hsl(217 28% 16%)", color: "hsl(215 16% 45%)" }}
          >
            <RefreshCw className="w-3 h-3" /> {retryLabel}
          </motion.button>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl overflow-hidden ${className}`}
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)",
        border: `1px solid ${glowBdr}`,
      }}
      role="alert" aria-live="polite"
    >
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 pointer-events-none"
        style={{ background: `radial-gradient(ellipse, ${glowBg} 0%, transparent 70%)` }} aria-hidden />

      {/* Icon */}
      <div className="relative w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: glowBg, border: `1px solid ${glowBdr}` }}>
        <Icon className="w-5 h-5" style={{ color: cfg.iconColor }} strokeWidth={1.5} />
      </div>

      {/* Copy */}
      <p className="text-xs font-semibold text-foreground/80 mb-1.5 leading-snug max-w-[260px]">{finalTitle}</p>
      <p className="text-[11px] text-muted-foreground/50 leading-relaxed max-w-[280px] mb-6">{finalDesc}</p>

      {/* Actions */}
      {(onRetry || secondaryAction) && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {onRetry && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={onRetry}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: "hsl(217 91% 60% / 0.1)",
                border:     "1px solid hsl(217 91% 60% / 0.28)",
                color:      "hsl(217 91% 68%)",
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> {retryLabel}
            </motion.button>
          )}
          {secondaryAction && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={secondaryAction.onClick}
              className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground/55 hover:text-muted-foreground/80 transition-colors"
              style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)" }}
            >
              {secondaryAction.label}
            </motion.button>
          )}
        </div>
      )}
    </motion.div>
  );
}
