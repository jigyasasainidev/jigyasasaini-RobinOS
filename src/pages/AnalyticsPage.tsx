import { motion } from "framer-motion";
import {
  BarChart3,
  TrendingUp,
  Zap,
  Film,
  Target,
  Clock,
  Sparkles,
  ArrowUpRight,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePlanKey, useIsProOrAbove } from "@/hooks/useEntitlements";

// ── Placeholder insight card ───────────────────────────────
function InsightCard({
  icon: Icon,
  label,
  sublabel,
  locked,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  locked?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className={`rounded-xl border bg-card p-5 flex items-start gap-4 transition-colors ${
        locked
          ? "border-border/40 opacity-55"
          : "border-border hover:border-primary/20"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${
          locked
            ? "bg-sidebar-accent/30 border-border/50"
            : "bg-primary/10 border-primary/25"
        }`}
      >
        {locked ? (
          <Lock className="w-4 h-4 text-muted-foreground/50" />
        ) : (
          <Icon strokeWidth={1.8} className="w-4 h-4 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{sublabel}</p>
      </div>
      {!locked && (
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 mt-0.5" />
      )}
    </motion.div>
  );
}

// ── Coming-soon signal bar ─────────────────────────────────
function SignalBar({ label, pct, delay }: { label: string; pct: number; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono">{label}</span>
        <span className="text-[10px] text-muted-foreground/40 font-mono">—</span>
      </div>
      <div className="h-1.5 rounded-full bg-sidebar-accent/60 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary/25"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.1, duration: 0.7, ease: "easeOut" }}
        />
      </div>
    </motion.div>
  );
}

// ── Page ───────────────────────────────────────────────────

const AnalyticsPage = () => {
  const plan = usePlanKey();
  const isPro = useIsProOrAbove();

  return (
    <div className="pt-16 md:pt-0">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground">
              Creator Intelligence
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-chrome text-xl font-semibold mb-1">Analytics</h1>
              <p className="text-xs text-muted-foreground max-w-md">
                Deep creator performance signals — know what's working, what to double down on, and where to improve.
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary shrink-0">
              Coming Soon
            </Badge>
          </div>
        </div>

        {/* Signal preview bars — layout placeholder */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-card p-5 mb-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
              Performance Signals
            </span>
          </div>
          <div className="space-y-3">
            <SignalBar label="Content win rate"       pct={62} delay={0.15} />
            <SignalBar label="Trend catch rate"        pct={48} delay={0.20} />
            <SignalBar label="Hook performance score"  pct={71} delay={0.25} />
            <SignalBar label="Platform consistency"    pct={55} delay={0.30} />
            <SignalBar label="AI generation velocity"  pct={80} delay={0.35} />
          </div>
          <p className="text-[10px] text-muted-foreground/40 font-mono mt-4">
            Live data will populate once connected to your publishing workflow.
          </p>
        </motion.div>

        {/* Insight cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
          <InsightCard
            icon={Zap}
            label="Top Performing Content"
            sublabel="See which scripts, hooks, and audio trends drove the most engagement across platforms."
            locked={!isPro}
            delay={0.12}
          />
          <InsightCard
            icon={Target}
            label="Trend Win Rate"
            sublabel="How often you publish before a trend peaks — your competitive intelligence timing score."
            locked={!isPro}
            delay={0.16}
          />
          <InsightCard
            icon={Sparkles}
            label="Hook Performance"
            sublabel="Which hook formats — POV, Story Time, Listicle — convert best for your niche."
            locked={!isPro}
            delay={0.20}
          />
          <InsightCard
            icon={Film}
            label="Platform Insights"
            sublabel="Cross-platform engagement breakdown across TikTok, Instagram, YouTube, and Facebook."
            locked={!isPro}
            delay={0.24}
          />
          <InsightCard
            icon={Clock}
            label="Posting Consistency"
            sublabel="Your content cadence score — a consistency signal that predicts algorithmic reach."
            locked={false}
            delay={0.28}
          />
          <InsightCard
            icon={ArrowUpRight}
            label="Creator Growth Signals"
            sublabel="Follower velocity, engagement trends, and momentum direction across your accounts."
            locked={!isPro}
            delay={0.32}
          />
        </div>

        {/* AI generation analytics — always visible */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-3.5 h-3.5 text-primary/70" />
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
              AI Generation Analytics
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            Track how you're using each RobinOS engine — scripts generated, trends scanned, captions created, and voice sessions run.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Scripts",   sub: "Generated" },
              { label: "Trends",    sub: "Scanned" },
              { label: "Captions",  sub: "Created" },
              { label: "Narrations", sub: "Rendered" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.38 + i * 0.05 }}
                className="rounded-lg border border-border/60 bg-sidebar-accent/20 p-3 text-center"
              >
                <p className="text-lg font-semibold text-foreground font-mono">—</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{stat.label}<br />{stat.sub}</p>
              </motion.div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/35 font-mono mt-3">
            Live usage stats — arrives in the next release.
          </p>
        </motion.div>

      </motion.div>
    </div>
  );
};

export default AnalyticsPage;
