import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, RefreshCw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import type { ScriptMode } from "./ScriptModeSelector";
import { GenerationState, SCRIPT_STAGES } from "@/components/ai/generation-state";

interface Props {
  output: string;
  generating: boolean;
  mode: ScriptMode;
  onRegenerate: () => void;
  onTryDifferent: () => void;
}

export function ScriptOutput({ output, generating, mode, onRegenerate, onTryDifferent }: Props) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleCopy = (text?: string) => {
    navigator.clipboard.writeText(text || output);
    setCopied(true);
    toast.success("Script copied. Start recording. 🎬", { duration: 3000 });
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSection = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (generating && !output) {
    return (
      <AnimatePresence>
        <GenerationState active={generating} stages={SCRIPT_STAGES} showStream />
      </AnimatePresence>
    );
  }

  if (!output) {
    return (
      <div className="min-h-[300px] flex items-center justify-center rounded-2xl glass-card p-8">
        <p className="text-muted-foreground/30 text-sm font-mono">Your script will appear here...</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleCopy()} className="btn-primary flex items-center gap-2 !py-2.5 !px-5 shimmer-btn">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied!" : "Copy Script"}
        </button>
        <button onClick={onRegenerate} className="btn-secondary flex items-center gap-2 !py-2.5 !px-4">
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate
        </button>
        <button onClick={onTryDifferent} className="btn-secondary flex items-center gap-2 !py-2.5 !px-4">
          <Sparkles className="w-3.5 h-3.5" />
          Try Different Style
        </button>
      </div>

      {/* Output Content */}
      <div className="rounded-2xl glass-card p-6 max-h-[600px] overflow-y-auto">
        {mode === "quick" && renderQuickMode(output)}
        {mode === "creator" && renderCreatorMode(output, collapsed, toggleSection, handleCopy)}
        {mode === "hooks" && renderHooksMode(output)}
      </div>
    </motion.div>
  );
}

function renderQuickMode(text: string) {
  const lines = text.split("\n").filter(l => l.trim());
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-mono uppercase tracking-widest text-primary">🎬 Ready to Record</span>
      </div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("🎬") || trimmed.startsWith("🎥") || trimmed.startsWith("🗣")) {
          return (
            <p key={i} className="text-[11px] text-muted-foreground font-mono mt-4 pt-3 border-t border-border/30">
              {trimmed}
            </p>
          );
        }
        if (trimmed.match(/^(Line \d|Hook)/i) || i === 0) {
          return (
            <p key={i} className={`text-foreground text-sm leading-[1.9] ${i === 0 ? "text-primary font-semibold text-base" : ""}`}>
              {trimmed.replace(/^Line \d+[:\s]*/i, "").replace(/^Hook[:\s]*/i, "")}
            </p>
          );
        }
        // Clean markdown
        const clean = trimmed.replace(/\*\*/g, "").replace(/^#+\s*/, "").replace(/^[-•]\s*/, "");
        if (!clean) return null;
        return <p key={i} className="text-foreground/90 text-sm leading-[1.9]">{clean}</p>;
      })}
    </div>
  );
}

function renderCreatorMode(
  text: string,
  collapsed: Record<string, boolean>,
  toggleSection: (key: string) => void,
  handleCopy: (text?: string) => void
) {
  const sections: { title: string; content: string[] }[] = [];
  let current: { title: string; content: string[] } = { title: "Script", content: [] };

  text.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (trimmed.match(/^#{1,3}\s/)) {
      if (current.content.length > 0) sections.push(current);
      current = { title: trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, ""), content: [] };
    } else if (trimmed) {
      current.content.push(trimmed);
    }
  });
  if (current.content.length > 0) sections.push(current);

  if (sections.length === 0) {
    sections.push({ title: "Script", content: text.split("\n").filter(l => l.trim()) });
  }

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        const key = `${section.title}-${i}`;
        const isCollapsed = collapsed[key];
        const isHook = section.title.toLowerCase().includes("hook");
        const sectionText = section.content.join("\n");

        return (
          <div key={key} className={`rounded-xl border transition-all ${isHook ? "border-primary/20 bg-primary/5" : "border-border/30 bg-secondary/20"}`}>
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isHook ? "bg-primary" : "bg-muted-foreground/40"}`} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${isHook ? "text-primary" : "text-foreground"}`}>
                  {section.title}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(sectionText); }}
                  className="text-muted-foreground/40 hover:text-primary transition-colors p-1"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" />}
              </div>
            </button>
            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-2">
                    {section.content.map((line, j) => {
                      const clean = line.replace(/\*\*/g, "");
                      const isBold = line.startsWith("**") && line.endsWith("**");
                      return (
                        <p key={j} className={`text-xs leading-[1.9] ${isBold ? "text-foreground font-medium" : "text-foreground/75"}`}>
                          {clean}
                        </p>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function renderHooksMode(text: string) {
  const lines = text.split("\n").filter(l => l.trim()).map(l => l.trim().replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").replace(/\*\*/g, "").replace(/^[""]|[""]$/g, ""));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-mono uppercase tracking-widest text-primary">🔥 Viral Hooks</span>
      </div>
      {lines.slice(0, 10).map((hook, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-start gap-3 p-3 rounded-xl bg-secondary/30 border border-border/20 hover:border-primary/20 transition-all group"
        >
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0 mt-0.5">
            {i + 1}
          </span>
          <p className="text-foreground text-sm leading-relaxed flex-1">"{hook}"</p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(hook);
              toast.success("Hook copied!");
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-primary"
          >
            <Copy className="w-3 h-3" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}
