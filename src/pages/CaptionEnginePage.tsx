import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, Copy, Check, Bookmark, BookmarkCheck, Type } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/cloudDb";
import { useTierLevel } from "@/hooks/useProfile";
import { getCaptionLimitText } from "@/lib/pricing";
import { UpgradeDialog } from "@/components/UpgradeDialog";

type Platform = "youtube" | "instagram" | "tiktok" | "facebook";
type GenerationStyle = "viral" | "seo_optimized" | "storytelling" | "educational" | "bold" | "conversational";

type CaptionGeneration = {
  id: string;
  platform: Platform;
  generation_style: GenerationStyle;
  prompt: string;
  generated_caption: string;
  generated_hashtags: string[];
  generated_keywords: string[];
  is_saved: boolean;
  created_at: string;
};

const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

const styleOptions: Array<{ value: GenerationStyle; label: string }> = [
  { value: "viral", label: "Viral" },
  { value: "seo_optimized", label: "SEO Optimized" },
  { value: "storytelling", label: "Storytelling" },
  { value: "educational", label: "Educational" },
  { value: "bold", label: "Bold" },
  { value: "conversational", label: "Conversational" },
];

const CaptionEnginePage = () => {
  const { user } = useAuth();
  const tier = useTierLevel();
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [style, setStyle] = useState<GenerationStyle>("seo_optimized");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<CaptionGeneration | null>(null);
  const [history, setHistory] = useState<CaptionGeneration[]>([]);
  const [usage, setUsage] = useState<{
    used: number;
    quota: number;
    remaining: number;
    allowed: boolean;
    near_limit: boolean;
    fair_usage: boolean;
    message?: string;
  } | null>(null);

  const canGenerate = prompt.trim().length >= 3 && !generating;
  const limitHint = useMemo(() => getCaptionLimitText(tier), [tier]);

  const loadHistory = async () => {
    if (!user) return;
    const { data } = await db
      .from("caption_generations")
      .select("id, platform, generation_style, prompt, generated_caption, generated_hashtags, generated_keywords, is_saved, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12);
    setHistory((data ?? []) as CaptionGeneration[]);
  };

  const loadUsage = async () => {
    const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "captions" });
    if (error) return;
    setUsage({
      used: Number(data?.used ?? 0),
      quota: Number(data?.quota ?? 0),
      remaining: Number(data?.remaining ?? 0),
      allowed: Boolean(data?.allowed),
      near_limit: Boolean(data?.near_limit),
      fair_usage: Boolean(data?.fair_usage),
      message: String(data?.message ?? ""),
    });
  };

  useEffect(() => {
    if (!user) return;
    void loadHistory();
    void loadUsage();
  }, [user?.id]);

  const handleGenerate = async () => {
    if (!canGenerate) {
      toast.error("Enter at least 3 characters to generate.");
      return;
    }

    setGenerating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      const requestId = crypto.randomUUID();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-caption`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ platform, generationStyle: style, prompt, requestId }),
      });

      const payload = await resp.json();
      if (!resp.ok) {
        if (payload?.usage) {
          setUsage({
            used: Number(payload.usage.used ?? 0),
            quota: Number(payload.usage.quota ?? 0),
            remaining: Number(payload.usage.remaining ?? 0),
            allowed: Boolean(payload.usage.allowed),
            near_limit: Boolean(payload.usage.near_limit),
            fair_usage: Boolean(payload.usage.fair_usage),
            message: String(payload.usage.message ?? ""),
          });
        }
        if (resp.status === 403) {
          setShowUpgrade(true);
        }
        toast.error(payload?.error || "Caption generation failed.");
        await loadUsage();
        return;
      }

      setResult(payload.generation as CaptionGeneration);
      setPrompt("");
      if (payload?.usage) {
        setUsage({
          used: Number(payload.usage.used ?? 0),
          quota: Number(payload.usage.quota ?? 0),
          remaining: Number(payload.usage.remaining ?? 0),
          allowed: Boolean(payload.usage.allowed),
          near_limit: Boolean(payload.usage.near_limit),
          fair_usage: Boolean(payload.usage.fair_usage),
          message: String(payload.usage.message ?? ""),
        });
      }
      toast.success("Caption generated.");
      await Promise.all([loadHistory(), loadUsage()]);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    toast.success("Copied to clipboard");
  };

  const toggleSaved = async (item: CaptionGeneration) => {
    const { error } = await db
      .from("caption_generations")
      .update({ is_saved: !item.is_saved } as any)
      .eq("id", item.id)
      .eq("user_id", user?.id);

    if (error) {
      toast.error("Could not update saved state.");
      return;
    }

    setResult((prev) => (prev?.id === item.id ? { ...prev, is_saved: !item.is_saved } : prev));
    setHistory((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_saved: !row.is_saved } : row)));
  };

  return (
    <div className="pt-14 md:pt-0">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Type className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Caption Engine</span>
          <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">NEW</Badge>
        </div>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Caption Engine</h1>
          {!!usage && (
            <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                  {usage.used}/{usage.quota} used today
            </Badge>
          )}
        </div>
        {!!usage?.near_limit && !usage?.fair_usage && (
          <p className="text-xs text-amber-400/90 font-mono mt-2">{usage.message || `${usage.remaining} generations remaining today`}</p>
        )}
        {!!usage && !usage.allowed && !usage.fair_usage && (
          <p className="text-xs text-muted-foreground mt-2">Daily limit reached — upgrade to continue creating.</p>
        )}
        <p className="text-muted-foreground text-sm">Generate optimized captions and descriptions for every platform.</p>
      </div>

      <div className="glass-card p-5 mb-6 space-y-4">
        <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
          <TabsList className="grid grid-cols-4 bg-secondary/60 h-10">
            {Object.entries(platformLabels).map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex gap-2 flex-wrap">
          {styleOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setStyle(option.value)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth ${
                style === option.value
                  ? "bg-primary/12 text-primary border border-primary/25"
                  : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder="What is your content about?"
            className="input-glass h-12 text-sm rounded-xl"
            disabled={generating}
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="btn-primary shimmer-btn !py-3 !px-6 shrink-0 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "Generating..." : "Generate Caption"}
          </motion.button>
        </div>

        <p className="text-[10px] text-muted-foreground/70 font-mono">{limitHint}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-card p-5 min-h-[280px]">
          {generating && !result ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full border border-primary/30 bg-primary/10 animate-pulse" />
              <p className="text-sm text-muted-foreground font-mono">Optimizing for {platformLabels[platform]}...</p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">{platformLabels[result.platform]} • {result.generation_style.replace("_", " ")}</p>
                  <p className="text-xs text-muted-foreground mt-1">Generated for discoverability, engagement, and growth.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleSaved(result)} className="btn-secondary !px-3 !py-2 flex items-center gap-1.5">
                    {result.is_saved ? <BookmarkCheck className="w-3.5 h-3.5 text-primary" /> : <Bookmark className="w-3.5 h-3.5" />}
                    {result.is_saved ? "Saved" : "Save"}
                  </button>
                  <button onClick={() => handleCopy(result.generated_caption)} className="btn-secondary !px-3 !py-2 flex items-center gap-1.5">
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border/40 bg-card/40 p-4">
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{result.generated_caption}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-2">Hashtags</p>
                  <p className="text-xs text-foreground/85">{(result.generated_hashtags || []).join(" ")}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-2">Keywords</p>
                  <p className="text-xs text-foreground/85">{(result.generated_keywords || []).join(", ")}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[220px] flex items-center justify-center">
              <p className="text-muted-foreground/45 text-sm font-mono">Your generated caption will appear here...</p>
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Generation History</p>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">No generations yet.</p>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setResult(item)}
                  className="w-full text-left rounded-lg border border-border/40 bg-card/30 hover:border-primary/25 hover:bg-card/50 transition-smooth p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary">{platformLabels[item.platform]}</p>
                    {item.is_saved && <BookmarkCheck className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <p className="text-xs text-foreground/85 max-h-9 overflow-hidden">{item.generated_caption}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default CaptionEnginePage;