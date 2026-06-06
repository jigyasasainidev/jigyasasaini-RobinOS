import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  DollarSign, TrendingUp, Users, Zap, Star, ArrowRight, Play,
  CheckCircle, Globe, BarChart3, PenTool, Mic,
  Hash, Sparkles, Clock, Shield, Film, Mail, Image, ExternalLink, type LucideIcon,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { useAffiliatePromoAssets } from "@/hooks/useAffiliatePromoAssets";

// ── Scroll-reveal ─────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
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

// ── Video embed resolver ──────────────────────────────────
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

// ── Polished demo video with cinematic placeholder ────────
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(217 91% 60% / 0.06), transparent)" }} />
          {/* Shimmer sweep */}
          <motion.div className="pointer-events-none absolute inset-0 opacity-30"
            style={{ background: "linear-gradient(105deg, transparent 40%, hsl(217 91% 60% / 0.05) 50%, transparent 60%)" }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", repeatDelay: 2.5 }} />
          {/* Fake player bar */}
          <div className="absolute bottom-0 left-0 right-0 h-10 flex items-center gap-3 px-4"
            style={{ background: "hsl(222 32% 6% / 0.95)", borderTop: "1px solid hsl(217 28% 12%)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "hsl(217 91% 60% / 0.15)", border: "1px solid hsl(217 91% 60% / 0.25)" }}>
              <Play className="w-3 h-3 text-primary ml-0.5" strokeWidth={2} />
            </div>
            <div className="flex-1 h-1 rounded-full" style={{ background: "hsl(217 28% 16%)" }}>
              <div className="w-0 h-full rounded-full" style={{ background: "hsl(217 91% 60% / 0.4)" }} />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30">0:00</span>
          </div>
          {/* Pulsing play button */}
          <div className="relative z-10">
            <motion.div className="absolute inset-0 rounded-full"
              style={{ background: "hsl(217 91% 60% / 0.12)" }}
              animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }} />
            <motion.div className="relative w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
              animate={{ boxShadow: ["0 0 30px hsl(217 91% 60% / 0.1)", "0 0 50px hsl(217 91% 60% / 0.2)", "0 0 30px hsl(217 91% 60% / 0.1)"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
              <Play className="w-6 h-6 text-primary ml-0.5" strokeWidth={1.5} />
            </motion.div>
          </div>
          <div className="text-center z-10">
            <p className="text-sm font-mono text-muted-foreground/60">Affiliate Demo Loading</p>
            <p className="text-[9px] font-mono text-muted-foreground/30 mt-1 tracking-wider">Managed dynamically from admin panel</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Benefit card ──────────────────────────────────────────
function BenefitCard({ icon: Icon, title, description, highlight, delay }: {
  icon: LucideIcon; title: string; description: string; highlight?: string; delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <motion.div className="relative rounded-2xl p-5 h-full group overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(217 91% 60% / 0.3)", boxShadow: "0 0 40px hsl(217 91% 60% / 0.07)", y: -3 }}
        transition={{ duration: 0.25 }}>
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 40% at 30% 20%, hsl(217 91% 60% / 0.05), transparent)" }} />
        <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
          style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.6} />
        </div>
        {highlight && (
          <span className="inline-block text-[9px] font-mono px-2 py-0.5 rounded-full mb-2"
            style={{ background: "hsl(142 70% 55% / 0.1)", border: "1px solid hsl(142 70% 55% / 0.2)", color: "hsl(142 70% 60%)" }}>
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
      <motion.div className="flex items-center justify-between rounded-xl px-5 py-4"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(142 70% 55% / 0.2)", y: -1 }} transition={{ duration: 0.2 }}>
        <div>
          <p className="text-sm font-semibold text-foreground">{plan}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{price}/month per customer</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold font-mono" style={{ color: "hsl(142 70% 55%)" }}>{commission}</p>
          <p className="text-[10px] font-mono text-muted-foreground/50">per month</p>
        </div>
      </motion.div>
    </Reveal>
  );
}

// ── Promo angle card ──────────────────────────────────────
function AngleCard({ hook, support, tag, delay }: { hook: string; support: string; tag: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <motion.div className="rounded-xl p-4 h-full group relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        whileHover={{ borderColor: "hsl(142 70% 55% / 0.25)", boxShadow: "0 0 30px hsl(142 70% 55% / 0.05)", y: -2 }}
        transition={{ duration: 0.2 }}>
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-xl"
          style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, hsl(142 70% 55% / 0.04), transparent)" }} />
        <span className="inline-block text-[9px] font-mono px-2 py-0.5 rounded-full mb-3"
          style={{ background: "hsl(142 70% 55% / 0.08)", border: "1px solid hsl(142 70% 55% / 0.15)", color: "hsl(142 70% 60%)" }}>
          {tag}
        </span>
        <p className="text-sm font-semibold text-foreground mb-1 leading-snug">{hook}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{support}</p>
      </motion.div>
    </Reveal>
  );
}

// ── Expandable FAQ item ───────────────────────────────────
function FaqItem({ q, a, delay }: { q: string; a: string; delay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={delay}>
      <motion.div
        className="rounded-xl overflow-hidden cursor-pointer"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
        animate={{ borderColor: open ? "hsl(142 70% 55% / 0.2)" : "hsl(217 28% 12%)" }}
        transition={{ duration: 0.2 }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm font-semibold text-foreground">{q}</p>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: open ? "hsl(142 70% 55% / 0.12)" : "hsl(217 28% 12%)" }}>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M1 1l4 4 4-4" stroke={open ? "hsl(142 70% 60%)" : "hsl(var(--muted-foreground))"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </motion.div>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}>
              <p className="text-[12px] text-muted-foreground leading-relaxed px-5 pb-4 pt-0">{a}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Reveal>
  );
}

// ── Sticky floating CTA ─────────────────────────────────
// NOTE: Uses ctaUrl prop — do NOT reference outer scope affiliateCtaUrl here
function StickyJoinCTA({ ctaUrl, btnText }: { ctaUrl: string; btnText: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="fixed bottom-6 right-6 z-50"
        >
          <motion.a
            href={ctaUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white backdrop-blur-xl"
            style={{
              background: "linear-gradient(135deg, hsl(142 70% 38%), hsl(142 65% 31%))",
              border: "1px solid hsl(142 70% 55% / 0.3)",
              boxShadow: "0 4px 20px hsl(142 70% 55% / 0.3), 0 2px 8px hsl(0 0% 0% / 0.4)",
            }}
            whileHover={{ scale: 1.03, boxShadow: "0 6px 28px hsl(142 70% 55% / 0.4), 0 2px 8px hsl(0 0% 0% / 0.4)" }}
            whileTap={{ scale: 0.97 }}
          >
            Become a Launch Partner <ArrowRight className="w-3.5 h-3.5" />
          </motion.a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Icon resolver for dynamic asset cards ────────────────
function resolveIcon(name: string): LucideIcon {
  const map: Record<string, LucideIcon> = {
    sparkles:    Sparkles,
    film:        Film,
    play:        Play,
    "pen-tool":  PenTool,
    hash:        Hash,
    "bar-chart-3": BarChart3,
    mic:         Mic,
    mail:        Mail,
    image:       Image,
    globe:       Globe,
    zap:         Zap,
    clock:       Clock,
    users:       Users,
    "check-circle": CheckCircle,
  };
  return map[name?.toLowerCase()] ?? Sparkles;
}

// ── Main page ─────────────────────────────────────────────
export default function LaunchPartnersPage() {
  const navigate = useNavigate();
  const { data: settings, isLoading } = usePlatformSettings();
  const { data: promoAssets = [] }     = useAffiliatePromoAssets();

  useEffect(() => {
    // Only redirect if settings loaded AND explicitly set to false
    // null settings (no DB row) or undefined = don't redirect
    if (!isLoading && settings !== null && settings !== undefined && settings.jvzoo_affiliate_enabled === false) {
      navigate("/", { replace: true });
    }
  }, [settings, isLoading, navigate]);

  if (isLoading) return null;
  // Show page when: settings is null (no row), undefined, or jvzoo_affiliate_enabled is true/null
  // Only block when explicitly false
  if (settings !== null && settings !== undefined && settings.jvzoo_affiliate_enabled === false) return null;

  const videoUrl = settings?.jvzoo_affiliate_demo_video_url ?? null;
  const btnText  = settings?.jvzoo_affiliate_button_text?.trim() || "Join Affiliate Program";
  const affiliateResourcesUrl = settings?.affiliate_resources_url ?? "";

  // ── Centralized affiliate CTA URL ──────────────────────────
  // All CTA buttons on this page use this single source of truth.
  // Admin controls it via "Affiliate Login / Signup URL" field.
  // Default: /login so affiliates always have a working destination.
  const affiliateCtaUrl =
    settings?.jvzoo_affiliate_login_url?.trim() ||
    "https://www.tryrobin.xyz/login";

  return (
    <PublicLayout>
      <StickyJoinCTA ctaUrl={affiliateCtaUrl} btnText={btnText} />

      {/* Ambient */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(ellipse, hsl(142 70% 55%), transparent 70%)" }} />
        <div className="absolute top-1/3 -left-64 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: "radial-gradient(ellipse, hsl(217 91% 60%), transparent 70%)" }} />
      </div>

      {/* ════════════ 1. HERO ════════════════════════════════ */}
      <section className="relative z-10 px-4 pt-24 pb-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
              style={{ background: "hsl(142 70% 55% / 0.08)", border: "1px solid hsl(142 70% 55% / 0.2)" }}>
              <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-[11px] font-mono tracking-[0.18em] uppercase" style={{ color: "hsl(142 70% 60%)" }}>RobinOS Launch Partner Program</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
              <span className="text-chrome">Earn 60%</span><br />
              <span className="text-chrome">Recurring</span><br />
              <span style={{ background: "linear-gradient(135deg, hsl(142 70% 55%), hsl(160 70% 55%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Commission
              </span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
              className="text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
              Promote RobinOS — the AI Creator Operating System built for modern creators, faceless brands, and AI-driven content businesses. Earn every month, forever.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap gap-3 mb-8">
              <motion.a href={affiliateCtaUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-300 relative overflow-hidden group"
                style={{ background: "linear-gradient(135deg, hsl(142 70% 42%), hsl(142 65% 35%))", boxShadow: "0 4px 20px hsl(142 70% 55% / 0.35), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
                whileHover={{ scale: 1.02, boxShadow: "0 6px 28px hsl(142 70% 55% / 0.45), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
                whileTap={{ scale: 0.98 }}>
                {btnText} <ArrowRight className="w-4 h-4" />
              </motion.a>
              <motion.a href="#demo-video"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Play className="w-3.5 h-3.5" /> Watch Demo
              </motion.a>
            </motion.div>

            {/* Trust signal strip */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-wrap gap-3">
              {[
                { value: "Avg EPC: $3.42",          subtle: true },
                { value: "247 Active Affiliates",    subtle: false },
                { value: "71% Retention Rate",       subtle: false },
                { value: "Global Creator Market",    subtle: true },
              ].map(({ value, subtle }, i) => (
                <motion.span key={value}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 + i * 0.07 }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono"
                  style={{
                    background: "hsl(217 28% 8%)",
                    border: "1px solid hsl(217 28% 14%)",
                    color: subtle ? "hsl(var(--muted-foreground) / 0.5)" : "hsl(var(--muted-foreground) / 0.7)",
                  }}>
                  <span className="w-1 h-1 rounded-full shrink-0"
                    style={{ background: subtle ? "hsl(217 28% 20%)" : "hsl(142 70% 55% / 0.6)" }} />
                  {value}
                </motion.span>
              ))}
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
                <motion.span className="ml-auto text-[9px] font-mono text-emerald-400/70 flex items-center gap-1">
                  <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
                  LIVE
                </motion.span>
              </div>
              {[
                { label: "This Month",     value: "$2,340.50", sub: "+18% vs last month", color: "text-emerald-400" },
                { label: "Active Referrals",value: "48 creators", sub: "Across all plans", color: "text-primary" },
                { label: "Total Earned",   value: "$14,820.00", sub: "Lifetime earnings", color: "hsl(38 92% 55%)" },
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
                <p className="text-3xl font-bold font-mono" style={{ color: "hsl(142 70% 55%)" }}>60%</p>
                <p className="text-[10px] font-mono text-muted-foreground/40">Recurring monthly</p>
              </div>
            </div>
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

      {/* ════════════ 2. WHY AFFILIATES LOVE IT ═════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Why Promote RobinOS</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Built for affiliate success</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Everything you need to earn consistent recurring income in the fastest-growing digital niche.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: DollarSign, title: "60% Recurring Commission", description: "Earn 60% of every subscription — every single month. No caps, no cutoffs.", highlight: "60% Lifetime", delay: 0 },
            { icon: TrendingUp, title: "AI Creator Market",         description: "The AI content creation space is exploding. Early affiliates own the biggest share.", highlight: "Growing Market", delay: 0.05 },
            { icon: Star,       title: "Premium Conversion Design", description: "RobinOS is built to convert. The product sells itself to creators who see it.", delay: 0.10 },
            { icon: Globe,      title: "High Creator Retention",    description: "Creators who join stay. Monthly recurring income compounds automatically.", delay: 0.15 },
            { icon: Zap,        title: "Viral Creator Niche",       description: "AI tools for faceless channels, YouTube automation, and content creation spread fast.", delay: 0.20 },
            { icon: Shield,     title: "Future-Proof Product",      description: "RobinOS is actively built and upgraded. You're promoting a product with a roadmap.", delay: 0.25 },
          ].map((c) => <BenefitCard key={c.title} {...c} />)}
        </div>
      </section>

      {/* ════════════ 3. COMMISSION STRUCTURE ═══════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Commission Structure</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Your earnings per referral</h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm mt-3">60% recurring on every active subscription. Every month. Forever.</p>
        </Reveal>
        <div className="space-y-3 mb-8">
          <CommissionRow plan="Creator Plan"     price="$19" commission="$11.40/mo"  delay={0} />
          <CommissionRow plan="Pro Creator Plan" price="$39" commission="$23.40/mo" delay={0.07} />
          <CommissionRow plan="Agency Plan"      price="$99" commission="$59.40/mo" delay={0.14} />
        </div>
        <Reveal delay={0.2}>
          <div className="rounded-2xl p-6 text-center"
            style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(142 70% 55% / 0.2)", boxShadow: "0 0 60px hsl(142 70% 55% / 0.04)" }}>
            <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em] mb-2">Example Income Potential</p>
            <p className="text-muted-foreground text-sm mb-4">50 active Pro Creator referrals × $23.40 =</p>
            <p className="text-4xl font-bold font-mono" style={{ color: "hsl(142 70% 55%)" }}>$1,170 / month</p>
            <p className="text-[11px] font-mono text-muted-foreground/40 mt-2">Recurring. Passive. Growing.</p>
          </div>
        </Reveal>
      </section>

      {/* ════════════ 4. RECURRING INCOME COMPOUNDS ════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Income Growth</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Recurring income compounds fast</h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm mt-3">One referral pays every month. Scale compounds over time.</p>
        </Reveal>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { month: "Month 1",   value: "$120",   sub: "~12 referrals",  delay: 0 },
            { month: "Month 2",   value: "$380",   sub: "~38 referrals",  delay: 0.08 },
            { month: "Month 3",   value: "$910",   sub: "~92 referrals",  delay: 0.16 },
            { month: "Month 6",   value: "$2.4K",  sub: "~245 referrals", delay: 0.24 },
          ].map(({ month, value, sub, delay }, i) => (
            <Reveal key={month} delay={delay}>
              <motion.div className="rounded-xl p-4 text-center relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(142 70% 55% / 0.15)" }}
                whileHover={{ borderColor: "hsl(142 70% 55% / 0.3)", y: -2 }} transition={{ duration: 0.2 }}>
                <div className="pointer-events-none absolute inset-0"
                  style={{ background: `radial-gradient(ellipse 80% 60% at 50% 100%, hsl(142 70% 55% / ${0.03 + i * 0.015}), transparent)` }} />
                <p className="text-[10px] font-mono text-muted-foreground/50 mb-2">{month}</p>
                <p className="text-2xl font-bold font-mono" style={{ color: "hsl(142 70% 55%)" }}>{value}</p>
                <p className="text-[10px] font-mono text-muted-foreground/35 mt-1">{sub}</p>
                {i > 0 && (
                  <div className="absolute top-3 right-3 text-[9px] font-mono" style={{ color: "hsl(142 70% 55% / 0.6)" }}>↑</div>
                )}
              </motion.div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.3}>
          <p className="text-center text-[11px] text-muted-foreground/50 font-mono">
            Built on recurring subscriptions, not one-time payouts.
          </p>
        </Reveal>
      </section>

      {/* ════════════ 5. PRODUCT SHOWCASE ═══════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>What You're Promoting</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">A complete creator OS</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Show your audience an AI platform that replaces 6 separate tools.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Zap,      label: "Trend Scanner",     desc: "Live AI trend intelligence — viral topics before they peak." },
            { icon: PenTool,  label: "Script Engine",     desc: "AI viral scripts for Reels, Shorts, and YouTube in seconds." },
            { icon: Hash,     label: "Caption & Hashtags",desc: "Platform-optimized captions + hashtag clusters." },
            { icon: Mic,      label: "Voice Studio",      desc: "Professional AI narration powered by ElevenLabs." },
            { icon: BarChart3,label: "Analytics",         desc: "Creator intelligence: win rate, hooks, momentum tracking." },
            { icon: Globe,    label: "Multi-Platform",    desc: "YouTube, TikTok, Instagram, and Facebook workflows." },
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

      {/* ════════════ 6. WHO SHOULD PROMOTE ════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Ideal Affiliates</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Who should promote RobinOS?</h2>
        </Reveal>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {["AI YouTubers","Marketing Creators","Faceless Channels","TikTok Growth Pages","Instagram Creators","SaaS Reviewers","Affiliate Marketers","Creator Education Channels"].map((label, i) => (
            <Reveal key={label} delay={i * 0.04}>
              <motion.div className="flex items-center gap-2.5 rounded-xl px-4 py-3"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 12%)" }}
                whileHover={{ borderColor: "hsl(217 91% 60% / 0.2)", y: -1 }} transition={{ duration: 0.18 }}>
                <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={1.8} />
                <span className="text-[12px] text-foreground/80">{label}</span>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ════════════ 7. WINNING PROMO ANGLES ═══════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Promo Strategy</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">High-converting creator angles</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">Ready-made positioning affiliates can use immediately.</p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { hook: "Replace 6 creator tools",            support: "RobinOS does scripts, captions, trends, voice, video, and analytics — in one platform.", tag: "Tool Consolidation", delay: 0 },
            { hook: "Faceless channel operating system",  support: "Built for creators who want to publish without being on camera. Full AI workflow.", tag: "Faceless Channels",  delay: 0.06 },
            { hook: "AI script generation for creators",  support: "Viral scripts generated in seconds. Hooks, timestamps, visual cues included.", tag: "Script Automation",  delay: 0.12 },
            { hook: "Trend intelligence for viral content",support: "Discover what's rising before it peaks. Real-time AI trend scanning across platforms.", tag: "Trend Intelligence", delay: 0.18 },
            { hook: "All-in-one creator workflow",        support: "Discover → create → publish without switching apps. Full creator loop in one OS.", tag: "Workflow OS",        delay: 0.24 },
            { hook: "The OS for content velocity",        support: "Creators ship 3x faster with RobinOS. Less friction, more output, more growth.", tag: "Velocity System",    delay: 0.30 },
          ].map((c) => <AngleCard key={c.hook} {...c} />)}
        </div>
      </section>

      {/* ════════════ 8. PROMOTIONAL ASSETS (dynamic) ═══════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>Promo Assets</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Everything you need to promote</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm mt-3">
            Ready-to-use creative assets — managed from the admin panel and updated without code changes.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Users, title: "Affiliate Guide", desc: "Step-by-step instructions, onboarding, and promotion guidance for RobinOS affiliates.", delay: 0 },
            { icon: Sparkles, title: "Brand Assets", desc: "Official RobinOS brand guidelines, colors, and usage rules.", delay: 0.05 },
            { icon: Film, title: "Demo Videos", desc: "Pre-recorded demo reels and walkthroughs you can share anywhere.", delay: 0.10 },
            { icon: Mail, title: "Email Templates", desc: "Ready-to-send outreach and follow-up templates for affiliates.", delay: 0.15 },
            { icon: Image, title: "Logos", desc: "Official RobinOS logos and branding assets.", delay: 0.20 },
            { icon: Star, title: "Product Screenshots", desc: "Ready-to-use screenshots for promotional content.", delay: 0.25 },
            { icon: Play, title: "Reels", desc: "Short-form video clips optimized for social sharing.", delay: 0.30 },
            { icon: PenTool, title: "Swipe Copy", desc: "Pre-written captions, hooks, and ad copy you can post instantly.", delay: 0.35 },
          ].map(({ icon: Icon, title, desc, delay }, i) => (
            <Reveal key={title} delay={delay}>
              <motion.div className="rounded-xl p-4 relative overflow-hidden flex flex-col h-full"
                style={{ background: "linear-gradient(135deg, hsl(222 32% 8%), hsl(222 28% 6.5%))", border: "1px solid hsl(217 28% 14%)" }}
                whileHover={{ borderColor: "hsl(217 91% 60% / 0.2)", y: -1 }} transition={{ duration: 0.2 }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-3"
                  style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.15)" }}>
                  <Icon className="w-3.5 h-3.5 text-primary/60" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed pr-8 flex-1">{desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>

        {affiliateResourcesUrl && (
          <Reveal delay={0.4}>
            <div className="mt-8 text-center">
              <a
                href={affiliateResourcesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-300"
                style={{ background: "linear-gradient(135deg, hsl(142 70% 42%), hsl(142 65% 35%))", boxShadow: "0 4px 20px hsl(142 70% 55% / 0.35), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
              >
                Open Resource Library <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </Reveal>
        )}
      </section>

      {/* ════════════ 9. DEMO VIDEO ══════════════════════════ */}
      <section id="demo-video" className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-10">
          <Label>Live Demo</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">See what you're promoting</h2>
        </Reveal>
        <Reveal delay={0.1}><DemoVideo videoUrl={videoUrl} /></Reveal>
      </section>

      {/* ════════════ 10. WHY ROBINOS CONVERTS ══════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal>
              <Label>Why It Converts</Label>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 mb-6 text-chrome">Easier to promote than generic AI tools</h2>
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
                    <div className="w-1 rounded-full shrink-0 mt-1"
                      style={{ background: "linear-gradient(180deg, hsl(142 70% 55%), hsl(217 91% 60%))", minHeight: "40px" }} />
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
                {["Modern cinematic UI creators love to screenshot","Workflow that saves 3+ hours per post","AI + trend intelligence in one platform","Built for the faceless channel revolution"].map((point, i) => (
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

      {/* ════════════ 11. FAQ ════════════════════════════════ */}
      <section className="relative z-10 px-4 py-20 sm:px-6 lg:px-8 max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <Label>FAQ</Label>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-3 text-chrome">Common questions</h2>
        </Reveal>
        <div className="space-y-2">
          {[
            { q: "How do payouts work?",              a: "Payouts are processed via our standard affiliate payout schedule. You receive your commission directly to your partner account.", delay: 0 },
            { q: "Is commission truly recurring?",    a: "Yes. You earn 60% of every monthly subscription payment as long as the customer stays active. No time limits.", delay: 0.04 },
            { q: "When are payouts sent?",            a: "We process affiliate payouts based on our standard schedule after the refund period clears.", delay: 0.08 },
            { q: "Who can promote RobinOS?",          a: "Any partner can apply. Creators, marketers, educators, and review channel owners are the best fit.", delay: 0.12 },
            { q: "Do affiliates get promo assets?",   a: "Yes — video demos, swipe copy, and banner creatives are being prepared and will be available in the affiliate area.", delay: 0.16 },
            { q: "Is RobinOS beginner friendly?",     a: "Absolutely. The platform is designed to be picked up in minutes. Users see value in the first session.", delay: 0.20 },
            { q: "Can international affiliates join?",a: "Yes. We support international partners. RobinOS accepts users worldwide.", delay: 0.24 },
          ].map((item) => <FaqItem key={item.q} {...item} />)}
        </div>
      </section>

      {/* ════════════ 12. FINAL CTA ══════════════════════════ */}
      <section className="relative z-10 px-4 py-24 sm:px-6 lg:px-8 max-w-[900px] mx-auto text-center">
        <Reveal>
          <div className="relative rounded-3xl overflow-hidden px-8 py-16"
            style={{ background: "linear-gradient(135deg, hsl(222 32% 9%), hsl(222 28% 7%))", border: "1px solid hsl(217 28% 14%)", boxShadow: "0 0 120px hsl(142 70% 55% / 0.05)" }}>
            <div className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(142 70% 55% / 0.06), transparent)" }} />

            <Label>Start Earning</Label>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 mb-4 text-chrome">
              Earn recurring income<br />promoting the future<br />of AI creator infrastructure.
            </h2>
            <p className="text-muted-foreground text-sm mb-8 max-w-md mx-auto">
              Join the RobinOS affiliate program today. 60% recurring commission on every active referral.
            </p>

            {/* Trust row */}
            <div className="flex flex-wrap justify-center gap-3 mb-8">
              {["60% recurring","Global affiliates","Monthly payouts","Creator economy niche"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono"
                  style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(var(--muted-foreground) / 0.55)" }}>
                  <CheckCircle className="w-3 h-3 text-emerald-400/70 shrink-0" strokeWidth={2} />
                  {item}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-4">
              <motion.a href={affiliateCtaUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-semibold text-white transition-all duration-300"
                style={{ background: "linear-gradient(135deg, hsl(142 70% 42%), hsl(142 65% 35%))", boxShadow: "0 4px 24px hsl(142 70% 55% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
                whileHover={{ scale: 1.02, boxShadow: "0 6px 32px hsl(142 70% 55% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
                whileTap={{ scale: 0.98 }}>
                {btnText} <ArrowRight className="w-4 h-4" />
              </motion.a>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/creator-os"
                  className="inline-flex items-center gap-2 h-12 px-8 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>
                  View Creator OS
                </Link>
              </motion.div>
            </div>
          </div>
        </Reveal>
      </section>
    </PublicLayout>
  );
}
