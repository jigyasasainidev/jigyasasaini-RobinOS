import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, X, TrendingUp, PenTool, Mic, Hash,
  Zap, Users, Target, Layers, Sparkles, CheckCircle2,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

// ── Types ──────────────────────────────────────────────────
interface OnboardingPopupProps {
  onComplete: () => void;
}

interface OnboardingPrefs {
  goals:    string[];
  platform: string | null;
  style:    string | null;
}

const STORAGE_KEY_PREFS  = "robinos_onboarding_prefs";
const STORAGE_KEY_DONE   = "robinos_onboarding_done";
const STORAGE_KEY_PERM   = "robinos_onboarding_done_permanent";

// ── Step data ──────────────────────────────────────────────
const GOALS = [
  { id: "trends",      icon: TrendingUp, label: "Find viral trends",       sub: "Before competitors do" },
  { id: "scripts",     icon: PenTool,    label: "Generate scripts faster",  sub: "10× your output speed" },
  { id: "hashtags",    icon: Hash,       label: "Grow with hashtags",       sub: "Platform-optimised picks" },
  { id: "voice",       icon: Mic,        label: "Create voice overs",       sub: "ElevenLabs quality" },
  { id: "consistency", icon: Layers,     label: "Post consistently",        sub: "Never run out of ideas" },
  { id: "audience",    icon: Users,      label: "Build an audience",        sub: "Creator OS approach" },
];

const PLATFORMS = [
  { id: "TikTok",     emoji: "📱", label: "TikTok",     sub: "Short-form virality"   },
  { id: "Instagram",  emoji: "📸", label: "Instagram",  sub: "Reels & Stories"       },
  { id: "YouTube",    emoji: "▶️",  label: "YouTube",    sub: "Shorts & long-form"   },
  { id: "Facebook",   emoji: "📘", label: "Facebook",   sub: "Community & reach"     },
];

const STYLES = [
  { id: "Educational",   label: "Educational",    sub: "Teach & inform" },
  { id: "Storytelling",  label: "Storytelling",   sub: "Narrative hooks" },
  { id: "AI/Tech",       label: "AI / Tech",      sub: "Futuristic niche" },
  { id: "Motivation",    label: "Motivation",     sub: "Inspire action" },
  { id: "Lifestyle",     label: "Lifestyle",      sub: "Aesthetic content" },
  { id: "Business",      label: "Business",       sub: "Growth & strategy" },
];

const TOTAL_STEPS = 5;

// ── Selectable card ────────────────────────────────────────
function SelectCard({
  selected, onClick, children,
}: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className="text-left rounded-xl px-3.5 py-3 transition-all duration-200 w-full"
      style={selected ? {
        background: "hsl(217 91% 60% / 0.1)",
        border:     "1px solid hsl(217 91% 60% / 0.35)",
        boxShadow:  "0 0 16px hsl(217 91% 60% / 0.08)",
      } : {
        background: "hsl(222 28% 7%)",
        border:     "1px solid hsl(217 28% 13%)",
      }}
    >
      {children}
    </motion.button>
  );
}

// ── Main component ─────────────────────────────────────────
export const OnboardingPopup = ({ onComplete }: OnboardingPopupProps) => {
  const navigate  = useNavigate();
  const [step,    setStep]    = useState(0);
  const [prefs,   setPrefs]   = useState<OnboardingPrefs>({ goals: [], platform: null, style: null });
  const [leaving, setLeaving] = useState(false);

  const persistAndClose = useCallback((permanent = false) => {
    // eslint-disable-next-line no-console
    console.log("[Onboarding] persistAndClose called", { permanent, prefs });
    try {
      // eslint-disable-next-line no-console
      console.log("[Onboarding] before localStorage.setItem STORAGE_KEY_PREFS");
      localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
      // eslint-disable-next-line no-console
      console.log("[Onboarding] after localStorage.setItem STORAGE_KEY_PREFS");

      // eslint-disable-next-line no-console
      console.log("[Onboarding] before localStorage.setItem STORAGE_KEY_DONE");
      localStorage.setItem(STORAGE_KEY_DONE, "true");
      // eslint-disable-next-line no-console
      console.log("[Onboarding] after localStorage.setItem STORAGE_KEY_DONE");

      if (permanent) {
        // eslint-disable-next-line no-console
        console.log("[Onboarding] before localStorage.setItem STORAGE_KEY_PERM");
        localStorage.setItem(STORAGE_KEY_PERM, "true");
        // eslint-disable-next-line no-console
        console.log("[Onboarding] after localStorage.setItem STORAGE_KEY_PERM");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Onboarding] localStorage write failed", err);
    }
    // eslint-disable-next-line no-console
    console.log("[Onboarding] before onComplete()");
    onComplete();
    // eslint-disable-next-line no-console
    console.log("[Onboarding] after onComplete()");
  }, [prefs, onComplete]);

  const next = () => {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
  };

  const dismiss = () => {
    // eslint-disable-next-line no-console
    console.log("[Onboarding] dismiss() called");
    persistAndClose(false);
  };

  const toggleGoal = (id: string) => {
    setPrefs((p) => ({
      ...p,
      goals: p.goals.includes(id) ? p.goals.filter((g) => g !== id) : [...p.goals, id],
    }));
  };

  // Progress % — shows continuously filling bar
  const progressPct = ((step) / (TOTAL_STEPS - 1)) * 100;

  // ── Step renders ────────────────────────────────────────
  const renderStep = () => {
    switch (step) {

      /* ── STEP 0: Welcome ──────────────────────────────── */
      case 0:
        return (
          <div className="flex flex-col items-center text-center gap-5">
            {/* Animated logo glow */}
            <motion.div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
              animate={{ boxShadow: [
                "0 0 0 hsl(217 91% 60% / 0)",
                "0 0 32px hsl(217 91% 60% / 0.2)",
                "0 0 0 hsl(217 91% 60% / 0)",
              ]}}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <BrandMark size={28} withWordmark={false}
                className="drop-shadow-[0_0_14px_hsl(217_91%_60%/0.5)]" />
            </motion.div>

            <div>
              <p className="text-[9.5px] font-mono uppercase tracking-[0.25em] text-primary/55 mb-2">
                AI Creator Operating System
              </p>
              <h2 className="text-xl font-semibold text-chrome leading-snug mb-3">
                Your intelligent creator<br />workspace is ready.
              </h2>
              <p className="text-[12px] text-muted-foreground/60 leading-relaxed max-w-[280px] mx-auto">
                RobinOS helps you find viral trends, generate scripts, and create content — faster than ever.
              </p>
            </div>

            {/* Feature chips */}
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { icon: TrendingUp, label: "Trend Scanner" },
                { icon: PenTool,    label: "Script Engine" },
                { icon: Hash,       label: "Audio & Hashtags" },
                { icon: Mic,        label: "Voice Studio" },
              ].map(({ icon: Icon, label }) => (
                <span key={label}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono"
                  style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 45%)" }}>
                  <Icon className="w-3 h-3" strokeWidth={1.5} />{label}
                </span>
              ))}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={next}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 glow-blue"
              style={{ background: "hsl(217 91% 55%)", color: "#fff",
                boxShadow: "0 4px 20px hsl(217 91% 60% / 0.25), inset 0 1px 0 hsl(0 0% 100% / 0.12)" }}>
              Set up my workspace <ArrowRight className="w-4 h-4" />
            </motion.button>

            <button type="button" onClick={dismiss}
              className="text-[10.5px] text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors">
              Skip setup — go to dashboard
            </button>
          </div>
        );

      /* ── STEP 1: Creator goals ─────────────────────────── */
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-primary/50 mb-1.5">
                Step 1 of 3
              </p>
              <h2 className="text-lg font-semibold text-chrome mb-1">What are your creator goals?</h2>
              <p className="text-[11.5px] text-muted-foreground/50">Select all that apply — we'll personalise RobinOS for you.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {GOALS.map(({ id, icon: Icon, label, sub }) => {
                const sel = prefs.goals.includes(id);
                return (
                  <SelectCard key={id} selected={sel} onClick={() => toggleGoal(id)}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className="w-3.5 h-3.5 shrink-0"
                        style={{ color: sel ? "hsl(217 91% 68%)" : "hsl(215 16% 40%)" }}
                        strokeWidth={1.6} />
                      <p className="text-[11.5px] font-medium leading-tight"
                        style={{ color: sel ? "hsl(217 91% 68%)" : "hsl(var(--foreground) / 0.8)" }}>
                        {label}
                      </p>
                    </div>
                    <p className="text-[9.5px] text-muted-foreground/38 pl-5.5">{sub}</p>
                    {sel && (
                      <div className="absolute top-2.5 right-2.5">
                        <CheckCircle2 className="w-3 h-3 text-primary" />
                      </div>
                    )}
                  </SelectCard>
                );
              })}
            </div>
            <motion.button
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={next} disabled={prefs.goals.length === 0}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        );

      /* ── STEP 2: Platform ──────────────────────────────── */
      case 2:
        return (
          <div className="space-y-4">
            <div>
              <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-primary/50 mb-1.5">
                Step 2 of 3
              </p>
              <h2 className="text-lg font-semibold text-chrome mb-1">Where do you create content?</h2>
              <p className="text-[11.5px] text-muted-foreground/50">RobinOS will optimise AI outputs for your platform.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map(({ id, emoji, label, sub }) => {
                const sel = prefs.platform === id;
                return (
                  <SelectCard key={id} selected={sel}
                    onClick={() => setPrefs((p) => ({ ...p, platform: id }))}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-base shrink-0">{emoji}</span>
                      <p className="text-[11.5px] font-medium leading-tight"
                        style={{ color: sel ? "hsl(217 91% 68%)" : "hsl(var(--foreground) / 0.8)" }}>
                        {label}
                      </p>
                    </div>
                    <p className="text-[9.5px] text-muted-foreground/38 pl-6">{sub}</p>
                  </SelectCard>
                );
              })}
            </div>
            <motion.button
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={next} disabled={!prefs.platform}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        );

      /* ── STEP 3: Creator style ─────────────────────────── */
      case 3:
        return (
          <div className="space-y-4">
            <div>
              <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-primary/50 mb-1.5">
                Step 3 of 3
              </p>
              <h2 className="text-lg font-semibold text-chrome mb-1">What's your content style?</h2>
              <p className="text-[11.5px] text-muted-foreground/50">Helps RobinOS tailor your scripts and trend picks.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STYLES.map(({ id, label, sub }) => {
                const sel = prefs.style === id;
                return (
                  <SelectCard key={id} selected={sel}
                    onClick={() => setPrefs((p) => ({ ...p, style: id }))}>
                    <p className="text-[11.5px] font-medium leading-tight mb-0.5"
                      style={{ color: sel ? "hsl(217 91% 68%)" : "hsl(var(--foreground) / 0.8)" }}>
                      {label}
                    </p>
                    <p className="text-[9.5px] text-muted-foreground/38">{sub}</p>
                  </SelectCard>
                );
              })}
            </div>
            <motion.button
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={next} disabled={!prefs.style}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: "hsl(217 91% 55%)", color: "#fff" }}>
              Activate workspace <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        );

      /* ── STEP 4: Activation / launch ───────────────────── */
      case 4:
        return (
          <div className="flex flex-col items-center text-center gap-5">
            {/* Animated success glow */}
            <div className="relative flex items-center justify-center">
              {[0, 1].map((i) => (
                <motion.div key={i}
                  className="absolute rounded-full"
                  style={{ width: 64 + i * 36, height: 64 + i * 36, border: "1px solid hsl(142 65% 52% / 0.2)" }}
                  animate={{ scale: [1, 1.5, 1.5], opacity: [0.5, 0, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }} />
              ))}
              <motion.div
                className="relative w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "hsl(142 65% 50% / 0.1)", border: "1px solid hsl(142 65% 50% / 0.25)" }}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}>
                <CheckCircle2 className="w-7 h-7 text-emerald-400" strokeWidth={1.5} />
              </motion.div>
            </div>

            <div>
              <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-emerald-400/60 mb-2">
                Workspace Activated
              </p>
              <h2 className="text-xl font-semibold text-chrome mb-2 leading-snug">
                RobinOS is personalised<br />for your workflow.
              </h2>
              <p className="text-[11.5px] text-muted-foreground/55 leading-relaxed max-w-[270px] mx-auto">
                {prefs.platform
                  ? `Optimised for ${prefs.platform} · ${prefs.style ?? "your"} content style`
                  : "Your creator intelligence system is ready."}
              </p>
            </div>

            {/* First action suggestion */}
            <div className="w-full space-y-2">
              <p className="text-[9.5px] font-mono text-muted-foreground/35 uppercase tracking-wider mb-1">
                Where do you want to start?
              </p>
              {[
                {
                  icon: TrendingUp,
                  label: "Discover trending topics",
                  sub:   "Find viral content ideas now",
                  path:  "/dashboard/trend-scanner",
                  color: "hsl(217 91% 60%)",
                },
                {
                  icon: PenTool,
                  label: "Generate your first script",
                  sub:   "Ready-to-record in seconds",
                  path:  "/dashboard/studio",
                  color: "hsl(280 65% 62%)",
                },
                {
                  icon: Hash,
                  label: "Find trending audio & hashtags",
                  sub:   `Top signals for ${prefs.platform ?? "your platform"}`,
                  path:  "/dashboard/audio-hashtag",
                  color: "hsl(142 65% 52%)",
                },
              ].map(({ icon: Icon, label, sub, path, color }) => (
                <motion.button key={path}
                  whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }}
                  onClick={() => { persistAndClose(true); navigate(path); }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all"
                  style={{ background: "hsl(222 28% 7%)", border: "1px solid hsl(217 28% 12%)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: color.replace(")", " / 0.1)"), border: `1px solid ${color.replace(")", " / 0.22)")}` }}>
                    <Icon className="w-4 h-4" style={{ color }} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] font-medium text-foreground/85 leading-tight">{label}</p>
                    <p className="text-[9.5px] text-muted-foreground/38 mt-0.5">{sub}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/25 shrink-0" />
                </motion.button>
              ))}
            </div>

            <button onClick={() => persistAndClose(true)}
              className="text-[10.5px] text-muted-foreground/30 hover:text-muted-foreground/55 transition-colors">
              Go to dashboard →
            </button>
          </div>
        );

      default: return null;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0"
          style={{ background: "hsl(222 28% 4% / 0.82)", backdropFilter: "blur(12px)" }}
          onClick={step === 0 ? dismiss : undefined}
        />

        {/* Modal container — button is positioned outside the panel so it
            cannot be clipped or covered by the panel’s overflow-hidden/rounded
            corners or internal content stacking. */}
        <div className="relative w-full max-w-md">
          {/* Close button */}
          <button
            type="button"
            onClick={(e) => {
              // eslint-disable-next-line no-console
              console.log("[Onboarding] X button onClick fired");
              e.stopPropagation();
              dismiss();
            }}
            className="absolute top-4 right-4 z-10 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 40%)" }}>
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 24 }}
            transition={{ duration: 0.38, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative w-full rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(160deg, hsl(222 28% 8%) 0%, hsl(222 26% 6%) 100%)",
              border:     "1px solid hsl(217 28% 14%)",
              boxShadow:  "0 0 80px hsl(217 91% 60% / 0.08), 0 24px 64px hsl(0 0% 0% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
            }}
          >
            {/* Top ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 pointer-events-none"
              style={{ background: "radial-gradient(ellipse, hsl(217 91% 60% / 0.1) 0%, transparent 70%)" }} />

            {/* Progress bar */}
            <div className="relative h-[2px] w-full" style={{ background: "hsl(217 28% 11%)" }}>
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: "linear-gradient(90deg, hsl(217 91% 52%), hsl(217 91% 68%))" }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>

            {/* Content */}
            <div className="relative p-6 pt-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16, filter: "blur(4px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -16, filter: "blur(4px)" }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  {renderStep()}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
