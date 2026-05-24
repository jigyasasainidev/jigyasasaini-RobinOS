import { useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  DollarSign, TrendingUp, Users, Zap, Star, ArrowRight, Play,
  CheckCircle, ChevronDown, Globe, BarChart3, PenTool, Mic,
  Hash, Sparkles, Clock, Shield, type LucideIcon,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

// ── Scroll-reveal wrapper ─────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}>
      {children}
    </motion.div>
  );
}

// ── Section label ─────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-mono tracking-[0.25em] uppercase text-primary/60">{children}</span>;
}

// ── Video embed resolver (reused from CreatorOSPage) ──────
function resolveVideoEmbed(url: string): { type: "youtube" | "vimeo" | "loom" | "mp4" | null; embedUrl: string } {
  if (!url) return { type: null, embedUrl: "" };
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: "youtube", embedUrl: `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1` };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { type: "vimeo", embedUrl: `https://player.vimeo.com/video/${vm[1]}?title=0&byline=0` };
  const lm = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (lm) return { type: "loom", embedUrl: `https://www.loom.com/embed/${lm[1]}` };
  if (url.includes(".mp4")) return { type: "mp4", embedUrl: url };
  return { type: null, embedUrl: "" };
}

function DemoVideo({ videoUrl }: { videoUrl: string | null }) {
  const resolved = resolveVideoEmbed(videoUrl ?? "");
  return (
    <div className="relative w-full rounded-2xl overflow-hidden"
      style={{ aspectRatio: "16/9", background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 0 80px hsl(217 91% 60% / 0.08), 0 24px 80px hsl(0 0% 0% / 0.5)" }}>
      {resolved.type && resolved.embedUrl ? (
        resolved.type === "mp4"
          ? <video src={resolved.embedUrl} controls className="absolute inset-0 w-full h-full" style={{ background: "#000" }} />
          : <iframe src={resolved.embedUrl} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="RobinOS Affiliate Demo" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(217 91% 60% / 0.07), transparent)" }} />
          <motion.div className="relative w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.15)" }}
            animate={{ scale: [1, 1.05, 1], boxShadow: ["0 0 40px hsl(217 91% 60% / 0.15)", "0 0 60px hsl(217 91% 60% / 0.25)", "0 0 40px hsl(217 91% 60% / 0.15)"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
            <Play className="w-8 h-8 text-primary ml-1" strokeWidth={1.5} />
          </motion.div>
          <div className="text-center z-10">
            <p className="text-sm font-mono text-muted-foreground/60">Demo Coming Soon</p>
            <p className="text-[10px] font-mono text-muted-foreground/35 mt-1 tracking-wider uppercase">Video loading from admin panel</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Benefit card ──────────────────────────────────────────
function BenefitCard({ icon: Icon, title, description, highlight, delay }: { icon: LucideIcon; title: string; description: string; highlight?: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <motion.div className="relative rounded-2xl p-5 h-full"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(217 91% 60% / 0.3)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.07)", y: -3 }}
        transition={{ duration: 0.25 }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
          style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.6} />
        </div>
        {highlight && (
          <span className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full mb-2"
            style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
            {highlight}
          </span>
        )}
        <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{description}</p>
      </motion.div>
    </Reveal>
  );
}

// ── Commission row ────────────────────────────────────────
function CommissionRow({ plan, price, commission, delay }: { plan: string; price: string; commission: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="flex items-center justify-between rounded-xl px-5 py-4"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}>
        <div>
          <p className="text-sm font-semibold text-foreground">{plan}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{price}/month per customer</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold" style={{ color: "hsl(142 70% 55%)" }}>{commission}</p>
          <p className="text-[10px] font-mono text-muted-foreground/50">per month</p>
        </div>
      </div>
    </Reveal>
  );
}

// ── FAQ item ──────────────────────────────────────────────
function FaqItem({ q, a, delay }: { q: string; a: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="rounded-xl px-5 py-4" style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}>
        <div className="flex items-start gap-3">
          <ChevronDown className="w-4 h-4 text-primary/60 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">{q}</p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{a}</p>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

// ── Main page ─────────────────────────────────────────────
export default function JVZooAffiliatePage() {
  const navigate = useNavigate();
  const { data: settings, isLoading } = usePlatformSettings();

  useEffect(() => {
    if (!isLoading && settings && settings.jvzoo_affiliate_enabled === false) {
      navigate("/", { replace: true });
    }
  }, [settings, isLoading, navigate]);

  if (isLoading) return null;
  if (settings && settings.jvzoo_affiliate_enabled === false) return null;

  const videoUrl   = settings?.jvzoo_affiliate_demo_video_url ?? null;
  const ctaUrl     = settings?.jvzoo_affiliate_cta_url ?? "#";
  const btnText    = settings?.jvzoo_affiliate_button_text?.trim() || "Join Affiliate Program";

  return (
    <PublicLayout>
      {/* Ambient */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(ellipse, hsl(142 70% 55%), transparent 70%)" }} />
        <div className="absolute top-1/3 -left-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: "radial-gradient(ellipse, hsl(217 91% 60%), transparent 70%)" }} />
      </div>

      {/* ════════════════════════ 1. HERO ═══════════════════ */}
      <section className="relative z-10 px-4 pt-24 pb-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
              style={{ background: "hsl(142 70% 55% / 0.08)", border: "1px solid hsl(142 70% 55% / 0.2)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />
              <span className="text-[11px] font-mono tracking-[0.18em] uppercase" style={{ color: "hsl(142 70% 60%)" }}>JVZoo Partner Program</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
              <span className="text-chrome">Earn 50%</span>
              <br />
              <span className="text-chrome">Recurring</span>
              <br />
              <span style={{ background: "linear-gradient(135deg, hsl(142 70% 55%), hsl(160 70% 55%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Commission
              </span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
              className="text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
              Promote RobinOS — the AI Creator Operating System built for modern creators, faceless brands, and AI-driven content businesses. Earn every month, forever.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap gap-3">
              <a href={ctaUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                style={{ background: "linear-gradient(135deg, hsl(142 70% 42%), hsl(142 65% 35%))", boxShadow: "0 4px 20px hsl(142 70% 55% / 0.35), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}>
                {btnText} <ArrowRight className="w-4 h-4" />
              </a>
              <a href="#demo-video"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                <Play className="w-3.5 h-3.5" /> Watch Demo
              </a>
            </motion.div>
          </div>

          {/* Hero analytics mock */}
          <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="relative hidden lg:block">
            <div className="relative rounded-2xl p-5"
              style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 24px 80px hsl(0 0% 0% / 0.5), 0 0 60px hsl(142 70% 55% / 0.05)" }}>
              <div className="mb-3 border-b pb-3 flex items-center gap-2" style={{ borderColor: "hsl(217 28% 12%)" }}>
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-mono text-muted-foreground/50">Affiliate Dashboard</span>
                <span className="ml-auto text-[9px] font-mono text-emerald-400/70">● LIVE</span>
              </div>
              {[
                { label: "This Month", value: "$2,340.50", sub: "+18% vs last month", color: "text-emerald-400" },
                { label: "Active Referrals", value: "48 creators", sub: "Across all plans", color: "text-primary" },
                { label: "Total Earned", value: "$14,820.00", sub: "Lifetime earnings", color: "hsl(38 92% 55%)" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="py-2.5 border-b" style={{ borderColor: "hsl(217 28% 10%)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground/40">{label}</span>
                    <span className={`text-sm font-semibold font-mono ${color}`}>{value}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/30 mt-0.5">{sub}</p>
                </div>
              ))}
              <div className="mt-3 rounded-xl p-3 text-center"
                style={{ background: "hsl(142 70% 55% / 0.06)", border: "1px solid hsl(142 70% 55% / 0.15)" }}>
                <p className="text-[10px] font-mono text-muted-foreground/50 mb-1">Commission Rate</p>
                <p className="text-3xl font-bold" style={{ color: "hsl(142 70% 55%)" }}>50%</p>
                <p className="text-[10px] font-mono text-muted-foreground/40">Recurring monthly</p>
              </div>
            </div>
            {/* Floating badges */}
            <motion.div className="absolute -top-4 -right-4 rounded-xl px-3 py-2 text-[10px] font-mono"
              style={{ background: "hsl(222 32% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(142 70% 55%)" }}
              animate={{ y: [0, -5, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
              🔥 High Demand Niche
            </motion.div>
            <motion.div className="absolute -bottom-4 -left-4 rounded-xl px-3 py-2 text-[10px] font-mono"
              style={{ background: "hsl(222 32% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(38 92% 55%)" }}
              animate={{ y: [0, 5, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}>
              ↑ AI Creator Market Growing
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 2. WHY AFFILIATES LOVE IT ═══════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Why Promote RobinOS</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Built for affiliate success</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Everything you need to earn consistent recurring income in the fastest-growing digital niche.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: DollarSign, title: "50% Recurring Commission", description: "Earn half of every subscription — every single month. No caps, no cutoffs.", highlight: "50% Lifetime", delay: 0 },
            { icon: TrendingUp, title: "AI Creator Market", description: "The AI content creation space is exploding. Early affiliates own the biggest share.", highlight: "Growing Market", delay: 0.05 },
            { icon: Star, title: "Premium Conversion Design", description: "RobinOS is built to convert. The product sells itself to creators who see it.", delay: 0.10 },
            { icon: Globe, title: "High Creator Retention", description: "Creators who join stay. Monthly recurring income compounds automatically.", delay: 0.15 },
            { icon: Zap, title: "Viral Creator Niche", description: "AI tools for faceless channels, YouTube automation, and content creation spread fast.", delay: 0.20 },
            { icon: Shield, title: "Future-Proof Product", description: "RobinOS is actively built and upgraded. You're promoting a product with a roadmap.", delay: 0.25 },
          ].map((c) => <BenefitCard key={c.title} {...c} />)}
        </div>
      </section>

      {/* ════════════════ 3. COMMISSION STRUCTURE ══════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Commission Structure</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Your earnings per referral</h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm mt-3">50% recurring on every active subscription. Every month. Forever.</p>
        </Reveal>
        <div className="space-y-3 mb-8">
          <CommissionRow plan="Creator Plan"     price="$19" commission="$9.50/mo"  delay={0} />
          <CommissionRow plan="Pro Creator Plan" price="$39" commission="$19.50/mo" delay={0.07} />
          <CommissionRow plan="Agency Plan"      price="$99" commission="$49.50/mo" delay={0.14} />
        </div>
        <Reveal delay={0.2}>
          <div className="rounded-2xl p-6 text-center"
            style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(142 70% 55% / 0.2)", boxShadow: "0 0 60px hsl(142 70% 55% / 0.04)" }}>
            <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em] mb-2">Example Income Potential</p>
            <p className="text-muted-foreground text-sm mb-4">50 active Pro Creator referrals × $19.50 =</p>
            <p className="text-4xl font-bold" style={{ color: "hsl(142 70% 55%)" }}>$975 / month</p>
            <p className="text-[11px] font-mono text-muted-foreground/40 mt-2">Recurring. Passive. Growing.</p>
          </div>
        </Reveal>
      </section>

      {/* ════════════════ 4. PRODUCT SHOWCASE ═════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>What You're Promoting</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">A complete creator OS</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Show your audience an AI platform that replaces 6 separate tools.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Zap, label: "Trend Scanner",    desc: "Live AI trend intelligence — viral topics before they peak." },
            { icon: PenTool, label: "Script Engine", desc: "AI viral scripts for Reels, Shorts, and YouTube in seconds." },
            { icon: Hash, label: "Caption & Hashtags", desc: "Platform-optimized captions + hashtag clusters." },
            { icon: Mic, label: "Voice Studio",     desc: "Professional AI narration powered by ElevenLabs." },
            { icon: BarChart3, label: "Analytics",  desc: "Creator intelligence: win rate, hooks, momentum tracking." },
            { icon: Globe, label: "Multi-Platform", desc: "YouTube, TikTok, Instagram, and Facebook workflows." },
          ].map(({ icon: Icon, label, desc }, i) => (
            <Reveal key={label} delay={i * 0.05}>
              <motion.div className="rounded-xl p-4"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
                whileHover={{ borderColor: "hsl(217 91% 60% / 0.25)", y: -2 }} transition={{ duration: 0.2 }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                  style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
                  <Icon className="w-4 h-4 text-primary" strokeWidth={1.6} />
                </div>
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ════════════════ 5. WHO SHOULD PROMOTE ═══════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Ideal Affiliates</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Who should promote RobinOS?</h2>
        </Reveal>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            "AI YouTubers", "Marketing Creators", "Faceless Channels", "TikTok Growth Pages",
            "Instagram Creators", "SaaS Reviewers", "Affiliate Marketers", "Creator Education Channels",
          ].map((label, i) => (
            <Reveal key={label} delay={i * 0.04}>
              <div className="flex items-center gap-2.5 rounded-xl px-4 py-3"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}>
                <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={1.8} />
                <span className="text-[12px] text-foreground/80">{label}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ════════════════ 6. PROMOTIONAL ASSETS ═══════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Promo Assets</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Everything you need to promote</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Ready-to-use creative assets. More being added continuously.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: "Video Thumbnails",   desc: "High-CTR thumbnail templates for YouTube and social ads.", status: "Coming Soon" },
            { label: "Demo Videos",        desc: "Screen recording walkthroughs and feature demos.", status: "Coming Soon" },
            { label: "Short-Form Reels",   desc: "15-60 second product highlight videos for TikTok/Instagram.", status: "Coming Soon" },
            { label: "Swipe Copy",         desc: "Email sequences, DM scripts, and post captions ready to use.", status: "Coming Soon" },
            { label: "Email Templates",    desc: "Conversion-tested email campaigns for your list.", status: "Coming Soon" },
            { label: "Banner Creatives",   desc: "Display ads and social media graphics in multiple formats.", status: "Coming Soon" },
          ].map(({ label, desc, status }, i) => (
            <Reveal key={label} delay={i * 0.05}>
              <div className="rounded-xl p-4 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 14%)" }}>
                <div className="absolute top-3 right-3">
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full"
                    style={{ background: "hsl(38 92% 55% / 0.1)", border: "1px solid hsl(38 92% 55% / 0.2)", color: "hsl(38 92% 60%)" }}>
                    {status}
                  </span>
                </div>
                <Sparkles className="w-5 h-5 text-primary/50 mb-3" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed pr-4">{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ════════════════ 7. DEMO VIDEO ════════════════════ */}
      <section id="demo-video" className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-10">
          <Label>Live Demo</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">See what you're promoting</h2>
        </Reveal>
        <Reveal delay={0.1}><DemoVideo videoUrl={videoUrl} /></Reveal>
      </section>

      {/* ════════════════ 8. WHY ROBINOS CONVERTS ══════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal>
              <Label>Why It Converts</Label>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-6 text-chrome">
                Easier to promote than generic AI tools
              </h2>
            </Reveal>
            <div className="space-y-5">
              {[
                { title: "Creator-native UX",       desc: "Designed for how creators actually work — fast, focused, addictive.", delay: 0.06 },
                { title: "Massive AI Demand",        desc: "Every creator wants to automate content. RobinOS is the answer.", delay: 0.12 },
                { title: "Premium Visual Design",    desc: "Cinematic UI that screams premium. Easy to screenshot and promote.", delay: 0.18 },
                { title: "Specific Positioning",     desc: "Not another GPT wrapper. A complete creator operating system.", delay: 0.24 },
              ].map(({ title, desc, delay }) => (
                <Reveal key={title} delay={delay}>
                  <div className="flex gap-4">
                    <div className="w-1 rounded-full shrink-0 mt-1" style={{ background: "linear-gradient(180deg, hsl(142 70% 55%), hsl(217 91% 60%))", minHeight: "40px" }} />
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
            <div className="rounded-2xl p-6"
              style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)" }}>
              <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em] mb-4">RobinOS feels like</p>
              <p className="text-xl font-semibold text-foreground leading-relaxed mb-6">
                "The future of creator infrastructure — not another AI tool."
              </p>
              <div className="space-y-2.5">
                {["Modern cinematic UI creators love to screenshot", "Workflow that saves 3+ hours per post", "AI + trend intelligence in one platform", "Built for the faceless channel revolution"].map((point, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={2} />
                    <span className="text-[12px] text-muted-foreground">{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════════════ 9. FAQ ════════════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>FAQ</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Common questions</h2>
        </Reveal>
        <div className="space-y-3">
          {[
            { q: "How do payouts work?",             a: "Payouts are processed via JVZoo's standard payment schedule. You receive your commission directly to your JVZoo account.", delay: 0 },
            { q: "Is commission truly recurring?",   a: "Yes. You earn 50% of every monthly subscription payment as long as the customer stays active. No time limits.", delay: 0.05 },
            { q: "When are payouts sent?",           a: "JVZoo processes affiliate payouts based on their standard schedule after the refund period clears.", delay: 0.10 },
            { q: "Who can promote RobinOS?",         a: "Any affiliate with a JVZoo account can apply. Creators, marketers, educators, and review channel owners are the best fit.", delay: 0.15 },
            { q: "Do affiliates get promo assets?",  a: "Yes — video demos, swipe copy, and banner creatives are being prepared and will be available in the affiliate area.", delay: 0.20 },
            { q: "Is RobinOS beginner friendly?",    a: "Absolutely. The platform is designed to be picked up in minutes. Users see value in the first session.", delay: 0.25 },
            { q: "Can international affiliates join?", a: "Yes. JVZoo supports international affiliates. RobinOS accepts users worldwide.", delay: 0.30 },
          ].map((item) => <FaqItem key={item.q} {...item} />)}
        </div>
      </section>

      {/* ════════════════ 10. FINAL CTA ════════════════════ */}
      <section className="relative z-10 px-4 py-24 sm:px-6 lg:px-8 max-w-[900px] mx-auto text-center">
        <Reveal>
          <div className="relative rounded-3xl overflow-hidden px-8 py-16"
            style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 0 120px hsl(142 70% 55% / 0.05)" }}>
            <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(142 70% 55% / 0.06), transparent)" }} />
            <Label>Start Earning</Label>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 mb-4 text-chrome">
              Earn recurring income<br />promoting the future<br />of AI creator infrastructure.
            </h2>
            <p className="text-muted-foreground text-sm mb-10 max-w-md mx-auto">
              Join the RobinOS affiliate program today. 50% recurring commission on every active referral.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href={ctaUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                style={{ background: "linear-gradient(135deg, hsl(142 70% 42%), hsl(142 65% 35%))", boxShadow: "0 4px 24px hsl(142 70% 55% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}>
                {btnText} <ArrowRight className="w-4 h-4" />
              </a>
              <Link to="/creator-os"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                View Product
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </PublicLayout>
  );
}
