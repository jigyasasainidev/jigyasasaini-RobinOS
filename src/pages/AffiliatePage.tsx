import { useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Sparkles, Wallet, Globe, Percent, Star } from "lucide-react";
import Lenis from "lenis";

const RevealSection = ({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 34 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.75, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.section>
  );
};

const steps = [
  { num: "01", title: "Create Your Account", desc: "Sign up and access your RobinOS partner dashboard." },
  { num: "02", title: "Share Your Referral Link", desc: "Invite creators, agencies, and teams through your unique tracking link." },
  { num: "03", title: "Track Commission Performance", desc: "Monitor recurring commissions and campaign-specific incentives in one place." },
];

const statCards = [
  {
    title: "Policy-Based",
    subtitle: "Commission Structure",
    description: "Commission terms follow the active affiliate policy",
    icon: Percent,
    tone: "default",
  },
  {
    title: "Campaign-Based",
    subtitle: "Partner Programs",
    description: "Additional incentives may apply during approved campaigns",
    icon: Star,
    tone: "launch",
  },
  {
    title: "Threshold-Based",
    subtitle: "Payout Eligibility",
    description: "Withdrawals are available after policy requirements are met",
    icon: Wallet,
    tone: "default",
  },
  {
    title: "Global",
    subtitle: "Payout Support",
    description: "Built for international partner operations",
    icon: Globe,
    tone: "default",
  },
] as const;

const commissionCards = [
  {
    plan: "Creator Plan",
    price: "$19/mo",
    earning: "Policy-based recurring commissions",
    note: "Applies under active affiliate terms",
    featured: false,
    launch: false,
  },
  {
    plan: "Pro Creator Plan",
    price: "$39/mo",
    earning: "Recurring partner commissions",
    note: "Structured for long-term affiliate workflows",
    featured: true,
    launch: false,
  },
  {
    plan: "Agency Plan",
    price: "$99/mo",
    earning: "Campaign-linked commission incentives",
    note: "Available during approved promotional cycles",
    featured: false,
    launch: true,
  },
] as const;

const AffiliatePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.35,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  return (
    <div className="relative bg-background grain select-none-all overflow-x-hidden min-h-screen">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {[...Array(10)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-primary/20"
            style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
            animate={{ y: [0, -24, 0], opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 3 + Math.random() * 3, repeat: Infinity, delay: i * 0.35, ease: "easeInOut" }}
          />
        ))}
      </div>

      <div className="fixed top-6 left-6 z-50">
        <Link to="/" className="flex items-center gap-2 px-4 py-2 rounded-lg glass text-xs font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
      </div>

      <section className="min-h-[66vh] flex flex-col items-center justify-center px-4 sm:px-6 pt-20 relative z-10">
        <motion.div initial={{ opacity: 0, filter: "blur(14px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 1.1 }} className="text-center max-w-3xl">
          <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.25, duration: 0.45 }} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 mb-6">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-primary">Affiliate Program</span>
          </motion.div>
          <h1 className="text-chrome text-3xl sm:text-5xl md:text-7xl font-semibold leading-[1.05] tracking-tight">Partner With RobinOS</h1>
          <p className="mt-6 text-muted-foreground text-sm sm:text-base max-w-2xl mx-auto">
            Build partner workflows by referring creators, agencies, and businesses to the AI Content Operating System.
          </p>
        </motion.div>
      </section>

      <RevealSection className="py-6 px-4 sm:px-6 max-w-3xl mx-auto relative z-10">
        <div className="rounded-xl border border-border/60 bg-card/45 backdrop-blur-md p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <p className="text-foreground text-base font-medium">Earn Recurring Revenue</p>
            <span className="px-2.5 py-1 rounded-full border border-primary/25 bg-primary/10 text-[10px] font-mono tracking-wider uppercase text-primary">
              Public Affiliate Program
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Join the RobinOS affiliate ecosystem and earn commissions when your referrals subscribe to paid plans.
          </p>
        </div>
      </RevealSection>

      <RevealSection className="py-12 sm:py-16 px-4 sm:px-6 max-w-5xl mx-auto relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {statCards.map((card) => (
            <motion.div
              key={card.subtitle}
              whileHover={{ y: -3, boxShadow: card.tone === "launch" ? "0 0 30px hsl(38 92% 58% / 0.18)" : "0 0 30px hsl(var(--primary) / 0.14)" }}
              className={`relative overflow-hidden rounded-xl p-5 text-left transition-all ${card.tone === "launch" ? "border border-amber-500/30 bg-card/60" : "border border-border/60 bg-card/45"}`}
            >
              {card.tone === "launch" && (
                <motion.div
                  className="absolute inset-y-0 -left-1 w-1/3 bg-gradient-to-r from-amber-500/0 via-amber-400/30 to-amber-500/0"
                  animate={{ x: ["-120%", "380%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.4, ease: "linear" }}
                />
              )}
              <card.icon className={`w-4 h-4 mb-2 ${card.tone === "launch" ? "text-amber-300" : "text-primary"}`} />
              <p className={`text-2xl font-semibold leading-none ${card.tone === "launch" ? "text-amber-200" : "text-chrome"}`}>{card.title}</p>
              <p className={`text-xs font-mono tracking-[0.14em] uppercase mt-1 ${card.tone === "launch" ? "text-amber-300/90" : "text-muted-foreground"}`}>{card.subtitle}</p>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{card.description}</p>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      <RevealSection className="py-16 sm:py-20 px-4 sm:px-6 max-w-5xl mx-auto relative z-10">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-8 text-center">Commission Structure</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {commissionCards.map((card) => (
            <motion.div
              key={card.plan}
              whileHover={{ y: -5, scale: 1.01, boxShadow: card.launch ? "0 0 34px hsl(38 92% 58% / 0.16)" : "0 0 30px hsl(var(--primary) / 0.12)" }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className={`relative overflow-hidden rounded-xl p-6 sm:p-7 text-center ${card.launch ? "border border-amber-500/30 bg-card/60" : card.featured ? "border border-primary/40 bg-card/60" : "border border-border/60 bg-card/45"}`}
            >
              {card.launch && (
                <>
                  <motion.div
                    className="absolute inset-y-0 -left-1 w-1/3 bg-gradient-to-r from-amber-500/0 via-amber-400/35 to-amber-500/0"
                    animate={{ x: ["-130%", "380%"] }}
                    transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.2, ease: "linear" }}
                  />
                  <div className="absolute top-3 left-1/2 -translate-x-1/2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono tracking-[0.12em] uppercase border border-amber-400/35 bg-amber-400/15 text-amber-200">
                      Launch Special
                    </span>
                  </div>
                </>
              )}
              {!card.launch && (
                <p
                  className="text-sm font-mono font-medium tracking-[0.12em] uppercase antialiased [text-rendering:geometricPrecision] text-muted-foreground"
                >
                  {card.plan}
                </p>
              )}
              <p className="mt-2 text-muted-foreground text-sm">{card.price}</p>
              <p className={`mt-4 text-xl sm:text-2xl font-semibold leading-tight ${card.launch ? "text-amber-200" : "text-chrome"}`}>{card.earning}</p>
              <p className={`mt-2 text-[11px] ${card.launch ? "text-amber-200/80" : "text-muted-foreground"}`}>{card.note}</p>
            </motion.div>
          ))}
        </div>
        <p className="text-center text-[11px] text-muted-foreground/60 mt-7 max-w-3xl mx-auto">
          Special commission rates may apply during launch events, partner campaigns, and limited-time promotions.
        </p>
      </RevealSection>

      <RevealSection className="py-14 sm:py-16 px-4 sm:px-6 max-w-3xl mx-auto relative z-10">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-8 text-center">How It Works</p>
        <div className="space-y-4 sm:space-y-5">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.55 }}
              whileHover={{ x: 4, borderColor: "hsl(212 100% 50% / 0.3)" }}
              className="flex gap-4 sm:gap-5 items-start rounded-xl border border-border/60 bg-card/45 p-5 sm:p-6 transition-all"
            >
              <span className="text-primary font-mono text-xl sm:text-2xl font-semibold">{step.num}</span>
              <div>
                <h3 className="text-foreground font-medium text-sm mb-1">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      <RevealSection className="py-14 sm:py-16 px-4 sm:px-6 max-w-xl mx-auto text-center relative z-10">
        <div className="rounded-xl border border-border/60 bg-card/45 p-8 sm:p-10">
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">Ready to Partner?</p>
          <p className="text-muted-foreground text-sm mb-6">Create your account and start sharing your RobinOS referral link.</p>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => navigate("/auth")} className="px-8 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue shimmer-btn">
            Join RobinOS
          </motion.button>
        </div>
      </RevealSection>

      <footer className="border-t border-border py-12 px-4 sm:px-6 mt-16 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground/40 text-xs">© {new Date().getFullYear()} RobinOS. All rights reserved.</p>
          <p className="text-muted-foreground/30 text-[10px] font-mono mt-2">
            Global • Remote-first · <a href="mailto:support@tryrobin.xyz" className="hover:text-primary transition-colors">support@tryrobin.xyz</a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default AffiliatePage;
