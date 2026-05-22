import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView, useScroll, useTransform } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Lenis from "lenis";
import { ChevronDown, Scan, Video, BarChart3, Globe, Check, Zap, Shield, Clock, Music, Mic, Layers, Brain, Hash, Type } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { getLandingPricingPlans, getCurrencySymbol } from "@/lib/pricing";
import { BrandMark } from "@/components/BrandMark";
import { PublicNavbar } from "@/components/public/PublicNavbar";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PageSeo } from "@/components/seo/PageSeo";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

/* ─── Scroll-triggered section wrapper ─── */
const RevealSection = ({
  children,
  className = "",
  delay = 0,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.8, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.section>
  );
};

const faqItems = [
  { q: "What is RobinOS?", a: "RobinOS is an AI-powered autonomous marketing platform built for creators, freelancers, and agencies. It scans real-time trends, generates viral scripts, discovers trending audio & hashtags, and helps you stay ahead — all from a single Command Center." },
  { q: "How does the BYOK (Bring Your Own Key) model work?", a: "You connect your own OpenAI and ElevenLabs API keys in the Settings tab. We never mark up API costs — you pay providers directly at their rates. Your keys are encrypted with AES-256 and never stored in plaintext. BYOK is available on Pro Creator and Agency plans." },
  { q: "What plans do you offer?", a: "We offer four plans: Free (24hr trial with 1 scan, 2 scripts, 2 audio scans, 3 hashtag scans), Creator ($19/mo — 20 scripts/day, trend discovery, hashtag research), Pro Creator ($39/mo — 100 scripts/day, advanced optimization, analytics), and Agency ($99/mo — team workspaces, unlimited generations with fair usage, white-label exports). All paid plans come with a 14-day money-back guarantee." },
  { q: "What is Trending Audio & Hashtag Discovery?", a: "Our AI scans TikTok, Instagram, Facebook & YouTube to find currently viral audio tracks and trending hashtags. It surfaces global creator momentum and platform-level trend signals for international teams. Results update with every scan — so you always get fresh, real-time data." },
  { q: "Is there a free trial?", a: "Yes! The Free plan gives you 1 scan, 2 scripts, 2 trending audio scans, and 3 hashtag scans within 24 hours to test the platform. No credit card required." },
  { q: "How does the Affiliate Program work?", a: "After signing up, you get a unique referral link in your dashboard's Referrals tab. You earn commissions when your referred users subscribe to any paid plan. Monthly plans give recurring commission; yearly plans give one-time commission. Check your dashboard for current commission rates and minimum withdrawal threshold." },
  { q: "Which platforms are supported for Trending Audio & Hashtags?", a: "Free and Creator plans support Instagram only. Pro Creator and Agency plans unlock TikTok, Instagram, Facebook & YouTube — covering all major platforms for both audio and hashtag discovery." },
  { q: "Is my data secure?", a: "Yes. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). Row-level security ensures you can only access your own data. API keys are encrypted and never logged or cached." },
  { q: "Can I cancel my subscription anytime?", a: "Absolutely. All plans are month-to-month with no lock-in. Cancel anytime from your dashboard. We also offer a 14-day money-back guarantee — no questions asked." },
];

const engines = [
  {
    icon: Scan,
    title: "Scan",
    desc: "Real-time trend scanning across platforms. Know what's viral before it peaks.",
    color: "from-primary/20 to-primary/5",
    stats: "Always-on monitoring",
  },
  {
    icon: Video,
    title: "Create",
    desc: "Script to video in seconds. AI-powered content generation at scale.",
    color: "from-primary/15 to-primary/5",
    stats: "Fast generation",
  },
  {
    icon: BarChart3,
    title: "Analyze",
    desc: "Deep performance analytics with AI insights. Track what works, optimize what doesn't.",
    color: "from-primary/20 to-primary/5",
    stats: "Real-time insights",
  },
  {
    icon: Globe,
    title: "Distribute",
    desc: "One-click global posting. Every platform. Every format. Instantly.",
    color: "from-primary/15 to-primary/5",
    stats: "Multi-platform",
  },
  {
    icon: Music,
    title: "Trending Audio",
    desc: "Discover viral sounds across TikTok, Instagram, Facebook & YouTube. global trending tracks updated with every scan.",
    color: "from-primary/20 to-primary/5",
    stats: "Global-ready",
  },
  {
    icon: Hash,
    title: "Trending Hashtags",
    desc: "Real trending hashtags from all major platforms. Know exactly which tags to use for maximum reach.",
    color: "from-primary/15 to-primary/5",
    stats: "Real-time tags",
  },
  {
    icon: Mic,
    title: "Voice Over",
    desc: "AI-powered voice generation with natural multilingual narration. Multiple voice styles.",
    color: "from-primary/20 to-primary/5",
    stats: "AI Voices",
  },
  {
    icon: Brain,
    title: "Script AI",
    desc: "Generate viral scripts with AI. Optimized for hooks, engagement, and audience retention.",
    color: "from-primary/15 to-primary/5",
    stats: "Smart scripts",
  },
  {
    icon: Layers,
    title: "Video Studio",
    desc: "Full video creation pipeline. From script to final edit — completely automated.",
    color: "from-primary/20 to-primary/5",
    stats: "End-to-end",
  },
];

const creatorFeatureCards = [
  {
    title: "AI Script Creator",
    subtitle: "Short-form Workflow",
    features: [
      "AI-assisted content pipeline",
      "Caption optimization",
      "Content planning support",
      "Fast generation workflow",
    ],
  },
  {
    title: "Growth Creator",
    subtitle: "Content Strategy",
    features: [
      "Multi-platform workflow",
      "AI caption engine",
      "Trend discovery tools",
      "Workflow optimization",
    ],
  },
  {
    title: "Automation Creator",
    subtitle: "Content Automation",
    features: [
      "AI-powered workflows",
      "Creator dashboard",
      "Fast generation system",
      "Automation infrastructure",
    ],
  },
];

const credibilityStrip = [
  "AI-powered content workflow",
  "Built for modern creators",
  "Designed for content teams",
  "Professional creator infrastructure",
];

const captionEngineBullets = [
  "SEO-optimized YouTube descriptions",
  "High-retention TikTok captions",
  "Instagram creator formatting",
  "Facebook storytelling captions",
  "Smart hashtags & keyword support",
  "Platform-aware writing styles",
];

type EntryPageProps = {
  initialSection?: "pricing" | "mini-demo";
};

const EntryPage = ({ initialSection }: EntryPageProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const { currency } = useCurrency();
  const { data: platformSettings } = usePlatformSettings();
  const symbol = getCurrencySymbol(currency);
  const referralParam = searchParams.get("ref")?.trim() ?? "";
  const authHref = referralParam ? `/auth?ref=${encodeURIComponent(referralParam)}` : "/auth";
  const seoPath = initialSection === "pricing" ? "/pricing" : initialSection === "mini-demo" ? "/minidemo" : "/";
  const seoTitle = initialSection === "pricing"
    ? "RobinOS Pricing | AI Content Operating System"
    : initialSection === "mini-demo"
      ? "RobinOS Mini Demo | AI Content Operating System"
      : "RobinOS — AI Content Operating System";
  const seoDescription = initialSection === "pricing"
    ? "Compare RobinOS plans for creators and agencies with AI scripts, trend scanning, and content workflow automation."
    : initialSection === "mini-demo"
      ? "See RobinOS mini demo and how creators generate viral-ready scripts, trends, and AI-powered workflows faster."
      : "RobinOS helps creators generate AI scripts, run trend analysis, automate voice workflows, and scale content systems faster.";

  // Lenis smooth scroll
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const lenis = new Lenis({
      duration: 0.9,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: true,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    return () => lenis.destroy();
  }, []);

  useEffect(() => {
    if (!initialSection) return;

    const jumpToSection = () => {
      const node = document.getElementById(initialSection);
      if (node) {
        node.scrollIntoView({ behavior: "auto", block: "start" });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    };

    let rafB = 0;
    const rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(jumpToSection);
    });

    return () => {
      cancelAnimationFrame(rafA);
      if (rafB) cancelAnimationFrame(rafB);
    };
  }, [initialSection]);

  // 3D tilt on scroll for dashboard mockup
  const mockupRef = useRef(null);
  const { scrollYProgress: mockupScroll } = useScroll({
    target: mockupRef,
    offset: ["start end", "end start"],
  });
  const rotateX = useTransform(mockupScroll, [0, 0.5, 1], [12, 0, -6]);
  const mockupY = useTransform(mockupScroll, [0, 1], [60, -60]);

  // Blur-to-sharp for friction section
  const frictionRef = useRef(null);
  const { scrollYProgress: frictionScroll } = useScroll({
    target: frictionRef,
    offset: ["start end", "center center"],
  });
  const frictionBlur = useTransform(frictionScroll, [0, 1], [16, 0]);
  const frictionOpacity = useTransform(frictionScroll, [0, 1], [0.3, 1]);

  // Mini demo typing animation
  const demoRef = useRef<HTMLDivElement>(null);
  const demoInView = useInView(demoRef, { once: true, margin: "-80px" });
  const [visibleLines, setVisibleLines] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!demoInView) return;
    const delays = [600, 1600, 2600];
    const timers = delays.map((delay, i) =>
      setTimeout(() => setVisibleLines(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [demoInView]);

  const pricingControls = {
    creator_price: platformSettings?.creator_price,
    pro_price: platformSettings?.pro_price,
    agency_price: platformSettings?.agency_price,
  };

  const monthlyPlans = getLandingPricingPlans(currency, "monthly", pricingControls);
  const yearlyPlans = getLandingPricingPlans(currency, "yearly", pricingControls);
  const plans = billingCycle === "yearly" ? yearlyPlans : monthlyPlans;

  const parseAmount = (value?: string) => Number((value ?? "0").replace(/[^\d.]/g, ""));
  const yearlyBadgeByTier: Record<string, { primary: string; secondary?: string }> = {
    creator: { primary: "2 Months Free" },
    pro_creator: { primary: "Most Popular", secondary: "Best Value" },
    agency: { primary: "Scale Faster" },
  };

  return (
    <div className="relative bg-background grain select-none-all overflow-x-hidden">
      <PageSeo
        title={seoTitle}
        description={seoDescription}
        canonicalPath={seoPath}
        keywords="ai content operating system, ai script generator, creator workflow automation, trending audio discovery, trending hashtag tool"
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "RobinOS",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            url: seoPath,
            description: seoDescription,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "RobinOS",
            url: "/",
            potentialAction: {
              "@type": "SearchAction",
              target: "/docs",
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />
      <div className="ambient-glow" />
      <PublicNavbar />

      {/* ─── Global Maintenance Banner (same query as usePlatformSettings) ─── */}
      <AnimatePresence>
        {platformSettings?.maintenance_mode && (
          <motion.div
            key="entry-maintenance-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative z-20 border-b"
            style={{
              background: "linear-gradient(90deg, hsl(217 91% 60% / 0.08), hsl(217 91% 60% / 0.04), hsl(217 91% 60% / 0.08))",
              borderColor: "hsl(217 91% 60% / 0.22)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-4 py-2.5 sm:px-6">
              <span
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full animate-pulse"
                style={{
                  background: "hsl(217 91% 60%)",
                  boxShadow: "0 0 8px hsl(217 91% 60% / 0.6)",
                  animationDuration: "2s",
                }}
              />
              <svg className="flex-shrink-0 h-3.5 w-3.5 text-primary/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <p className="text-[11px] font-mono text-muted-foreground flex-1 truncate">
                {platformSettings.announcement_banner?.trim() || "Platform maintenance is in progress. Some features may be temporarily limited."}
              </p>
              <span className="flex-shrink-0 text-[9px] font-mono text-primary/60 uppercase tracking-widest">Operational Notice</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── 1. HERO ─── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] sm:w-[700px] h-[500px] sm:h-[700px] rounded-full bg-primary/8 blur-[150px] animate-pulse" style={{ animationDuration: '4s' }} />
          <div className="absolute top-1/3 left-1/4 w-[200px] h-[200px] rounded-full bg-primary/4 blur-[100px]" />
          <div className="absolute top-1/4 right-1/4 w-[150px] h-[150px] rounded-full bg-primary/3 blur-[80px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, filter: "blur(16px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative z-10 flex flex-col items-center gap-6 sm:gap-8 text-center"
        >
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.8 }}>
            <BrandMark size={46} withWordmark className="drop-shadow-[0_0_20px_hsl(217_91%_60%/0.26)]" />
          </motion.div>

          <h1 className="text-chrome text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-semibold leading-[1.05] tracking-tight max-w-4xl px-2">
            Your AI Content Operating System.
          </h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="text-muted-foreground text-sm sm:text-base max-w-md px-4"
          >
            Generate viral-ready scripts, discover trends, analyze content opportunities, and scale your content workflow with RobinOS.
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="text-[10px] text-muted-foreground/50 font-mono"
          >
            AI Content Operating System
          </motion.p>

          {/* Trust / Compliance badges */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0, duration: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-2 px-4"
          >
            {[
              { dot: "bg-emerald-400", label: "AI Moderation Active" },
              { dot: "bg-emerald-400", label: "Responsible AI Platform" },
              { dot: "bg-blue-400",    label: "Enterprise-grade Safety" },
              { dot: "bg-emerald-400", label: "Abuse Prevention Enabled" },
            ].map(({ dot, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-mono tracking-wider"
                style={{
                  background: "hsl(217 91% 60% / 0.05)",
                  border: "1px solid hsl(217 91% 60% / 0.12)",
                  color: "hsl(var(--muted-foreground) / 0.5)",
                }}
              >
                <span className={`w-1 h-1 rounded-full animate-pulse ${dot}`} style={{ animationDuration: "2.5s" }} />
                {label}
              </span>
            ))}
          </motion.div>

          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 mt-4 w-full sm:w-auto px-4 sm:px-0">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              whileHover={{ scale: 1.02, y: -1, boxShadow: "0 8px 32px hsl(217 91% 60% / 0.35), 0 0 0 1px hsl(217 91% 60% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
              whileTap={{ scale: 0.98, y: 0 }}
              onClick={() => navigate(authHref)}
              className="btn-primary shimmer-btn w-full sm:w-auto !px-8 !py-3"
            >
              Start Creating →
            </motion.button>
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.6 }}
              whileHover={{ scale: 1.02, y: -1, boxShadow: "0 6px 24px hsl(0 0% 0% / 0.28), 0 0 0 1px hsl(217 91% 60% / 0.07)" }}
              whileTap={{ scale: 0.98, y: 0 }}
              onClick={() => document.getElementById("mini-demo")?.scrollIntoView({ behavior: "smooth" })}
              className="btn-secondary w-full sm:w-auto !px-8 !py-3"
            >
              Watch Demo
            </motion.button>
          </div>

          {/* Trust Elements */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.3, duration: 0.8 }}
            className="flex items-center gap-6 mt-6 text-muted-foreground/50"
          >
            <span className="text-[11px] font-mono">AI-powered content workflow</span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
            <span className="text-[11px] font-mono">Built for modern creators</span>
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-10 flex flex-col items-center gap-2"
        >
          <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground/50">Scroll</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown className="w-4 h-4 text-chrome-dim" />
          </motion.div>
        </motion.div>
      </section>

      <div className="px-4 sm:px-6">
        <div className="max-w-5xl mx-auto border-y border-border/50 bg-card/20 backdrop-blur-sm py-2.5 sm:py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-3 sm:gap-x-4 px-3 sm:px-5">
            {credibilityStrip.map((item) => (
              <p key={item} className="text-[10px] sm:text-[11px] text-muted-foreground/80 font-mono tracking-[0.12em] uppercase text-center truncate">
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* ─── CREATOR WORKFLOW SECTION ─── */}
      <RevealSection className="py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 sm:mb-10">
            <p className="text-[10px] sm:text-xs font-mono tracking-[0.28em] uppercase text-muted-foreground/70 mb-3">Creator Workflows</p>
            <h2 className="text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              Built For Modern Content Creators
            </h2>
            <p className="mt-3 text-muted-foreground text-xs sm:text-sm max-w-xl mx-auto px-2">
              AI-powered workflows for creators, brands, and content teams.
            </p>
          </div>

          <div className="md:hidden -mx-4 px-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-4 w-max">
              {creatorFeatureCards.map((card) => (
                <motion.article
                  key={card.title}
                  className="snap-start w-[280px] rounded-2xl glass-card card-glow p-4 border border-border/70 shadow-[0_18px_45px_hsl(0_0%_0%/0.35)] overflow-hidden relative"
                  whileHover={{ y: -4, boxShadow: "0 24px 60px hsl(0 0% 0% / 0.45), 0 0 0 1px hsl(217 91% 60% / 0.18)" }}
                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                >
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <p className="text-sm font-semibold text-foreground">{card.title}</p>
                  <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-primary/90">{card.subtitle}</p>
                  <ul className="mt-4 space-y-2.5">
                    {card.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2.5 rounded-lg bg-card/50 border border-border/60 px-3 py-2 transition-all duration-200 hover:border-primary/25 hover:bg-primary/[0.04]">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                        <span className="text-xs text-foreground/90">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </motion.article>
              ))}
            </div>
          </div>

          <div className="hidden md:grid grid-cols-3 gap-4">
            {creatorFeatureCards.map((card) => (
              <motion.article
                key={card.title}
                className="group rounded-2xl glass-card card-glow p-5 border border-border/70 shadow-[0_18px_45px_hsl(0_0%_0%/0.35)] overflow-hidden relative"
                whileHover={{ y: -4, boxShadow: "0 24px 60px hsl(0 0% 0% / 0.45), 0 0 0 1px hsl(217 91% 60% / 0.18)" }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
              >
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <p className="text-base font-semibold text-foreground">{card.title}</p>
                <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-primary/90">{card.subtitle}</p>
                <ul className="mt-4 space-y-2.5">
                  {card.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5 rounded-lg bg-card/50 border border-border/60 px-3 py-2 transition-all duration-200 hover:border-primary/25 hover:bg-primary/[0.04]">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      <span className="text-xs text-foreground/90">{feature}</span>
                    </li>
                  ))}
                </ul>
              </motion.article>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ─── MINI DEMO ─── */}
      <RevealSection id="mini-demo" className="py-16 px-4 sm:px-6 max-w-2xl mx-auto">
        <div ref={demoRef} className="glass-card p-6 sm:p-8 relative overflow-hidden">
          {/* Ambient internal glow */}
          <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary/5 blur-[60px] pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-primary/4 blur-[50px] pointer-events-none" />

          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-primary">⚡ Live AI Generation</p>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ACTIVE
            </span>
          </div>

          <div className="mb-4">
            {/* Input row */}
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-secondary/50 border border-border/30">
              <span className="text-muted-foreground/40 text-sm">Topic:</span>
              <span className="text-foreground text-sm">"How to grow on Instagram"</span>
            </div>

            {/* Connector */}
            <div className="flex justify-center my-3">
              <div
                className="w-px h-8 bg-gradient-to-b from-primary/60 to-transparent animate-pulse"
                style={{ animationDuration: "2.5s" }}
              />
            </div>

            {/* Output panel */}
            <div
              className="px-4 py-4 rounded-xl bg-primary/5 border border-primary/20 transition-all duration-700"
              style={{
                boxShadow: visibleLines < 3
                  ? "inset 0 0 30px hsl(217 91% 60% / 0.04), 0 0 20px hsl(217 91% 60% / 0.06)"
                  : "inset 0 0 30px hsl(217 91% 60% / 0.04)",
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono text-primary">🎬 SCRIPT OUTPUT:</p>
                <span className="text-[9px] font-mono text-muted-foreground/40 tracking-widest">
                  {visibleLines >= 3 ? "COMPLETE" : "GENERATING..."}
                </span>
              </div>

              {/* Line 1 */}
              <motion.p
                initial={{ opacity: 0, x: -4 }}
                animate={visibleLines >= 1 ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="text-foreground text-sm leading-relaxed font-medium"
              >
                "Nobody is telling you this about Instagram workflow quality..."
              </motion.p>

              {/* Line 2 */}
              <motion.p
                initial={{ opacity: 0, x: -4 }}
                animate={visibleLines >= 2 ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="text-foreground/80 text-sm leading-relaxed mt-1"
              >
                "Delete your hashtag strategy. Here's what actually works in 2026."
              </motion.p>

              {/* Line 3 */}
              <motion.p
                initial={{ opacity: 0, x: -4 }}
                animate={visibleLines >= 3 ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="text-foreground/70 text-sm leading-relaxed mt-1"
              >
                "Use this structure to build a consistent, platform-ready content workflow."
              </motion.p>

              {/* Blinking cursor — hides when done */}
              {visibleLines < 3 && (
                <span
                  className="inline-block mt-1 w-[7px] h-[14px] rounded-sm align-middle"
                  style={{
                    background: "hsl(217 91% 60%)",
                    opacity: cursorVisible ? 0.9 : 0,
                    transition: "opacity 0.1s",
                  }}
                />
              )}
            </div>
          </div>
          <p className="text-center text-muted-foreground/50 text-[11px] font-mono">Fast generation workflow</p>
        </div>
      </RevealSection>

      {/* ─── 2. FRICTION ─── */}
      <section ref={frictionRef} className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-32 relative overflow-hidden">
        {/* Floating fragmented words — subliminal tension */}
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
          {[
            { text: "12 tabs open", top: "18%", left: "8%", delay: 0 },
            { text: "context switching", top: "28%", right: "10%", delay: 0.4 },
            { text: "manual research", top: "55%", left: "6%", delay: 0.8 },
            { text: "export → copy → paste", top: "70%", right: "8%", delay: 0.6 },
            { text: "no system", top: "42%", left: "72%", delay: 1.0 },
            { text: "re-doing everything", top: "82%", left: "18%", delay: 0.3 },
          ].map((f) => (
            <motion.span
              key={f.text}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: f.delay, duration: 1.2 }}
              className="absolute text-[10px] sm:text-xs font-mono text-foreground/[0.045] tracking-widest uppercase whitespace-nowrap"
              style={{ top: f.top, left: (f as any).left, right: (f as any).right }}
            >
              {f.text}
            </motion.span>
          ))}
        </div>

        <motion.div
          style={{ filter: useTransform(frictionBlur, (v) => `blur(${v}px)`), opacity: frictionOpacity }}
          className="relative text-center max-w-3xl z-10"
        >
          <h2 className="text-chrome text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-tight">
            Broken. Expensive.
            <br />
            Manual.
          </h2>
          <p className="mt-6 sm:mt-8 text-muted-foreground text-sm sm:text-base max-w-lg mx-auto leading-relaxed px-4">
            Traditional content workflows are fragmented and slow. RobinOS unifies trend discovery, scripting, and execution in one operating system.
          </p>
        </motion.div>
      </section>

      {/* ─── 3. THE REVEAL (Dashboard Mockup) ─── */}
      <RevealSection className="py-24 md:py-40 px-4 sm:px-6 flex flex-col items-center">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-6">RobinOS Command Center</p>
        <div ref={mockupRef} className="w-full max-w-4xl" style={{ perspective: "1200px" }}>
          <motion.div
            style={{ rotateX, y: mockupY }}
            className="w-full rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden shadow-2xl shadow-primary/5 relative"
          >
            {/* Subtle scan line that sweeps top-to-bottom once on load */}
            <motion.div
              initial={{ top: "-4px", opacity: 0.5 }}
              animate={{ top: "100%", opacity: 0 }}
              transition={{ delay: 1.2, duration: 2.2, ease: "linear" }}
              className="absolute left-0 right-0 h-[2px] pointer-events-none z-20"
              style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.35), transparent)" }}
            />

            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/15" />
              <div className="ml-4 h-2 w-24 sm:w-32 rounded bg-muted" />
              {/* Live indicator */}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />
                <span className="text-[9px] font-mono text-emerald-400/70 tracking-widest">LIVE</span>
              </div>
            </div>
            <div className="flex">
              <div className="hidden sm:flex flex-col w-48 border-r border-border p-4 gap-1">
                {["Creator Intel", "Script Engine", "Caption Engine", "Voice Studio", "Idea Stream", "History", "Referrals", "Settings"].map((item, i) => (
                  <div key={item} className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs ${i === 0 ? 'bg-primary/10 border border-primary/20' : ''}`}>
                    <div className={`w-3.5 h-3.5 rounded ${i === 0 ? 'bg-primary/40' : 'bg-muted'}`} />
                    <span className={`${i === 0 ? 'text-primary' : 'text-muted-foreground/60'}`}>{item}</span>
                  </div>
                ))}
              </div>
              <div className="flex-1 p-4 sm:p-6 md:p-8">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-6">
                  {[
                    { label: "Signal State", value: "Live", pulse: true },
                    { label: "Script Engine", value: "Active", pulse: true },
                    { label: "Workflow Sync", value: "Online", pulse: false },
                    { label: "System Health", value: "Stable", pulse: false },
                  ].map((stat, si) => (
                    <div key={stat.label} className="rounded-lg bg-secondary/50 border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground/60 font-mono">{stat.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {stat.pulse && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"
                            style={{ animationDelay: `${si * 0.4}s`, animationDuration: "2.5s" }}
                          />
                        )}
                        <p className="text-lg sm:text-xl font-semibold text-chrome">{stat.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {["AI in Content Creation", "Short-Form Video Trends", "Creator Economy Growth", "Voice AI Revolution"].map((trend, ti) => (
                    <motion.div
                      key={trend}
                      initial={{ opacity: 0, x: -6 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.8 + ti * 0.1, duration: 0.4 }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card/40 border border-border/30"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 animate-pulse"
                        style={{ animationDelay: `${ti * 0.6}s`, animationDuration: "3s" }}
                      />
                      <span className="text-xs text-foreground/70 flex-1 truncate">{trend}</span>
                      <div className="hidden sm:block h-5 w-12 rounded bg-primary/10 border border-primary/20" />
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </RevealSection>

      {/* ─── 4. THE ENGINES (Bento Grid) ─── */}
      <RevealSection id="features" className="py-24 md:py-40 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="text-center mb-12 sm:mb-16">
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">The Engine Room</p>
          <h2 className="text-chrome text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
            Connected Engines. One Machine.
          </h2>
          <p className="mt-4 text-muted-foreground text-sm max-w-lg mx-auto">
            Every engine works in sync to deliver results that compound over time.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {engines.map((engine, i) => (
            <motion.article
              key={engine.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.07, duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
              whileHover={{ y: -5, boxShadow: "0 20px 52px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(217 91% 60% / 0.16)" }}
              className="group relative rounded-xl border border-border/60 bg-card/40 p-6 sm:p-7 overflow-hidden"
              style={{
                boxShadow: "0 4px 20px hsl(0 0% 0% / 0.25)",
                transition: "border-color 0.3s, background-color 0.3s",
              }}
            >
              {/* Top edge glow on hover */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              {/* Internal gradient bloom */}
              <div className={`absolute inset-0 bg-gradient-to-br ${engine.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-5">
                  {/* Icon in a pill container */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:shadow-[0_0_16px_hsl(217_91%_60%/0.25)]"
                    style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.18)" }}
                  >
                    <motion.div whileHover={{ rotate: 8, scale: 1.15 }} transition={{ type: "spring", stiffness: 350, damping: 14 }}>
                      <engine.icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    </motion.div>
                  </div>
                  <span className="text-[10px] font-mono tracking-wider text-primary/50 uppercase pt-1">{engine.stats}</span>
                </div>
                <h3 className="text-chrome text-base font-semibold mb-2">{engine.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{engine.desc}</p>
              </div>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="group mt-6 sm:mt-8 rounded-xl border border-primary/20 bg-card/45 backdrop-blur-xl p-6 sm:p-8 shadow-[0_12px_40px_hsl(217_91%_60%/0.08),inset_0_1px_0_hsl(0_0%_100%/0.05)] relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="flex items-center gap-2.5 mb-4">
            <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-mono tracking-[0.14em] uppercase text-primary">NEW</span>
            <Type className="w-4 h-4 text-primary" />
          </div>
          <h3 className="text-chrome text-2xl font-semibold tracking-tight">Caption Engine</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Generate platform-optimized captions and descriptions designed for discoverability and content clarity.
          </p>
          <div className="mt-5 grid sm:grid-cols-2 gap-2.5">
            {captionEngineBullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-secondary/25 px-3 py-2.5 transition-all duration-200 hover:border-primary/25 hover:bg-primary/[0.04]">
                <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/85">{bullet}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-6 sm:gap-10"
        >
          {[
            { icon: Shield, text: "AES-256 Encryption" },
            { icon: Zap, text: "Fast Generation" },
            { icon: Clock, text: "Always-On Monitoring" },
          ].map((badge) => (
            <div key={badge.text} className="flex items-center gap-2 text-muted-foreground/50">
              <badge.icon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono tracking-wider uppercase">{badge.text}</span>
            </div>
          ))}
        </motion.div>
      </RevealSection>

      <RevealSection id="affiliates" className="py-18 md:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(140deg, hsl(222 28% 8% / 0.97) 0%, hsl(220 32% 9% / 0.97) 60%, hsl(222 26% 7% / 0.97) 100%)",
            border: "1px solid hsl(217 28% 14%)",
            boxShadow: "0 24px 80px hsl(0 0% 0% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
          }}
        >
          {/* Top edge shimmer */}
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.35) 40%, hsl(217 91% 60% / 0.35) 60%, transparent 100%)" }} />
          {/* Localized ambient — NOT full width neon */}
          <div className="absolute bottom-0 left-1/4 w-64 h-32 pointer-events-none" style={{ background: "radial-gradient(ellipse at center bottom, hsl(217 91% 60% / 0.06), transparent 70%)", filter: "blur(24px)" }} />

          <div className="relative grid grid-cols-1 gap-10 p-6 sm:p-8 md:p-10 lg:grid-cols-2 lg:gap-12 lg:p-12">

            {/* ─── LEFT ─── */}
            <div className="flex flex-col justify-center">
              {/* Label */}
              <div className="flex items-center gap-2 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-pulse" style={{ animationDuration: "2.5s" }} />
                <span className="text-[9px] font-mono tracking-[0.28em] uppercase text-primary/70">Affiliate Program</span>
              </div>

              {/* Headline */}
              <h2
                className="text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1]"
                style={{ letterSpacing: "-0.02em" }}
              >
                Earn recurring<br />
                commissions with<br />
                <span className="text-primary/90">RobinOS.</span>
              </h2>

              {/* Copy */}
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-sm">
                Join our partner ecosystem and earn {platformSettings?.affiliate_commission_percent ?? 30}% monthly recurring commission on every paid referral. Real-time tracking, monthly payouts, and transparent analytics.
              </p>

              {/* Metric cards */}
              <div className="mt-7 grid grid-cols-3 gap-2.5 max-w-sm">
                {[
                  { value: `${platformSettings?.affiliate_commission_percent ?? 30}%`, label: "Commission", color: "hsl(217 91% 60%)" },
                  { value: `$${platformSettings?.minimum_withdrawal ?? 25}`, label: "Min Payout", color: "hsl(142 70% 50%)" },
                  { value: "Monthly", label: "Recurring", color: "hsl(38 92% 55%)" },
                ].map((m) => (
                  <motion.div
                    key={m.label}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.18 }}
                    className="rounded-xl px-3 py-3 text-center"
                    style={{
                      background: "hsl(222 28% 5.5%)",
                      border: `1px solid ${m.color.replace(")", " / 0.16)")}`,
                      boxShadow: `0 2px 12px ${m.color.replace(")", " / 0.06)")}`,
                    }}
                  >
                    <p className="text-lg font-bold tracking-tight" style={{ fontVariantNumeric: "tabular-nums", color: m.color }}>{m.value}</p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground/45 mt-0.5">{m.label}</p>
                  </motion.div>
                ))}
              </div>

              {/* CTA */}
              <div className="mt-7">
                <motion.div
                  whileHover={{ y: -2, boxShadow: "0 8px 28px hsl(217 91% 60% / 0.28)" }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-block"
                >
                  <Link
                    to="/affiliates"
                    className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all"
                    style={{
                      background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 78% 44%))",
                      boxShadow: "0 4px 16px hsl(217 91% 60% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
                    }}
                  >
                    Join Affiliate Program
                    <motion.span
                      animate={{ x: [0, 3, 0] }}
                      transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                    >
                      →
                    </motion.span>
                  </Link>
                </motion.div>
                <p className="mt-2.5 text-[10px] font-mono text-muted-foreground/35 tracking-wider">
                  Paid monthly · Fraud protection · Real-time tracking
                </p>
              </div>
            </div>

            {/* ─── RIGHT — Affiliate Dashboard Preview ─── */}
            <div className="relative flex items-center justify-center lg:justify-end">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.15 }}
                animate={{ y: [0, -5, 0] }}
                // @ts-ignore
                style={{ animationDuration: "6s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite" }}
                className="w-full max-w-sm"
              >
                {/* Dashboard shell */}
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "hsl(222 30% 6%)",
                    border: "1px solid hsl(217 28% 12%)",
                    boxShadow: "0 24px 64px hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(217 91% 60% / 0.06)",
                  }}
                >
                  {/* Window chrome */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400/50" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/50" />
                    </div>
                    <span className="text-[9px] font-mono text-muted-foreground/30 tracking-wider">AFFILIATE DASHBOARD</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Earnings header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35">Total Earned</p>
                        <p className="text-2xl font-bold text-foreground/90 mt-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>$1,247.50</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35">Pending</p>
                        <p className="text-base font-bold mt-0.5" style={{ color: "hsl(142 70% 55%)", fontVariantNumeric: "tabular-nums" }}>$183.20</p>
                      </div>
                    </div>

                    {/* Mini commission graph — SVG sparkline */}
                    <div className="rounded-xl overflow-hidden" style={{ background: "hsl(222 32% 4.5%)", border: "1px solid hsl(217 28% 10%)" }}>
                      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                        <span className="text-[8.5px] font-mono text-muted-foreground/35 tracking-wider">COMMISSION TREND</span>
                        <span className="text-[8.5px] font-mono text-emerald-400/70">+28%</span>
                      </div>
                      <svg viewBox="0 0 260 56" className="w-full" style={{ height: "56px" }}>
                        <defs>
                          <linearGradient id="affGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0,48 L30,42 L60,36 L90,38 L120,28 L150,22 L180,18 L210,12 L240,8 L260,6 L260,56 L0,56 Z" fill="url(#affGrad)" />
                        <path d="M0,48 L30,42 L60,36 L90,38 L120,28 L150,22 L180,18 L210,12 L240,8 L260,6" fill="none" stroke="hsl(217 91% 60%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="260" cy="6" r="3" fill="hsl(217 91% 60%)" style={{ filter: "drop-shadow(0 0 4px hsl(217 91% 60% / 0.8))" }} />
                      </svg>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Referrals", value: "47", color: "hsl(217 91% 62%)" },
                        { label: "Converted", value: "12", color: "hsl(142 70% 55%)" },
                        { label: "Clicks", value: "1.2k", color: "hsl(38 92% 58%)" },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg px-2.5 py-2 text-center" style={{ background: "hsl(222 28% 7%)", border: "1px solid hsl(217 28% 12%)" }}>
                          <p className="text-sm font-bold" style={{ color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
                          <p className="text-[8px] font-mono text-muted-foreground/35 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Recent payouts */}
                    <div className="rounded-xl overflow-hidden" style={{ background: "hsl(222 32% 4.5%)", border: "1px solid hsl(217 28% 10%)" }}>
                      <div className="px-3 pt-2.5 pb-1.5">
                        <span className="text-[8.5px] font-mono text-muted-foreground/35 tracking-wider">RECENT PAYOUTS</span>
                      </div>
                      {[
                        { month: "May 2026", amount: "$183.20", status: "Pending" },
                        { month: "Apr 2026", amount: "$241.50", status: "Paid" },
                        { month: "Mar 2026", amount: "$198.00", status: "Paid" },
                      ].map((p) => (
                        <div key={p.month} className="flex items-center justify-between px-3 py-2 border-t border-border/20">
                          <span className="text-[10px] font-mono text-muted-foreground/50">{p.month}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-foreground/80">{p.amount}</span>
                            <span
                              className="text-[8px] font-mono rounded-full px-1.5 py-0.5"
                              style={{
                                background: p.status === "Paid" ? "hsl(142 70% 45% / 0.12)" : "hsl(38 92% 50% / 0.1)",
                                color: p.status === "Paid" ? "hsl(142 70% 60%)" : "hsl(38 92% 60%)",
                              }}
                            >
                              {p.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Active referral count */}
                    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: "hsl(217 91% 60% / 0.05)", border: "1px solid hsl(217 91% 60% / 0.1)" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />
                      <span className="text-[10px] font-mono text-muted-foreground/55 tracking-wider">12 active referrals generating revenue</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

          </div>
        </div>
      </RevealSection>

      <RevealSection id="api" className="py-18 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
        <motion.div
          whileHover={{ y: -4, boxShadow: "0 20px 52px hsl(0 0% 0% / 0.3), 0 0 0 1px hsl(217 91% 60% / 0.1)" }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="group rounded-2xl border border-border/60 bg-card/35 p-6 sm:p-8 md:p-10 backdrop-blur-sm relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <p className="text-xs font-mono tracking-[0.24em] uppercase text-primary/85">API</p>
          <h2 className="mt-3 text-chrome text-2xl sm:text-3xl font-semibold tracking-tight">Ship faster with RobinOS API access</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">Integrate script generation, trend intelligence, and content workflows into your own products using API-first endpoints.</p>

          {/* Minimal terminal preview */}
          <div className="mt-5 rounded-lg border border-border/40 bg-background/60 p-3 font-mono text-[11px] max-w-sm">
            <p className="text-muted-foreground/40 mb-1">// POST /v1/generate-script</p>
            <p><span className="text-primary/70">{"{"}</span></p>
            <p className="pl-4"><span className="text-primary/60">"topic"</span><span className="text-muted-foreground/50">: </span><span className="text-emerald-400/70">"Instagram growth"</span><span className="text-muted-foreground/40">,</span></p>
            <p className="pl-4"><span className="text-primary/60">"mode"</span><span className="text-muted-foreground/50">: </span><span className="text-emerald-400/70">"hooks"</span></p>
            <p><span className="text-primary/70">{"}"}</span></p>
          </div>

          <div className="mt-6">
            <a href="https://www.tryrobin.xyz/api-access" className="btn-secondary inline-flex items-center justify-center">Open API Docs</a>
          </div>
        </motion.div>
      </RevealSection>

      {/* ─── 5. BYOK ─── */}
      <RevealSection className="py-24 md:py-40 px-4 sm:px-6 flex flex-col items-center text-center">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">Bring Your Own Key</p>
        <h2 className="text-chrome text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl">
          Cost-Efficient BYOK Control
        </h2>
        <p className="mt-6 text-muted-foreground text-sm sm:text-base max-w-lg leading-relaxed px-4">
          Use your OpenAI & ElevenLabs keys directly. No markups. No hidden fees. No middleman.
          You pay API providers at their rates — we just orchestrate the intelligence.
        </p>
        <div className="mt-12 grid grid-cols-3 gap-4 sm:gap-6 md:gap-12 text-center">
          {[
            { value: "No", label: "Platform Markup" },
            { value: "Direct", label: "Provider Billing" },
            { value: "Built", label: "For Scale" },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="relative"
            >
              <p className="text-chrome text-xl sm:text-3xl md:text-4xl font-semibold">{stat.value}</p>
              <p className="mt-1 text-muted-foreground text-[10px] sm:text-xs font-mono tracking-wider uppercase">{stat.label}</p>
              {/* Underline glow on hover */}
              <motion.div
                initial={{ scaleX: 0, opacity: 0 }}
                whileHover={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-px"
                style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.5), transparent)" }}
              />
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ─── 6. PRICING ─── */}
      <RevealSection id="pricing" className="py-24 md:py-40 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">Pricing</p>
          <h2 className="text-chrome text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
            Built for Modern Creator Teams
          </h2>
          <p className="mt-3 text-muted-foreground text-sm max-w-md mx-auto">
            Transparent pricing with startup-grade reliability.
             🌍 Global USD pricing for creators and agencies
          </p>
          <p className="mt-2 text-[10px] text-muted-foreground/50 font-mono">No credit card required to start</p>
        </div>

        {/* Toggles */}
        <div className="flex flex-col items-center justify-center mb-14 gap-3">

          {/* Toggle track — recessed dark groove */}
          <div
            className="relative inline-flex items-center rounded-[13px] p-[5px]"
            style={{
              background: "linear-gradient(180deg, hsl(222 28% 5%) 0%, hsl(222 24% 7%) 100%)",
              border: "1px solid hsl(217 30% 13%)",
              boxShadow:
                "inset 0 2px 5px hsl(0 0% 0% / 0.75), inset 0 1px 2px hsl(0 0% 0% / 0.9), 0 1px 0 hsl(0 0% 100% / 0.04)",
            }}
          >
            {/* Sliding active pill */}
            <motion.div
              initial={false}
              animate={{ x: billingCycle === "monthly" ? 0 : "100%" }}
              transition={{ type: "spring", stiffness: 480, damping: 30, mass: 0.75 }}
              className="absolute inset-[5px] w-[calc(50%-2.5px)] rounded-[8px] pointer-events-none"
              style={{
                background:
                  "linear-gradient(180deg, hsl(217 100% 58%) 0%, hsl(217 100% 50%) 60%, hsl(218 100% 46%) 100%)",
                boxShadow:
                  "inset 0 1px 0 hsl(0 0% 100% / 0.22), inset 0 -1px 0 hsl(0 0% 0% / 0.3), 0 2px 10px hsl(217 91% 55% / 0.55), 0 4px 24px hsl(217 91% 60% / 0.22)",
              }}
            />

            {/* Monthly */}
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`relative z-10 px-8 sm:px-10 py-[10px] text-[11px] font-mono tracking-[0.16em] uppercase select-none transition-colors duration-200 ${
                billingCycle === "monthly"
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Monthly
            </button>

            {/* Yearly */}
            <button
              onClick={() => setBillingCycle("yearly")}
              className={`relative z-10 px-8 sm:px-10 py-[10px] text-[11px] font-mono tracking-[0.16em] uppercase select-none transition-colors duration-200 inline-flex items-center justify-center gap-2 ${
                billingCycle === "yearly"
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Yearly
              <span
                className="rounded-[4px] px-[6px] py-[2.5px] text-[9px] font-bold tracking-[0.1em] transition-all duration-300"
                style={
                  billingCycle === "yearly"
                    ? {
                        background: "hsl(0 0% 100% / 0.13)",
                        border: "1px solid hsl(0 0% 100% / 0.16)",
                        color: "hsl(0 0% 90%)",
                      }
                    : {
                        background: "hsl(217 91% 60% / 0.13)",
                        border: "1px solid hsl(217 91% 60% / 0.32)",
                        color: "hsl(217 95% 74%)",
                        boxShadow: "0 0 8px hsl(217 91% 60% / 0.15)",
                      }
                }
              >
                −20%
              </span>
            </button>
          </div>

          {/* Contextual hint */}
          <motion.p
            key={billingCycle}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="inline-flex items-center gap-[7px] text-[11px] font-mono tracking-[0.05em]"
            style={{ color: "hsl(0 0% 36%)" }}
          >
            <span
              className="w-[5px] h-[5px] rounded-full flex-shrink-0"
              style={{
                background:
                  billingCycle === "yearly"
                    ? "hsl(217 91% 60% / 0.65)"
                    : "hsl(0 0% 28%)",
                transition: "background 0.3s",
              }}
            />
            {billingCycle === "yearly"
              ? "Annual plan active · saving 20%"
              : "Switch to annual · save 20%"}
          </motion.p>
        </div>

        {/* Cards */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${plans.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-5 pt-6`}>
          {plans.map((plan: any) => {
            const monthlyReferencePlan = monthlyPlans.find((p: any) => p.name === plan.name);
            const monthlyAmount = parseAmount(monthlyReferencePlan?.price);
            const yearlyTotalAmount = parseAmount(plan.yearlyTotal);
            const yearlyReferenceAmount = monthlyAmount * 12;
            const yearlyBadge = !plan.isFree && billingCycle === "yearly" && plan.tier
              ? yearlyBadgeByTier[plan.tier]
              : undefined;

            return (
            <motion.div
              key={plan.name}
              whileHover={{ y: -6, boxShadow: plan.isAgency
                ? "0 20px 52px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(38 92% 50% / 0.22)"
                : plan.featured
                  ? "0 20px 52px hsl(0 0% 0% / 0.4), 0 0 28px hsl(217 91% 60% / 0.2), 0 0 0 1px hsl(217 91% 60% / 0.25)"
                  : "0 20px 52px hsl(0 0% 0% / 0.35), 0 0 0 1px hsl(217 91% 60% / 0.12)"
              }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className={`relative rounded-xl p-6 sm:p-7 ${
                plan.isAgency
                    ? "border border-amber-500/30 bg-card/60 shadow-[0_0_24px_-10px_hsl(38_92%_50%/0.24)]"
                  : plan.featured
                      ? "border border-primary/30 bg-card/60 shadow-[0_0_24px_-10px_hsl(217_91%_60%/0.2)]"
                      : "border border-border/35 bg-card/30"
              }`}
            >
              {yearlyBadge && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.35 }}
                  className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"
                >
                  <div className={`px-3 py-1 rounded-full text-[10px] font-mono tracking-[0.12em] uppercase border backdrop-blur-md whitespace-nowrap ${
                    plan.isAgency
                      ? "bg-amber-500/15 text-amber-300 border-amber-400/40 shadow-[0_0_18px_hsl(38_92%_50%/0.22)]"
                      : plan.featured
                        ? "bg-primary/15 text-primary border-primary/40 shadow-[0_0_20px_hsl(217_91%_60%/0.35)]"
                        : "bg-primary/10 text-primary border-primary/30 shadow-[0_0_14px_hsl(217_91%_60%/0.2)]"
                  }`}>
                    {yearlyBadge.primary}
                  </div>
                  {yearlyBadge.secondary && (
                    <p className="text-center text-[9px] mt-1 text-primary/90 font-medium tracking-[0.08em] uppercase">{yearlyBadge.secondary}</p>
                  )}
                </motion.div>
              )}

              {!yearlyBadge && plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className={`px-3 py-0.5 rounded-full text-[10px] font-mono tracking-widest uppercase ${
                    plan.badge === "PREMIUM" || plan.badge === "ELITE"
                      ? "bg-amber-500 text-black"
                      : "bg-primary text-primary-foreground"
                  }`}>
                    {plan.badge}
                  </span>
                </div>
              )}

              <p className="text-xs font-mono tracking-[0.2em] uppercase text-muted-foreground">{plan.name}</p>
              {plan.featured && <p className="text-[10px] text-primary mt-1 font-medium">Best for serious creators</p>}
              <motion.div
                key={`${plan.name}-${billingCycle}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28 }}
                className="mt-3"
              >
                <p className="text-chrome text-2xl sm:text-3xl font-semibold">
                  {plan.price}
                  {plan.period && <span className="text-muted-foreground text-sm font-normal">{plan.period}</span>}
                </p>

                {billingCycle === "yearly" && !plan.isFree && monthlyAmount > 0 && (
                  <p className="text-[11px] mt-1 text-muted-foreground/70 line-through decoration-muted-foreground/50">{symbol}{monthlyAmount.toLocaleString()}/mo</p>
                )}

                {billingCycle === "yearly" && !plan.isFree && yearlyTotalAmount > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-[11px] text-primary/90 font-medium">{symbol}{yearlyTotalAmount.toLocaleString()}/year</p>
                    {yearlyReferenceAmount > yearlyTotalAmount && (
                      <p className="text-[10px] text-muted-foreground/55 line-through decoration-muted-foreground/50">{symbol}{yearlyReferenceAmount.toLocaleString()}/year</p>
                    )}
                  </div>
                )}

                {billingCycle !== "yearly" && plan.yearlyTotal && (
                  <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">Billed monthly</p>
                )}
              </motion.div>

              <ul className="mt-5 space-y-2">
                {plan.features.map((f: string) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className={`w-3.5 h-3.5 flex-shrink-0 ${plan.isAgency ? "text-amber-400" : "text-primary"}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <motion.button
                onClick={() => navigate(authHref)}
                whileHover={{ y: -1, boxShadow: plan.isAgency
                  ? "0 6px 20px hsl(38 92% 50% / 0.35)"
                  : plan.featured
                    ? "0 6px 20px hsl(217 91% 60% / 0.4)"
                    : "0 4px 14px hsl(0 0% 0% / 0.3)"
                }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 360, damping: 22 }}
                className={`mt-6 w-full py-3 rounded-lg text-sm font-medium tracking-wide transition-colors ${
                  plan.isAgency
                    ? "bg-amber-500 text-black hover:opacity-90"
                    : plan.featured
                      ? "bg-primary text-primary-foreground"
                      : plan.isFree
                        ? "border border-border text-foreground hover:border-primary/40"
                        : "border border-border text-foreground hover:border-primary/40"
                }`}
              >
                {plan.isFree
                  ? "Start Free"
                  : plan.tier === "pro_creator"
                    ? "Upgrade to Pro Creator"
                    : plan.isAgency
                      ? "Scale Your Content"
                      : "Join RobinOS"}
              </motion.button>
            </motion.div>
          );})}
        </div>
      </RevealSection>

      {/* ─── 7. FAQ ─── */}
      <RevealSection id="resources" className="py-20 md:py-40 px-5 sm:px-6 max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">FAQ</p>
          <h2 className="text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            Common Questions
          </h2>
        </div>

        <Accordion type="single" collapsible className="space-y-1.5">
          {faqItems.map((item, i) => (
            <AccordionItem
              key={i}
              value={`faq-${i}`}
              className="border-border/35 border rounded-lg px-3.5 sm:px-5 transition-all duration-300 hover:border-primary/20 hover:bg-primary/[0.015] data-[state=open]:border-primary/25 data-[state=open]:bg-primary/[0.02]"
            >
              <AccordionTrigger className="text-sm text-foreground hover:no-underline py-3 text-left leading-snug pr-3 break-words hover:text-foreground/90">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </RevealSection>

      <RevealSection id="contact" className="pb-20 px-4 sm:px-6 max-w-5xl mx-auto">
        <motion.div
          whileHover={{ y: -4, boxShadow: "0 20px 52px hsl(0 0% 0% / 0.3), 0 0 0 1px hsl(217 91% 60% / 0.1)" }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="group rounded-2xl border border-border/60 bg-card/35 p-6 sm:p-8 md:p-10 text-center relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <p className="text-xs font-mono tracking-[0.24em] uppercase text-primary/85">Contact</p>
          <h2 className="mt-3 text-chrome text-2xl sm:text-3xl font-semibold tracking-tight">Need a custom workflow?</h2>
          <p className="mt-3 text-sm text-muted-foreground">Talk to the RobinOS team for onboarding, support, and workflow strategy.</p>
          <div className="mt-6 flex justify-center">
            <motion.div whileHover={{ y: -1, boxShadow: "0 6px 24px hsl(217 91% 60% / 0.3)" }} whileTap={{ scale: 0.98 }}>
              <Link to="/contact" className="btn-primary inline-flex items-center justify-center">Contact RobinOS</Link>
            </motion.div>
          </div>
        </motion.div>
      </RevealSection>

      <PublicFooter />
    </div>
  );
};

export default EntryPage;
