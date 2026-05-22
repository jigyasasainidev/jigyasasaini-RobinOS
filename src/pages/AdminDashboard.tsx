import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { logAdminAction } from "@/lib/adminAudit";
import type { AdminAuditAction } from "@/types/admin";
import { PLATFORM_SETTINGS_DEFAULTS, validateSettingsDraft } from "@/types/platform-config";
import type { PlatformSettingsDraft } from "@/types/platform-config";
import { BrandMark } from "@/components/BrandMark";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

const SectionCard = ({ title, subtitle, right, children }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <section className="rounded-lg border border-border/60 bg-card/45 p-4 backdrop-blur-md">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-border/70 bg-secondary/20 p-6 text-center">
    <div>
      <Inbox className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  </div>
);

const TinySparkline = ({ data }: { data: SparkPoint[] }) => {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div className="mt-2 flex h-8 items-end gap-1">
      {data.map((d, i) => (
        <span key={i} className="w-1.5 rounded-sm bg-primary/70" style={{ height: `${Math.max(8, (d.v / max) * 28)}px` }} />
      ))}
    </div>
  );
};

const MetricCard = ({ label, value, icon: Icon, spark, growth }: { label: string; value: string; growth?: number; icon: ComponentType<{ className?: string }>; spark: SparkPoint[] }) => {
  const maxSpark = Math.max(...spark.map((p) => p.v), 1);
  const hasPositiveGrowth = typeof growth === "number" && growth > 0;
  const hasNegativeGrowth = typeof growth === "number" && growth < 0;

  // Safe gradient ID from label
  const gradId = `mcg-${label.replace(/[^a-zA-Z0-9]/g, "")}`;

  // Build smooth SVG polyline path
  const CW = 100;
  const CH = 28;
  const linePath =
    spark.length < 2
      ? ""
      : spark
          .map((p, i) => {
            const x = ((i / (spark.length - 1)) * CW).toFixed(1);
            const y = (CH - (p.v / maxSpark) * (CH - 3) - 1).toFixed(1);
            return (i === 0 ? "M" : "L") + `${x},${y}`;
          })
          .join(" ");
  const areaPath = linePath ? `${linePath} L${CW},${CH} L0,${CH} Z` : "";

  return (
    <div
      className="relative overflow-hidden rounded-xl group cursor-default transition-shadow duration-300"
      style={{
        background: "linear-gradient(160deg, hsl(222 32% 8%) 0%, hsl(222 26% 6%) 100%)",
        border: "1px solid hsl(217 28% 13%)",
        boxShadow: "0 2px 10px hsl(0 0% 0% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.03)",
      }}
    >
      {/* Left accent strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{
          background: "linear-gradient(180deg, hsl(217 91% 60% / 0.85) 0%, hsl(217 91% 60% / 0.15) 100%)",
        }}
      />

      {/* Body */}
      <div className="pl-5 pr-4 pt-4 pb-3">
        {/* Label row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
              style={{ animation: "pulse 3s ease-in-out infinite" }}
            />
            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/45">
              {label}
            </span>
          </div>
          <Icon className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-primary/55 transition-colors duration-300" />
        </div>

        {/* Value */}
        <p
          className="text-[2rem] font-bold tracking-tight text-foreground leading-none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </p>

        {/* Growth badge */}
        <div className="mt-2 h-[22px] flex items-center">
          {typeof growth === "number" ? (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono border ${
                hasPositiveGrowth
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : hasNegativeGrowth
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "text-muted-foreground/30 border-transparent"
              }`}
            >
              {hasPositiveGrowth ? "▲" : hasNegativeGrowth ? "▼" : "—"}{" "}
              {Math.abs(growth).toFixed(1)}%
            </span>
          ) : (
            <span className="text-[9px] font-mono text-muted-foreground/20 tracking-wider">—</span>
          )}
        </div>
      </div>

      {/* Sparkline curve — full width, flush to bottom */}
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        width="100%"
        height="40"
        preserveAspectRatio="none"
        className="block"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {spark.length >= 2 && (
          <>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path
              d={linePath}
              fill="none"
              stroke="hsl(217 91% 60%)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* End-point dot */}
            {(() => {
              const last = spark[spark.length - 1];
              const lx = CW;
              const ly = CH - (last.v / maxSpark) * (CH - 3) - 1;
              return (
                <circle
                  cx={lx}
                  cy={ly}
                  r="2"
                  fill="hsl(217 91% 60%)"
                  opacity="0.9"
                />
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
};

const DataTable = ({ headers, children, empty, colSpan }: { headers: string[]; children: ReactNode; empty?: boolean; colSpan: number }) => (
  <div className="overflow-auto rounded-lg border border-border/50">
    <table className="w-full min-w-[760px] text-xs">
      <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <tr>{headers.map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr>
      </thead>
      <tbody>
        {children}
        {empty ? (
          <tr>
            <td colSpan={colSpan} className="p-0">
              <EmptyState title="No records yet" description="Live backend data will appear here as activity starts." />
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  </div>
);

const PaginationControls = ({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (page: number) => void }) => (
  <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-xs">
    <span className="text-muted-foreground">Page {page} of {totalPages}</span>
    <div className="flex items-center gap-1.5">
      <button onClick={() => setPage(Math.max(page - 1, 1))} disabled={page <= 1} className="h-7 rounded-md border border-border/60 px-2 text-foreground disabled:opacity-40">Prev</button>
      <button onClick={() => setPage(Math.min(page + 1, totalPages))} disabled={page >= totalPages} className="h-7 rounded-md border border-border/60 px-2 text-foreground disabled:opacity-40">Next</button>
    </div>
  </div>
);

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
      const { data, error } = await db.from("platform_settings").select("id,creator_price,pro_price,agency_price,free_scripts_limit,free_scans_limit,affiliate_commission_percent,minimum_withdrawal,payout_delay_days,maintenance_mode,announcement_banner,support_email,platform_domain,updated_at").order("updated_at", { ascending: false }).limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as PlatformSettingsRow | null;
    },
    enabled: !!isAdmin,
  });

  const profiles = profilesQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];
  const withdrawals = withdrawalsQuery.data ?? [];
  const affiliateProfiles = affiliateProfilesQuery.data ?? [];
  const affiliateCommissions = affiliateCommissionsQuery.data ?? [];
  const aiGenerations = aiGenerationsQuery.data ?? [];
  const featureUsage = featureUsageQuery.data ?? [];
  const platformSettings = platformSettingsQuery.data;

  useEffect(() => {
    if (!platformSettings) return;
    setSettingsDraft({
      creator_price: Number(platformSettings.creator_price || 0),
      pro_price: Number(platformSettings.pro_price || 0),
      agency_price: Number(platformSettings.agency_price || 0),
      free_scripts_limit: Number(platformSettings.free_scripts_limit || 0),
      free_scans_limit: Number(platformSettings.free_scans_limit || 0),
      affiliate_commission_percent: Number(platformSettings.affiliate_commission_percent || 0),
      minimum_withdrawal: Number(platformSettings.minimum_withdrawal || 0),
      payout_delay_days: Number(platformSettings.payout_delay_days || 0),
      maintenance_mode: !!platformSettings.maintenance_mode,
      announcement_banner: platformSettings.announcement_banner ?? "",
    });
  }, [platformSettings]);

  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("admin-live-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => queryClient.invalidateQueries({ queryKey: ["admin-profiles-v2"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_subscriptions" }, () => queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-v2"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawal_requests" }, () => queryClient.invalidateQueries({ queryKey: ["admin-withdrawals-v2"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "affiliate_commissions" }, () => queryClient.invalidateQueries({ queryKey: ["admin-affiliate-commissions-v2"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_generations" }, () => queryClient.invalidateQueries({ queryKey: ["admin-ai-generations-v2"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_settings" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-platform-settings-v2"] });
        queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

  const monthlyRevenue = useMemo(() => {
    return subscriptions
      .filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active")
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  }, [subscriptions]);

  const previousMonthlyRevenue = useMemo(() => {
    const now = Date.now();
    const month = 30 * 24 * 60 * 60 * 1000;
    return subscriptions
      .filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active" && new Date(s.created_at).getTime() < now - month)
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  }, [subscriptions]);

  const mrr = monthlyRevenue;
  const arr = mrr * 12;

  const growthPercent = useMemo(() => {
    if (previousMonthlyRevenue <= 0) return monthlyRevenue > 0 ? 100 : 0;
    return ((monthlyRevenue - previousMonthlyRevenue) / previousMonthlyRevenue) * 100;
  }, [monthlyRevenue, previousMonthlyRevenue]);

  const activeSubscribers = useMemo(() => subscriptions.filter((s) => s.is_revenue_eligible && asSubscriptionStatus(s.status) === "active").length, [subscriptions]);
  const pendingWithdrawals = useMemo(() => withdrawals.filter((w) => asWithdrawStatus(w.status) === "pending"), [withdrawals]);
  const totalAffiliateEarnings = useMemo(() => affiliateCommissions.reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);
  const scriptsGenerated = useMemo(() => aiGenerations.filter((g) => (g.generation_type || "").toLowerCase() === "script").length, [aiGenerations]);
  const trendSearches = useMemo(() => aiGenerations.filter((g) => (g.generation_type || "").toLowerCase() === "trends").length, [aiGenerations]);
  const estimatedAiCost = useMemo(() => aiGenerations.reduce((s, g) => s + estimateGenerationCost(g.provider, Number(g.credits_used || 0)), 0), [aiGenerations]);

  const voiceGenerations = useMemo(() => aiGenerations.filter((g) => (g.generation_type || "").toLowerCase() === "voice").length, [aiGenerations]);
  const videoGenerations = useMemo(() => aiGenerations.filter((g) => (g.generation_type || "").toLowerCase() === "video").length, [aiGenerations]);
  // ── Free vs paid classification ───────────────────────────
  // Source of truth: user_subscriptions table ONLY.
  // A user is "paid" ONLY when:
  //   1. They have an active/trialing subscription on a non-free plan AND
  //   2. is_revenue_eligible = true (backed by a real verified payment)
  // Manual admin upgrades set is_revenue_eligible = false and must never
  // count toward paid user or revenue totals.
  const paidUserIds = useMemo(() => {
    const ids = new Set<string>();
    subscriptions.forEach((s) => {
      const normalizedPlan = (s.plan ?? "").toLowerCase();
      const normalizedStatus = (s.status ?? "").toLowerCase();
      const isPaidPlan = normalizedPlan !== "free" && normalizedPlan !== "";
      const isActiveBilling = normalizedStatus === "active" || normalizedStatus === "trialing";
      if (isPaidPlan && isActiveBilling && s.is_revenue_eligible) ids.add(s.user_id);
    });
    return ids;
  }, [subscriptions]);

  const paidUsers = useMemo(() => paidUserIds.size, [paidUserIds]);
  const freeUsers = useMemo(() => Math.max(0, profiles.length - paidUserIds.size), [profiles.length, paidUserIds]);

  const churnRate = useMemo(() => {
    if (!subscriptions.length) return 0;
    const cancelled = subscriptions.filter((s) => asSubscriptionStatus(s.status) === "cancelled").length;
    return (cancelled / subscriptions.length) * 100;
  }, [subscriptions]);

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
      const payload = {
        user_id: row.user_id,
        plan: plan === "pro" ? "pro_creator" : plan,
        amount: plan === "agency" ? settingsDraft.agency_price : plan === "pro" ? settingsDraft.pro_price : settingsDraft.creator_price,
        currency: "USD",
        status: row.status === "suspended" ? "past_due" : row.status,
        // Manual admin upgrades/downgrades are entitlement-only — not revenue-generating
        subscription_source: "manual_admin" as const,
        is_revenue_eligible: false,
      };

      if (row.subscription_id) {
        const { error } = await db.from("user_subscriptions").update(payload).eq("id", row.subscription_id);
        if (error) throw error;
      } else {
        const { error } = await db.from("user_subscriptions").insert(payload);
        if (error) throw error;
      }

      const { error: profileError } = await db.from("profiles").update({ current_plan: plan }).eq("user_id", row.user_id);
      if (profileError) throw profileError;

      await writeAdminLog("subscription_plan_updated", row.user_id, {
        email: row.email,
        plan,
      });
    },
    onSuccess: () => {
      toast.success("Plan updated");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-v2"] });
      queryClient.invalidateQueries({ queryKey: ["admin-profiles-v2"] });
      // Invalidate the affected user's own profile/entitlement cache so changes propagate
      queryClient.invalidateQueries({ queryKey: ["profile"] });
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
      // Validate before persisting
      const errors = validateSettingsDraft(settingsDraft);
      if (Object.keys(errors).length > 0) {
        const first = Object.values(errors)[0];
        throw new Error(first);
      }

      const payload = {
        creator_price: Number(settingsDraft.creator_price),
        pro_price: Number(settingsDraft.pro_price),
        agency_price: Number(settingsDraft.agency_price),
        free_scripts_limit: Number(settingsDraft.free_scripts_limit),
        free_scans_limit: Number(settingsDraft.free_scans_limit),
        affiliate_commission_percent: Number(settingsDraft.affiliate_commission_percent),
        minimum_withdrawal: Number(settingsDraft.minimum_withdrawal),
        payout_delay_days: Number(settingsDraft.payout_delay_days),
        maintenance_mode: !!settingsDraft.maintenance_mode,
        announcement_banner: settingsDraft.announcement_banner || null,
      };

      if (platformSettings?.id) {
        const { error } = await db.from("platform_settings").update(payload).eq("id", platformSettings.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("platform_settings").insert(payload);
        if (error) throw error;
      }

      await writeAdminLog("platform_settings_updated", platformSettings?.id ?? "new", payload);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["admin-platform-settings-v2"] });
      queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      queryClient.invalidateQueries({ queryKey: ["platform-maintenance-v1"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-settings", user?.id] });
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
    ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  };

  if (authLoading || (user && roleLoading) || (!authLoading && user && isAdmin === false)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking admin access...
        </div>
      </div>
    );
  }

  const dashboardMetrics = [
    { label: "Total Users", value: formatNumber(profiles.length), growth: userGrowthPercent, icon: Users, spark: sparkFrom(dailySeries.map((d) => d.users)) },
    { label: "Active Subscribers", value: formatNumber(activeSubscribers), growth: growthPercent, icon: UserCheck, spark: sparkFrom(dailySeries.map((d) => d.subscriptions)) },
    { label: "Active Plan Value", value: formatCurrency(monthlyRevenue), growth: growthPercent, icon: Wallet, spark: sparkFrom(dailySeries.map((d) => d.revenue)) },
    { label: "Pending Withdrawals", value: formatNumber(pendingWithdrawals.length), icon: Clock3, spark: sparkFrom(pendingWithdrawals.map((w) => Number(w.amount || 0))) },
    { label: "Affiliate Earnings", value: formatCurrency(totalAffiliateEarnings), icon: TrendingUp, spark: sparkFrom(affiliateCommissions.map((a) => Number(a.amount || 0))) },
    { label: "Scripts Generated", value: formatNumber(scriptsGenerated), icon: Sparkles, spark: sparkFrom(dailySeries.map((d) => d.scripts)) },
    { label: "Trend Searches", value: formatNumber(trendSearches), icon: BarChart3, spark: sparkFrom(dailySeries.map((d) => d.scans)) },
    { label: "Estimated AI Cost", value: formatCurrency(estimatedAiCost), icon: Activity, spark: sparkFrom(aiGenerations.map((g) => estimateGenerationCost(g.provider, Number(g.credits_used || 0)))) },
  ];

  const renderDashboardPage = () => (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{dashboardMetrics.map((card) => <MetricCard key={card.label} label={card.label} value={card.value} growth={card.growth} icon={card.icon} spark={card.spark} />)}</section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ── Revenue Overview — trading terminal ── */}
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Revenue Overview</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 95% 72%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:REV · Active subscription value</span>}
        >
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <div className="flex items-center gap-3"><span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:REV</span><span className="text-[10px] font-mono" style={{ color: "hsl(217 91% 60%)" }}>{formatCurrency(monthlyRevenue)}</span></div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40"><span>1D</span><span className="text-primary/80">7D</span><span>30D</span></div>
            </div>
            <div className="h-64 px-1 pt-2 pb-1">
              {dailySeries.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.22} /><stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(217 91% 60%)" strokeWidth={1.5} fill="url(#gradRev)" dot={false} activeDot={{ r: 3, fill: "hsl(217 91% 60%)", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2"><p className="text-[10px] font-mono text-muted-foreground/40 tracking-widest uppercase">Awaiting market data</p><p className="text-[9px] font-mono text-muted-foreground/25">Chart populates after subscription records are available</p></div>
              )}
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(217 91% 60%)" }} />
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Revenue</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>

        {/* ── Plan Distribution (Dashboard) — trading terminal ── */}
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Plan Distribution</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 95% 72%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<div className="flex items-center gap-3 mt-0.5"><span className="text-[10px] font-mono text-muted-foreground/60">PLAN / TOTAL ·</span>{planDistribution.map((p) => <span key={p.name} className="text-[10px] font-mono" style={{ color: p.fill }}>{p.name.toUpperCase()} {p.value > 0 ? `+${p.value}` : "—"}</span>)}</div>}
        >
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:PLANS</span>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40"><span>1D</span><span className="text-primary/80">7D</span><span>30D</span></div>
            </div>
            <div className="h-56 px-1 pt-2 pb-1">
              {planDistributionTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={planDistributionTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashGradC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.18} /><stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} /></linearGradient>
                      <linearGradient id="dashGradP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(38 92% 50%)" stopOpacity={0.15} /><stop offset="95%" stopColor="hsl(38 92% 50%)" stopOpacity={0} /></linearGradient>
                      <linearGradient id="dashGradA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.12} /><stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                    <Area type="monotone" dataKey="creator" name="Creator" stroke="hsl(217 91% 60%)" strokeWidth={1.5} fill="url(#dashGradC)" dot={false} activeDot={{ r: 3, fill: "hsl(217 91% 60%)", strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="pro" name="Pro" stroke="hsl(38 92% 50%)" strokeWidth={1.5} fill="url(#dashGradP)" dot={false} activeDot={{ r: 3, fill: "hsl(38 92% 50%)", strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="agency" name="Agency" stroke="hsl(142 70% 45%)" strokeWidth={1.5} fill="url(#dashGradA)" dot={false} activeDot={{ r: 3, fill: "hsl(142 70% 45%)", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2"><p className="text-[10px] font-mono text-muted-foreground/40 tracking-widest uppercase">Awaiting market data</p></div>
              )}
            </div>
            <div className="flex items-center gap-4 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              {[{ l: "Creator", c: "hsl(217 91% 60%)", v: planDistribution.find((p) => p.name === "Creator")?.value ?? 0 }, { l: "Pro", c: "hsl(38 92% 50%)", v: planDistribution.find((p) => p.name === "Pro")?.value ?? 0 }, { l: "Agency", c: "hsl(142 70% 45%)", v: planDistribution.find((p) => p.name === "Agency")?.value ?? 0 }].map((i) => (<div key={i.l} className="flex items-center gap-1.5"><span className="w-4 h-[2px] rounded-full" style={{ background: i.c }} /><span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{i.l}</span><span className="text-[10px] font-mono" style={{ color: i.c }}>{i.v}</span></div>))}
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="Latest Users" subtitle="Latest 10 profiles"><DataTable headers={["email", "plan", "signup date"]} colSpan={3} empty={!usersEnriched.length}>{usersEnriched.slice(0, 10).map((u) => <tr key={u.user_id} className="border-t border-border/40"><td className="p-3 text-foreground">{u.email}</td><td className="p-3 uppercase text-muted-foreground">{u.plan}</td><td className="p-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td></tr>)}</DataTable></SectionCard>
        <SectionCard title="Recent Subscriptions" subtitle="Latest active subscription updates"><DataTable headers={["customer", "amount", "currency", "status"]} colSpan={4} empty={!subscriptions.length}>{subscriptions.slice(0, 10).map((s) => <tr key={s.id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td><td className="p-3 font-mono text-foreground">{formatCurrency(s.amount)}</td><td className="p-3 text-muted-foreground">{s.currency}</td><td className="p-3 text-muted-foreground">{s.status}</td></tr>)}</DataTable></SectionCard>
        <SectionCard title="Recent Withdrawals" subtitle="Latest withdrawal requests"><DataTable headers={["affiliate", "amount", "payout", "status"]} colSpan={4} empty={!withdrawals.length}>{withdrawals.slice(0, 10).map((w) => <tr key={w.id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(w.user_id)?.email ?? w.user_id.slice(0, 8)}</td><td className="p-3 font-mono text-foreground">{formatCurrency(w.amount)}</td><td className="p-3 text-muted-foreground">{w.payout_method}</td><td className="p-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase ${statusClass[asWithdrawStatus(w.status)]}`}>{asWithdrawStatus(w.status)}</span></td></tr>)}</DataTable></SectionCard>
      </section>
    </div>
  );

  const renderAnalyticsPage = () => (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ── Revenue Analytics — trading terminal ── */}
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Revenue Analytics</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 95% 72%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:MRR · Monthly recurring revenue</span>}
        >
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">MRR</p><p className="mt-1 font-semibold text-foreground">{formatCurrency(mrr)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">ARR</p><p className="mt-1 font-semibold text-foreground">{formatCurrency(arr)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Growth</p><p className="mt-1 font-semibold text-foreground">{growthPercent.toFixed(1)}%</p></div>
          </div>
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:MRR</span>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40"><span>1D</span><span className="text-primary/80">7D</span><span>30D</span></div>
            </div>
            <div className="h-56 px-1 pt-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="gradRevA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.22} /><stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(217 91% 60%)" strokeWidth={1.5} fill="url(#gradRevA)" dot={false} activeDot={{ r: 3, fill: "hsl(217 91% 60%)", strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(217 91% 60%)" }} />
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Revenue</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>

        {/* ── User Growth — trading terminal ── */}
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">User Growth</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(38 92% 50% / 0.12)", border: "1px solid hsl(38 92% 50% / 0.25)", color: "hsl(38 92% 70%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:USR · Daily signups from profiles</span>}
        >
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Daily Signups</p><p className="mt-1 font-semibold text-foreground">{formatNumber(dailySeries.at(-1)?.signups ?? 0)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Churn</p><p className="mt-1 font-semibold text-foreground">{churnRate.toFixed(2)}%</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Active Users</p><p className="mt-1 font-semibold text-foreground">{formatNumber(activeSubscribers)}</p></div>
          </div>
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:USR</span>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40"><span>1D</span><span className="text-amber-400/80">7D</span><span>30D</span></div>
            </div>
            <div className="h-56 px-1 pt-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="gradBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.9} /><stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.4} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ fill: "hsl(217 91% 60% / 0.05)" }} />
                  <Bar dataKey="signups" name="Signups" fill="url(#gradBar)" radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(38 92% 50%)" }} />
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Daily Signups</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="AI Usage" subtitle="Script, trends, voice, video generations">
          <div className="space-y-2">
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Scripts generated</span><Sparkles className="h-4 w-4 text-primary" /></div><p className="mt-1 font-semibold text-foreground">{formatNumber(scriptsGenerated)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Trend scans</span><BarChart3 className="h-4 w-4 text-primary" /></div><p className="mt-1 font-semibold text-foreground">{formatNumber(trendSearches)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Voice generations</span><Mic className="h-4 w-4 text-primary" /></div><p className="mt-1 font-semibold text-foreground">{formatNumber(voiceGenerations)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Video generations</span><Video className="h-4 w-4 text-primary" /></div><p className="mt-1 font-semibold text-foreground">{formatNumber(videoGenerations)}</p></div>
          </div>
        </SectionCard>

        <SectionCard title="Plan Usage Mix" subtitle="Free users, paid users, estimated AI spend">
          <div className="space-y-2">
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Free users</p><p className="mt-1 font-semibold text-foreground">{formatNumber(freeUsers)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Paid users</p><p className="mt-1 font-semibold text-foreground">{formatNumber(paidUsers)}</p></div>
            <div className="rounded-md border border-border/50 bg-secondary/30 p-3"><p className="text-[11px] text-muted-foreground">Estimated AI cost</p><p className="mt-1 font-semibold text-foreground">{formatCurrency(estimatedAiCost)}</p></div>
          </div>
        </SectionCard>

        {/* ── Top Feature Usage — trading terminal ── */}
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Top Feature Usage</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(172 70% 40% / 0.12)", border: "1px solid hsl(172 70% 40% / 0.25)", color: "hsl(172 70% 60%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:FEAT · Usage from feature_usage table</span>}
        >
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:FEAT</span>
              <span className="text-[9px] font-mono text-muted-foreground/30">TOP {Math.min(topFeatureUsage.length, 6)}</span>
            </div>
            <div className="h-[220px] px-1 pt-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topFeatureUsage.length ? topFeatureUsage : [{ feature: "No data", value: 0 }]} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="gradFeat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(172 70% 45%)" stopOpacity={0.9} /><stop offset="100%" stopColor="hsl(172 70% 45%)" stopOpacity={0.4} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                  <XAxis dataKey="feature" tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ fill: "hsl(217 91% 60% / 0.05)" }} />
                  <Bar dataKey="value" name="Usage" fill="url(#gradFeat)" radius={[3, 3, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(172 70% 45%)" }} />
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Feature Events</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );

  const renderSettingsPage = () => (
    <div className="space-y-4">
      <SectionCard
        title="Platform Configuration"
        subtitle="Changes persist to database and propagate system-wide immediately"
        right={
          <button
            onClick={() => saveSettingsMutation.mutate()}
            disabled={saveSettingsMutation.isPending}
            className="h-8 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60 transition-opacity"
          >
            {saveSettingsMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

          {/* LEFT COLUMN */}
          <div className="space-y-4">

            {/* Pricing */}
            <SectionCard title="Pricing" subtitle="Monthly prices in USD">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Creator</p>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><Input type="number" min={0} className="pl-6" value={settingsDraft.creator_price} onChange={(e) => setSettingsDraft((s) => ({ ...s, creator_price: Number(e.target.value) }))} /></div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pro Creator</p>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><Input type="number" min={0} className="pl-6" value={settingsDraft.pro_price} onChange={(e) => setSettingsDraft((s) => ({ ...s, pro_price: Number(e.target.value) }))} /></div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Agency</p>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><Input type="number" min={0} className="pl-6" value={settingsDraft.agency_price} onChange={(e) => setSettingsDraft((s) => ({ ...s, agency_price: Number(e.target.value) }))} /></div>
                </div>
              </div>
            </SectionCard>

            {/* Free Limits */}
            <SectionCard title="Free Limits" subtitle="Daily quotas for free-tier users">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Scripts / day</p>
                  <Input type="number" min={0} value={settingsDraft.free_scripts_limit} onChange={(e) => setSettingsDraft((s) => ({ ...s, free_scripts_limit: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Scans / day</p>
                  <Input type="number" min={0} value={settingsDraft.free_scans_limit} onChange={(e) => setSettingsDraft((s) => ({ ...s, free_scans_limit: Number(e.target.value) }))} />
                </div>
              </div>
            </SectionCard>

            {/* Affiliate Controls */}
            <SectionCard title="Affiliate Controls" subtitle="Commission, withdrawal, and payout settings">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Commission %</p>
                  <Input type="number" min={0} max={100} value={settingsDraft.affiliate_commission_percent} onChange={(e) => setSettingsDraft((s) => ({ ...s, affiliate_commission_percent: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Min Withdrawal $</p>
                  <Input type="number" min={1} value={settingsDraft.minimum_withdrawal} onChange={(e) => setSettingsDraft((s) => ({ ...s, minimum_withdrawal: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Payout Delay (days)</p>
                  <Input type="number" min={0} value={settingsDraft.payout_delay_days} onChange={(e) => setSettingsDraft((s) => ({ ...s, payout_delay_days: Number(e.target.value) }))} />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">

            {/* Maintenance */}
            <SectionCard title="Maintenance" subtitle="Global platform maintenance mode and announcement">
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Maintenance Mode</p>
                  <select
                    value={settingsDraft.maintenance_mode ? "true" : "false"}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, maintenance_mode: e.target.value === "true" }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  >
                    <option value="false">OFF — Platform running normally</option>
                    <option value="true">ON — Show maintenance banner</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Announcement Banner</p>
                  <Input
                    value={settingsDraft.announcement_banner}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, announcement_banner: e.target.value }))}
                    placeholder="e.g. Scheduled maintenance on May 25 at 2am UTC"
                    maxLength={280}
                  />
                  <p className="text-[10px] text-muted-foreground/50 font-mono text-right">{settingsDraft.announcement_banner.length}/280</p>
                </div>
              </div>
            </SectionCard>

            {/* Live Settings Summary */}
            <SectionCard title="Current Live Values" subtitle="What users see right now (from database)">
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                {[
                  { label: "Creator price", value: `$${platformSettings?.creator_price ?? "—"}/mo` },
                  { label: "Pro price", value: `$${platformSettings?.pro_price ?? "—"}/mo` },
                  { label: "Agency price", value: `$${platformSettings?.agency_price ?? "—"}/mo` },
                  { label: "Free scripts/day", value: platformSettings?.free_scripts_limit ?? "—" },
                  { label: "Free scans/day", value: platformSettings?.free_scans_limit ?? "—" },
                  { label: "Commission", value: `${platformSettings?.affiliate_commission_percent ?? "—"}%` },
                  { label: "Min withdrawal", value: `$${platformSettings?.minimum_withdrawal ?? "—"}` },
                  { label: "Maintenance", value: platformSettings?.maintenance_mode ? "🔴 ON" : "🟢 OFF" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between rounded-md border border-border/40 bg-secondary/30 px-2.5 py-1.5">
                    <span className="text-muted-foreground font-mono">{label}</span>
                    <span className="text-foreground font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
              {platformSettings?.updated_at && (
                <p className="mt-2 text-[10px] text-muted-foreground/50 font-mono text-right">
                  Last saved: {new Date(platformSettings.updated_at).toLocaleString()}
                </p>
              )}
            </SectionCard>
          </div>
        </div>
      </SectionCard>
    </div>
  );

  const renderUsersPage = () => (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Users" value={formatNumber(usersEnriched.length)} icon={Users} spark={sparkFrom(dailySeries.map((d) => d.users))} />
        <MetricCard label="Active Users" value={formatNumber(activeSubscribers)} icon={UserCheck} spark={sparkFrom(dailySeries.map((d) => d.subscriptions))} />
        <MetricCard label="Free Users" value={formatNumber(freeUsers)} icon={Users} spark={sparkFrom(usersEnriched.filter((u) => u.plan === "creator").map((u) => u.scriptsUsed))} />
        <MetricCard label="Paid Users" value={formatNumber(paidUsers)} icon={Users} spark={sparkFrom(usersEnriched.filter((u) => u.status === "active").map((u) => u.scriptsUsed))} />
      </section>

      <SectionCard title="Users Table" subtitle="Search, filters, pagination, and admin actions">
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="flex h-9 items-center gap-2 rounded-md border border-border/60 bg-secondary/60 px-2 md:col-span-2"><Search className="h-4 w-4 text-muted-foreground" /><input value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }} className="w-full bg-transparent text-xs text-foreground outline-none" placeholder="Search users" /></div>
          <select value={userPlanFilter} onChange={(e) => { setUserPlanFilter(e.target.value as "all" | UserPlan); setUserPage(1); }} className="h-9 rounded-md border border-border/60 bg-secondary/60 px-2 text-xs text-foreground"><option value="all">All plans</option><option value="creator">Creator</option><option value="pro">Pro</option><option value="agency">Agency</option></select>
          <select value={userStatusFilter} onChange={(e) => { setUserStatusFilter(e.target.value as "all" | UserEnriched["status"]); setUserPage(1); }} className="h-9 rounded-md border border-border/60 bg-secondary/60 px-2 text-xs text-foreground"><option value="all">All status</option><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option><option value="suspended">Suspended</option></select>
        </div>

        <div className="overflow-auto rounded-lg border border-border/50">
          <table className="w-full min-w-[1080px] text-xs">
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="p-3 text-left">avatar</th><th className="p-3 text-left">email</th><th className="p-3 text-left">current plan</th><th className="p-3 text-left">scripts used</th><th className="p-3 text-left">trend scans</th><th className="p-3 text-left">joined date</th><th className="p-3 text-left">affiliate enabled</th><th className="p-3 text-left">status</th><th className="p-3 text-left">source</th><th className="p-3 text-left">actions</th></tr></thead>
            <tbody>
              {pagedUsers.map((row) => {
                const planLadder: UserPlan[] = ["creator", "pro", "agency"];
                const currentIdx = planLadder.indexOf(row.plan);
                const upgradePlan: UserPlan = currentIdx < planLadder.length - 1 ? planLadder[currentIdx + 1] : "agency";
                const downgradePlan: UserPlan = currentIdx > 0 ? planLadder[currentIdx - 1] : "creator";
                const canUpgrade = row.plan !== "agency";
                // Free users (plan === "creator" because asPlan maps free→creator) with no subscription can be downgraded
                // to free, but we prevent downgrade from creator when they're already on the seeded free plan
                const canDowngrade = !(row.plan === "creator" && row.amount === 0);
                const isSuspendPending = userStatusMutation.isPending && (userStatusMutation.variables as any)?.row?.user_id === row.user_id;
                const isPlanPending = userPlanMutation.isPending && (userPlanMutation.variables as any)?.row?.user_id === row.user_id;
                return (
                  <tr key={row.user_id} className="border-t border-border/40 hover:bg-secondary/20">
                    <td className="p-3"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-[10px] text-foreground">{row.email.slice(0, 1).toUpperCase()}</span></td>
                    <td className="p-3 text-foreground">{row.email}</td>
                    <td className="p-3 uppercase text-muted-foreground">{row.plan}</td>
                    <td className="p-3 font-mono text-foreground">{formatNumber(row.scriptsUsed)}</td>
                    <td className="p-3 font-mono text-foreground">{formatNumber(row.trendScans)}</td>
                    <td className="p-3 text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="p-3 text-muted-foreground">{row.is_affiliate ? "Yes" : "No"}</td>
                    <td className="p-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                        row.status === "suspended"
                          ? "bg-red-500/10 text-red-400 border-red-500/25"
                          : row.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                            : "bg-secondary/50 text-muted-foreground border-border/50"
                      }`}>{row.status}</span>
                    </td>
                    <td className="p-3">
                      {/* Source badge */}
                      {(() => {
                        const src = (row.subscriptionSource ?? "manual_admin").toLowerCase();
                        const cfg: Record<string, { label: string; cls: string }> = {
                          creem:            { label: "Paid",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
                          dodo:             { label: "Paid",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
                          stripe:           { label: "Paid",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
                          manual_admin:     { label: "Manual",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
                          promo:            { label: "Promo",      cls: "bg-purple-500/10 text-purple-400 border-purple-500/25" },
                          internal:         { label: "Internal",   cls: "bg-purple-500/10 text-purple-400 border-purple-500/25" },
                          affiliate_reward: { label: "Affiliate",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/25" },
                          migration:        { label: "Migration",  cls: "bg-secondary/50 text-muted-foreground border-border/50" },
                          trial:            { label: "Trial",      cls: "bg-secondary/50 text-muted-foreground border-border/50" },
                        };
                        const { label, cls } = cfg[src] ?? cfg.manual_admin;
                        return (
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${cls}`}>{label}</span>
                        );
                      })()}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {/* Suspend / Activate */}
                        <button
                          className={`h-7 rounded border px-2 text-[10px] transition-colors disabled:opacity-50 ${
                            row.status === "suspended"
                              ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                              : "border-red-500/30 text-red-400 hover:bg-red-500/10"
                          }`}
                          disabled={isSuspendPending}
                          onClick={() => userStatusMutation.mutate({ row, suspended: row.status !== "suspended" })}
                        >
                          {isSuspendPending ? "…" : row.status === "suspended" ? "activate" : "suspend"}
                        </button>
                        {/* Upgrade */}
                        <button
                          className="h-7 rounded border border-primary/30 px-2 text-[10px] text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={!canUpgrade || isPlanPending}
                          onClick={() => userPlanMutation.mutate({ row, plan: upgradePlan })}
                        >
                          {isPlanPending ? "…" : "upgrade"}
                        </button>
                        {/* Downgrade */}
                        <button
                          className="h-7 rounded border border-border/60 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={!canDowngrade || isPlanPending}
                          onClick={() => userPlanMutation.mutate({ row, plan: downgradePlan })}
                        >
                          {isPlanPending ? "…" : "downgrade"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pagedUsers.length ? <tr><td colSpan={10} className="p-0"><EmptyState title="No users found" description="Try adjusting filters or search query." /></td></tr> : null}
            </tbody>
          </table>
          <PaginationControls page={userPage} totalPages={totalUserPages} setPage={setUserPage} />
        </div>
      </SectionCard>
    </div>
  );

  const atRiskSubscriptions = useMemo(() => subscriptions.filter((s) => ["past_due", "cancelled"].includes((s.status || "").toLowerCase())), [subscriptions]);
  const cancelledSubs = useMemo(() => subscriptions.filter((s) => asSubscriptionStatus(s.status) === "cancelled"), [subscriptions]);

  const renderSubscriptionsPage = () => (
    <div className="space-y-4">
      {/* ── Subscription KPI grid — same MetricCard system ─── */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active Plan Value" value={formatCurrency(monthlyRevenue)} icon={Wallet} spark={sparkFrom(dailySeries.map((d) => d.revenue))} growth={growthPercent} />
        <MetricCard label="Active Subscribers" value={formatNumber(activeSubscribers)} icon={UserCheck} spark={sparkFrom(dailySeries.map((d) => d.subscriptions))} />
        <MetricCard label="Churn Rate" value={`${churnRate.toFixed(2)}%`} icon={ArrowDownRight} spark={sparkFrom(cancelledSubs.map((s) => Number(s.amount || 0)))} />
        <MetricCard label="At-Risk Subs" value={formatNumber(atRiskSubscriptions.length)} icon={Clock3} spark={sparkFrom(atRiskSubscriptions.map((s) => Number(s.amount || 0)))} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title={
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Plan Distribution</span>
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest"
                style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 95% 72%)" }}
              >
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />
                LIVE
              </span>
            </div>
          }
          subtitle={
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] font-mono text-muted-foreground/60">PLAN / TOTAL ·</span>
              {planDistribution.map((p) => (
                <span key={p.name} className="text-[10px] font-mono" style={{ color: p.fill }}>
                  {p.name.toUpperCase()} {p.value > 0 ? `+${p.value}` : "—"}
                </span>
              ))}
            </div>
          }
        >
          <div
            className="relative rounded-lg overflow-hidden"
            style={{
              background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)",
              border: "1px solid hsl(217 30% 11%)",
            }}
          >
            {/* Horizontal grid lines overlay */}
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />

            {/* Ticker header bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:PLANS</span>
                <span className="text-[10px] font-mono" style={{ color: "hsl(217 91% 60%)" }}>
                  TOTAL {planDistribution.reduce((s, p) => s + p.value, 0)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40">
                <span>1D</span>
                <span className="text-primary/80">7D</span>
                <span>30D</span>
              </div>
            </div>

            {/* Chart */}
            <div className="h-56 px-1 pt-2 pb-1">
              {planDistributionTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={planDistributionTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCreator" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="gradPro" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(38 92% 50%)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="hsl(38 92% 50%)" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="gradAgency" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="hsl(217 30% 13% / 0.0)"
                      strokeDasharray="0"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }}
                      axisLine={{ stroke: "hsl(217 30% 13%)" }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(222 28% 6% / 0.97)",
                        border: "1px solid hsl(217 30% 16%)",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontFamily: "monospace",
                        boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)",
                      }}
                      labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                      cursor={{ stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1, strokeDasharray: "4 4" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="creator"
                      name="Creator"
                      stroke="hsl(217 91% 60%)"
                      strokeWidth={1.5}
                      fill="url(#gradCreator)"
                      dot={false}
                      activeDot={{ r: 3, fill: "hsl(217 91% 60%)", strokeWidth: 0 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pro"
                      name="Pro"
                      stroke="hsl(38 92% 50%)"
                      strokeWidth={1.5}
                      fill="url(#gradPro)"
                      dot={false}
                      activeDot={{ r: 3, fill: "hsl(38 92% 50%)", strokeWidth: 0 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="agency"
                      name="Agency"
                      stroke="hsl(142 70% 45%)"
                      strokeWidth={1.5}
                      fill="url(#gradAgency)"
                      dot={false}
                      activeDot={{ r: 3, fill: "hsl(142 70% 45%)", strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <p className="text-[10px] font-mono text-muted-foreground/40 tracking-widest uppercase">Awaiting market data</p>
                  <p className="text-[9px] font-mono text-muted-foreground/25">Chart populates after subscriptions are recorded</p>
                </div>
              )}
            </div>

            {/* Footer legend bar */}
            <div className="flex items-center gap-4 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              {[
                { label: "Creator", color: "hsl(217 91% 60%)", val: planDistribution.find((p) => p.name === "Creator")?.value ?? 0 },
                { label: "Pro",     color: "hsl(38 92% 50%)",   val: planDistribution.find((p) => p.name === "Pro")?.value ?? 0 },
                { label: "Agency",  color: "hsl(142 70% 45%)",  val: planDistribution.find((p) => p.name === "Agency")?.value ?? 0 },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="w-4 h-[2px] rounded-full" style={{ background: item.color }} />
                  <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{item.label}</span>
                  <span className="text-[10px] font-mono" style={{ color: item.color }}>{item.val}</span>
                </div>
              ))}
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Active Subscription Table" subtitle="email, plan, billing cycle, renewal date, amount, status"><DataTable headers={["email", "plan", "billing cycle", "renewal date", "amount", "status"]} colSpan={6} empty={!usersEnriched.filter((u) => u.status === "active").length}>{usersEnriched.filter((u) => u.status === "active").slice(0, 10).map((u) => <tr key={u.user_id} className="border-t border-border/40"><td className="p-3 text-foreground">{u.email}</td><td className="p-3 uppercase text-muted-foreground">{u.plan}</td><td className="p-3 text-muted-foreground">{u.billing_cycle}</td><td className="p-3 text-muted-foreground">{u.renewal_date ? new Date(u.renewal_date).toLocaleDateString() : "—"}</td><td className="p-3 font-mono text-foreground">{formatCurrency(u.amount)}</td><td className="p-3 text-muted-foreground">{u.status}</td></tr>)}</DataTable></SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="At-Risk Subscriptions" subtitle="Operational follow-up queue"><DataTable headers={["email", "amount", "currency", "status"]} colSpan={4} empty={!atRiskSubscriptions.length}>{atRiskSubscriptions.slice(0, 10).map((s) => <tr key={s.id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td><td className="p-3 font-mono text-foreground">{formatCurrency(s.amount)}</td><td className="p-3 text-muted-foreground">{s.currency}</td><td className="p-3 text-muted-foreground">{s.status}</td></tr>)}</DataTable></SectionCard>
        <SectionCard title="Cancelled Subscriptions" subtitle="Churn monitoring list"><DataTable headers={["user", "plan", "status"]} colSpan={3} empty={!cancelledSubs.length}>{cancelledSubs.slice(0, 10).map((s) => <tr key={s.id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(s.user_id)?.email ?? s.user_id.slice(0, 8)}</td><td className="p-3 text-muted-foreground">{s.plan}</td><td className="p-3 text-muted-foreground">{s.status}</td></tr>)}</DataTable></SectionCard>
      </section>
    </div>
  );

  const affiliateUsers = useMemo(() => usersEnriched.filter((u) => u.is_affiliate), [usersEnriched]);
  const pendingAffiliateCommissions = useMemo(() => affiliateCommissions.filter((c) => c.status === "pending").reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);
  const paidAffiliateCommissions = useMemo(() => affiliateCommissions.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0), [affiliateCommissions]);

  const renderAffiliatesPage = () => (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Affiliates" value={formatNumber(affiliateProfiles.length)} icon={Users} spark={sparkFrom(affiliateProfiles.map((a) => Number(a.total_clicks || 0)))} />
        <MetricCard label="Pending Commissions" value={formatCurrency(pendingAffiliateCommissions)} icon={Clock3} spark={sparkFrom(affiliateCommissions.filter((a) => a.status === "pending").map((a) => Number(a.amount || 0)))} />
        <MetricCard label="Paid Commissions" value={formatCurrency(paidAffiliateCommissions)} icon={CheckCircle2} spark={sparkFrom(affiliateCommissions.filter((a) => a.status === "paid").map((a) => Number(a.amount || 0)))} />
        <MetricCard label="Conversion Revenue" value={formatCurrency(totalAffiliateEarnings)} icon={TrendingUp} spark={sparkFrom(affiliateCommissions.map((a) => Number(a.amount || 0)))} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Top Affiliates" subtitle="email, clicks, conversions, earned"><DataTable headers={["email", "clicks", "conversions", "earned"]} colSpan={4} empty={!affiliateProfiles.length}>{affiliateProfiles.slice(0, 10).map((a) => <tr key={a.user_id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(a.user_id)?.email ?? a.user_id.slice(0, 8)}</td><td className="p-3 font-mono text-foreground">{formatNumber(a.total_clicks)}</td><td className="p-3 font-mono text-foreground">{formatNumber(a.total_conversions)}</td><td className="p-3 font-mono text-primary">{formatCurrency(a.total_earned)}</td></tr>)}</DataTable></SectionCard>
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Referral Conversion Analytics</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.25)", color: "hsl(217 95% 72%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:AFF · Conversions and earnings by affiliate</span>}
        >
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:AFF</span>
              <div className="flex items-center gap-3 text-[9px] font-mono"><span className="flex items-center gap-1"><span className="w-3 h-[2px] rounded-full" style={{ background: "hsl(217 91% 60%)" }} />Conversions</span><span className="flex items-center gap-1"><span className="w-3 h-[2px] rounded-full" style={{ background: "hsl(38 92% 50%)" }} />Earned</span></div>
            </div>
            <div className="h-64 px-1 pt-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={affiliateProfiles.slice(0, 10).map((a) => ({ email: (profileMap.get(a.user_id)?.email || a.user_id).split("@")[0], conversions: a.total_conversions, earned: a.total_earned }))} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradAffC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.9} /><stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0.4} /></linearGradient>
                    <linearGradient id="gradAffE" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.85} /><stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.35} /></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                  <XAxis dataKey="email" tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ fill: "hsl(217 91% 60% / 0.05)" }} />
                  <Bar dataKey="conversions" name="Conversions" fill="url(#gradAffC)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="earned" name="Earned" fill="url(#gradAffE)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(217 91% 60%)" }} /><span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Conversions</span>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(38 92% 50%)" }} /><span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Earned</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">Affiliate Growth</span><span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono tracking-widest" style={{ background: "hsl(142 70% 40% / 0.12)", border: "1px solid hsl(142 70% 40% / 0.25)", color: "hsl(142 70% 60%)" }}><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" style={{ animationDuration: "2s" }} />LIVE</span></div>}
          subtitle={<span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:AFFG · Affiliate onboarding over time</span>}
        >
          <div className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, hsl(222 28% 4%) 0%, hsl(222 24% 3%) 100%)", border: "1px solid hsl(217 30% 11%)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(217 30% 13% / 0.35) 0px, transparent 1px, transparent 36px, hsl(217 30% 13% / 0.35) 37px)", backgroundSize: "100% 37px" }} />
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="text-[10px] font-mono text-muted-foreground/50">ROBINOS:AFFG</span>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40"><span>1D</span><span className="text-emerald-400/80">7D</span><span>30D</span></div>
            </div>
            <div className="h-64 px-1 pt-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="gradAffG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.2} /><stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(217 30% 13% / 0)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={{ stroke: "hsl(217 30% 13%)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground) / 0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(222 28% 6% / 0.97)", border: "1px solid hsl(217 30% 16%)", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.5)" }} cursor={{ stroke: "hsl(142 70% 45% / 0.3)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey="users" name="Users" stroke="hsl(142 70% 45%)" strokeWidth={1.5} fill="url(#gradAffG)" dot={false} activeDot={{ r: 3, fill: "hsl(142 70% 45%)", strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: "hsl(217 30% 11%)" }}>
              <span className="w-4 h-[2px] rounded-full" style={{ background: "hsl(142 70% 45%)" }} />
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">Total Users</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/25">RobinOS Analytics v1</span>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Pending Commission Queue" subtitle="Commissions waiting for processing"><DataTable headers={["affiliate", "commission", "created"]} colSpan={3} empty={!affiliateCommissions.filter((c) => c.status === "pending").length}>{affiliateCommissions.filter((c) => c.status === "pending").slice(0, 10).map((c) => <tr key={c.id} className="border-t border-border/40"><td className="p-3 text-foreground">{profileMap.get(c.affiliate_user_id)?.email ?? c.affiliate_user_id.slice(0, 8)}</td><td className="p-3 font-mono text-foreground">{formatCurrency(c.amount)}</td><td className="p-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td></tr>)}</DataTable></SectionCard>
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
      <div className="space-y-4">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Pending Withdrawals" value={formatNumber(pendingWithdrawals.length)} icon={Clock3} spark={sparkFrom(pendingWithdrawals.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Paid This Month" value={formatCurrency(paidWithdrawalsMonth.reduce((s, w) => s + Number(w.amount || 0), 0))} icon={CheckCircle2} spark={sparkFrom(paidWithdrawalsMonth.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Total Withdrawal Volume" value={formatCurrency(totalWithdrawalVolume)} icon={Wallet} spark={sparkFrom(withdrawals.map((w) => Number(w.amount || 0)))} />
          <MetricCard label="Failed Withdrawals" value={formatNumber(failedWithdrawals)} icon={ArrowDownRight} spark={sparkFrom(withdrawals.filter((w) => asWithdrawStatus(w.status) === "rejected").map((w) => Number(w.amount || 0)))} />
        </section>

        <SectionCard title="Withdrawal Request Queue" subtitle="Approve, reject, and mark paid" right={<select value={withdrawStatusFilter} onChange={(e) => setWithdrawStatusFilter(e.target.value as "all" | WithdrawStatus)} className="h-8 rounded-md border border-border/60 bg-secondary/70 px-2 text-xs text-foreground"><option value="all">All status</option><option value="pending">pending</option><option value="approved">approved</option><option value="paid">paid</option><option value="rejected">rejected</option></select>}>
          <div className="overflow-auto rounded-lg border border-border/50">
            <table className="w-full min-w-[1080px] text-xs">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="p-3 text-left">affiliate email</th><th className="p-3 text-left">payout method</th><th className="p-3 text-left">payout address</th><th className="p-3 text-left">requested amount</th><th className="p-3 text-left">request date</th><th className="p-3 text-left">status</th><th className="p-3 text-left">actions</th></tr></thead>
              <tbody>
                {filtered.map((row) => {
                  const status = asWithdrawStatus(row.status);
                  const email = profileMap.get(row.user_id)?.email ?? row.user_id.slice(0, 8);
                  const payoutMethodLabel = row.payout_method === "usdt_trc20" ? "USDT (TRC20)" : "PayPal";
                  return (
                    <tr key={row.id} className="border-t border-border/40 hover:bg-secondary/20">
                      <td className="p-3 text-foreground">{email}</td>
                      <td className="p-3 text-muted-foreground">{payoutMethodLabel}</td>
                      <td className="p-3 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="max-w-[280px] truncate">{row.payout_details}</span>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(row.payout_details || "");
                              toast.success("Payout details copied");
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded border border-border/60 px-2 text-[10px] text-foreground hover:border-primary/40"
                          >
                            <Copy className="h-3 w-3" /> copy
                          </button>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-foreground">{formatCurrency(row.amount)}</td>
                      <td className="p-3 text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="p-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase ${statusClass[status]}`}>{status}</span></td>
                      <td className="p-3"><div className="flex flex-wrap gap-1.5">{status === "pending" ? <><button onClick={() => withdrawalMutation.mutate({ id: row.id, status: "approved" })} className="h-7 rounded bg-primary px-2 text-[10px] text-primary-foreground">approve</button><button onClick={() => withdrawalMutation.mutate({ id: row.id, status: "rejected" })} className="h-7 rounded border border-border/60 px-2 text-[10px]">reject</button></> : null}{status === "approved" ? <button onClick={() => withdrawalMutation.mutate({ id: row.id, status: "paid" })} className="h-7 rounded bg-primary px-2 text-[10px] text-primary-foreground">mark paid</button> : null}</div></td>
                    </tr>
                  );
                })}
                {!filtered.length ? <tr><td colSpan={7} className="p-0"><EmptyState title="No withdrawals found" description="Requests will appear here when affiliates submit payouts." /></td></tr> : null}
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
      <div className="flex min-h-screen w-full overflow-hidden bg-background grain">
        <Sidebar collapsible="icon" className="border-r border-border/60 bg-sidebar/90 backdrop-blur-xl">
          <SidebarContent>
            <div className="flex h-14 items-center border-b border-border/60 px-3"><BrandMark size={18} withWordmark className="drop-shadow-[0_0_12px_hsl(217_91%_60%/0.2)] group-data-[collapsible=icon]:opacity-0" /></div>
            {navGroups.map((group) => {
              const isExpanded = group.items.some((item) => currentPath === item.path);
              return (
                <SidebarGroup key={group.title} className={isExpanded ? "rounded-md bg-sidebar-accent/20" : ""}>
                  <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.path}>
                          <SidebarMenuButton asChild isActive={currentPath === item.path}>
                            <NavLink to={item.path} className="flex items-center gap-2 text-xs"><item.icon className="h-4 w-4" /><span>{item.label}</span></NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </SidebarContent>
        </Sidebar>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/60 bg-background/85 px-3 backdrop-blur-lg sm:px-5">
            <div className="flex items-center gap-2"><SidebarTrigger className="text-muted-foreground hover:text-foreground" /><Shield className="h-4 w-4 text-primary" /><span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Admin Operations</span></div>
            <div className="flex items-center gap-2"><button onClick={refreshAll} className="rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"><RefreshCw className="h-4 w-4" /></button><span className="hidden text-xs font-mono text-muted-foreground md:inline">{user?.email}</span><button onClick={async () => { if (user?.id) { try { await logAdminAction("admin_logout", user.id, { email: user.email ?? null }); } catch {} } await signOut(); navigate("/adminsh/auth"); }} className="rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"><LogOut className="h-4 w-4" /></button></div>
          </header>

          <main className="mx-auto max-w-[1540px] space-y-6 p-4 md:p-6">
            <section className="rounded-lg border border-border/60 bg-card/35 p-4"><h1 className="text-xl font-semibold text-foreground">{meta.title}</h1><p className="mt-1 text-sm text-muted-foreground">{meta.subtitle}</p></section>

            {queryErrors.length ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                Some backend queries failed.
                <button onClick={refreshAll} className="ml-2 underline underline-offset-2">Retry</button>
              </div>
            ) : null}

            {isBootLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
                <Skeleton className="h-72 rounded-lg" />
                <Skeleton className="h-72 rounded-lg" />
              </div>
            ) : (
              <AnimatePresence mode="wait"><motion.div key={currentPath} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>{renderPage()}</motion.div></AnimatePresence>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminDashboard;
