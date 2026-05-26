// ============================================================
// AdminNotifications — Realtime command-center notification feed
// ============================================================
// Subscribes to admin_notifications table via Supabase Realtime.
// Shows a floating glassmorphism panel in the top-right of the
// admin dashboard with live event feed.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, X, CreditCard, Users, Wallet, Shield,
  Zap, TrendingUp, CheckCircle2, AlertTriangle, Info,
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
  info:     { dot: "hsl(217 91% 60%)",  border: "hsl(217 91% 60% / 0.2)",  bg: "hsl(217 91% 60% / 0.05)"  },
  success:  { dot: "hsl(142 70% 50%)",  border: "hsl(142 70% 50% / 0.2)",  bg: "hsl(142 70% 50% / 0.05)"  },
  warning:  { dot: "hsl(38 92% 55%)",   border: "hsl(38 92% 55% / 0.25)",  bg: "hsl(38 92% 55% / 0.05)"   },
  critical: { dot: "hsl(0 72% 58%)",    border: "hsl(0 72% 58% / 0.3)",    bg: "hsl(0 72% 58% / 0.06)"    },
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

// ── Main component ─────────────────────────────────────────

export function AdminNotifications() {
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [newPulse,      setNewPulse]      = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
      .channel(`admin-notifications-${Date.now()}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        (payload: { new: AdminNotification }) => {
          const n = payload.new as AdminNotification;
          setNotifications((prev) => [n, ...prev].slice(0, MAX_NOTIFICATIONS));
          setUnreadCount((c) => c + 1);
          // Pulse the bell
          setNewPulse(true);
          setTimeout(() => setNewPulse(false), 3000);
        }
      )
      .subscribe();

    channelRef.current = ch;
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // ── Mark all read ──────────────────────────────────────
  const markAllRead = useCallback(async () => {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await db
      .from("admin_notifications")
      .update({ read: true })
      .eq("read", false);
  }, []);

  // ── Mark single read ───────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await db.from("admin_notifications").update({ read: true }).eq("id", id);
  }, []);

  return (
    <div className="relative">
      {/* Bell button */}
      <motion.button
        onClick={() => { setOpen((o) => !o); if (!open && unreadCount > 0) void markAllRead(); }}
        className="relative h-7 w-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
        style={{ border: "1px solid hsl(217 28% 12%)", background: "hsl(222 28% 7% / 0.7)" }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          animate={newPulse ? { scale: [1, 1.3, 1] } : {}}
          transition={{ duration: 0.4 }}
        >
          <Bell className="h-3.5 w-3.5" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }} />
        </motion.div>

        {/* Unread badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
              style={{ background: "hsl(0 72% 55%)", boxShadow: "0 0 8px hsl(0 72% 55% / 0.6)" }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Live pulse dot */}
        <motion.span
          className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
          style={{ background: "hsl(142 70% 50%)" }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.button>

      {/* Notification panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-9 z-50 w-80 rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(160deg, hsl(222 32% 9%) 0%, hsl(222 28% 7%) 100%)",
              border: "1px solid hsl(217 28% 14%)",
              boxShadow: "0 24px 64px hsl(0 0% 0% / 0.6), 0 0 0 1px hsl(217 91% 60% / 0.06)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid hsl(217 28% 11%)" }}>
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 6px hsl(142 70% 50% / 0.8)" }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[10px] font-mono uppercase tracking-[0.22em]"
                  style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                  Operations Feed
                </span>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[9px] font-mono transition-colors"
                    style={{ color: "hsl(217 91% 60% / 0.6)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(217 91% 68%)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "hsl(217 91% 60% / 0.6)"; }}
                  >
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)}
                  className="opacity-30 hover:opacity-60 transition-opacity">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Feed */}
            <div className="overflow-y-auto max-h-[420px]">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Bell className="w-6 h-6" style={{ color: "hsl(var(--muted-foreground) / 0.15)" }} />
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
                      initial={i === 0 ? { opacity: 0, x: 12 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => isUnread && void markRead(n.id)}
                      className="flex items-start gap-3 px-4 py-3 cursor-default transition-colors"
                      style={{
                        borderBottom: "1px solid hsl(217 28% 10%)",
                        background: isUnread ? styles.bg : "transparent",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(217 28% 8% / 0.6)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isUnread ? styles.bg : "transparent"; }}
                    >
                      {/* Icon */}
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: styles.bg, border: `1px solid ${styles.border}` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: styles.dot }} strokeWidth={1.6} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11.5px] font-medium leading-tight"
                            style={{ color: isUnread ? "hsl(var(--foreground) / 0.88)" : "hsl(var(--foreground) / 0.6)" }}>
                            {n.title}
                          </p>
                          {isUnread && (
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                              style={{ background: styles.dot }} />
                          )}
                        </div>
                        <p className="text-[10px] mt-0.5 leading-relaxed"
                          style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                          {n.message}
                        </p>
                        <p className="text-[9px] font-mono mt-1"
                          style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}>
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
                <span className="text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}>
                  {notifications.length} events
                </span>
                <span className="text-[9px] font-mono flex items-center gap-1.5"
                  style={{ color: "hsl(142 70% 50% / 0.6)" }}>
                  <motion.span className="w-1 h-1 rounded-full inline-block"
                    style={{ background: "hsl(142 70% 50%)" }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }} />
                  Live
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
