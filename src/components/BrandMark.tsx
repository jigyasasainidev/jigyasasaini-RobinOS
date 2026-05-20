import robinosLogo from "@/assets/robinos-logo.png";

type BrandMarkProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
};

export function BrandMark({ size = 28, withWordmark = true, className = "" }: BrandMarkProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img
        src={robinosLogo}
        alt="RobinOS bird logo"
        width={size}
        height={size}
        className="object-contain rounded-md"
        loading="lazy"
      />
      {withWordmark && <span className="text-xs font-mono tracking-[0.22em] uppercase text-chrome-dim">RobinOS</span>}
    </div>
  );
}
