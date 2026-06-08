import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { SmartLink } from "@/components/SmartLink";
import { prefetchRoute } from "@/lib/routePrefetch";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

const BASE_LINKS = [
  { label: "Creator OS", to: "/creator-os", requiresSetting: "creator_os_page_enabled" as const },
  { label: "Blog",       to: "/blog" },
  { label: "Resources",  to: "/resources" },
  { label: "Pricing",    to: "/pricing" },
  { label: "Launch Partners", to: "/launch-partners" },
  { label: "API Access", to: "/api-access" },
  { label: "Changelog",  to: "/changelog" },
  { label: "Docs",       to: "/docs" },
];

export function PublicNavbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: settings } = usePlatformSettings();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

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

  // Close mobile menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const isInMenuWrapper = menuWrapperRef.current && menuWrapperRef.current.contains(event.target as Node);
      const isInMobileMenu = mobileMenuRef.current && mobileMenuRef.current.contains(event.target as Node);
      if (!isInMenuWrapper && !isInMobileMenu) {
        setMobileMenuOpen(false);
      }
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [mobileMenuOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleMobileNavClick = (to: string) => {
    if (pathname === to) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      navigateWithTransition(to);
    }
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/78 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <SmartLink to="/" onMouseEnter={() => prefetchRoute("/")} onFocus={() => prefetchRoute("/")}>
          <BrandMark size={24} withWordmark />
        </SmartLink>

        <nav className="hidden items-center gap-1.5 sm:flex">
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
                className={`rounded-md px-3 py-1.5 text-xs font-mono tracking-[0.08em] transition-colors ${
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

        <div className="flex items-center gap-2">
          <div ref={menuWrapperRef} className="flex items-center gap-2">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="flex sm:hidden items-center justify-center w-9 h-9 rounded-md text-foreground/80 hover:text-foreground hover:bg-primary/5 transition-colors"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="9" cy="4" r="1.5" fill="currentColor" />
                <circle cx="9" cy="9" r="1.5" fill="currentColor" />
                <circle cx="9" cy="14" r="1.5" fill="currentColor" />
              </svg>
            </button>

            <Link
              to="/login"
              onMouseEnter={() => prefetchRoute("/login")}
              onFocus={() => prefetchRoute("/login")}
              className="hidden sm:inline-flex rounded-md border border-border/55 bg-background/35 px-3 py-1.5 text-[11px] font-mono tracking-[0.08em] text-foreground/90 backdrop-blur-md transition-all duration-200 hover:border-primary/35 hover:text-foreground hover:bg-primary/5 hover:shadow-[0_0_16px_hsl(217_91%_60%/0.12)]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div ref={mobileMenuRef} className="sm:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl">
          <nav className="mx-auto max-w-[1240px] px-4 py-3 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleMobileNavClick("/login")}
              onMouseEnter={() => prefetchRoute("/login")}
              onFocus={() => prefetchRoute("/login")}
              className={`flex items-center rounded-md px-3 py-3 text-xs font-mono tracking-[0.08em] transition-colors text-left min-h-[44px] ${
                pathname === "/login"
                  ? "bg-primary/12 text-primary"
                  : "text-foreground/80 hover:text-foreground hover:bg-primary/5"
              }`}
            >
              Sign In
            </button>
            {links.map((item) => {
              const active = pathname === item.to;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => handleMobileNavClick(item.to)}
                  onMouseEnter={() => prefetchRoute(item.to)}
                  onFocus={() => prefetchRoute(item.to)}
                  className={`flex items-center rounded-md px-3 py-3 text-xs font-mono tracking-[0.08em] transition-colors text-left min-h-[44px] ${
                    active
                      ? "bg-primary/12 text-primary"
                      : "text-foreground/80 hover:text-foreground hover:bg-primary/5"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}