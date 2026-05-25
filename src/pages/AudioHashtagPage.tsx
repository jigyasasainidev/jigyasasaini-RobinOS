import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Music, Hash, Loader2, Copy, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useIsProOrAbove } from "@/hooks/useEntitlements";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import {
  getTrendingAudio,
  getTrendingHashtags,
  isEntitlementError,
  type Platform as IdeaPlatform,
  type TrendAudio,
  type TrendHashtag,
} from "@/services/ideaStream";

// ── Types ──────────────────────────────────────────────────
type ScanMode = "audio" | "hashtags";

const PLATFORMS: IdeaPlatform[] = ["Instagram", "TikTok", "Facebook", "YouTube"];

const velocityClass = (v?: string) => {
  if (v === "exploding") return "border-red-500/30 text-red-400";
  if (v === "hot")       return "border-amber-500/30 text-amber-400";
  if (v === "rising")    return "border-emerald-500/30 text-emerald-400";
  return "border-border/30 text-muted-foreground/50";
};

// ── Page ───────────────────────────────────────────────────
const AudioHashtagPage = () => {
  const isProOrAbove = useIsProOrAbove();

  const [platform,   setPlatform]   = useState<IdeaPlatform>("Instagram");
  const [scanning,   setScanning]   = useState(false);
  const [scanned,    setScanned]    = useState(false);
  const [scanMode,   setScanMode]   = useState<ScanMode | null>(null);
  const [audios,     setAudios]     = useState<TrendAudio[]>([]);
  const [hashtags,   setHashtags]   = useState<TrendHashtag[]>([]);
  const [showUpgrade,setShowUpgrade]= useState(false);
  const [copiedKey,  setCopiedKey]  = useState<string | null>(null);

  const handleScan = async (mode: ScanMode) => {
    setScanMode(mode);
    setScanning(true);
    setScanned(false);

    if (mode === "audio") {
      const res = await getTrendingAudio(platform);
      if (!res.ok) {
        if (isEntitlementError(res)) { toast.error(res.message); setShowUpgrade(true); }
        else toast.error("Could not load trending audio. Try again.");
        setAudios([]);
      } else {
        setAudios(res.audios);
        setHashtags([]);
      }
    } else {
      const res = await getTrendingHashtags(platform);
      if (!res.ok) {
        if (isEntitlementError(res)) { toast.error(res.message); setShowUpgrade(true); }
        else toast.error("Could not load trending hashtags. Try again.");
        setHashtags([]);
      } else {
        setHashtags(res.hashtags);
        setAudios([]);
      }
    }

    setScanning(false);
    setScanned(true);
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 1400);
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="pt-14 md:pt-0">

      {/* ── Page Header ──────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Music className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Creator Intelligence</span>
        </div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Trending Audio & Hashtags</h1>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-border/50 bg-card/40 text-[11px] font-mono text-muted-foreground">
            <Music className="w-3 h-3 text-primary/70" />
            Audio: {audios.length}/200
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-border/50 bg-card/40 text-[11px] font-mono text-muted-foreground">
            <Hash className="w-3 h-3 text-primary/70" />
            Hashtags: {hashtags.length}/200
          </span>
          {isProOrAbove && (
            <Badge variant="outline" className="text-[9px] font-mono border-primary/30 text-primary py-0.5 px-2">
              Pro Creator
            </Badge>
          )}
        </div>

        <p className="text-muted-foreground text-sm">Discover what's trending on your platform right now.</p>
      </div>

      {/* ── Controls ─────────────────────────────────────── */}
      <div className="glass-card p-5 mb-6 space-y-4">
        {/* Platform selector */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60 mb-2.5">Platform</p>
          <div className="flex gap-2 flex-wrap">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-4 py-2 rounded-lg text-xs font-medium border transition-all ${
                  platform === p
                    ? "bg-primary/10 text-primary border-primary/30 shadow-[0_0_12px_hsl(217_91%_60%/0.1)]"
                    : "text-muted-foreground border-border/50 hover:text-foreground hover:bg-sidebar-accent/60"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 flex-wrap">
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => handleScan("audio")}
            disabled={scanning}
            className="btn-primary shimmer-btn !py-2.5 !px-5 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {scanning && scanMode === "audio"
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Audio...</>
              : <><Music className="w-4 h-4" /> Find Trending Audio</>
            }
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => handleScan("hashtags")}
            disabled={scanning}
            className="btn-secondary !py-2.5 !px-5 text-sm flex items-center gap-2 disabled:opacity-50 border border-border/60 hover:border-primary/30"
          >
            {scanning && scanMode === "hashtags"
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Hashtags...</>
              : <><Hash className="w-4 h-4" /> Find Trending Hashtags</>
            }
          </motion.button>
        </div>
      </div>

      {/* ── Dynamic content area ──────────────────────────── */}
      <AnimatePresence mode="wait">
        {/* Scanning state */}
        {scanning && (
          <motion.div key="scanning"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 gap-5"
          >
            <div className="relative flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border border-primary/20 bg-primary/5 flex items-center justify-center">
                {scanMode === "audio"
                  ? <Music className="w-6 h-6 text-primary/60" />
                  : <Hash  className="w-6 h-6 text-primary/60" />
                }
              </div>
              <motion.div
                className="absolute inset-0 rounded-full border border-primary/30"
                animate={{ scale: [1, 1.6, 1.6], opacity: [0.6, 0, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border border-primary/15"
                animate={{ scale: [1, 2, 2], opacity: [0.4, 0, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 0.35 }}
              />
            </div>
            <div className="text-center">
              <p className="text-sm text-foreground/80 font-medium">
                Scanning {platform} for trending {scanMode === "audio" ? "audio" : "hashtags"}
              </p>
              <p className="text-xs text-muted-foreground/55 mt-1 font-mono">Pulling live signals...</p>
            </div>
          </motion.div>
        )}

        {/* Audio results */}
        {!scanning && scanned && scanMode === "audio" && audios.length > 0 && (
          <motion.div key="audio-results"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">
              {audios.length} trending tracks · {platform}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {audios.map((audio, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="glass-card p-4 flex flex-col gap-3"
                >
                  {/* Title + copy */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground/90 truncate">{audio.title}</p>
                      <p className="text-xs text-muted-foreground/65 truncate mt-0.5">{audio.artist}</p>
                    </div>
                    <button
                      onClick={() => copyText(`${audio.title} by ${audio.artist}`, `audio-${i}`)}
                      className="shrink-0 w-7 h-7 rounded-md border border-border/50 bg-card/40 flex items-center justify-center hover:border-primary/30 hover:bg-primary/8 transition-all"
                    >
                      {copiedKey === `audio-${i}`
                        ? <Check className="w-3.5 h-3.5 text-primary" />
                        : <Copy className="w-3.5 h-3.5 text-muted-foreground/55" />
                      }
                    </button>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {audio.velocity && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${velocityClass(audio.velocity)}`}>
                        {audio.velocity}
                      </span>
                    )}
                    {audio.trend && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/50">
                        {audio.trend}
                      </span>
                    )}
                    {audio.category && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/50 truncate max-w-[130px]">
                        {audio.category}
                      </span>
                    )}
                  </div>

                  {/* Uses + Tip */}
                  <div className="space-y-1.5">
                    {audio.uses && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-muted-foreground/45">Uses</span>
                        <span className="text-[10px] text-primary/75 font-mono">{audio.uses}</span>
                      </div>
                    )}
                    {audio.tip && (
                      <p className="text-[10px] text-muted-foreground/55 leading-relaxed line-clamp-2">{audio.tip}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Hashtag results */}
        {!scanning && scanned && scanMode === "hashtags" && hashtags.length > 0 && (
          <motion.div key="hashtag-results"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">
              {hashtags.length} trending hashtags · {platform}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hashtags.map((tag, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="glass-card p-4 flex flex-col gap-3"
                >
                  {/* Tag + copy */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground/90 truncate">{tag.tag}</p>
                      <p className="text-xs text-muted-foreground/65 truncate mt-0.5">{tag.posts}</p>
                    </div>
                    <button
                      onClick={() => copyText(tag.tag, `tag-${i}`)}
                      className="shrink-0 w-7 h-7 rounded-md border border-border/50 bg-card/40 flex items-center justify-center hover:border-primary/30 hover:bg-primary/8 transition-all"
                    >
                      {copiedKey === `tag-${i}`
                        ? <Check className="w-3.5 h-3.5 text-primary" />
                        : <Copy className="w-3.5 h-3.5 text-muted-foreground/55" />
                      }
                    </button>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {tag.velocity && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${velocityClass(tag.velocity)}`}>
                        {tag.velocity}
                      </span>
                    )}
                    {tag.trend && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/50">
                        {tag.trend}
                      </span>
                    )}
                    {tag.category && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/50 truncate max-w-[130px]">
                        {tag.category}
                      </span>
                    )}
                  </div>

                  {/* Tip */}
                  {tag.tip && (
                    <p className="text-[10px] text-muted-foreground/55 leading-relaxed line-clamp-2">{tag.tip}</p>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Empty state after scan */}
        {!scanning && scanned &&
          ((scanMode === "audio" && audios.length === 0) ||
           (scanMode === "hashtags" && hashtags.length === 0)) && (
          <motion.div key="empty"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 gap-3"
          >
            <p className="text-muted-foreground/50 text-sm font-mono">No results found. Try a different platform.</p>
          </motion.div>
        )}

        {/* Idle state */}
        {!scanning && !scanned && (
          <motion.div key="idle"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 gap-4"
          >
            <div className="w-14 h-14 rounded-2xl border border-border/40 bg-card/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-muted-foreground/35" />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground/55">Select a platform and discover what's trending</p>
              <p className="text-xs text-muted-foreground/35 mt-1 font-mono">Audio signals · Viral hashtags · Creator insights</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default AudioHashtagPage;
