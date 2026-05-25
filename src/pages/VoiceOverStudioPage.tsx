import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Mic, Play, Pause, Download, Loader2, Lock, Volume2,
  Copy, Check, RefreshCw, Settings, Zap, StopCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useIsVoiceEnabled, useIsByokEnabled } from "@/hooks/useEntitlements";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

// ── Edge function ──────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const TTS_ENDPOINT = `${SUPABASE_URL}/functions/v1/elevenlabs-tts`;
const PREVIEW_TEXT = "Hello. This is how I sound — ready to bring your content to life.";

// ── Waveform engine ────────────────────────────────────────
const BAR_COUNT = 36;
const BAR_PROFILES: readonly number[] = Object.freeze(
  Array.from({ length: BAR_COUNT }, (_, i) => {
    const bell    = Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    const texture = Math.abs(Math.sin(i * 1.7 + 0.5)) * 0.25
                  + Math.abs(Math.cos(i * 2.3 + 1.0)) * 0.15;
    return Math.max(0.12, Math.min(0.97, bell * 0.65 + texture + 0.12));
  })
);
const ANIM_DUR: readonly number[] = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];

// ── Curated voice catalog — 6 voices, intentionally selected ─
// Premium curation: 3 male + 3 female, covering the core creator use-cases.
// Do NOT expand this list without manual curation review.
interface VoiceEntry {
  id:          string;
  name:        string;
  tagline:     string;       // single line personality
  useCases:    string[];     // 3–4 bullet use-cases
  gender:      "male" | "female";
  badge:       string;       // one elegant badge per voice
  badgeColor:  string;       // hsl color for badge glow
}

const VOICE_CATALOG: VoiceEntry[] = [
  // ── MALE ────────────────────────────────────────────────
  {
    id:         "pNInz6obpgDQGcFmaJgB",
    name:       "Ethan",
    tagline:    "Deep Cinematic",
    useCases:   ["Documentary", "AI Videos", "Storytelling", "Motivation"],
    gender:     "male",
    badge:      "Creator Favorite",
    badgeColor: "hsl(217 91% 60%)",
  },
  {
    id:         "TX3LPaxmHKxFdv7VOQHJ",
    name:       "Ryan",
    tagline:    "Energetic Viral",
    useCases:   ["Reels", "TikTok", "Shorts", "Hooks"],
    gender:     "male",
    badge:      "Viral Pick",
    badgeColor: "hsl(0 80% 62%)",
  },
  {
    id:         "TxGEqnHWrfWFTfGW9XjX",
    name:       "Michael",
    tagline:    "Luxury Smooth",
    useCases:   ["Ads", "Premium Brands", "SaaS Promos", "Explainers"],
    gender:     "male",
    badge:      "Premium",
    badgeColor: "hsl(48 90% 55%)",
  },
  // ── FEMALE ──────────────────────────────────────────────
  {
    id:         "FGY2WhTYpPnrIDTdsKH5",
    name:       "Sophia",
    tagline:    "Elegant Premium",
    useCases:   ["Luxury Brands", "Fashion", "Lifestyle", "Narration"],
    gender:     "female",
    badge:      "Luxury",
    badgeColor: "hsl(48 90% 55%)",
  },
  {
    id:         "EXAVITQu4vr4xnSDxMaL",
    name:       "Emma",
    tagline:    "Warm & Natural",
    useCases:   ["Vlogs", "Tutorials", "UGC Content", "Storytelling"],
    gender:     "female",
    badge:      "Trending",
    badgeColor: "hsl(38 90% 55%)",
  },
  {
    id:         "21m00Tcm4TlvDq8ikWAM",
    name:       "Ava",
    tagline:    "Confident Commercial",
    useCases:   ["Product Ads", "Marketing", "Startup Promos", "Announcements"],
    gender:     "female",
    badge:      "Recommended",
    badgeColor: "hsl(160 70% 48%)",
  },
];

// ── Types ──────────────────────────────────────────────────
type AudioStatus   = "idle" | "generating" | "preparing" | "ready" | "playing" | "error";
type PreviewStatus = "idle" | "loading" | "playing";

// ── Helpers ────────────────────────────────────────────────
const fmt = (s: number) => {
  if (!isFinite(s) || isNaN(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

// ── Full waveform — memoized ───────────────────────────────
const WaveformBars = memo(({ isPlaying, isGenerating }: { isPlaying: boolean; isGenerating: boolean }) => (
  <div className="flex items-end justify-center gap-[2.5px] h-16 px-1">
    {BAR_PROFILES.map((h, i) => (
      <motion.div key={i}
        style={{ width: 3, originY: 1, background: "hsl(217 91% 60%)" }}
        className="rounded-t-sm"
        animate={
          isPlaying    ? { scaleY: [h * 0.25, h, h * 0.35, h * 0.85, h * 0.25] } :
          isGenerating ? { scaleY: [0.08, h * 0.55, 0.08] } :
                         { scaleY: 0.10 }
        }
        transition={{
          duration:   0.22 + ANIM_DUR[i % ANIM_DUR.length] * 0.015,
          repeat:     (isPlaying || isGenerating) ? Infinity : 0,
          repeatType: "mirror",
          delay:      isGenerating ? (i * 0.04) % 0.7 : (i * 0.022) % 0.44,
          ease:       "easeInOut",
        }}
      />
    ))}
  </div>
));

// ── Voice card mini waveform ───────────────────────────────
const MINI_H = [0.4, 0.7, 1.0, 0.75, 0.45, 0.85, 0.55] as const;
const MiniWave = memo(({ active, preview, color }: { active: boolean; preview: boolean; color: string }) => (
  <div className="flex items-end gap-[1.5px] h-4">
    {MINI_H.map((h, i) => (
      <motion.div key={i}
        style={{
          width: 2.5, originY: 1,
          borderRadius: 2,
          background: preview ? color : active ? "hsl(217 91% 60%)" : "hsl(217 91% 60% / 0.25)",
        }}
        animate={(active || preview) ? { scaleY: [h * 0.25, h, h * 0.25] } : { scaleY: h * 0.15 }}
        transition={{
          duration:   0.5 + i * 0.08,
          repeat:     (active || preview) ? Infinity : 0,
          repeatType: "mirror",
          delay:      i * 0.07,
          ease:       "easeInOut",
        }}
      />
    ))}
  </div>
));

// ── Preview hook ───────────────────────────────────────────
function useVoicePreview(getToken: () => Promise<string | null>) {
  const [previewId,     setPreviewId]     = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const previewCache = useRef<Map<string, string>>(new Map());

  const stopPreview = useCallback(() => {
    const a = previewAudio.current;
    if (a) { a.pause(); a.onended = null; a.onerror = null; a.src = ""; a.load(); }
    setPreviewId(null);
    setPreviewStatus("idle");
  }, []);

  useEffect(() => {
    const cache = previewCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, []);

  const playPreview = useCallback(async (voiceId: string) => {
    if (previewId === voiceId && previewStatus === "playing") { stopPreview(); return; }
    stopPreview();
    setPreviewId(voiceId);
    setPreviewStatus("loading");

    try {
      let blobUrl = previewCache.current.get(voiceId);

      if (!blobUrl) {
        const token = await getToken();
        if (!token) { setPreviewStatus("idle"); toast.error("Not authenticated."); return; }

        const res = await fetch(TTS_ENDPOINT, {
          method:  "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({ text: PREVIEW_TEXT, voiceId, isPreview: true }),
        });

        if (!res.ok) {
          let msg = `Preview failed (${res.status})`;
          try { const j = await res.json(); msg = j.error ?? j.message ?? msg; } catch { /**/ }
          throw new Error(msg);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("audio")) throw new Error("Unexpected preview response.");

        const buf  = await res.arrayBuffer();
        const blob = new Blob([buf], { type: "audio/mpeg" });
        blobUrl    = URL.createObjectURL(blob);
        previewCache.current.set(voiceId, blobUrl);
      }

      const audio   = new Audio();
      audio.preload = "auto";
      audio.oncanplay = () => {
        setPreviewStatus("playing");
        audio.play().catch(() => { setPreviewStatus("idle"); setPreviewId(null); });
      };
      audio.onended = () => { setPreviewStatus("idle"); setPreviewId(null); };
      audio.onerror = () => { setPreviewStatus("idle"); setPreviewId(null); };
      audio.src = blobUrl!;
      audio.load();
      previewAudio.current = audio;

    } catch (err: any) {
      setPreviewStatus("idle");
      setPreviewId(null);
      toast.error(err.message || "Preview failed.");
    }
  }, [previewId, previewStatus, stopPreview, getToken]);

  return { previewId, previewStatus, playPreview, stopPreview };
}

// ── Main page ──────────────────────────────────────────────
const VoiceOverStudioPage = () => {
  const navigate          = useNavigate();
  const { data: profile } = useProfile();
  const isVoiceEnabled    = useIsVoiceEnabled();
  const isByokEnabled     = useIsByokEnabled();
  const hasKey            = isByokEnabled && !!profile?.elevenlabs_api_key;

  const [script,       setScript]       = useState("");
  const [selectedId,   setSelectedId]   = useState(VOICE_CATALOG[0].id);
  const [audioStatus,  setAudioStatus]  = useState<AudioStatus>("idle");
  const [blobUrl,      setBlobUrl]      = useState<string | null>(null);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [copiedLink,   setCopiedLink]   = useState(false);

  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const prevBlob    = useRef<string | null>(null);
  const outputRef   = useRef<HTMLDivElement>(null);
  const justGenRef  = useRef(false);
  const generateRef = useRef<() => void>(() => {});
  const toggleRef   = useRef<() => void>(() => {});

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);

  const { previewId, previewStatus, playPreview, stopPreview } = useVoicePreview(getToken);

  // ── Derived ────────────────────────────────────────────────
  const isGenerating = audioStatus === "generating";
  const isPreparing  = audioStatus === "preparing";
  const isPlaying    = audioStatus === "playing";
  const hasAudio     = audioStatus === "ready" || audioStatus === "playing";
  const isError      = audioStatus === "error";
  const progressPct  = duration > 0 ? (currentTime / duration) * 100 : 0;
  const activeVoice  = VOICE_CATALOG.find((v) => v.id === selectedId) ?? VOICE_CATALOG[0];

  // ── Cleanup ────────────────────────────────────────────────
  useEffect(() => () => {
    if (prevBlob.current) URL.revokeObjectURL(prevBlob.current);
    audioRef.current?.pause();
    stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll on ready ───────────────────────────────────
  useEffect(() => {
    if (audioStatus === "ready" && justGenRef.current) {
      justGenRef.current = false;
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    }
  }, [audioStatus]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const inInput = ["textarea", "input"].includes((e.target as HTMLElement).tagName.toLowerCase());
      if (e.code === "Space"   && !inInput) { e.preventDefault(); toggleRef.current(); }
      if (e.code === "Escape"  && !inInput) { const a = audioRef.current; if (a && !a.paused) { a.pause(); setAudioStatus("ready"); } }
      if ((e.metaKey || e.ctrlKey) && e.code === "Enter") { e.preventDefault(); generateRef.current(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── Audio bind ─────────────────────────────────────────────
  const bindAudio = useCallback((url: string) => {
    const old = audioRef.current;
    if (old) {
      old.pause();
      old.ontimeupdate = old.onloadedmetadata = old.oncanplay = old.onended = old.onerror = null;
      old.src = ""; old.load();
    }
    const a   = new Audio();
    a.preload = "auto";
    a.onloadedmetadata = () => { if (isFinite(a.duration)) setDuration(a.duration); };
    a.oncanplay        = () => setAudioStatus("ready");
    a.ontimeupdate     = () => setCurrentTime(a.currentTime);
    a.onended          = () => { setAudioStatus("ready"); setCurrentTime(0); a.currentTime = 0; };
    a.onerror          = () => { setAudioStatus("error"); toast.error("Playback failed. Try regenerating."); };
    a.src = url; a.load();
    audioRef.current = a;
    setAudioStatus("preparing");
  }, []);

  // ── Generate ───────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!script.trim())               { toast.error("Paste your script first"); return; }
    if (!isVoiceEnabled)              { setShowUpgrade(true); return; }
    if (!hasKey)                      { toast.error("Add your ElevenLabs API key in Settings → API Keys"); return; }
    if (script.length > 5000)        { toast.error("Script must be under 5000 characters"); return; }
    if (audioStatus === "generating") { return; }

    stopPreview();
    if (prevBlob.current) { URL.revokeObjectURL(prevBlob.current); prevBlob.current = null; }
    setBlobUrl(null); setCurrentTime(0); setDuration(0);
    setAudioStatus("generating");
    justGenRef.current = true;

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated.");

      const res = await fetch(TTS_ENDPOINT, {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ text: script, voiceId: selectedId }),
      });

      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        let msg = `Generation failed (${res.status})`;
        try { const j = await res.json(); msg = j.error ?? j.message ?? msg; } catch { /**/ }
        throw new Error(msg);
      }
      if (!ct.includes("audio")) {
        const body = await res.text();
        console.error("[voice] bad ct:", ct, body.slice(0, 200));
        throw new Error("Unexpected server response. Check ElevenLabs API key.");
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("Empty audio response.");

      const blob = new Blob([buf], { type: "audio/mpeg" });
      const url  = URL.createObjectURL(blob);
      prevBlob.current = url;
      setBlobUrl(url);
      bindAudio(url);
      toast.success("Voice over generated");

    } catch (err: any) {
      justGenRef.current = false;
      setAudioStatus("error");
      toast.error(err.message || "Voice generation failed.");
    }
  }, [script, selectedId, audioStatus, isVoiceEnabled, hasKey, bindAudio, getToken, stopPreview]);

  useEffect(() => { generateRef.current = handleGenerate; });

  // ── Playback ───────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    const a = audioRef.current;
    if (!a || !blobUrl) return;
    if (audioStatus === "playing") {
      a.pause(); setAudioStatus("ready");
    } else if (audioStatus === "ready") {
      try { setAudioStatus("playing"); await a.play(); }
      catch (err: any) {
        setAudioStatus("ready");
        if (err.name === "NotSupportedError") toast.error("Format not supported — download instead.");
        else if (err.name === "NotAllowedError") toast.error("Browser blocked autoplay — click play.");
        else toast.error("Playback error: " + err.message);
      }
    }
  }, [audioStatus, blobUrl]);

  useEffect(() => { toggleRef.current = togglePlay; });

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl; a.download = "robinos-voiceover.mp3"; a.click();
  };

  const handleCopyLink = async () => {
    if (!blobUrl) return;
    try {
      await navigator.clipboard.writeText(blobUrl);
      setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1600);
      toast.success("Voice link copied");
    } catch {
      try {
        const inp = document.createElement("input");
        inp.value = blobUrl; document.body.appendChild(inp); inp.select();
        document.execCommand("copy"); document.body.removeChild(inp);
        toast.success("Voice link copied");
      } catch { toast.error("Could not copy — try downloading."); }
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="pt-14 md:pt-0 relative">

      {/* Atmospheric depth layer */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute top-[-8%] left-[2%] w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.04) 0%, transparent 65%)" }} />
        <div className="absolute bottom-[10%] right-[-5%] w-[400px] h-[400px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.025) 0%, transparent 65%)" }} />
      </div>

      <div className="relative z-10">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1.5">
          <Mic className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground/45">AI Voice</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold tracking-tight">Voice Engine</h1>
          <Badge variant="outline" className={`text-[10px] font-mono ${
            isVoiceEnabled ? "border-primary/30 text-primary" : "border-border text-muted-foreground"
          }`}>
            {isVoiceEnabled ? "ENABLED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        {isVoiceEnabled && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border transition-all ${
              hasKey ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400/75"
                     : "border-amber-500/20 bg-amber-500/5 text-amber-400/65"
            }`}>
              <motion.div
                className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-amber-400"}`}
                animate={hasKey ? { opacity: [1, 0.35, 1] } : {}}
                transition={{ duration: 2.5, repeat: Infinity }}
              />
              {hasKey ? "Connected · ElevenLabs" : "No API key connected"}
            </div>
            {!hasKey && (
              <button onClick={() => navigate("/dashboard/settings")}
                className="inline-flex items-center gap-1 text-[10px] font-mono text-primary/55 hover:text-primary transition-colors">
                <Settings className="w-3 h-3" /> Open Settings
              </button>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/18">⌘↵ generate · Space play/pause · Esc stop</span>
          </div>
        )}
        {!isVoiceEnabled && (
          <p className="text-muted-foreground/60 text-sm mt-1">Generate professional voice overs from your scripts using ElevenLabs.</p>
        )}
      </div>

      {/* Plan gate */}
      {!isVoiceEnabled ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
          <div className="rounded-2xl p-8 text-center"
            style={{
              background: "linear-gradient(145deg, hsl(222 30% 7%) 0%, hsl(222 26% 6%) 100%)",
              border: "1px solid hsl(217 28% 13%)",
              boxShadow: "0 8px 40px hsl(0 0% 0% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.03)",
            }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.14)" }}>
              <Lock className="w-5 h-5 text-primary/45" />
            </div>
            <h3 className="text-foreground/90 font-medium text-sm mb-2">Voice Engine is for Pro Creator & Agency</h3>
            <p className="text-muted-foreground/55 text-xs mb-6 leading-relaxed">
              Upgrade to unlock unlimited voice generation using your own ElevenLabs API key.
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

          {/* ══════════════ INPUT PANEL ══════════════ */}
          <div className="space-y-6">

            {/* Script */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/45">Script</label>
                <span className="text-[10px] font-mono text-muted-foreground/25">{script.length}/5000</span>
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your script here…"
                disabled={isGenerating}
                className="w-full min-h-[160px] max-h-[320px] rounded-xl text-sm text-foreground/90 placeholder:text-muted-foreground/22 resize-y focus:outline-none disabled:opacity-50 p-4 leading-relaxed"
                style={{
                  background: "hsl(222 28% 5.5%)",
                  border: "1px solid hsl(217 28% 12%)",
                  boxShadow: "inset 0 2px 8px hsl(0 0% 0% / 0.15)",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "hsl(217 91% 60% / 0.3)"; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = "hsl(217 28% 12%)"; }}
              />
            </div>

            {/* ── Curated Voice Selector ─────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/45">
                  Voice
                </label>
                <span className="text-[9px] font-mono text-muted-foreground/20 tracking-wider">
                  Curated · {VOICE_CATALOG.length} voices
                </span>
              </div>

              {/* 2-column grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {VOICE_CATALOG.map((voice, idx) => {
                  const isSelected   = selectedId === voice.id;
                  const isPreviewing = previewId === voice.id && previewStatus === "playing";
                  const isLoading    = previewId === voice.id && previewStatus === "loading";

                  // Dynamic card styles per state
                  const cardStyle = isSelected ? {
                    background: `linear-gradient(145deg, ${voice.badgeColor.replace(")", " / 0.09)")} 0%, hsl(222 28% 6%) 100%)`,
                    border: `1px solid ${voice.badgeColor.replace(")", " / 0.32)")}`,
                    boxShadow: `0 4px 24px ${voice.badgeColor.replace(")", " / 0.10)")}, inset 0 1px 0 hsl(0 0% 100% / 0.04)`,
                  } : isPreviewing ? {
                    background: `linear-gradient(145deg, ${voice.badgeColor.replace(")", " / 0.07)")} 0%, hsl(222 28% 6%) 100%)`,
                    border: `1px solid ${voice.badgeColor.replace(")", " / 0.22)")}`,
                    boxShadow: `0 4px 20px ${voice.badgeColor.replace(")", " / 0.08)")}`,
                  } : {
                    background: "linear-gradient(145deg, hsl(222 28% 7%) 0%, hsl(222 26% 6%) 100%)",
                    border: "1px solid hsl(217 28% 12%)",
                    boxShadow: "0 2px 12px hsl(0 0% 0% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.025)",
                  };

                  return (
                    <motion.div
                      key={voice.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.3 }}
                      className="rounded-xl overflow-hidden flex flex-col"
                      style={cardStyle}
                      whileHover={!isSelected && !isPreviewing ? {
                        y: -2,
                        boxShadow: `0 8px 28px hsl(0 0% 0% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.035)`,
                        borderColor: "hsl(217 28% 18%)",
                      } : isSelected ? {
                        boxShadow: `0 6px 32px ${voice.badgeColor.replace(")", " / 0.15)")}, inset 0 1px 0 hsl(0 0% 100% / 0.04)`,
                      } : {}}
                    >
                      {/* Top edge shimmer on selected */}
                      {isSelected && (
                        <div className="h-px w-full"
                          style={{ background: `linear-gradient(90deg, transparent 10%, ${voice.badgeColor.replace(")", " / 0.4)")} 50%, transparent 90%)` }} />
                      )}

                      {/* Selectable card body */}
                      <button
                        onClick={() => setSelectedId(voice.id)}
                        disabled={isGenerating}
                        className="text-left p-4 pb-2 flex flex-col gap-2.5 disabled:opacity-40 flex-1"
                      >
                        {/* Name + badge row */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div>
                            <p className={`text-sm font-semibold leading-tight tracking-tight ${isSelected ? "text-primary" : "text-foreground/88"}`}>
                              {voice.name}
                            </p>
                            <p className="text-[10px] mt-0.5 leading-tight"
                              style={{ color: isSelected ? voice.badgeColor.replace(")", " / 0.65)") : "hsl(215 16% 38%)" }}>
                              {voice.tagline}
                            </p>
                          </div>
                          {/* Single refined badge */}
                          <span
                            className="shrink-0 text-[7.5px] font-mono px-1.5 py-0.5 rounded-full border mt-0.5 leading-none tracking-wide"
                            style={{
                              color:       voice.badgeColor.replace(")", " / 0.85)"),
                              borderColor: voice.badgeColor.replace(")", " / 0.22)"),
                              background:  voice.badgeColor.replace(")", " / 0.06)"),
                            }}
                          >
                            {voice.badge}
                          </span>
                        </div>

                        {/* Use-case chips */}
                        <div className="flex flex-wrap gap-1">
                          {voice.useCases.map((uc) => (
                            <span key={uc}
                              className="text-[8px] font-mono px-1.5 py-0.5 rounded-md leading-none"
                              style={{
                                background: isSelected
                                  ? voice.badgeColor.replace(")", " / 0.08)")
                                  : "hsl(217 28% 9%)",
                                color: isSelected
                                  ? voice.badgeColor.replace(")", " / 0.7)")
                                  : "hsl(215 16% 35%)",
                                border: `1px solid ${isSelected ? voice.badgeColor.replace(")", " / 0.14)") : "hsl(217 28% 12%)"}`,
                              }}>
                              {uc}
                            </span>
                          ))}
                        </div>

                        {/* Mini waveform */}
                        <div className="flex justify-end">
                          <MiniWave active={isSelected} preview={isPreviewing} color={voice.badgeColor} />
                        </div>
                      </button>

                      {/* Separator */}
                      <div className="mx-3"
                        style={{ height: 1, background: isSelected ? `${voice.badgeColor.replace(")", " / 0.12)")}` : "hsl(217 28% 10%)" }} />

                      {/* Preview button */}
                      <div className="px-3 py-2.5">
                        <motion.button
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!hasKey) { toast.error("Add your ElevenLabs API key to preview voices."); return; }
                            playPreview(voice.id);
                          }}
                          disabled={isLoading || isGenerating}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[9.5px] font-mono tracking-wide transition-all duration-200 disabled:opacity-35"
                          style={isPreviewing ? {
                            background: voice.badgeColor.replace(")", " / 0.1)"),
                            border:     `1px solid ${voice.badgeColor.replace(")", " / 0.28)")}`,
                            color:      voice.badgeColor,
                            boxShadow:  `0 0 10px ${voice.badgeColor.replace(")", " / 0.08)")}`,
                          } : {
                            background: "hsl(217 28% 8%)",
                            border:     "1px solid hsl(217 28% 13%)",
                            color:      "hsl(215 16% 38%)",
                          }}
                        >
                          {isLoading ? (
                            <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading</>
                          ) : isPreviewing ? (
                            <><StopCircle className="w-2.5 h-2.5" /> Playing</>
                          ) : (
                            <><Play className="w-2.5 h-2.5" /> Preview</>
                          )}
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Generate */}
            <motion.button
              whileHover={{ scale: 1.01, boxShadow: "0 8px 32px hsl(217 91% 60% / 0.28)" }}
              whileTap={{ scale: 0.99 }}
              onClick={handleGenerate}
              disabled={isGenerating || !hasKey || !script.trim()}
              className="w-full h-11 rounded-xl text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
              style={{
                background: "linear-gradient(135deg, hsl(217 91% 52%) 0%, hsl(217 91% 60%) 100%)",
                color: "#fff",
                boxShadow: "0 4px 20px hsl(217 91% 60% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
              }}
            >
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating voice...</>
                : <><Volume2 className="w-4 h-4" /> Generate Voice Over</>
              }
            </motion.button>

            {/* No-key hint */}
            {!hasKey && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                style={{
                  background: "hsl(38 95% 55% / 0.04)",
                  border: "1px solid hsl(38 95% 55% / 0.15)",
                  boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.02)",
                }}>
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
                  <p className="text-xs text-amber-400/60">ElevenLabs API key not connected</p>
                </div>
                <button onClick={() => navigate("/dashboard/settings")}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-mono text-amber-400/50 hover:text-amber-400 transition-colors">
                  <Settings className="w-3 h-3" /> Settings
                </button>
              </motion.div>
            )}
          </div>

          {/* ══════════════ OUTPUT PANEL ══════════════ */}
          <div ref={outputRef}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/45">Output</label>
              {hasAudio && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/55">
                  <Zap className="w-3 h-3" /> Ready
                </span>
              )}
            </div>

            <motion.div
              className="rounded-2xl p-6 min-h-[420px] flex flex-col items-center justify-center"
              animate={{
                boxShadow: isPlaying
                  ? "0 0 70px hsl(217 91% 60% / 0.1), 0 0 140px hsl(217 91% 60% / 0.05), inset 0 1px 0 hsl(217 91% 60% / 0.06)"
                  : "0 8px 40px hsl(0 0% 0% / 0.25), inset 0 1px 0 hsl(0 0% 100% / 0.025)",
              }}
              transition={{ duration: 0.7 }}
              style={{
                background: "linear-gradient(160deg, hsl(222 30% 6.5%) 0%, hsl(222 26% 5%) 100%)",
                border: isPlaying
                  ? "1px solid hsl(217 91% 60% / 0.22)"
                  : "1px solid hsl(217 28% 11%)",
              }}
            >
              <AnimatePresence mode="wait">

                {/* Generating */}
                {isGenerating && (
                  <motion.div key="gen"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-6 w-full"
                  >
                    <div style={{ filter: "drop-shadow(0 0 12px hsl(217 91% 60% / 0.28))" }}>
                      <WaveformBars isPlaying={false} isGenerating />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono text-primary/65">Generating voice...</p>
                      <p className="text-[10px] font-mono text-muted-foreground/28 mt-1">
                        {activeVoice.name} · {activeVoice.tagline}
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Preparing */}
                {isPreparing && (
                  <motion.div key="prep"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <motion.div
                      className="w-12 h-12 rounded-full"
                      style={{ border: "1px solid hsl(217 91% 60% / 0.25)", background: "hsl(217 91% 60% / 0.04)" }}
                      animate={{ opacity: [0.3, 1, 0.3], scale: [0.96, 1.04, 0.96] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                    <p className="text-xs font-mono text-muted-foreground/38">Preparing audio...</p>
                  </motion.div>
                )}

                {/* Ready / Playing */}
                {hasAudio && (
                  <motion.div key="player"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="w-full space-y-5"
                  >
                    {/* Voice label */}
                    <p className="text-center text-[10px] font-mono text-muted-foreground/30">
                      {activeVoice.name} · {activeVoice.tagline}
                    </p>

                    {/* Waveform */}
                    <div className="relative overflow-hidden rounded-md"
                      style={{
                        filter: isPlaying ? "drop-shadow(0 0 8px hsl(217 91% 60% / 0.24))" : "none",
                        transition: "filter 0.5s ease",
                      }}>
                      <WaveformBars isPlaying={isPlaying} isGenerating={false} />
                      <div className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `linear-gradient(to right, transparent ${progressPct}%, hsl(222 28% 4% / 0.72) ${progressPct}%)`,
                          transition: "background 0.08s linear",
                        }} />
                    </div>

                    {/* Scrubber */}
                    <div className="space-y-1.5">
                      <div className="relative h-5 flex items-center group cursor-pointer">
                        <div className="absolute w-full h-[2px] rounded-full"
                          style={{ background: "hsl(217 28% 10%)" }} />
                        <div className="absolute h-[2px] rounded-full transition-all duration-100"
                          style={{ width: `${progressPct}%`, background: "linear-gradient(to right, hsl(217 91% 50%), hsl(217 91% 65%))" }} />
                        <div className="absolute w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ left: `calc(${progressPct}% - 5px)` }} />
                        <input type="range" min={0} max={duration || 1} step={0.05}
                          value={currentTime} onChange={handleSeek}
                          className="absolute w-full opacity-0 cursor-pointer h-5" />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[9.5px] font-mono text-muted-foreground/28">{fmt(currentTime)}</span>
                        <span className="text-[9.5px] font-mono text-muted-foreground/28">{fmt(duration)}</span>
                      </div>
                    </div>

                    {/* Play */}
                    <div className="flex justify-center">
                      <motion.button
                        whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                        onClick={togglePlay}
                        animate={isPlaying ? {
                          boxShadow: [
                            "0 0 0 hsl(217 91% 60% / 0)",
                            "0 0 28px hsl(217 91% 60% / 0.45)",
                            "0 0 0 hsl(217 91% 60% / 0)",
                          ],
                        } : {
                          boxShadow: "0 4px 16px hsl(217 91% 60% / 0.18)",
                        }}
                        transition={{ duration: 2, repeat: isPlaying ? Infinity : 0 }}
                        className="w-14 h-14 rounded-full text-white flex items-center justify-center"
                        style={{
                          background: "linear-gradient(145deg, hsl(217 91% 55%) 0%, hsl(217 91% 65%) 100%)",
                          boxShadow: "0 4px 16px hsl(217 91% 60% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.15)",
                        }}
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                      </motion.button>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { icon: <RefreshCw className="w-3 h-3" />, label: "Regenerate", action: handleGenerate, disabled: isGenerating },
                        {
                          icon: copiedLink ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />,
                          label: copiedLink ? "Copied" : "Copy Link",
                          action: handleCopyLink, disabled: false,
                        },
                        { icon: <Download className="w-3 h-3" />, label: "Download", action: handleDownload, disabled: false },
                      ] as const).map((btn) => (
                        <motion.button key={btn.label}
                          whileHover={{ scale: 1.02, borderColor: "hsl(217 28% 20%)" }}
                          whileTap={{ scale: 0.97 }}
                          onClick={btn.action}
                          disabled={btn.disabled}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-all disabled:opacity-25"
                          style={{
                            background: "hsl(217 28% 7%)",
                            border: "1px solid hsl(217 28% 12%)",
                            color: "hsl(215 16% 44%)",
                            boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.02)",
                          }}>
                          {btn.icon}
                          <span className="hidden sm:inline">{btn.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Error */}
                {isError && (
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center space-y-4">
                    <div className="w-10 h-10 rounded-xl mx-auto flex items-center justify-center"
                      style={{ background: "hsl(0 72% 50% / 0.06)", border: "1px solid hsl(0 72% 50% / 0.15)" }}>
                      <Mic className="w-4 h-4 text-red-400/50" />
                    </div>
                    <p className="text-xs text-red-400/60 font-mono">Generation failed</p>
                    <div className="flex gap-2 justify-center">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleGenerate}
                        disabled={isGenerating || !hasKey || !script.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs disabled:opacity-30"
                        style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(215 16% 46%)" }}>
                        <RefreshCw className="w-3 h-3" /> Retry
                      </motion.button>
                      {blobUrl && (
                        <motion.button whileHover={{ scale: 1.02 }} onClick={handleDownload}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                          style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(215 16% 46%)" }}>
                          <Download className="w-3 h-3" /> Download
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Idle */}
                {audioStatus === "idle" && (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center space-y-3">
                    <motion.div
                      className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
                      style={{
                        background: "linear-gradient(145deg, hsl(217 28% 8%) 0%, hsl(217 28% 6%) 100%)",
                        border: "1px solid hsl(217 28% 12%)",
                        boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.03)",
                      }}
                      animate={{ boxShadow: [
                        "0 0 0 hsl(217 91% 60% / 0), inset 0 1px 0 hsl(0 0% 100% / 0.03)",
                        "0 0 20px hsl(217 91% 60% / 0.06), inset 0 1px 0 hsl(0 0% 100% / 0.03)",
                        "0 0 0 hsl(217 91% 60% / 0), inset 0 1px 0 hsl(0 0% 100% / 0.03)",
                      ]}}
                      transition={{ duration: 4.5, repeat: Infinity }}>
                      <Mic className="w-5 h-5 text-primary/16" />
                    </motion.div>
                    <p className="text-muted-foreground/25 text-xs font-mono">No audio generated yet</p>
                    <p className="text-[9.5px] text-muted-foreground/14 font-mono tracking-wider">
                      Select a voice · Preview · Generate
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
    </div>
  );
};

export default VoiceOverStudioPage;
