import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, TrendingUp, PenTool, Flame, Copy, Check } from "lucide-react";
import { useHistory, type ScanRecord, type ScriptRecord } from "@/hooks/useHistory";
import { toast } from "sonner";
import { SkeletonRow } from "@/components/ui/skeleton";

type TabType = "scans" | "scripts";

const HistoryPage = () => {
  const { scans, scripts, loading } = useHistory();
  const [tab, setTab] = useState<TabType>("scans");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const handleCopy = (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="pt-14 md:pt-0">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Activity Log</span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold">My History</h1>
        <p className="text-muted-foreground text-sm mt-1">Your complete activity — scans, scripts, everything saved forever.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border-glass bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-mono text-muted-foreground">Total Scans</span>
          </div>
          <p className="text-2xl font-semibold text-foreground">{scans.length}</p>
        </div>
        <div className="rounded-lg border-glass bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <PenTool className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-mono text-muted-foreground">Scripts Generated</span>
          </div>
          <p className="text-2xl font-semibold text-foreground">{scripts.length}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {(["scans", "scripts"] as TabType[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${tab === t ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-muted-foreground border border-border hover:text-foreground"}`}>
            {t === "scans" ? "Trend Scans" : "Generated Scripts"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading history">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : tab === "scans" ? (
        <div className="space-y-3">
          {scans.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-20">No scans yet. Go to Creator Intel and run Trend Radar.</p>
          ) : (
            scans.map((scan, i) => (
              <motion.div key={scan.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="rounded-xl border-glass bg-card p-4 cursor-pointer hover:border-primary/20 transition-all" onClick={() => setExpandedId(expandedId === scan.id ? null : scan.id)}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">{scan.niche}</span>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{formatDate(scan.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-primary">{(scan.topics as any[]).length} trends</span>
                    <button
                      onClick={(e) => {
                        const topicsText = (scan.topics as any[]).map((t: any) => `${t.title} (Heat: ${t.heat})\n${t.description || ""}`).join("\n\n");
                        handleCopy(`Niche: ${scan.niche}\n\n${topicsText}`, `scan-${scan.id}`, e);
                      }}
                      className="p-1.5 rounded-md bg-secondary hover:bg-primary/10 border border-border hover:border-primary/30 transition-all"
                      title="Copy scan data"
                    >
                      {copiedId === `scan-${scan.id}` ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                {expandedId === scan.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 pt-3 border-t border-border space-y-2">
                    {(scan.topics as any[]).map((topic: any, j: number) => (
                      <div key={j} className="flex items-center gap-2">
                        <Flame className="w-3 h-3 text-primary shrink-0" />
                        <span className="text-xs text-foreground flex-1">{topic.title}</span>
                        <span className="text-[10px] font-mono text-primary">{topic.heat}</span>
                        <button
                          onClick={(e) => handleCopy(topic.title, `topic-${scan.id}-${j}`, e)}
                          className="p-1 rounded hover:bg-primary/10 transition-colors"
                          title="Copy topic"
                        >
                          {copiedId === `topic-${scan.id}-${j}` ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-20">No scripts yet. Go to Script Engine and generate one.</p>
          ) : (
            scripts.map((script, i) => (
              <motion.div key={script.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="rounded-xl border-glass bg-card p-4 cursor-pointer hover:border-primary/20 transition-all" onClick={() => setExpandedId(expandedId === script.id ? null : script.id)}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">{script.topic}</span>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-muted-foreground">{script.tone}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">·</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{script.length}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">·</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{formatDate(script.created_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleCopy(script.output, `script-${script.id}`, e)}
                    className="p-1.5 rounded-md bg-secondary hover:bg-primary/10 border border-border hover:border-primary/30 transition-all"
                    title="Copy script"
                  >
                    {copiedId === `script-${script.id}` ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
                {expandedId === script.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-muted-foreground">SCRIPT OUTPUT</span>
                      <button
                        onClick={(e) => handleCopy(script.output, `script-full-${script.id}`, e)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-[10px] font-mono text-primary hover:bg-primary/20 transition-all"
                      >
                        {copiedId === `script-full-${script.id}` ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy All</>}
                      </button>
                    </div>
                    <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono">{script.output}</div>
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
