import { Link } from "react-router-dom";
import { Shield, ShieldCheck, Eye, Zap } from "lucide-react";
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
  { label: "Acceptable Use Policy", to: "/acceptable-use-policy" },
  { label: "Trust & Safety", to: "/trust-safety" },
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

const trustBadges = [
  { icon: ShieldCheck, label: "AI Moderation Active" },
  { icon: Eye, label: "Abuse Prevention Enabled" },
  { icon: Shield, label: "Enterprise-grade Security" },
  { icon: Zap, label: "Responsible AI Platform" },
];

export function PublicFooter() {
  return (
    <footer className="relative mt-16 overflow-hidden border-t border-border/70 bg-card/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.14),transparent_38%),radial-gradient(circle_at_82%_12%,hsl(var(--primary)/0.1),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.45)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.45)_1px,transparent_1px)] bg-[size:28px_28px] opacity-20" />

      {/* Trust Compliance Strip */}
      <div className="relative border-b border-border/40" style={{ background: "hsl(222 28% 5.5% / 0.6)" }}>
        <div className="mx-auto max-w-[1240px] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {trustBadges.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2.5s" }} />
                <Icon className="w-3 h-3 text-primary/50" />
                <span className="text-[10px] font-mono text-muted-foreground/40 tracking-wider">{label}</span>
              </div>
            ))}
            <div className="ml-auto hidden sm:flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground/28 tracking-wider">Built with Responsible AI Principles</span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto grid max-w-[1240px] gap-x-8 gap-y-9 px-4 py-12 sm:gap-y-8 sm:px-6 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
        <div>
          <BrandMark size={28} withWordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            RobinOS is a global AI content operating system helping creators generate scripts, trends, voice, and content workflows faster using responsible AI infrastructure.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>Global creator platform</li>
            <li>Remote-first AI software company</li>
            <li>Protected by automated AI moderation</li>
            <li>AI infrastructure powered by Groq</li>
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
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 items-start px-4 py-5 sm:px-6">
          {/* Compliance statement */}
          <p className="text-[10.5px] text-muted-foreground/40 leading-relaxed max-w-2xl">
            RobinOS actively blocks unsafe, exploitative, hateful, violent, and illegal AI-generated content. All generations are protected by automated moderation systems.
          </p>
          <div className="flex flex-wrap items-center justify-between w-full gap-3 mt-1">
            <p className="text-sm text-muted-foreground">© 2026 RobinOS. All rights reserved.</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="mailto:trust@tryrobin.xyz"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-mono tracking-wider uppercase transition-all hover:opacity-90"
                style={{ background: "hsl(0 72% 55% / 0.08)", border: "1px solid hsl(0 72% 55% / 0.18)", color: "hsl(0 72% 65%)" }}
              >
                <span className="w-1 h-1 rounded-full bg-red-400" />
                Report Abuse
              </a>
              <Link to="/trust-safety" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Trust & Safety</Link>
              <Link to="/acceptable-use-policy" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Acceptable Use</Link>
              <Link to="/privacy" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Terms</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
