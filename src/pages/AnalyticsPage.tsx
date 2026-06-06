import { motion } from "framer-motion";
import {
  BarChart3, TrendingUp, Zap, Film, Target, Clock,
  Sparkles, Brain, Globe, Flame, Radio, Lock, ArrowRight,
} from "lucide-react";

// ── Feature preview card ───────────────────────────────────
interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  tag: string;
  tagColor?: "blue" | "amber" | "green" | "purple";
  delay?: number;
  blurChart?: React.ReactNode;
}

const TAG_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  blue:   { bg: "hsl(217 91% 60% / 0.08)", border: "hsl(217 91% 60% / 0.22)", text: "hsl(217 91% 68%)" },
  amber:  { bg: "hsl(38 92% 55% / 0.08)",  border: "hsl(38 92% 55% / 0.22)",  text: "hsl(38 92% 65%)"  },
  green:  { bg: "hsl(142 70% 45% / 0.08)", border: "hsl(142 70% 45% / 0.22)", text: "hsl(142 70% 58%)" },
  purple: { bg: "hsl(270 70% 60% / 0.08)", border: "hsl(270 70% 60% / 0.22)", text: "hsl(270 70% 70%)" },
};

// Blurred placeholder chart — purely decorative, no fake data
function BlurChart({ type = "bars" }: { type?: "bars" | "line" | "dots" }) {
  if (type === "bars") {
    const heights = [40, 65, 50, 80, 55, 70, 45, 85, 60, 75];
    return (
      <div className="flex items-end gap-1 h-10 opacity-[0.18] blur-[2px] pointer-events-none select-none">
        {heights.map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-primary"
            style={{ height: `${h}%` }} />
        ))}
      </div>
    );
  }
  if (type === "line") {
    return (
      <svg width="100%" height="40" viewBox="0 0 120 40" preserveAspectRatio="none"
        className="opacity-[0.18] blur-[2px] pointer-events-none select-none">
        <polyline points="0,32 15,24 30,28 45,16 60,20 75,10 90,14 105,6 120,8"
          fill="none" stroke="hsl(217 91% 60%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="0,32 15,24 30,28 45,16 60,20 75,10 90,14 105,6 120,8 120,40 0,40"
          fill="hsl(217 91% 60% / 0.3)" />
      </svg>
    );
  }
  // dots
  const dots = [
    { x: 10, y: 28 }, { x: 25, y: 18 }, { x: 40, y: 24 }, { x: 55, y: 12 },
    { x: 70, y: 20 }, { x: 85, y: 8 }, { x: 100, y: 14 }, { x: 115, y: 6 },
  ];
  return (
    <svg width="100%" height="40" viewBox="0 0 120 40" preserveAspectRatio="none"
      className="opacity-[0.18] blur-[2px] pointer-events-none select-none">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="3" fill="hsl(217 91% 60%)" />
      ))}
    </svg>
  );
}

function FeatureCard({ icon: Icon, title, description, tag, tagColor = "blue", delay = 0, blurChart }: FeatureCardProps) {
  const tc = TAG_STYLES[tagColor];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="relative rounded-2xl overflow-hidden flex flex-col gap-3 p-5"
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 6%) 100%)",
        border: "1px solid hsl(217 28% 12%)",
      }}
    >
      {/* Subtle ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 90% 10%, hsl(217 91% 60% / 0.03), transparent)" }} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.18)" }}>
          <Icon className="w-4 h-4" style={{ color: "hsl(217 91% 65%)" }} strokeWidth={1.6} />
        </div>
        <span className="text-[9px] font-mono uppercase tracking-[0.18em] px-2 py-1 rounded-full"
          style={{ background: tc.bg, border: `1px solid ${tc.border}`, color: tc.text }}>
          {tag}
        </span>
      </div>

      <div className="relative space-y-1">
        <p className="text-[13px] font-semibold leading-tight" style={{ color: "hsl(var(--foreground) / 0.85)" }}>
          {title}
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
          {description}
        </p>
      </div>

      {/* Blurred decorative chart */}
      {blurChart && (
        <div className="relative mt-1">
          {blurChart}
          {/* Lock overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
              style={{ background: "hsl(222 28% 6% / 0.85)", border: "1px solid hsl(217 28% 14%)", backdropFilter: "blur(4px)" }}>
              <Lock className="w-3 h-3" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }} />
              <span className="text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
                In development
              </span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Roadmap phase pill ─────────────────────────────────────
function RoadmapPhase({ phase, label, active }: { phase: string; label: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={active
          ? { background: "hsl(217 91% 60% / 0.15)", border: "1px solid hsl(217 91% 60% / 0.4)" }
          : { background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 14%)" }}>
        {active
          ? <motion.div className="w-2 h-2 rounded-full bg-primary"
              animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
          : <div className="w-2 h-2 rounded-full" style={{ background: "hsl(217 28% 20%)" }} />
        }
      </div>
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.18em]"
          style={{ color: active ? "hsl(217 91% 65%)" : "hsl(var(--muted-foreground) / 0.3)" }}>
          {phase}
        </p>
        <p className="text-[11px]" style={{ color: active ? "hsl(var(--foreground) / 0.7)" : "hsl(var(--muted-foreground) / 0.35)" }}>
          {label}
        </p>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────
const AnalyticsPage = () => {
  return (
    <div className="pt-16 md:pt-0 content-reveal">

      {/* ── Hero ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative rounded-3xl overflow-hidden mb-8"
        style={{
          background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 40% 11%) 50%, hsl(222 28% 8%) 100%)",
          border: "1px solid hsl(217 30% 14%)",
          boxShadow: "0 12px 60px hsl(217 91% 60% / 0.05), 0 4px 20px hsl(0 0% 0% / 0.4)",
        }}
      >
        {/* Ambient radial */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(ellipse 55% 60% at 85% 50%, hsl(217 91% 60% / 0.07), transparent), radial-gradient(ellipse 30% 40% at 5% 80%, hsl(217 60% 40% / 0.04), transparent)" }} />
        {/* Micro grid */}
        <div className="absolute inset-0 pointer-events-none opacity-20"
          style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.3) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

        <div className="relative px-6 py-8 md:px-8">
          <div className="flex items-center gap-2.5 mb-3">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(217 91% 60% / 0.7)" }} />
            <span className="text-[9px] font-mono uppercase tracking-[0.28em]"
              style={{ color: "hsl(217 91% 60% / 0.5)" }}>
              Creator Intelligence
            </span>
            <span className="text-[8px] font-mono uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
              In Development
            </span>
          </div>

          <h1 className="text-chrome text-2xl md:text-3xl font-semibold mb-3 leading-tight"
            style={{ letterSpacing: "-0.02em" }}>
            Advanced Creator Intelligence
          </h1>

          <p className="text-sm max-w-lg leading-relaxed mb-6"
            style={{ color: "hsl(var(--muted-foreground) / 0.55)" }}>
            RobinOS Analytics will connect trend timing, script performance, publishing insights, and cross-platform signals into one AI-powered intelligence layer — giving you an unfair advantage as a creator.
          </p>

          {/* Roadmap */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
            <RoadmapPhase phase="Phase 1 · Now" label="AI generation & trend scanning" active />
            <RoadmapPhase phase="Phase 2 · Next" label="Publishing workflow telemetry" />
            <RoadmapPhase phase="Phase 3 · Future" label="Cross-platform creator analytics" />
          </div>
        </div>
      </motion.div>

      {/* ── Feature preview grid ──────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[9px] font-mono uppercase tracking-[0.22em]"
            style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
            Intelligence Modules
          </span>
          <div className="flex-1 h-px" style={{ background: "hsl(217 28% 12%)" }} />
          <span className="text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}>
            6 modules in development
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <FeatureCard
            icon={Target}
            title="Trend Win Rate"
            description="How often you publish before a trend peaks. Your competitive timing score across TikTok, Instagram, and YouTube."
            tag="Coming Soon"
            tagColor="blue"
            delay={0.05}
            blurChart={<BlurChart type="line" />}
          />
          <FeatureCard
            icon={Zap}
            title="Hook Conversion Analysis"
            description="Which hook formats — POV, Story Time, Listicle, Question — convert best for your niche and audience."
            tag="Coming Soon"
            tagColor="amber"
            delay={0.10}
            blurChart={<BlurChart type="bars" />}
          />
          <FeatureCard
            icon={Brain}
            title="AI Growth Recommendations"
            description="Personalised content strategy recommendations generated from your usage patterns and trend timing data."
            tag="Coming Soon"
            tagColor="purple"
            delay={0.15}
            blurChart={<BlurChart type="dots" />}
          />
          <FeatureCard
            icon={Globe}
            title="Cross-Platform Intelligence"
            description="Unified engagement breakdown across TikTok, Instagram Reels, YouTube Shorts, and Facebook — one dashboard."
            tag="Coming Soon"
            tagColor="green"
            delay={0.20}
            blurChart={<BlurChart type="bars" />}
          />
          <FeatureCard
            icon={Flame}
            title="Viral Pattern Detection"
            description="AI-detected patterns in your highest-performing content — format, length, tone, and timing signals."
            tag="Coming Soon"
            tagColor="amber"
            delay={0.25}
            blurChart={<BlurChart type="line" />}
          />
          <FeatureCard
            icon={Clock}
            title="Publishing Time Intelligence"
            description="Optimal posting windows per platform, per niche — derived from trend velocity and audience activity data."
            tag="Coming Soon"
            tagColor="blue"
            delay={0.30}
            blurChart={<BlurChart type="dots" />}
          />
        </div>
      </div>

      {/* ── What's live now ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.35 }}
        className="rounded-2xl p-5 mb-6"
        style={{
          background: "hsl(142 70% 45% / 0.04)",
          border: "1px solid hsl(142 70% 45% / 0.14)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <motion.div className="w-2 h-2 rounded-full bg-emerald-400"
            animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
          <span className="text-[9px] font-mono uppercase tracking-[0.22em]"
            style={{ color: "hsl(142 70% 55% / 0.7)" }}>
            Live Now
          </span>
        </div>
        <p className="text-sm font-medium mb-1" style={{ color: "hsl(var(--foreground) / 0.8)" }}>
          AI generation telemetry is already tracking your usage
        </p>
        <p className="text-[11.5px] leading-relaxed mb-4"
          style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
          Every script, trend scan, caption, and voice generation is being recorded. When the Analytics layer launches, your full history will be available — no data is lost.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { icon: TrendingUp, label: "Trend scans",    sub: "Tracked" },
            { icon: Sparkles,   label: "Scripts",        sub: "Generated" },
            { icon: Radio,      label: "Captions",       sub: "Created" },
            { icon: Film,       label: "Voice sessions", sub: "Rendered" },
          ].map(({ icon: Icon, label, sub }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.38 + i * 0.05 }}
              className="rounded-xl px-3 py-3 flex items-center gap-2.5"
              style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 11%)" }}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(142 70% 45% / 0.08)", border: "1px solid hsl(142 70% 45% / 0.18)" }}>
                <Icon className="w-3.5 h-3.5" style={{ color: "hsl(142 70% 55%)" }} strokeWidth={1.6} />
              </div>
              <div>
                <p className="text-[11px] font-medium leading-tight" style={{ color: "hsl(var(--foreground) / 0.7)" }}>
                  {label}
                </p>
                <p className="text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
                  {sub}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Early access CTA ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.35 }}
        className="relative rounded-2xl overflow-hidden p-6 text-center"
        style={{
          background: "linear-gradient(160deg, hsl(222 32% 8%) 0%, hsl(222 28% 7%) 100%)",
          border: "1px solid hsl(217 28% 13%)",
        }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(ellipse 50% 60% at 50% 100%, hsl(217 91% 60% / 0.05), transparent)" }} />

        <div className="relative">
          <div className="w-10 h-10 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
            <BarChart3 className="w-4.5 h-4.5" style={{ color: "hsl(217 91% 65%)" }} strokeWidth={1.5} />
          </div>

          <p className="text-[9px] font-mono uppercase tracking-[0.22em] mb-2"
            style={{ color: "hsl(217 91% 60% / 0.5)" }}>
            Roadmap
          </p>
          <h2 className="text-base font-semibold mb-2" style={{ color: "hsl(var(--foreground) / 0.85)" }}>
            Creator Analytics is coming to RobinOS
          </h2>
          <p className="text-[11.5px] max-w-sm mx-auto leading-relaxed mb-5"
            style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
            Real-time trend timing, hook performance, publishing intelligence, and AI growth recommendations — all in one place.
          </p>

          <a
            href="mailto:support@tryrobin.xyz?subject=Analytics%20Beta%20Access&body=I%27d%20like%20early%20access%20to%20RobinOS%20Analytics."
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{
              background: "hsl(217 91% 60% / 0.1)",
              border: "1px solid hsl(217 91% 60% / 0.25)",
              color: "hsl(217 91% 68%)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "hsl(217 91% 60% / 0.16)";
              (e.currentTarget as HTMLElement).style.borderColor = "hsl(217 91% 60% / 0.38)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "hsl(217 91% 60% / 0.1)";
              (e.currentTarget as HTMLElement).style.borderColor = "hsl(217 91% 60% / 0.25)";
            }}
          >
            Request Early Access
            <ArrowRight className="w-3.5 h-3.5" />
          </a>

          <p className="text-[9.5px] font-mono mt-3" style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}>
            support@tryrobin.xyz · We'll notify you when Analytics launches
          </p>
        </div>
      </motion.div>

    </div>
  );
};

export default AnalyticsPage;
