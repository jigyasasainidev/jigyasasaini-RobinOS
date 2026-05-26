// ============================================================
// AdminNotifications — Realtime command-center notification feed
// ============================================================
// Mobile fixes:
//   - Panel uses fixed positioning on mobile (full-width bottom sheet)
//   - Desktop: floating panel anchored to bell button
//   - Backdrop click closes on mobile
//   - Safe-area padding for iPhone
// Sound:
//   - Plays /sounds/notification.mp3 on new notification
//   - Volume capped at 1.0 (Web Audio API max)
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, X, CreditCard, Users, Wallet, Shield,
  Zap, TrendingUp, Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/cloudDb";

// ── Types ──────────────────────────────────────────────────

type NotificationPriority = "info" | "success" | "warning" | "critical";
type NotificationType = "payment" | "affiliate" | "user" | "withdrawal" | "security" | "system";

interface AdminNotification {
  id:         string;
  type:       NotificationType;
  title:      string;
  message:    string;
  priority:   NotificationPriority;
  read:       boolean;
  metadata:   Record<string, unknown>;
  created_at: string;
}

// ── Config ─────────────────────────────────────────────────

const MAX_NOTIFICATIONS = 50;
const INITIAL_LOAD      = 20;

const PRIORITY_STYLES: Record<NotificationPriority, { dot: string; border: string; bg: string }> = {
  info:     { dot: "hsl(217 91% 60%)",  border: "hsl(217 91% 60% / 0.2)",  bg: "hsl(217 91% 60% / 0.06)"  },
  success:  { dot: "hsl(142 70% 50%)",  border: "hsl(142 70% 50% / 0.2)",  bg: "hsl(142 70% 50% / 0.06)"  },
  warning:  { dot: "hsl(38 92% 55%)",   border: "hsl(38 92% 55% / 0.25)",  bg: "hsl(38 92% 55% / 0.06)"   },
  critical: { dot: "hsl(0 72% 58%)",    border: "hsl(0 72% 58% / 0.3)",    bg: "hsl(0 72% 58% / 0.07)"    },
};

const TYPE_ICONS: Record<NotificationType, React.ElementType> = {
  payment:    CreditCard,
  affiliate:  TrendingUp,
  user:       Users,
  withdrawal: Wallet,
  security:   Shield,
  system:     Zap,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sound player ───────────────────────────────────────────
// Volume is capped at 1.0 by Web Audio API spec.
// We boost perceived loudness by playing at max volume.
function playNotificationSound() {
  try {
    const audio = new Audio("/sounds/notification.mp3");
    audio.volume = 1.0;  // Max volume (Web Audio API caps at 1.0)
    void audio.play().catch(() => {
      // Autoplay blocked — user hasn't interacted yet, silent fail
    });
  } catch {
    // Audio not supported — silent fail
  }
}

// ── Main component ─────────────────────────────────────────

export function AdminNotifications() {
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [newPulse,      setNewPulse]      = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Load initial notifications ─────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await db
        .from("admin_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(INITIAL_LOAD);

      if (data) {
        setNotifications(data as AdminNotification[]);
        setUnreadCount(data.filter((n: AdminNotification) => !n.read).length);
      }
    };
    void load();
  }, []);

  // ── Realtime subscription ──────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`admin-notif-${Date.now()}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        (payload: { new: AdminNotification }) => {
          const n = payload.new as AdminNotification;
          setNotifications((prev) => [n, ...prev].slice(0, MAX_NOTIFICATIONS));
          setUnreadCount((c) => c + 1);
          setNewPulse(true);
          setTimeout(() => setNewPulse(false), 3000);
          // Play sound on every new notification
          playNotificationSound();
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, []);

  // ── Close on outside click ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Mark all read ──────────────────────────────────────
  const markAllRead = useCallback(async () => {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await db.from("admin_notifications").update({ read: true }).eq("read", false);
  }, []);

  const handleOpen = () => {
    setOpen((o) => !o);
    if (!open && unreadCount > 0) void markAllRead();
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* ── Bell button ─────────────────────────────────── */}
      <motion.button
        onClick={handleOpen}
        className="relative h-7 w-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
        style={{ border: "1px solid hsl(217 28% 12%)", background: "hsl(222 28% 7% / 0.7)" }}
        whileTap={{ scale: 0.92 }}
        aria-label="Notifications"
      >
        <motion.div
          animate={newPulse ? { rotate: [-8, 8, -6, 6, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Bell className="h-3.5 w-3.5" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }} />
        </motion.div>

        {/* Unread badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white px-1"
              style={{ background: "hsl(0 72% 55%)", boxShadow: "0 0 8px hsl(0 72% 55% / 0.5)" }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Live dot */}
        <motion.span
          className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
          style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 4px hsl(142 70% 50% / 0.7)" }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.button>

      {/* ── Notification panel ──────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Mobile backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 sm:hidden"
              style={{ background: "hsl(222 30% 4% / 0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setOpen(false)}
            />

            {/* Panel — bottom sheet on mobile, floating on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={[
                // Mobile: fixed bottom sheet
                "fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl",
                // Desktop: absolute floating panel
                "sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-9 sm:rounded-2xl sm:w-80",
                "overflow-hidden",
              ].join(" ")}
              style={{
                background: "linear-gradient(160deg, hsl(222 32% 9%) 0%, hsl(222 28% 7%) 100%)",
                border: "1px solid hsl(217 28% 14%)",
                boxShadow: "0 -8px 40px hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(217 91% 60% / 0.05)",
                // Safe area for iPhone home indicator
                paddingBottom: "env(safe-area-inset-bottom)",
                maxHeight: "80vh",
              }}
            >
              {/* Mobile drag handle */}
              <div className="sm:hidden flex justify-center pt-2.5 pb-1">
                <div className="w-8 h-1 rounded-full bg-white/10" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid hsl(217 28% 11%)" }}>
                <div className="flex items-center gap-2">
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 5px hsl(142 70% 50% / 0.7)" }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em]"
                    style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                    Operations Feed
                  </span>
                  {unreadCount > 0 && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ background: "hsl(0 72% 55% / 0.12)", color: "hsl(0 72% 65%)", border: "1px solid hsl(0 72% 55% / 0.2)" }}>
                      {unreadCount} new
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[9px] font-mono transition-colors"
                      style={{ color: "hsl(217 91% 60% / 0.55)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(217 91% 68%)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(217 91% 60% / 0.55)"; }}
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="w-6 h-6 rounded-md flex items-center justify-center transition-all opacity-40 hover:opacity-70"
                    style={{ background: "hsl(217 28% 10%)" }}
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Feed */}
              <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 100px)" }}>
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "hsl(217 28% 8%)", border: "1px solid hsl(217 28% 13%)" }}>
                      <Bell className="w-4 h-4" style={{ color: "hsl(var(--muted-foreground) / 0.2)" }} />
                    </div>
                    <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>
                      No events yet
                    </p>
                  </div>
                ) : (
                  notifications.map((n, i) => {
                    const styles  = PRIORITY_STYLES[n.priority as NotificationPriority] ?? PRIORITY_STYLES.info;
                    const Icon    = TYPE_ICONS[n.type as NotificationType] ?? Info;
                    const isUnread = !n.read;

                    return (
                      <motion.div
                        key={n.id}
                        initial={i === 0 ? { opacity: 0, x: 10 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-start gap-3 px-4 py-3 transition-colors cursor-default"
                        style={{
                          borderBottom: "1px solid hsl(217 28% 10%)",
                          background: isUnread ? styles.bg : "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(217 28% 8%)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isUnread ? styles.bg : "transparent"; }}
                      >
                        {/* Icon */}
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: styles.bg, border: `1px solid ${styles.border}` }}>
                          <Icon className="w-3.5 h-3.5" style={{ color: styles.dot }} strokeWidth={1.6} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-1.5">
                            <p className="text-[11.5px] font-medium leading-tight truncate"
                              style={{ color: isUnread ? "hsl(var(--foreground) / 0.88)" : "hsl(var(--foreground) / 0.55)" }}>
                              {n.title}
                            </p>
                            {isUnread && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                                style={{ background: styles.dot }} />
                            )}
                          </div>
                          <p className="text-[10px] mt-0.5 leading-relaxed"
                            style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
                            {n.message}
                          </p>
                          <p className="text-[9px] font-mono mt-1"
                            style={{ color: "hsl(var(--muted-foreground) / 0.22)" }}>
                            {relativeTime(n.created_at)}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="px-4 py-2.5 flex items-center justify-between"
                  style={{ borderTop: "1px solid hsl(217 28% 10%)" }}>
                  <span className="text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.22)" }}>
                    {notifications.length} events
                  </span>
                  <span className="text-[9px] font-mono flex items-center gap-1.5"
                    style={{ color: "hsl(142 70% 50% / 0.55)" }}>
                    <motion.span
                      className="w-1 h-1 rounded-full inline-block"
                      style={{ background: "hsl(142 70% 50%)" }}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    Live
                  </span>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
