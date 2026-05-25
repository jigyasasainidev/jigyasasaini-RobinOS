import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, TrendingUp, PenTool, Flame, Copy, Check,
  Pin, PinOff, ArrowRight, ChevronDown, ChevronUp,
} from "lucide-react";
import { useHistory, type ScanRecord, type ScriptRecord } from "@/hooks/useHistory";
import { toast } from "sonner";
import { SkeletonRow } from "@/components/ui/skeleton";
import { ConfidenceBar } from "@/components/ai/confidence-visual";
import { AnimatedCounter } from "@/components/ui/animated-counter";

type TabType = "scans" | "scripts";

const PINS_KEY = "robinos_pinned_scans_v1";

function loadPins(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]")); }
  catch { return new Set(); }
}
function savePins(s: Set<string>) {
  try { localStorage.setItem(PINS_KEY, JSON.stringify([...s])); } catch { /**/ }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function momentumLabel(heat: number): { label: string; color: string } {
  if (heat >= 90) return { label: "Exploding",   color: "hsl(0 80% 62%)"   };
  if (heat >= 80) return { label: "High Signal", color: "hsl(38 90% 58%)"  };
  if (heat >= 70) return { label: "Rising",      color: "hsl(217 91% 65%)" };
  if (heat >= 60) return { label: "Emerging",    color: "hsl(142 65% 55%)" };
  return              { label: "Stable",      color: "hsl(215 16% 48%)" };
}

const HistoryPage = () => {
  const navigate  = useNavigate();
  const { scans, scripts, loading } = useHistory();
  const [tab,        setTab]        = useState<TabType>("scans");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId,   setCopiedId]   = useState<string | null>(null);
  const [pins,       setPins]       = useState<Set<string>>(loadPins);

  const handleCopy = (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const togglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); toast.success("Unpinned"); }
      else               { next.add(id);    toast.success("Pinned to workspace"); }
      savePins(next);
      return next;
    });
  }, []);

  const pinnedScans   = scans.filter((s) => pins.has(s.id));
  const unpinnedScans = scans.filter((s) => !pins.has(s.id));

  return (
    <div className="pt-14 md:pt-0 content-reveal">
      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground/55">
            Creator Workspace
          </span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold mb-1">My History</h1>
        <p className="text-muted-foreground/55 text-sm">
          Your creator intelligence archive — scans, scripts, pinned ideas.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: TrendingUp, label: "Trend Scans",        value: scans.length   },
          { icon: PenTool,    label: "Scripts Generated",  value: scripts.length },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl p-4"
            style={{ background: "linear-gradient(145deg, hsl(222 28% 7.5%) 0%, hsl(222 26% 6%) 100%)", border: "1px solid hsl(217 28% 11%)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Icon className="w-3.5 h-3.5 text-primary/60" strokeWidth={1.5} />
              <span className="text-[10px] font-mono text-muted-foreground/45">{label}</span>
            </div>
            <p className="text-2xl font-semibold text-foreground/90" style={{ fontVariantNumeric: "tabular-nums" }}>
              <AnimatedCounter value={value} />
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {(["scans", "scripts"] as TabType[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
            style={tab === t ? {
              background: "hsl(217 91% 60% / 0.1)",
              border: "1px solid hsl(217 91% 60% / 0.28)",
              color: "hsl(217 91% 68%)",
            } : {
              background: "hsl(222 28% 7%)",
              border: "1px solid hsl(217 28% 12%)",
              color: "hsl(215 16% 42%)",
            }}>
            {t === "scans" ? `Trend Scans${scans.length ? ` · ${scans.length}` : ""}` : `Scripts${scripts.length ? ` · ${scripts.length}` : ""}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : tab === "scans" ? (
        <div className="space-y-5">

          {/* Pinned section */}
          {pinnedScans.length > 0 && (
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-primary/45 mb-2.5 flex items-center gap-1.5">
                <Pin className="w-3 h-3" /> Pinned to Workspace
              </p>
              <div className="space-y-2">
                {pinnedScans.map((scan, i) => (
                  <ScanCard key={scan.id} scan={scan} index={i} pinned
                    expanded={expandedId === scan.id}
                    copiedId={copiedId}
                    onToggle={() => setExpandedId(expandedId === scan.id ? null : scan.id)}
                    onCopy={handleCopy}
                    onPin={togglePin}
                    onUseInStudio={(title) => navigate(`/dashboard/studio?topic=${encodeURIComponent(title)}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All scans */}
          {unpinnedScans.length === 0 && pinnedScans.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center text-center px-6 py-14 rounded-2xl"
              style={{ background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)", border: "1px dashed hsl(217 28% 13%)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.18)" }}>
                <TrendingUp className="w-5 h-5 text-primary/40" strokeWidth={1.5} />
              </div>
              <p className="text-xs font-medium text-foreground/70 mb-1.5">No trend scans yet</p>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed max-w-xs mb-5">
                Run your first scan in Trend Scanner and RobinOS will archive your results here automatically.
              </p>
              <a href="/dashboard/trend-scanner"
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
                Go to Trend Scanner →
              </a>
            </motion.div>
          ) : unpinnedScans.length > 0 && (
            <div>
              {pinnedScans.length > 0 && (
                <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-muted-foreground/30 mb-2.5">
                  All Scans
                </p>
              )}
              <div className="space-y-2">
                {unpinnedScans.map((scan, i) => (
                  <ScanCard key={scan.id} scan={scan} index={i} pinned={false}
                    expanded={expandedId === scan.id}
                    copiedId={copiedId}
                    onToggle={() => setExpandedId(expandedId === scan.id ? null : scan.id)}
                    onCopy={handleCopy}
                    onPin={togglePin}
                    onUseInStudio={(title) => navigate(`/dashboard/studio?topic=${encodeURIComponent(title)}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {scripts.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center text-center px-6 py-14 rounded-2xl"
              style={{ background: "linear-gradient(160deg, hsl(222 28% 7%) 0%, hsl(222 26% 5.5%) 100%)", border: "1px dashed hsl(217 28% 13%)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.18)" }}>
                <PenTool className="w-5 h-5 text-primary/40" strokeWidth={1.5} />
              </div>
              <p className="text-xs font-medium text-foreground/70 mb-1.5">No scripts generated yet</p>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed max-w-xs mb-5">
                Generate your first script in Script Engine. Every script is saved here so you can revisit and copy anytime.
              </p>
              <a href="/dashboard/studio"
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 68%)" }}>
                Go to Script Engine →
              </a>
            </motion.div>
          ) : scripts.map((script, i) => (
            <ScriptCard key={script.id} script={script} index={i}
              expanded={expandedId === script.id}
              copiedId={copiedId}
              onToggle={() => setExpandedId(expandedId === script.id ? null : script.id)}
              onCopy={handleCopy}
              onUseInStudio={(topic) => navigate(`/dashboard/studio?topic=${encodeURIComponent(topic)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Scan Card ──────────────────────────────────────────────
interface ScanCardProps {
  scan:          ScanRecord;
  index:         number;
  pinned:        boolean;
  expanded:      boolean;
  copiedId:      string | null;
  onToggle:      () => void;
  onCopy:        (text: string, id: string, e: React.MouseEvent) => void;
  onPin:         (id: string, e: React.MouseEvent) => void;
  onUseInStudio: (title: string) => void;
}

const ScanCard = ({ scan, index, pinned, expanded, copiedId, onToggle, onCopy, onPin, onUseInStudio }: ScanCardProps) => {
  const topics   = scan.topics as any[];
  const topHeat  = topics.length > 0 ? Math.max(...topics.map((t: any) => t.heat ?? 0)) : 0;
  const momentum = momentumLabel(topHeat);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.28 }}
      className="rounded-xl overflow-hidden cursor-pointer group"
      style={{
        background: pinned
          ? "linear-gradient(145deg, hsl(217 91% 60% / 0.06) 0%, hsl(222 28% 6.5%) 100%)"
          : "linear-gradient(145deg, hsl(222 28% 7.5%) 0%, hsl(222 26% 6%) 100%)",
        border: pinned ? "1px solid hsl(217 91% 60% / 0.22)" : "1px solid hsl(217 28% 11%)",
      }}
      onClick={onToggle}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.15)" }}>
          <TrendingUp className="w-4 h-4 text-primary/60" strokeWidth={1.5} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-foreground/88 leading-tight">{scan.niche}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${momentum.color}15`, color: momentum.color, border: `1px solid ${momentum.color}30` }}>
              {momentum.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40">
            <span>{relativeTime(scan.created_at)}</span>
            <span>·</span>
            <span>{topics.length} signals</span>
            {topHeat > 0 && <><span>·</span><span style={{ color: momentum.color }}>Peak {topHeat}</span></>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={(e) => onPin(scan.id, e)}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
            style={{
              background: pinned ? "hsl(217 91% 60% / 0.12)" : "hsl(217 28% 9%)",
              border: pinned ? "1px solid hsl(217 91% 60% / 0.28)" : "1px solid hsl(217 28% 14%)",
            }}
            title={pinned ? "Unpin" : "Pin to workspace"}>
            {pinned
              ? <PinOff className="w-3 h-3 text-primary" />
              : <Pin className="w-3 h-3 text-muted-foreground/40" />}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              const text = topics.map((t: any) => `${t.title} (Heat: ${t.heat})\n${t.description || ""}`).join("\n\n");
              onCopy(`Niche: ${scan.niche}\n\n${text}`, `scan-${scan.id}`, e);
            }}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
            style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)" }}
            title="Copy scan">
            {copiedId === `scan-${scan.id}`
              ? <Check className="w-3 h-3 text-primary" />
              : <Copy className="w-3 h-3 text-muted-foreground/40" />}
          </motion.button>
          <div className="w-5 h-5 flex items-center justify-center">
            {expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
          </div>
        </div>
      </div>

      {/* Expanded topics */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2.5"
              style={{ borderTop: "1px solid hsl(217 28% 10%)" }}>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 pt-3">
                Detected Signals
              </p>
              {topics.map((topic: any, j: number) => {
                const m = momentumLabel(topic.heat ?? 0);
                return (
                  <div key={j} className="rounded-lg p-3 space-y-2"
                    style={{ background: "hsl(222 28% 5.5%)", border: "1px solid hsl(217 28% 10%)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground/85 leading-tight">{topic.title}</p>
                        {topic.description && (
                          <p className="text-[10px] text-muted-foreground/45 mt-0.5 leading-relaxed line-clamp-2">
                            {topic.description}
                          </p>
                        )}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                        onClick={(e) => { e.stopPropagation(); onUseInStudio(topic.title); }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9.5px] font-medium transition-all"
                        style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 65%)" }}>
                        Use <ArrowRight className="w-2.5 h-2.5" />
                      </motion.button>
                    </div>
                    <ConfidenceBar heat={topic.heat ?? 0} compact />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ── Script Card ────────────────────────────────────────────
interface ScriptCardProps {
  script:        ScriptRecord;
  index:         number;
  expanded:      boolean;
  copiedId:      string | null;
  onToggle:      () => void;
  onCopy:        (text: string, id: string, e: React.MouseEvent) => void;
  onUseInStudio: (topic: string) => void;
}

const ScriptCard = ({ script, index, expanded, copiedId, onToggle, onCopy, onUseInStudio }: ScriptCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.04, duration: 0.28 }}
    className="rounded-xl overflow-hidden cursor-pointer"
    style={{ background: "linear-gradient(145deg, hsl(222 28% 7.5%) 0%, hsl(222 26% 6%) 100%)", border: "1px solid hsl(217 28% 11%)" }}
    onClick={onToggle}
  >
    <div className="flex items-start gap-3 p-4">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "hsl(280 65% 60% / 0.08)", border: "1px solid hsl(280 65% 60% / 0.15)" }}>
        <PenTool className="w-4 h-4" style={{ color: "hsl(280 65% 62% / 0.7)" }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground/88 leading-tight mb-0.5 truncate">{script.topic}</p>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40 flex-wrap">
          <span>{relativeTime(script.created_at)}</span>
          <span>·</span>
          <span>{script.tone}</span>
          <span>·</span>
          <span>{script.length}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          onClick={(e) => { e.stopPropagation(); onUseInStudio(script.topic); }}
          className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
          style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)" }}
          title="Use topic in Studio">
          <ArrowRight className="w-3 h-3 text-muted-foreground/40" />
        </motion.button>
        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          onClick={(e) => onCopy(script.output, `script-${script.id}`, e)}
          className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
          style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)" }}
          title="Copy script">
          {copiedId === `script-${script.id}`
            ? <Check className="w-3 h-3 text-primary" />
            : <Copy className="w-3 h-3 text-muted-foreground/40" />}
        </motion.button>
        <div className="w-5 h-5 flex items-center justify-center">
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
        </div>
      </div>
    </div>
    <AnimatePresence>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}
          className="overflow-hidden"
        >
          <div className="px-4 pb-4" style={{ borderTop: "1px solid hsl(217 28% 10%)" }}>
            <div className="flex items-center justify-between pt-3 mb-2">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30">
                Script Output
              </span>
              <button
                onClick={(e) => onCopy(script.output, `script-full-${script.id}`, e)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[9.5px] font-mono transition-all"
                style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 65%)" }}>
                {copiedId === `script-full-${script.id}` ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy All</>}
              </button>
            </div>
            <div className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap max-h-[320px] overflow-y-auto font-mono rounded-lg p-3"
              style={{ background: "hsl(222 28% 5.5%)", border: "1px solid hsl(217 28% 10%)" }}>
              {script.output}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
);

export default HistoryPage;
