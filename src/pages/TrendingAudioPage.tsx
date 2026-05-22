import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Music, TrendingUp, ArrowUp, Sparkles, Loader2, Search, Copy, Check, Lock, Hash } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { useAllPlatformsUnlocked, useEntitlements, useHashtagScanLimit, useIsAgency, useTrendScanLimit } from "@/hooks/useEntitlements";
import { useAuth } from "@/contexts/AuthContext";

type Platform = "TikTok" | "Instagram" | "Facebook" | "YouTube";

interface TrendingAudio {
  title: string;
  artist: string;
  category: string;
  uses: string;
  trend: "up" | "stable" | "new";
  tip: string;
}

interface TrendingHashtag {
  tag: string;
  category: string;
  posts: string;
  trend: "up" | "stable" | "new";
  tip: string;
}

const platforms: { id: Platform; label: string }[] = [
  { id: "TikTok", label: "TikTok" },
  { id: "Instagram", label: "Instagram" },
  { id: "Facebook", label: "Facebook" },
  { id: "YouTube", label: "YouTube" },
];

const trendIcon = (trend: string) => {
  if (trend === "up") return <ArrowUp className="w-3 h-3 text-emerald-400" />;
  if (trend === "new") return <Sparkles className="w-3 h-3 text-amber-400" />;
  return <TrendingUp className="w-3 h-3 text-muted-foreground" />;
};

const categoryColor = (cat: string) => {
  if (cat === "Viral") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (cat === "Rising") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (cat === "Classic Remix") return "bg-purple-500/10 text-purple-400 border-purple-500/20";

  if (cat === "Trending") return "bg-primary/10 text-primary border-primary/20";
  if (cat === "Evergreen") return "bg-teal-500/10 text-teal-400 border-teal-500/20";
  if (cat === "Niche") return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
  return "bg-primary/10 text-primary border-primary/20";
};

const TrendingAudioPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // ── Centralized entitlements — no scattered tier === 'pro_creator' checks ──
  const allPlatformsUnlocked = useAllPlatformsUnlocked();
  const isAgency = useIsAgency();
  const audioLimitFromPlan = useTrendScanLimit();    // -1 = unlimited
  const hashtagLimitFromPlan = useHashtagScanLimit(); // -1 = unlimited

  // Display limits for usage badges
  const audioLimit = audioLimitFromPlan === -1 ? 99999 : audioLimitFromPlan;
  const hashtagLimit = hashtagLimitFromPlan === -1 ? 99999 : hashtagLimitFromPlan;

  // Allowed platforms: pro_creator+ gets all; free/creator gets Instagram only
  const allowedPlatforms: Platform[] = allPlatformsUnlocked
    ? ["TikTok", "Instagram", "Facebook", "YouTube"]
    : ["Instagram"];

  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [audios, setAudios] = useState<TrendingAudio[]>([]);
  const [hashtags, setHashtags] = useState<TrendingHashtag[]>([]);
  const [loading, setLoading] = useState(false);
  const [hashtagLoading, setHashtagLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hashtagSearched, setHashtagSearched] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedHashIdx, setCopiedHashIdx] = useState<number | null>(null);
  const [audioUsage, setAudioUsage] = useState<{ used: number; limit: number } | null>(null);
  const [hashtagUsage, setHashtagUsage] = useState<{ used: number; limit: number } | null>(null);

  // ─── Fetch persisted usage on mount (backend as source of truth) ───
  useEffect(() => {
    if (!user?.id) return;
    const loadUsage = async () => {
      try {
        const [audioResult, hashtagResult] = await Promise.all([
          supabase.rpc("get_usage_status_v2" as any, {
            p_user_id: user.id,
            p_feature_key: "trend_scan",
          }),
          supabase.rpc("get_usage_status_v2" as any, {
            p_user_id: user.id,
            p_feature_key: "hashtag_scan",
          }),
        ]);

        if (audioResult.data && !audioResult.error) {
          const d = audioResult.data as any;
          const backendQuota = Number(d.quota ?? 0);
          setAudioUsage({
            used: Number(d.used ?? 0),
            limit: d.unlimited || d.fair_usage
              ? audioLimit
              : backendQuota > 0 ? backendQuota : audioLimit,
          });
        }
        if (hashtagResult.data && !hashtagResult.error) {
          const d = hashtagResult.data as any;
          const backendQuota = Number(d.quota ?? 0);
          setHashtagUsage({
            used: Number(d.used ?? 0),
            limit: d.unlimited || d.fair_usage
              ? hashtagLimit
              : backendQuota > 0 ? backendQuota : hashtagLimit,
          });
        }
      } catch {
        // Non-fatal: badge falls back to local limits
      }
    };
    void loadUsage();
  }, [user?.id]);

  const fetchData = async (type: "audio" | "hashtags") => {
    if (!allowedPlatforms.includes(platform)) {
      toast.error(`${platform} requires Pro Creator or higher plan`);
      return;
    }

    const isHashtag = type === "hashtags";
    if (isHashtag) {
      setHashtagLoading(true);
      setHashtagSearched(true);
    } else {
      setLoading(true);
      setSearched(true);
    }

    try {
      // ─── Use supabase.functions.invoke() — handles auth automatically ───
      const { data, error } = await supabase.functions.invoke("trending-audio", {
        body: { platform, type: isHashtag ? "hashtags" : "audio" },
      });

      if (error) {
        // FunctionsHttpError carries status; check for 403 limit/plan errors
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        let parsed: Record<string, unknown> = {};
        try {
          const raw = (error as any)?.context?.responseText ?? (error as any)?.message ?? "";
          parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
        } catch { /* keep empty */ }

        const code = String(parsed.code ?? "");
        if (status === 403 || code === "USAGE_LIMIT_EXCEEDED" || code === "FEATURE_DISABLED") {
          const msg = String(parsed.message ?? "Limit reached. Upgrade your plan.");
          toast.error(msg);
          if (tier === "free") setTimeout(() => navigate("/dashboard/settings"), 1500);
          isHashtag ? setHashtagLoading(false) : setLoading(false);
          return;
        }
        throw new Error(String(parsed.message ?? error.message ?? "Failed to fetch"));
      }

      if (!data) throw new Error("No data returned");

      if (isHashtag) {
        setHashtags(data?.hashtags ?? []);
        if (data?.usage) {
          const bq = Number(data.usage.quota ?? 0);
          setHashtagUsage({
            used: Number(data.usage.used ?? 0),
            limit: data.usage.unlimited || data.usage.fair_usage
              ? hashtagLimit
              : bq > 0 ? bq : hashtagLimit,
          });
        }
        if (!data?.hashtags?.length) toast.error("No hashtags found. Try again.");
      } else {
        setAudios(data?.audios ?? []);
        if (data?.usage) {
          const bq = Number(data.usage.quota ?? 0);
          setAudioUsage({
            used: Number(data.usage.used ?? 0),
            limit: data.usage.unlimited || data.usage.fair_usage
              ? audioLimit
              : bq > 0 ? bq : audioLimit,
          });
        }
        if (!data?.audios?.length) toast.error("No results found. Try again.");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch");
    } finally {
      isHashtag ? setHashtagLoading(false) : setLoading(false);
    }
  };

  const copyText = (text: string, idx: number, isHashtag = false) => {
    navigator.clipboard.writeText(text);
    if (isHashtag) {
      setCopiedHashIdx(idx);
      setTimeout(() => setCopiedHashIdx(null), 2000);
    } else {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="pt-16 md:pt-0">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground">
              Idea Stream
            </span>
          </div>
          <h1 className="text-chrome text-xl font-semibold mb-1">Discover Audio Signals & Tag Streams 🎵</h1>
          <p className="text-xs text-muted-foreground">
            Find global trending audio tracks and hashtags across major platforms.
          </p>
        </div>

        {/* Usage Badge */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
            {isAgency ? "Unlimited" : `Audio: ${audioUsage ? audioUsage.used : 0}/${audioUsage ? audioUsage.limit : audioLimit}`}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
            {isAgency ? "Unlimited" : `Hashtags: ${hashtagUsage ? hashtagUsage.used : 0}/${hashtagUsage ? hashtagUsage.limit : hashtagLimit}`}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
            {isAgency ? "Agency" : allPlatformsUnlocked ? "Pro Creator" : "Free / Creator"}
          </Badge>
          {!allPlatformsUnlocked && (
            <button onClick={() => navigate("/dashboard/settings")} className="text-[10px] font-mono text-primary hover:underline">
              Upgrade for more →
            </button>
          )}
        </div>

        {/* Platform Selector */}
        <div className="flex gap-3 mb-6 flex-wrap">
          {platforms.map((p) => {
            const isLocked = !allowedPlatforms.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => !isLocked && setPlatform(p.id)}
                className={`relative px-4 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isLocked
                    ? "bg-secondary/50 text-muted-foreground/40 border border-border/50 cursor-not-allowed"
                    : platform === p.id
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {isLocked && <Lock className="w-3 h-3" />}
                  {p.label}
                </span>
                {platform === p.id && !isLocked && (
                  <motion.div
                    layoutId="platform-indicator"
                    className="absolute inset-0 rounded-lg border border-primary/30"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-8 flex-wrap">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => fetchData("audio")}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-50 transition-all"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
            ) : (
              <><Search className="w-4 h-4" /> Find Audio Signals</>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => fetchData("hashtags")}
            disabled={hashtagLoading}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-primary/30 text-primary text-sm font-medium disabled:opacity-50 transition-all hover:bg-primary/5"
          >
            {hashtagLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
            ) : (
              <><Hash className="w-4 h-4" /> Find Tag Streams</>
            )}
          </motion.button>
        </div>

        {/* ─── AUDIO RESULTS ─── */}
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="audio-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground font-mono">Scanning {platform} for trending audio...</p>
            </motion.div>
          ) : audios.length > 0 ? (
            <motion.div key="audio-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 mb-4">
                <Music className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-medium text-foreground">Audio Signals — {platform}</h2>
                {audioUsage && !isAgency && (
                  <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                    {audioUsage.used}/{audioUsage.limit} scans
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
                {audios.map((audio, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-colors group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-foreground truncate">{audio.title}</h3>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{audio.artist}</p>
                      </div>
                      <button onClick={() => copyText(audio.title, i)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-2 shrink-0" title="Copy audio name">
                        {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className={`text-[9px] font-mono ${categoryColor(audio.category)}`}>{audio.category}</Badge>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {trendIcon(audio.trend)}
                        <span>{audio.uses} uses</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{audio.tip}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : searched && !loading ? (
            <motion.div key="audio-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-10">
              <Music className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground">No trending audio found. Try again.</p>
            </motion.div>
          ) : !hashtagSearched ? (
            <motion.div key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
              <Music className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Select a platform and hit search</p>
              <p className="text-[10px] text-muted-foreground/60 font-mono">AI-powered trending audio & hashtag discovery • global creator signals</p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ─── HASHTAG RESULTS ─── */}
        <AnimatePresence mode="wait">
          {hashtagLoading ? (
            <motion.div key="hash-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground font-mono">Scanning {platform} for trending hashtags...</p>
            </motion.div>
          ) : hashtags.length > 0 ? (
            <motion.div key="hash-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 mb-4 mt-6">
                <Hash className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-medium text-foreground">Tag Streams — {platform}</h2>
                {hashtagUsage && !isAgency && (
                  <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                    {hashtagUsage.used}/{hashtagUsage.limit} scans
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {hashtags.map((tag, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-colors group">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-sm font-medium text-primary">{tag.tag}</h3>
                      <button onClick={() => copyText(tag.tag, i, true)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-2 shrink-0">
                        {copiedHashIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className={`text-[9px] font-mono ${categoryColor(tag.category)}`}>{tag.category}</Badge>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {trendIcon(tag.trend)}
                        <span>{tag.posts} posts</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{tag.tip}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : hashtagSearched && !hashtagLoading ? (
            <motion.div key="hash-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-10 mt-6">
              <Hash className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground">No trending hashtags found. Try again.</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default TrendingAudioPage;
