import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Sparkles, Copy, Check, Bookmark, BookmarkCheck, Type, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/cloudDb";
import { usePlanKey } from "@/hooks/useEntitlements";
import { moderatePrompt, getModerationBlockMessage } from "@/lib/moderation/engine";
import { ModerationNotice } from "@/components/ModerationNotice";
import { getCaptionLimitText } from "@/lib/pricing";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import {
  getTrendingAudio,
  getTrendingHashtags,
  isEntitlementError,
  type Platform as IdeaPlatform,
  type TrendAudio,
  type TrendHashtag,
} from "@/services/ideaStream";

// ── Caption Engine types ───────────────────────────────────
type Platform = "youtube" | "instagram" | "tiktok" | "facebook";
type GenerationStyle = "viral" | "seo_optimized" | "storytelling" | "educational" | "bold" | "conversational";

type CaptionGeneration = {
  id: string;
  platform: Platform;
  generation_style: GenerationStyle;
  prompt: string;
  generated_caption: string;
  generated_hashtags: string[];
  generated_keywords: string[];
  is_saved: boolean;
  created_at: string;
};

const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

const styleOptions: Array<{ value: GenerationStyle; label: string }> = [
  { value: "viral",         label: "Viral" },
  { value: "seo_optimized", label: "SEO Optimized" },
  { value: "storytelling",  label: "Storytelling" },
  { value: "educational",   label: "Educational" },
  { value: "bold",          label: "Bold" },
  { value: "conversational",label: "Conversational" },
];

// Trend discovery platform list (title-case, matches IdeaPlatform)
const TREND_PLATFORMS: IdeaPlatform[] = ["Instagram", "TikTok", "YouTube", "Facebook"];

// ── Main page ──────────────────────────────────────────────
const CaptionEnginePage = () => {
  const { user } = useAuth();
  const plan = usePlanKey();
  const tier = plan;

  // ── Caption generation state (existing — unchanged) ────────
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [style, setStyle]       = useState<GenerationStyle>("seo_optimized");
  const [prompt, setPrompt]     = useState("");
  const [generating, setGenerating] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [result, setResult]     = useState<CaptionGeneration | null>(null);
  const [history, setHistory]   = useState<CaptionGeneration[]>([]);
  const [usage, setUsage]       = useState<{
    used: number; quota: number; remaining: number;
    allowed: boolean; near_limit: boolean; fair_usage: boolean; message?: string;
  } | null>(null);

  const canGenerate = prompt.trim().length >= 3 && !generating && (usage ? usage.allowed : true);
  const limitHint   = useMemo(() => getCaptionLimitText(tier), [tier]);

  // ── Content Discovery state ───────────────────────────────
  const [discoveryMode,     setDiscoveryMode]     = useState<"songs" | "hashtags">("songs");
  const [discoveryPlatform, setDiscoveryPlatform] = useState<IdeaPlatform>("Instagram");
  const [discoveryLoading,  setDiscoveryLoading]  = useState(false);
  const [discoverySongs,    setDiscoverySongs]    = useState<TrendAudio[]>([]);
  const [discoveryHashtags, setDiscoveryHashtags] = useState<TrendHashtag[]>([]);
  const [discoveryScanned,  setDiscoveryScanned]  = useState(false);
  // The selected trend context — pre-fills the caption prompt
  const [selectedTrend, setSelectedTrend] = useState<{ label: string; sublabel: string } | null>(null);

  // ── Data loading ───────────────────────────────────────────
  const loadHistory = async () => {
    if (!user) return;
    const { data } = await db
      .from("caption_generations")
      .select("id, platform, generation_style, prompt, generated_caption, generated_hashtags, generated_keywords, is_saved, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12);
    setHistory((data ?? []) as CaptionGeneration[]);
  };

  const loadUsage = async () => {
    const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "captions" });
    if (error) return;
    setUsage({
      used:       Number(data?.used      ?? 0),
      quota:      Number(data?.quota     ?? 0),
      remaining:  Number(data?.remaining ?? 0),
      allowed:    Boolean(data?.allowed),
      near_limit: Boolean(data?.near_limit),
      fair_usage: Boolean(data?.fair_usage),
      message:    String(data?.message   ?? ""),
    });
  };

  useEffect(() => {
    if (!user) return;
    void loadHistory();
    void loadUsage();
  }, [user?.id]);

  // ── Content Discovery handler ─────────────────────────────
  const handleDiscover = async () => {
    setDiscoveryLoading(true);
    setDiscoveryScanned(true);

    if (discoveryMode === "songs") {
      const res = await getTrendingAudio(discoveryPlatform);
      if (!res.ok) {
        if (isEntitlementError(res)) { toast.error(res.message); setShowUpgrade(true); }
        else toast.error("Could not load viral songs. Try again.");
      } else {
        setDiscoverySongs(res.audios);
        setDiscoveryHashtags([]);
      }
    } else {
      const res = await getTrendingHashtags(discoveryPlatform);
      if (!res.ok) {
        if (isEntitlementError(res)) { toast.error(res.message); setShowUpgrade(true); }
        else toast.error("Could not load viral hashtags. Try again.");
      } else {
        setDiscoveryHashtags(res.hashtags);
        setDiscoverySongs([]);
      }
    }

    setDiscoveryLoading(false);
  };

  // Pick a trend → pre-fill caption prompt and show context bar
  const selectTrend = (label: string, sublabel: string) => {
    setSelectedTrend({ label, sublabel });
    setPrompt(label);
    // Scroll smoothly to the caption input
    setTimeout(() => {
      document.getElementById("caption-input-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const clearTrend = () => {
    setSelectedTrend(null);
    setPrompt("");
  };

  // ── Caption generation (existing — unchanged) ──────────────
  const handleGenerate = async () => {
    if (usage && !usage.allowed) {
      setShowUpgrade(true);
      toast.error("Daily limit reached — upgrade to continue creating.");
      return;
    }
    if (!canGenerate) {
      toast.error("Enter at least 3 characters to generate.");
      return;
    }
    const modResult = moderatePrompt(prompt);
    if (!modResult.safe && (modResult.severity === "HIGH" || modResult.severity === "BLOCKED")) {
      toast.error(getModerationBlockMessage(modResult.categories));
      return;
    }
    setGenerating(true);
    try {
      const requestId = crypto.randomUUID();
      const { data: payload, error: invokeError } = await supabase.functions.invoke("generate-caption", {
        body: { platform, generationStyle: style, prompt, requestId },
      });
      if (invokeError) {
        const status = (invokeError as any)?.context?.status ?? (invokeError as any)?.status;
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (invokeError as any)?.context?.responseText ?? (invokeError as any)?.message ?? "";
          parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
        } catch { /* keep empty */ }
        const usageBlock = parsed.usage as Record<string, unknown> | undefined;
        if (usageBlock) {
          setUsage({
            used:       Number(usageBlock.used      ?? 0),
            quota:      Number(usageBlock.quota     ?? 0),
            remaining:  Number(usageBlock.remaining ?? 0),
            allowed:    Boolean(usageBlock.allowed),
            near_limit: Boolean(usageBlock.near_limit),
            fair_usage: Boolean(usageBlock.fair_usage),
            message:    String(usageBlock.message   ?? ""),
          });
        }
        if (status === 403) setShowUpgrade(true);
        toast.error(String(parsed.message ?? parsed.error ?? "Caption generation failed."));
        await loadUsage();
        return;
      }
      setResult(payload.generation as CaptionGeneration);
      setPrompt("");
      setSelectedTrend(null);
      if (payload?.usage) {
        setUsage({
          used:       Number(payload.usage.used      ?? 0),
          quota:      Number(payload.usage.quota     ?? 0),
          remaining:  Number(payload.usage.remaining ?? 0),
          allowed:    Boolean(payload.usage.allowed),
          near_limit: Boolean(payload.usage.near_limit),
          fair_usage: Boolean(payload.usage.fair_usage),
          message:    String(payload.usage.message   ?? ""),
        });
      }
      toast.success("Caption generated.");
      await Promise.all([loadHistory(), loadUsage()]);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    toast.success("Copied to clipboard");
  };

  const toggleSaved = async (item: CaptionGeneration) => {
    const { error } = await db
      .from("caption_generations")
      .update({ is_saved: !item.is_saved } as any)
      .eq("id", item.id)
      .eq("user_id", user?.id);
    if (error) { toast.error("Could not update saved state."); return; }
    setResult((prev) => (prev?.id === item.id ? { ...prev, is_saved: !item.is_saved } : prev));
    setHistory((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_saved: !row.is_saved } : row)));
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="pt-14 md:pt-0">

      {/* ── Page Header ──────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Type className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Publishing Workspace</span>
        </div>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Caption & Hashtags</h1>
          {!!usage && (
            <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
              {usage.used}/{usage.quota} used today
            </Badge>
          )}
        </div>
        {!!usage?.near_limit && !usage?.fair_usage && (
          <p className="text-xs text-amber-400/90 font-mono mt-2">{usage.message || `${usage.remaining} generations remaining today`}</p>
        )}
        {!!usage && !usage.allowed && !usage.fair_usage && (
          <p className="text-xs text-muted-foreground mt-2">Daily limit reached — upgrade to continue creating.</p>
        )}
        <p className="text-muted-foreground text-sm">Discover trends → write captions → publish.</p>
      </div>

      {/* ── STEP 1: Content Discovery ─────────────────────── */}
      <div className="glass-card p-5 mb-4 space-y-4">
        {/* Section label */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-mono font-semibold text-primary">01</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground leading-tight">Content Discovery</p>
            <p className="text-[11px] text-muted-foreground">Find viral signals to inspire your caption</p>
          </div>
        </div>

        {/* Mode toggles */}
        <div className="flex gap-2">
          {(["songs", "hashtags"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => { setDiscoveryMode(mode); setDiscoveryScanned(false); }}
              className={`px-4 py-2 rounded-lg text-xs font-medium border transition-all ${
                discoveryMode === mode
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border/50 hover:text-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              {mode === "songs" ? "Find Viral Songs" : "Find Viral Hashtags"}
            </button>
          ))}
        </div>

        {/* Platform pills + Find Now button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 flex-wrap">
            {TREND_PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => setDiscoveryPlatform(p)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                  discoveryPlatform === p
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "text-muted-foreground border-border/50 hover:text-foreground hover:bg-sidebar-accent/60"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleDiscover}
            disabled={discoveryLoading}
            className="btn-primary !py-2 !px-5 text-xs flex items-center gap-1.5 disabled:opacity-50 ml-auto"
          >
            {discoveryLoading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Finding...</>
              : <><Sparkles className="w-3.5 h-3.5" /> Find Now</>
            }
          </motion.button>
        </div>

        {/* Results */}
        <AnimatePresence mode="wait">
          {discoveryLoading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 py-1">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="text-xs text-muted-foreground font-mono">Scanning {discoveryPlatform}...</span>
            </motion.div>
          )}

          {!discoveryLoading && discoveryScanned && discoveryMode === "songs" && discoverySongs.length > 0 && (
            <motion.div key="song-results" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-[0.15em] pb-1">
                {discoverySongs.length} songs — click to use as caption context
              </p>
              {discoverySongs.map((audio, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => selectTrend(audio.title, `${audio.artist} · ${audio.category}`)}
                  className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all group ${
                    selectedTrend?.label === audio.title
                      ? "border-primary/30 bg-primary/8 text-primary"
                      : "border-border/40 bg-card/30 hover:border-primary/20 hover:bg-card/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{audio.title}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">{audio.artist}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {audio.velocity && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                        audio.velocity === "exploding" ? "border-red-500/25 text-red-400/80" :
                        audio.velocity === "hot"       ? "border-amber-500/25 text-amber-400/80" :
                        audio.velocity === "rising"    ? "border-emerald-500/25 text-emerald-400/80" :
                        "border-border/30 text-muted-foreground/40"
                      }`}>{audio.velocity}</span>
                    )}
                    <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}

          {!discoveryLoading && discoveryScanned && discoveryMode === "hashtags" && discoveryHashtags.length > 0 && (
            <motion.div key="hashtag-results" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-[0.15em] pb-1">
                {discoveryHashtags.length} hashtags — click to use as caption context
              </p>
              {discoveryHashtags.map((tag, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => selectTrend(tag.tag, `${tag.category} · ${tag.posts}`)}
                  className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all group ${
                    selectedTrend?.label === tag.tag
                      ? "border-primary/30 bg-primary/8 text-primary"
                      : "border-border/40 bg-card/30 hover:border-primary/20 hover:bg-card/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{tag.tag}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">{tag.category} · {tag.posts}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {tag.velocity && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                        tag.velocity === "exploding" ? "border-red-500/25 text-red-400/80" :
                        tag.velocity === "hot"       ? "border-amber-500/25 text-amber-400/80" :
                        tag.velocity === "rising"    ? "border-emerald-500/25 text-emerald-400/80" :
                        "border-border/30 text-muted-foreground/40"
                      }`}>{tag.velocity}</span>
                    )}
                    <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}

          {!discoveryLoading && discoveryScanned &&
            ((discoveryMode === "songs" && discoverySongs.length === 0) ||
             (discoveryMode === "hashtags" && discoveryHashtags.length === 0)) && (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="text-xs text-muted-foreground/50 font-mono py-1">
              No results found. Try again.
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Selected Trend Context Bar ────────────────────── */}
      <AnimatePresence>
        {selectedTrend && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/6"
          >
            <div className="w-5 h-5 rounded-md bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
              <Sparkles className="w-3 h-3 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary truncate">{selectedTrend.label}</p>
              <p className="text-[10px] text-muted-foreground/70 truncate">{selectedTrend.sublabel}</p>
            </div>
            <button
              onClick={clearTrend}
              className="text-[10px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── STEP 2: Caption & Hashtag Generation ─────────── */}
      <div id="caption-input-section" className="glass-card p-5 mb-6 space-y-4">
        {/* Step label */}
        <div className="flex items-center gap-2 pb-1">
          <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-mono font-semibold text-primary">02</span>
          </div>
          <span className="text-xs font-medium text-foreground">Generate Caption & Hashtags</span>
        </div>

        {/* Platform tabs */}
        <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
          <TabsList className="grid grid-cols-4 bg-secondary/60 h-10">
            {Object.entries(platformLabels).map(([value, label]) => (
              <TabsTrigger key={value} value={value}
                className="text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Style selector */}
        <div className="flex gap-2 flex-wrap">
          {styleOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setStyle(option.value)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth ${
                style === option.value
                  ? "bg-primary/12 text-primary border border-primary/25"
                  : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Prompt + Generate */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder={selectedTrend ? `Using: "${selectedTrend.label}"` : "What is your content about?"}
            className="input-glass h-12 text-sm rounded-xl"
            disabled={generating}
          />
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="btn-primary shimmer-btn !py-3 !px-6 shrink-0 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "Generating..." : "Generate Caption"}
          </motion.button>
        </div>

        <p className="text-[10px] text-muted-foreground/70 font-mono">{limitHint}</p>
      </div>

      {/* ── Results + History (existing — unchanged) ──────── */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-card p-5 min-h-[280px]">
          {generating && !result ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full border border-primary/30 bg-primary/10 animate-pulse" />
              <p className="text-sm text-muted-foreground font-mono">Optimizing for {platformLabels[platform]}...</p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">
                    {platformLabels[result.platform]} · {result.generation_style.replace("_", " ")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Generated for discoverability, engagement, and growth.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleSaved(result)} className="btn-secondary !px-3 !py-2 flex items-center gap-1.5">
                    {result.is_saved ? <BookmarkCheck className="w-3.5 h-3.5 text-primary" /> : <Bookmark className="w-3.5 h-3.5" />}
                    {result.is_saved ? "Saved" : "Save"}
                  </button>
                  <button onClick={() => handleCopy(result.generated_caption)} className="btn-secondary !px-3 !py-2 flex items-center gap-1.5">
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-card/40 p-4">
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{result.generated_caption}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-2">Hashtags</p>
                  <p className="text-xs text-foreground/85">{(result.generated_hashtags || []).join(" ")}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-2">Keywords</p>
                  <p className="text-xs text-foreground/85">{(result.generated_keywords || []).join(", ")}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[220px] flex items-center justify-center">
              <p className="text-muted-foreground/45 text-sm font-mono">Your generated caption will appear here...</p>
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Generation History</p>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">No generations yet.</p>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setResult(item)}
                  className="w-full text-left rounded-lg border border-border/40 bg-card/30 hover:border-primary/25 hover:bg-card/50 transition-smooth p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary">{platformLabels[item.platform]}</p>
                    {item.is_saved && <BookmarkCheck className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <p className="text-xs text-foreground/85 max-h-9 overflow-hidden">{item.generated_caption}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
      <ModerationNotice className="mt-4" />
    </div>
  );
};

export default CaptionEnginePage;
