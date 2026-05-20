import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { prefetchRoute } from "@/lib/routePrefetch";

const links = [
  { label: "Pricing", to: "/pricing" },
  { label: "API Access", to: "/api-access" },
  { label: "Changelog", to: "/changelog" },
  { label: "Docs", to: "/docs" },
];

export function PublicNavbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

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
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <Link to="/" onMouseEnter={() => prefetchRoute("/")} onFocus={() => prefetchRoute("/")}>
          <BrandMark size={24} withWordmark />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => {
                  event.preventDefault();
                  navigateWithTransition(item.to);
                }}
                onMouseEnter={() => prefetchRoute(item.to)}
                onFocus={() => prefetchRoute(item.to)}
                className={`rounded-md px-3 py-2 text-xs font-mono tracking-[0.08em] transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
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
          className="rounded-md border border-border/70 px-3 py-2 text-[11px] font-mono tracking-[0.08em] text-foreground transition-colors hover:border-primary/40"
        >
          Sign In
        </Link>
      </div>
    </header>
  );
}