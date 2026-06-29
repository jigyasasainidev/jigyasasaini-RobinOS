import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Zap, PenTool, Mic, Film, Hash, TrendingUp, BarChart3,
  ArrowRight, Play, Sparkles, Globe, Clock, Users, CheckCircle,
  Layers, Cpu, Wand2, Activity, type LucideIcon,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { JVZooCTA } from "@/components/public/JVZooCTA";
import { JVZooDisclaimer } from "@/components/public/JVZooDisclaimer";
import { JVZooTrackingPixel } from "@/components/public/JVZooTrackingPixel";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { BrandMark } from "@/components/BrandMark";

// ── Scroll-reveal wrapper ──────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}>
      {children}
    </motion.div>
  );
}

// ── Section label ──────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-mono tracking-[0.25em] uppercase text-primary/60">{children}</span>;
}

// ── Live ecosystem stats (believable, subtle) ──────────────
const ECOSYSTEM_STATS = [
  { value: "742", label: "creators active now" },
  { value: "12.4K", label: "scripts generated today" },
  { value: "98", label: "trend signals live" },
  { value: "3.2K", label: "workflows running" },
];

// ── Video embed resolver ───────────────────────────────────
function resolveVideoEmbed(url: string): { type: "youtube" | "vimeo" | "loom" | "mp4" | null; embedUrl: string } {
  if (!url) return { type: null, embedUrl: "" };
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: "youtube", embedUrl: `https://www.youtube.com/embed/${yt[1]}?autoplay=0&rel=0&modestbranding=1` };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { type: "vimeo", embedUrl: `https://player.vimeo.com/video/${vm[1]}?title=0&byline=0` };
  const lm = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (lm) return { type: "loom", embedUrl: `https://www.loom.com/embed/${lm[1]}` };
  if (url.includes(".mp4")) return { type: "mp4", embedUrl: url };
  return { type: null, embedUrl: "" };
}

// ── Demo video ─────────────────────────────────────────────
function DemoVideo({ videoUrl }: { videoUrl: string | null }) {
  const resolved = resolveVideoEmbed(videoUrl ?? "");
  return (
    <motion.div
      className="relative w-full rounded-2xl overflow-hidden"
      style={{ aspectRatio: "16/9", background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 0 80px hsl(217 91% 60% / 0.08), 0 24px 80px hsl(0 0% 0% / 0.5)" }}
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      {resolved.type && resolved.embedUrl ? (
        resolved.type === "mp4"
          ? <video src={resolved.embedUrl} controls className="absolute inset-0 w-full h-full" style={{ background: "#000" }} />
          : <iframe src={resolved.embedUrl} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="RobinOS Demo" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(217 91% 60% / 0.07), transparent)" }} />
          {/* Slow light sweep */}
          <motion.div className="pointer-events-none absolute inset-0 opacity-40"
            style={{ background: "linear-gradient(105deg, transparent 40%, hsl(217 91% 60% / 0.06) 50%, transparent 60%)" }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", repeatDelay: 2 }}
          />
          <div className="pointer-events-none absolute inset-0 opacity-15"
            style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.4) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.4) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          {/* Pulsing play button */}
          <div className="relative z-10">
            <motion.div className="absolute inset-0 rounded-full"
              style={{ background: "hsl(217 91% 60% / 0.15)" }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="relative w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.15)" }}
              animate={{ boxShadow: ["0 0 40px hsl(217 91% 60% / 0.15)", "0 0 60px hsl(217 91% 60% / 0.25)", "0 0 40px hsl(217 91% 60% / 0.15)"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.08 }}
            >
              <Play className="w-8 h-8 text-primary ml-1" strokeWidth={1.5} />
            </motion.div>
          </div>
          <div className="text-center z-10">
            <p className="text-sm font-mono text-muted-foreground/60">Demo Coming Soon</p>
            <p className="text-[10px] font-mono text-muted-foreground/35 mt-1 tracking-wider uppercase">Video loading from admin panel</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Tool card ──────────────────────────────────────────────
function ToolCard({ icon: Icon, title, description, delay }: { icon: LucideIcon; title: string; description: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <motion.div
        className="relative rounded-2xl p-5 h-full group cursor-default overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%) 0%, hsl(222 28% 6.5%) 100%)", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(217 91% 60% / 0.35)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.08)", y: -3 }}
        transition={{ duration: 0.25 }}
      >
        {/* Hover spotlight */}
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 40% at 30% 20%, hsl(217 91% 60% / 0.06), transparent)" }} />
        <div className="relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
            <Icon className="w-5 h-5 text-primary" strokeWidth={1.6} />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
          <p className="text-[12px] text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </motion.div>
    </Reveal>
  );
}

// ── Feature row ────────────────────────────────────────────
function FeatureItem({ text, delay }: { text: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }} transition={{ delay, duration: 0.4 }}
      className="flex items-center gap-3"
    >
      <CheckCircle className="w-4 h-4 text-primary shrink-0" strokeWidth={1.8} />
      <span className="text-sm text-muted-foreground">{text}</span>
    </motion.div>
  );
}

// ── Workflow step ──────────────────────────────────────────
function WorkflowStep({ step, label, description, delay }: { step: string; label: string; description: string; delay: number }) {
  return (
    <Reveal delay={delay} className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-bold text-primary shrink-0"
          style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)" }}>
          {step}
        </div>
        <div className="flex-1 w-px mt-2 mb-1" style={{ background: "hsl(217 28% 14%)" }} />
      </div>
      <div className="pb-6">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

// ── AI output card (polished with live feel) ───────────────
function AIOutputCard({ label, lines, timestamp, confidence, delay }: {
  label: string; lines: string[]; timestamp?: string; confidence?: number; delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <motion.div
        className="rounded-2xl p-4 group"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(217 91% 60% / 0.2)", y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70">{label}</p>
          </div>
          <div className="flex items-center gap-2">
            {confidence !== undefined && (
              <span className="text-[9px] font-mono text-muted-foreground/40">{confidence}% conf</span>
            )}
            {timestamp && (
              <span className="text-[9px] font-mono text-muted-foreground/30">{timestamp}</span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          {lines.map((line, i) => (
            <p key={i} className="text-[12px] text-foreground/80 leading-relaxed font-mono">{line}</p>
          ))}
        </div>
      </motion.div>
    </Reveal>
  );
}

// ── Creator use-case card ──────────────────────────────────
function CreatorCard({ category, workflow, output, signal, delay }: {
  category: string; workflow: string; output: string; signal: string; delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <motion.div
        className="rounded-2xl p-5 h-full group relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(217 91% 60% / 0.3)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.07)", y: -3 }}
        transition={{ duration: 0.25 }}
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
          style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(217 91% 60% / 0.04), transparent)" }} />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full uppercase tracking-[0.15em]"
              style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
              {category}
            </span>
            <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: delay * 2 }} />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{workflow}</h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{output}</p>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-primary/50" strokeWidth={1.5} />
            <span className="text-[9px] font-mono text-muted-foreground/40">{signal}</span>
          </div>
        </div>
      </motion.div>
    </Reveal>
  );
}

// ── CTA button (polished) ──────────────────────────────────
function PrimaryButton({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Link to={to}
        className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-300 relative overflow-hidden group"
        style={{
          background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 80% 44%))",
          boxShadow: "0 4px 24px hsl(217 91% 60% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.1)",
        }}
      >
        {/* Hover sweep */}
        <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: "linear-gradient(135deg, hsl(217 91% 58%), hsl(217 80% 50%))" }} />
        <span className="relative flex items-center gap-2">{children}</span>
      </Link>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────
export default function CreatorOSPage() {
  const navigate = useNavigate();
  const { data: settings, isLoading } = usePlatformSettings();

  useEffect(() => {
    if (!isLoading && settings && settings.creator_os_page_enabled === false) {
      navigate("/", { replace: true });
    }
  }, [settings, isLoading, navigate]);

  if (isLoading) return null;
  if (settings && settings.creator_os_page_enabled === false) return null;

  const videoUrl = settings?.creator_os_demo_video_url ?? null;

  return (
    <PublicLayout>
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.035]"
          style={{ background: "radial-gradient(ellipse, hsl(217 91% 60%), transparent 70%)" }} />
        <div className="absolute top-1/3 -left-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: "radial-gradient(ellipse, hsl(260 91% 60%), transparent 70%)" }} />
        <div className="absolute bottom-1/4 -right-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: "radial-gradient(ellipse, hsl(190 91% 60%), transparent 70%)" }} />
      </div>

      {/* ══════════════════ 1. HERO ══════════════════════════ */}
      <section className="relative z-10 px-4 pt-24 pb-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
              style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.18)" }}>
              <motion.span className="w-1.5 h-1.5 rounded-full bg-primary"
                animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-[11px] font-mono tracking-[0.18em] uppercase text-primary/80">AI Creator Operating System</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
              <span className="text-chrome">The OS</span><br />
              <span className="text-chrome">Built for</span><br />
              <span style={{ background: "linear-gradient(135deg, hsl(217 91% 65%), hsl(190 91% 65%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Creators
              </span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
              className="text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
              RobinOS combines trend intelligence, AI script writing, voice generation,
              and caption creation into a single fast workflow. Stop switching tools. Start shipping content.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap gap-3 mb-8">
              <JVZooCTA>
                Start Creating <ArrowRight className="w-4 h-4" />
              </JVZooCTA>
              <motion.a href="#demo-video" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                <Play className="w-3.5 h-3.5" /> Watch Demo
              </motion.a>
            </motion.div>

            <JVZooDisclaimer className="mt-2" />

            {/* Live ecosystem stats */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-wrap gap-4">
              {ECOSYSTEM_STATS.map(({ value, label }, i) => (
                <motion.div key={label}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 + i * 0.07 }}
                  className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold font-mono text-foreground/70">{value}</span>
                  <span className="text-[10px] text-muted-foreground/40">{label}</span>
                  {i < ECOSYSTEM_STATS.length - 1 && <span className="text-muted-foreground/20 ml-2">·</span>}
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right — dashboard preview */}
          <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="relative hidden lg:block">
            <motion.div className="relative rounded-2xl p-4 overflow-hidden"
              style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 24px 80px hsl(0 0% 0% / 0.5), 0 0 60px hsl(217 91% 60% / 0.06)" }}
              animate={{ boxShadow: ["0 24px 80px hsl(0 0% 0% / 0.5), 0 0 40px hsl(217 91% 60% / 0.04)", "0 24px 80px hsl(0 0% 0% / 0.5), 0 0 80px hsl(217 91% 60% / 0.09)", "0 24px 80px hsl(0 0% 0% / 0.5), 0 0 40px hsl(217 91% 60% / 0.04)"] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* Slow scan line */}
              <motion.div className="absolute left-0 right-0 h-px pointer-events-none z-10"
                style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.3), transparent)" }}
                animate={{ top: ["10%", "90%", "10%"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              />
              <div className="mb-3 flex items-center gap-2 border-b pb-3" style={{ borderColor: "hsl(217 28% 12%)" }}>
                <BrandMark size={16} withWordmark />
                <span className="ml-auto text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">Script Engine</span>
                <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70"
                  animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              </div>
              {[
                { label: "Trend Signal", value: "Rising · 74/100", color: "text-emerald-400" },
                { label: "Topic",        value: "AI Faceless Reels", color: "text-foreground/80" },
                { label: "Tone",         value: "Bold", color: "text-primary" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "hsl(217 28% 10%)" }}>
                  <span className="text-[10px] font-mono text-muted-foreground/40">{label}</span>
                  <span className={`text-[11px] font-mono ${color}`}>{value}</span>
                </div>
              ))}
              <motion.div
                className="mt-3 rounded-xl p-3 text-[11px] font-mono text-muted-foreground/70 leading-relaxed"
                style={{ background: "hsl(222 32% 5%)", border: "1px solid hsl(217 28% 10%)" }}
                animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 3, repeat: Infinity }}>
                <span className="text-primary">▸</span> Hook #1: "Nobody is telling you this about faceless YouTube..."<br />
                <span className="text-primary">▸</span> Hook #2: "This one AI tool made me $4K this month..."<br />
                <span className="text-primary">▸</span> Hook #3: "I tested 30 faceless channels. Here's what works..."
              </motion.div>
              <div className="mt-3 flex gap-2">
                {["Captions ✓", "Hashtags ✓", "Voice Ready"].map((tag, i) => (
                  <span key={i} className="text-[9px] font-mono px-2 py-0.5 rounded-md"
                    style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
            {/* Floating badges */}
            <motion.div className="absolute -top-4 -right-4 rounded-xl px-3 py-2 text-[10px] font-mono"
              style={{ background: "hsl(222 32% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(172 70% 55%)" }}
              animate={{ y: [0, -5, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
              ↑ 12.4K creator uses
            </motion.div>
            <motion.div className="absolute -bottom-4 -left-4 rounded-xl px-3 py-2 text-[10px] font-mono"
              style={{ background: "hsl(222 32% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(38 92% 55%)" }}
              animate={{ y: [0, 5, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}>
              ⚡ Velocity spiked 3h ago
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ 2. AI GENERATION SHOWCASE ════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Live AI Generation</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-3 text-chrome">Watch the workflow unfold</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">From topic to publish-ready assets in seconds. No prompting experience required.</p>
        </Reveal>
        <div className="relative max-w-2xl mx-auto">
          {[
            { icon: TrendingUp, step: "01", label: "Scan Trends",      desc: "RobinOS scans live creator signals across YouTube, Reddit, and Google" },
            { icon: PenTool,    step: "02", label: "Generate Script",   desc: "AI writes a platform-native script with hooks, timestamps, and visual cues" },
            { icon: Hash,       step: "03", label: "Create Captions",   desc: "Platform-optimized captions + hashtag clusters generated automatically" },
            { icon: Mic,        step: "04", label: "Voice Narration",   desc: "ElevenLabs-powered voiceover rendered in seconds" },
            { icon: Sparkles,   step: "05", label: "Ready to Publish",  desc: "Script, captions, hashtags, and audio — all packaged and ready" },
          ].map(({ icon: Icon, step, label, desc }, i) => (
            <WorkflowStep key={step} step={step} label={label} description={desc} delay={i * 0.08} />
          ))}
        </div>
      </section>

      {/* ══════════════════ 3. CREATOR TOOLS GRID ════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Creator Tools</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Everything in one OS</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: PenTool,    title: "Script Engine",     description: "AI writes viral scripts for any format — Reels, Shorts, YouTube — with hooks and visual cues.", delay: 0 },
            { icon: TrendingUp, title: "Trend Scanner",     description: "Real-time creator intelligence across platforms. Discover what's rising before it peaks.", delay: 0.05 },
            { icon: Hash,       title: "Caption Engine",    description: "Platform-optimized captions with SEO hashtags, keyword clusters, and viral copy formats.", delay: 0.10 },
            { icon: Mic,        title: "Voice Studio",      description: "Professional AI narration in seconds. ElevenLabs integration with natural delivery.", delay: 0.15 },
            { icon: Zap,        title: "Hook Generator",    description: "10 scroll-stopping hooks per topic. Tested formats: POV, bold statement, story opener.", delay: 0.20 },
            { icon: BarChart3,  title: "Creator Analytics", description: "Understand what's performing. Win rate, hook performance, posting consistency.", delay: 0.25 },
          ].map((tool) => <ToolCard key={tool.title} {...tool} />)}
        </div>
      </section>

      {/* ══════════════════ 4. WORKFLOW PIPELINE ═════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <Reveal>
            <SectionLabel>Creator Pipeline</SectionLabel>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-6 text-chrome">A workflow built<br />for velocity</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              Most creators waste hours jumping between apps. RobinOS eliminates that. Discover → create → publish without leaving the platform.
            </p>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="inline-block">
              <Link to="/login"
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
                Start free <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </motion.div>
          </Reveal>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Globe,   label: "Scan Trends",     sub: "Live creator signals", delay: 0 },
              { icon: PenTool, label: "Write Script",    sub: "AI-powered drafting",  delay: 0.06 },
              { icon: Mic,     label: "Generate Voice",  sub: "Instant narration",    delay: 0.12 },
              { icon: Hash,    label: "Create Captions", sub: "Platform-native",      delay: 0.18 },
              { icon: Film,    label: "Build Video",     sub: "Visual workflow",      delay: 0.24 },
              { icon: Clock,   label: "Publish Faster",  sub: "Save 3h per post",     delay: 0.30 },
            ].map(({ icon: Icon, label, sub, delay }) => (
              <Reveal key={label} delay={delay}>
                <motion.div className="rounded-xl p-4"
                  style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
                  whileHover={{ borderColor: "hsl(217 91% 60% / 0.25)", y: -2 }}
                  transition={{ duration: 0.2 }}>
                  <Icon className="w-5 h-5 text-primary mb-2" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-foreground/90">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ 5. AI OUTPUT SHOWCASE ════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>AI Outputs</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Real outputs, not demos</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">This is what RobinOS actually produces — not mockups.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AIOutputCard label="Hook Generator" timestamp="generated 2m ago" confidence={94}
            lines={['"Nobody tells you this about AI reels..."', '"I tested 50 faceless channels. Results:"', '"This one script made $4K in 48 hours"']}
            delay={0} />
          <AIOutputCard label="Caption Engine" timestamp="generated 4m ago" confidence={88}
            lines={["The AI content revolution is already here.", "Most creators are still sleeping on this.", "#AIContent #CreatorOS #FacelessYouTube"]}
            delay={0.07} />
          <AIOutputCard label="Trend Intelligence" timestamp="scanned 1m ago" confidence={91}
            lines={["↑ Faceless AI Reels — Rising · 74/100", "↑ YouTube Automation — Hot · 88/100", "→ AI Script Tools — Early · 41/100"]}
            delay={0.14} />
        </div>
      </section>

      {/* ══════════════════ 6. WHAT CREATORS ARE BUILDING ═══ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Creator Showcase</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">What creators are building</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">
            Real workflows from creators using RobinOS to build faster, smarter, and more consistently.
          </p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { category: "Faceless YouTube",   workflow: "Shorts Automation",     output: "3 AI scripts + voiceover daily with zero on-camera time",         signal: "840 creators · this workflow", delay: 0 },
            { category: "TikTok Shop",        workflow: "Product Clip Engine",   output: "Hook → script → caption → trending audio in one flow",            signal: "612 creators · rising fast",  delay: 0.06 },
            { category: "Instagram Reels",    workflow: "Aesthetic Content OS",  output: "Trend-aware captions + hooks optimised for saves and shares",     signal: "920 creators · high volume",  delay: 0.12 },
            { category: "AI Personal Brand",  workflow: "Thought Leader System", output: "Weekly AI scripts that sound human and build authority fast",      signal: "381 creators · emerging",     delay: 0.18 },
            { category: "Shorts Automation",  workflow: "YouTube Shorts Stack",  output: "Trend scan → 60s script → voice → 5 shorts per week automated",   signal: "710 creators · hot right now", delay: 0.24 },
            { category: "Education Content",  workflow: "Tutorial Script Engine",output: "Long-form breakdowns that hold retention and drive subscribers",    signal: "430 creators · steady growth", delay: 0.30 },
            { category: "Storytelling",       workflow: "Narrative AI Studio",   output: "Arc-based scripts with emotional hooks and platform-aware pacing",  signal: "295 creators · deep niche",   delay: 0.36 },
            { category: "AI Marketing",       workflow: "Ad Script Machine",     output: "Scroll-stopping ads generated from product + trend intelligence",   signal: "508 creators · scaling up",   delay: 0.42 },
          ].map((c) => <CreatorCard key={c.category} {...c} />)}
        </div>
      </section>

      {/* ══════════════════ 7. FEATURES GRID ════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Platform Features</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Built for serious creators</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4 max-w-3xl mx-auto">
          {[
            "Unlimited AI Scripts", "Viral Hook Formulas", "Smart Caption Engine", "AI Voice Narration",
            "Live Trend Intelligence", "Multi-platform Workflows", "Fast Generation Engine", "Creator-focused Infrastructure",
            "Real-time Signal Scanning", "Platform Personality Profiles", "Signal Depth Analytics", "Secure by Default",
          ].map((feat, i) => <FeatureItem key={feat} text={feat} delay={i * 0.04} />)}
        </div>
      </section>

      {/* ══════════════════ 8. DEMO VIDEO ════════════════════ */}
      <section id="demo-video" className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-10">
          <SectionLabel>Demo</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">See it in action</h2>
        </Reveal>
        <Reveal delay={0.1}><DemoVideo videoUrl={videoUrl} /></Reveal>
      </section>

      {/* ══════════════════ 9. WHY ROBINOS ═══════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal>
              <SectionLabel>Why RobinOS</SectionLabel>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-6 text-chrome">Not another AI tool.<br />An operating system.</h2>
            </Reveal>
            <div className="space-y-5">
              {[
                { title: "Integrated intelligence",        desc: "Trend data, AI generation, voice, and analytics all in one workflow — not 6 separate tools.", delay: 0.08 },
                { title: "Creator-native UX",              desc: "Built for how creators actually work. Fast, focused, and addictive to use.", delay: 0.14 },
                { title: "Real signals, not guesses",      desc: "Live data from YouTube, Reddit, and Google Trends — not templated suggestions.", delay: 0.20 },
                { title: "Infrastructure-grade reliability",desc: "Enterprise security, rate limiting, content moderation, and 99.9% uptime.", delay: 0.26 },
              ].map(({ title, desc, delay }) => (
                <Reveal key={title} delay={delay}>
                  <div className="flex gap-4">
                    <div className="w-1 rounded-full shrink-0 mt-1"
                      style={{ background: "linear-gradient(180deg, hsl(217 91% 60%), hsl(190 91% 60%))", minHeight: "40px" }} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{title}</p>
                      <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={0.1}>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Cpu,    label: "AI-Native",     sub: "Built on cutting-edge models" },
                { icon: Zap,    label: "Fast",          sub: "Scripts in under 3 seconds" },
                { icon: Users,  label: "Creator-first", sub: "Designed for content velocity" },
                { icon: Layers, label: "All-in-one",    sub: "No tool-switching required" },
              ].map(({ icon: Icon, label, sub }) => (
                <motion.div key={label} className="rounded-2xl p-5"
                  style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
                  whileHover={{ borderColor: "hsl(217 91% 60% / 0.2)", y: -2 }} transition={{ duration: 0.2 }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
                    <Icon className="w-4 h-4 text-primary" strokeWidth={1.6} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                </motion.div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ 10. FINAL CTA ════════════════════ */}
      <section className="relative z-10 px-4 py-24 sm:px-6 lg:px-8 max-w-[900px] mx-auto text-center">
        <Reveal>
          <motion.div className="relative rounded-3xl overflow-hidden px-8 py-16"
            style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 0 120px hsl(217 91% 60% / 0.06)" }}
            whileInView={{ boxShadow: ["0 0 60px hsl(217 91% 60% / 0.04)", "0 0 120px hsl(217 91% 60% / 0.08)", "0 0 60px hsl(217 91% 60% / 0.04)"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(217 91% 60% / 0.07), transparent)" }} />
            <SectionLabel>Get Started</SectionLabel>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 mb-4 text-chrome">
              Stop wasting hours<br />creating content.
            </h2>
            <p className="text-muted-foreground text-sm mb-10 max-w-md mx-auto">
              Join thousands of creators who ship faster with RobinOS. Start free — no credit card required.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <JVZooCTA>
                <Wand2 className="w-4 h-4" /> Launch Creator OS
              </JVZooCTA>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/pricing"
                  className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                  View Pricing
                </Link>
              </motion.div>
            </div>

            <JVZooDisclaimer align="center" className="mt-4" />
          </motion.div>
        </Reveal>
      </section>

      <JVZooTrackingPixel />
    </PublicLayout>
  );
}
