import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — REPLACE AFTER WARRIORPLUS MARKETPLACE APPROVAL
// ─────────────────────────────────────────────────────────────────────────
// WarriorPlus requires a specific compliance / FTC disclosure block on
// every sales page. The exact text must be inserted before the product is
// submitted to the marketplace. Until then this placeholder is shown.
// ─────────────────────────────────────────────────────────────────────────
const WARRIORPLUS_DISCLAIMER_TEXT =
  "WarriorPlus compliance disclaimer will be inserted before product submission.";

export interface WarriorPlusDisclaimerProps {
  className?: string;
  align?: "left" | "center";
}

export function WarriorPlusDisclaimer({
  className,
  align = "left",
}: WarriorPlusDisclaimerProps) {
  return (
    <p
      className={cn(
        "text-[11px] text-muted-foreground/50 leading-relaxed max-w-md",
        align === "center" && "text-center mx-auto",
        align === "left" && "text-left",
        className,
      )}
    >
      {WARRIORPLUS_DISCLAIMER_TEXT}
    </p>
  );
}
