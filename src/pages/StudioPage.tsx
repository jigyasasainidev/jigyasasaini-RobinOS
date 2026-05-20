import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { PenTool, Wand2, Lock, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/cloudDb";
import { useTierLevel, useFreeTrialStatus } from "@/hooks/useProfile";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { ScriptModeSelector, type ScriptMode } from "@/components/ScriptModeSelector";
import { ScriptOutput } from "@/components/ScriptOutput";

const tones = ["Casual", "Bold", "Storytelling", "Educational", "Provocative"];
const allLengths = ["30s Short", "60s Reel", "3min Script", "10min Long-form"];
const freeLengths = ["30s Short"];
const starterLengths = ["30s Short", "60s Reel"];

const modePromptSuffix: Record<ScriptMode, string> = {
  quick: "\n\nIMPORTANT: Output ONLY a ready-to-record script. Format:\n🎬 READY TO RECORD SCRIPT:\n\nLine 1 (Hook - attention grabbing first line)\nLine 2\nLine 3\nLine 4\n...\n\n🎥 Camera: [simple instruction]\n🗣 Tone: [tone style]\n\nRules: No explanations. No extra text. No sections. No fluff. Highly human conversational tone. Feels like a real creator speaking, not AI.",
  creator: "",
  hooks: "\n\nIMPORTANT: Output ONLY 10 viral hooks. One line each. Short, punchy, curiosity-driven. No numbering needed. No explanations. Just 10 raw hooks that make people stop scrolling. Example style:\n\"Nobody is telling you this about Instagram...\"\n\"This is why your reels are dying...\"\n\"Delete this app if you want to succeed...\"",
};

const StudioPage = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentTier = useTierLevel();
  const { expired, scriptsLeft, isFree } = useFreeTrialStatus();
  const isAgencyTier = currentTier === "agency" || currentTier === "scale_agency";
  const availableLengths = isFree ? freeLengths : (currentTier === "creator" ? starterLengths : allLengths);

  const [topic, setTopic] = useState(() => sessionStorage.getItem("studio_topic") || "");
  const [selectedTone, setSelectedTone] = useState(() => sessionStorage.getItem("studio_tone") || "Casual");
  const [selectedLength, setSelectedLength] = useState(() => sessionStorage.getItem("studio_length") || "30s Short");
  const [mode, setMode] = useState<ScriptMode>(() => (sessionStorage.getItem("studio_mode") as ScriptMode) || "quick");
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState(() => sessionStorage.getItem("studio_output") || "");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [dailyUsage, setDailyUsage] = useState<{
    used: number;
    quota: number | null;
    remaining: number;
    allowed: boolean;
    near_limit: boolean;
    fair_usage: boolean;
    message: string;
  } | null>(null);

  const loadUsageStatus = async () => {
    if (!user || isFree) return;
    const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "scripts" });
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    setDailyUsage({
      used: Number(row.used ?? 0),
      quota: row.quota == null ? null : Number(row.quota),
      remaining: Number(row.remaining ?? 0),
      allowed: Boolean(row.allowed),
      near_limit: Boolean(row.near_limit),
      fair_usage: Boolean(row.fair_usage),
      message: String(row.message ?? ""),
    });
  };

  // Persist state
  useEffect(() => { sessionStorage.setItem("studio_topic", topic); }, [topic]);
  useEffect(() => { sessionStorage.setItem("studio_tone", selectedTone); }, [selectedTone]);
  useEffect(() => { sessionStorage.setItem("studio_length", selectedLength); }, [selectedLength]);
  useEffect(() => { sessionStorage.setItem("studio_output", output); }, [output]);
  useEffect(() => { sessionStorage.setItem("studio_mode", mode); }, [mode]);

  useEffect(() => {
    const t = searchParams.get("topic");
    if (t) setTopic(decodeURIComponent(t));
  }, [searchParams]);

  useEffect(() => {
    void loadUsageStatus();
  }, [user?.id, isFree, currentTier]);

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first"); return; }
    if (isFree && (expired || scriptsLeft <= 0)) { setShowUpgrade(true); return; }

    if (!isFree) {
      const { data, error } = await db.rpc("get_usage_status", { p_feature_name: "scripts" });
      if (error) {
        toast.error(error.message || "Unable to verify your usage limits right now.");
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed) {
        toast.warning("Daily generation limit reached.", {
          description: "Upgrade to Pro Creator for higher limits.",
        });
        setShowUpgrade(true);
        setDailyUsage({
          used: Number(row?.used ?? 0),
          quota: row?.quota == null ? null : Number(row.quota),
          remaining: Number(row?.remaining ?? 0),
          allowed: Boolean(row?.allowed),
          near_limit: Boolean(row?.near_limit),
          fair_usage: Boolean(row?.fair_usage),
          message: String(row?.message ?? "Daily limit reached"),
        });
        return;
      }
    }

    setGenerating(true);
    setOutput("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const suffix = modePromptSuffix[mode];
      const requestId = crypto.randomUUID();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-script`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            topic: topic + suffix,
            tone: selectedTone,
            length: mode === "hooks" ? "30s Short" : selectedLength,
            user_id: user?.id,
            request_id: requestId,
          }),
        }
      );

      if (resp.status === 403) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error || "Script limit reached. Upgrade your plan!");
        setShowUpgrade(true);
        setGenerating(false);
        return;
      }

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Generation failed" }));
        if (err?.usage) {
          setDailyUsage({
            used: Number(err.usage.used ?? 0),
            quota: err.usage.quota == null ? null : Number(err.usage.quota),
            remaining: Number(err.usage.remaining ?? 0),
            allowed: Boolean(err.usage.allowed),
            near_limit: Boolean(err.usage.near_limit),
            fair_usage: Boolean(err.usage.fair_usage),
            message: String(err.usage.message ?? ""),
          });
        }
        toast.error(err.error || "Generation failed");
        setGenerating(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullOutput = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) { fullOutput += content; setOutput(fullOutput); }
          } catch { textBuffer = line + "\n" + textBuffer; break; }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) { fullOutput += content; setOutput(fullOutput); }
          } catch { /* ignore */ }
        }
      }

      if (user && fullOutput.trim()) {
        // History is now stored server-side after successful quota consumption.
        queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
        queryClient.refetchQueries({ queryKey: ["profile", user.id] });
        queryClient.invalidateQueries({ queryKey: ["scripts", user.id] });
      }

      await loadUsageStatus();
    } catch (e) {
      toast.error("Network error. Try again.");
    }
    setGenerating(false);
  };

  const effectiveLimitReached = (isFree && (expired || scriptsLeft <= 0)) || (!isFree && dailyUsage ? !dailyUsage.allowed : false);

  return (
    <div className="pt-14 md:pt-0">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <PenTool className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Script Engine</span>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Script Engine</h1>
          <Badge variant="outline" className={`text-[10px] font-mono ${isAgencyTier ? 'border-amber-500/30 text-amber-400' : 'border-primary/30 text-primary'}`}>
            {isFree
              ? `${scriptsLeft}/2 left`
              : dailyUsage?.quota
                ? `${dailyUsage.used}/${dailyUsage.quota} used today`
                  : isAgencyTier
                  ? "Unlimited"
                    : `${dailyUsage?.remaining ?? 0}/${dailyUsage?.quota ?? 0} left`}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">Enter a topic → Get a script → Record immediately.</p>
        {!!dailyUsage?.near_limit && !dailyUsage?.fair_usage && (
          <p className="text-xs text-amber-400/90 font-mono mt-2">{dailyUsage.message || `${dailyUsage.remaining} generations remaining today`}</p>
        )}
      </div>

      {/* Quick Generate Box */}
      <div className="glass-card p-5 mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="What's your video about? e.g. How to grow on Instagram..."
                className="input-glass h-12 text-sm pl-4 pr-4 rounded-xl"
                disabled={generating}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleGenerate}
              disabled={generating || effectiveLimitReached}
              className="btn-primary flex items-center justify-center gap-2 !py-3 !px-8 shrink-0 shimmer-btn disabled:opacity-50"
            >
              {effectiveLimitReached ? (
                <><Lock className="w-4 h-4" /> Upgrade</>
              ) : generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Wand2 className="w-4 h-4" /> Generate in Script Engine</>
              )}
            </motion.button>
          </div>

          {/* Mode & Options Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
            <ScriptModeSelector mode={mode} onChange={setMode} />
            <div className="flex gap-2 flex-wrap">
              {tones.map((tone) => (
                <button
                  key={tone}
                  onClick={() => setSelectedTone(tone)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth ${
                    selectedTone === tone
                      ? "bg-primary/12 text-primary border border-primary/25"
                      : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>

          {/* Length selector (hidden for hooks mode) */}
          {mode !== "hooks" && (
            <div className="flex gap-2 flex-wrap">
              {allLengths.map((len) => {
                const isLocked = !availableLengths.includes(len);
                return (
                  <button
                    key={len}
                    onClick={() => !isLocked && setSelectedLength(len)}
                    disabled={isLocked}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth flex items-center gap-1.5 ${
                      isLocked
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : selectedLength === len
                          ? "bg-primary/12 text-primary border border-primary/25"
                          : "text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {isLocked && <Lock className="w-3 h-3" />}
                    {len}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Output */}
      <ScriptOutput
        output={output}
        generating={generating}
        mode={mode}
        onRegenerate={handleGenerate}
        onTryDifferent={() => {
          const nextTone = tones[(tones.indexOf(selectedTone) + 1) % tones.length];
          setSelectedTone(nextTone);
          toast.info(`Switched to ${nextTone} tone. Hit Generate!`);
        }}
      />

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} />
    </div>
  );
};

export default StudioPage;
