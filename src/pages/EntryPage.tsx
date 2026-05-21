import { useEffect, useRef } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
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
  { q: "How does the Affiliate Program work?", a: "After signing up, you get a unique referral link in your dashboard's Referrals tab. You earn 30% commission when your referred users subscribe to any paid plan. Monthly plans give recurring commission; yearly plans give one-time 30% commission. Minimum withdrawal is $10 through your configured payout method." },
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
    stats: "24/7 monitoring",
  },
  {
    icon: Video,
    title: "Create",
    desc: "Script to video in seconds. AI-powered content generation at scale.",
    color: "from-primary/15 to-primary/5",
    stats: "< 30s generation",
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
  "Instagram engagement formatting",
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

  const plans = getLandingPricingPlans(currency, billingCycle, {
    creator_price: platformSettings?.creator_price,
    pro_price: platformSettings?.pro_price,
    agency_price: platformSettings?.agency_price,
  });

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

          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 mt-4 w-full sm:w-auto px-4 sm:px-0">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(authHref)}
              className="btn-primary shimmer-btn w-full sm:w-auto !px-8 !py-3"
            >
              Start Creating →
            </motion.button>
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.6 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
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
                  className="snap-start w-[280px] rounded-2xl glass-card card-glow p-4 border border-border/70 shadow-[0_18px_45px_hsl(0_0%_0%/0.35)]"
                  whileHover={{ y: -3, boxShadow: "0 28px 65px hsl(217 91% 60% / 0.16), 0 0 0 1px hsl(217 91% 60% / 0.2)" }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <p className="text-sm font-semibold text-foreground">{card.title}</p>
                  <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-primary/90">{card.subtitle}</p>
                  <ul className="mt-4 space-y-2.5">
                    {card.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2.5 rounded-lg bg-card/50 border border-border/60 px-3 py-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
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
                className="rounded-2xl glass-card card-glow p-5 border border-border/70 shadow-[0_18px_45px_hsl(0_0%_0%/0.35)]"
                whileHover={{ y: -3, boxShadow: "0 28px 65px hsl(217 91% 60% / 0.16), 0 0 0 1px hsl(217 91% 60% / 0.2)" }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <p className="text-base font-semibold text-foreground">{card.title}</p>
                <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-primary/90">{card.subtitle}</p>
                <ul className="mt-4 space-y-2.5">
                  {card.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5 rounded-lg bg-card/50 border border-border/60 px-3 py-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
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
        <div className="glass-card p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary/5 blur-[60px] pointer-events-none" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-primary mb-4">⚡ See it in action</p>
          <div className="mb-4">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-secondary/50 border border-border/30">
              <span className="text-muted-foreground/40 text-sm">Topic:</span>
              <span className="text-foreground text-sm">"How to grow on Instagram"</span>
            </div>
            <div className="flex justify-center my-3">
              <div className="w-px h-8 bg-gradient-to-b from-primary/60 to-transparent" />
            </div>
            <div className="px-4 py-4 rounded-xl bg-primary/5 border border-primary/20 shadow-[inset_0_0_30px_hsl(217_91%_60%/0.04)]">
              <p className="text-[10px] font-mono text-primary mb-2">🎬 READY TO RECORD:</p>
              <p className="text-foreground text-sm leading-relaxed font-medium">"Nobody is telling you this about Instagram growth..."</p>
              <p className="text-foreground/80 text-sm leading-relaxed mt-1">"Delete your hashtag strategy. Here's what actually works in 2026."</p>
              <p className="text-foreground/70 text-sm leading-relaxed mt-1">"I tested this for 30 days and gained 50K followers."</p>
            </div>
          </div>
          <p className="text-center text-muted-foreground/50 text-[11px] font-mono">Generated in 8 seconds</p>
        </div>
      </RevealSection>

      {/* ─── 2. FRICTION ─── */}
      <section ref={frictionRef} className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-32">
        <motion.div
          style={{ filter: useTransform(frictionBlur, (v) => `blur(${v}px)`), opacity: frictionOpacity }}
          className="text-center max-w-3xl"
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
            className="w-full rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden shadow-2xl shadow-primary/5"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/15" />
              <div className="ml-4 h-2 w-24 sm:w-32 rounded bg-muted" />
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
                    { label: "Radar Signals", value: "147" },
                    { label: "Scripts Created", value: "89" },
                    { label: "Active Pipelines", value: "12" },
                    { label: "Success Rate", value: "94%" },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-secondary/50 border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground/60 font-mono">{stat.label}</p>
                      <p className="text-lg sm:text-xl font-semibold text-chrome mt-0.5">{stat.value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {["AI in Content Creation", "Short-Form Video Trends", "Creator Economy Growth", "Voice AI Revolution"].map((trend) => (
                    <div key={trend} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card/40 border border-border/30">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="text-xs text-foreground/70 flex-1 truncate">{trend}</span>
                      <div className="hidden sm:block h-5 w-12 rounded bg-primary/10 border border-primary/20" />
                    </div>
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
            <RevealSection
              key={engine.title}
              delay={i * 0.08}
              className="group relative rounded-xl border border-border bg-card/40 p-6 sm:p-8 overflow-hidden transition-all duration-500 hover:border-primary/30 hover:bg-card/60 hover:-translate-y-1 hover:shadow-[0_12px_40px_hsl(217_91%_60%/0.08)]"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${engine.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-5">
                  <motion.div
                    whileHover={{ rotate: 10, scale: 1.1 }}
                    transition={{ type: "spring", stiffness: 300 }}
                  >
                    <engine.icon className="w-6 h-6 text-primary" strokeWidth={1.5} />
                  </motion.div>
                  <span className="text-[10px] font-mono tracking-wider text-primary/60 uppercase">{engine.stats}</span>
                </div>
                <h3 className="text-chrome text-lg font-semibold mb-3">{engine.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{engine.desc}</p>
              </div>
            </RevealSection>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mt-6 sm:mt-8 rounded-xl border border-primary/20 bg-card/45 backdrop-blur-xl p-6 sm:p-8 shadow-[0_12px_40px_hsl(217_91%_60%/0.08),inset_0_1px_0_hsl(0_0%_100%/0.05)]"
        >
          <div className="flex items-center gap-2.5 mb-4">
            <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-mono tracking-[0.14em] uppercase text-primary">NEW</span>
            <Type className="w-4 h-4 text-primary" />
          </div>
          <h3 className="text-chrome text-2xl font-semibold tracking-tight">Caption Engine</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Generate platform-optimized captions and descriptions designed for discoverability, engagement, and growth.
          </p>
          <div className="mt-5 grid sm:grid-cols-2 gap-2.5">
            {captionEngineBullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-secondary/25 px-3 py-2.5">
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
            { icon: Zap, text: "Sub-30s Generation" },
            { icon: Clock, text: "24/7 Monitoring" },
          ].map((badge) => (
            <div key={badge.text} className="flex items-center gap-2 text-muted-foreground/50">
              <badge.icon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono tracking-wider uppercase">{badge.text}</span>
            </div>
          ))}
        </motion.div>
      </RevealSection>

      <RevealSection id="affiliates" className="py-18 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-primary/25 bg-card/45 p-6 sm:p-8 md:p-10 backdrop-blur-md shadow-[0_0_40px_hsl(217_91%_60%/0.12)]">
          <p className="text-xs font-mono tracking-[0.24em] uppercase text-primary/85">Affiliates</p>
          <h2 className="mt-3 text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">Earn recurring commissions with RobinOS</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">Join the affiliate program and unlock monthly recurring commissions with performance rewards for top partners.</p>
          <div className="mt-6">
            <Link to="/affiliates" className="btn-primary inline-flex items-center justify-center">Explore Affiliate Program</Link>
          </div>
        </div>
      </RevealSection>

      <RevealSection id="api" className="py-18 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-border/60 bg-card/35 p-6 sm:p-8 md:p-10 backdrop-blur-sm">
          <p className="text-xs font-mono tracking-[0.24em] uppercase text-primary/85">API</p>
          <h2 className="mt-3 text-chrome text-2xl sm:text-3xl font-semibold tracking-tight">Ship faster with RobinOS API access</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">Integrate script generation, trend intelligence, and content workflows into your own products using API-first endpoints.</p>
          <div className="mt-6">
            <a href="https://www.tryrobin.xyz/api-access" className="btn-secondary inline-flex items-center justify-center">Open API Docs</a>
          </div>
        </div>
      </RevealSection>

      {/* ─── 5. BYOK ─── */}
      <RevealSection className="py-24 md:py-40 px-4 sm:px-6 flex flex-col items-center text-center">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">Bring Your Own Key</p>
        <h2 className="text-chrome text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl">
          90% Cost Efficiency
        </h2>
        <p className="mt-6 text-muted-foreground text-sm sm:text-base max-w-lg leading-relaxed px-4">
          Use your OpenAI & ElevenLabs keys directly. No markups. No hidden fees. No middleman.
          You pay API providers at their rates — we just orchestrate the intelligence.
        </p>
        <div className="mt-12 grid grid-cols-3 gap-4 sm:gap-6 md:gap-12 text-center">
          {[
            { value: "0%", label: "Markup" },
            { value: "90%", label: "Cost Saved" },
            { value: "∞", label: "Scalability" },
          ].map((stat) => (
            <motion.div key={stat.label} whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300 }}>
              <p className="text-chrome text-xl sm:text-3xl md:text-4xl font-semibold">{stat.value}</p>
              <p className="mt-1 text-muted-foreground text-[10px] sm:text-xs font-mono tracking-wider uppercase">{stat.label}</p>
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
        <div className="flex items-center justify-center mb-14">
          <div className="flex items-center rounded-lg border border-border p-1 glass">
            {(["monthly", "yearly"] as const).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                className={`px-4 sm:px-5 py-2 rounded-md text-xs font-mono tracking-wider uppercase transition-all ${
                  billingCycle === cycle
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {cycle === "yearly" ? "YEARLY -20%" : cycle}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${plans.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-5`}>
          {plans.map((plan: any) => (
            <motion.div
              key={plan.name}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 300 }}
                className={`relative rounded-xl p-6 sm:p-7 transition-all ${
                plan.isAgency
                    ? "border border-amber-500/30 bg-card/60 shadow-[0_0_24px_-10px_hsl(38_92%_50%/0.24)]"
                  : plan.featured
                      ? "border border-primary/30 bg-card/60 glow-blue"
                      : "border border-border/35 bg-card/30"
              }`}
            >
              {plan.badge && (
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
              <p className="mt-3 text-chrome text-2xl sm:text-3xl font-semibold">
                {plan.price}
                {plan.period && <span className="text-muted-foreground text-sm font-normal">{plan.period}</span>}
              </p>
              {plan.yearlyTotal && (
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">{plan.yearlyTotal}</p>
              )}

              <ul className="mt-5 space-y-2">
                {plan.features.map((f: string) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className={`w-3.5 h-3.5 flex-shrink-0 ${plan.isAgency ? "text-amber-400" : "text-primary"}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => navigate(authHref)}
                className={`mt-6 w-full py-3 rounded-lg text-sm font-medium tracking-wide transition-all ${
                  plan.isAgency
                    ? "bg-amber-500 text-black hover:opacity-90"
                    : plan.featured
                      ? "bg-primary text-primary-foreground glow-blue"
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
              </button>
            </motion.div>
          ))}
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
            <AccordionItem key={i} value={`faq-${i}`} className="border-border/35 border rounded-lg px-3.5 sm:px-5 data-[state=open]:border-primary/25 transition-colors">
              <AccordionTrigger className="text-sm text-foreground hover:no-underline py-3 text-left leading-snug pr-3 break-words">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-3">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </RevealSection>

      <RevealSection id="contact" className="pb-20 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-border/60 bg-card/35 p-6 sm:p-8 md:p-10 text-center">
          <p className="text-xs font-mono tracking-[0.24em] uppercase text-primary/85">Contact</p>
          <h2 className="mt-3 text-chrome text-2xl sm:text-3xl font-semibold tracking-tight">Need a custom workflow?</h2>
          <p className="mt-3 text-sm text-muted-foreground">Talk to the RobinOS team for onboarding, support, and growth strategy.</p>
          <div className="mt-6 flex justify-center">
            <Link to="/contact" className="btn-primary inline-flex items-center justify-center">Contact RobinOS</Link>
          </div>
        </div>
      </RevealSection>

      <PublicFooter />
    </div>
  );
};

export default EntryPage;
