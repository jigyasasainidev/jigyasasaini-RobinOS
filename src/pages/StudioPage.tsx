import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PenTool, Wand2, Lock, Sparkles, Loader2, Zap, TrendingUp, Target, Brain, Search, Flame, ArrowRight, Radio, Wifi, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/cloudDb";
import { useTierLevel, useFreeTrialStatus } from "@/hooks/useProfile";
import { usePlanKey, useIsAgency, useAvailableScriptLengths } from "@/hooks/useEntitlements";
import { moderatePrompt, getModerationBlockMessage } from "@/lib/moderation/engine";
import { ModerationNotice } from "@/components/ModerationNotice";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { ScriptModeSelector, type ScriptMode } from "@/components/ScriptModeSelector";
import { ScriptOutput } from "@/components/ScriptOutput";
import { scanTrendTopic } from "@/services/trendRadarClient";
import type { TrendIntelligence } from "@/types/trendRadar";

// ── Trend topic shape from scan-trends edge function ──────
interface TrendTopic {
  title:       string;
  description: string;
  platforms:   string;
  heat:        number;
  hook_types:  string[];
  volume:      "High" | "Medium" | "Emerging";
}

// ── Scan messages (rotated during scanning) ───────────────
const SCANNER_MESSAGES = [
  "Scanning creator signals...",
  "Analyzing trend velocity...",
  "Detecting viral patterns...",
  "Measuring topic saturation...",
  "Mapping audience demand...",
  "Calibrating AI intelligence...",
];

// ── Scan icons (cycling) ──────────────────────────────────
const SCAN_ICONS = [Zap, Radio, Globe, Wifi, Sparkles, Search, TrendingUp];

const tones = ["Casual", "Bold", "Storytelling", "Educational", "Provocative"];
const allLengths = ["30s Short", "60s Reel", "3min Script", "10min Long-form"];
const freeLengths = ["30s Short"];
const starterLengths = ["30s Short", "60s Reel"];

const modePromptSuffix: Record<ScriptMode, string> = {
  quick: "\n\nIMPORTANT: Output ONLY a ready-to-record script. Format:\n🎬 READY TO RECORD SCRIPT:\n\nLine 1 (Hook - attention grabbing first line)\nLine 2\nLine 3\nLine 4\n...\n\n🎥 Camera: [simple instruction]\n🗣 Tone: [tone style]\n\nRules: No explanations. No extra text. No sections. No fluff. Highly human conversational tone. Feels like a real creator speaking, not AI.",
  creator: "",
  hooks: "\n\nIMPORTANT: Output ONLY 10 viral hooks. One line each. Short, punchy, curiosity-driven. No numbering needed. No explanations. Just 10 raw hooks that make people stop scrolling. Example style:\n\"Nobody is telling you this about Instagram...\"\n\"This is why your reels are dying...\"\n\"Delete this app if you want to succeed...\"",
};

const StudioPage = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentTier = useTierLevel();
  const plan = usePlanKey();
  const { expired, scriptsLeft, isFree } = useFreeTrialStatus();
  const isAgencyTier = useIsAgency();
  const availableLengths = useAvailableScriptLengths(allLengths, freeLengths, starterLengths);

  const [topic, setTopic] = useState(() => sessionStorage.getItem("studio_topic") || "");
  const [selectedTone, setSelectedTone] = useState(() => sessionStorage.getItem("studio_tone") || "Casual");
  const [selectedLength, setSelectedLength] = useState(() => sessionStorage.getItem("studio_length") || "30s Short");
  const [mode, setMode] = useState<ScriptMode>(() => (sessionStorage.getItem("studio_mode") as ScriptMode) || "quick");
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState(() => sessionStorage.getItem("studio_output") || "");
  const [showUpgrade, setShowUpgrade] = useState(false);

  // ── Trend Intelligence state ───────────────────────────────
  const [scanPhase, setScanPhase]       = useState<string>("");
  const [trendIntel, setTrendIntel]     = useState<TrendIntelligence | null>(null);
  const scanPhaseRef                    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Trend Scanner state (standalone section) ──────────────
  const [scannerNiche,    setScannerNiche]    = useState("");
  const [scannerLoading,  setScannerLoading]  = useState(false);
  const [scannerTopics,   setScannerTopics]   = useState<TrendTopic[]>([]);
  const [scannerMsgIdx,   setScannerMsgIdx]   = useState(0);
  const [scannerIconIdx,  setScannerIconIdx]  = useState(0);
  const [scannerScanned,  setScannerScanned]  = useState(false);
  const scannerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dailyUsage, setDailyUsage] = useState<{
    used: number;
    quota: number | null;
    remaining: number;
    allowed: boolean;
    near_limit: boolean;
    fair_usage: boolean;
    message: string;
  } | null>(null);

  const loadUsageStatus = async () => {
    if (!user || isFree) return;
    const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "scripts" });
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    setDailyUsage({
      used: Number(row.used ?? 0),
      quota: row.quota == null ? null : Number(row.quota),
      remaining: Number(row.remaining ?? 0),
      allowed: Boolean(row.allowed),
      near_limit: Boolean(row.near_limit),
      fair_usage: Boolean(row.fair_usage),
      message: String(row.message ?? ""),
    });
  };

  // Persist state
  useEffect(() => { sessionStorage.setItem("studio_topic", topic); }, [topic]);
  useEffect(() => { sessionStorage.setItem("studio_tone", selectedTone); }, [selectedTone]);
  useEffect(() => { sessionStorage.setItem("studio_length", selectedLength); }, [selectedLength]);
  useEffect(() => { sessionStorage.setItem("studio_output", output); }, [output]);
  useEffect(() => { sessionStorage.setItem("studio_mode", mode); }, [mode]);

  useEffect(() => {
    const t = searchParams.get("topic");
    if (t) setTopic(decodeURIComponent(t));
  }, [searchParams]);

  useEffect(() => {
    void loadUsageStatus();
  }, [user?.id, isFree, currentTier]);

  const SCAN_MESSAGES = [
    "Scanning creator signals...",
    "Detecting recurring hooks...",
    "Measuring topic saturation...",
    "Finding breakout opportunities...",
    "Mapping audience demand...",
    "Calibrating trend intelligence...",
  ];

  // ── Trend Scanner handler ─────────────────────────────────
  const handleScan = async () => {
    if (!scannerNiche.trim()) { toast.error("Enter a niche to scan"); return; }

    setScannerLoading(true);
    setScannerScanned(true);
    setScannerTopics([]);
    setScannerMsgIdx(0);
    setScannerIconIdx(0);

    let mIdx = 0, iIdx = 0;
    scannerIntervalRef.current = setInterval(() => {
      mIdx = (mIdx + 1) % SCANNER_MESSAGES.length;
      iIdx = (iIdx + 1) % SCAN_ICONS.length;
      setScannerMsgIdx(mIdx);
      setScannerIconIdx(iIdx);
    }, 1100);

    try {
      const { data, error } = await supabase.functions.invoke("scan-trends", {
        body: { niche: scannerNiche.trim() },
      });

      if (scannerIntervalRef.current) { clearInterval(scannerIntervalRef.current); scannerIntervalRef.current = null; }
      setScannerLoading(false);

      if (error) {
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (error as any)?.context?.responseText ?? (error as any)?.message ?? "";
          parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
        } catch { /* ignore */ }
        if (status === 403) {
          toast.error(String(parsed.error ?? parsed.message ?? "Scan limit reached."));
        } else {
          toast.error("Scan failed. Try again.");
        }
        return;
      }

      const topics = (data?.topics ?? []) as TrendTopic[];
      setScannerTopics(topics);
      if (!topics.length) toast.error("No trends found. Try a different niche.");
    } catch {
      if (scannerIntervalRef.current) { clearInterval(scannerIntervalRef.current); scannerIntervalRef.current = null; }
      setScannerLoading(false);
      toast.error("Network error. Try again.");
    }
  };

  // Use a scanned topic as script input
  const useTopicInScript = (title: string) => {
    setTopic(title);
    // Smooth scroll to Script Engine input
    setTimeout(() => {
      document.getElementById("script-engine-input")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first"); return; }
    if (isFree && (expired || scriptsLeft <= 0)) { setShowUpgrade(true); return; }

    // ── Moderation ─────────────────────────────────────────
    const modResult = moderatePrompt(topic);
    if (!modResult.safe && (modResult.severity === "HIGH" || modResult.severity === "BLOCKED")) {
      toast.error(getModerationBlockMessage(modResult.categories));
      return;
    }

    if (!isFree) {
      const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "scripts" });
      if (error) { toast.error(error.message || "Unable to verify your usage limits right now."); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed) {
        toast.warning("Daily generation limit reached.", { description: "Upgrade to Pro Creator for higher limits." });
        setShowUpgrade(true);
        setDailyUsage({
          used: Number(row?.used ?? 0), quota: row?.quota == null ? null : Number(row.quota),
          remaining: Number(row?.remaining ?? 0), allowed: false,
          near_limit: Boolean(row?.near_limit), fair_usage: Boolean(row?.fair_usage),
          message: String(row?.message ?? "Daily limit reached"),
        });
        return;
      }
    }

    setGenerating(true);
    setOutput("");
    setTrendIntel(null);

    // ── STEP 1: Trend Intelligence scan ───────────────────
    // Staged loading messages while scanning
    let msgIdx = 0;
    setScanPhase(SCAN_MESSAGES[0]);
    scanPhaseRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % SCAN_MESSAGES.length;
      setScanPhase(SCAN_MESSAGES[msgIdx]);
    }, 900);

    const intel = await scanTrendTopic(topic.trim());

    if (scanPhaseRef.current) { clearInterval(scanPhaseRef.current); scanPhaseRef.current = null; }
    setScanPhase("");
    setTrendIntel(intel);

    // ── STEP 2: Build prompt — trend context stays in UI cards only ───
    // Do NOT inject trend context into the edge function topic —
    // extra tokens increase Groq latency and push past Supabase 2s CPU limit.
    // The intelligence is already surfaced in the UI cards above the output.
    const suffix        = modePromptSuffix[mode];
    const cleanTopic    = topic.trim();
    // Attach a compact one-line signal hint only if we have real data
    const signalHint    = (!intel.isFallback && intel.topOpportunities[0])
      ? ` [Signal: ${intel.topOpportunities[0].maturityStage} trend, ${intel.topOpportunities[0].momentumScore}/100 momentum]`
      : "";
    const enrichedTopic = `${cleanTopic}${signalHint}${suffix}`;

    // ── STEP 3: Generate script with intelligence ──────────
    try {
      const requestId = crypto.randomUUID();
      const { data: invokeData, error: invokeError } = await supabase.functions.invoke("generate-script", {
        body: {
          topic: enrichedTopic,
          tone: selectedTone,
          length: mode === "hooks" ? "30s Short" : selectedLength,
          user_id: user?.id,
          request_id: requestId,
        },
      });

      if (invokeError) {
        const status = (invokeError as any)?.context?.status ?? (invokeError as any)?.status;
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (invokeError as any)?.context?.responseText ?? (invokeError as any)?.message ?? "";
          parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
        } catch { /* keep empty */ }

        if (status === 403) {
          const usage = parsed.usage as Record<string, unknown> | undefined;
          if (usage) {
            setDailyUsage({
              used: Number(usage.used ?? 0), quota: usage.quota == null ? null : Number(usage.quota),
              remaining: Number(usage.remaining ?? 0), allowed: false,
              near_limit: Boolean(usage.near_limit), fair_usage: Boolean(usage.fair_usage),
              message: String(usage.message ?? "Daily limit reached"),
            });
          }
          toast.error(String(parsed.message ?? parsed.error ?? "Script limit reached. Upgrade your plan!"));
          setShowUpgrade(true);
          setGenerating(false);
          return;
        }
        toast.error(String(parsed.message ?? parsed.error ?? "Generation failed"));
        setGenerating(false);
        return;
      }

      const rawText: string = typeof invokeData === "string"
        ? invokeData
        : invokeData instanceof Blob ? await invokeData.text() : "";

      let fullOutput = "";
      for (const line of rawText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6).trim();
        if (jsonStr === "[DONE]") break;
        try {
          const p = JSON.parse(jsonStr);
          const content = p.choices?.[0]?.delta?.content as string | undefined;
          if (content) { fullOutput += content; setOutput(fullOutput); }
        } catch { /* skip */ }
      }

      if (user && fullOutput.trim()) {
        queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
        queryClient.refetchQueries({ queryKey: ["profile", user.id] });
        queryClient.invalidateQueries({ queryKey: ["scripts", user.id] });
      }

      await loadUsageStatus();
    } catch {
      toast.error("Network error. Try again.");
    }

    setGenerating(false);
  };

  const effectiveLimitReached = (isFree && (expired || scriptsLeft <= 0)) || (!isFree && dailyUsage ? !dailyUsage.allowed : false);


  return (
    <div className="pt-14 md:pt-0 space-y-10">

      {/* ══════════════════════════════════════════════════
          SECTION 1 — TREND SCANNER
          Standalone discovery module. Finds what's trending.
          Completely separate from Script Engine.
      ══════════════════════════════════════════════════ */}
      <section>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Trend Scanner</span>
          </div>
          <h2 className="text-chrome text-xl font-semibold mb-1">Discover What's Trending</h2>
          <p className="text-muted-foreground text-sm">Enter your niche → AI scans viral trends → pick one → generate your script below.</p>
        </div>

        {/* Scanner input card */}
        <div className="glass-card p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
              <Input
                value={scannerNiche}
                onChange={(e) => setScannerNiche(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !scannerLoading && handleScan()}
                placeholder="Enter your niche — e.g. Fitness, AI Tools, Personal Finance..."
                className="input-glass h-12 text-sm pl-10 rounded-xl"
                disabled={scannerLoading}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={handleScan}
              disabled={scannerLoading || !scannerNiche.trim()}
              className="btn-primary flex items-center justify-center gap-2 !py-3 !px-7 shrink-0 shimmer-btn disabled:opacity-50"
            >
              {scannerLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
                : <><Sparkles className="w-4 h-4" /> Scan Now</>}
            </motion.button>
          </div>
        </div>

        {/* Scanning animation */}
        <AnimatePresence>
          {scannerLoading && (
            <motion.div
              key="scanner-anim"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="relative rounded-2xl overflow-hidden mt-4 flex flex-col items-center justify-center py-14"
              style={{ background: "hsl(222 28% 5.5% / 0.95)", border: "1px solid hsl(217 91% 60% / 0.12)" }}
            >
              {[0,1,2,3].map((i) => (
                <motion.div key={`ring-${i}`}
                  className="absolute rounded-full border border-primary/10"
                  style={{ width: 80 + i * 38, height: 80 + i * 38 }}
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: [0.3, 2.5, 3.5], opacity: [0, 0.5, 0] }}
                  transition={{ duration: 3, repeat: Infinity, delay: i * 0.55, ease: "easeOut" }}
                />
              ))}
              <motion.div
                className="absolute w-36 h-[1.5px] origin-left"
                style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.7), transparent)" }}
                animate={{ rotate: 360 }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="relative z-10 w-14 h-14 rounded-full flex items-center justify-center mb-5"
                style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
              >
                {(() => {
                  const Icon = SCAN_ICONS[scannerIconIdx % SCAN_ICONS.length];
                  return (
                    <motion.div key={scannerIconIdx} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}>
                      <Icon className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </motion.div>
                  );
                })()}
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.p key={scannerMsgIdx}
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                  transition={{ duration: 0.35 }}
                  className="relative z-10 text-sm font-mono text-primary tracking-wider"
                >
                  {SCANNER_MESSAGES[scannerMsgIdx]}
                </motion.p>
              </AnimatePresence>
              <p className="relative z-10 mt-2 text-[11px] text-muted-foreground/50 font-mono">
                Target: "{scannerNiche}"
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scan results */}
        <AnimatePresence mode="wait">
          {!scannerLoading && scannerScanned && scannerTopics.length > 0 && (
            <motion.div key="scanner-results"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="mt-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-primary/70" />
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">
                  {scannerTopics.length} signals detected for "{scannerNiche}"
                </span>
              </div>
              {scannerTopics.map((topicItem, i) => (
                <motion.div key={topicItem.title}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.35 }}
                  className="glass-card p-4 group"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-mono text-muted-foreground/40">{String(i + 1).padStart(2, "0")}</span>
                        <h3 className="text-sm font-semibold text-foreground">{topicItem.title}</h3>
                        <div className="flex items-center gap-1 shrink-0">
                          <Flame className="w-3 h-3 text-primary" />
                          <span className="text-xs font-mono text-primary">{topicItem.heat}</span>
                        </div>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                          topicItem.volume === "High" ? "bg-red-500/10 text-red-400"
                          : topicItem.volume === "Medium" ? "bg-amber-500/10 text-amber-400"
                          : "bg-blue-500/10 text-blue-400"
                        }`}>{topicItem.volume}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-2">{topicItem.description}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {topicItem.platforms.split(",").map((p) => (
                          <span key={p.trim()} className="px-2 py-0.5 rounded-md bg-secondary text-[10px] font-mono text-muted-foreground">{p.trim()}</span>
                        ))}
                      </div>
                      {topicItem.hook_types?.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-mono text-muted-foreground/40">HOOKS:</span>
                          {topicItem.hook_types.map((h) => (
                            <span key={h} className="px-1.5 py-0.5 rounded bg-primary/8 text-[9px] font-mono text-primary border border-primary/15">{h}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02, x: 2 }} whileTap={{ scale: 0.97 }}
                      onClick={() => useTopicInScript(topicItem.title)}
                      className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all w-full md:w-auto"
                      style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}
                    >
                      Use in Script Engine <ArrowRight className="w-3 h-3" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
          {!scannerLoading && scannerScanned && scannerTopics.length === 0 && (
            <motion.p key="scanner-empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="mt-4 text-center py-8 text-sm text-muted-foreground"
            >
              No trends found. Try a broader niche.
            </motion.p>
          )}
        </AnimatePresence>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 2 — SCRIPT ENGINE
          Standalone generation module. Writes scripts.
          Completely separate from Trend Scanner.
      ══════════════════════════════════════════════════ */}
      <section id="script-engine-input">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <PenTool className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Script Engine</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Script Engine</h1>
            <Badge variant="outline" className={`text-[10px] font-mono ${isAgencyTier ? 'border-amber-500/30 text-amber-400' : 'border-primary/30 text-primary'}`}>
              {isFree
                ? `${scriptsLeft}/2 left`
                : dailyUsage?.quota
                  ? `${dailyUsage.used}/${dailyUsage.quota} used today`
                  : isAgencyTier ? "Unlimited"
                  : `${dailyUsage?.remaining ?? 0}/${dailyUsage?.quota ?? 0} left`}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">Enter a topic → Get a script → Record immediately.</p>
          {!!dailyUsage?.near_limit && !dailyUsage?.fair_usage && (
            <p className="text-xs text-amber-400/90 font-mono mt-2">{dailyUsage.message || `${dailyUsage.remaining} generations remaining today`}</p>
          )}
        </div>

        {/* Engine input card */}
        <div className="glass-card p-5 mb-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  placeholder="What's your video about? e.g. How to grow on Instagram..."
                  className="input-glass h-12 text-sm pl-4 pr-4 rounded-xl"
                  disabled={generating}
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={handleGenerate}
                disabled={generating || effectiveLimitReached}
                className="btn-primary flex items-center justify-center gap-2 !py-3 !px-8 shrink-0 shimmer-btn disabled:opacity-50"
              >
                {effectiveLimitReached ? (
                  <><Lock className="w-4 h-4" /> Upgrade</>
                ) : generating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {scanPhase || "Generating..."}</>
                ) : (
                  <><Wand2 className="w-4 h-4" /> Generate Script</>
                )}
              </motion.button>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
              <ScriptModeSelector mode={mode} onChange={setMode} />
              <div className="flex gap-2 flex-wrap">
                {tones.map((tone) => (
                  <button key={tone} onClick={() => setSelectedTone(tone)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth ${
                      selectedTone === tone
                        ? "bg-primary/12 text-primary border border-primary/25"
                        : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
                    }`}
                  >{tone}</button>
                ))}
              </div>
            </div>

            {mode !== "hooks" && (
              <div className="flex gap-2 flex-wrap">
                {allLengths.map((len) => {
                  const isLocked = !availableLengths.includes(len);
                  return (
                    <button key={len}
                      onClick={() => !isLocked && setSelectedLength(len)}
                      disabled={isLocked}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth flex items-center gap-1.5 ${
                        isLocked ? "text-muted-foreground/30 cursor-not-allowed"
                        : selectedLength === len ? "bg-primary/12 text-primary border border-primary/25"
                        : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      {isLocked && <Lock className="w-3 h-3" />}
                      {len}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Scan phase indicator */}
        <AnimatePresence>
          {generating && scanPhase && !output && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="mb-4 flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5"
            >
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              <span className="text-xs font-mono text-primary/80">{scanPhase}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Intelligence preview cards */}
        <AnimatePresence>
          {trendIntel && !trendIntel.isFallback && trendIntel.topOpportunities.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="mb-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary/70" />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Live Trend Intelligence</span>
                <span className="text-[9px] font-mono text-muted-foreground/35 ml-auto">
                  {trendIntel.confidence}% confidence · {trendIntel.sourceSpread} source{trendIntel.sourceSpread !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trendIntel.topOpportunities.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-card/40 p-3.5">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <Zap className="w-3 h-3 text-primary/70" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Detected Opportunities</span>
                    </div>
                    <div className="space-y-2">
                      {trendIntel.topOpportunities.slice(0, 2).map((op, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className={`mt-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                            op.maturityStage === "Hot" ? "border-red-500/25 text-red-400/80"
                            : op.maturityStage === "Rising" ? "border-emerald-500/25 text-emerald-400/80"
                            : "border-primary/20 text-primary/60"
                          }`}>{op.maturityStage}</span>
                          <p className="text-[11px] text-foreground/80 leading-snug truncate">{op.cleanTitle}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {trendIntel.lowCompetition.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-card/40 p-3.5">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <Target className="w-3 h-3 text-primary/70" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Low Competition Angles</span>
                    </div>
                    <div className="space-y-1.5">
                      {trendIntel.lowCompetition.slice(0, 2).map((op, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground/70 leading-snug truncate">· {op.opportunityType}: {op.cleanTitle}</p>
                      ))}
                    </div>
                  </div>
                )}
                {trendIntel.viralHooks.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-card/40 p-3.5">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <Brain className="w-3 h-3 text-primary/70" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Viral Signal Patterns</span>
                    </div>
                    <div className="space-y-1.5">
                      {trendIntel.viralHooks.slice(0, 2).map((hook, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground/70 leading-snug line-clamp-2">· {hook}</p>
                      ))}
                    </div>
                  </div>
                )}
                {trendIntel.topOpportunities.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-card/40 p-3.5">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <TrendingUp className="w-3 h-3 text-primary/70" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Trend Momentum</span>
                    </div>
                    <div className="space-y-2">
                      {trendIntel.topOpportunities.slice(0, 2).map((op, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1 h-1 rounded-full bg-border/40 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-primary/50"
                              initial={{ width: 0 }}
                              animate={{ width: `${op.momentumScore}%` }}
                              transition={{ duration: 0.8, delay: i * 0.15, ease: "easeOut" }}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-muted-foreground/50 w-7 shrink-0">{op.momentumScore}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Script output */}
        <ScriptOutput
          output={output}
          generating={generating}
          mode={mode}
          onRegenerate={handleGenerate}
          onTryDifferent={() => {
            const nextTone = tones[(tones.indexOf(selectedTone) + 1) % tones.length];
            setSelectedTone(nextTone);
            toast.info(`Switched to ${nextTone} tone. Hit Generate!`);
          }}
        />
      </section>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
      <ModerationNotice className="mt-4 max-w-2xl" />
    </div>
  );
};

export default StudioPage;
