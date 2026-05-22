import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, Play, Pause, Download, Loader2, Lock, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useByokAccess, useProfile, useTierLevel } from "@/hooks/useProfile";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

const voices = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", style: "Warm & Natural" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", style: "Authoritative" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", style: "Soft & Clear" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", style: "Energetic" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", style: "Deep & Calm" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", style: "Friendly" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", style: "Professional" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", style: "Conversational" },
];

const VoiceOverStudioPage = () => {
  const { data: profile } = useProfile();
  const tier = useTierLevel();
  const { data: byokEnabled } = useByokAccess();
  const isTierEligible = tier === "pro_creator" || tier === "agency" || tier === "scale_agency";
  const isProOrAbove = byokEnabled ?? isTierEligible;
  const hasKey = !!profile?.elevenlabs_api_key;

  const [script, setScript] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleGenerate = async () => {
    if (!script.trim()) { toast.error("Paste your script first"); return; }
    if (!isProOrAbove) { setShowUpgrade(true); return; }
    if (!hasKey) { toast.error("Add your ElevenLabs API key in Settings → API Keys"); return; }
    if (script.length > 5000) { toast.error("Script must be under 5000 characters"); return; }

    setGenerating(true);
    setAudioUrl(null);

    try {
      // ─── Use supabase.functions.invoke() for binary (audio) response ───
      const { data, error: invokeError } = await supabase.functions.invoke("elevenlabs-tts", {
        body: { text: script, voiceId: selectedVoice },
      });

      if (invokeError) {
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (invokeError as any)?.context?.responseText ?? (invokeError as any)?.message ?? "";
          parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
        } catch { /* keep empty */ }
        throw new Error(String(parsed.message ?? parsed.error ?? invokeError.message ?? "Voice generation failed"));
      }

      if (!data) throw new Error("No audio data returned");

      // functions.invoke returns the raw body — convert to blob URL
      const blob = data instanceof Blob ? data : new Blob([data], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      toast.success("Voice over generated!");
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    }
    setGenerating(false);
  };

  const togglePlay = () => {
    if (!audioUrl) return;
    if (audioElement) {
      if (isPlaying) {
        audioElement.pause();
        setIsPlaying(false);
      } else {
        audioElement.play();
        setIsPlaying(true);
      }
    } else {
      const audio = new Audio(audioUrl);
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setAudioElement(audio);
      setIsPlaying(true);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "voiceover.mp3";
    a.click();
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
          <Badge variant="outline" className={`text-[10px] font-mono ${isProOrAbove ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}>
            {isProOrAbove ? "UNLIMITED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Generate professional voice overs from your scripts using ElevenLabs.</p>
      </div>

      {!isProOrAbove ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
          <div className="rounded-xl border border-border/50 bg-card/30 p-8 text-center">
            <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-foreground font-medium text-sm mb-2">Voice Engine is for Pro Creator & Agency</h3>
            <p className="text-muted-foreground text-xs mb-6">Upgrade to Pro Creator or Agency to unlock unlimited voice generation using your own ElevenLabs API key.</p>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowUpgrade(true)} className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium glow-blue">
              Upgrade Now
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
          {/* Input Panel */}
          <div className="space-y-5">
            {!hasKey && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">Add your ElevenLabs API key in <span className="font-mono">Settings → API Keys</span></p>
              </div>
            )}

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Script</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your script here (max 5000 characters)..."
                className="w-full min-h-[200px] max-h-[400px] rounded-lg border border-border bg-secondary p-4 text-sm text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono text-right">{script.length}/5000</p>
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Voice</label>
              <div className="grid grid-cols-2 gap-2">
                {voices.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSelectedVoice(voice.id)}
                    className={`px-3 py-2.5 rounded-lg text-left transition-all ${
                      selectedVoice === voice.id
                        ? "bg-primary/15 border border-primary/30"
                        : "bg-secondary border border-border hover:border-border/80"
                    }`}
                  >
                    <p className={`text-xs font-medium ${selectedVoice === voice.id ? "text-primary" : "text-foreground"}`}>{voice.name}</p>
                    <p className="text-[10px] text-muted-foreground">{voice.style}</p>
                  </button>
                ))}
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleGenerate}
              disabled={generating || !hasKey}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Volume2 className="w-4 h-4" /> Generate Voice Over</>}
            </motion.button>
          </div>

          {/* Output Panel */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Output</label>
            <div className="rounded-lg border-glass bg-card p-6 min-h-[300px] flex flex-col items-center justify-center">
              {generating ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-primary rounded-full"
                        animate={{ height: [12, 32, 12] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">Generating audio...</p>
                </div>
              ) : audioUrl ? (
                <div className="w-full space-y-6">
                  <div className="flex items-center justify-center gap-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={togglePlay}
                      className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-blue"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </motion.button>
                  </div>

                  {/* Waveform visualization */}
                  <div className="flex items-center justify-center gap-[2px] h-12">
                    {[...Array(40)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-[3px] bg-primary/40 rounded-full"
                        animate={isPlaying ? { height: [4, Math.random() * 40 + 8, 4] } : { height: 4 }}
                        transition={{ duration: 0.4 + Math.random() * 0.4, repeat: isPlaying ? Infinity : 0, delay: i * 0.02 }}
                      />
                    ))}
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={handleDownload}
                    className="w-full py-2.5 rounded-lg border border-border text-foreground text-xs font-medium flex items-center justify-center gap-2 hover:border-primary/40 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Download MP3
                  </motion.button>
                </div>
              ) : (
                <div className="text-center">
                  <Mic className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-muted-foreground/40 text-xs font-mono">Generated audio will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default VoiceOverStudioPage;
