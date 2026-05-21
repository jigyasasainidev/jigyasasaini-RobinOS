import { Link } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { prefetchRoute } from "@/lib/routePrefetch";

const productLinks = [
  { label: "Features", to: "/minidemo" },
  { label: "Pricing", to: "/pricing" },
  { label: "Affiliates", to: "/affiliates" },
  { label: "API Access", to: "/api-access" },
  { label: "Changelog", to: "/changelog" },
];

const companyLinks = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
  { label: "Support", to: "/help" },
  { label: "Status Page", to: "/status" },
];

const legalLinks = [
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Terms of Service", to: "/terms" },
  { label: "Refund Policy", to: "/refund-policy" },
  { label: "Cookie Policy", to: "/cookie-policy" },
  { label: "Affiliate Terms", to: "/affiliate-terms" },
  { label: "AI Transparency", to: "/ai-transparency" },
  { label: "Disclaimer", to: "/disclaimer" },
];

const resourceLinks = [
  { label: "Documentation", to: "/docs" },
  { label: "Help Center", to: "/help" },
  { label: "Creator Guide", to: "/creator-guide" },
  { label: "Affiliate Guide", to: "/affiliate-guide" },
];

function LinkColumn({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return (
    <div className="relative border-t border-border/50 pt-5 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-2 -right-2 top-3 h-7 rounded-md bg-[radial-gradient(ellipse_at_left,hsl(var(--primary)/0.22),transparent_70%)] opacity-75 sm:hidden"
      />
      <p className="relative mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/90 drop-shadow-[0_0_14px_hsl(var(--primary)/0.35)] transition-opacity duration-300 sm:text-xs sm:tracking-[0.16em] sm:text-foreground/80 sm:drop-shadow-none">
        {title}
      </p>
      <ul className="space-y-2.5">
        {links.map((item) => (
          <li key={item.label}>
            <Link
              to={item.to}
              onMouseEnter={() => prefetchRoute(item.to)}
              onFocus={() => prefetchRoute(item.to)}
              className="text-sm text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5 inline-block"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="relative mt-16 overflow-hidden border-t border-border/70 bg-card/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.14),transparent_38%),radial-gradient(circle_at_82%_12%,hsl(var(--primary)/0.1),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.45)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.45)_1px,transparent_1px)] bg-[size:28px_28px] opacity-20" />

      <div className="relative mx-auto grid max-w-[1240px] gap-x-8 gap-y-9 px-4 py-12 sm:gap-y-8 sm:px-6 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
        <div>
          <BrandMark size={28} withWordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            RobinOS is a global AI content operating system helping creators generate scripts, trends, voice, and content workflows faster using modern AI infrastructure.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>Global creator platform</li>
            <li>Remote-first AI software company</li>
            <li>Billing system launching soon</li>
            <li>AI infrastructure powered by OpenAI</li>
          </ul>
          <div className="mt-4 space-y-1.5 text-sm">
            <a href="mailto:support@tryrobin.xyz" className="block text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5">support@tryrobin.xyz</a>
            <a href="https://tryrobin.xyz" target="_blank" rel="noreferrer" className="block text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5">tryrobin.xyz</a>
          </div>
        </div>

        <LinkColumn title="Product" links={productLinks} />
        <LinkColumn title="Company" links={companyLinks} />
        <LinkColumn title="Legal" links={legalLinks} />
        <LinkColumn title="Resources" links={resourceLinks} />
      </div>

      <div className="relative border-t border-border/60">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center px-4 py-5 text-sm text-muted-foreground sm:items-start sm:px-6">
          <p>© 2026 RobinOS. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}