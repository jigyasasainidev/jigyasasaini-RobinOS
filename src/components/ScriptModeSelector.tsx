import { Zap, Layers, Lightbulb } from "lucide-react";

export type ScriptMode = "quick" | "creator" | "hooks";

interface Props {
  mode: ScriptMode;
  onChange: (mode: ScriptMode) => void;
}

const modes = [
  { id: "quick" as const, label: "Quick", icon: Zap, desc: "Ready-to-record script" },
  { id: "creator" as const, label: "Creator", icon: Layers, desc: "Detailed with sections" },
  { id: "hooks" as const, label: "Hooks", icon: Lightbulb, desc: "10 viral hooks" },
];

export function ScriptModeSelector({ mode, onChange }: Props) {
  return (
    <div className="flex gap-2">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`mode-tab flex items-center gap-2 ${mode === m.id ? "active" : ""}`}
        >
          <m.icon className="w-3.5 h-3.5" />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
