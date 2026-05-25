import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Copy,
  Inbox,
  Loader2,
  LogOut,
  Mic,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useAdminRole } from "@/hooks/useAdminRole";
import { db } from "@/lib/cloudDb";
import { logAdminAction } from "@/lib/adminAudit";
import type { AdminAuditAction } from "@/types/admin";
import { PLATFORM_SETTINGS_DEFAULTS, validateSettingsDraft } from "@/types/platform-config";
import type { PlatformSettingsDraft } from "@/types/platform-config";
import { BrandMark } from "@/components/BrandMark";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeMultiTable } from "@/lib/realtime/channelManager";
import { AdminPWAInstall } from "@/components/admin/AdminPWAInstall";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type UserPlan = "creator" | "pro" | "agency";
type SubscriptionStatus = "active" | "cancelled" | "past_due" | "trialing";
type WithdrawStatus = "pending" | "approved" | "paid" | "rejected";
type GenerationType = "script" | "voice" | "video" | "thumbnail" | "trends";

type AdminPath =
  | "/adminsh/dashboard"
  | "/adminsh/analytics"
  | "/adminsh/settings"
  | "/adminsh/users"
  | "/adminsh/subscriptions"
  | "/adminsh/affiliates"
  | "/adminsh/withdrawals";

type NavItem = {
  label: string;
  path: AdminPath;
  icon: ComponentType<{ className?: string }>;
};

type AdminProfileRow = {
  user_id: string;
  email: string | null;
  avatar_url: string | null;
  full_name: string | null;
  current_plan: string;
  is_admin: boolean;
  is_suspended: boolean;
  affiliate_enabled: boolean;
  total_scripts_generated: number | null;
  total_trend_scans: number | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  status: string;
  currency: string;
  subscription_source: string;
  is_revenue_eligible: boolean;
  created_at: string;
  updated_at: string;
};

type WithdrawalRow = {
  id: string;
  user_id: string;
  payout_method: string;
  payout_details: string;
  amount: number;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
};

type AffiliateProfileRow = {
  user_id: string;
  referral_code: string;
  total_clicks: number;
  total_conversions: number;
  total_earned: number;
  pending_balance: number;
  paid_balance: number;
  created_at: string;
};

type AffiliateCommissionRow = {
  id: string;
  affiliate_user_id: string;
  referred_user_id: string | null;
  subscription_id: string | null;
  amount: number;
  status: string;
  created_at: string;
};

type AIGenerationRow = {
  id: string;
  user_id: string;
  generation_type: string;
  credits_used: number;
  provider: string | null;
  created_at: string;
};

type FeatureUsageRow = {
  id: string;
  user_id: string;
  feature_name: string;
  usage_count: number;
  created_at: string;
};

type PlatformSettingsRow = {
  id: string;
  creator_price: number;
  pro_price: number;
  agency_price: number;
  free_scripts_limit: number;
  free_scans_limit: number;
  affiliate_commission_percent: number;
  minimum_withdrawal: number;
  payout_delay_days: number;
  maintenance_mode: boolean;
  announcement_banner: string | null;
  support_email: string | null;
  platform_domain: string | null;
  updated_at: string;
};

type UserEnriched = {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  plan: UserPlan;
  status: SubscriptionStatus | "suspended";
  is_admin: boolean;
  is_affiliate: boolean;
  scriptsUsed: number;
  trendScans: number;
  created_at: string;
  updated_at: string;
  subscription_id: string | null;
  billing_cycle: string;
  amount: number;
  renewal_date: string | null;
  subscriptionSource: string;
};

type SparkPoint = { v: number };

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Core",
    items: [
      { label: "Dashboard", path: "/adminsh/dashboard", icon: Activity },
      { label: "Analytics", path: "/adminsh/analytics", icon: BarChart3 },
      { label: "Settings", path: "/adminsh/settings", icon: Settings },
    ],
  },
  {
    title: "Users",
    items: [
      { label: "Users", path: "/adminsh/users", icon: Users },
      { label: "Subscriptions", path: "/adminsh/subscriptions", icon: UserCheck },
    ],
  },
  {
    title: "Affiliates",
    items: [
      { label: "Affiliates", path: "/adminsh/affiliates", icon: TrendingUp },
      { label: "Withdrawals", path: "/adminsh/withdrawals", icon: Wallet },
    ],
  },
];

const pageMeta: Record<AdminPath, { title: string; subtitle: string }> = {
  "/adminsh/dashboard": {
    title: "Executive Dashboard",
    subtitle: "Operational overview of RobinOS platform activity.",
  },
  "/adminsh/analytics": {
    title: "Platform Analytics",
    subtitle: "Live revenue, AI usage, and feature metrics.",
  },
  "/adminsh/settings": {
    title: "Platform Settings",
    subtitle: "Control pricing, limits, affiliate parameters, and platform operations.",
  },
  "/adminsh/users": {
    title: "User Management",
    subtitle: "Manage user lifecycle, plans, suspension state, and search filters.",
  },
  "/adminsh/subscriptions": {
    title: "Subscription Management",
    subtitle: "Track active subscriptions, churn, failures, and recurring value.",
  },
  "/adminsh/affiliates": {
    title: "Affiliate Operations",
    subtitle: "Monitor referral performance, commissions, and quality signals.",
  },
  "/adminsh/withdrawals": {
    title: "Withdrawal Operations",
    subtitle: "Approve payout queue with full audit-safe backend operations.",
  },
};

const statusClass: Record<WithdrawStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  approved: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  paid: "border-primary/30 bg-primary/10 text-primary",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
};

const formatCurrency = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const formatNumber = (n: number) => Number(n || 0).toLocaleString();
const dateKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const asWithdrawStatus = (value: string): WithdrawStatus => (value === "approved" || value === "paid" || value === "rejected" ? value : "pending");
const asPlan = (plan: string | null | undefined): UserPlan => (plan === "agency" || plan === "scale_agency" ? "agency" : plan === "pro" || plan === "pro_creator" ? "pro" : "creator");
const asSubscriptionStatus = (status: string | null | undefined): SubscriptionStatus => (status === "active" || status === "cancelled" || status === "past_due" ? status : "trialing");

const estimateGenerationCost = (provider: string | null, creditsUsed: number) => {
  const p = (provider || "").toLowerCase();
  const perCredit = p.includes("openai") ? 0.012 : p.includes("gemini") ? 0.008 : p.includes("eleven") ? 0.01 : 0.009;
  return Number(creditsUsed || 0) * perCredit;
};

// ── Live badge ──────────────────────────────────────────────
const LiveBadge = ({ color = "blue" }: { color?: "blue" | "green" | "amber" | "teal" }) => {
  const palette: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    blue:  { bg: "hsl(217 91% 60% / 0.08)",  border: "hsl(217 91% 60% / 0.22)", text: "hsl(217 91% 72%)", dot: "hsl(142 70% 50%)" },
    green: { bg: "hsl(142 70% 45% / 0.08)",  border: "hsl(142 70% 45% / 0.22)", text: "hsl(142 70% 65%)", dot: "hsl(142 70% 50%)" },
    amber: { bg: "hsl(38 92% 50% / 0.08)",   border: "hsl(38 92% 50% / 0.22)",  text: "hsl(38 92% 68%)", dot: "hsl(38 92% 55%)" },
    teal:  { bg: "hsl(172 70% 40% / 0.08)",  border: "hsl(172 70% 40% / 0.22)", text: "hsl(172 70% 62%)", dot: "hsl(172 70% 50%)" },
  };
  const c = palette[color];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[8px] font-mono tracking-[0.15em] uppercase"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: c.dot, boxShadow: `0 0 5px ${c.dot}` }} />
      LIVE
    </span>
  );
};

// ── Section card ─────────────────────────────────────────────
const SectionCard = ({ title, subtitle, right, children }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <section
    className="rounded-2xl overflow-hidden"
    style={{
      background: "linear-gradient(160deg, hsl(222 28% 8.5% / 0.97) 0%, hsl(222 22% 7% / 0.97) 100%)",
      border: "1px solid hsl(217 28% 13%)",
      boxShadow: "0 8px 40px hsl(0 0% 0% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.035)",
    }}
  >
    {/* Top edge glow line */}
    <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.12) 30%, hsl(217 91% 60% / 0.12) 70%, transparent 100%)" }} />
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
      style={{ borderBottom: "1px solid hsl(217 28% 11% / 0.6)" }}
    >
      <div>
        <div className="text-[13px] font-semibold tracking-tight" style={{ color: "hsl(var(--foreground) / 0.88)" }}>{title}</div>
        {subtitle ? <div className="mt-0.5 text-[10.5px] leading-relaxed font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.42)" }}>{subtitle}</div> : null}
      </div>
      {right}
    </div>
    <div className="p-6">{children}</div>
  </section>
);

// ── Empty state ───────────────────────────────────────────────
const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div
    className="grid min-h-[160px] place-items-center rounded-xl p-8 text-center"
    style={{
      background: "repeating-linear-gradient(0deg, hsl(217 28% 8% / 0.4) 0px, transparent 1px, transparent 24px), hsl(222 28% 5% / 0.6)",
      border: "1px dashed hsl(217 28% 14% / 0.6)",
    }}
  >
    <div className="space-y-3">
      <div
        className="mx-auto w-10 h-10 rounded-2xl flex items-center justify-center"
        style={{ background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 15%)", boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.04)" }}
      >
        <Inbox className="h-4 w-4" style={{ color: "hsl(217 91% 60% / 0.3)" }} />
      </div>
      <div>
        <p className="text-[8.5px] font-mono uppercase tracking-[0.22em]" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>{title}</p>
        <p className="mt-1 text-[10px] max-w-[200px] mx-auto leading-relaxed" style={{ color: "hsl(var(--muted-foreground) / 0.18)" }}>{description}</p>
      </div>
    </div>
  </div>
);

// ── TinySparkline (legacy – kept for compatibility) ───────────
const TinySparkline = ({ data }: { data: SparkPoint[] }) => {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div className="mt-2 flex h-8 items-end gap-0.5">
      {data.map((d, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(20, (d.v / max) * 100)}%`,
            background: i === data.length - 1 ? "hsl(217 91% 60%)" : `hsl(217 91% 60% / ${0.15 + (i / data.length) * 0.5})`,
          }}
        />
      ))}
    </div>
  );
};

const MetricCard = ({ label, value, icon: Icon, spark, growth }: { label: string; value: string; growth?: number; icon: ComponentType<{ className?: string }>; spark: SparkPoint[] }) => {
  const maxSpark = Math.max(...spark.map((p) => p.v), 1);
  const hasPositiveGrowth = typeof growth === "number" && growth > 0;
  const hasNegativeGrowth = typeof growth === "number" && growth < 0;
  const gradId = `mcg-${label.replace(/[^a-zA-Z0-9]/g, "")}`;
  const CW = 100;
  const CH = 26;
  const linePath = spark.length < 2 ? "" : spark.map((p, i) => {
    const x = ((i / (spark.length - 1)) * CW).toFixed(1);
    const y = (CH - (p.v / maxSpark) * (CH - 3) - 1).toFixed(1);
    return (i === 0 ? "M" : "L") + `${x},${y}`;
  }).join(" ");
  const areaPath = linePath ? `${linePath} L${CW},${CH} L0,${CH} Z` : "";

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl cursor-default"
      style={{
        background: "linear-gradient(145deg, hsl(222 30% 9%) 0%, hsl(220 26% 7%) 60%, hsl(222 30% 8%) 100%)",
        border: "1px solid hsl(217 28% 13%)",
        boxShadow: "0 4px 20px hsl(0 0% 0% / 0.45), inset 0 1px 0 hsl(0 0% 100% / 0.04)",
      }}
      whileHover={{
        y: -3,
        boxShadow: "0 12px 40px hsl(0 0% 0% / 0.6), 0 0 0 1px hsl(217 91% 60% / 0.2), 0 0 32px hsl(217 91% 60% / 0.06)",
      }}
      transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Left accent strip */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "linear-gradient(180deg, hsl(217 91% 60% / 0.9) 0%, hsl(217 91% 60% / 0.08) 100%)" }} />

      {/* Top edge shimmer — appears on hover via group-hover is tricky, use absolute with opacity transition */}
      <motion.div
        className="absolute top-0 left-6 right-6 h-px pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.55), transparent)" }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      />

      {/* Corner ambient glow */}
      <div className="absolute top-0 right-0 w-28 h-28 pointer-events-none" style={{ background: "radial-gradient(circle at 100% 0%, hsl(217 91% 60% / 0.05), transparent 65%)" }} />

      {/* Body */}
      <div className="pl-5 pr-4 pt-4 pb-2.5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full" style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 5px hsl(142 70% 45% / 0.7)" }} />
            <span className="text-[8.5px] font-mono uppercase tracking-[0.22em]" style={{ color: "hsl(var(--muted-foreground) / 0.38)" }}>
              {label}
            </span>
          </div>
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "hsl(217 91% 60% / 0.07)", border: "1px solid hsl(217 91% 60% / 0.13)" }}
          >
            <Icon className="h-3.5 w-3.5 text-primary/60" />
          </div>
        </div>

        <p className="text-[1.88rem] font-bold tracking-tight leading-none mb-2.5" style={{ fontVariantNumeric: "tabular-nums", color: "hsl(var(--foreground) / 0.9)" }}>
          {value}
        </p>

        <div className="h-[18px] flex items-center">
          {typeof growth === "number" ? (
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8.5px] font-mono border ${
              hasPositiveGrowth ? "text-emerald-400 border-emerald-500/18" : hasNegativeGrowth ? "text-red-400 border-red-500/18" : "text-muted-foreground/25 border-transparent"
            }`} style={hasPositiveGrowth ? { background: "hsl(142 70% 45% / 0.06)" } : hasNegativeGrowth ? { background: "hsl(0 72% 55% / 0.06)" } : {}}>
              {hasPositiveGrowth ? "↑" : hasNegativeGrowth ? "↓" : "—"} {Math.abs(growth).toFixed(1)}%
            </span>
          ) : (
            <span className="text-[8.5px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.15)" }}>—</span>
          )}
        </div>
      </div>

      {/* SVG sparkline */}
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height="34" preserveAspectRatio="none" className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity="0" />
          </linearGradient>
          <filter id={`${gradId}-glow`}>
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {spark.length >= 2 && (
          <>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path d={linePath} fill="none" stroke="hsl(217 91% 60%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gradId}-glow)`} />
            {(() => {
              const last = spark[spark.length - 1];
              const lx = parseFloat(((spark.length - 1) / (spark.length - 1) * CW).toFixed(1));
              const ly = CH - (last.v / maxSpark) * (CH - 3) - 1;
              return (
                <>
                  <circle cx={lx} cy={ly} r="3.5" fill="hsl(217 91% 60%)" opacity="0.12" />
                  <circle cx={lx} cy={ly} r="2" fill="hsl(217 91% 60%)" opacity="0.95" style={{ filter: "drop-shadow(0 0 4px hsl(217 91% 60% / 0.8))" }} />
                </>
              );
            })()}
          </>
        )}
      </svg>
    </motion.div>
  );
};

const DataTable = ({ headers, children, empty, colSpan }: { headers: string[]; children: ReactNode; empty?: boolean; colSpan: number }) => (
  <div className="overflow-auto rounded-xl" style={{ border: "1px solid hsl(217 28% 11%)", boxShadow: "0 4px 20px hsl(0 0% 0% / 0.25)" }}>
    <table className="w-full min-w-[760px] text-xs">
      <thead style={{ background: "hsl(222 30% 5.5%)" }}>
        <tr style={{ borderBottom: "1px solid hsl(217 28% 11%)" }}>
          {headers.map((h) => (
            <th key={h} className="px-5 py-3.5 text-left text-[8.5px] font-mono uppercase tracking-[0.18em]" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody style={{ background: "hsl(222 28% 7% / 0.5)" }}>
        {children}
        {empty ? (
          <tr>
            <td colSpan={colSpan} className="p-0">
              <EmptyState title="No operational data detected" description="Records will stream here as activity begins." />
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  </div>
);

const PaginationControls = ({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (page: number) => void }) => (
  <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ borderTop: "1px solid hsl(217 28% 10% / 0.6)", background: "hsl(222 30% 5.5% / 0.5)" }}>
    <span className="text-[8.5px] font-mono tracking-[0.15em]" style={{ color: "hsl(var(--muted-foreground) / 0.25)" }}>PAGE {page} / {totalPages}</span>
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setPage(Math.max(page - 1, 1))}
        disabled={page <= 1}
        className="h-7 rounded-lg px-3 text-[9px] font-mono uppercase tracking-wider transition-all disabled:opacity-20 hover:text-foreground/70"
        style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 7%)", color: "hsl(var(--muted-foreground) / 0.4)" }}
      >
        ← Prev
      </button>
      <button
        onClick={() => setPage(Math.min(page + 1, totalPages))}
        disabled={page >= totalPages}
        className="h-7 rounded-lg px-3 text-[9px] font-mono uppercase tracking-wider transition-all disabled:opacity-20 hover:text-foreground/70"
        style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 7%)", color: "hsl(var(--muted-foreground) / 0.4)" }}
      >
        Next →
      </button>
    </div>
  </div>
);

// ── Shared chart: single area ────────────────────────────────
const TerminalChart = ({
  id, data, dataKey, color = "hsl(217 91% 60%)", height = 220, emptyMsg = "Awaiting telemetry.",
}: {
  id: string; data: object[]; dataKey: string; color?: string; height?: number; emptyMsg?: string;
}) => (
  <div
    className="relative rounded-xl overflow-hidden"
    style={{
      background: "linear-gradient(180deg, hsl(222 32% 4.5%) 0%, hsl(222 28% 3.5%) 100%)",
      border: "1px solid hsl(217 28% 10%)",
      boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.02)"
    }}
  >
    {/* Grid overlay */}
    <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(hsl(217 28% 13% / 0.15) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 13% / 0.08) 1px, transparent 1px)", backgroundSize: "100% 36px, 80px 100%" }} />
    {/* Top ambient glow */}
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-12 pointer-events-none" style={{ background: `radial-gradient(ellipse at center top, ${color.replace(")", " / 0.06)")}, transparent 70%)` }} />
    <div style={{ height }} className="px-1 pt-3 pb-1 relative">
      {(data as Record<string, unknown>[]).length ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="60%" stopColor={color} stopOpacity={0.06} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(217 28% 13% / 0.0)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.28)" }} axisLine={{ stroke: "hsl(217 28% 11%)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.28)" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: "hsl(222 30% 7% / 0.98)",
                border: `1px solid ${color.replace(")", " / 0.28)")}`,
                borderRadius: "10px",
                fontSize: "11px",
                fontFamily: "monospace",
                boxShadow: `0 16px 48px hsl(0 0% 0% / 0.65), 0 0 0 1px ${color.replace(")", " / 0.08)")}`,
                backdropFilter: "blur(12px)",
              }}
              cursor={{ stroke: `${color.replace(")", " / 0.3)")}`, strokeWidth: 1, strokeDasharray: "5 4" }}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} activeDot={{ r: 4, fill: color, strokeWidth: 0, style: { filter: `drop-shadow(0 0 8px ${color})` } }} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 14%)" }}>
            <Activity className="h-3.5 w-3.5" style={{ color: "hsl(217 91% 60% / 0.3)" }} />
          </div>
          <p className="text-[8.5px] font-mono tracking-[0.2em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.22)" }}>{emptyMsg}</p>
        </div>
      )}
    </div>
  </div>
);

// ── Shared chart: multi-area (plan distribution) ─────────────
const MultiAreaChart = ({ id, data, height = 220 }: { id: string; data: Array<{ date: string; creator: number; pro: number; agency: number }>, height?: number }) => (
  <div
    className="relative rounded-xl overflow-hidden"
    style={{
      background: "linear-gradient(180deg, hsl(222 32% 4.5%) 0%, hsl(222 28% 3.5%) 100%)",
      border: "1px solid hsl(217 28% 10%)",
      boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.02)"
    }}
  >
    <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(hsl(217 28% 13% / 0.15) 1px, transparent 1px)", backgroundSize: "100% 36px" }} />
    <div style={{ height }} className="px-1 pt-3 pb-1 relative">
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id={`${id}C`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.22} /><stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} /></linearGradient>
              <linearGradient id={`${id}P`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.18} /><stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} /></linearGradient>
              <linearGradient id={`${id}A`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(142 70% 45%)" stopOpacity={0.15} /><stop offset="100%" stopColor="hsl(142 70% 45%)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(217 28% 13% / 0)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.28)" }} axisLine={{ stroke: "hsl(217 28% 11%)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.28)" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "hsl(222 30% 7% / 0.98)", border: "1px solid hsl(217 28% 16%)", borderRadius: "10px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 16px 48px hsl(0 0% 0% / 0.65)", backdropFilter: "blur(12px)" }} cursor={{ stroke: "hsl(217 91% 60% / 0.22)", strokeWidth: 1, strokeDasharray: "5 4" }} />
            <Area type="monotone" dataKey="creator" name="Creator" stroke="hsl(217 91% 60%)" strokeWidth={2} fill={`url(#${id}C)`} dot={false} activeDot={{ r: 3.5, fill: "hsl(217 91% 60%)", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="pro" name="Pro" stroke="hsl(38 92% 50%)" strokeWidth={2} fill={`url(#${id}P)`} dot={false} activeDot={{ r: 3.5, fill: "hsl(38 92% 50%)", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="agency" name="Agency" stroke="hsl(142 70% 45%)" strokeWidth={2} fill={`url(#${id}A)`} dot={false} activeDot={{ r: 3.5, fill: "hsl(142 70% 45%)", strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full flex flex-col items-center justify-center">
          <p className="text-[8.5px] font-mono tracking-[0.2em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.22)" }}>No subscription data yet.</p>
        </div>
      )}
    </div>
    <div className="flex items-center gap-5 px-5 py-3" style={{ borderTop: "1px solid hsl(217 28% 10%)", background: "hsl(222 30% 4.5% / 0.6)" }}>
      {[{ l: "Creator", c: "hsl(217 91% 60%)" }, { l: "Pro", c: "hsl(38 92% 50%)" }, { l: "Agency", c: "hsl(142 70% 45%)" }].map((i) => (
        <div key={i.l} className="flex items-center gap-2">
          <span className="w-3.5 h-[1.5px] rounded-full" style={{ background: i.c, boxShadow: `0 0 6px ${i.c}` }} />
          <span className="text-[8.5px] font-mono tracking-[0.15em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>{i.l}</span>
        </div>
      ))}
    </div>
  </div>
);

// ── PlanChip ──────────────────────────────────────────────────
const PlanChip = ({ plan }: { plan: string }) => {
  const cfg: Record<string, { label: string; bg: string; border: string; color: string }> = {
    creator: { label: "Creator", bg: "hsl(217 91% 60% / 0.07)", border: "hsl(217 91% 60% / 0.2)",  color: "hsl(217 91% 68%)" },
    pro:     { label: "Pro",     bg: "hsl(38 92% 50% / 0.07)",  border: "hsl(38 92% 50% / 0.2)",   color: "hsl(38 92% 62%)" },
    agency:  { label: "Agency",  bg: "hsl(142 70% 45% / 0.07)", border: "hsl(142 70% 45% / 0.2)",  color: "hsl(142 70% 58%)" },
  };
  const c = cfg[plan] ?? cfg.creator;
  return (
    <span
      className="inline-flex rounded-lg px-2 py-0.5 text-[8.5px] font-mono uppercase tracking-[0.12em]"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}
    >
      {c.label}
    </span>
  );
};

// ── StatusChip ────────────────────────────────────────────────
const StatusChip = ({ status }: { status: string }) => {
  const s = (status || "").toLowerCase();
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-[8.5px] font-mono uppercase tracking-[0.1em]";
  if (s === "active")    return <span className={base} style={{ background: "hsl(142 70% 45% / 0.1)", border: "1px solid hsl(142 70% 45% / 0.25)", color: "hsl(142 70% 60%)" }}>● active</span>;
  if (s === "suspended") return <span className={base} style={{ background: "hsl(0 72% 55% / 0.1)", border: "1px solid hsl(0 72% 55% / 0.25)", color: "hsl(0 72% 65%)" }}>● suspended</span>;
  if (s === "cancelled") return <span className={base} style={{ background: "hsl(222 28% 10%)", border: "1px solid hsl(217 28% 14%)", color: "hsl(var(--muted-foreground) / 0.4)" }}>cancelled</span>;
  if (s === "past_due")  return <span className={base} style={{ background: "hsl(38 92% 50% / 0.1)", border: "1px solid hsl(38 92% 50% / 0.25)", color: "hsl(38 92% 62%)" }}>⚠ past due</span>;
  return <span className={base} style={{ background: "hsl(222 28% 9%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(var(--muted-foreground) / 0.35)" }}>{s || "—"}</span>;
};

// ── SourceBadge ───────────────────────────────────────────────
const SourceBadge = ({ src }: { src: string }) => {
  const s = (src ?? "manual_admin").toLowerCase();
  const isPaid = ["creem","dodo","stripe"].includes(s);
  const isManual = s === "manual_admin";
  const isPromo = ["promo","internal"].includes(s);
  const isAffiliate = s === "affiliate_reward";
  if (isPaid)     return <span className="inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-mono" style={{ background: "hsl(142 70% 45% / 0.09)", border: "1px solid hsl(142 70% 45% / 0.22)", color: "hsl(142 70% 58%)" }}>Paid</span>;
  if (isManual)   return <span className="inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-mono" style={{ background: "hsl(38 92% 50% / 0.08)", border: "1px solid hsl(38 92% 50% / 0.2)", color: "hsl(38 92% 60%)" }}>Manual</span>;
  if (isPromo)    return <span className="inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-mono" style={{ background: "hsl(280 70% 60% / 0.08)", border: "1px solid hsl(280 70% 60% / 0.2)", color: "hsl(280 70% 68%)" }}>Promo</span>;
  if (isAffiliate) return <span className="inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-mono" style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 68%)" }}>Affiliate</span>;
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-mono" style={{ background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(var(--muted-foreground) / 0.35)" }}>{s}</span>;
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, signOut, loading: authLoading } = useAuth();
  const { data: isAdmin, isLoading: roleLoading } = useAdminRole();

  const [userSearch, setUserSearch] = useState("");
  const [userPlanFilter, setUserPlanFilter] = useState<"all" | UserPlan>("all");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | UserEnriched["status"]>("all");
  const [userPage, setUserPage] = useState(1);
  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState<"all" | WithdrawStatus>("all");

  const [settingsDraft, setSettingsDraft] = useState<PlatformSettingsDraft>(PLATFORM_SETTINGS_DEFAULTS);

  const currentPath = useMemo<AdminPath>(() => (pageMeta[location.pathname as AdminPath] ? (location.pathname as AdminPath) : "/adminsh/dashboard"), [location.pathname]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/adminsh/auth");
      return;
    }
    if (!roleLoading && isAdmin === false) {
      navigate("/adminsh/auth");
    }
  }, [authLoading, user, roleLoading, isAdmin, navigate]);

  const profilesQuery = useQuery({
    queryKey: ["admin-profiles-v2"],
    queryFn: async (): Promise<AdminProfileRow[]> => {
      const { data, error } = await db.from("admin_profiles_view").select("user_id,email,avatar_url,full_name,current_plan,is_admin,is_suspended,affiliate_enabled,total_scripts_generated,total_trend_scans,created_at,updated_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdminProfileRow[];
    },
    enabled: !!isAdmin,
  });

  const subscriptionsQuery = useQuery({
    queryKey: ["admin-subscriptions-v2"],
    queryFn: async (): Promise<SubscriptionRow[]> => {
      const { data, error } = await db.from("user_subscriptions").select("id,user_id,plan,amount,status,currency,subscription_source,is_revenue_eligible,created_at,updated_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SubscriptionRow[];
    },
    enabled: !!isAdmin,
  });

  const withdrawalsQuery = useQuery({
    queryKey: ["admin-withdrawals-v2"],
    queryFn: async (): Promise<WithdrawalRow[]> => {
      const { data, error } = await db.from("withdrawal_requests").select("id,user_id,payout_method,payout_details,amount,status,admin_note,created_at,updated_at,approved_at,completed_at,rejected_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WithdrawalRow[];
    },
    enabled: !!isAdmin,
  });

  const affiliateProfilesQuery = useQuery({
    queryKey: ["admin-affiliate-profiles-v2"],
    queryFn: async (): Promise<AffiliateProfileRow[]> => {
      const { data, error } = await db.from("affiliate_profiles").select("user_id,referral_code,total_clicks,total_conversions,total_earned,pending_balance,paid_balance,created_at");
      if (error) throw error;
      return (data ?? []) as AffiliateProfileRow[];
    },
    enabled: !!isAdmin,
  });

  const affiliateCommissionsQuery = useQuery({
    queryKey: ["admin-affiliate-commissions-v2"],
    queryFn: async (): Promise<AffiliateCommissionRow[]> => {
      const { data, error } = await db.from("affiliate_commissions").select("id,affiliate_user_id,referred_user_id,subscription_id,amount,status,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AffiliateCommissionRow[];
    },
    enabled: !!isAdmin,
  });

  const aiGenerationsQuery = useQuery({
    queryKey: ["admin-ai-generations-v2"],
    queryFn: async (): Promise<AIGenerationRow[]> => {
      const { data, error } = await db.from("ai_generations").select("id,user_id,generation_type,credits_used,provider,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AIGenerationRow[];
    },
    enabled: !!isAdmin,
  });

  // ── Admin dashboard metrics — authoritative aggregation ──
  // Reads from feature_usage + usage_tracking (the actual tables
  // ── Platform analytics — single authoritative RPC ─────────
  // get_platform_analytics() aggregates from:
  //   - user_subscriptions (MRR via plan key prices, not amount field)
  //   - feature_usage + usage_tracking (AI telemetry)
  //   - subscription history (growth/churn)
  const adminMetricsQuery = useQuery({
    queryKey: ["admin-dashboard-metrics-v1"],
    queryFn: async (): Promise<{
      mrr: number; arr: number; growth_rate: number; churn_rate: number;
      total_users: number; active_subscribers: number;
      scripts_generated: number; trend_searches: number;
      caption_generated: number; voice_generated: number; video_generated: number;
      estimated_ai_cost: number; affiliate_earnings: number; pending_withdrawals: number;
    }> => {
      const { data, error } = await (db as any).rpc("get_platform_analytics");
      if (error) {
        console.warn("[AdminDashboard] platform analytics RPC failed:", error.message);
        return {
          mrr: 0, arr: 0, growth_rate: 0, churn_rate: 0,
          total_users: 0, active_subscribers: 0,
          scripts_generated: 0, trend_searches: 0,
          caption_generated: 0, voice_generated: 0, video_generated: 0,
          estimated_ai_cost: 0, affiliate_earnings: 0, pending_withdrawals: 0,
        };
      }
      return {
        mrr:                 Number(data?.mrr                 ?? 0),
        arr:                 Number(data?.arr                 ?? 0),
        growth_rate:         Number(data?.growth_rate         ?? 0),
        churn_rate:          Number(data?.churn_rate          ?? 0),
        total_users:         Number(data?.total_users         ?? 0),
        active_subscribers:  Number(data?.active_subscribers  ?? 0),
        scripts_generated:   Number(data?.scripts_generated   ?? 0),
        trend_searches:      Number(data?.trend_searches      ?? 0),
        caption_generated:   Number(data?.caption_generated   ?? 0),
        voice_generated:     Number(data?.voice_generated     ?? 0),
        video_generated:     Number(data?.video_generated     ?? 0),
        estimated_ai_cost:   Number(data?.estimated_ai_cost   ?? 0),
        affiliate_earnings:  Number(data?.affiliate_earnings  ?? 0),
        pending_withdrawals: Number(data?.pending_withdrawals ?? 0),
      };
    },
    enabled: !!isAdmin,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const featureUsageQuery = useQuery({
    queryKey: ["admin-feature-usage-v2"],
    queryFn: async (): Promise<FeatureUsageRow[]> => {
      const { data, error } = await db.from("feature_usage").select("id,user_id,feature_name,usage_count,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureUsageRow[];
    },
    enabled: !!isAdmin,
  });

  const platformSettingsQuery = useQuery({
    queryKey: ["admin-platform-settings-v2"],
    queryFn: async (): Promise<PlatformSettingsRow | null> => {
      // SELECT * to ensure all columns including jvzoo_* and creator_os_* are fetched.
      // Previously only fetched a subset — missing columns caused fields to clear after save.
      const { data, error } = await db
        .from("platform_settings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as PlatformSettingsRow | null;
    },
    enabled: !!isAdmin,
    staleTime: 0,  // always refetch after invalidation — prevents stale cache overwriting saved values
  });

  const profiles = profilesQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];
  const withdrawals = withdrawalsQuery.data ?? [];
  const affiliateProfiles = affiliateProfilesQuery.data ?? [];
  const affiliateCommissions = affiliateCommissionsQuery.data ?? [];
  const aiGenerations = aiGenerationsQuery.data ?? [];
  const featureUsage = featureUsageQuery.data ?? [];
  const platformSettings = platformSettingsQuery.data;

  // Hydrate draft from DB — runs ONCE on initial load only.
  // Using a ref to track whether we've already hydrated so that
  // post-save refetches don't overwrite the user's current edits.
  const draftHydratedRef = useRef(false);

  useEffect(() => {
    if (!platformSettings) return;
    // Always hydrate on first load. After that, only re-hydrate if the
    // row's updated_at changed (i.e. a different admin saved from another session).
    // This prevents the post-save refetch from clearing the user's inputs.
    if (!draftHydratedRef.current) {
      draftHydratedRef.current = true;
      setSettingsDraft({
        creator_price:                  Number(platformSettings.creator_price || 0),
        pro_price:                      Number(platformSettings.pro_price || 0),
        agency_price:                   Number(platformSettings.agency_price || 0),
        free_scripts_limit:             Number(platformSettings.free_scripts_limit || 0),
        free_scans_limit:               Number(platformSettings.free_scans_limit || 0),
        affiliate_commission_percent:   Number(platformSettings.affiliate_commission_percent || 0),
        minimum_withdrawal:             Number(platformSettings.minimum_withdrawal || 0),
        payout_delay_days:              Number(platformSettings.payout_delay_days || 0),
        maintenance_mode:               !!platformSettings.maintenance_mode,
        announcement_banner:            platformSettings.announcement_banner ?? "",
        creator_os_page_enabled:        platformSettings.creator_os_page_enabled ?? true,
        creator_os_demo_video_url:      platformSettings.creator_os_demo_video_url ?? "",
        jvzoo_affiliate_enabled:        platformSettings.jvzoo_affiliate_enabled ?? false,
        jvzoo_affiliate_demo_video_url: platformSettings.jvzoo_affiliate_demo_video_url ?? "",
        jvzoo_affiliate_cta_url:        platformSettings.jvzoo_affiliate_cta_url ?? "",
        jvzoo_affiliate_button_text:    platformSettings.jvzoo_affiliate_button_text ?? "Join Affiliate Program",
        jvzoo_affiliate_login_url:      platformSettings.jvzoo_affiliate_login_url ?? "https://www.tryrobin.xyz/login",
      });
    }
  }, [platformSettings]);

  useEffect(() => {
    if (!isAdmin) return;

    // All listeners registered before the single .subscribe() call.
    // subscribeMultiTable enforces correct Supabase lifecycle order.
    const unsub = subscribeMultiTable({
      channelName: "admin-live-v2",
      listeners: [
        {
          table: "profiles",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-profiles-v2"] }),
        },
        {
          table: "user_subscriptions",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-v2"] }),
        },
        {
          table: "withdrawal_requests",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-withdrawals-v2"] }),
        },
        {
          table: "affiliate_commissions",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-affiliate-commissions-v2"] }),
        },
        {
          table: "ai_generations",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-ai-generations-v2"] }),
        },
        {
          table: "feature_usage",
          callback: () => queryClient.invalidateQueries({ queryKey: ["admin-dashboard-metrics-v1"] }),
        },
        {
          table: "platform_settings",
          callback: () => {
            void queryClient.invalidateQueries({ queryKey: ["admin-platform-settings-v2"] });
            void queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
          },
        },
      ],
    });

    return unsub;
  }, [isAdmin, queryClient]);

  const profileMap = useMemo(() => {
    const map = new Map<string, AdminProfileRow>();
    profiles.forEach((p) => map.set(p.user_id, p));
    return map;
  }, [profiles]);

  const subscriptionMap = useMemo(() => {
    const map = new Map<string, SubscriptionRow>();
    subscriptions.forEach((s) => map.set(s.user_id, s));
    return map;
  }, [subscriptions]);

  const affiliateProfileMap = useMemo(() => {
    const map = new Map<string, AffiliateProfileRow>();
    affiliateProfiles.forEach((a) => map.set(a.user_id, a));
    return map;
  }, [affiliateProfiles]);

  const usersEnriched = useMemo<UserEnriched[]>(() => {
    return profiles.map((p) => {
      const sub = subscriptionMap.get(p.user_id);
      return {
        user_id: p.user_id,
        name: p.full_name || p.email || p.user_id.slice(0, 8),
        email: p.email || `${p.user_id.slice(0, 8)}@unknown`,
        avatar_url: p.avatar_url,
        plan: asPlan(sub?.plan || p.current_plan),
        status: p.is_suspended ? "suspended" : asSubscriptionStatus(sub?.status),
        is_admin: !!p.is_admin,
        is_affiliate: !!p.affiliate_enabled || affiliateProfileMap.has(p.user_id),
        scriptsUsed: Number(p.total_scripts_generated || 0),
        trendScans: Number(p.total_trend_scans || 0),
        created_at: p.created_at,
        updated_at: p.updated_at,
        subscription_id: sub?.id ?? null,
        billing_cycle: "—",
        amount: Number(sub?.amount || 0),
        renewal_date: null,
        subscriptionSource: sub?.subscription_source ?? "manual_admin",
      };
    });
  }, [profiles, subscriptionMap, affiliateProfileMap]);

  const isBootLoading = [
    profilesQuery.isLoading,
    subscriptionsQuery.isLoading,
    withdrawalsQuery.isLoading,
    affiliateProfilesQuery.isLoading,
    affiliateCommissionsQuery.isLoading,
    aiGenerationsQuery.isLoading,
    featureUsageQuery.isLoading,
    platformSettingsQuery.isLoading,
    adminMetricsQuery.isLoading,
  ].some(Boolean);

  const queryErrors = [
    profilesQuery.error,
    subscriptionsQuery.error,
    withdrawalsQuery.error,
    affiliateProfilesQuery.error,
    affiliateCommissionsQuery.error,
    aiGenerationsQuery.error,
    featureUsageQuery.error,
    platformSettingsQuery.error,
  ].filter(Boolean);

  // monthlyRevenue: frontend fallback used only while adminMetricsQuery is loading
  const monthlyRevenue = useMemo(() => {
    return subscriptions
      .filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active")
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  }, [subscriptions]);

  // Active subscribers: all users on a non-free plan with an active lifecycle state.
  // Does NOT require is_revenue_eligible — admin grants are real active subscribers.
  // is_revenue_eligible only gates MRR/revenue counting, not user counts.
  const activeSubscribers = useMemo(() =>
    subscriptions.filter((s) => {
      const plan   = (s.plan ?? "").toLowerCase();
      const status = (s.status ?? "").toLowerCase();
      return plan !== "free" && plan !== ""
        && ["active", "trialing", "expiring", "grace_period"].includes(status);
    }).length,
  [subscriptions]);
  const pendingWithdrawals = useMemo(() => withdrawals.filter((w) => asWithdrawStatus(w.status) === "pending"), [withdrawals]);
  const totalAffiliateEarnings = useMemo(() => affiliateCommissions.reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);

  // ── Authoritative metrics from get_platform_analytics() ──
  // MRR uses plan key prices (not amount field — amount=0 for admin grants).
  // Growth/churn from subscription history. AI telemetry from feature_usage.
  const adminMetrics = adminMetricsQuery.data;
  const mrr           = adminMetrics?.mrr          ?? monthlyRevenue;
  const arr           = adminMetrics?.arr          ?? mrr * 12;
  const growthPercent = adminMetrics?.growth_rate  ?? 0;
  const churnRate     = adminMetrics?.churn_rate   ?? 0;

  const scriptsGenerated = adminMetrics?.scripts_generated ?? 0;
  const trendSearches    = adminMetrics?.trend_searches    ?? 0;
  const estimatedAiCost  = adminMetrics?.estimated_ai_cost ?? 0;
  const voiceGenerations = adminMetrics?.voice_generated   ?? 0;
  const videoGenerations = adminMetrics?.video_generated   ?? 0;
  // ── Free vs paid classification ───────────────────────────
  // Paid = any user on a non-free plan with an active/expiring/grace_period
  // subscription — regardless of is_revenue_eligible.
  // is_revenue_eligible only gates revenue counting (MRR), not user counts.
  // Admin-granted plans are real paid users even if not revenue-eligible.
  const paidUserIds = useMemo(() => {
    const ids = new Set<string>();
    subscriptions.forEach((s) => {
      const plan   = (s.plan ?? "").toLowerCase();
      const status = (s.status ?? "").toLowerCase();
      const isPaidPlan    = plan !== "free" && plan !== "";
      const isActiveSub   = ["active", "trialing", "expiring", "grace_period"].includes(status);
      if (isPaidPlan && isActiveSub) ids.add(s.user_id);
    });
    return ids;
  }, [subscriptions]);

  const paidUsers = useMemo(() => paidUserIds.size, [paidUserIds]);
  const freeUsers = useMemo(() => Math.max(0, profiles.length - paidUserIds.size), [profiles.length, paidUserIds]);

  // churnRate and growthPercent now come from get_platform_analytics() RPC above.
  // userGrowthPercent (weekly user signup delta) is still frontend-computed for the
  // "Total Users" metric card growth indicator.
  const userGrowthPercent = useMemo(() => {
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    const recent = profiles.filter((u) => new Date(u.created_at).getTime() >= now - week).length;
    const prev = profiles.filter((u) => {
      const t = new Date(u.created_at).getTime();
      return t >= now - 2 * week && t < now - week;
    }).length;
    if (prev <= 0) return recent > 0 ? 100 : 0;
    return ((recent - prev) / prev) * 100;
  }, [profiles]);

  const dailySeries = useMemo(() => {
    const revenueByDate = new Map<string, number>();
    subscriptions
      .filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active")
      .forEach((s) => {
      const key = dateKey(s.created_at);
      revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + Number(s.amount || 0));
    });

    const signupByDate = new Map<string, number>();
    profiles.forEach((p) => {
      const key = dateKey(p.created_at);
      signupByDate.set(key, (signupByDate.get(key) ?? 0) + 1);
    });

    const scriptsByDate = new Map<string, number>();
    const scansByDate = new Map<string, number>();
    aiGenerations.forEach((g) => {
      const key = dateKey(g.created_at);
      const type = (g.generation_type || "").toLowerCase() as GenerationType;
      if (type === "script") scriptsByDate.set(key, (scriptsByDate.get(key) ?? 0) + 1);
      if (type === "trends") scansByDate.set(key, (scansByDate.get(key) ?? 0) + 1);
    });

    const subsByDate = new Map<string, number>();
    subscriptions.filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active").forEach((s) => {
      const key = dateKey(s.created_at);
      subsByDate.set(key, (subsByDate.get(key) ?? 0) + 1);
    });

    const keys = Array.from(new Set([...revenueByDate.keys(), ...signupByDate.keys(), ...scriptsByDate.keys(), ...scansByDate.keys(), ...subsByDate.keys()])).sort();

    let cumulativeUsers = 0;
    let cumulativeSubs = 0;
    return keys.map((k) => {
      cumulativeUsers += signupByDate.get(k) ?? 0;
      cumulativeSubs += subsByDate.get(k) ?? 0;
      return {
        date: k,
        revenue: revenueByDate.get(k) ?? 0,
        signups: signupByDate.get(k) ?? 0,
        users: cumulativeUsers,
        subscriptions: cumulativeSubs,
        scripts: scriptsByDate.get(k) ?? 0,
        scans: scansByDate.get(k) ?? 0,
      };
    });
  }, [profiles, aiGenerations, subscriptions]);

  const planDistribution = useMemo(() => {
    const creator = subscriptions.filter((s) => asPlan(s.plan) === "creator" && asSubscriptionStatus(s.status) !== "cancelled").length;
    const pro = subscriptions.filter((s) => asPlan(s.plan) === "pro" && asSubscriptionStatus(s.status) !== "cancelled").length;
    const agency = subscriptions.filter((s) => asPlan(s.plan) === "agency" && asSubscriptionStatus(s.status) !== "cancelled").length;
    return [
      { name: "Creator", value: creator, fill: "hsl(var(--primary) / 0.85)" },
      { name: "Pro", value: pro, fill: "hsl(var(--primary) / 0.62)" },
      { name: "Agency", value: agency, fill: "hsl(var(--primary) / 0.42)" },
    ];
  }, [subscriptions]);

  const planDistributionTrend = useMemo(() => {
    const included = subscriptions.filter((s) => asSubscriptionStatus(s.status) !== "cancelled");
    if (!included.length) return [] as Array<{ date: string; creator: number; pro: number; agency: number; total: number }>;

    const daily = new Map<string, { creator: number; pro: number; agency: number }>();

    included.forEach((s) => {
      const key = dateKey(s.created_at);
      const row = daily.get(key) ?? { creator: 0, pro: 0, agency: 0 };
      const plan = asPlan(s.plan);
      if (plan === "creator") row.creator += 1;
      if (plan === "pro") row.pro += 1;
      if (plan === "agency") row.agency += 1;
      daily.set(key, row);
    });

    const keys = Array.from(daily.keys()).sort();
    let creator = 0;
    let pro = 0;
    let agency = 0;

    return keys.map((k) => {
      const point = daily.get(k) ?? { creator: 0, pro: 0, agency: 0 };
      creator += point.creator;
      pro += point.pro;
      agency += point.agency;
      return {
        date: k,
        creator,
        pro,
        agency,
        total: creator + pro + agency,
      };
    });
  }, [subscriptions]);

  const topFeatureUsage = useMemo(() => {
    const byFeature = new Map<string, number>();
    featureUsage.forEach((f) => byFeature.set(f.feature_name, (byFeature.get(f.feature_name) ?? 0) + Number(f.usage_count || 0)));
    return Array.from(byFeature.entries()).map(([feature, value]) => ({ feature, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [featureUsage]);

  const sparkFrom = (arr: number[]) => {
    const out = arr.slice(-8);
    if (!out.length) return Array.from({ length: 8 }, () => ({ v: 0 }));
    return out.map((v) => ({ v }));
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return usersEnriched.filter((u) => {
      const queryHit = !q || `${u.email} ${u.name} ${u.plan} ${u.status}`.toLowerCase().includes(q);
      const planHit = userPlanFilter === "all" || u.plan === userPlanFilter;
      const statusHit = userStatusFilter === "all" || u.status === userStatusFilter;
      return queryHit && planHit && statusHit;
    });
  }, [usersEnriched, userSearch, userPlanFilter, userStatusFilter]);

  const pageSize = 12;
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, userPage]);

  useEffect(() => {
    if (userPage > totalUserPages) setUserPage(totalUserPages);
  }, [userPage, totalUserPages]);

  const writeAdminLog = async (actionType: AdminAuditAction, targetId: string, details: Record<string, unknown>) => {
    await logAdminAction(actionType, targetId, details);
  };

  const userStatusMutation = useMutation({
    mutationFn: async ({ row, suspended }: { row: UserEnriched; suspended: boolean }) => {
      const { error: profileError } = await db.from("profiles").update({ is_suspended: suspended }).eq("user_id", row.user_id);
      if (profileError) throw profileError;

      if (row.subscription_id) {
        const { error: subError } = await db.from("user_subscriptions").update({ status: suspended ? "past_due" : "active" }).eq("id", row.subscription_id);
        if (subError) throw subError;
      }

      await writeAdminLog(suspended ? "user_suspended" : "user_activated", row.user_id, {
        email: row.email,
        previous_status: row.status,
      });
    },
    onSuccess: () => {
      toast.success("User status updated");
      queryClient.invalidateQueries({ queryKey: ["admin-profiles-v2"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-v2"] });
      // Invalidate the affected user's own profile cache so suspension propagates immediately
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update status"),
  });

  const userPlanMutation = useMutation({
    mutationFn: async ({ row, plan }: { row: UserEnriched; plan: UserPlan }) => {
      // ── Cooldown check ─────────────────────────────────────
      // Admins bypass the 14-day cooldown via p_skip_cooldown=true.
      // This matches the admin_grant_subscription RPC behavior.
      const { error: rpcError } = await db.rpc("admin_grant_subscription", {
        p_target_user_id: row.user_id,
        p_plan_key: plan === "pro" ? "pro_creator" : plan,
        p_billing_cycle: "monthly",
        p_duration_days: 30,
        p_granted_reason: `Admin ${plan === row.plan ? "re-granted" : "changed"} to ${plan}`,
        p_skip_cooldown: true,           // admins always bypass cooldown
      } as any);

      if (rpcError) throw rpcError;

      await writeAdminLog("subscription_plan_updated", row.user_id, {
        email: row.email,
        plan,
        via: "admin_grant_subscription",
      });
    },
    onSuccess: () => {
      toast.success("Plan updated");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-v2"] });
      queryClient.invalidateQueries({ queryKey: ["admin-profiles-v2"] });
      // Invalidate the affected user's own profile/entitlement cache so changes propagate
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["entitlements"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update plan"),
  });

  const withdrawalMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: WithdrawStatus }) => {
      const { error } = await db.rpc("admin_process_withdrawal_request", {
        p_request_id: id,
        p_status: status,
        p_admin_note: null,
      });
      if (error) throw error;

      await writeAdminLog("withdrawal_status_updated", id, {
        status,
      });
    },
    onSuccess: () => {
      toast.success("Withdrawal updated");
      queryClient.invalidateQueries({ queryKey: ["admin-withdrawals-v2"] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate-profiles-v2"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update withdrawal"),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const errors = validateSettingsDraft(settingsDraft);
      if (Object.keys(errors).length > 0) {
        const first = Object.values(errors)[0];
        throw new Error(first);
      }

      const payload = {
        creator_price:                  Number(settingsDraft.creator_price),
        pro_price:                      Number(settingsDraft.pro_price),
        agency_price:                   Number(settingsDraft.agency_price),
        free_scripts_limit:             Number(settingsDraft.free_scripts_limit),
        free_scans_limit:               Number(settingsDraft.free_scans_limit),
        affiliate_commission_percent:   Number(settingsDraft.affiliate_commission_percent),
        minimum_withdrawal:             Number(settingsDraft.minimum_withdrawal),
        payout_delay_days:              Number(settingsDraft.payout_delay_days),
        maintenance_mode:               !!settingsDraft.maintenance_mode,
        announcement_banner:            settingsDraft.announcement_banner || null,
        creator_os_page_enabled:        !!settingsDraft.creator_os_page_enabled,
        creator_os_demo_video_url:      settingsDraft.creator_os_demo_video_url?.trim() || null,
        jvzoo_affiliate_enabled:        !!settingsDraft.jvzoo_affiliate_enabled,
        jvzoo_affiliate_demo_video_url: settingsDraft.jvzoo_affiliate_demo_video_url?.trim() || null,
        jvzoo_affiliate_cta_url:        settingsDraft.jvzoo_affiliate_cta_url?.trim() || null,
        jvzoo_affiliate_button_text:    settingsDraft.jvzoo_affiliate_button_text?.trim() || "Join Affiliate Program",
        jvzoo_affiliate_login_url:      settingsDraft.jvzoo_affiliate_login_url?.trim() || "https://www.tryrobin.xyz/login",
      };

      if (platformSettings?.id) {
        const { error } = await db.from("platform_settings").update(payload).eq("id", platformSettings.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("platform_settings").insert(payload);
        if (error) throw error;
      }

      await writeAdminLog("platform_settings_updated", platformSettings?.id ?? "new", payload);

      // Return the saved payload so onSuccess can use it directly
      return payload;
    },
    onSuccess: (savedPayload) => {
      toast.success("Settings saved");

      // Update the draft from the confirmed saved payload — NOT from a refetch.
      // This prevents the race condition where refetch returns stale/partial data
      // and overwrites the user's inputs.
      setSettingsDraft((prev) => ({
        ...prev,
        ...savedPayload,
        // Coerce nulls back to empty strings for controlled inputs
        announcement_banner:            savedPayload.announcement_banner ?? "",
        creator_os_demo_video_url:      savedPayload.creator_os_demo_video_url ?? "",
        jvzoo_affiliate_demo_video_url: savedPayload.jvzoo_affiliate_demo_video_url ?? "",
        jvzoo_affiliate_cta_url:        savedPayload.jvzoo_affiliate_cta_url ?? "",
        jvzoo_affiliate_button_text:    savedPayload.jvzoo_affiliate_button_text ?? "Join Affiliate Program",
        jvzoo_affiliate_login_url:      savedPayload.jvzoo_affiliate_login_url ?? "https://www.tryrobin.xyz/login",
      }));

      // Invalidate downstream consumers (public pages, affiliate page, etc.)
      // but NOT the admin settings query itself — we already have the correct state.
      queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      queryClient.invalidateQueries({ queryKey: ["platform-maintenance-v1"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-settings", user?.id] });

      // Silently refresh the admin settings query in the background so the
      // "Live Configuration Snapshot" section updates, but don't let it
      // overwrite the draft (draftHydratedRef is already true).
      queryClient.invalidateQueries({ queryKey: ["admin-platform-settings-v2"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save settings"),
  });

  const refreshAll = () => {
    [
      "admin-profiles-v2",
      "admin-subscriptions-v2",
      "admin-withdrawals-v2",
      "admin-affiliate-profiles-v2",
      "admin-affiliate-commissions-v2",
      "admin-ai-generations-v2",
      "admin-feature-usage-v2",
      "admin-platform-settings-v2",
      "admin-dashboard-metrics-v1",
    ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  };

  if (authLoading || (user && roleLoading) || (!authLoading && user && isAdmin === false)) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: "hsl(222 30% 4%)" }}>
        <div className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
            <Shield className="h-5 w-5" style={{ color: "hsl(217 91% 60%)" }} />
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verifying admin clearance...
          </div>
        </div>
      </div>
    );
  }

  const dashboardMetrics = [
    { label: "Total Users", value: formatNumber(profiles.length), growth: userGrowthPercent, icon: Users, spark: sparkFrom(dailySeries.map((d) => d.users)) },
    { label: "Active Subscribers", value: formatNumber(activeSubscribers), growth: growthPercent, icon: UserCheck, spark: sparkFrom(dailySeries.map((d) => d.subscriptions)) },
    { label: "Active Plan Value", value: formatCurrency(mrr), growth: growthPercent, icon: Wallet, spark: sparkFrom(dailySeries.map((d) => d.revenue)) },
    { label: "Pending Withdrawals", value: formatNumber(pendingWithdrawals.length), icon: Clock3, spark: sparkFrom(pendingWithdrawals.map((w) => Number(w.amount || 0))) },
    { label: "Affiliate Earnings", value: formatCurrency(totalAffiliateEarnings), icon: TrendingUp, spark: sparkFrom(affiliateCommissions.map((a) => Number(a.amount || 0))) },
    { label: "Scripts Generated", value: formatNumber(scriptsGenerated), icon: Sparkles, spark: sparkFrom(dailySeries.map((d) => d.scripts)) },
    { label: "Trend Searches", value: formatNumber(trendSearches), icon: BarChart3, spark: sparkFrom(dailySeries.map((d) => d.scans)) },
    { label: "Estimated AI Cost", value: formatCurrency(estimatedAiCost), icon: Activity, spark: sparkFrom(aiGenerations.map((g) => estimateGenerationCost(g.provider, Number(g.credits_used || 0)))) },
  ];

  const renderDashboardPage = () => (
    <div className="space-y-6">
      {/* ── Cinematic Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 45% 11%) 45%, hsl(222 28% 8%) 100%)",
          border: "1px solid hsl(217 30% 14%)",
          boxShadow: "0 12px 60px hsl(217 91% 60% / 0.06), 0 4px 20px hsl(0 0% 0% / 0.4)",
        }}
      >
        {/* Background radial glow */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 75% 50%, hsl(217 91% 60% / 0.06), transparent), radial-gradient(ellipse 30% 40% at 95% 10%, hsl(217 60% 50% / 0.04), transparent)" }} />
        {/* Micro grid */}
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.3) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

        <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(217 91% 60% / 0.5)" }}>ROBINOS COMMAND CENTER</span>
              <LiveBadge />
            </div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Executive Dashboard</h2>
            <p className="mt-1.5 text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>
              Platform-wide operational overview — revenue, users, AI activity, and infrastructure health.
            </p>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            {[
              { label: "MRR", val: formatCurrency(mrr), color: "hsl(217 91% 60%)" },
              { label: "USERS", val: formatNumber(profiles.length), color: "hsl(var(--foreground) / 0.7)" },
              { label: "ARR", val: formatCurrency(arr), color: "hsl(142 70% 55%)" },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-right">
                <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.28)" }}>{label}</p>
                <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Metric grid ── */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} growth={card.growth} icon={card.icon} spark={card.spark} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Revenue Overview chart */}
        <SectionCard
          title={<div className="flex items-center gap-2.5">Revenue Overview<LiveBadge /></div>}
          subtitle={<span className="font-mono">ROBINOS:REV · Active subscription value</span>}
        >
          <TerminalChart id="gradRev" data={dailySeries} dataKey="revenue" color="hsl(217 91% 60%)" height={220} emptyMsg="Revenue stream inactive — awaiting subscription data." />
        </SectionCard>

        {/* Plan Distribution chart */}
        <SectionCard
          title={<div className="flex items-center gap-2.5">Plan Distribution<LiveBadge /></div>}
          subtitle={
            <span className="flex items-center gap-3 font-mono">
              ROBINOS:PLANS ·{" "}
              {planDistribution.map((p) => (
                <span key={p.name} style={{ color: p.name === "Creator" ? "hsl(217 91% 60%)" : p.name === "Pro" ? "hsl(38 92% 50%)" : "hsl(142 70% 45%)" }}>
                  {p.name.toUpperCase()} {p.value > 0 ? `+${p.value}` : "—"}
                </span>
              ))}
            </span>
          }
        >
          <MultiAreaChart id="dashPlan" data={planDistributionTrend} height={220} />
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SectionCard title="Latest Users" subtitle="Most recently registered accounts">
          <DataTable headers={["email", "plan", "joined"]} colSpan={3} empty={!usersEnriched.length}>
            {usersEnriched.slice(0, 8).map((u) => (
              <tr key={u.user_id} className="border-t transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(217 91% 60% / 0.03)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                <td className="px-5 py-3 text-[11px]" style={{ color: "hsl(var(--foreground) / 0.7)" }}>{u.email}</td>
                <td className="px-5 py-3"><PlanChip plan={u.plan} /></td>
                <td className="px-5 py-3 font-mono text-[9.5px]" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
        <SectionCard title="Recent Subscriptions" subtitle="Latest billing events">
          <DataTable headers={["customer", "amount", "status"]} colSpan={3} empty={!subscriptions.length}>
            {subscriptions.slice(0, 8).map((s) => (
              <tr key={s.id} className="border-t transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(217 91% 60% / 0.03)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                <td className="px-5 py-3 text-[11px] truncate max-w-[160px]" style={{ color: "hsl(var(--foreground) / 0.7)" }}>{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td>
                <td className="px-5 py-3 font-mono text-[11px] font-semibold" style={{ color: "hsl(var(--foreground) / 0.82)" }}>{formatCurrency(s.amount)}</td>
                <td className="px-5 py-3"><StatusChip status={s.status} /></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
        <SectionCard title="Recent Withdrawals" subtitle="Pending payout requests">
          <DataTable headers={["affiliate", "amount", "status"]} colSpan={3} empty={!withdrawals.length}>
            {withdrawals.slice(0, 8).map((w) => (
              <tr key={w.id} className="border-t transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(217 91% 60% / 0.03)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                <td className="px-5 py-3 text-[11px] truncate max-w-[160px]" style={{ color: "hsl(var(--foreground) / 0.7)" }}>{profileMap.get(w.user_id)?.email ?? w.user_id.slice(0, 8)}</td>
                <td className="px-5 py-3 font-mono text-[11px] font-semibold" style={{ color: "hsl(var(--foreground) / 0.82)" }}>{formatCurrency(w.amount)}</td>
                <td className="px-5 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[8.5px] font-mono uppercase tracking-wider ${statusClass[asWithdrawStatus(w.status)]}`}>{asWithdrawStatus(w.status)}</span></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      </section>
    </div>
  );

  const renderAnalyticsPage = () => (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(228 42% 12%) 45%, hsl(222 28% 8%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(217 91% 60% / 0.06), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 50% 60% at 90% 50%, hsl(217 91% 60% / 0.06), transparent), radial-gradient(ellipse 25% 40% at 5% 90%, hsl(217 60% 40% / 0.04), transparent)" }} />
        <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(217 91% 60% / 0.5)" }}>INTELLIGENCE CENTER</span>
            <LiveBadge />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Platform Analytics</h2>
          <p className="text-[11.5px] max-w-sm mb-5" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Realtime infrastructure, growth, and AI usage telemetry.</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 max-w-lg">
            {[
              { label: "MRR",    val: formatCurrency(mrr),              color: "hsl(217 91% 62%)" },
              { label: "ARR",    val: formatCurrency(arr),              color: "hsl(var(--foreground) / 0.7)" },
              { label: "Growth", val: `${growthPercent.toFixed(1)}%`,   color: growthPercent > 0 ? "hsl(142 70% 55%)" : "hsl(0 72% 58%)" },
              { label: "Churn",  val: `${churnRate.toFixed(2)}%`,       color: "hsl(38 92% 60%)" },
            ].map(({ label, val, color }) => (
              <div key={label} className="rounded-xl px-4 py-3" style={{ background: "hsl(222 28% 5.5% / 0.8)", border: "1px solid hsl(217 28% 12%)" }}>
                <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.26)" }}>{label}</p>
                <p className="text-sm font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Revenue + Signups charts ── */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title={<div className="flex items-center gap-2.5">Revenue Analytics<LiveBadge /></div>}
          subtitle={<span className="font-mono">ROBINOS:MRR · Monthly recurring revenue stream</span>}
        >
          <TerminalChart id="gradRevA" data={dailySeries} dataKey="revenue" color="hsl(217 91% 60%)" height={200} emptyMsg="Revenue stream inactive." />
        </SectionCard>

        <SectionCard
          title={<div className="flex items-center gap-2.5">User Growth<LiveBadge color="amber" /></div>}
          subtitle={<span className="font-mono">ROBINOS:USR · Daily signup cadence</span>}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ background: "linear-gradient(180deg, hsl(222 32% 4%) 0%, hsl(222 26% 3%) 100%)", border: "1px solid hsl(217 28% 10%)" }}
          >
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 28% 12% / 0.22) 0px, transparent 1px, transparent 40px)", backgroundSize: "100% 40px" }} />
            <div className="h-[200px] px-1 pt-3 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs><linearGradient id="gradSignups" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.88} /><stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.35} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 28% 12% / 0)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={{ stroke: "hsl(217 28% 11%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 7% / 0.98)", border: "1px solid hsl(38 92% 50% / 0.25)", borderRadius: "8px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 12px 40px hsl(0 0% 0% / 0.6)" }} cursor={{ fill: "hsl(38 92% 50% / 0.04)" }} />
                  <Bar dataKey="signups" name="Signups" fill="url(#gradSignups)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      </section>

      {/* ── AI Telemetry + Feature Usage ── */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SectionCard title="AI Telemetry" subtitle="Generation events across all AI pipelines">
          <div className="space-y-2">
            {[
              { label: "Scripts generated", val: formatNumber(scriptsGenerated), icon: Sparkles, color: "hsl(217 91% 60%)" },
              { label: "Trend scans",        val: formatNumber(trendSearches),   icon: BarChart3, color: "hsl(142 70% 45%)" },
              { label: "Voice generations",  val: formatNumber(voiceGenerations), icon: Mic,      color: "hsl(38 92% 50%)" },
              { label: "Video generations",  val: formatNumber(videoGenerations), icon: Video,    color: "hsl(280 70% 60%)" },
              { label: "Est. AI cost",       val: formatCurrency(estimatedAiCost), icon: Activity, color: "hsl(0 72% 55%)" },
            ].map(({ label, val, icon: Icon, color }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg px-3.5 py-2.5 group hover:bg-white/[0.02] transition-colors"
                style={{ border: "1px solid hsl(217 28% 10%)", background: "hsl(222 28% 5.5% / 0.7)" }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color.replace(")", " / 0.1)")}`, border: `1px solid ${color.replace(")", " / 0.2)")}` }}>
                    <Icon className="h-3 w-3" style={{ color }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground/55">{label}</span>
                </div>
                <span className="text-sm font-bold text-foreground/85 font-mono">{val}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Cohort Mix" subtitle="Free vs paid vs AI cost breakdown">
          <div className="space-y-3">
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "hsl(222 28% 5.5% / 0.7)", border: "1px solid hsl(217 28% 10%)" }}>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/30 mb-1">Free Users</p>
                <p className="text-2xl font-bold text-foreground/85">{formatNumber(freeUsers)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 15%)" }}>
                <Users className="h-4 w-4 text-muted-foreground/30" />
              </div>
            </div>
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "hsl(217 91% 60% / 0.05)", border: "1px solid hsl(217 91% 60% / 0.15)" }}>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(217 91% 60% / 0.5)" }}>Paid Users</p>
                <p className="text-2xl font-bold text-foreground/85">{formatNumber(paidUsers)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
                <UserCheck className="h-4 w-4" style={{ color: "hsl(217 91% 60%)" }} />
              </div>
            </div>
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "hsl(222 28% 5.5% / 0.7)", border: "1px solid hsl(217 28% 10%)" }}>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/30 mb-1">Est. AI Cost</p>
                <p className="text-2xl font-bold text-foreground/85">{formatCurrency(estimatedAiCost)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(0 72% 55% / 0.08)", border: "1px solid hsl(0 72% 55% / 0.2)" }}>
                <Activity className="h-4 w-4" style={{ color: "hsl(0 72% 55%)" }} />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={<div className="flex items-center gap-2.5">Top Feature Usage<LiveBadge color="teal" /></div>}
          subtitle={<span className="font-mono">ROBINOS:FEAT · Events from feature_usage table</span>}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ background: "linear-gradient(180deg, hsl(222 32% 4%) 0%, hsl(222 26% 3%) 100%)", border: "1px solid hsl(217 28% 10%)" }}
          >
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 28% 12% / 0.22) 0px, transparent 1px, transparent 40px)", backgroundSize: "100% 40px" }} />
            <div className="h-[270px] px-1 pt-3 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topFeatureUsage.length ? topFeatureUsage : [{ feature: "—", value: 0 }]} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs><linearGradient id="gradFeat2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(172 70% 45%)" stopOpacity={0.9} /><stop offset="100%" stopColor="hsl(172 70% 45%)" stopOpacity={0.35} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 28% 12% / 0)" />
                  <XAxis dataKey="feature" tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={{ stroke: "hsl(217 28% 11%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 7% / 0.98)", border: "1px solid hsl(172 70% 45% / 0.25)", borderRadius: "8px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 12px 40px hsl(0 0% 0% / 0.6)" }} cursor={{ fill: "hsl(172 70% 45% / 0.04)" }} />
                  <Bar dataKey="value" name="Usage" fill="url(#gradFeat2)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );

  const renderSettingsPage = () => (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 36% 11%) 60%, hsl(222 28% 8%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(38 92% 50% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 40% 60% at 92% 50%, hsl(38 92% 50% / 0.05), transparent)" }} />
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(38 92% 55% / 0.5)" }}>INFRASTRUCTURE CONTROL</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Platform Settings</h2>
            <p className="text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Configuration changes propagate globally and affect all users immediately.</p>
          </div>
          <motion.button
            onClick={() => saveSettingsMutation.mutate()}
            disabled={saveSettingsMutation.isPending}
            className="relative h-10 rounded-xl px-6 text-sm font-semibold text-white transition-all disabled:opacity-50 overflow-hidden"
            style={{ background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 80% 44%))", boxShadow: "0 4px 20px hsl(217 91% 60% / 0.25), inset 0 1px 0 hsl(0 0% 100% / 0.1)" }}
            whileHover={{ y: -1, boxShadow: "0 6px 28px hsl(217 91% 60% / 0.35)" }}
            whileTap={{ y: 0 }}
          >
            <span className="relative z-10">{saveSettingsMutation.isPending ? "Deploying…" : "Deploy Changes"}</span>
          </motion.button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-5">
          <SectionCard title="Pricing Configuration" subtitle="Monthly subscription prices in USD">
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: "creator_price" as const, label: "Creator" },
                { key: "pro_price" as const, label: "Pro Creator" },
                { key: "agency_price" as const, label: "Agency" },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">{label}</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/40">$</span>
                    <Input type="number" min={0} className="pl-6 h-9 text-sm" value={settingsDraft[key]} onChange={(e) => setSettingsDraft((s) => ({ ...s, [key]: Number(e.target.value) }))} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Free Tier Limits" subtitle="Daily quotas for free-tier accounts">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Scripts / day</p>
                <Input type="number" min={0} className="h-9 text-sm" value={settingsDraft.free_scripts_limit} onChange={(e) => setSettingsDraft((s) => ({ ...s, free_scripts_limit: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Scans / day</p>
                <Input type="number" min={0} className="h-9 text-sm" value={settingsDraft.free_scans_limit} onChange={(e) => setSettingsDraft((s) => ({ ...s, free_scans_limit: Number(e.target.value) }))} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Affiliate Parameters" subtitle="Commission and payout configuration">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Commission %</p>
                <Input type="number" min={0} max={100} className="h-9 text-sm" value={settingsDraft.affiliate_commission_percent} onChange={(e) => setSettingsDraft((s) => ({ ...s, affiliate_commission_percent: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Min Withdrawal</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/40">$</span>
                  <Input type="number" min={1} className="pl-6 h-9 text-sm" value={settingsDraft.minimum_withdrawal} onChange={(e) => setSettingsDraft((s) => ({ ...s, minimum_withdrawal: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Payout Delay</p>
                <Input type="number" min={0} className="h-9 text-sm" value={settingsDraft.payout_delay_days} onChange={(e) => setSettingsDraft((s) => ({ ...s, payout_delay_days: Number(e.target.value) }))} />
              </div>
            </div>
          </SectionCard>
        </div>

        {/* RIGHT */}
        <div className="space-y-5">
          <SectionCard title="Operational State" subtitle="Global maintenance and announcement controls">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Maintenance Mode</p>
                <select
                  value={settingsDraft.maintenance_mode ? "true" : "false"}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, maintenance_mode: e.target.value === "true" }))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="false">● OPERATIONAL — Platform live</option>
                  <option value="true">⬤ MAINTENANCE — Showing banner</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Announcement Text</p>
                <Input
                  value={settingsDraft.announcement_banner}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, announcement_banner: e.target.value }))}
                  placeholder="e.g. Scheduled maintenance on May 25 at 2am UTC"
                  maxLength={280}
                  className="h-9 text-sm"
                />
                <p className="text-[9px] font-mono text-muted-foreground/25 text-right">{settingsDraft.announcement_banner.length}/280</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Marketing / Launch Controls" subtitle="Creator OS page visibility and demo video">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Creator OS Page</p>
                <select
                  value={settingsDraft.creator_os_page_enabled ? "true" : "false"}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, creator_os_page_enabled: e.target.value === "true" }))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="true">● VISIBLE — /creator-os publicly accessible</option>
                  <option value="false">⬤ HIDDEN — redirects to homepage</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Demo Video URL</p>
                <Input
                  value={settingsDraft.creator_os_demo_video_url}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, creator_os_demo_video_url: e.target.value }))}
                  placeholder="https://youtube.com/watch?v=... or Vimeo / Loom / MP4"
                  className="h-9 text-sm font-mono"
                />
                <p className="text-[9px] font-mono text-muted-foreground/25">YouTube, Vimeo, Loom, or direct MP4 URL. Leave empty to show placeholder.</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Launch Partners Page Controls" subtitle="Affiliate page visibility, video, CTA, and button text — controls /launch-partners route">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Affiliate Page Visibility</p>
                <select
                  value={settingsDraft.jvzoo_affiliate_enabled ? "true" : "false"}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, jvzoo_affiliate_enabled: e.target.value === "true" }))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="false">⬤ HIDDEN — /launch-partners redirects to homepage</option>
                  <option value="true">● VISIBLE — /launch-partners publicly accessible</option>
                </select>
                <p className="text-[9px] font-mono text-muted-foreground/25">Current: {settingsDraft.jvzoo_affiliate_enabled ? "● VISIBLE" : "⬤ HIDDEN"} · Save to apply</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Demo Video URL</p>
                <Input
                  value={settingsDraft.jvzoo_affiliate_demo_video_url}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, jvzoo_affiliate_demo_video_url: e.target.value }))}
                  placeholder="https://youtube.com/watch?v=... or Vimeo / Loom / MP4"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Affiliate CTA URL (JVZoo link)</p>
                <Input
                  value={settingsDraft.jvzoo_affiliate_cta_url}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, jvzoo_affiliate_cta_url: e.target.value }))}
                  placeholder="https://jvzoo.com/... or your affiliate sign-up URL"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Join Button Text</p>
                <Input
                  value={settingsDraft.jvzoo_affiliate_button_text}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, jvzoo_affiliate_button_text: e.target.value }))}
                  placeholder="Join Affiliate Program"
                  maxLength={60}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/35">Affiliate Login / Signup URL</p>
                <Input
                  value={settingsDraft.jvzoo_affiliate_login_url}
                  onChange={(e) => setSettingsDraft((s) => ({ ...s, jvzoo_affiliate_login_url: e.target.value }))}
                  placeholder="https://www.tryrobin.xyz/login"
                  className="h-9 text-sm font-mono"
                />
                <p className="text-[9px] font-mono text-muted-foreground/25">All affiliate CTA buttons use this URL. Default: /login</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Live Configuration Snapshot" subtitle={platformSettings?.updated_at ? `Last deployed: ${new Date(platformSettings.updated_at).toLocaleString()}` : "No config deployed yet"}>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Creator", value: `$${platformSettings?.creator_price ?? "—"}/mo` },
                { label: "Pro", value: `$${platformSettings?.pro_price ?? "—"}/mo` },
                { label: "Agency", value: `$${platformSettings?.agency_price ?? "—"}/mo` },
                { label: "Free Scripts", value: `${platformSettings?.free_scripts_limit ?? "—"}/day` },
                { label: "Free Scans", value: `${platformSettings?.free_scans_limit ?? "—"}/day` },
                { label: "Commission", value: `${platformSettings?.affiliate_commission_percent ?? "—"}%` },
                { label: "Min Payout", value: `$${platformSettings?.minimum_withdrawal ?? "—"}` },
                { label: "Status", value: platformSettings?.maintenance_mode ? "MAINTENANCE" : "OPERATIONAL" },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: "hsl(222 28% 5.5%)", border: "1px solid hsl(217 28% 10%)" }}
                >
                  <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider">{label}</span>
                  <span className="text-[11px] font-mono text-foreground/70">{String(value)}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Admin PWA Install ── */}
          <SectionCard
            title="Admin App"
            subtitle="Install RobinOS Admin as a native app on your device"
          >
            <AdminPWAInstall />
          </SectionCard>
        </div>
      </div>
    </div>
  );

  const renderUsersPage = () => (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(222 28% 8%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(142 70% 45% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 50% 80% at 88% 50%, hsl(142 70% 45% / 0.05), transparent)" }} />
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(142 70% 50% / 0.5)" }}>OPERATIONS CONSOLE</span>
              <LiveBadge color="green" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>User Management</h2>
            <p className="text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Manage user lifecycle, plan assignments, suspensions, and access control.</p>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            {[
              { label: "Total",  val: formatNumber(usersEnriched.length),  color: "hsl(var(--foreground) / 0.7)" },
              { label: "Active", val: formatNumber(activeSubscribers),      color: "hsl(217 91% 62%)" },
              { label: "Paid",   val: formatNumber(paidUsers),              color: "hsl(142 70% 55%)" },
              { label: "Free",   val: formatNumber(freeUsers),              color: "hsl(38 92% 58%)" },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-right">
                <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.26)" }}>{label}</p>
                <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Users"    value={formatNumber(usersEnriched.length)}  icon={Users}     spark={sparkFrom(dailySeries.map((d) => d.users))} />
        <MetricCard label="Active Users"   value={formatNumber(activeSubscribers)}       icon={UserCheck} spark={sparkFrom(dailySeries.map((d) => d.subscriptions))} />
        <MetricCard label="Free Users"     value={formatNumber(freeUsers)}               icon={Users}     spark={sparkFrom(usersEnriched.filter((u) => u.plan === "creator").map((u) => u.scriptsUsed))} />
        <MetricCard label="Paid Users"     value={formatNumber(paidUsers)}               icon={Users}     spark={sparkFrom(usersEnriched.filter((u) => u.status === "active").map((u) => u.scriptsUsed))} />
      </section>

      <SectionCard title="User Operations Table" subtitle="Search, filter, and manage all platform accounts">
        {/* Filter bar */}
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
          <div
            className="flex h-9 items-center gap-2 rounded-lg px-3 md:col-span-2"
            style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 6%)" }}
          >
            <Search className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
            <input
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
              className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/25"
              placeholder="Search by email, name, plan..."
            />
          </div>
          <select
            value={userPlanFilter}
            onChange={(e) => { setUserPlanFilter(e.target.value as "all" | UserPlan); setUserPage(1); }}
            className="h-9 rounded-lg px-3 text-xs text-foreground"
            style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 6%)" }}
          >
            <option value="all">All plans</option>
            <option value="creator">Creator</option>
            <option value="pro">Pro</option>
            <option value="agency">Agency</option>
          </select>
          <select
            value={userStatusFilter}
            onChange={(e) => { setUserStatusFilter(e.target.value as "all" | UserEnriched["status"]); setUserPage(1); }}
            className="h-9 rounded-lg px-3 text-xs text-foreground"
            style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 6%)" }}
          >
            <option value="all">All status</option>
            <option value="trialing">Trialing</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <div className="overflow-auto rounded-xl" style={{ border: "1px solid hsl(217 28% 11% / 0.8)" }}>
          <table className="w-full min-w-[1100px] text-xs">
            <thead style={{ background: "hsl(222 28% 5%)", borderBottom: "1px solid hsl(217 28% 11%)" }}>
              <tr>
                {["account", "email", "plan", "scripts", "scans", "joined", "affiliate", "status", "source", "actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[9px] font-mono uppercase tracking-[0.14em]" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map((row) => {
                const planLadder: UserPlan[] = ["creator", "pro", "agency"];
                const currentIdx = planLadder.indexOf(row.plan);
                const upgradePlan: UserPlan = currentIdx < planLadder.length - 1 ? planLadder[currentIdx + 1] : "agency";
                const downgradePlan: UserPlan = currentIdx > 0 ? planLadder[currentIdx - 1] : "creator";
                const canUpgrade = row.plan !== "agency";
                const canDowngrade = !(row.plan === "creator" && row.amount === 0);
                const isSuspendPending = userStatusMutation.isPending && (userStatusMutation.variables as any)?.row?.user_id === row.user_id;
                const isPlanPending = userPlanMutation.isPending && (userPlanMutation.variables as any)?.row?.user_id === row.user_id;
                return (
                  <tr key={row.user_id} className="border-t hover:bg-white/[0.018] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold"
                        style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)", color: "hsl(217 91% 70%)" }}
                      >
                        {row.email.slice(0, 1).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80 max-w-[180px] truncate">{row.email}</td>
                    <td className="px-4 py-3"><PlanChip plan={row.plan} /></td>
                    <td className="px-4 py-3 font-mono text-foreground/70">{formatNumber(row.scriptsUsed)}</td>
                    <td className="px-4 py-3 font-mono text-foreground/70">{formatNumber(row.trendScans)}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/35">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-muted-foreground/40 text-[10px]">{row.is_affiliate ? "Yes" : "—"}</td>
                    <td className="px-4 py-3"><StatusChip status={row.status} /></td>
                    <td className="px-4 py-3"><SourceBadge src={row.subscriptionSource} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className={`h-7 rounded-lg border px-2.5 text-[9px] font-mono uppercase tracking-wider transition-all disabled:opacity-40 ${
                            row.status === "suspended"
                              ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                              : "border-red-500/25 text-red-400 hover:bg-red-500/8"
                          }`}
                          disabled={isSuspendPending}
                          onClick={() => userStatusMutation.mutate({ row, suspended: row.status !== "suspended" })}
                        >
                          {isSuspendPending ? "…" : row.status === "suspended" ? "activate" : "suspend"}
                        </button>
                        <button
                          className="h-7 rounded-lg border px-2.5 text-[9px] font-mono uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ borderColor: "hsl(217 91% 60% / 0.25)", color: "hsl(217 91% 60%)" }}
                          disabled={!canUpgrade || isPlanPending}
                          onClick={() => userPlanMutation.mutate({ row, plan: upgradePlan })}
                        >
                          {isPlanPending ? "…" : "↑ up"}
                        </button>
                        <button
                          className="h-7 rounded-lg border px-2.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/40 hover:text-foreground/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ borderColor: "hsl(217 28% 14%)" }}
                          disabled={!canDowngrade || isPlanPending}
                          onClick={() => userPlanMutation.mutate({ row, plan: downgradePlan })}
                        >
                          {isPlanPending ? "…" : "↓ down"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pagedUsers.length ? (
                <tr><td colSpan={10} className="p-0"><EmptyState title="No accounts detected" description="Adjust your search or filters to locate users." /></td></tr>
              ) : null}
            </tbody>
          </table>
          <PaginationControls page={userPage} totalPages={totalUserPages} setPage={setUserPage} />
        </div>
      </SectionCard>
    </div>
  );

  // At-risk: subscriptions in lifecycle states that indicate likely churn.
  // Includes all new statuses from migration 30/31.
  const atRiskSubscriptions = useMemo(() =>
    subscriptions.filter((s) => {
      const st = (s.status || "").toLowerCase();
      return ["past_due", "expiring", "grace_period", "payment_failed"].includes(st);
    }),
  [subscriptions]);

  // Cancelled: all terminated subscriptions (both spellings)
  const cancelledSubs = useMemo(() =>
    subscriptions.filter((s) => {
      const st = (s.status || "").toLowerCase();
      return st === "cancelled" || st === "canceled";
    }),
  [subscriptions]);

  const renderSubscriptionsPage = () => (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 38% 11%) 50%, hsl(222 28% 8%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(142 70% 45% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 82% 50%, hsl(142 70% 45% / 0.05), transparent)" }} />
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(142 70% 50% / 0.5)" }}>BILLING OPERATIONS</span>
            <LiveBadge color="green" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Subscription Management</h2>
          <p className="text-[11.5px] max-w-sm mb-5" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Monitor recurring revenue systems and subscription lifecycle integrity.</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 max-w-lg">
            {[
              { label: "MRR",     val: formatCurrency(mrr),                         color: "hsl(217 91% 62%)" },
              { label: "ARR",     val: formatCurrency(arr),                         color: "hsl(var(--foreground) / 0.7)" },
              { label: "Churn",   val: `${churnRate.toFixed(2)}%`,                  color: "hsl(38 92% 58%)" },
              { label: "At-Risk", val: formatNumber(atRiskSubscriptions.length),    color: "hsl(0 72% 58%)" },
            ].map(({ label, val, color }) => (
              <div key={label} className="rounded-xl px-4 py-3" style={{ background: "hsl(222 28% 5.5% / 0.8)", border: "1px solid hsl(217 28% 12%)" }}>
                <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.26)" }}>{label}</p>
                <p className="text-sm font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active Plan Value"   value={formatCurrency(mrr)}                      icon={Wallet}       spark={sparkFrom(dailySeries.map((d) => d.revenue))}              growth={growthPercent} />
        <MetricCard label="Active Subscribers"  value={formatNumber(activeSubscribers)}           icon={UserCheck}    spark={sparkFrom(dailySeries.map((d) => d.subscriptions))} />
        <MetricCard label="Churn Rate"          value={`${churnRate.toFixed(2)}%`}               icon={ArrowDownRight} spark={sparkFrom(cancelledSubs.map((s) => Number(s.amount || 0)))} />
        <MetricCard label="At-Risk Subs"        value={formatNumber(atRiskSubscriptions.length)} icon={Clock3}       spark={sparkFrom(atRiskSubscriptions.map((s) => Number(s.amount || 0)))} />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title={<div className="flex items-center gap-2.5">Plan Distribution<LiveBadge /></div>}
          subtitle={
            <span className="flex items-center gap-3 font-mono">
              ROBINOS:PLANS ·{" "}
              {planDistribution.map((p) => (
                <span key={p.name} style={{ color: p.name === "Creator" ? "hsl(217 91% 60%)" : p.name === "Pro" ? "hsl(38 92% 50%)" : "hsl(142 70% 45%)" }}>
                  {p.name.toUpperCase()} {p.value > 0 ? `+${p.value}` : "—"}
                </span>
              ))}
            </span>
          }
        >
          <MultiAreaChart id="subPlan" data={planDistributionTrend} height={220} />
        </SectionCard>

        <SectionCard title="Active Subscriptions" subtitle="Currently active billing accounts">
          <DataTable headers={["email", "plan", "amount", "status"]} colSpan={4} empty={!usersEnriched.filter((u) => u.status === "active").length}>
            {usersEnriched.filter((u) => u.status === "active").slice(0, 10).map((u) => (
              <tr key={u.user_id} className="border-t hover:bg-white/[0.015] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                <td className="px-4 py-2.5 text-foreground/80 max-w-[160px] truncate">{u.email}</td>
                <td className="px-4 py-2.5"><PlanChip plan={u.plan} /></td>
                <td className="px-4 py-2.5 font-mono text-foreground/80">{formatCurrency(u.amount)}</td>
                <td className="px-4 py-2.5"><StatusChip status={u.status} /></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard title="At-Risk Subscriptions" subtitle="Past due and flagged accounts — require action">
          <DataTable headers={["email", "amount", "currency", "status"]} colSpan={4} empty={!atRiskSubscriptions.length}>
            {atRiskSubscriptions.slice(0, 10).map((s) => (
              <tr key={s.id} className="border-t hover:bg-white/[0.015] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                <td className="px-4 py-2.5 text-foreground/80">{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 font-mono text-foreground/80">{formatCurrency(s.amount)}</td>
                <td className="px-4 py-2.5 text-muted-foreground/40 font-mono text-[10px]">{s.currency}</td>
                <td className="px-4 py-2.5"><StatusChip status={s.status} /></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
        <SectionCard title="Churned Accounts" subtitle="Cancelled subscriptions — churn monitoring">
          <DataTable headers={["email", "plan", "status"]} colSpan={3} empty={!cancelledSubs.length}>
            {cancelledSubs.slice(0, 10).map((s) => (
              <tr key={s.id} className="border-t hover:bg-white/[0.015] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                <td className="px-4 py-2.5 text-foreground/80">{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5"><PlanChip plan={asPlan(s.plan)} /></td>
                <td className="px-4 py-2.5"><StatusChip status={s.status} /></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      </section>
    </div>
  );

  const affiliateUsers = useMemo(() => usersEnriched.filter((u) => u.is_affiliate), [usersEnriched]);
  const pendingAffiliateCommissions = useMemo(() => affiliateCommissions.filter((c) => c.status === "pending").reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);
  const paidAffiliateCommissions = useMemo(() => affiliateCommissions.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);

  const renderAffiliatesPage = () => (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(225 38% 11%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(38 92% 50% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 82% 50%, hsl(38 92% 50% / 0.05), transparent)" }} />
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(38 92% 55% / 0.5)" }}>GROWTH INTELLIGENCE</span>
              <LiveBadge color="amber" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Affiliate Operations</h2>
            <p className="text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Conversion performance, commission health, and payout lifecycle.</p>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            {[
              { label: "Affiliates", val: formatNumber(affiliateProfiles.length),      color: "hsl(var(--foreground) / 0.7)" },
              { label: "Pending",    val: formatCurrency(pendingAffiliateCommissions),  color: "hsl(38 92% 60%)" },
              { label: "Paid Out",   val: formatCurrency(paidAffiliateCommissions),    color: "hsl(142 70% 55%)" },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-right">
                <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.26)" }}>{label}</p>
                <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Affiliates"    value={formatNumber(affiliateProfiles.length)}    icon={Users}        spark={sparkFrom(affiliateProfiles.map((a) => Number(a.total_clicks || 0)))} />
        <MetricCard label="Pending Commissions" value={formatCurrency(pendingAffiliateCommissions)} icon={Clock3}     spark={sparkFrom(affiliateCommissions.filter((a) => a.status === "pending").map((a) => Number(a.amount || 0)))} />
        <MetricCard label="Paid Commissions"    value={formatCurrency(paidAffiliateCommissions)}  icon={CheckCircle2} spark={sparkFrom(affiliateCommissions.filter((a) => a.status === "paid").map((a) => Number(a.amount || 0)))} />
        <MetricCard label="Conversion Revenue"  value={formatCurrency(totalAffiliateEarnings)}    icon={TrendingUp}   spark={sparkFrom(affiliateCommissions.map((a) => Number(a.amount || 0)))} />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard title="Affiliate Leaderboard" subtitle="Top performers by earnings and conversions">
          <DataTable headers={["rank", "email", "clicks", "conversions", "earned"]} colSpan={5} empty={!affiliateProfiles.length}>
            {affiliateProfiles.slice(0, 10).map((a, idx) => (
              <tr key={a.user_id} className="border-t hover:bg-white/[0.015] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                <td className="px-4 py-2.5">
                  <span className="text-[10px] font-mono" style={{ color: idx === 0 ? "hsl(38 92% 55%)" : idx === 1 ? "hsl(220 15% 55%)" : idx === 2 ? "hsl(25 60% 45%)" : "hsl(var(--muted-foreground) / 0.25)" }}>
                    #{idx + 1}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-foreground/80 max-w-[160px] truncate">{profileMap.get(a.user_id)?.email ?? a.user_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 font-mono text-foreground/60">{formatNumber(a.total_clicks)}</td>
                <td className="px-4 py-2.5 font-mono text-foreground/60">{formatNumber(a.total_conversions)}</td>
                <td className="px-4 py-2.5 font-mono font-semibold" style={{ color: "hsl(217 91% 65%)" }}>{formatCurrency(a.total_earned)}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard
          title={<div className="flex items-center gap-2.5">Referral Conversions<LiveBadge color="amber" /></div>}
          subtitle={<span className="font-mono">ROBINOS:AFF · Per-affiliate conversion and earnings</span>}
        >
          <div className="relative rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 32% 4%) 0%, hsl(222 26% 3%) 100%)", border: "1px solid hsl(217 28% 10%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 28% 12% / 0.22) 0px, transparent 1px, transparent 40px)", backgroundSize: "100% 40px" }} />
            <div className="h-[240px] px-1 pt-3 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={affiliateProfiles.slice(0, 8).map((a) => ({ name: (profileMap.get(a.user_id)?.email || a.user_id).split("@")[0], conversions: a.total_conversions, earned: a.total_earned }))}
                  margin={{ top: 4, right: 8, left: -24, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="affConvGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.9} /><stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0.35} /></linearGradient>
                    <linearGradient id="affEarnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.85} /><stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} /></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 28% 12% / 0)" />
                  <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={{ stroke: "hsl(217 28% 11%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.3)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 7% / 0.98)", border: "1px solid hsl(217 28% 16%)", borderRadius: "8px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 12px 40px hsl(0 0% 0% / 0.6)" }} cursor={{ fill: "hsl(217 91% 60% / 0.04)" }} />
                  <Bar dataKey="conversions" name="Conversions" fill="url(#affConvGrad)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="earned" name="Earned" fill="url(#affEarnGrad)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title={<div className="flex items-center gap-2.5">Affiliate Growth<LiveBadge color="green" /></div>}
          subtitle={<span className="font-mono">ROBINOS:AFFG · Cumulative affiliate onboarding</span>}
        >
          <TerminalChart id="affGrowth" data={dailySeries} dataKey="users" color="hsl(142 70% 45%)" height={200} emptyMsg="No affiliate activity detected." />
        </SectionCard>
        <SectionCard title="Pending Commission Queue" subtitle="Awaiting processing and payout">
          <DataTable headers={["affiliate", "commission", "date"]} colSpan={3} empty={!affiliateCommissions.filter((c) => c.status === "pending").length}>
            {affiliateCommissions.filter((c) => c.status === "pending").slice(0, 10).map((c) => (
              <tr key={c.id} className="border-t hover:bg-white/[0.015] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                <td className="px-4 py-2.5 text-foreground/80">{profileMap.get(c.affiliate_user_id)?.email ?? c.affiliate_user_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 font-mono text-foreground/80">{formatCurrency(c.amount)}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground/35">{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      </section>
    </div>
  );

  const paidWithdrawalsMonth = useMemo(() => {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return withdrawals.filter((w) => asWithdrawStatus(w.status) === "paid" && new Date(w.created_at).getTime() >= monthAgo);
  }, [withdrawals]);

  const totalWithdrawalVolume = useMemo(() => withdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0), [withdrawals]);
  const failedWithdrawals = useMemo(() => withdrawals.filter((w) => asWithdrawStatus(w.status) === "rejected").length, [withdrawals]);

  const renderWithdrawalsPage = () => {
    const filtered = withdrawStatusFilter === "all" ? withdrawals : withdrawals.filter((w) => asWithdrawStatus(w.status) === withdrawStatusFilter);
    return (
      <div className="space-y-6">
        {/* ── Hero ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="relative rounded-3xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(218 38% 11%) 100%)", border: "1px solid hsl(217 30% 14%)", boxShadow: "0 12px 60px hsl(280 70% 60% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)" }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 50% 60% at 87% 50%, hsl(280 70% 60% / 0.05), transparent)" }} />
          <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
          <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(280 70% 65% / 0.5)" }}>TREASURY OPERATIONS</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Withdrawal Operations</h2>
              <p className="text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Audit-safe payout queue. Approve, process, or reject affiliate payouts.</p>
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              {[
                { label: "Pending",  val: formatNumber(pendingWithdrawals.length),   color: "hsl(38 92% 58%)" },
                { label: "Volume",   val: formatCurrency(totalWithdrawalVolume),      color: "hsl(var(--foreground) / 0.7)" },
                { label: "Rejected", val: formatNumber(failedWithdrawals),            color: "hsl(0 72% 58%)" },
              ].map(({ label, val, color }) => (
                <div key={label} className="text-right">
                  <p className="text-[8px] font-mono uppercase tracking-[0.2em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.26)" }}>{label}</p>
                  <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums", color }}>{val}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Pending Withdrawals"       value={formatNumber(pendingWithdrawals.length)}                                      icon={Clock3}       spark={sparkFrom(pendingWithdrawals.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Paid This Month"           value={formatCurrency(paidWithdrawalsMonth.reduce((s, w) => s + Number(w.amount || 0), 0))} icon={CheckCircle2} spark={sparkFrom(paidWithdrawalsMonth.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Total Volume"              value={formatCurrency(totalWithdrawalVolume)}                                         icon={Wallet}       spark={sparkFrom(withdrawals.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Failed Withdrawals"        value={formatNumber(failedWithdrawals)}                                              icon={ArrowDownRight} spark={sparkFrom(withdrawals.filter((w) => asWithdrawStatus(w.status) === "rejected").map((w) => Number(w.amount || 0)))} />
        </section>

        <SectionCard
          title="Payout Request Queue"
          subtitle="Review, approve, and mark withdrawals as paid"
          right={
            <select
              value={withdrawStatusFilter}
              onChange={(e) => setWithdrawStatusFilter(e.target.value as "all" | WithdrawStatus)}
              className="h-8 rounded-lg px-3 text-[10px] font-mono text-foreground"
              style={{ border: "1px solid hsl(217 28% 13%)", background: "hsl(222 28% 6%)" }}
            >
              <option value="all">All status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          }
        >
          <div className="overflow-auto rounded-xl" style={{ border: "1px solid hsl(217 28% 11% / 0.8)" }}>
            <table className="w-full min-w-[1100px] text-xs">
              <thead style={{ background: "hsl(222 28% 5%)", borderBottom: "1px solid hsl(217 28% 11%)" }}>
                <tr>
                  {["affiliate", "method", "payout address", "amount", "date", "status", "actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[9px] font-mono uppercase tracking-[0.14em]" style={{ color: "hsl(var(--muted-foreground) / 0.3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const status = asWithdrawStatus(row.status);
                  const email = profileMap.get(row.user_id)?.email ?? row.user_id.slice(0, 8);
                  const payoutMethodLabel = row.payout_method === "usdt_trc20" ? "USDT TRC20" : "PayPal";
                  return (
                    <tr key={row.id} className="border-t hover:bg-white/[0.018] transition-colors" style={{ borderColor: "hsl(217 28% 10%)" }}>
                      <td className="px-4 py-3 text-foreground/80 max-w-[140px] truncate">{email}</td>
                      <td className="px-4 py-3">
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{ background: "hsl(217 28% 10%)", color: "hsl(var(--muted-foreground) / 0.5)", border: "1px solid hsl(217 28% 14%)" }}>
                          {payoutMethodLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/50 max-w-[200px]">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{row.payout_details}</span>
                          <button
                            onClick={() => { void navigator.clipboard.writeText(row.payout_details || ""); toast.success("Copied"); }}
                            className="shrink-0 inline-flex h-6 items-center gap-1 rounded px-1.5 text-[9px] font-mono text-muted-foreground/35 hover:text-foreground/60 transition-colors"
                            style={{ border: "1px solid hsl(217 28% 13%)" }}
                          >
                            <Copy className="h-2.5 w-2.5" /> copy
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground/85">{formatCurrency(row.amount)}</td>
                      <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/35">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider ${statusClass[status]}`}>{status}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {status === "pending" ? (
                            <>
                              <button
                                onClick={() => withdrawalMutation.mutate({ id: row.id, status: "approved" })}
                                className="h-7 rounded-lg px-2.5 text-[9px] font-mono uppercase tracking-wider text-white transition-all"
                                style={{ background: "hsl(217 91% 50% / 0.85)", border: "1px solid hsl(217 91% 60% / 0.3)" }}
                              >
                                approve
                              </button>
                              <button
                                onClick={() => withdrawalMutation.mutate({ id: row.id, status: "rejected" })}
                                className="h-7 rounded-lg px-2.5 text-[9px] font-mono uppercase tracking-wider text-red-400 transition-all"
                                style={{ border: "1px solid hsl(0 72% 55% / 0.25)", background: "hsl(0 72% 55% / 0.06)" }}
                              >
                                reject
                              </button>
                            </>
                          ) : null}
                          {status === "approved" ? (
                            <button
                              onClick={() => withdrawalMutation.mutate({ id: row.id, status: "paid" })}
                              className="h-7 rounded-lg px-2.5 text-[9px] font-mono uppercase tracking-wider text-emerald-400 transition-all"
                              style={{ border: "1px solid hsl(142 70% 45% / 0.3)", background: "hsl(142 70% 45% / 0.07)" }}
                            >
                              mark paid
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length ? (
                  <tr><td colSpan={7} className="p-0"><EmptyState title="No payout requests detected" description="Affiliate withdrawal requests will appear here." /></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    );
  };

  const renderPage = () => {
    switch (currentPath) {
      case "/adminsh/dashboard":
        return renderDashboardPage();
      case "/adminsh/analytics":
        return renderAnalyticsPage();
      case "/adminsh/settings":
        return renderSettingsPage();
      case "/adminsh/users":
        return renderUsersPage();
      case "/adminsh/subscriptions":
        return renderSubscriptionsPage();
      case "/adminsh/affiliates":
        return renderAffiliatesPage();
      case "/adminsh/withdrawals":
        return renderWithdrawalsPage();
      default:
        return renderDashboardPage();
    }
  };

  const meta = pageMeta[currentPath];

  return (
    <SidebarProvider defaultOpen>
      <div
        className="flex min-h-screen w-full overflow-hidden"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% -10%, hsl(217 60% 12% / 0.4), transparent), radial-gradient(ellipse 40% 50% at 90% 80%, hsl(217 40% 8% / 0.25), transparent), hsl(222 32% 4%)",
        }}
      >
        {/* ── Sidebar ── */}
        <Sidebar
          collapsible="icon"
          className="backdrop-blur-2xl"
          style={{
            background: "linear-gradient(180deg, hsl(222 30% 6% / 0.99) 0%, hsl(222 28% 5.5% / 0.99) 100%)",
            borderRight: "1px solid hsl(217 28% 10%)",
            boxShadow: "4px 0 28px hsl(0 0% 0% / 0.4), inset -1px 0 0 hsl(217 91% 60% / 0.04)",
          }}
        >
          <SidebarContent className="flex flex-col h-full">
            {/* Brand */}
            <div
              className="flex h-[58px] items-center px-4 shrink-0"
              style={{ borderBottom: "1px solid hsl(217 28% 10%)" }}
            >
              <BrandMark
                size={18}
                withWordmark
                className="group-data-[collapsible=icon]:opacity-0 transition-opacity duration-200 drop-shadow-[0_0_18px_hsl(217_91%_60%/0.28)]"
              />
            </div>

            {/* AI System status */}
            <div
              className="mx-3 mt-3 mb-1 px-3 py-2.5 rounded-xl group-data-[collapsible=icon]:hidden"
              style={{ background: "hsl(217 91% 60% / 0.04)", border: "1px solid hsl(217 91% 60% / 0.09)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 6px hsl(142 70% 45% / 0.8)", animationDuration: "2.5s" }}
                />
                <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: "hsl(217 91% 62% / 0.55)" }}>
                  ROBINOS · PRODUCTION
                </span>
              </div>
              <p className="mt-0.5 text-[9px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.2)" }}>All systems operational</p>
            </div>

            {/* Nav */}
            <div className="flex-1 px-2 pt-2 pb-2 space-y-0.5 overflow-y-auto">
              {navGroups.map((group) => {
                const isGroupActive = group.items.some((item) => currentPath === item.path);
                return (
                  <SidebarGroup key={group.title}>
                    <SidebarGroupLabel
                      className="px-3 pt-4 pb-1.5 text-[7.5px] font-mono uppercase tracking-[0.28em] group-data-[collapsible=icon]:hidden"
                      style={{ color: "hsl(var(--muted-foreground) / 0.18)" }}
                    >
                      {group.title}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu className="space-y-0.5">
                        {group.items.map((item) => {
                          const isActive = currentPath === item.path;
                          return (
                            <SidebarMenuItem key={item.path}>
                              <SidebarMenuButton asChild isActive={isActive}>
                                <NavLink
                                  to={item.path}
                                  onClick={() => { if (currentPath === item.path) window.scrollTo({ top: 0, behavior: "smooth" }); }}
                                  className="relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[11px] font-medium transition-all duration-200 overflow-hidden"
                                  style={isActive ? {
                                    background: "linear-gradient(135deg, hsl(217 91% 60% / 0.13), hsl(217 60% 30% / 0.05))",
                                    border: "1px solid hsl(217 91% 60% / 0.22)",
                                    color: "hsl(217 91% 72%)",
                                    boxShadow: "0 2px 16px hsl(217 91% 60% / 0.08)",
                                  } : {
                                    border: "1px solid transparent",
                                    color: "hsl(var(--muted-foreground) / 0.42)",
                                  }}
                                >
                                  {isActive && (
                                    <span
                                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full"
                                      style={{ background: "linear-gradient(180deg, hsl(217 91% 65%), hsl(217 91% 60% / 0.25))", boxShadow: "2px 0 10px hsl(217 91% 60% / 0.55)" }}
                                    />
                                  )}
                                  <item.icon className="h-[14px] w-[14px] shrink-0" />
                                  <span className="tracking-wide group-data-[collapsible=icon]:hidden">{item.label}</span>
                                </NavLink>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                );
              })}
            </div>

            {/* Bottom admin identity */}
            <div
              className="mx-3 mb-3 px-3 py-2.5 rounded-xl shrink-0 group-data-[collapsible=icon]:hidden"
              style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 10%)" }}
            >
              <p className="text-[7.5px] font-mono uppercase tracking-[0.22em] mb-0.5" style={{ color: "hsl(var(--muted-foreground) / 0.18)" }}>Admin Session</p>
              <p className="text-[9.5px] font-mono truncate" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>{user?.email ?? "—"}</p>
            </div>
          </SidebarContent>
        </Sidebar>

        {/* ── Main ── */}
        <div className="min-w-0 flex-1 flex flex-col">
          {/* Mission Control Topbar */}
          <header
            className="sticky top-0 z-20 flex h-[58px] items-center justify-between px-4 sm:px-6"
            style={{
              background: "hsl(222 30% 5% / 0.94)",
              borderBottom: "1px solid hsl(217 28% 10%)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 1px 0 hsl(217 91% 60% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.2)",
            }}
          >
            <div className="flex items-center gap-3">
              <SidebarTrigger
                className="transition-all hover:scale-105 text-muted-foreground/28 hover:text-foreground/60"
              />
              <div className="w-px h-4 shrink-0" style={{ background: "hsl(217 28% 11%)" }} />
              <div className="flex items-center gap-1.5">
                <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: "hsl(217 91% 60% / 0.38)" }}>Admin</span>
                <span className="text-[8.5px] font-mono" style={{ color: "hsl(var(--muted-foreground) / 0.15)" }}>/</span>
                <span className="text-[8.5px] font-mono uppercase tracking-[0.15em]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>{meta.title}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="hidden sm:flex items-center gap-1.5 h-7 px-3 rounded-lg"
                style={{ background: "hsl(142 70% 45% / 0.05)", border: "1px solid hsl(142 70% 45% / 0.1)" }}
              >
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: "hsl(142 70% 50%)", boxShadow: "0 0 5px hsl(142 70% 45% / 0.7)", animationDuration: "2s" }} />
                <span className="text-[7.5px] font-mono tracking-[0.2em] uppercase" style={{ color: "hsl(142 70% 55% / 0.55)" }}>LIVE</span>
              </div>
              <div className="w-px h-4 shrink-0" style={{ background: "hsl(217 28% 11%)" }} />
              <button
                onClick={refreshAll}
                className="h-7 w-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                style={{ border: "1px solid hsl(217 28% 12%)", background: "hsl(222 28% 7% / 0.7)", color: "hsl(var(--muted-foreground) / 0.32)" }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={async () => {
                  if (user?.id) { try { await logAdminAction("admin_logout", user.id, { email: user.email ?? null }); } catch {} }
                  await signOut();
                  navigate("/adminsh/auth");
                }}
                className="h-7 w-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                style={{ border: "1px solid hsl(0 72% 55% / 0.16)", background: "hsl(0 72% 55% / 0.05)", color: "hsl(0 72% 60% / 0.45)" }}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          {/* Page content */}
          <main
            className="flex-1 overflow-auto mx-auto w-full max-w-[1640px] p-5 md:p-7 space-y-6"
          >
            {queryErrors.length ? (
              <div
                className="flex items-center gap-3 rounded-xl px-5 py-3 text-xs font-mono"
                style={{ background: "hsl(0 72% 55% / 0.07)", border: "1px solid hsl(0 72% 55% / 0.18)", color: "hsl(0 72% 65%)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(0 72% 60%)" }} />
                Backend query failure detected.
                <button onClick={refreshAll} className="ml-1 underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity">Retry</button>
              </div>
            ) : null}

            {isBootLoading ? (
              <div className="space-y-6">
                <div className="h-36 rounded-2xl" style={{ background: "linear-gradient(135deg, hsl(222 28% 8%), hsl(222 26% 7%))", border: "1px solid hsl(217 28% 12%)", animation: "pulse 2s ease-in-out infinite" }} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-36 rounded-2xl" style={{ background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 11%)", animation: `pulse 2s ease-in-out ${i * 0.1}s infinite` }} />
                  ))}
                </div>
                <div className="h-80 rounded-2xl" style={{ background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 11%)", animation: "pulse 2s ease-in-out infinite" }} />
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentPath}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                >
                  {renderPage()}
                </motion.div>
              </AnimatePresence>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminDashboard;
