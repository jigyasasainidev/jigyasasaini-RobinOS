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
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const TTS_ENDPOINT  = `${SUPABASE_URL}/functions/v1/elevenlabs-tts`;
const PREVIEW_TEXT  = "Hello. This is how I sound — ready to bring your content to life.";

// ── Waveform engine constants ──────────────────────────────
const BAR_COUNT    = 36;
const BAR_PROFILES: readonly number[] = Object.freeze(
  Array.from({ length: BAR_COUNT }, (_, i) => {
    const bell    = Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    const texture = Math.abs(Math.sin(i * 1.7 + 0.5)) * 0.25
                  + Math.abs(Math.cos(i * 2.3 + 1.0)) * 0.15;
    return Math.max(0.12, Math.min(0.97, bell * 0.65 + texture + 0.12));
  })
);
const ANIM_DUR: readonly number[] = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];

// ── Badge system ───────────────────────────────────────────
type BadgeKey = "popular" | "trending" | "creator" | "new" | "recommended" | "podcast" | "viral";

const BADGE_CFG: Record<BadgeKey, { label: string; cls: string }> = {
  popular:     { label: "Most Popular",  cls: "border-primary/30 text-primary/80"          },
  trending:    { label: "Trending",      cls: "border-amber-500/30 text-amber-400/80"       },
  creator:     { label: "Creator Fav",   cls: "border-emerald-500/30 text-emerald-400/80"   },
  new:         { label: "New",           cls: "border-violet-500/30 text-violet-400/80"     },
  recommended: { label: "Recommended",   cls: "border-cyan-500/30 text-cyan-400/80"         },
  podcast:     { label: "Podcast Pick",  cls: "border-indigo-500/30 text-indigo-400/80"     },
  viral:       { label: "Viral",         cls: "border-rose-500/30 text-rose-400/80"         },
};

// ── Voice library — 20 premium voices ─────────────────────
interface VoiceEntry {
  id:          string;
  name:        string;
  personality: string;
  useCase:     string;
  gender:      "male" | "female";
  badge?:      BadgeKey;
}

// ElevenLabs premade voice IDs — all accessible with any valid API key
const VOICE_LIBRARY: VoiceEntry[] = [
  // ── MALE ──────────────────────────────────────────────
  { id: "pNInz6obpgDQGcFmaJgB", name: "Ethan",   personality: "Deep Cinematic",     useCase: "Storytelling · Film",      gender: "male",   badge: "popular"     },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "James",   personality: "Confident Corporate", useCase: "Explainers · Ads",         gender: "male",   badge: "creator"     },
  { id: "ErXwobaYiN019PkySvjV", name: "Alex",    personality: "Friendly Creator",    useCase: "YouTube Shorts · Vlogs",   gender: "male",   badge: "new"         },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Ryan",    personality: "Energetic Viral",     useCase: "TikTok · Reels",           gender: "male",   badge: "trending"    },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "David",   personality: "Documentary Calm",    useCase: "Education · Narration",    gender: "male",   badge: "podcast"     },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Michael", personality: "Luxury Smooth",       useCase: "Brand Ads · Premium",      gender: "male",   badge: "recommended" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Liam",    personality: "Youthful Fast",       useCase: "Gen-Z · Social Content",   gender: "male",   badge: "new"         },
  { id: "VR6AewLTigWG4xSOukaG", name: "Daniel",  personality: "Motivational Power",  useCase: "Self Improvement · Ads",   gender: "male"                        },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Noah",    personality: "Conversational Easy", useCase: "Podcasts · Long-form",     gender: "male",   badge: "podcast"     },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Marcus",  personality: "Strong Authority",    useCase: "AI News · Announcements",  gender: "male",   badge: "popular"     },
  // ── FEMALE ────────────────────────────────────────────
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Emma",    personality: "Warm & Natural",      useCase: "Lifestyle · Vlog",         gender: "female", badge: "popular"     },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Sophia",  personality: "Luxury Elegant",      useCase: "Premium Ads · Fashion",    gender: "female", badge: "popular"     },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Olivia",  personality: "Friendly Creator",    useCase: "YouTube · Social",         gender: "female", badge: "creator"     },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Ava",     personality: "Soft & Calm",         useCase: "Wellness · Meditation",    gender: "female", badge: "recommended" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Isabella",personality: "Expressive Viral",    useCase: "Hooks · Short-form",       gender: "female", badge: "viral"       },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Mia",     personality: "Conversational",      useCase: "Podcasts · Interviews",    gender: "female", badge: "podcast"     },
  { id: "ThT5KcBeYPX3keUQqHPh", name: "Charlotte",personality: "Documentary Clear",  useCase: "Education · Explainers",   gender: "female"                      },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Amelia",  personality: "Emotional Cinematic", useCase: "Storytelling · Drama",     gender: "female", badge: "recommended" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Harper",  personality: "Gen-Z Fast Energy",   useCase: "Viral Content · TikTok",   gender: "female", badge: "trending"    },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Grace",   personality: "Premium Corporate",   useCase: "SaaS · Product Demo",      gender: "female", badge: "recommended" },
];

const TRENDING_IDS = new Set(["TX3LPaxmHKxFdv7VOQHJ", "EXAVITQu4vr4xnSDxMaL", "MF3mGyEYCl7XYWbV9V6O", "XB0fDUnXU5powFXDhCwa", "cgSgspJ2msm6clMCkdW9", "JBFqnCBsd6RMkjVDRZzb"]);

// ── Types ──────────────────────────────────────────────────
type AudioStatus   = "idle" | "generating" | "preparing" | "ready" | "playing" | "error";
type VoiceTab      = "all" | "male" | "female" | "trending";
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

// ── Mini waveform — memoized ───────────────────────────────
const MINI_H = [0.45, 0.75, 1.0, 0.80, 0.50, 0.90, 0.60] as const;
const MiniWave = memo(({ active, preview }: { active: boolean; preview: boolean }) => (
  <div className="flex items-end gap-[1.5px] h-3.5">
    {MINI_H.map((h, i) => (
      <motion.div key={i}
        style={{
          width: 2, originY: 1,
          background: active
            ? "hsl(217 91% 60%)"
            : preview
            ? "hsl(38 90% 55%)"
            : "hsl(217 91% 60% / 0.3)",
        }}
        className="rounded-t-sm"
        animate={(active || preview) ? { scaleY: [h * 0.3, h, h * 0.3] } : { scaleY: h * 0.18 }}
        transition={{
          duration:   0.48 + i * 0.07,
          repeat:     (active || preview) ? Infinity : 0,
          repeatType: "mirror",
          delay:      i * 0.07,
          ease:       "easeInOut",
        }}
      />
    ))}
  </div>
));

// ── Voice preview hook ─────────────────────────────────────
// Manages a single shared preview audio element + blob cache
function useVoicePreview(getToken: () => Promise<string | null>) {
  const [previewId,     setPreviewId]     = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const previewAudio  = useRef<HTMLAudioElement | null>(null);
  const previewCache  = useRef<Map<string, string>>(new Map()); // voiceId → blobUrl

  // Teardown helper
  const stopPreview = useCallback(() => {
    const a = previewAudio.current;
    if (a) { a.pause(); a.onended = null; a.onerror = null; a.src = ""; a.load(); }
    setPreviewId(null);
    setPreviewStatus("idle");
  }, []);

  // Revoke cached blobs on unmount
  useEffect(() => {
    const cache = previewCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, []);

  const playPreview = useCallback(async (voiceId: string) => {
    // Already playing this one → stop
    if (previewId === voiceId && previewStatus === "playing") {
      stopPreview();
      return;
    }
    // Stop whatever is currently playing
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
        console.debug("[preview] cached voiceId:", voiceId, "size:", blob.size);
      } else {
        console.debug("[preview] cache hit for voiceId:", voiceId);
      }

      const audio   = new Audio();
      audio.preload = "auto";
      audio.oncanplay = () => {
        setPreviewStatus("playing");
        audio.play().catch((e) => {
          console.error("[preview] play() rejected:", e);
          setPreviewStatus("idle"); setPreviewId(null);
        });
      };
      audio.onended = () => { setPreviewStatus("idle"); setPreviewId(null); };
      audio.onerror = () => { setPreviewStatus("idle"); setPreviewId(null); };
      audio.src = blobUrl!;
      audio.load();
      previewAudio.current = audio;

    } catch (err: any) {
      console.error("[preview] error:", err);
      setPreviewStatus("idle");
      setPreviewId(null);
      toast.error(err.message || "Preview failed.");
    }
  }, [previewId, previewStatus, stopPreview, getToken]);

  return { previewId, previewStatus, playPreview, stopPreview };
}

// ── Main page component ────────────────────────────────────
const VoiceOverStudioPage = () => {
  const navigate          = useNavigate();
  const { data: profile } = useProfile();
  const isVoiceEnabled    = useIsVoiceEnabled();
  const isByokEnabled     = useIsByokEnabled();
  const hasKey            = isByokEnabled && !!profile?.elevenlabs_api_key;

  const [script,        setScript]        = useState("");
  const [selectedVoice, setSelectedVoice] = useState(VOICE_LIBRARY[0].id);
  const [voiceTab,      setVoiceTab]      = useState<VoiceTab>("all");
  const [audioStatus,   setAudioStatus]   = useState<AudioStatus>("idle");
  const [blobUrl,       setBlobUrl]       = useState<string | null>(null);
  const [currentTime,   setCurrentTime]   = useState(0);
  const [duration,      setDuration]      = useState(0);
  const [showUpgrade,   setShowUpgrade]   = useState(false);
  const [copiedLink,    setCopiedLink]    = useState(false);
  const [hoveredVoice,  setHoveredVoice]  = useState<string | null>(null);

  const audioRef      = useRef<HTMLAudioElement | null>(null);
  const prevBlobUrl   = useRef<string | null>(null);
  const outputRef     = useRef<HTMLDivElement>(null);
  const justGenRef    = useRef(false);
  const generateRef   = useRef<() => void>(() => {});
  const toggleRef     = useRef<() => void>(() => {});

  // Stable token getter for preview hook
  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);

  const { previewId, previewStatus, playPreview, stopPreview } =
    useVoicePreview(getToken);

  // ── Derived ────────────────────────────────────────────────
  const isGenerating = audioStatus === "generating";
  const isPreparing  = audioStatus === "preparing";
  const isPlaying    = audioStatus === "playing";
  const hasAudio     = audioStatus === "ready" || audioStatus === "playing";
  const isError      = audioStatus === "error";
  const progressPct  = duration > 0 ? (currentTime / duration) * 100 : 0;

  const filteredVoices = VOICE_LIBRARY.filter((v) =>
    voiceTab === "all"      ? true :
    voiceTab === "trending" ? TRENDING_IDS.has(v.id) :
    v.gender === voiceTab
  );

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => () => {
    if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    audioRef.current?.pause();
    stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll after generation ──────────────────────────
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
      if (e.code === "Space" && !inInput)                  { e.preventDefault(); toggleRef.current(); }
      if (e.code === "Escape" && !inInput)                 { const a = audioRef.current; if (a && !a.paused) { a.pause(); setAudioStatus("ready"); } }
      if ((e.metaKey || e.ctrlKey) && e.code === "Enter")  { e.preventDefault(); generateRef.current(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── Bind main audio element ────────────────────────────────
  const bindAudio = useCallback((url: string) => {
    const old = audioRef.current;
    if (old) {
      old.pause();
      old.ontimeupdate = old.onloadedmetadata = old.oncanplay = old.onended = old.onerror = null;
      old.src = ""; old.load();
    }
    const a    = new Audio();
    a.preload  = "auto";
    a.onloadedmetadata = () => { if (isFinite(a.duration)) setDuration(a.duration); };
    a.oncanplay        = () => { setAudioStatus("ready"); };
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
    if (prevBlobUrl.current) { URL.revokeObjectURL(prevBlobUrl.current); prevBlobUrl.current = null; }
    setBlobUrl(null); setCurrentTime(0); setDuration(0);
    setAudioStatus("generating");
    justGenRef.current = true;

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated.");

      const res = await fetch(TTS_ENDPOINT, {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ text: script, voiceId: selectedVoice }),
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
      prevBlobUrl.current = url;
      setBlobUrl(url);
      bindAudio(url);
      toast.success("Voice over generated");

    } catch (err: any) {
      justGenRef.current = false;
      setAudioStatus("error");
      toast.error(err.message || "Voice generation failed.");
    }
  }, [script, selectedVoice, audioStatus, isVoiceEnabled, hasKey, bindAudio, getToken, stopPreview]);

  useEffect(() => { generateRef.current = handleGenerate; });

  // ── Playback toggle ────────────────────────────────────────
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
      toast.success("Voice link copied to clipboard");
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
    <div className="pt-14 md:pt-0">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1.5">
          <Mic className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground/55">AI Voice</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Voice Engine</h1>
          <Badge variant="outline" className={`text-[10px] font-mono ${
            isVoiceEnabled ? "border-primary/30 text-primary" : "border-border text-muted-foreground"
          }`}>
            {isVoiceEnabled ? "ENABLED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        {isVoiceEnabled && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border ${
              hasKey ? "border-emerald-500/25 bg-emerald-500/6 text-emerald-400/80"
                     : "border-amber-500/25 bg-amber-500/6 text-amber-400/70"
            }`}>
              <motion.div className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-amber-400"}`}
                animate={hasKey ? { opacity: [1, 0.35, 1] } : {}}
                transition={{ duration: 2.5, repeat: Infinity }} />
              {hasKey ? "Connected · ElevenLabs" : "No API key connected"}
            </div>
            {!hasKey && (
              <button onClick={() => navigate("/dashboard/settings")}
                className="inline-flex items-center gap-1 text-[10px] font-mono text-primary/60 hover:text-primary transition-colors">
                <Settings className="w-3 h-3" /> Open Settings
              </button>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/22">
              ⌘↵ generate · Space play/pause · Esc stop
            </span>
          </div>
        )}
        {!isVoiceEnabled && (
          <p className="text-muted-foreground text-sm mt-1">Generate professional voice overs from your scripts using ElevenLabs.</p>
        )}
      </div>

      {/* Plan gate */}
      {!isVoiceEnabled ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
          <div className="rounded-2xl p-8 text-center"
            style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.15)" }}>
              <Lock className="w-5 h-5 text-primary/50" />
            </div>
            <h3 className="text-foreground font-medium text-sm mb-2">Voice Engine is for Pro Creator & Agency</h3>
            <p className="text-muted-foreground text-xs mb-6 leading-relaxed">
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
          <div className="space-y-5">
            {/* Script */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55">Script</label>
                <span className="text-[10px] font-mono text-muted-foreground/30">{script.length}/5000</span>
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your script here…"
                disabled={isGenerating}
                className="w-full min-h-[160px] max-h-[340px] rounded-xl text-sm text-foreground placeholder:text-muted-foreground/28 resize-y focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 p-4"
                style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}
              />
            </div>

            {/* Voice library */}
            <div>
              {/* Header row: label + tabs */}
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55">
                  Voice Library <span className="text-muted-foreground/30">· {filteredVoices.length}</span>
                </label>
                <div className="flex gap-1">
                  {(["all", "male", "female", "trending"] as VoiceTab[]).map((tab) => (
                    <button key={tab} onClick={() => setVoiceTab(tab)}
                      className="px-2.5 py-1 rounded-md text-[9px] font-mono uppercase tracking-wider transition-all"
                      style={voiceTab === tab ? {
                        background: "hsl(217 91% 60% / 0.1)",
                        border: "1px solid hsl(217 91% 60% / 0.25)",
                        color: "hsl(217 91% 68%)",
                      } : {
                        background: "transparent",
                        border: "1px solid hsl(217 28% 14%)",
                        color: "hsl(215 16% 38%)",
                      }}>
                      {tab === "trending" ? "🔥 " : ""}{tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice grid — scrollable */}
              <div className="grid grid-cols-2 gap-2 max-h-[380px] overflow-y-auto scrollbar-thin pr-0.5">
                <AnimatePresence mode="popLayout">
                  {filteredVoices.map((voice, idx) => {
                    const isSelected  = selectedVoice === voice.id;
                    const isHovered   = hoveredVoice === voice.id;
                    const isPreviewing = previewId === voice.id && previewStatus === "playing";
                    const isLoading    = previewId === voice.id && previewStatus === "loading";

                    return (
                      <motion.div
                        key={voice.id}
                        layout
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.94 }}
                        transition={{ delay: idx * 0.025, duration: 0.2 }}
                        onMouseEnter={() => setHoveredVoice(voice.id)}
                        onMouseLeave={() => setHoveredVoice(null)}
                        className="rounded-xl flex flex-col gap-2.5 transition-all duration-200 overflow-hidden"
                        style={isSelected ? {
                          background: "hsl(217 91% 60% / 0.07)",
                          border: "1px solid hsl(217 91% 60% / 0.26)",
                          boxShadow: isPreviewing
                            ? "0 0 20px hsl(217 91% 60% / 0.12)"
                            : "0 0 14px hsl(217 91% 60% / 0.05)",
                        } : isPreviewing ? {
                          background: "hsl(38 90% 55% / 0.05)",
                          border: "1px solid hsl(38 90% 55% / 0.22)",
                          boxShadow: "0 0 16px hsl(38 90% 55% / 0.08)",
                        } : {
                          background: isHovered ? "hsl(217 28% 8%)" : "hsl(222 28% 6%)",
                          border: `1px solid hsl(217 28% ${isHovered ? 15 : 11}%)`,
                        }}
                      >
                        {/* Card body — selects voice */}
                        <button
                          onClick={() => setSelectedVoice(voice.id)}
                          disabled={isGenerating}
                          className="text-left p-3 pb-1.5 flex flex-col gap-1.5 disabled:opacity-40 flex-1"
                        >
                          {/* Name + badge */}
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <p className={`text-xs font-semibold leading-tight ${isSelected ? "text-primary" : "text-foreground/85"}`}>
                                {voice.name}
                              </p>
                              <p className="text-[9px] text-muted-foreground/42 mt-0.5 leading-tight">
                                {voice.personality}
                              </p>
                            </div>
                            {voice.badge && (
                              <span className={`shrink-0 text-[8px] font-mono px-1.5 py-0.5 rounded-full border ${BADGE_CFG[voice.badge].cls}`}>
                                {BADGE_CFG[voice.badge].label}
                              </span>
                            )}
                          </div>

                          {/* Use-case + mini waveform */}
                          <div className="flex items-center justify-between">
                            <p className="text-[9px] text-muted-foreground/28 leading-tight truncate max-w-[85px]">
                              {voice.useCase}
                            </p>
                            <MiniWave active={isSelected} preview={isPreviewing} />
                          </div>
                        </button>

                        {/* Preview button — separate from card selection */}
                        <div className="px-3 pb-3">
                          <motion.button
                            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!hasKey) { toast.error("Add your ElevenLabs API key to preview voices."); return; }
                              playPreview(voice.id);
                            }}
                            disabled={isLoading || isGenerating}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-mono transition-all disabled:opacity-40"
                            style={isPreviewing ? {
                              background: "hsl(38 90% 55% / 0.1)",
                              border: "1px solid hsl(38 90% 55% / 0.25)",
                              color: "hsl(38 90% 60%)",
                            } : {
                              background: "hsl(217 28% 9%)",
                              border: "1px solid hsl(217 28% 15%)",
                              color: "hsl(215 16% 42%)",
                            }}
                          >
                            {isLoading ? (
                              <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading</>
                            ) : isPreviewing ? (
                              <><StopCircle className="w-2.5 h-2.5" /> Playing Preview</>
                            ) : (
                              <><Play className="w-2.5 h-2.5" /> Preview</>
                            )}
                          </motion.button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>

            {/* Generate */}
            <motion.button
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              onClick={handleGenerate}
              disabled={isGenerating || !hasKey || !script.trim()}
              className="w-full h-11 rounded-xl text-sm font-medium glow-blue disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "hsl(217 91% 55%)", color: "#fff" }}
            >
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating voice...</>
                : <><Volume2 className="w-4 h-4" /> Generate Voice Over</>
              }
            </motion.button>

            {/* No-key notice */}
            {!hasKey && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                style={{ background: "hsl(38 95% 55% / 0.05)", border: "1px solid hsl(38 95% 55% / 0.18)" }}>
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400/65 shrink-0" />
                  <p className="text-xs text-amber-400/65">ElevenLabs API key not connected</p>
                </div>
                <button onClick={() => navigate("/dashboard/settings")}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-mono text-amber-400/55 hover:text-amber-400 transition-colors">
                  <Settings className="w-3 h-3" /> Settings
                </button>
              </motion.div>
            )}
          </div>

          {/* ══════════════ OUTPUT PANEL ══════════════ */}
          <div ref={outputRef}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/55">Output</label>
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
                  ? "0 0 60px hsl(217 91% 60% / 0.09), 0 0 120px hsl(217 91% 60% / 0.04)"
                  : "none",
              }}
              transition={{ duration: 0.7 }}
              style={{
                background: "hsl(222 28% 5.5%)",
                border: isPlaying
                  ? "1px solid hsl(217 91% 60% / 0.20)"
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
                    <div style={{ filter: "drop-shadow(0 0 10px hsl(217 91% 60% / 0.25))" }}>
                      <WaveformBars isPlaying={false} isGenerating={true} />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-xs font-mono text-primary/65">Generating voice...</p>
                      <p className="text-[10px] font-mono text-muted-foreground/28">Synthesizing · ElevenLabs</p>
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
                      style={{ border: "1px solid hsl(217 91% 60% / 0.28)", background: "hsl(217 91% 60% / 0.05)" }}
                      animate={{ opacity: [0.35, 1, 0.35], scale: [0.96, 1.04, 0.96] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                    <p className="text-xs font-mono text-muted-foreground/42">Preparing audio...</p>
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
                    {/* Waveform */}
                    <div className="relative overflow-hidden rounded-md"
                      style={{
                        filter: isPlaying ? "drop-shadow(0 0 7px hsl(217 91% 60% / 0.22))" : "none",
                        transition: "filter 0.5s ease",
                      }}
                    >
                      <WaveformBars isPlaying={isPlaying} isGenerating={false} />
                      <div className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `linear-gradient(to right, transparent ${progressPct}%, hsl(222 28% 4% / 0.72) ${progressPct}%)`,
                          transition: "background 0.1s linear",
                        }}
                      />
                    </div>

                    {/* Scrubber */}
                    <div className="space-y-1.5">
                      <div className="relative h-5 flex items-center group cursor-pointer">
                        <div className="absolute w-full h-[2px] rounded-full" style={{ background: "hsl(217 28% 11%)" }} />
                        <div className="absolute h-[2px] rounded-full transition-all duration-100"
                          style={{ width: `${progressPct}%`, background: "linear-gradient(to right, hsl(217 91% 50%), hsl(217 91% 68%))" }} />
                        <div className="absolute w-2.5 h-2.5 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ left: `calc(${progressPct}% - 5px)` }} />
                        <input type="range" min={0} max={duration || 1} step={0.05}
                          value={currentTime} onChange={handleSeek}
                          className="absolute w-full opacity-0 cursor-pointer h-5" />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted-foreground/32">{fmt(currentTime)}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/32">{fmt(duration)}</span>
                      </div>
                    </div>

                    {/* Play button */}
                    <div className="flex justify-center">
                      <motion.button
                        whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                        onClick={togglePlay}
                        animate={isPlaying ? {
                          boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 22px hsl(217 91% 60% / 0.38)", "0 0 0 hsl(217 91% 60% / 0)"],
                        } : { boxShadow: "none" }}
                        transition={{ duration: 2, repeat: isPlaying ? Infinity : 0 }}
                        className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-blue"
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
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={btn.action}
                          disabled={btn.disabled}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-all disabled:opacity-30"
                          style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(215 16% 46%)" }}
                        >
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
                    className="text-center space-y-4"
                  >
                    <div className="w-10 h-10 rounded-xl mx-auto flex items-center justify-center"
                      style={{ background: "hsl(0 72% 50% / 0.07)", border: "1px solid hsl(0 72% 50% / 0.18)" }}>
                      <Mic className="w-4 h-4 text-red-400/55" />
                    </div>
                    <p className="text-xs text-red-400/65 font-mono">Generation failed</p>
                    <div className="flex gap-2 justify-center">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={handleGenerate} disabled={isGenerating || !hasKey || !script.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs disabled:opacity-35"
                        style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 46%)" }}>
                        <RefreshCw className="w-3 h-3" /> Retry
                      </motion.button>
                      {blobUrl && (
                        <motion.button whileHover={{ scale: 1.02 }} onClick={handleDownload}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                          style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 46%)" }}>
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
                      style={{ background: "hsl(217 28% 7%)", border: "1px solid hsl(217 28% 12%)" }}
                      animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 18px hsl(217 91% 60% / 0.05)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                      transition={{ duration: 4.5, repeat: Infinity }}
                    >
                      <Mic className="w-5 h-5 text-primary/18" />
                    </motion.div>
                    <p className="text-muted-foreground/28 text-xs font-mono">No audio generated yet</p>
                    <p className="text-[10px] text-muted-foreground/16 font-mono">
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
  );
};

export default VoiceOverStudioPage;
