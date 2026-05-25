import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Play, Pause, Download, Loader2, Lock, Volume2,
  Copy, Check, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useIsVoiceEnabled, useIsByokEnabled } from "@/hooks/useEntitlements";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

// ── Constants ──────────────────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const TTS_ENDPOINT  = `${SUPABASE_URL}/functions/v1/elevenlabs-tts`;
const BAR_COUNT     = 36;

// Natural bell-curve waveform profile with organic texture
const BAR_PROFILES: readonly number[] = Object.freeze(
  Array.from({ length: BAR_COUNT }, (_, i) => {
    const bell    = Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    const texture = Math.abs(Math.sin(i * 1.7 + 0.5)) * 0.25
                  + Math.abs(Math.cos(i * 2.3 + 1.0)) * 0.15;
    return Math.max(0.12, Math.min(0.97, bell * 0.65 + texture + 0.12));
  })
);

// Prime-based durations → bars never sync up
const ANIM_DURATIONS: readonly number[] =
  [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];

const voices = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",   style: "Warm & Natural" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George",  style: "Authoritative" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura",   style: "Soft & Clear" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam",    style: "Energetic" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",  style: "Deep & Calm" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",    style: "Friendly" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger",   style: "Professional" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", style: "Conversational" },
];

// ── Types ──────────────────────────────────────────────────
type AudioStatus = "idle" | "generating" | "preparing" | "ready" | "playing" | "error";

// ── Helpers ────────────────────────────────────────────────
const fmt = (s: number): string => {
  if (!isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const m   = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
};

// ── Memoized waveform bars — only re-renders on state change ──
const WaveformBars = memo(({ isPlaying, isGenerating }: { isPlaying: boolean; isGenerating: boolean }) => (
  <div className="flex items-end justify-center gap-[2.5px] h-16 px-1">
    {BAR_PROFILES.map((h, i) => (
      <motion.div
        key={i}
        style={{ width: 3, originY: 1, background: "hsl(217 91% 60%)" }}
        className="rounded-t-sm"
        animate={
          isPlaying ? {
            scaleY: [h * 0.25, h, h * 0.35, h * 0.85, h * 0.25],
          } : isGenerating ? {
            scaleY: [0.08, h * 0.55, 0.08],
          } : {
            scaleY: 0.10,
          }
        }
        transition={{
          duration: 0.22 + ANIM_DURATIONS[i % ANIM_DURATIONS.length] * 0.015,
          repeat:   (isPlaying || isGenerating) ? Infinity : 0,
          repeatType: "mirror",
          delay:    isGenerating ? (i * 0.04) % 0.7 : (i * 0.022) % 0.44,
          ease:     "easeInOut",
        }}
      />
    ))}
  </div>
));

// ── Main component ─────────────────────────────────────────
const VoiceOverStudioPage = () => {
  const { data: profile } = useProfile();
  const isVoiceEnabled    = useIsVoiceEnabled();
  const isByokEnabled     = useIsByokEnabled();
  const hasKey            = isByokEnabled && !!profile?.elevenlabs_api_key;

  const [script,        setScript]        = useState("");
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [audioStatus,   setAudioStatus]   = useState<AudioStatus>("idle");
  const [blobUrl,       setBlobUrl]       = useState<string | null>(null);
  const [currentTime,   setCurrentTime]   = useState(0);
  const [duration,      setDuration]      = useState(0);
  const [showUpgrade,   setShowUpgrade]   = useState(false);
  const [copiedLink,    setCopiedLink]    = useState(false);

  // Audio + DOM refs
  const audioRef          = useRef<HTMLAudioElement | null>(null);
  const prevBlobUrl       = useRef<string | null>(null);
  const outputRef         = useRef<HTMLDivElement>(null);
  const justGeneratedRef  = useRef(false);

  // Stable refs for keyboard handler (avoids stale closures)
  const handleGenerateRef = useRef<() => void>(() => {});
  const togglePlayRef     = useRef<() => void>(() => {});

  // ── Derived ────────────────────────────────────────────────
  const isGenerating   = audioStatus === "generating";
  const isPreparing    = audioStatus === "preparing";
  const isPlaying      = audioStatus === "playing";
  const hasAudio       = audioStatus === "ready" || audioStatus === "playing";
  const isError        = audioStatus === "error";
  const progressPct    = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
      audioRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll output into view on first ready ────────────
  useEffect(() => {
    if (audioStatus === "ready" && justGeneratedRef.current) {
      justGeneratedRef.current = false;
      setTimeout(() => {
        outputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    }
  }, [audioStatus]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      const isInInput = tag === "textarea" || tag === "input";

      // SPACE → play/pause (not while typing)
      if (e.code === "Space" && !isInInput) {
        e.preventDefault();
        togglePlayRef.current();
      }
      // ESC → stop
      if (e.code === "Escape" && !isInInput) {
        const a = audioRef.current;
        if (a && !a.paused) { a.pause(); setAudioStatus("ready"); }
      }
      // CMD/CTRL + ENTER → generate
      if ((e.metaKey || e.ctrlKey) && e.code === "Enter") {
        e.preventDefault();
        handleGenerateRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // runs once — refs stay current

  // ── Wire audio element ─────────────────────────────────────
  const bindAudio = useCallback((url: string) => {
    const old = audioRef.current;
    if (old) {
      old.pause();
      old.ontimeupdate      = null;
      old.ondurationchange  = null;
      old.onloadedmetadata  = null;
      old.oncanplay         = null;
      old.onended           = null;
      old.onerror           = null;
      old.src               = "";
      old.load();
    }

    const audio = new Audio();
    audio.preload = "auto";

    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration)) {
        setDuration(audio.duration);
        console.debug("[voice] metadata loaded — duration:", audio.duration);
      }
    };
    audio.oncanplay = () => {
      console.debug("[voice] canplay — readyState:", audio.readyState);
      setAudioStatus("ready");
    };
    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };
    audio.onended = () => {
      setAudioStatus("ready");
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    audio.onerror = (e) => {
      console.error("[voice] element error", e, "readyState:", audio.readyState);
      setAudioStatus("error");
      toast.error("Audio playback failed. Try regenerating.");
    };

    audio.src = url;
    audio.load();
    audioRef.current = audio;
    setAudioStatus("preparing");
    console.debug("[voice] bound audio — src:", url);
  }, []);

  // ── Generate ───────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!script.trim())               { toast.error("Paste your script first");                                 return; }
    if (!isVoiceEnabled)              { setShowUpgrade(true);                                                   return; }
    if (!hasKey)                      { toast.error("Add your ElevenLabs API key in Settings → API Keys");     return; }
    if (script.length > 5000)        { toast.error("Script must be under 5000 characters");                    return; }
    if (audioStatus === "generating") { return; }

    // Revoke previous blob
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    setBlobUrl(null);
    setCurrentTime(0);
    setDuration(0);
    setAudioStatus("generating");
    justGeneratedRef.current = true;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Not authenticated — please log in again.");

      console.debug("[voice] → TTS endpoint:", TTS_ENDPOINT);

      const response = await fetch(TTS_ENDPOINT, {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ text: script, voiceId: selectedVoice }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      console.debug("[voice] status:", response.status, "content-type:", contentType);

      if (!response.ok) {
        let msg = `Voice generation failed (${response.status})`;
        try { const j = await response.json(); msg = j.error ?? j.message ?? msg; } catch { /* */ }
        throw new Error(msg);
      }
      if (!contentType.includes("audio")) {
        const body = await response.text();
        console.error("[voice] unexpected content-type:", contentType, "body:", body.slice(0, 200));
        throw new Error("Server returned unexpected content. Check ElevenLabs API key.");
      }

      const arrayBuffer = await response.arrayBuffer();
      console.debug("[voice] arrayBuffer byteLength:", arrayBuffer.byteLength);
      if (arrayBuffer.byteLength === 0) throw new Error("Received empty audio data.");

      const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      const url  = URL.createObjectURL(blob);
      console.debug("[voice] blob size:", blob.size, "url:", url);

      prevBlobUrl.current = url;
      setBlobUrl(url);
      bindAudio(url);
      toast.success("Voice over generated!");

    } catch (err: any) {
      console.error("[voice] generation error:", err);
      justGeneratedRef.current = false;
      setAudioStatus("error");
      toast.error(err.message || "Voice generation failed. Try again.");
    }
  }, [script, selectedVoice, audioStatus, isVoiceEnabled, hasKey, bindAudio]);

  // Keep ref in sync
  useEffect(() => { handleGenerateRef.current = handleGenerate; });

  // ── Playback toggle ────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;

    if (audioStatus === "playing") {
      audio.pause();
      setAudioStatus("ready");
    } else if (audioStatus === "ready") {
      try {
        setAudioStatus("playing");
        await audio.play();
        console.debug("[voice] play started — readyState:", audio.readyState);
      } catch (err: any) {
        console.error("[voice] play() rejected:", err.name, err.message);
        setAudioStatus("ready");
        if (err.name === "NotSupportedError") {
          toast.error("Audio format not supported. Try downloading instead.");
        } else if (err.name === "NotAllowedError") {
          toast.error("Browser blocked autoplay — click play to start.");
        } else {
          toast.error("Playback error: " + err.message);
        }
      }
    }
  }, [audioStatus, blobUrl]);

  useEffect(() => { togglePlayRef.current = togglePlay; });

  // ── Seek ───────────────────────────────────────────────────
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  // ── Download ───────────────────────────────────────────────
  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href     = blobUrl;
    a.download = "robinos-voiceover.mp3";
    a.click();
  };

  // ── Copy voice link ────────────────────────────────────────
  const handleCopyLink = async () => {
    if (!blobUrl) return;
    try {
      await navigator.clipboard.writeText(blobUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1600);
      toast.success("Voice link copied to clipboard");
    } catch {
      // Fallback
      try {
        const inp = document.createElement("input");
        inp.value = blobUrl;
        document.body.appendChild(inp);
        inp.select();
        document.execCommand("copy");
        document.body.removeChild(inp);
        toast.success("Voice link copied");
      } catch {
        toast.error("Could not copy — download instead.");
      }
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="pt-14 md:pt-0">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Mic className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">AI Voice</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Voice Engine</h1>
          <Badge variant="outline" className={`text-[10px] font-mono ${
            isVoiceEnabled ? "border-primary/30 text-primary" : "border-border text-muted-foreground"
          }`}>
            {isVoiceEnabled ? "ENABLED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Generate professional voice overs from your scripts using ElevenLabs.
        </p>
        <p className="text-[10px] text-muted-foreground/30 font-mono mt-1">
          ⌘↵ generate · Space play/pause · Esc stop
        </p>
      </div>

      {!isVoiceEnabled ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
          <div className="rounded-xl border border-border/50 bg-card/30 p-8 text-center">
            <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-foreground font-medium text-sm mb-2">
              Voice Engine is for Pro Creator & Agency
            </h3>
            <p className="text-muted-foreground text-xs mb-6">
              Upgrade to Pro Creator or Agency to unlock unlimited voice generation using your ElevenLabs API key.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setShowUpgrade(true)}
              className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium glow-blue"
            >
              Upgrade Now
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl">

          {/* ── INPUT PANEL ────────────────────────────────── */}
          <div className="space-y-5">
            {!hasKey && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">
                  Add your ElevenLabs API key in{" "}
                  <span className="font-mono">Settings → API Keys</span>
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">
                Script
              </label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your script here (max 5000 characters)..."
                className="w-full min-h-[200px] max-h-[400px] rounded-lg border border-border bg-secondary p-4 text-sm text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isGenerating}
              />
              <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono text-right">
                {script.length}/5000
              </p>
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">
                Voice
              </label>
              <div className="grid grid-cols-2 gap-2">
                {voices.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSelectedVoice(voice.id)}
                    disabled={isGenerating}
                    className={`px-3 py-2.5 rounded-lg text-left transition-all disabled:opacity-50 ${
                      selectedVoice === voice.id
                        ? "bg-primary/15 border border-primary/30"
                        : "bg-secondary border border-border hover:border-border/80"
                    }`}
                  >
                    <p className={`text-xs font-medium ${
                      selectedVoice === voice.id ? "text-primary" : "text-foreground"
                    }`}>
                      {voice.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{voice.style}</p>
                  </button>
                ))}
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleGenerate}
              disabled={isGenerating || !hasKey || !script.trim()}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                : <><Volume2 className="w-4 h-4" /> Generate Voice Over</>
              }
            </motion.button>
          </div>

          {/* ── OUTPUT PANEL ───────────────────────────────── */}
          <div ref={outputRef}>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">
              Output
            </label>

            {/* Card — glows while playing */}
            <motion.div
              className="rounded-2xl p-6 min-h-[340px] flex flex-col items-center justify-center transition-all duration-700"
              animate={{
                boxShadow: isPlaying
                  ? "0 0 50px hsl(217 91% 60% / 0.1), 0 0 100px hsl(217 91% 60% / 0.05)"
                  : "none",
              }}
              style={{
                background: "hsl(222 28% 6%)",
                border: isPlaying
                  ? "1px solid hsl(217 91% 60% / 0.22)"
                  : "1px solid hsl(217 28% 12%)",
              }}
            >
              <AnimatePresence mode="wait">

                {/* ── GENERATING ─────────────────────────── */}
                {isGenerating && (
                  <motion.div key="generating"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-5 w-full"
                  >
                    <motion.div
                      className="relative"
                      style={{ filter: "drop-shadow(0 0 8px hsl(217 91% 60% / 0.3))" }}
                    >
                      <WaveformBars isPlaying={false} isGenerating={true} />
                    </motion.div>
                    <div className="text-center space-y-1">
                      <p className="text-xs font-mono text-primary/70">Generating voice...</p>
                      <p className="text-[10px] font-mono text-muted-foreground/35">
                        Synthesizing with ElevenLabs
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ── PREPARING ──────────────────────────── */}
                {isPreparing && (
                  <motion.div key="preparing"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <motion.div
                      className="w-12 h-12 rounded-full"
                      style={{ border: "1px solid hsl(217 91% 60% / 0.3)", background: "hsl(217 91% 60% / 0.06)" }}
                      animate={{ opacity: [0.4, 1, 0.4], scale: [0.97, 1.03, 0.97] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                    <p className="text-xs font-mono text-muted-foreground/60">Preparing audio...</p>
                  </motion.div>
                )}

                {/* ── READY / PLAYING ─────────────────────── */}
                {hasAudio && (
                  <motion.div key="ready"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="w-full space-y-5"
                  >
                    {/* Waveform + progress overlay */}
                    <div className="relative overflow-hidden rounded-md"
                      style={{
                        filter: isPlaying
                          ? "drop-shadow(0 0 8px hsl(217 91% 60% / 0.28))"
                          : "none",
                        transition: "filter 0.5s ease",
                      }}
                    >
                      <WaveformBars isPlaying={isPlaying} isGenerating={false} />
                      {/* Dark overlay dims "unplayed" portion */}
                      <div
                        className="absolute inset-0 pointer-events-none transition-all duration-150"
                        style={{
                          background: `linear-gradient(to right, transparent ${progressPct}%, hsl(222 28% 4% / 0.68) ${progressPct}%)`,
                        }}
                      />
                    </div>

                    {/* Scrubber + timestamps */}
                    <div className="space-y-1.5">
                      {/* Custom scrubber */}
                      <div className="relative h-5 flex items-center group cursor-pointer">
                        {/* Track */}
                        <div className="absolute w-full h-[3px] rounded-full"
                          style={{ background: "hsl(217 28% 12%)" }} />
                        {/* Fill */}
                        <div
                          className="absolute h-[3px] rounded-full transition-all duration-100"
                          style={{
                            width: `${progressPct}%`,
                            background: "linear-gradient(to right, hsl(217 91% 55%), hsl(217 91% 70%))",
                          }}
                        />
                        {/* Thumb */}
                        <div
                          className="absolute w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ left: `calc(${progressPct}% - 6px)` }}
                        />
                        {/* Transparent range input for interaction */}
                        <input
                          type="range"
                          min={0}
                          max={duration || 1}
                          step={0.05}
                          value={currentTime}
                          onChange={handleSeek}
                          className="absolute w-full opacity-0 cursor-pointer h-5"
                        />
                      </div>
                      {/* Timestamps */}
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted-foreground/45">
                          {fmt(currentTime)}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/45">
                          {fmt(duration)}
                        </span>
                      </div>
                    </div>

                    {/* Play / pause button */}
                    <div className="flex justify-center">
                      <motion.button
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={togglePlay}
                        animate={isPlaying ? {
                          boxShadow: [
                            "0 0 0px hsl(217 91% 60% / 0)",
                            "0 0 22px hsl(217 91% 60% / 0.4)",
                            "0 0 0px hsl(217 91% 60% / 0)",
                          ],
                        } : { boxShadow: "0 0 0 hsl(217 91% 60% / 0)" }}
                        transition={{ duration: 2, repeat: isPlaying ? Infinity : 0 }}
                        className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-blue"
                      >
                        {isPlaying
                          ? <Pause className="w-5 h-5" />
                          : <Play  className="w-5 h-5 ml-0.5" />
                        }
                      </motion.button>
                    </div>

                    {/* Action row */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* Regenerate */}
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 50%)" }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span className="hidden sm:inline">Regenerate</span>
                      </motion.button>

                      {/* Copy link */}
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleCopyLink}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 50%)" }}
                      >
                        {copiedLink
                          ? <><Check className="w-3 h-3 text-primary" /><span className="hidden sm:inline">Copied</span></>
                          : <><Copy className="w-3 h-3" /><span className="hidden sm:inline">Copy Link</span></>
                        }
                      </motion.button>

                      {/* Download */}
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleDownload}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 50%)" }}
                      >
                        <Download className="w-3 h-3" />
                        <span className="hidden sm:inline">Download</span>
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* ── ERROR ──────────────────────────────── */}
                {isError && (
                  <motion.div key="error"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center space-y-3"
                  >
                    <p className="text-xs text-red-400/80 font-mono">
                      Playback error — try regenerating.
                    </p>
                    <div className="flex gap-2 justify-center">
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleGenerate}
                        disabled={isGenerating || !hasKey || !script.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 50%)" }}
                      >
                        <RefreshCw className="w-3 h-3" /> Regenerate
                      </motion.button>
                      {blobUrl && (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          onClick={handleDownload}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                          style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)", color: "hsl(215 16% 50%)" }}
                        >
                          <Download className="w-3 h-3" /> Download
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── IDLE ───────────────────────────────── */}
                {audioStatus === "idle" && (
                  <motion.div key="idle"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center space-y-2"
                  >
                    <Mic className="w-8 h-8 text-muted-foreground/15 mx-auto" />
                    <p className="text-muted-foreground/35 text-xs font-mono">
                      No audio generated yet.
                    </p>
                    <p className="text-[10px] text-muted-foreground/20 font-mono">
                      Write a script and press Generate
                    </p>
                  </motion.div>
                )}

              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      )}

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default VoiceOverStudioPage;
