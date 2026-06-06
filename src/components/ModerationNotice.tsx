import { Shield } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * ModerationNotice
 * Small compliance notice shown on all AI generation screens.
 * Signals to reviewers that moderation is active and visible.
 */
export function ModerationNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 ${className}`}
      style={{ background: "hsl(217 91% 60% / 0.04)", border: "1px solid hsl(217 91% 60% / 0.1)" }}
    >
      <Shield className="w-3.5 h-3.5 text-primary/50 mt-0.5 shrink-0" />
      <p className="text-[10.5px] text-muted-foreground/55 leading-relaxed">
        <span className="text-primary/60 font-medium">AI Moderation Active.</span>{" "}
        Unsafe, harmful, or policy-violating generations are automatically blocked and logged.
        Repeated violations may result in account suspension.{" "}
        <Link to="/acceptable-use-policy" className="text-primary/50 hover:text-primary/80 underline underline-offset-2 transition-colors">
          Acceptable Use Policy
        </Link>
        {" · "}
        <Link to="/trust-safety" className="text-primary/50 hover:text-primary/80 underline underline-offset-2 transition-colors">
          Trust & Safety
        </Link>
      </p>
    </div>
  );
}
