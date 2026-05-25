import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Play, Pause, Download, Loader2, Lock, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useIsVoiceEnabled, useIsByokEnabled } from "@/hooks/useEntitlements";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

// ── Edge function base URL ─────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const TTS_ENDPOINT = `${SUPABASE_URL}/functions/v1/elevenlabs-tts`;

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

// ── Playback state machine ─────────────────────────────────
type AudioStatus = "idle" | "generating" | "preparing" | "ready" | "playing" | "error";

const VoiceOverStudioPage = () => {
  const { data: profile }  = useProfile();
  const isVoiceEnabled     = useIsVoiceEnabled();
  const isByokEnabled      = useIsByokEnabled();
  const hasKey             = isByokEnabled && !!profile?.elevenlabs_api_key;

  const [script,        setScript]        = useState("");
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [audioStatus,   setAudioStatus]   = useState<AudioStatus>("idle");
  const [blobUrl,       setBlobUrl]       = useState<string | null>(null);
  const [showUpgrade,   setShowUpgrade]   = useState(false);

  // Native audio element ref — single instance, no re-creation on re-render
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track current blob URL for revoke on next generation
  const prevBlobUrl = useRef<string | null>(null);

  // ── Cleanup blob URLs on unmount ──────────────────────────
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
      if (blobUrl)             URL.revokeObjectURL(blobUrl);
      audioRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wire audio element events whenever blobUrl changes ────
  const bindAudio = useCallback((url: string) => {
    // Tear down old element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended     = null;
      audioRef.current.oncanplay   = null;
      audioRef.current.onerror     = null;
      audioRef.current.src         = "";
      audioRef.current.load();
    }

    const audio = new Audio();
    audio.preload = "auto";

    // canplay fires once enough data is buffered to start
    audio.oncanplay = () => {
      console.debug("[voice] audio canplay — readyState:", audio.readyState, "src:", audio.src);
      setAudioStatus("ready");
    };

    audio.onended = () => {
      setAudioStatus("ready");
    };

    audio.onerror = (e) => {
      console.error("[voice] audio element error", e, "readyState:", audio.readyState, "networkState:", audio.networkState);
      setAudioStatus("error");
      toast.error("Audio playback failed. Try regenerating.");
    };

    // Assign AFTER hooking events — prevents premature load
    audio.src = url;
    audio.load();

    console.debug("[voice] bound new audio element — src:", url, "readyState:", audio.readyState);
    audioRef.current = audio;
    setAudioStatus("preparing");
  }, []);

  // ── Generate ───────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!script.trim())                { toast.error("Paste your script first");                                           return; }
    if (!isVoiceEnabled)               { setShowUpgrade(true);                                                             return; }
    if (!hasKey)                       { toast.error("Add your ElevenLabs API key in Settings → API Keys");               return; }
    if (script.length > 5000)         { toast.error("Script must be under 5000 characters");                              return; }
    if (audioStatus === "generating")  { return; /* prevent double-tap */ }

    // Revoke previous blob to free memory
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    setBlobUrl(null);
    setAudioStatus("generating");

    try {
      // ── Get auth token ─────────────────────────────────────
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Not authenticated — please log in again.");

      console.debug("[voice] calling TTS endpoint:", TTS_ENDPOINT);

      // ── Raw fetch — required for binary (audio/mpeg) response ──
      const response = await fetch(TTS_ENDPOINT, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ text: script, voiceId: selectedVoice }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      console.debug("[voice] response status:", response.status, "content-type:", contentType);

      if (!response.ok) {
        // Error responses come back as JSON
        let msg = `Voice generation failed (${response.status})`;
        try {
          const errJson = await response.json();
          msg = errJson.error ?? errJson.message ?? msg;
        } catch { /* use default msg */ }
        throw new Error(msg);
      }

      // ── Validate we got audio, not an accidental JSON body ──
      if (!contentType.includes("audio")) {
        // Try to read it as text for debugging
        const body = await response.text();
        console.error("[voice] unexpected content-type:", contentType, "body:", body.slice(0, 200));
        throw new Error("Server returned unexpected content. Check ElevenLabs API key.");
      }

      const arrayBuffer = await response.arrayBuffer();
      console.debug("[voice] received arrayBuffer — byteLength:", arrayBuffer.byteLength);

      if (arrayBuffer.byteLength === 0) {
        throw new Error("Received empty audio data from server.");
      }

      const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      const url  = URL.createObjectURL(blob);
      console.debug("[voice] blob created — size:", blob.size, "blobUrl:", url);

      prevBlobUrl.current = url;
      setBlobUrl(url);
      bindAudio(url);
      // status → "preparing" → "ready" driven by canplay event

      toast.success("Voice over generated!");

    } catch (err: any) {
      console.error("[voice] generation error:", err);
      setAudioStatus("error");
      toast.error(err.message || "Voice generation failed. Try again.");
    }
  };

  // ── Playback toggle ────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;

    if (audioStatus === "playing") {
      audio.pause();
      setAudioStatus("ready");
    } else if (audioStatus === "ready") {
      try {
        setAudioStatus("playing");
        await audio.play();
        console.debug("[voice] playback started — readyState:", audio.readyState);
      } catch (err: any) {
        console.error("[voice] play() rejected:", err.name, err.message);
        setAudioStatus("ready");
        if (err.name === "NotSupportedError") {
          toast.error("Audio format not supported by your browser. Try downloading instead.");
        } else if (err.name === "NotAllowedError") {
          toast.error("Browser blocked autoplay. Click play to start.");
        } else {
          toast.error("Playback error: " + err.message);
        }
      }
    }
  };

  // ── Download ───────────────────────────────────────────────
  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href     = blobUrl;
    a.download = "robinos-voiceover.mp3";
    a.click();
  };

  const isGenerating = audioStatus === "generating";
  const isPreparing  = audioStatus === "preparing";
  const isPlaying    = audioStatus === "playing";
  const hasAudio     = audioStatus === "ready" || audioStatus === "playing";
  const isError      = audioStatus === "error";

  const statusLabel: Record<AudioStatus, string> = {
    idle:       "No audio generated yet.",
    generating: "Generating voice...",
    preparing:  "Preparing audio...",
    ready:      "Ready to play",
    playing:    "Playing",
    error:      "Playback error — try regenerating.",
  };

  return (
    <div className="pt-14 md:pt-0">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Mic className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">AI Voice</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Voice Engine</h1>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${isVoiceEnabled ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}
          >
            {isVoiceEnabled ? "ENABLED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Generate professional voice overs from your scripts using ElevenLabs.
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
              Upgrade to Pro Creator or Agency to unlock unlimited voice generation using your own ElevenLabs API key.
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

          {/* ── Input panel ────────────────────────────────── */}
          <div className="space-y-5">
            {!hasKey && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">
                  Add your ElevenLabs API key in <span className="font-mono">Settings → API Keys</span>
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Script</label>
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
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Voice</label>
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
                    <p className={`text-xs font-medium ${selectedVoice === voice.id ? "text-primary" : "text-foreground"}`}>
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

          {/* ── Output panel ───────────────────────────────── */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Output</label>
            <div className="rounded-lg border-glass bg-card p-6 min-h-[300px] flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">

                {/* Generating — waveform pulse */}
                {isGenerating && (
                  <motion.div key="generating"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <div className="flex gap-1 items-end h-10">
                      {[...Array(7)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[3px] bg-primary rounded-full"
                          animate={{ height: [6, 28 + (i % 3) * 10, 6] }}
                          transition={{ duration: 0.7 + i * 0.05, repeat: Infinity, delay: i * 0.1 }}
                        />
                      ))}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">Generating voice...</p>
                  </motion.div>
                )}

                {/* Preparing — lighter shimmer */}
                {isPreparing && (
                  <motion.div key="preparing"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <motion.div
                      className="w-10 h-10 rounded-full border border-primary/30 bg-primary/8"
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    <p className="text-xs font-mono text-muted-foreground">Preparing audio...</p>
                  </motion.div>
                )}

                {/* Ready / Playing */}
                {hasAudio && (
                  <motion.div key="ready"
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="w-full space-y-6"
                  >
                    {/* Status label */}
                    <p className="text-center text-[10px] font-mono text-muted-foreground/50">
                      {statusLabel[audioStatus]}
                    </p>

                    {/* Play button */}
                    <div className="flex items-center justify-center">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={togglePlay}
                        className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-blue"
                      >
                        {isPlaying
                          ? <Pause className="w-5 h-5" />
                          : <Play  className="w-5 h-5 ml-0.5" />
                        }
                      </motion.button>
                    </div>

                    {/* Waveform */}
                    <div className="flex items-center justify-center gap-[2px] h-12">
                      {[...Array(40)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[3px] bg-primary/40 rounded-full"
                          animate={isPlaying
                            ? { height: [4, 8 + (i % 5) * 8, 4] }
                            : { height: 4 }
                          }
                          transition={{
                            duration:  0.4 + (i % 7) * 0.06,
                            repeat:    isPlaying ? Infinity : 0,
                            delay:     i * 0.02,
                            ease:      "easeInOut",
                          }}
                        />
                      ))}
                    </div>

                    {/* Download */}
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={handleDownload}
                      className="w-full py-2.5 rounded-lg border border-border text-foreground text-xs font-medium flex items-center justify-center gap-2 hover:border-primary/40 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" /> Download MP3
                    </motion.button>
                  </motion.div>
                )}

                {/* Error state */}
                {isError && (
                  <motion.div key="error"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center space-y-2"
                  >
                    <p className="text-xs text-red-400/80 font-mono">Playback error — try regenerating.</p>
                    {blobUrl && (
                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        onClick={handleDownload}
                        className="text-xs text-muted-foreground/50 underline underline-offset-2 hover:text-muted-foreground"
                      >
                        Download audio instead
                      </motion.button>
                    )}
                  </motion.div>
                )}

                {/* Idle */}
                {audioStatus === "idle" && (
                  <motion.div key="idle"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center"
                  >
                    <Mic className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-muted-foreground/40 text-xs font-mono">No audio generated yet.</p>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default VoiceOverStudioPage;
