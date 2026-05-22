import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, PenTool, Settings, LogOut, Clock, Link2, Crown, Mic, Film, Music, BarChart3, Type, Flag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanKey, useIsProOrAbove, useIsAgency } from "@/hooks/useEntitlements";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";
import { prefetchRoute } from "@/lib/routePrefetch";

const sidebarSections = [
  {
    label: "CREATE",
    items: [
      { to: "/dashboard/trending", label: "Idea Stream", icon: Music },
      { to: "/dashboard/intelligence", label: "Creator Intel", icon: Zap },
    ],
  },
  {
    label: "WRITE",
    items: [
      { to: "/dashboard/studio", label: "Script Engine", icon: PenTool },
      { to: "/dashboard/caption-engine", label: "Caption Engine", icon: Type, badge: "NEW" },
    ],
  },
  {
    label: "PRODUCE",
    items: [
      { to: "/dashboard/voice", label: "Voice Studio", icon: Mic },
      { to: "/dashboard/video", label: "Video Studio", icon: Film },
    ],
  },
  {
    label: "GROW",
    items: [
      { to: "/dashboard/referrals", label: "Referrals", icon: Link2 },
      { to: "#", label: "Analytics", icon: BarChart3, disabled: true, badge: "Coming Soon" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { to: "/dashboard/history", label: "History", icon: Clock },
      { to: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

const bottomNavItems = [
  { to: "/dashboard/trending", label: "Idea", icon: Music },
  { to: "/dashboard/intelligence", label: "Intel", icon: Zap },
  { to: "/dashboard/studio", label: "Script Engine", icon: PenTool },
  { to: "/dashboard/caption-engine", label: "Caption", icon: Type },
  { to: "/dashboard/voice", label: "Voice Studio", icon: Mic },
  { to: "/dashboard/video", label: "Video Studio", icon: Film },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardSidebar() {
  const { signOut } = useAuth();
  const location = useLocation();
  const plan = usePlanKey();
  const isAgency = useIsAgency();
  const isProOrAbove = useIsProOrAbove();
  const showBadge = isProOrAbove;
  const badgeLabel = isAgency ? "AGENCY" : plan === "pro_creator" ? "PRO" : "";
  const badgeClass = isAgency
    ? "text-[8px] font-mono border-amber-500/40 text-amber-400 py-0 px-1.5"
    : "text-[8px] font-mono border-primary/30 text-primary py-0 px-1.5";

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-2 mb-2 rounded-2xl glass-strong border border-border/50 shadow-[0_-4px_30px_hsl(0_0%_0%/0.4)]">
          <div className="px-3 pt-2 pb-1 border-b border-border/40 flex justify-center">
            <BrandMark size={16} withWordmark className="opacity-85" />
          </div>
          <div className="grid grid-cols-7 gap-0.5 px-1 py-1.5">
            {bottomNavItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onMouseEnter={() => prefetchRoute(item.to)}
                  onFocus={() => prefetchRoute(item.to)}
                  className="flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 rounded-xl transition-all duration-300 min-w-0"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-300 ${active ? "bg-gradient-to-b from-primary/16 to-primary/8 border-primary/30 shadow-[0_0_16px_hsl(217_91%_60%/0.2)]" : "bg-transparent border-transparent"}`}>
                    <item.icon strokeWidth={1.9} className={`w-4 h-4 transition-colors duration-300 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <span className={`text-[9px] font-medium leading-none transition-all duration-300 ${active ? "text-primary opacity-100" : "text-muted-foreground/70 opacity-80"}`}>
                    {item.label}
                  </span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </nav>

      <aside className="hidden md:flex flex-col w-56 min-h-screen border-r border-border bg-sidebar shrink-0">
        <div className="h-16 flex items-center justify-between px-6 border-b border-border">
          <motion.div animate={{ opacity: [0.75, 1, 0.75] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <BrandMark size={22} withWordmark />
          </motion.div>
          {showBadge && (
            <Badge variant="outline" className={`${badgeClass} flex items-center gap-1`}>
              <Crown className="w-2.5 h-2.5" /> {badgeLabel}
            </Badge>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
          {sidebarSections.map((section, sectionIndex) => (
            <div key={section.label} className="space-y-1.5">
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                {section.label}
              </div>

              <div className="space-y-1">
                {section.items.map((item, itemIndex) => {
                  const active = !item.disabled && location.pathname === item.to;
                  const order = sectionIndex * 3 + itemIndex;

                  if (item.disabled) {
                    return (
                      <div
                        key={`${section.label}-${item.label}`}
                        className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground/55 bg-sidebar-accent/35 border border-border/40 cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-md flex items-center justify-center border border-border/50 bg-sidebar-accent/30 shrink-0">
                            <item.icon strokeWidth={1.9} className="w-4 h-4" />
                          </div>
                          <span className="font-medium truncate">{item.label}</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">{item.badge}</span>
                      </div>
                    );
                  }

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onMouseEnter={() => prefetchRoute(item.to)}
                      onFocus={() => prefetchRoute(item.to)}
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
            href="mailto:support@tryrobin.xyz"
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
