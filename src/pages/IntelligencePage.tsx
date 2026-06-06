import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, TrendingUp, Flame, ArrowRight, Sparkles, Loader2, Radio, Wifi, Globe, Zap, Lock, Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/cloudDb";
import { useFreeTrialStatus } from "@/hooks/useProfile";
import { usePlanKey, useIsProOrAbove, useIsAgency, useMaxTrendTopics, useIsFree } from "@/hooks/useEntitlements";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import {
  scanNicheTrends,
  isEntitlementError,
  type TrendTopic,
} from "@/services/ideaStream";

// TrendTopic is imported from @/services/ideaStream

type ScanState = "idle" | "scanning" | "results";

const scanTexts = [
  "Initializing Neural Scanner...",
  "Scanning TikTok Signals...",
  "Decoding Google Trends...",
  "Analyzing X / Twitter...",
  "Processing YouTube Data...",
  "Cross-referencing Reddit...",
  "Compiling Intelligence Report...",
];

const scanIcons = [Zap, Radio, Globe, Wifi, Sparkles, Search, TrendingUp];

const IntelligencePage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const plan = usePlanKey();
  const { expired, scansLeft, isFree } = useFreeTrialStatus();
  const isAgency = useIsAgency();
  const isPro = plan === "pro_creator";
  const maxTopics = useMaxTrendTopics();
  const [niche, setNiche] = useState("");
  const [state, setState] = useState<ScanState>("idle");
  const [topics, setTopics] = useState<TrendTopic[]>([]);
  const [scanTextIndex, setScanTextIndex] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleScan = async () => {
    if (!niche.trim()) { toast.error("Enter your niche first"); return; }
    if (isFree && (expired || scansLeft <= 0)) { setShowUpgrade(true); return; }

    setState("scanning");
    setScanTextIndex(0);

    const interval = setInterval(() => {
      setScanTextIndex((prev) => (prev + 1) % scanTexts.length);
    }, 1200);

    try {
      // ── Idea Stream: niche topic scan ──────────────────────
      const result = await scanNicheTrends(niche);

      clearInterval(interval);

      if (!result.ok) {
        if (isEntitlementError(result)) {
          toast.error(result.message);
          setShowUpgrade(true);
        } else {
          toast.error(result.message || "Scan failed");
        }
        setState("idle");
        return;
      }

      let fetchedTopics = result.topics;

      if (!isAgency && fetchedTopics.length > maxTopics) {
        fetchedTopics = fetchedTopics.slice(0, maxTopics);
      }

      setTopics(fetchedTopics);
      setState("results");

      if (user && fetchedTopics.length > 0) {
        db.from("scan_history").insert({
          user_id: user.id, niche: niche.trim(), topics: fetchedTopics,
        } as any).then(() => {});
      }
    } catch {
      clearInterval(interval);
      toast.error("Network error. Try again.");
      setState("idle");
    }
  };

  const handleBuildScript = (topic: string) => {
    navigate(`/dashboard/studio?topic=${encodeURIComponent(topic)}`);
  };

  const scanBadge = isAgency
    ? { label: "AGENCY — Unlimited", className: "border-amber-500/30 text-amber-400" }
    : isPro
      ? { label: `Deep Scan — ${maxTopics} topics`, className: "border-primary/30 text-primary" }
      : isFree
        ? { label: `Free — ${scansLeft} scan left`, className: "border-border text-muted-foreground" }
        : { label: `Basic — ${maxTopics} topics`, className: "border-border text-muted-foreground" };

  return (
    <div className="relative">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center md:text-left">
        <div className="flex items-center gap-2 mb-2 justify-center md:justify-start">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono tracking-[0.15em] text-muted-foreground">Creator Intel</span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold mb-2">Trend Radar</h1>
        <Badge variant="outline" className={`text-[10px] font-mono ${scanBadge.className}`}>
          {scanBadge.label}
        </Badge>
        <p className="text-muted-foreground text-sm mt-3 max-w-md mx-auto md:mx-0">
          Enter your niche. We'll scan the internet for viral opportunities.
        </p>
        {!isPro && !isAgency && (
          <button onClick={() => setShowUpgrade(true)} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors duration-200 font-mono">
            <Lock className="w-3 h-3" /> Unlock Deep Scanning →
          </button>
        )}
      </motion.div>

      {/* Search Bar */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="max-w-xl mx-auto md:mx-0 mb-10">
        <label className="text-xs font-mono tracking-wider text-muted-foreground mb-3 block text-center md:text-left">
          Enter your niche
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              placeholder="e.g. AI Tools, Fitness, Personal Finance..."
              className="pl-10 bg-secondary/50 border-border/60 text-foreground placeholder:text-muted-foreground/40 h-12 text-sm rounded-xl input-glass focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={state === "scanning"}
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleScan}
            disabled={state === "scanning"}
            className="h-12 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-200 btn-primary w-full sm:w-auto sm:px-8"
          >
            {state === "scanning" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Run Trend Radar
          </motion.button>
        </div>
      </motion.div>

      {/* Scanning Animation */}
      <AnimatePresence>
        {state === "scanning" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/98 backdrop-blur-md">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div key={`ring-${i}`} className="absolute rounded-full border border-primary/15" style={{ width: 80 + i * 30, height: 80 + i * 30 }} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: [0.3, 2.5, 3.5], opacity: [0, 0.6, 0] }} transition={{ duration: 3, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }} />
            ))}
            <motion.div className="absolute w-40 h-[1px] origin-left" style={{ background: "linear-gradient(90deg, hsl(212 100% 50% / 0.8), transparent)" }} animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} />
            {[...Array(8)].map((_, i) => (
              <motion.div key={`particle-${i}`} className="absolute w-1 h-1 rounded-full bg-primary/60" initial={{ x: 0, y: 0, opacity: 0 }} animate={{ x: [0, (Math.random() - 0.5) * 200], y: [0, (Math.random() - 0.5) * 200], opacity: [0, 1, 0], scale: [0, 1.5, 0] }} transition={{ duration: 2 + Math.random() * 1.5, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }} />
            ))}
            <motion.div className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "radial-gradient(circle, hsl(212 100% 50% / 0.3) 0%, transparent 70%)" }}>
              <motion.div className="w-5 h-5 rounded-full bg-primary glow-blue" animate={{ scale: [1, 1.4, 1], boxShadow: ["0 0 20px hsl(212 100% 50% / 0.3)", "0 0 60px hsl(212 100% 50% / 0.6)", "0 0 20px hsl(212 100% 50% / 0.3)"] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} />
            </motion.div>
            <AnimatePresence mode="wait">
              {(() => { const IconComp = scanIcons[scanTextIndex % scanIcons.length]; return (<motion.div key={`icon-${scanTextIndex}`} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 0.4, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.3 }} className="absolute top-[calc(50%-80px)]"><IconComp className="w-6 h-6 text-primary/40" /></motion.div>); })()}
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.p key={scanTextIndex} initial={{ opacity: 0, y: 15, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -15, filter: "blur(4px)" }} transition={{ duration: 0.4 }} className="mt-12 text-sm font-mono text-primary tracking-wider z-10">{scanTexts[scanTextIndex]}</motion.p>
            </AnimatePresence>
            <motion.p animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2, repeat: Infinity }} className="mt-4 text-xs text-muted-foreground/60 font-mono z-10">Target: "{niche}"</motion.p>
            <div className="mt-8 w-48 h-[2px] rounded-full bg-border overflow-hidden z-10">
              <motion.div className="h-full bg-primary rounded-full" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 8, ease: "linear" }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {state === "results" && topics.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-4">
            <div className="flex items-center gap-2 mb-4 justify-center md:justify-start">
              <Flame className="w-4 h-4 text-primary" />
              <span className="text-xs font-mono tracking-wider text-muted-foreground">{topics.length} Signals Detected</span>
            </div>
            {topics.map((topic, i) => (
              <motion.div key={topic.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1, duration: 0.4 }} whileHover={{ borderColor: "hsl(212 100% 50% / 0.3)", scale: 1.005 }} className="rounded-xl border-glass bg-card p-4 md:p-6 transition-all group card-glow">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 md:gap-3 mb-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground/50">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="text-sm font-semibold text-foreground">{topic.title}</h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Flame className="w-3 h-3 text-primary" />
                        <span className="text-xs font-mono text-primary">{topic.heat}</span>
                      </div>
                      {topic.volume && (
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                          topic.volume === "High" ? "bg-red-500/10 text-red-400" :
                          topic.volume === "Medium" ? "bg-amber-500/10 text-amber-400" :
                          "bg-blue-500/10 text-blue-400"
                        }`}>{topic.volume}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">{topic.description}</p>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {topic.platforms.split(",").map((p) => (
                        <span key={p.trim()} className="px-2 py-0.5 rounded-md bg-secondary text-[10px] font-mono text-muted-foreground">{p.trim()}</span>
                      ))}
                    </div>
                    {topic.hook_types && topic.hook_types.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-mono text-muted-foreground/50">HOOKS:</span>
                        {topic.hook_types.map((h) => (
                          <span key={h} className="px-1.5 py-0.5 rounded bg-primary/10 text-[9px] font-mono text-primary border border-primary/20">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <motion.button whileHover={{ scale: 1.02, x: 2 }} whileTap={{ scale: 0.96 }} onClick={() => handleBuildScript(topic.title)} className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-medium border border-primary/20 hover:bg-primary/20 transition-all w-full md:w-auto">
                    Open Script Engine <ArrowRight className="w-3 h-3" />
                  </motion.button>
                </div>
              </motion.div>
            ))}
            {!isPro && !isAgency && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="rounded-xl border border-dashed border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary/60" />
                  <span className="text-xs text-muted-foreground">Unlock deeper radar coverage with Pro or Agency</span>
                </div>
                <button onClick={() => setShowUpgrade(true)} className="text-xs text-primary font-medium hover:underline">Upgrade →</button>
              </motion.div>
            )}
            <div className="pt-4 text-center md:text-left">
              <button onClick={() => { setState("idle"); setTopics([]); }} className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200 font-mono">← Scan another vertical</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {state === "results" && topics.length === 0 && (
        <div className="text-center py-20">
          <p className="text-muted-foreground text-sm">No trends found. Try a different niche.</p>
          <button onClick={() => setState("idle")} className="mt-4 text-xs text-primary font-mono">← Try again</button>
        </div>
      )}

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default IntelligencePage;
