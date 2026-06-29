import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Zap, PenTool, Mic, Film, Hash, TrendingUp, BarChart3,
  ArrowRight, Play, Sparkles, Globe, Clock, Users, CheckCircle,
  Layers, Cpu, Wand2, Activity, ChevronDown, AlertTriangle,
  Timer, DollarSign, Repeat, type LucideIcon,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { WarriorPlusCTA } from "@/components/public/WarriorPlusCTA";
import { WarriorPlusDisclaimer } from "@/components/public/WarriorPlusDisclaimer";
import { WarriorPlusSalesScript } from "@/components/public/WarriorPlusSalesScript";
import { WarriorPlusTrackingPixel } from "@/components/public/WarriorPlusTrackingPixel";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { BrandMark } from "@/components/BrandMark";

// ── WarriorPlus accent palette ─────────────────────────────
// Warm amber/copper — distinct from /jvzoo's blue (hsl 217 91% 60%).
// Keep these HSL triplets consistent across this file.
const ACCENT = "hsl(28 92% 55%)";
const ACCENT_DEEP = "hsl(18 85% 48%)";
const ACCENT_SOFT = "hsl(38 92% 60%)";

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
  return <span className="text-[10px] font-mono tracking-[0.25em] uppercase" style={{ color: ACCENT, opacity: 0.7 }}>{children}</span>;
}

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
      id="demo-video"
      className="relative w-full rounded-2xl overflow-hidden"
      style={{ aspectRatio: "16/9", background: `linear-gradient(135deg, hsl(28 32% 8%), hsl(22 28% 6%))`, border: `1px solid hsl(28 28% 14%)`, boxShadow: `0 0 80px ${ACCENT} / 0.08, 0 24px 80px hsl(0 0% 0% / 0.5)` }}
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
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${ACCENT} / 0.07, transparent)` }} />
          <motion.div className="pointer-events-none absolute inset-0 opacity-40"
            style={{ background: `linear-gradient(105deg, transparent 40%, ${ACCENT} / 0.06 50%, transparent 60%)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", repeatDelay: 2 }}
          />
          <div className="pointer-events-none absolute inset-0 opacity-15"
            style={{ backgroundImage: "linear-gradient(hsl(28 28% 16% / 0.4) 1px, transparent 1px), linear-gradient(90deg, hsl(28 28% 16% / 0.4) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          <div className="relative z-10">
            <motion.div className="absolute inset-0 rounded-full"
              style={{ background: `${ACCENT} / 0.15` }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="relative w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: `${ACCENT} / 0.1`, border: `1px solid ${ACCENT} / 0.2`, boxShadow: `0 0 40px ${ACCENT} / 0.15` }}
              animate={{ boxShadow: [`0 0 40px ${ACCENT} / 0.15`, `0 0 60px ${ACCENT} / 0.25`, `0 0 40px ${ACCENT} / 0.15`] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.08 }}
            >
              <Play className="w-8 h-8 ml-1" style={{ color: ACCENT }} strokeWidth={1.5} />
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
        style={{ background: "linear-gradient(135deg, hsl(28 32% 8%) 0%, hsl(22 28% 6.5%) 100%)", border: "1px solid hsl(28 28% 12%)" }}
        whileHover={{ borderColor: `${ACCENT} / 0.35`, boxShadow: `0 0 40px ${ACCENT} / 0.08`, y: -3 }}
        transition={{ duration: 0.25 }}
      >
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 60% 40% at 30% 20%, ${ACCENT} / 0.06, transparent)` }} />
        <div className="relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
            style={{ background: `${ACCENT} / 0.1`, border: `1px solid ${ACCENT} / 0.2` }}>
            <Icon className="w-5 h-5" style={{ color: ACCENT }} strokeWidth={1.6} />
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
      <CheckCircle className="w-4 h-4 shrink-0" style={{ color: ACCENT }} strokeWidth={1.8} />
      <span className="text-sm text-muted-foreground">{text}</span>
    </motion.div>
  );
}

// ── Workflow step ──────────────────────────────────────────
function WorkflowStep({ step, label, description, delay }: { step: string; label: string; description: string; delay: number }) {
  return (
    <Reveal delay={delay} className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-bold shrink-0"
          style={{ background: `${ACCENT} / 0.12`, border: `1px solid ${ACCENT} / 0.25`, color: ACCENT }}>
          {step}
        </div>
        <div className="flex-1 w-px mt-2 mb-1" style={{ background: "hsl(28 28% 14%)" }} />
      </div>
      <div className="pb-6">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

// ── FAQ accordion item ─────────────────────────────────────
function FAQItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={index * 0.05}>
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(28 32% 8%), hsl(22 28% 6.5%))", border: `1px solid ${open ? `${ACCENT} / 0.25` : "hsl(28 28% 12%)"}` }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-4 p-5 text-left transition-colors"
          aria-expanded={open}
        >
          <span className="text-sm font-semibold text-foreground">{question}</span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0"
          >
            <ChevronDown className="w-4 h-4" style={{ color: ACCENT }} />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <p className="px-5 pb-5 text-[13px] text-muted-foreground leading-relaxed">{answer}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Reveal>
  );
}

// ── Pricing tier card ──────────────────────────────────────
function PricingCard({ delay }: { delay: number }) {
  const features = [
    "Unlimited AI scripts, hooks & captions",
    "Live trend intelligence across platforms",
    "AI voice narration (ElevenLabs-grade)",
    "Multi-platform workflow builder",
    "Real-time signal & analytics dashboard",
    "Priority email support",
    "14-day money-back guarantee",
  ];
  return (
    <Reveal delay={delay}>
      <motion.div
        className="relative rounded-3xl overflow-hidden max-w-xl mx-auto"
        style={{
          background: "linear-gradient(135deg, hsl(28 32% 9%), hsl(22 28% 7%))",
          border: `1px solid ${ACCENT} / 0.25`,
          boxShadow: `0 0 80px ${ACCENT} / 0.08, 0 24px 80px hsl(0 0% 0% / 0.5)`,
        }}
        whileHover={{ borderColor: `${ACCENT} / 0.4`, boxShadow: `0 0 120px ${ACCENT} / 0.12, 0 24px 80px hsl(0 0% 0% / 0.5)` }}
        transition={{ duration: 0.3 }}
      >
        {/* Header band */}
        <div className="px-8 pt-8 pb-6 text-center border-b" style={{ borderColor: `${ACCENT} / 0.15` }}>
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full"
            style={{ background: `${ACCENT} / 0.1`, border: `1px solid ${ACCENT} / 0.25` }}>
            <Sparkles className="w-3 h-3" style={{ color: ACCENT }} />
            <span className="text-[10px] font-mono tracking-[0.18em] uppercase" style={{ color: ACCENT }}>Lifetime · One-time</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 text-chrome">RobinOS Pro</h3>
          <p className="text-[12px] text-muted-foreground/70 mb-6">For serious creators who want the full operating system.</p>
          <div className="flex items-end justify-center gap-2 mb-1">
            <span className="text-5xl sm:text-6xl font-bold tracking-tight text-chrome">$39</span>
            <span className="text-sm text-muted-foreground mb-2">/lifetime</span>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">No subscriptions · No renewals</p>
        </div>

        {/* Features list */}
        <div className="px-8 py-6">
          <ul className="space-y-3">
            {features.map((feature, i) => (
              <motion.li
                key={feature}
                initial={{ opacity: 0, x: -6 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: delay + 0.05 + i * 0.04, duration: 0.3 }}
                className="flex items-start gap-3"
              >
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: ACCENT }} strokeWidth={1.8} />
                <span className="text-[13px] text-foreground/85">{feature}</span>
              </motion.li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div className="px-8 pb-8 pt-2">
          <WarriorPlusCTA fullWidth>
            Get Instant Access <ArrowRight className="w-4 h-4" />
          </WarriorPlusCTA>
          <WarriorPlusDisclaimer align="center" className="mt-3 mx-auto" />
        </div>
      </motion.div>
    </Reveal>
  );
}

// ── Main page ──────────────────────────────────────────────
export default function WarriorPlusPage() {
  const navigate = useNavigate();
  const { data: settings, isLoading } = usePlatformSettings();

  useEffect(() => {
    if (!isLoading && settings && settings.warriorplus_page_enabled === false) {
      navigate("/", { replace: true });
    }
  }, [settings, isLoading, navigate]);

  if (isLoading) return null;
  if (settings && settings.warriorplus_page_enabled === false) return null;

  const videoUrl = settings?.warriorplus_demo_video_url ?? null;

  // Smoothly scroll to the Hero demo player and, where the provider allows,
  // kick off playback. For embedded players (YouTube / Vimeo / Loom) we
  // append &autoplay=1&mute=1 to the iframe src and reset it — browsers
  // only permit iframe autoplay when the player is muted. For MP4 we call
  // .play() directly. If autoplay is blocked, we fall back to focusing the
  // player so keyboard users land inside it.
  const handleWatchDemo = useCallback(() => {
    const target = document.getElementById("demo-video");
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });

    const tryStartPlayback = () => {
      const player = target.querySelector("iframe, video");
      if (!player) return;

      if (player.tagName === "VIDEO") {
        const v = player as HTMLVideoElement;
        const result = v.play();
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            try { v.focus(); } catch {}
          });
        }
        return;
      }

      if (player.tagName === "IFRAME") {
        const iframe = player as HTMLIFrameElement;
        try {
          const url = new URL(iframe.src);
          if (!url.searchParams.has("autoplay")) url.searchParams.set("autoplay", "1");
          if (!url.searchParams.has("mute")) url.searchParams.set("mute", "1");
          iframe.src = url.toString();
        } catch {
          try { iframe.focus(); } catch {}
        }
      }
    };

    window.setTimeout(tryStartPlayback, 500);
  }, []);

  const faqs = [
    {
      question: "What exactly do I get with RobinOS Pro?",
      answer: "You get the full RobinOS platform — unlimited AI scripts, hooks and captions, live trend intelligence across YouTube / TikTok / Reddit, AI voice narration, multi-platform workflow builder, real-time analytics dashboard, and a commercial license so you can sell what you ship. No feature gates, no upsells.",
    },
    {
      question: "Is this really a one-time payment?",
      answer: "Yes. $39 is paid once and you own the Pro tier for the lifetime of the product. Future core updates are included. If we ever ship a tier above Pro, Pro owners will get a meaningful discount.",
    },
    {
      question: "Do I need any technical skills to use RobinOS?",
      answer: "No. RobinOS is built for creators, not developers. If you can write a tweet you can ship a workflow. Connect a topic, pick a tone, and the AI handles script → caption → hashtags → voice → publish-ready assets.",
    },
    {
      question: "Can I use RobinOS to run my own business?",
      answer: "Absolutely. The commercial license covers client work, agency output, monetized channels, and paid newsletters. Many users run full creator agencies on RobinOS.",
    },
    {
      question: "How is this different from ChatGPT or other AI writers?",
      answer: "ChatGPT is a general-purpose chatbot. RobinOS is a creator operating system: live trend signals feed directly into AI generation, which feeds directly into captions, hashtags, voice and publishing — without prompt engineering or app-switching. It's the difference between a hammer and a workshop.",
    },
    {
      question: "What if it doesn't work for me?",
      answer: "You have 14 days, no questions asked. Email support and we'll refund your $39. After that, you keep everything you've already created.",
    },
    {
      question: "Will the price go up?",
      answer: "Probably — but never for current buyers. Once you're in at $39, that price is yours for life, even if we raise it for new customers.",
    },
  ];

  return (
    <PublicLayout>
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.035]"
          style={{ background: `radial-gradient(ellipse, ${ACCENT}, transparent 70%)` }} />
        <div className="absolute top-1/3 -left-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: `radial-gradient(ellipse, hsl(8 91% 55%), transparent 70%)` }} />
        <div className="absolute bottom-1/4 -right-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: `radial-gradient(ellipse, hsl(48 91% 55%), transparent 70%)` }} />
      </div>

      {/* ══════════════════ 1. HERO ══════════════════════════ */}
      <section className="relative z-10 px-4 pt-24 pb-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
              style={{ background: `${ACCENT} / 0.08`, border: `1px solid ${ACCENT} / 0.18` }}>
              <motion.span className="w-1.5 h-1.5 rounded-full"
                style={{ background: ACCENT }}
                animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-[11px] font-mono tracking-[0.18em] uppercase" style={{ color: ACCENT, opacity: 0.85 }}>AI Creator OS · WarriorPlus Special</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
              <span className="text-chrome">Stop Juggling</span><br />
              <span className="text-chrome">7 AI Tools.</span><br />
              <span style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SOFT})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Ship in One.
              </span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
              className="text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
              RobinOS is the operating system for creators who actually want to publish.
              Trend intelligence, AI script writing, voice narration, captions and hashtags — one workflow, one payment, lifetime access.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap gap-3 mb-8">
              <WarriorPlusCTA>
                Get Instant Access <ArrowRight className="w-4 h-4" />
              </WarriorPlusCTA>
              <motion.button type="button" onClick={handleWatchDemo} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: `${ACCENT} / 0.06`, border: `1px solid ${ACCENT} / 0.2`, color: ACCENT }}>
                <Play className="w-3.5 h-3.5" /> Watch Demo
              </motion.button>
            </motion.div>

            <WarriorPlusDisclaimer className="mt-2" />

            {/* Trust strip */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-wrap gap-4 mt-6">
              {[
                { value: "14-day", label: "money-back guarantee" },
                { value: "$39", label: "one-time, lifetime" },
                { value: "1-click", label: "instant access" },
              ].map(({ value, label }, i) => (
                <motion.div key={label}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 + i * 0.07 }}
                  className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold font-mono" style={{ color: ACCENT }}>{value}</span>
                  <span className="text-[10px] text-muted-foreground/40">{label}</span>
                  {i < 2 && <span className="text-muted-foreground/20 ml-2">·</span>}
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right — Hero video player (live demo when configured, placeholder otherwise) */}
          <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="relative hidden lg:block">
            <DemoVideo videoUrl={videoUrl} />
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ 2. PROBLEM ═══════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>The Problem</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-3 text-chrome">
            The creator tool stack is broken.
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            You didn't start creating to spend your life duct-taping software together. But here you are.
          </p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: Timer,
              title: "3+ hours per post",
              body: "One TikTok takes 90 minutes of switching tabs before you even hit record.",
            },
            {
              icon: DollarSign,
              title: "$200/mo in subscriptions",
              body: "ChatGPT, ElevenLabs, Trend tools, Caption AI, scheduling — none of them talk to each other.",
            },
            {
              icon: Repeat,
              title: "Zero compounding",
              body: "Every post starts from scratch. Trends expire before you finish your workflow.",
            },
            {
              icon: AlertTriangle,
              title: "Prompt engineering tax",
              body: "You spent more time writing prompts than actually creating — and still get mid output.",
            },
          ].map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 0.06}>
              <motion.div
                className="rounded-2xl p-5 h-full relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, hsl(8 32% 8%), hsl(12 28% 6.5%))", border: "1px solid hsl(8 28% 14%)" }}
                whileHover={{ borderColor: "hsl(8 91% 60% / 0.25)", y: -2 }}
                transition={{ duration: 0.2 }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "hsl(8 91% 60% / 0.1)", border: "1px solid hsl(8 91% 60% / 0.2)" }}>
                  <Icon className="w-5 h-5" style={{ color: "hsl(8 91% 65%)" }} strokeWidth={1.6} />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{body}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.3} className="text-center mt-10">
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            RobinOS collapses that entire stack into a single workflow —
            <span style={{ color: ACCENT }}> one tab, one payment, one lifetime.</span>
          </p>
        </Reveal>
      </section>

      {/* ══════════════════ 3. FEATURES ══════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Features</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Everything you need. Nothing you don't.</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">
            Eight production-grade tools, one operating system, zero feature gates.
          </p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: PenTool,    title: "Script Engine",     description: "AI writes viral scripts for Reels, Shorts, YouTube — with hooks, beats, and visual cues built in.", delay: 0 },
            { icon: TrendingUp, title: "Trend Scanner",     description: "Real-time creator intelligence across YouTube, Reddit, TikTok, and Google. Catch trends before they peak.", delay: 0.05 },
            { icon: Hash,       title: "Caption Engine",    description: "Platform-optimized captions with SEO hashtags, keyword clusters, and viral copy formats.", delay: 0.10 },
            { icon: Mic,        title: "Voice Studio",      description: "ElevenLabs-grade narration in seconds. Natural delivery, multiple tones, instant export.", delay: 0.15 },
            { icon: Zap,        title: "Hook Generator",    description: "10 scroll-stopping hooks per topic. POV, bold statement, story opener, contrarian — all tested.", delay: 0.20 },
            { icon: BarChart3,  title: "Creator Analytics", description: "Understand what's performing. Win rate, hook performance, posting consistency, growth velocity.", delay: 0.25 },
          ].map((tool) => <ToolCard key={tool.title} {...tool} />)}
        </div>
      </section>

      {/* ══════════════════ 4. AI WORKFLOW ═══════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>AI Workflow</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-3 text-chrome">From idea to publish in under 5 minutes</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            One workflow, five steps, zero context-switching. RobinOS runs the loop end-to-end.
          </p>
        </Reveal>
        <div className="relative max-w-2xl mx-auto">
          {[
            { icon: TrendingUp, step: "01", label: "Scan Trends",      desc: "RobinOS pulls live creator signals from YouTube, Reddit, TikTok, and Google — no manual research." },
            { icon: PenTool,    step: "02", label: "Generate Script",   desc: "AI writes a platform-native script with hooks, beats, and visual cues. Edit or auto-ship." },
            { icon: Hash,       step: "03", label: "Build Captions",    desc: "Platform-optimized captions plus trending hashtag clusters generated in the same pass." },
            { icon: Mic,        step: "04", label: "Render Voice",      desc: "ElevenLabs-powered voiceover rendered with the tone and pacing you set once." },
            { icon: Sparkles,   step: "05", label: "Package & Publish", desc: "Script, captions, hashtags, and audio bundled into a publish-ready drop. Zero reformatting." },
          ].map(({ icon: Icon, step, label, desc }, i) => (
            <WorkflowStep key={step} step={step} label={label} description={desc} delay={i * 0.08} />
          ))}
        </div>
      </section>

      {/* ══════════════════ 5. BENEFITS ══════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal>
              <SectionLabel>Benefits</SectionLabel>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-6 text-chrome">Built for creators who actually ship.</h2>
            </Reveal>
            <div className="space-y-5">
              {[
                { title: "Save 12+ hours a week",     desc: "Stop bouncing between apps. One workflow runs the entire pipeline from topic to publish-ready.", delay: 0.08 },
                { title: "Ship 3x more content",      desc: "When generation is sub-3s, the bottleneck disappears. Most users double their output in week one.", delay: 0.14 },
                { title: "Sound human, every time",   desc: "Tone profiles, hook formulas, and platform-native pacing — built into every generation.", delay: 0.20 },
                { title: "Own your stack forever",    desc: "$39 one-time. No tiers to upgrade into, no usage caps, no surprise price hikes. Yours for life.", delay: 0.26 },
              ].map(({ title, desc, delay }) => (
                <Reveal key={title} delay={delay}>
                  <div className="flex gap-4">
                    <div className="w-1 rounded-full shrink-0 mt-1"
                      style={{ background: `linear-gradient(180deg, ${ACCENT}, ${ACCENT_SOFT})`, minHeight: "40px" }} />
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
                { icon: Timer,     label: "Sub-3s scripts",  sub: "Generation, not waiting" },
                { icon: Repeat,    label: "12h+ saved/week", sub: "vs. the manual stack" },
                { icon: TrendingUp, label: "3x output",       sub: "Most users, week one" },
                { icon: DollarSign, label: "$39 once",        sub: "No renewals, ever" },
              ].map(({ icon: Icon, label, sub }) => (
                <motion.div key={label} className="rounded-2xl p-5"
                  style={{ background: "linear-gradient(135deg, hsl(28 32% 8%), hsl(22 28% 6.5%))", border: "1px solid hsl(28 28% 12%)" }}
                  whileHover={{ borderColor: `${ACCENT} / 0.2`, y: -2 }} transition={{ duration: 0.2 }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: `${ACCENT} / 0.1`, border: `1px solid ${ACCENT} / 0.2` }}>
                    <Icon className="w-4 h-4" style={{ color: ACCENT }} strokeWidth={1.6} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                </motion.div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════ 6. PRICING ($39 LIFETIME) ═════════ */}
      <section id="pricing" className="relative z-10 px-4 py-24 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-3 text-chrome">
            One plan. One payment. Lifetime access.
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            No tiers. No upsells. No monthly bills. Just the full operating system.
          </p>
        </Reveal>
        <PricingCard delay={0.1} />
      </section>

      {/* ══════════════════ 7. FAQ ═══════════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[800px] mx-auto">
        <Reveal className="text-center mb-10">
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Common questions</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">
            Everything you might wonder before grabbing RobinOS on WarriorPlus.
          </p>
        </Reveal>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <FAQItem key={faq.question} question={faq.question} answer={faq.answer} index={i} />
          ))}
        </div>
      </section>

      {/* ══════════════════ 8. FINAL CTA ═════════════════════ */}
      <section className="relative z-10 px-4 py-24 sm:px-6 lg:px-8 max-w-[900px] mx-auto text-center">
        <Reveal>
          <motion.div className="relative rounded-3xl overflow-hidden px-8 py-16"
            style={{ background: "linear-gradient(135deg, hsl(28 32% 9%), hsl(22 28% 7%))", border: `1px solid ${ACCENT} / 0.25`, boxShadow: `0 0 120px ${ACCENT} / 0.08` }}
            whileInView={{ boxShadow: [`0 0 60px ${ACCENT} / 0.04`, `0 0 120px ${ACCENT} / 0.1`, `0 0 60px ${ACCENT} / 0.04`] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${ACCENT} / 0.08, transparent)` }} />
            <SectionLabel>Get Started</SectionLabel>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 mb-4 text-chrome">
              Your operating system<br />is one click away.
            </h2>
            <p className="text-muted-foreground text-sm mb-10 max-w-md mx-auto">
              Pay once, own forever. Ship faster today than you did all of last week.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <WarriorPlusCTA>
                <Wand2 className="w-4 h-4" /> Launch RobinOS
              </WarriorPlusCTA>
              <motion.a href="#pricing" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: `${ACCENT} / 0.06`, border: `1px solid ${ACCENT} / 0.2`, color: ACCENT }}>
                See What's Included
              </motion.a>
            </div>

            <WarriorPlusDisclaimer align="center" className="mt-4" />
          </motion.div>
        </Reveal>
      </section>

      {/* ══════════════════ 9. FOOTER ════════════════════════ */}
      {/* Page-level footer is rendered by PublicLayout (PublicFooter). */}
      {/* No additional footer markup required here. */}

      <WarriorPlusSalesScript />
      <WarriorPlusTrackingPixel />
    </PublicLayout>
  );
}
