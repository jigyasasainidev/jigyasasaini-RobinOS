import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { SmartLink } from "@/components/SmartLink";
import { prefetchRoute } from "@/lib/routePrefetch";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

const BASE_LINKS = [
  { label: "Creator OS", to: "/creator-os", requiresSetting: "creator_os_page_enabled" as const },
  { label: "Pricing",    to: "/pricing" },
  { label: "API Access", to: "/api-access" },
  { label: "Changelog",  to: "/changelog" },
  { label: "Docs",       to: "/docs" },
];

export function PublicNavbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: settings } = usePlatformSettings();

  const links = BASE_LINKS.filter((link) => {
    if (link.requiresSetting === "creator_os_page_enabled") {
      // Default true — show unless explicitly disabled
      return settings ? settings.creator_os_page_enabled !== false : true;
    }
    return true;
  });

  const navigateWithTransition = (to: string) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      navigate(to);
      return;
    }

    if ("startViewTransition" in document) {
      const withViewTransition = document as Document & {
        startViewTransition: (callback: () => void) => { finished: Promise<void> };
      };
      withViewTransition.startViewTransition(() => navigate(to));
      return;
    }

    navigate(to);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/78 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <SmartLink to="/" onMouseEnter={() => prefetchRoute("/")} onFocus={() => prefetchRoute("/")}>
          <BrandMark size={24} withWordmark />
        </SmartLink>

        <nav className="hidden items-center gap-0.5 sm:flex">
          {links.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => {
                  event.preventDefault();
                  if (pathname === item.to) {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    return;
                  }
                  navigateWithTransition(item.to);
                }}
                onMouseEnter={() => prefetchRoute(item.to)}
                onFocus={() => prefetchRoute(item.to)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-mono tracking-[0.08em] transition-colors ${
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-foreground/80 hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link
          to="/login"
          onMouseEnter={() => prefetchRoute("/login")}
          onFocus={() => prefetchRoute("/login")}
          className="rounded-md border border-border/55 bg-background/35 px-3 py-1.5 text-[11px] font-mono tracking-[0.08em] text-foreground/90 backdrop-blur-md transition-all duration-200 hover:border-primary/35 hover:text-foreground hover:bg-primary/5 hover:shadow-[0_0_16px_hsl(217_91%_60%/0.12)]"
        >
          Sign In
        </Link>
      </div>
    </header>
  );
}