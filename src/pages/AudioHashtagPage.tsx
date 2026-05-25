import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Music, Hash, Loader2, Copy, Check, Sparkles,
  Bookmark, BookmarkCheck, Zap, Radio, Globe, Wifi, TrendingUp,
} from "lucide-react";
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

// ── Constants ──────────────────────────────────────────────
type ScanMode = "audio" | "hashtags";

const PLATFORMS: IdeaPlatform[] = ["Instagram", "TikTok", "Facebook", "YouTube"];
const STORAGE_KEY  = "robinos_audio_hashtag_v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const AUDIO_MSGS = [
  "Scanning creator audio signals...",
  "Analyzing trending sound velocity...",
  "Detecting rising audio patterns...",
  "Mapping platform music momentum...",
  "Calibrating audio intelligence...",
  "Pulling viral creator tracks...",
];
const HASHTAG_MSGS = [
  "Scanning trending hashtag signals...",
  "Analyzing hashtag velocity...",
  "Detecting viral tag patterns...",
  "Mapping hashtag momentum...",
  "Calibrating hashtag intelligence...",
  "Pulling viral creator tags...",
];
const SCAN_ICONS = [Zap, Radio, Globe, Wifi, Sparkles, Music, Hash, TrendingUp];

// ── Persistence ────────────────────────────────────────────
interface StoredState {
  platform:      IdeaPlatform;
  scanMode:      ScanMode | null;
  audios:        TrendAudio[];
  hashtags:      TrendHashtag[];
  savedAudios:   string[];
  savedHashtags: string[];
  timestamp:     number;
}

function loadStored(): Partial<StoredState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p: StoredState = JSON.parse(raw);
    const stale = Date.now() - (p.timestamp ?? 0) > CACHE_TTL_MS;
    return {
      platform:      p.platform,
      scanMode:      p.scanMode,
      audios:        stale ? [] : (p.audios   ?? []),
      hashtags:      stale ? [] : (p.hashtags ?? []),
      savedAudios:   p.savedAudios   ?? [],
      savedHashtags: p.savedHashtags ?? [],
    };
  } catch { return {}; }
}

function persist(s: StoredState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /**/ }
}

// ── Velocity config ────────────────────────────────────────
const VEL_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  exploding: { label: "Exploding",  color: "hsl(0 80% 65%)",     bg: "hsl(0 80% 55% / 0.08)",     border: "hsl(0 80% 55% / 0.25)"     },
  hot:       { label: "Hot",        color: "hsl(38 90% 60%)",    bg: "hsl(38 90% 55% / 0.08)",    border: "hsl(38 90% 55% / 0.25)"    },
  rising:    { label: "Rising",     color: "hsl(142 65% 55%)",   bg: "hsl(142 65% 50% / 0.08)",   border: "hsl(142 65% 50% / 0.25)"   },
  stable:    { label: "Stable",     color: "hsl(215 16% 45%)",   bg: "hsl(217 28% 10%)",          border: "hsl(217 28% 16%)"          },
};
const getVel = (v?: string) => VEL_CFG[v ?? ""] ?? VEL_CFG.stable;

// ── Main page ──────────────────────────────────────────────
const AudioHashtagPage = () => {
  const isProOrAbove = useIsProOrAbove();
  const init = useRef(loadStored());

  const [platform,      setPlatform]      = useState<IdeaPlatform>(init.current.platform ?? "Instagram");
  const [scanning,      setScanning]      = useState(false);
  const [scanned,       setScanned]       = useState(!!(init.current.audios?.length || init.current.hashtags?.length));
  const [scanMode,      setScanMode]      = useState<ScanMode | null>(init.current.scanMode ?? null);
  const [audios,        setAudios]        = useState<TrendAudio[]>(init.current.audios ?? []);
  const [hashtags,      setHashtags]      = useState<TrendHashtag[]>(init.current.hashtags ?? []);
  const [savedAudios,   setSavedAudios]   = useState<Set<string>>(new Set(init.current.savedAudios ?? []));
  const [savedHashtags, setSavedHashtags] = useState<Set<string>>(new Set(init.current.savedHashtags ?? []));
  const [showUpgrade,   setShowUpgrade]   = useState(false);
  const [copiedKey,     setCopiedKey]     = useState<string | null>(null);
  const [msgIdx,        setMsgIdx]        = useState(0);
  const [iconIdx,       setIconIdx]       = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    persist({
      platform, scanMode, audios, hashtags,
      savedAudios:   Array.from(savedAudios),
      savedHashtags: Array.from(savedHashtags),
      timestamp: Date.now(),
    });
  }, [platform, scanMode, audios, hashtags, savedAudios, savedHashtags]);

  const handleScan = async (mode: ScanMode) => {
    setScanMode(mode);
    setScanning(true);
    setScanned(false);
    setMsgIdx(0);
    setIconIdx(0);

    let m = 0, ic = 0;
    const msgs = mode === "audio" ? AUDIO_MSGS : HASHTAG_MSGS;
    timerRef.current = setInterval(() => {
      m  = (m  + 1) % msgs.length;
      ic = (ic + 1) % SCAN_ICONS.length;
      setMsgIdx(m);
      setIconIdx(ic);
    }, 1100);

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

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setScanning(false);
    setScanned(true);
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied");
    setTimeout(() => setCopiedKey(null), 1400);
  };

  const toggleSaveAudio = (audio: TrendAudio) => {
    const k = `${audio.title}|${audio.artist}`;
    setSavedAudios(prev => {
      const s = new Set(prev);
      if (s.has(k)) { s.delete(k); toast.success("Removed"); }
      else           { s.add(k);    toast.success("Saved");   }
      return s;
    });
  };

  const toggleSaveHashtag = (tag: TrendHashtag) => {
    setSavedHashtags(prev => {
      const s = new Set(prev);
      if (s.has(tag.tag)) { s.delete(tag.tag); toast.success("Removed"); }
      else                 { s.add(tag.tag);    toast.success("Saved");   }
      return s;
    });
  };

  const msgs = scanMode === "audio" ? AUDIO_MSGS : HASHTAG_MSGS;

  return (
    <div className="relative pt-14 md:pt-0">

      {/* Atmospheric depth */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute top-[-15%] left-[5%] w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.05) 0%, transparent 65%)" }} />
        <div className="absolute bottom-[5%] right-[-5%] w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.03) 0%, transparent 65%)" }} />
        <motion.div
          className="absolute top-[35%] left-1/2 -translate-x-1/2 w-[900px] h-[300px] rounded-full"
          style={{ background: "radial-gradient(ellipse, hsl(217 91% 60% / 0.025) 0%, transparent 70%)" }}
          animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.04, 1] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative z-10">

        {/* Page header */}
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-1.5">
            <Music className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground/55">
              Creator Intelligence
            </span>
          </div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h1 className="text-chrome text-2xl md:text-3xl font-semibold">
              Trending Audio & Hashtags
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <motion.span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 68%)" }}
              animate={{ boxShadow: audios.length > 0
                ? ["0 0 0 hsl(217 91% 60% / 0)", "0 0 12px hsl(217 91% 60% / 0.12)", "0 0 0 hsl(217 91% 60% / 0)"]
                : "none" }}
              transition={{ duration: 3, repeat: Infinity }}>
              <Music className="w-3 h-3" /> Audio · {audios.length}
            </motion.span>
            <motion.span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 68%)" }}
              animate={{ boxShadow: hashtags.length > 0
                ? ["0 0 0 hsl(217 91% 60% / 0)", "0 0 12px hsl(217 91% 60% / 0.12)", "0 0 0 hsl(217 91% 60% / 0)"]
                : "none" }}
              transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}>
              <Hash className="w-3 h-3" /> Hashtags · {hashtags.length}
            </motion.span>
            {isProOrAbove && (
              <Badge variant="outline" className="text-[9px] font-mono border-primary/30 text-primary py-0.5 px-2">
                Pro Creator
              </Badge>
            )}
            {(audios.length > 0 || hashtags.length > 0) && (
              <span className="text-[10px] font-mono text-muted-foreground/30">cached · rescan anytime</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="mb-6 rounded-2xl p-5 space-y-5"
          style={{ background: "hsl(222 28% 6% / 0.8)", border: "1px solid hsl(217 28% 12%)", backdropFilter: "blur(12px)" }}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/40 mb-3">Platform</p>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map((p) => (
                <button key={p} onClick={() => setPlatform(p)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border transition-all duration-200"
                  style={platform === p ? {
                    background: "hsl(217 91% 60% / 0.1)",
                    border: "1px solid hsl(217 91% 60% / 0.28)",
                    color: "hsl(217 91% 68%)",
                    boxShadow: "0 0 16px hsl(217 91% 60% / 0.08)",
                  } : {
                    background: "transparent",
                    border: "1px solid hsl(217 28% 15%)",
                    color: "hsl(215 16% 47%)",
                  }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => handleScan("audio")} disabled={scanning}
              className="btn-primary shimmer-btn !py-2.5 !px-6 text-sm flex items-center gap-2 disabled:opacity-40">
              {scanning && scanMode === "audio"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Audio...</>
                : <><Music className="w-4 h-4" /> Find Trending Audio</>}
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => handleScan("hashtags")} disabled={scanning}
              className="px-6 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-40 transition-all duration-200"
              style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 17%)", color: "hsl(215 16% 55%)" }}>
              {scanning && scanMode === "hashtags"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Hashtags...</>
                : <><Hash className="w-4 h-4" /> Find Trending Hashtags</>}
            </motion.button>
          </div>
        </div>

        {/* Dynamic area */}
        <AnimatePresence mode="wait">

          {/* Scanning */}
          {scanning && (
            <motion.div key="scan"
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.2 }}
              className="relative rounded-2xl overflow-hidden flex flex-col items-center justify-center py-24 mb-6"
              style={{ background: "hsl(222 28% 5% / 0.95)", border: "1px solid hsl(217 91% 60% / 0.1)" }}>
              {[0, 1, 2, 3].map((i) => (
                <motion.div key={`r-${i}`} className="absolute rounded-full"
                  style={{ width: 80 + i * 44, height: 80 + i * 44, border: "1px solid hsl(217 91% 60% / 0.08)" }}
                  animate={{ scale: [0.3, 2.8, 3.8], opacity: [0, 0.45, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }} />
              ))}
              <motion.div className="absolute w-48 h-[1px] origin-left"
                style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.55), transparent)" }}
                animate={{ rotate: 360 }} transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }} />
              <motion.div className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center mb-6"
                style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
                animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 30px hsl(217 91% 60% / 0.15)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                transition={{ duration: 2, repeat: Infinity }}>
                {(() => {
                  const Icon = SCAN_ICONS[iconIdx % SCAN_ICONS.length];
                  return (
                    <motion.div key={iconIdx} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
                      <Icon className="w-7 h-7 text-primary" strokeWidth={1.5} />
                    </motion.div>
                  );
                })()}
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.p key={msgIdx}
                  initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                  transition={{ duration: 0.3 }}
                  className="relative z-10 text-sm font-mono text-primary/90 tracking-wider">
                  {msgs[msgIdx]}
                </motion.p>
              </AnimatePresence>
              <p className="relative z-10 mt-2 text-[11px] text-muted-foreground/35 font-mono">Target: {platform}</p>
            </motion.div>
          )}

          {/* ── AUDIO GRID ────────────────────────────────── */}
          {!scanning && scanned && scanMode === "audio" && audios.length > 0 && (
            <motion.div key="audio-results"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-5 px-1">
                <div className="flex items-center gap-2">
                  <motion.div className="w-2 h-2 rounded-full bg-primary/60"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
                  <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-foreground/55">
                    Trending Audio
                  </span>
                  <span className="text-[10px] font-mono text-primary/50">· {platform}</span>
                </div>
                <div className="flex-1 h-px"
                  style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.15), transparent)" }} />
                <span className="text-[10px] font-mono text-muted-foreground/30">{audios.length} tracks</span>
              </div>

              {/* 4-column card grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {audios.map((audio, i) => (
                  <AudioCard
                    key={i} audio={audio} index={i}
                    copiedKey={copiedKey}
                    isSaved={savedAudios.has(`${audio.title}|${audio.artist}`)}
                    copyKey={`audio-${i}`}
                    onCopy={() => copyText(`${audio.title} by ${audio.artist}`, `audio-${i}`)}
                    onSave={() => toggleSaveAudio(audio)}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* ── HASHTAG GRID ──────────────────────────────── */}
          {!scanning && scanned && scanMode === "hashtags" && hashtags.length > 0 && (
            <motion.div key="hashtag-results"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-5 px-1">
                <div className="flex items-center gap-2">
                  <motion.div className="w-2 h-2 rounded-full bg-primary/60"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
                  <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-foreground/55">
                    Trending Hashtags
                  </span>
                  <span className="text-[10px] font-mono text-primary/50">· {platform}</span>
                </div>
                <div className="flex-1 h-px"
                  style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.15), transparent)" }} />
                <span className="text-[10px] font-mono text-muted-foreground/30">{hashtags.length} tags</span>
              </div>

              {/* 4-column card grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {hashtags.map((tag, i) => (
                  <HashtagCard
                    key={i} tag={tag} index={i}
                    copiedKey={copiedKey}
                    isSaved={savedHashtags.has(tag.tag)}
                    copyKey={`tag-${i}`}
                    onCopy={() => copyText(tag.tag, `tag-${i}`)}
                    onSave={() => toggleSaveHashtag(tag)}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* Empty */}
          {!scanning && scanned &&
            ((scanMode === "audio" && audios.length === 0) ||
             (scanMode === "hashtags" && hashtags.length === 0)) && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl"
              style={{ border: "1px solid hsl(217 28% 11%)", background: "hsl(222 28% 5% / 0.4)" }}>
              <Hash className="w-8 h-8 text-muted-foreground/15" />
              <p className="text-sm text-muted-foreground/40 font-mono">No results found. Try a different platform.</p>
            </motion.div>
          )}

          {/* Idle */}
          {!scanning && !scanned && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 gap-6 rounded-2xl"
              style={{ border: "1px dashed hsl(217 28% 12%)", background: "hsl(222 28% 4.5% / 0.4)" }}>
              <motion.div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "hsl(217 28% 7%)", border: "1px solid hsl(217 28% 13%)" }}
                animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 24px hsl(217 91% 60% / 0.07)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
                <Sparkles className="w-6 h-6 text-primary/25" />
              </motion.div>
              <div className="text-center space-y-1">
                <p className="text-sm text-foreground/30 font-medium">Select a platform and scan</p>
                <p className="text-[11px] text-muted-foreground/25 font-mono">
                  Audio signals · Viral hashtags · Creator intelligence
                </p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

// ── Audio Card — premium grid card ────────────────────────
interface AudioCardProps {
  audio:     TrendAudio;
  index:     number;
  copiedKey: string | null;
  isSaved:   boolean;
  copyKey:   string;
  onCopy:    () => void;
  onSave:    () => void;
}

const AudioCard = ({ audio, index, copiedKey, isSaved, copyKey, onCopy, onSave }: AudioCardProps) => {
  const vel = getVel(audio.velocity);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      className="group relative flex flex-col rounded-xl overflow-hidden cursor-default"
      style={{
        background: "linear-gradient(145deg, hsl(222 28% 8%) 0%, hsl(222 26% 6.5%) 100%)",
        border: "1px solid hsl(217 28% 12%)",
        boxShadow: "0 2px 12px hsl(0 0% 0% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.025)",
      }}
      whileHover={{
        y: -3,
        boxShadow: "0 12px 32px hsl(0 0% 0% / 0.35), 0 0 0 1px hsl(217 91% 60% / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
      }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {/* Top accent line — visible on hover */}
      <div className="h-px w-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${vel.color} 50%, transparent 100%)`, opacity: 0 }}
      />
      {/* Hover glow overlay */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 40% at 50% 0%, hsl(217 91% 60% / 0.04), transparent)" }} />

      {/* Card content */}
      <div className="flex flex-col gap-3 p-4 flex-1">

        {/* Top row: index + velocity badge + copy btn */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[9px] font-mono text-muted-foreground/30"
            style={{ letterSpacing: "0.1em" }}>
            #{String(index + 1).padStart(2, "0")}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {audio.velocity && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border leading-none"
                style={{ color: vel.color, background: vel.bg, borderColor: vel.border }}>
                {vel.label}
              </span>
            )}
            {/* Copy button */}
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={onCopy}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
              style={{
                background: copiedKey === copyKey ? "hsl(217 91% 60% / 0.12)" : "hsl(217 28% 10%)",
                border: copiedKey === copyKey ? "1px solid hsl(217 91% 60% / 0.3)" : "1px solid hsl(217 28% 15%)",
              }}
              title="Copy">
              {copiedKey === copyKey
                ? <Check className="w-3 h-3 text-primary" />
                : <Copy className="w-3 h-3 text-muted-foreground/45" />}
            </motion.button>
          </div>
        </div>

        {/* Title + artist */}
        <div className="space-y-0.5 min-w-0">
          <p className="text-[13px] font-semibold text-foreground/90 leading-tight tracking-tight line-clamp-2">
            {audio.title}
          </p>
          {audio.artist && (
            <p className="text-[10px] text-muted-foreground/45 truncate">{audio.artist}</p>
          )}
        </div>

        {/* Category chip */}
        {audio.category && (
          <span className="self-start text-[8px] font-mono px-2 py-0.5 rounded-md leading-none truncate max-w-full"
            style={{ background: "hsl(217 28% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 40%)" }}>
            {audio.category}
          </span>
        )}

        {/* Bottom: uses + tip + save */}
        <div className="mt-auto pt-2 flex items-end justify-between gap-2"
          style={{ borderTop: "1px solid hsl(217 28% 10%)" }}>
          <div className="space-y-0.5 min-w-0 flex-1">
            {audio.uses && (
              <p className="text-[10px] font-mono leading-none" style={{ color: "hsl(217 91% 62%)" }}>
                {audio.uses} uses
              </p>
            )}
            {audio.tip && (
              <p className="text-[9.5px] text-muted-foreground/40 leading-snug line-clamp-2 mt-0.5">
                {audio.tip}
              </p>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={onSave}
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{
              background: isSaved ? "hsl(217 91% 60% / 0.1)" : "hsl(217 28% 10%)",
              border: isSaved ? "1px solid hsl(217 91% 60% / 0.25)" : "1px solid hsl(217 28% 15%)",
            }}
            title={isSaved ? "Unsave" : "Save"}>
            {isSaved
              ? <BookmarkCheck className="w-3 h-3 text-primary" />
              : <Bookmark className="w-3 h-3 text-muted-foreground/40" />}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

// ── Hashtag Card — premium grid card ─────────────────────
interface HashtagCardProps {
  tag:       TrendHashtag;
  index:     number;
  copiedKey: string | null;
  isSaved:   boolean;
  copyKey:   string;
  onCopy:    () => void;
  onSave:    () => void;
}

const HashtagCard = ({ tag, index, copiedKey, isSaved, copyKey, onCopy, onSave }: HashtagCardProps) => {
  const vel = getVel(tag.velocity);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      className="group relative flex flex-col rounded-xl overflow-hidden cursor-default"
      style={{
        background: "linear-gradient(145deg, hsl(222 28% 8%) 0%, hsl(222 26% 6.5%) 100%)",
        border: "1px solid hsl(217 28% 12%)",
        boxShadow: "0 2px 12px hsl(0 0% 0% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.025)",
      }}
      whileHover={{
        y: -3,
        boxShadow: "0 12px 32px hsl(0 0% 0% / 0.35), 0 0 0 1px hsl(217 91% 60% / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
      }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {/* Hover glow */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 40% at 50% 0%, hsl(217 91% 60% / 0.04), transparent)" }} />

      <div className="flex flex-col gap-3 p-4 flex-1">

        {/* Top row: index + velocity + copy */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[9px] font-mono text-muted-foreground/30" style={{ letterSpacing: "0.1em" }}>
            #{String(index + 1).padStart(2, "0")}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {tag.velocity && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border leading-none"
                style={{ color: vel.color, background: vel.bg, borderColor: vel.border }}>
                {vel.label}
              </span>
            )}
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={onCopy}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
              style={{
                background: copiedKey === copyKey ? "hsl(217 91% 60% / 0.12)" : "hsl(217 28% 10%)",
                border: copiedKey === copyKey ? "1px solid hsl(217 91% 60% / 0.3)" : "1px solid hsl(217 28% 15%)",
              }}
              title="Copy">
              {copiedKey === copyKey
                ? <Check className="w-3 h-3 text-primary" />
                : <Copy className="w-3 h-3 text-muted-foreground/45" />}
            </motion.button>
          </div>
        </div>

        {/* Tag + posts */}
        <div className="space-y-0.5 min-w-0">
          <p className="text-[13px] font-semibold text-foreground/90 leading-tight tracking-tight line-clamp-2">
            {tag.tag}
          </p>
          {tag.posts && (
            <p className="text-[10px] font-mono" style={{ color: "hsl(217 91% 62%)" }}>
              {tag.posts} posts
            </p>
          )}
        </div>

        {/* Category chip */}
        {tag.category && (
          <span className="self-start text-[8px] font-mono px-2 py-0.5 rounded-md leading-none truncate max-w-full"
            style={{ background: "hsl(217 28% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(215 16% 40%)" }}>
            {tag.category}
          </span>
        )}

        {/* Bottom: trend + tip + save */}
        <div className="mt-auto pt-2 flex items-end justify-between gap-2"
          style={{ borderTop: "1px solid hsl(217 28% 10%)" }}>
          <div className="space-y-0.5 min-w-0 flex-1">
            {tag.trend && (
              <p className="text-[9.5px] font-mono text-muted-foreground/40 leading-none capitalize">{tag.trend}</p>
            )}
            {tag.tip && (
              <p className="text-[9.5px] text-muted-foreground/40 leading-snug line-clamp-2 mt-0.5">{tag.tip}</p>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={onSave}
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{
              background: isSaved ? "hsl(217 91% 60% / 0.1)" : "hsl(217 28% 10%)",
              border: isSaved ? "1px solid hsl(217 91% 60% / 0.25)" : "1px solid hsl(217 28% 15%)",
            }}
            title={isSaved ? "Unsave" : "Save"}>
            {isSaved
              ? <BookmarkCheck className="w-3 h-3 text-primary" />
              : <Bookmark className="w-3 h-3 text-muted-foreground/40" />}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export default AudioHashtagPage;
