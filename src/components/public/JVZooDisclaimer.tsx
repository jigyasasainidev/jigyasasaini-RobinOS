import { cn } from "@/lib/utils";

// Placeholder disclaimer text for the JVZoo landing page.
// This will be replaced with the official JVZoo compliance text later.
const JVZOO_DISCLAIMER_TEXT =
  "JVZoo compliance disclaimer will be inserted before product submission.";

export interface JVZooDisclaimerProps {
  className?: string;
  align?: "left" | "center";
}

export function JVZooDisclaimer({
  className,
  align = "left",
}: JVZooDisclaimerProps) {
  return (
    <p
      className={cn(
        "text-[11px] text-muted-foreground/50 leading-relaxed max-w-md",
        align === "center" && "text-center mx-auto",
        align === "left" && "text-left",
        className,
      )}
    >
      {JVZOO_DISCLAIMER_TEXT}
    </p>
  );
}
