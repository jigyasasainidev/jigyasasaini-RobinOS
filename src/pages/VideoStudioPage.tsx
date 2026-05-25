import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Film, Download, Loader2, Lock, Maximize2,
  RefreshCw, Copy, Check, Settings, Zap,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { useIsVideoEnabled, useIsByokEnabled } from "@/hooks/useEntitlements";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

// ── Constants ──────────────────────────────────────────────
const AIML_AFFILIATE = "https://aimlapi.com/?via=mohammad-ashad";
const SUPABASE_URL   = import.meta.env.VITE_SUPABASE_URL as string;
const GEN_ENDPOINT   = `${SUPABASE_URL}/functions/v1/generate-video`;
const POLL_ENDPOINT  = `${SUPABASE_URL}/functions/v1/poll-video`;
const POLL_INTERVAL  = 6000; // ms

// ── Aspect ratios ──────────────────────────────────────────
const ASPECT_RATIOS = [
  { value: "9:16",  label: "9:16",  sub: "Reels · Shorts",   icon: "▯" },
  { value: "16:9",  label: "16:9",  sub: "YouTube",          icon: "▬" },
  { value: "1:1",   label: "1:1",   sub: "Square",           icon: "■" },
  { value: "4:5",   label: "4:5",   sub: "Instagram",        icon: "▯" },
  { value: "21:9",  label: "21:9",  sub: "Cinematic",        icon: "▬" },
] as const;

// ── Styles ─────────────────────────────────────────────────
interface StyleOption {
  value:  string;
  label:  string;
  glow:   string;
}

const VIDEO_STYLES: StyleOption[] = [
  { value: "cinematic",   label: "Cinematic",    glow: "hsl(217 91% 60%)" },
  { value: "minimal",     label: "Minimal",      glow: "hsl(0 0% 70%)"    },
  { value: "anime",       label: "Anime",        glow: "hsl(290 80% 60%)" },
  { value: "realistic",   label: "Realistic",    glow: "hsl(145 60% 50%)" },
  { value: "documentary", label: "Documentary",  glow: "hsl(35 90% 55%)"  },
  { value: "luxury",      label: "Luxury",       glow: "hsl(48 90% 55%)"  },
  { value: "viral edit",  label: "Viral Edit",   glow: "hsl(0 80% 60%)"   },
  { value: "neon glow",   label: "Neon Glow",    glow: "hsl(175 80% 55%)" },
  { value: "abstract",    label: "Abstract",     glow: "hsl(260 70% 65%)" },
  { value: "futuristic",  label: "Futuristic",   glow: "hsl(200 90% 60%)" },
  { value: "moody",       label: "Moody",        glow: "hsl(220 50% 45%)" },
  { value: "nature",      label: "Nature",       glow: "hsl(130 60% 45%)" },
  { value: "hyperreal",   label: "Hyperreal",    glow: "hsl(15 85% 55%)"  },
  { value: "ai ad",       label: "AI Ad",        glow: "hsl(217 91% 65%)" },
  { value: "storyboard",  label: "Storyboard",   glow: "hsl(0 0% 55%)"    },
];

// ── Generation phase labels ────────────────────────────────
const GEN_PHASES = [
  "Initializing generation...",
  "Sending prompt to AI...",
  "AI rendering frames...",
  "Enhancing motion...",
  "Finalizing video...",
  "Preparing playback...",
];

// ── Types ──────────────────────────────────────────────────
type GenStatus = "idle" | "generating" | "polling" | "done" | "error";

// ── Helpers ────────────────────────────────────────────────
const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

// ── Main page ──────────────────────────────────────────────
const VideoStudioPage = () => {
  const navigate        = useNavigate();
  const { data: profile } = useProfile();
  const isVideoEnabled    = useIsVideoEnabled();
  const isByokEnabled     = useIsByokEnabled();
  const hasKey            = isByokEnabled && !!(profile as any)?.video_api_key;

  const [prompt,        setPrompt]        = useState("");
  const [aspectRatio,   setAspectRatio]   = useState("16:9");
  const [style,         setStyle]         = useState("cinematic");
  const [genStatus,     setGenStatus]     = useState<GenStatus>("idle");
  const [videoUrl,      setVideoUrl]      = useState<string | null>(null);
  const [progress,      setProgress]      = useState(0);
  const [phaseIdx,      setPhaseIdx]      = useState(0);
  const [showUpgrade,   setShowUpgrade]   = useState(false);
  const [copiedLink,    setCopiedLink]    = useState(false);

  const pollRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const outputRef       = useRef<HTMLDivElement>(null);
  const videoRef        = useRef<HTMLVideoElement>(null);

  // ── Cleanup ───────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (pollRef.current)     { clearInterval(pollRef.current);     pollRef.current     = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
    if (phaseRef.current)    { clearInterval(phaseRef.current);    phaseRef.current    = null; }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // ── Auto-scroll to output on completion ──────────────────
  useEffect(() => {
    if (genStatus === "done") {
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    }
  }, [genStatus]);

  // ── Start progress simulation ─────────────────────────────
  const startProgress = useCallback(() => {
    setProgress(0);
    setPhaseIdx(0);

    progressRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 88) { return 88; }
        return prev + (88 - prev) * 0.04 + 0.5;
      });
    }, 800);

    let pi = 0;
    phaseRef.current = setInterval(() => {
      pi = (pi + 1) % GEN_PHASES.length;
      setPhaseIdx(pi);
    }, 4500);
  }, []);

  // ── Poll for completion ───────────────────────────────────
  const startPolling = useCallback(async (generationId: string) => {
    setGenStatus("polling");
    generationIdRef.current = generationId;

    pollRef.current = setInterval(async () => {
      try {
        const token = await getToken();
        if (!token) { clearTimers(); setGenStatus("error"); return; }

        const res = await fetch(POLL_ENDPOINT, {
          method:  "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({ generation_id: generationId }),
        });

        const data = await res.json();
        console.debug("[video poll]", data.status);

        if (data.status === "succeeded" && data.video_url) {
          clearTimers();
          setProgress(100);
          setVideoUrl(data.video_url);
          setGenStatus("done");
          toast.success("Video generated!");
        } else if (data.status === "failed") {
          clearTimers();
          setGenStatus("error");
          toast.error(data.error || "Video generation failed. Try again.");
        }
        // still processing — keep polling
      } catch {
        clearTimers();
        setGenStatus("error");
        toast.error("Lost connection while generating. Try again.");
      }
    }, POLL_INTERVAL);
  }, [clearTimers]);

  // ── Generate ───────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim())                { toast.error("Describe your video scene first"); return; }
    if (!isVideoEnabled)               { setShowUpgrade(true); return; }
    if (!hasKey)                       { toast.error("Add your AI/ML API key in Settings → API Keys"); return; }
    if (genStatus === "generating" || genStatus === "polling") { return; }

    clearTimers();
    setVideoUrl(null);
    setGenStatus("generating");
    startProgress();

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated.");

      const res = await fetch(GEN_ENDPOINT, {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ prompt, aspect_ratio: aspectRatio, style, duration: 5 }),
      });

      const data = await res.json();
      console.debug("[video generate] response:", data);

      if (!res.ok) {
        throw new Error(data.error || `Generation failed (${res.status})`);
      }

      // Immediately done
      if (data.status === "succeeded" && data.video_url) {
        clearTimers();
        setProgress(100);
        setVideoUrl(data.video_url);
        setGenStatus("done");
        toast.success("Video generated!");
        return;
      }

      // Need polling
      if (data.generation_id) {
        await startPolling(data.generation_id);
        return;
      }

      throw new Error("No generation ID returned. Try again.");

    } catch (err: any) {
      clearTimers();
      setGenStatus("error");
      toast.error(err.message || "Video generation failed. Try again.");
    }
  }, [prompt, aspectRatio, style, genStatus, isVideoEnabled, hasKey, clearTimers, startProgress, startPolling]);

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl; a.download = "robinos-video.mp4"; a.target = "_blank"; a.click();
  };

  const handleCopyLink = async () => {
    if (!videoUrl) return;
    try {
      await navigator.clipboard.writeText(videoUrl);
      setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1600);
      toast.success("Video link copied");
    } catch {
      toast.error("Could not copy link.");
    }
  };

  const isGenerating = genStatus === "generating" || genStatus === "polling";
  const activeStyle  = VIDEO_STYLES.find((s) => s.value === style);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="pt-14 md:pt-0">

      {/* ── Ambient glow ─────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute top-[-10%] right-[10%] w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.04) 0%, transparent 65%)" }} />
      </div>

      <div className="relative z-10">
        {/* ── Header ───────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1.5">
            <Film className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground/55">AI Video</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Video Studio</h1>
            <Badge variant="outline" className={`text-[10px] font-mono ${
              isVideoEnabled ? "border-primary/30 text-primary" : "border-border text-muted-foreground"
            }`}>
              {isVideoEnabled ? "ENABLED (BYOK)" : "PRO CREATOR+ ONLY"}
            </Badge>
          </div>

          {isVideoEnabled && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border ${
                hasKey
                  ? "border-emerald-500/25 bg-emerald-500/6 text-emerald-400/80"
                  : "border-amber-500/25 bg-amber-500/6 text-amber-400/70"
              }`}>
                <motion.div
                  className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-amber-400"}`}
                  animate={hasKey ? { opacity: [1, 0.35, 1] } : {}}
                  transition={{ duration: 2.5, repeat: Infinity }}
                />
                {hasKey ? "Connected · AI/ML API" : "No AI/ML API key connected"}
              </div>
              {!hasKey && (
                <button onClick={() => navigate("/dashboard/settings")}
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-primary/60 hover:text-primary transition-colors">
                  <Settings className="w-3 h-3" /> Open Settings
                </button>
              )}
            </div>
          )}

          {!isVideoEnabled && (
            <p className="text-muted-foreground text-sm mt-1">
              Generate cinematic AI videos powered by AI/ML API.
            </p>
          )}
        </div>

        {/* ── Plan gate ────────────────────────────────────── */}
        {!isVideoEnabled ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
            <div className="rounded-2xl p-8 text-center"
              style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.15)" }}>
                <Lock className="w-5 h-5 text-primary/50" />
              </div>
              <h3 className="text-foreground font-medium text-sm mb-2">Video Studio is for Pro Creator & Agency</h3>
              <p className="text-muted-foreground text-xs mb-6 leading-relaxed">
                Upgrade to unlock AI video generation using your own AI/ML API key.
              </p>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={() => setShowUpgrade(true)}
                className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium glow-blue">
                Upgrade Now
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <div className="grid md:grid-cols-[1fr_1fr] gap-6 max-w-5xl">

            {/* ════════════ INPUT PANEL ════════════ */}
            <div className="space-y-5">

              {/* Prompt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55">
                    Prompt
                  </label>
                  <span className="text-[10px] font-mono text-muted-foreground/30">{prompt.length}/500</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your video scene — a neon-lit Tokyo street, cinematic drone shot of mountains, futuristic product reveal…"
                  disabled={isGenerating}
                  className="w-full min-h-[140px] max-h-[280px] rounded-xl text-sm text-foreground placeholder:text-muted-foreground/28 resize-y focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 p-4"
                  style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}
                />
              </div>

              {/* Aspect ratio */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55 mb-2.5 block">
                  Aspect Ratio
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ASPECT_RATIOS.map((ar) => {
                    const isActive = aspectRatio === ar.value;
                    return (
                      <motion.button
                        key={ar.value}
                        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setAspectRatio(ar.value)}
                        disabled={isGenerating}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                        style={isActive ? {
                          background: "hsl(217 91% 60% / 0.1)",
                          border: "1px solid hsl(217 91% 60% / 0.28)",
                          color: "hsl(217 91% 68%)",
                        } : {
                          background: "hsl(222 28% 6%)",
                          border: "1px solid hsl(217 28% 12%)",
                          color: "hsl(215 16% 42%)",
                        }}
                      >
                        <span className="text-[10px]">{ar.icon}</span>
                        <span>{ar.label}</span>
                        <span className="text-[9px] opacity-55">{ar.sub}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Style grid */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55 mb-2.5 block">
                  Style
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {VIDEO_STYLES.map((s) => {
                    const isActive = style === s.value;
                    return (
                      <motion.button
                        key={s.value}
                        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setStyle(s.value)}
                        disabled={isGenerating}
                        className="py-2 px-2.5 rounded-lg text-[11px] font-medium transition-all duration-200 disabled:opacity-40 text-center"
                        style={isActive ? {
                          background: `${s.glow}18`,
                          border: `1px solid ${s.glow}40`,
                          color: s.glow,
                          boxShadow: `0 0 12px ${s.glow}15`,
                        } : {
                          background: "hsl(222 28% 6%)",
                          border: "1px solid hsl(217 28% 11%)",
                          color: "hsl(215 16% 40%)",
                        }}
                      >
                        {s.label}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Generate button */}
              <motion.button
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                onClick={handleGenerate}
                disabled={isGenerating || !hasKey || !prompt.trim()}
                className="w-full h-11 rounded-xl text-sm font-medium glow-blue disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "hsl(217 91% 55%)", color: "#fff" }}
              >
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                  : <><Film className="w-4 h-4" /> Generate Video</>
                }
              </motion.button>

              {/* API key helper */}
              {!hasKey && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl p-4 space-y-3"
                  style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-amber-400/65 shrink-0" />
                    <p className="text-xs text-amber-400/65">AI/ML API key not connected</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => navigate("/dashboard/settings")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                      style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 48%)" }}>
                      <Settings className="w-3 h-3" /> Open Settings
                    </button>
                    <a href={AIML_AFFILIATE} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:border-primary/30 hover:text-primary/80"
                      style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 60% / 0.65)" }}>
                      <ExternalLink className="w-3 h-3" /> Get AI/ML API Key
                    </a>
                  </div>
                </motion.div>
              )}
            </div>

            {/* ════════════ OUTPUT PANEL ════════════ */}
            <div ref={outputRef}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55">
                  Output
                </label>
                {genStatus === "done" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/55">
                    <Zap className="w-3 h-3" /> Ready
                  </span>
                )}
              </div>

              {/* Output card */}
              <motion.div
                className="rounded-2xl overflow-hidden min-h-[420px] flex flex-col items-center justify-center"
                animate={{
                  boxShadow: isGenerating
                    ? `0 0 50px ${activeStyle?.glow ?? "hsl(217 91% 60%)"}18, 0 0 100px ${activeStyle?.glow ?? "hsl(217 91% 60%)"}08`
                    : genStatus === "done"
                    ? "0 0 50px hsl(145 60% 50% / 0.07)"
                    : "none",
                }}
                transition={{ duration: 0.8 }}
                style={{
                  background: "hsl(222 28% 5.5%)",
                  border: isGenerating
                    ? `1px solid ${activeStyle?.glow ?? "hsl(217 91% 60%)"}35`
                    : "1px solid hsl(217 28% 11%)",
                  padding: genStatus === "done" ? "0" : "1.5rem",
                }}
              >
                <AnimatePresence mode="wait">

                  {/* Generating */}
                  {isGenerating && (
                    <motion.div key="gen"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-7 w-full px-6 py-8"
                    >
                      {/* Pulse ring */}
                      <div className="relative flex items-center justify-center">
                        {[0, 1, 2].map((i) => (
                          <motion.div key={i}
                            className="absolute rounded-full"
                            style={{ width: 56 + i * 28, height: 56 + i * 28, border: `1px solid ${activeStyle?.glow ?? "hsl(217 91% 60%)"}` }}
                            animate={{ scale: [1, 1.5, 1.5], opacity: [0.5, 0, 0] }}
                            transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }}
                          />
                        ))}
                        <div className="w-14 h-14 rounded-full flex items-center justify-center"
                          style={{ background: `${activeStyle?.glow ?? "hsl(217 91% 60%)"}10`, border: `1px solid ${activeStyle?.glow ?? "hsl(217 91% 60%)"}25` }}>
                          <Film className="w-5 h-5" style={{ color: activeStyle?.glow ?? "hsl(217 91% 60%)" }} />
                        </div>
                      </div>

                      {/* Phase label */}
                      <AnimatePresence mode="wait">
                        <motion.p key={phaseIdx}
                          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                          transition={{ duration: 0.3 }}
                          className="text-xs font-mono"
                          style={{ color: activeStyle?.glow ?? "hsl(217 91% 60%)" }}
                        >
                          {GEN_PHASES[phaseIdx]}
                        </motion.p>
                      </AnimatePresence>

                      {/* Progress bar */}
                      <div className="w-full space-y-1.5">
                        <div className="w-full h-[3px] rounded-full overflow-hidden"
                          style={{ background: "hsl(217 28% 11%)" }}>
                          <motion.div
                            className="h-full rounded-full"
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            style={{ background: `linear-gradient(to right, ${activeStyle?.glow ?? "hsl(217 91% 55%)"}88, ${activeStyle?.glow ?? "hsl(217 91% 60%)"})` }}
                          />
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground/35 text-right">
                          {Math.round(progress)}%
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {/* Done — video player */}
                  {genStatus === "done" && videoUrl && (
                    <motion.div key="done"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5 }}
                      className="w-full space-y-0 flex flex-col"
                    >
                      {/* Video */}
                      <div className="relative group">
                        <video
                          ref={videoRef}
                          src={videoUrl}
                          controls
                          autoPlay
                          muted
                          loop
                          className="w-full block"
                          style={{ maxHeight: 340, background: "#000" }}
                        />
                        {/* Fullscreen overlay hint */}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                            className="w-7 h-7 rounded-md flex items-center justify-center backdrop-blur-sm"
                            style={{ background: "hsl(0 0% 0% / 0.5)" }}>
                            <Maximize2 className="w-3.5 h-3.5 text-white/70" />
                          </a>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-3 gap-2 p-4">
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleGenerate}
                          disabled={isGenerating}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-all disabled:opacity-35"
                          style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(215 16% 46%)" }}>
                          <RefreshCw className="w-3 h-3" />
                          <span className="hidden sm:inline">Regenerate</span>
                        </motion.button>
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleCopyLink}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-all"
                          style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: copiedLink ? "hsl(217 91% 65%)" : "hsl(215 16% 46%)" }}>
                          {copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span className="hidden sm:inline">{copiedLink ? "Copied" : "Copy Link"}</span>
                        </motion.button>
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownload}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-all"
                          style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(215 16% 46%)" }}>
                          <Download className="w-3 h-3" />
                          <span className="hidden sm:inline">Download</span>
                        </motion.button>
                      </div>
                    </motion.div>
                  )}

                  {/* Error */}
                  {genStatus === "error" && (
                    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="text-center space-y-4"
                    >
                      <div className="w-10 h-10 rounded-xl mx-auto flex items-center justify-center"
                        style={{ background: "hsl(0 72% 50% / 0.07)", border: "1px solid hsl(0 72% 50% / 0.18)" }}>
                        <Film className="w-4 h-4 text-red-400/55" />
                      </div>
                      <p className="text-xs text-red-400/65 font-mono">Generation failed</p>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleGenerate}
                        disabled={isGenerating || !hasKey || !prompt.trim()}
                        className="flex items-center gap-1.5 mx-auto px-4 py-2 rounded-xl text-xs disabled:opacity-35"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 46%)" }}>
                        <RefreshCw className="w-3 h-3" /> Retry
                      </motion.button>
                    </motion.div>
                  )}

                  {/* Idle */}
                  {genStatus === "idle" && (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="text-center space-y-3"
                    >
                      <motion.div
                        className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
                        style={{ background: "hsl(217 28% 7%)", border: "1px solid hsl(217 28% 12%)" }}
                        animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 18px hsl(217 91% 60% / 0.05)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                        transition={{ duration: 5, repeat: Infinity }}
                      >
                        <Film className="w-5 h-5 text-primary/18" />
                      </motion.div>
                      <p className="text-muted-foreground/28 text-xs font-mono">No video generated yet</p>
                      <p className="text-[10px] text-muted-foreground/18 font-mono">
                        Powered by AI/ML API · Kling 2.1
                      </p>
                    </motion.div>
                  )}

                </AnimatePresence>
              </motion.div>
            </div>
          </div>
        )}
      </div>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default VideoStudioPage;
