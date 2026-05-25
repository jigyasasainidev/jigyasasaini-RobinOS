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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

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
  savedAudios:   string[];   // "title|artist"
  savedHashtags: string[];   // tag string
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

// ── Velocity chip ──────────────────────────────────────────
const velChip = (v?: string) => {
  if (v === "exploding") return "bg-red-500/10 border-red-500/30 text-red-400/90";
  if (v === "hot")       return "bg-amber-500/10 border-amber-500/30 text-amber-400/90";
  if (v === "rising")    return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400/90";
  return "bg-card/20 border-border/25 text-muted-foreground/45";
};

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

  // Persist on every relevant change
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
      if (s.has(k)) { s.delete(k); toast.success("Removed from saved"); }
      else           { s.add(k);    toast.success("Saved");              }
      return s;
    });
  };

  const toggleSaveHashtag = (tag: TrendHashtag) => {
    setSavedHashtags(prev => {
      const s = new Set(prev);
      if (s.has(tag.tag)) { s.delete(tag.tag); toast.success("Removed from saved"); }
      else                 { s.add(tag.tag);    toast.success("Saved");              }
      return s;
    });
  };

  const msgs = scanMode === "audio" ? AUDIO_MSGS : HASHTAG_MSGS;

  return (
    <div className="relative pt-14 md:pt-0">

      {/* ── Atmospheric depth layer ───────────────────────── */}
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

        {/* ── Page header ──────────────────────────────────── */}
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

          {/* Stats pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <motion.span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 68%)" }}
              animate={{ boxShadow: audios.length > 0
                ? ["0 0 0 hsl(217 91% 60% / 0)", "0 0 12px hsl(217 91% 60% / 0.12)", "0 0 0 hsl(217 91% 60% / 0)"]
                : "none"
              }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Music className="w-3 h-3" />
              Audio · {audios.length}
            </motion.span>
            <motion.span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono"
              style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.18)", color: "hsl(217 91% 68%)" }}
              animate={{ boxShadow: hashtags.length > 0
                ? ["0 0 0 hsl(217 91% 60% / 0)", "0 0 12px hsl(217 91% 60% / 0.12)", "0 0 0 hsl(217 91% 60% / 0)"]
                : "none"
              }}
              transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
            >
              <Hash className="w-3 h-3" />
              Hashtags · {hashtags.length}
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

        {/* ── Controls ─────────────────────────────────────── */}
        <div className="mb-6 rounded-2xl p-5 space-y-5"
          style={{ background: "hsl(222 28% 6% / 0.8)", border: "1px solid hsl(217 28% 12%)", backdropFilter: "blur(12px)" }}>

          {/* Platform */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/40 mb-3">
              Platform
            </p>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
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
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => handleScan("audio")}
              disabled={scanning}
              className="btn-primary shimmer-btn !py-2.5 !px-6 text-sm flex items-center gap-2 disabled:opacity-40"
            >
              {scanning && scanMode === "audio"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Audio...</>
                : <><Music className="w-4 h-4" /> Find Trending Audio</>
              }
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => handleScan("hashtags")}
              disabled={scanning}
              className="px-6 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-40 transition-all duration-200"
              style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 17%)", color: "hsl(215 16% 55%)" }}
            >
              {scanning && scanMode === "hashtags"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Hashtags...</>
                : <><Hash className="w-4 h-4" /> Find Trending Hashtags</>
              }
            </motion.button>
          </div>
        </div>

        {/* ── Dynamic area ─────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* Scanning */}
          {scanning && (
            <motion.div key="scan"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="relative rounded-2xl overflow-hidden flex flex-col items-center justify-center py-24 mb-6"
              style={{ background: "hsl(222 28% 5% / 0.95)", border: "1px solid hsl(217 91% 60% / 0.1)" }}
            >
              {/* Radial rings */}
              {[0, 1, 2, 3].map((i) => (
                <motion.div key={`r-${i}`}
                  className="absolute rounded-full"
                  style={{ width: 80 + i * 44, height: 80 + i * 44, border: "1px solid hsl(217 91% 60% / 0.08)" }}
                  animate={{ scale: [0.3, 2.8, 3.8], opacity: [0, 0.45, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
                />
              ))}
              {/* Sweep */}
              <motion.div
                className="absolute w-48 h-[1px] origin-left"
                style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.55), transparent)" }}
                animate={{ rotate: 360 }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
              />
              {/* Center icon */}
              <motion.div
                className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center mb-6"
                style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.2)" }}
                animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 30px hsl(217 91% 60% / 0.15)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {(() => {
                  const Icon = SCAN_ICONS[iconIdx % SCAN_ICONS.length];
                  return (
                    <motion.div key={iconIdx} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
                      <Icon className="w-7 h-7 text-primary" strokeWidth={1.5} />
                    </motion.div>
                  );
                })()}
              </motion.div>
              {/* Message */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={msgIdx}
                  initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                  transition={{ duration: 0.3 }}
                  className="relative z-10 text-sm font-mono text-primary/90 tracking-wider"
                >
                  {msgs[msgIdx]}
                </motion.p>
              </AnimatePresence>
              <p className="relative z-10 mt-2 text-[11px] text-muted-foreground/35 font-mono">
                Target: {platform}
              </p>
            </motion.div>
          )}

          {/* Audio results */}
          {!scanning && scanned && scanMode === "audio" && audios.length > 0 && (
            <motion.div key="audio-results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Feed header */}
              <div className="flex items-center gap-3 mb-4 px-1">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/50">
                    Trending Audio
                  </span>
                  <span className="text-[10px] font-mono text-primary/50">· {platform}</span>
                </div>
                <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.12), transparent)" }} />
                <span className="text-[10px] font-mono text-muted-foreground/35">{audios.length} tracks</span>
              </div>

              {/* Intelligence feed container */}
              <div className="rounded-2xl overflow-hidden"
                style={{ background: "hsl(222 28% 5% / 0.6)", border: "1px solid hsl(217 28% 11%)", boxShadow: "0 0 80px hsl(217 91% 60% / 0.02) inset" }}>
                <div className="divide-y" style={{ borderColor: "hsl(217 28% 10%)" }}>
                  {audios.map((audio, i) => (
                    <AudioCard
                      key={i}
                      audio={audio}
                      index={i}
                      copiedKey={copiedKey}
                      isSaved={savedAudios.has(`${audio.title}|${audio.artist}`)}
                      copyKey={`audio-${i}`}
                      onCopy={() => copyText(`${audio.title} by ${audio.artist}`, `audio-${i}`)}
                      onSave={() => toggleSaveAudio(audio)}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Hashtag results */}
          {!scanning && scanned && scanMode === "hashtags" && hashtags.length > 0 && (
            <motion.div key="hashtag-results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Feed header */}
              <div className="flex items-center gap-3 mb-4 px-1">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/50">
                    Trending Hashtags
                  </span>
                  <span className="text-[10px] font-mono text-primary/50">· {platform}</span>
                </div>
                <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, hsl(217 91% 60% / 0.12), transparent)" }} />
                <span className="text-[10px] font-mono text-muted-foreground/35">{hashtags.length} tags</span>
              </div>

              {/* Intelligence feed container */}
              <div className="rounded-2xl overflow-hidden"
                style={{ background: "hsl(222 28% 5% / 0.6)", border: "1px solid hsl(217 28% 11%)", boxShadow: "0 0 80px hsl(217 91% 60% / 0.02) inset" }}>
                <div className="divide-y" style={{ borderColor: "hsl(217 28% 10%)" }}>
                  {hashtags.map((tag, i) => (
                    <HashtagCard
                      key={i}
                      tag={tag}
                      index={i}
                      copiedKey={copiedKey}
                      isSaved={savedHashtags.has(tag.tag)}
                      copyKey={`tag-${i}`}
                      onCopy={() => copyText(tag.tag, `tag-${i}`)}
                      onSave={() => toggleSaveHashtag(tag)}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Empty after scan */}
          {!scanning && scanned &&
            ((scanMode === "audio" && audios.length === 0) ||
             (scanMode === "hashtags" && hashtags.length === 0)) && (
            <motion.div key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl"
              style={{ border: "1px solid hsl(217 28% 11%)", background: "hsl(222 28% 5% / 0.4)" }}
            >
              <Hash className="w-8 h-8 text-muted-foreground/15" />
              <p className="text-sm text-muted-foreground/40 font-mono">No results found. Try a different platform.</p>
            </motion.div>
          )}

          {/* Idle */}
          {!scanning && !scanned && (
            <motion.div key="idle"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 gap-6 rounded-2xl"
              style={{ border: "1px dashed hsl(217 28% 12%)", background: "hsl(222 28% 4.5% / 0.4)" }}
            >
              <motion.div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "hsl(217 28% 7%)", border: "1px solid hsl(217 28% 13%)" }}
                animate={{ boxShadow: ["0 0 0 hsl(217 91% 60% / 0)", "0 0 24px hsl(217 91% 60% / 0.07)", "0 0 0 hsl(217 91% 60% / 0)"] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
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

// ── Audio Card ─────────────────────────────────────────────
interface AudioCardProps {
  audio:    TrendAudio;
  index:    number;
  copiedKey: string | null;
  isSaved:  boolean;
  copyKey:  string;
  onCopy:   () => void;
  onSave:   () => void;
}

const AudioCard = ({ audio, index, copiedKey, isSaved, copyKey, onCopy, onSave }: AudioCardProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035, duration: 0.3 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative flex flex-col sm:flex-row sm:items-start gap-4 px-5 py-4 transition-colors duration-200 cursor-default"
      style={{
        background: hovered ? "hsl(217 91% 60% / 0.025)" : "transparent",
        boxShadow: hovered ? "inset 0 1px 0 hsl(217 91% 60% / 0.05), inset 0 -1px 0 hsl(217 91% 60% / 0.03)" : "none",
      }}
    >
      {/* Left accent */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full transition-all duration-300"
        style={{ background: hovered ? "hsl(217 91% 60% / 0.4)" : "transparent" }} />

      {/* Index badge */}
      <div className="hidden sm:flex shrink-0 w-7 h-7 rounded-md items-center justify-center mt-0.5"
        style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.1)" }}>
        <span className="text-[10px] font-mono text-primary/45">{String(index + 1).padStart(2, "0")}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-semibold text-foreground/88 leading-tight">{audio.title}</p>
          {audio.artist && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{audio.artist}</p>
          )}
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5">
          {audio.velocity && (
            <span className={`inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border ${velChip(audio.velocity)}`}>
              {audio.velocity}
            </span>
          )}
          {audio.trend && (
            <span className="inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border border-border/20 text-muted-foreground/40">
              {audio.trend}
            </span>
          )}
          {audio.category && (
            <span className="inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border border-border/20 text-muted-foreground/40 max-w-[160px] truncate">
              {audio.category}
            </span>
          )}
        </div>

        {/* Uses + tip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {audio.uses && (
            <span className="text-[11px] font-mono" style={{ color: "hsl(217 91% 62%)" }}>
              {audio.uses} uses
            </span>
          )}
          {audio.tip && (
            <p className="text-[11px] text-muted-foreground/45 leading-relaxed">{audio.tip}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
        <ActionBtn onClick={onSave} title={isSaved ? "Unsave" : "Save"}>
          {isSaved
            ? <BookmarkCheck className="w-3.5 h-3.5 text-primary" />
            : <Bookmark className="w-3.5 h-3.5 text-muted-foreground/40" />
          }
        </ActionBtn>
        <ActionBtn onClick={onCopy} title="Copy">
          {copiedKey === copyKey
            ? <Check className="w-3.5 h-3.5 text-primary" />
            : <Copy className="w-3.5 h-3.5 text-muted-foreground/40" />
          }
        </ActionBtn>
      </div>
    </motion.div>
  );
};

// ── Hashtag Card ───────────────────────────────────────────
interface HashtagCardProps {
  tag:      TrendHashtag;
  index:    number;
  copiedKey: string | null;
  isSaved:  boolean;
  copyKey:  string;
  onCopy:   () => void;
  onSave:   () => void;
}

const HashtagCard = ({ tag, index, copiedKey, isSaved, copyKey, onCopy, onSave }: HashtagCardProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035, duration: 0.3 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative flex flex-col sm:flex-row sm:items-start gap-4 px-5 py-4 transition-colors duration-200 cursor-default"
      style={{
        background: hovered ? "hsl(217 91% 60% / 0.025)" : "transparent",
        boxShadow: hovered ? "inset 0 1px 0 hsl(217 91% 60% / 0.05), inset 0 -1px 0 hsl(217 91% 60% / 0.03)" : "none",
      }}
    >
      {/* Left accent */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full transition-all duration-300"
        style={{ background: hovered ? "hsl(217 91% 60% / 0.4)" : "transparent" }} />

      {/* Index badge */}
      <div className="hidden sm:flex shrink-0 w-7 h-7 rounded-md items-center justify-center mt-0.5"
        style={{ background: "hsl(217 91% 60% / 0.06)", border: "1px solid hsl(217 91% 60% / 0.1)" }}>
        <span className="text-[10px] font-mono text-primary/45">{String(index + 1).padStart(2, "0")}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-semibold text-foreground/88 leading-tight">{tag.tag}</p>
          {tag.posts && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{tag.posts} posts</p>
          )}
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5">
          {tag.velocity && (
            <span className={`inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border ${velChip(tag.velocity)}`}>
              {tag.velocity}
            </span>
          )}
          {tag.trend && (
            <span className="inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border border-border/20 text-muted-foreground/40">
              {tag.trend}
            </span>
          )}
          {tag.category && (
            <span className="inline-flex items-center text-[9px] font-mono px-2 py-0.5 rounded-full border border-border/20 text-muted-foreground/40 max-w-[160px] truncate">
              {tag.category}
            </span>
          )}
        </div>

        {/* Tip */}
        {tag.tip && (
          <p className="text-[11px] text-muted-foreground/45 leading-relaxed">{tag.tip}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
        <ActionBtn onClick={onSave} title={isSaved ? "Unsave" : "Save"}>
          {isSaved
            ? <BookmarkCheck className="w-3.5 h-3.5 text-primary" />
            : <Bookmark className="w-3.5 h-3.5 text-muted-foreground/40" />
          }
        </ActionBtn>
        <ActionBtn onClick={onCopy} title="Copy">
          {copiedKey === copyKey
            ? <Check className="w-3.5 h-3.5 text-primary" />
            : <Copy className="w-3.5 h-3.5 text-muted-foreground/40" />
          }
        </ActionBtn>
      </div>
    </motion.div>
  );
};

// ── Reusable action button ─────────────────────────────────
const ActionBtn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
  <motion.button
    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
    onClick={onClick}
    title={title}
    className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150"
    style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)" }}
  >
    {children}
  </motion.button>
);

export default AudioHashtagPage;
