import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, Sparkles, Loader2, Search, Flame,
  ArrowRight, Zap, Radio, Wifi, Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AIStatusBadge, StatusBadge } from "@/components/ui/status-badge";

interface TrendTopic {
  title:       string;
  description: string;
  platforms:   string;
  heat:        number;
  hook_types:  string[];
  volume:      "High" | "Medium" | "Emerging";
}

const SCANNER_MESSAGES = [
  "Scanning creator signals...",
  "Analyzing trend velocity...",
  "Detecting viral patterns...",
  "Measuring topic saturation...",
  "Mapping audience demand...",
  "Calibrating AI intelligence...",
];

const SCAN_ICONS = [Zap, Radio, Globe, Wifi, Sparkles, Search, TrendingUp];

const TrendScannerPage = () => {
  const navigate = useNavigate();

  const [niche,       setNiche]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [topics,      setTopics]      = useState<TrendTopic[]>([]);
  const [msgIdx,      setMsgIdx]      = useState(0);
  const [iconIdx,     setIconIdx]     = useState(0);
  const [scanned,     setScanned]     = useState(false);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef   = useRef<number>(0);          // debounce: timestamp of last scan start
  const DEBOUNCE_MS   = 1500;                        // ignore clicks within 1.5s of previous

  const handleScan = async () => {
    if (!niche.trim()) { toast.error("Enter a niche to scan"); return; }

    // Debounce: ignore if another scan started within DEBOUNCE_MS
    const now = Date.now();
    if (now - lastScanRef.current < DEBOUNCE_MS) return;
    lastScanRef.current = now;

    setLoading(true);
    setScanned(true);
    setTopics([]);
    setMsgIdx(0);
    setIconIdx(0);

    let m = 0, ic = 0;
    intervalRef.current = setInterval(() => {
      m  = (m  + 1) % SCANNER_MESSAGES.length;
      ic = (ic + 1) % SCAN_ICONS.length;
      setMsgIdx(m);
      setIconIdx(ic);
    }, 1100);

    try {
      const { data, error } = await supabase.functions.invoke("scan-trends", {
        body: { niche: niche.trim() },
      });

      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setLoading(false);

      if (error) {
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (error as any)?.context?.responseText ?? (error as any)?.message ?? "";
          if (typeof raw === "string" && raw.startsWith("{")) parsed = JSON.parse(raw);
        } catch { /* ignore */ }

        if (status === 429) {
          toast.error("Too many scans. Please wait 1 minute before trying again.");
        } else if (status === 403) {
          toast.error(String(parsed.error ?? parsed.message ?? "Scan limit reached. Upgrade your plan."));
        } else {
          toast.error("Scan failed. Try again in a moment.");
        }
        return;
      }

      const result = (data?.topics ?? []) as TrendTopic[];
      setTopics(result);
      if (!result.length) toast.error("No trends found. Try a different niche.");
    } catch {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setLoading(false);
      toast.error("Network error. Try again.");
    }
  };

  const useInScriptEngine = (title: string) => {
    navigate(`/dashboard/studio?topic=${encodeURIComponent(title)}`);
  };

  return (
    <div className="pt-14 md:pt-0">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Trend Scanner</span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold mb-1">
          Discover What's Trending
        </h1>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-muted-foreground text-sm">
            Enter your niche → AI scans for viral creator opportunities → pick a trend → generate your script.
          </p>
          <AnimatePresence>
            {loading && (
              <AIStatusBadge phase={SCANNER_MESSAGES[msgIdx]} active={loading} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Search */}
      <div className="glass-card p-5 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleScan()}
              placeholder="Enter your niche — e.g. Fitness, AI Tools, Personal Finance..."
              className="input-glass h-12 text-sm pl-10 rounded-xl"
              disabled={loading}
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={handleScan}
            disabled={loading || !niche.trim()}
            className="btn-primary flex items-center justify-center gap-2 !py-3 !px-7 shrink-0 shimmer-btn disabled:opacity-50"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
              : <><Sparkles className="w-4 h-4" /> Scan Now</>}
          </motion.button>
        </div>
      </div>

      {/* Scanning animation */}
      <AnimatePresence>
        {loading && (
          <motion.div
            key="scan-anim"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="relative rounded-2xl overflow-hidden mb-5 flex flex-col items-center justify-center py-16"
            style={{ background: "hsl(222 28% 5.5% / 0.95)", border: "1px solid hsl(217 91% 60% / 0.12)" }}
          >
            {[0,1,2,3].map((i) => (
              <motion.div key={`r-${i}`}
                className="absolute rounded-full border border-primary/10"
                style={{ width: 80 + i * 38, height: 80 + i * 38 }}
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: [0.3, 2.5, 3.5], opacity: [0, 0.5, 0] }}
                transition={{ duration: 3, repeat: Infinity, delay: i * 0.55, ease: "easeOut" }}
              />
            ))}
            <motion.div
              className="absolute w-40 h-[1.5px] origin-left"
              style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.7), transparent)" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center mb-5"
              style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
            >
              {(() => {
                const Icon = SCAN_ICONS[iconIdx % SCAN_ICONS.length];
                return (
                  <motion.div key={iconIdx} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}>
                    <Icon className="w-7 h-7 text-primary" strokeWidth={1.5} />
                  </motion.div>
                );
              })()}
            </motion.div>
            <AnimatePresence mode="wait">
              <motion.p
                key={msgIdx}
                initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                transition={{ duration: 0.35 }}
                className="relative z-10 text-sm font-mono text-primary tracking-wider"
              >
                {SCANNER_MESSAGES[msgIdx]}
              </motion.p>
            </AnimatePresence>
            <p className="relative z-10 mt-2 text-[11px] text-muted-foreground/50 font-mono">
              Target: "{niche}"
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence mode="wait">
        {!loading && scanned && topics.length > 0 && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-3.5 h-3.5 text-primary/70" />
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">
                {topics.length} signals detected for "{niche}"
              </span>
              <StatusBadge status="completed" label="AI Complete" />
            </div>

            {topics.map((t, i) => (
              <motion.div
                key={t.title}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                className="glass-card p-4 group"
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Flame className="w-3 h-3 text-primary" />
                        <span className="text-xs font-mono text-primary">{t.heat}</span>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        t.volume === "High"   ? "bg-red-500/10 text-red-400"
                        : t.volume === "Medium" ? "bg-amber-500/10 text-amber-400"
                        : "bg-blue-500/10 text-blue-400"
                      }`}>{t.volume}</span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground leading-relaxed mb-2">{t.description}</p>

                    {/* Platforms */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      {t.platforms.split(",").map((p) => (
                        <span key={p.trim()} className="px-2 py-0.5 rounded-md bg-secondary text-[10px] font-mono text-muted-foreground">
                          {p.trim()}
                        </span>
                      ))}
                    </div>

                    {/* Hooks */}
                    {t.hook_types?.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-mono text-muted-foreground/40">HOOKS:</span>
                        {t.hook_types.map((h) => (
                          <span key={h} className="px-1.5 py-0.5 rounded bg-primary/8 text-[9px] font-mono text-primary border border-primary/15">
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  <motion.button
                    whileHover={{ scale: 1.02, x: 2 }} whileTap={{ scale: 0.97 }}
                    onClick={() => useInScriptEngine(t.title)}
                    className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all w-full md:w-auto"
                    style={{
                      background: "hsl(217 91% 60% / 0.08)",
                      border: "1px solid hsl(217 91% 60% / 0.2)",
                      color: "hsl(217 91% 68%)",
                    }}
                  >
                    Build Script <ArrowRight className="w-3 h-3" />
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {!loading && scanned && topics.length === 0 && (
          <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl flex flex-col items-center justify-center text-center px-6 py-14"
            style={{ background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)", border: "1px solid hsl(217 28% 12%)" }}>
            <motion.div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "hsl(38 90% 55% / 0.08)", border: "1px solid hsl(38 90% 55% / 0.2)" }}
              animate={{ boxShadow: ["0 0 0 hsl(38 90% 55% / 0)", "0 0 20px hsl(38 90% 55% / 0.1)", "0 0 0 hsl(38 90% 55% / 0)"] }}
              transition={{ duration: 3.5, repeat: Infinity }}>
              <TrendingUp className="w-5 h-5 text-amber-400/70" strokeWidth={1.5} />
            </motion.div>
            <p className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-amber-400/50 mb-2">No Signals Detected</p>
            <p className="text-sm font-medium text-foreground/80 mb-2">Nothing trending for this niche yet</p>
            <p className="text-[11px] text-muted-foreground/45 leading-relaxed max-w-xs mb-5">
              Try a broader niche or different keywords. Creator niches like <span className="text-primary/60 font-mono">Fitness</span>, <span className="text-primary/60 font-mono">AI Tools</span>, or <span className="text-primary/60 font-mono">Personal Finance</span> scan best.
            </p>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => { setNiche(""); document.querySelector<HTMLInputElement>("input")?.focus(); }}
              className="px-4 py-2 rounded-xl text-xs font-medium"
              style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
              Try a Different Niche
            </motion.button>
          </motion.div>
        )}

        {!loading && !scanned && (
          <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl flex flex-col items-center justify-center text-center px-6 py-16"
            style={{ background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)", border: "1px dashed hsl(217 28% 13%)" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full pointer-events-none"
              style={{ background: "radial-gradient(ellipse, hsl(217 91% 60% / 0.05) 0%, transparent 70%)" }} aria-hidden />
            <motion.div className="relative w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.18)" }}
              animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 24px hsl(217 91% 60% / 0.1)", "0 0 0 hsl(217 91% 60% / 0)"] }}
              transition={{ duration: 4, repeat: Infinity }}>
              <TrendingUp className="w-6 h-6 text-primary/50" strokeWidth={1.5} />
            </motion.div>
            <p className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-primary/45 mb-2">AI Trend Intelligence</p>
            <p className="text-sm font-semibold text-foreground/80 mb-2">Discover what's about to go viral</p>
            <p className="text-[11px] text-muted-foreground/45 leading-relaxed max-w-[300px]">
              Enter your creator niche above and RobinOS will scan live creator signals, viral patterns, and audience demand — then surface the topics worth building content around.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {["Fitness", "AI Tools", "Finance", "Mindset"].map((s) => (
                <button key={s} onClick={() => { setNiche(s); }}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all"
                  style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 42%)" }}>
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TrendScannerPage;
