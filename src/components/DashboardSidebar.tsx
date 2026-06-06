import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Zap, PenTool, Settings, LogOut, Clock, Link2, Crown, Mic, Film, BarChart3, Type, Flag, TrendingUp, Music, Hash } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanKey, useIsProOrAbove, useIsAgency } from "@/hooks/useEntitlements";
import { BrandMark } from "@/components/BrandMark";
import { prefetchRoute } from "@/lib/routePrefetch";
import { PlanBadge, LiveDot } from "@/components/ui/status-badge";

// ── Sidebar workflow structure ─────────────────────────────
// ORDER: Trend Discovery → Script → Voice → Video → Captions
//        → Analytics → Referrals → History → Settings
// Three section groups only: CREATE / GROW / SYSTEM

const sidebarSections = [
  {
    label: "CREATE",
    items: [
      { to: "/dashboard/trend-scanner",  label: "Trend Scanner",  icon: TrendingUp },
      { to: "/dashboard/studio",         label: "Script Engine",  icon: PenTool },
      { to: "/dashboard/voice",          label: "Voice Studio",   icon: Mic },
      { to: "/dashboard/video",          label: "Video Studio",   icon: Film },
      { to: "/dashboard/audio-hashtag",  label: "Audio & Hashtag",icon: Music },
      { to: "/dashboard/caption",        label: "Caption",        icon: Type },
    ],
  },
  {
    label: "GROW",
    items: [
      { to: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/dashboard/referrals",  label: "Referrals", icon: Link2 },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { to: "/dashboard/history",  label: "History",  icon: Clock },
      { to: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function DashboardSidebar() {
  const { signOut } = useAuth();
  const location = useLocation();
  const plan = usePlanKey();
  const isAgency = useIsAgency();
  const isProOrAbove = useIsProOrAbove();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const closeDrawer = () => setMobileOpen(false);

  const handleNavClick = () => {
    closeDrawer();
    // Scroll to top if already on this route
    if (location.pathname) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl glass-strong border border-border/50 shadow-[0_4px_20px_hsl(0_0%_0%/0.4)]"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5 text-foreground" />
      </button>

      {/* ── Mobile drawer overlay ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden"
              onClick={closeDrawer}
            />

            {/* Drawer panel */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 left-0 w-72 z-50 flex flex-col bg-card/95 backdrop-blur-xl border-r border-border/60 shadow-[8px_0_40px_hsl(0_0%_0%/0.5)] md:hidden"
            >
              {/* Drawer header */}
              <div className="h-16 flex items-center justify-between px-5 border-b border-border/60 shrink-0">
                <BrandMark size={20} withWordmark />
                <button
                  onClick={closeDrawer}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  aria-label="Close navigation menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer nav body */}
              <nav className="flex-1 p-4 space-y-5 overflow-y-auto">
                {sidebarSections.map((section) => (
                  <div key={section.label} className="space-y-1.5">
                    <div className="px-3 pt-1 pb-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                      {section.label}
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const active = location.pathname === item.to;
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={handleNavClick}
                            onMouseEnter={() => prefetchRoute(item.to)}
                            onFocus={() => prefetchRoute(item.to)}
                            className="block"
                          >
                            <div
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm border transition-all duration-300 ${active
                                  ? "bg-gradient-to-r from-primary/14 via-primary/8 to-transparent text-primary border-primary/25"
                                  : "text-foreground border-transparent hover:text-foreground hover:bg-secondary/70 hover:border-border/60"
                                }`}
                            >
                              <div className={`w-8 h-8 rounded-md flex items-center justify-center border shrink-0 transition-all duration-300 ${active
                                  ? "bg-primary/10 border-primary/30"
                                  : "bg-secondary/50 border-border/50"
                                }`}>
                                <item.icon strokeWidth={1.9} className="w-4 h-4" />
                              </div>
                              <span className="font-medium truncate">{item.label}</span>
                            </div>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              {/* Drawer footer */}
              <div className="p-4 border-t border-border/60 shrink-0">
                <a
                  href="/report-abuse"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm border border-red-500/15 bg-red-500/5 text-red-400/70 hover:text-red-400 hover:border-red-500/25 w-full transition-colors mb-2"
                >
                  <Flag className="w-4 h-4 shrink-0" />
                  <span>Report Abuse</span>
                </a>
                <button
                  onClick={() => { signOut(); closeDrawer(); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:text-foreground hover:bg-secondary/70 w-full transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Desktop sidebar (unchanged) ── */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen border-r border-border bg-sidebar shrink-0">
        <div className="h-16 flex items-center justify-between px-6 border-b border-border">
          <motion.div animate={{ opacity: [0.75, 1, 0.75] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <BrandMark size={22} withWordmark />
          </motion.div>
          <div className="flex items-center gap-2">
            <LiveDot color={plan === "free" ? "amber" : "green"} size="sm" />
            <PlanBadge plan={plan} />
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
          {sidebarSections.map((section, sectionIndex) => (
            <div key={section.label} className="space-y-1.5">
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                {section.label}
              </div>

              <div className="space-y-1">
                {section.items.map((item, itemIndex) => {
                  const active = location.pathname === item.to;
                  const order  = sectionIndex * 6 + itemIndex;

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onMouseEnter={() => prefetchRoute(item.to)}
                      onFocus={() => prefetchRoute(item.to)}
                      onClick={() => { if (location.pathname === item.to) window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="block"
                    >
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{
                          opacity: 1,
                          x: 0,
                          boxShadow: active
                            ? ["0 0 0 hsl(217 91% 60% / 0)", "0 0 18px hsl(217 91% 60% / 0.14)", "0 0 0 hsl(217 91% 60% / 0)"]
                            : "0 0 0 hsl(217 91% 60% / 0)",
                        }}
                        transition={{
                          delay: order * 0.04,
                          duration: 0.3,
                          boxShadow: active
                            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                            : { duration: 0.2 },
                        }}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm border transition-all duration-300 ${active
                            ? "bg-gradient-to-r from-primary/14 via-primary/8 to-transparent text-primary border-primary/25"
                            : "text-sidebar-foreground border-transparent hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/90 hover:border-border/60"
                          }`}
                        whileHover={{ x: 2 }}
                      >
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center border shrink-0 transition-all duration-300 ${active
                            ? "bg-primary/10 border-primary/30 shadow-[inset_0_1px_0_hsl(217_91%_60%/0.2)]"
                            : "bg-sidebar-accent/30 border-border/50"
                          }`}>
                          <item.icon strokeWidth={1.9} className="w-4 h-4" />
                        </div>
                        <span className="font-medium truncate">{item.label}</span>
                      </motion.div>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <a
            href="/report-abuse"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm border border-red-500/15 bg-red-500/5 text-red-400/70 hover:text-red-400 hover:border-red-500/25 w-full transition-colors mb-2"
          >
            <Flag className="w-4 h-4 shrink-0" />
            <span>Report Abuse</span>
          </a>
          <button onClick={signOut} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent w-full transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}