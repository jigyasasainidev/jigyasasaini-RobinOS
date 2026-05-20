import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Video, Download, Loader2, Lock, Film, Ratio, Palette } from "lucide-react";
import { toast } from "sonner";
import { useByokAccess, useProfile, useTierLevel } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";

const aspectRatios = [
  { value: "9:16", label: "9:16 (Reels/Shorts)", default: true },
  { value: "16:9", label: "16:9 (YouTube)" },
  { value: "1:1", label: "1:1 (Square)" },
];

const bgStyles = [
  { value: "cinematic", label: "Cinematic" },
  { value: "minimal", label: "Minimal" },
  { value: "neon", label: "Neon Glow" },
  { value: "nature", label: "Nature" },
  { value: "abstract", label: "Abstract" },
];

const VideoStudioPage = () => {
  const { data: profile } = useProfile();
  const tier = useTierLevel();
  const { data: byokEnabled } = useByokAccess();
  const isTierEligible = tier === "pro_creator" || tier === "agency" || tier === "scale_agency";
  const isProOrAbove = byokEnabled ?? isTierEligible;
  const hasVideoKey = !!(profile as any)?.video_api_key;

  const [script, setScript] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [bgStyle, setBgStyle] = useState("cinematic");
  const [voiceOverlay, setVoiceOverlay] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleGenerate = async () => {
    if (!script.trim()) { toast.error("Paste your script first"); return; }
    if (!isProOrAbove) { setShowUpgrade(true); return; }
    if (!hasVideoKey) { toast.error("Add your Replicate API key in Settings → API Keys"); return; }

    setGenerating(true);
    setVideoUrl(null);
    setProgress(0);

    // Progress simulation
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) { clearInterval(progressInterval); return 90; }
        return prev + Math.random() * 8;
      });
    }, 3000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Build a concise prompt from script + style
      const prompt = `${bgStyle} style video: ${script.slice(0, 400)}`;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-video`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ prompt, aspect_ratio: aspectRatio }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Video generation failed");

      if (data.status === "succeeded" && data.video_url) {
        clearInterval(progressInterval);
        setProgress(100);
        setVideoUrl(data.video_url);
        toast.success("Video generated!");
        setGenerating(false);
        return;
      }

      // Poll for completion
      if (data.prediction_id) {
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poll-video`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                },
                body: JSON.stringify({ prediction_id: data.prediction_id }),
              }
            );
            const pollData = await pollRes.json();

            if (pollData.status === "succeeded" && pollData.video_url) {
              clearInterval(pollRef.current!);
              clearInterval(progressInterval);
              setProgress(100);
              setVideoUrl(pollData.video_url);
              toast.success("Video generated!");
              setGenerating(false);
            } else if (pollData.status === "failed") {
              clearInterval(pollRef.current!);
              clearInterval(progressInterval);
              toast.error(pollData.error || "Video generation failed");
              setGenerating(false);
            } else {
              setProgress(prev => Math.min(prev + 5, 90));
            }
          } catch {
            clearInterval(pollRef.current!);
            clearInterval(progressInterval);
            toast.error("Polling failed");
            setGenerating(false);
          }
        }, 5000);
      } else {
        clearInterval(progressInterval);
        toast.error("No prediction ID returned");
        setGenerating(false);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      toast.error(err.message || "Video generation failed");
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "video.mp4";
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="pt-14 md:pt-0">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Film className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">AI Video</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Content Engine</h1>
          <Badge variant="outline" className={`text-[10px] font-mono ${isProOrAbove ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}>
            {isProOrAbove ? "UNLIMITED (BYOK)" : "PRO CREATOR+ ONLY"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Transform your scripts into viral-ready videos with AI (Replicate).</p>
      </div>

      {!isProOrAbove ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl">
          <div className="rounded-xl border border-border/50 bg-card/30 p-8 text-center">
            <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-foreground font-medium text-sm mb-2">Content Engine is for Pro Creator & Agency</h3>
            <p className="text-muted-foreground text-xs mb-6">Upgrade to Pro Creator or Agency to unlock video generation using your own Replicate API key.</p>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowUpgrade(true)} className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium glow-blue">
              Upgrade Now
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
          <div className="space-y-5">
            {!hasVideoKey && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">Add your Replicate API key in <span className="font-mono">Settings → API Keys</span></p>
              </div>
            )}

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Script / Prompt</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Describe your video scene or paste a script prompt..."
                className="w-full min-h-[180px] max-h-[350px] rounded-lg border border-border bg-secondary p-4 text-sm text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1.5">
                <Ratio className="w-3 h-3" /> Aspect Ratio
              </label>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map((ar) => (
                  <button
                    key={ar.value}
                    onClick={() => setAspectRatio(ar.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      aspectRatio === ar.value
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
                    }`}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1.5">
                <Palette className="w-3 h-3" /> Style
              </label>
              <div className="flex flex-wrap gap-2">
                {bgStyles.map((bg) => (
                  <button
                    key={bg.value}
                    onClick={() => setBgStyle(bg.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      bgStyle === bg.value
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary p-3">
              <div className="flex items-center gap-2">
                <Video className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-foreground">Voice Overlay</span>
              </div>
              <button
                onClick={() => setVoiceOverlay(!voiceOverlay)}
                className={`w-10 h-5 rounded-full transition-all ${voiceOverlay ? "bg-primary" : "bg-border"}`}
              >
                <motion.div
                  className="w-4 h-4 rounded-full bg-white shadow-sm"
                  animate={{ x: voiceOverlay ? 22 : 2 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleGenerate}
              disabled={generating || !hasVideoKey}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Video...</> : <><Film className="w-4 h-4" /> Generate Video</>}
            </motion.button>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">Preview</label>
            <div className="rounded-lg border-glass bg-card p-6 min-h-[300px] flex flex-col items-center justify-center">
              {generating ? (
                <div className="w-full space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <motion.div
                      className="w-16 h-16 rounded-full border-2 border-primary/30 border-t-primary"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    />
                    <p className="text-xs font-mono text-muted-foreground">Processing video...</p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-border overflow-hidden">
                    <motion.div
                      className="h-full bg-primary rounded-full"
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 font-mono text-center">{Math.round(progress)}% complete</p>
                </div>
              ) : videoUrl ? (
                <div className="w-full space-y-4">
                  <video src={videoUrl} controls className="w-full rounded-lg" />
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={handleDownload}
                    className="w-full py-2.5 rounded-lg border border-border text-foreground text-xs font-medium flex items-center justify-center gap-2 hover:border-primary/40 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Download MP4
                  </motion.button>
                </div>
              ) : (
                <div className="text-center">
                  <Film className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-muted-foreground/40 text-xs font-mono">Generated video will appear here</p>
                  <p className="text-[10px] text-muted-foreground/30 font-mono mt-2">Powered by Replicate (Stable Video Diffusion)</p>
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

export default VideoStudioPage;
