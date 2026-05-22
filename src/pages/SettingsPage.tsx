import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings, Key, CreditCard, Shield, BarChart3, Lock, Zap,
  Calendar, AlertTriangle, CheckCircle2, Clock3, RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/cloudDb";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { useIsByokEnabled, usePlanKey } from "@/hooks/useEntitlements";
import { useSubscriptionLifecycle } from "@/hooks/useSubscriptionLifecycle";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCurrency } from "@/hooks/useCurrency";
import { getPlans, getCurrencySymbol, getTierDisplayName } from "@/lib/pricing";
import { BrandMark } from "@/components/BrandMark";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

// ── Helpers ───────────────────────────────────────────────────

function planColor(plan: string) {
  if (plan === "agency" || plan === "scale_agency") return "text-amber-400";
  if (plan === "pro_creator") return "text-primary";
  if (plan === "creator") return "text-blue-400";
  return "text-muted-foreground";
}

function statusColor(status: string) {
  if (status === "active") return "text-emerald-400";
  if (status === "expired" || status === "cancelled") return "text-red-400";
  if (status === "past_due") return "text-amber-400";
  return "text-muted-foreground/50";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function billingCycleLabel(cycle: string): string {
  return cycle === "yearly" ? "Yearly" : "Monthly";
}

const SettingsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const plan = usePlanKey();
  const isByokEnabled = useIsByokEnabled();
  const { data: lifecycle, isLoading: lifecycleLoading } = useSubscriptionLifecycle();

  const isFree = plan === "free";
  const isAgency = plan === "agency" || plan === "scale_agency";
  const isProOrAbove = plan === "pro_creator" || plan === "agency" || plan === "scale_agency";

  // For pricing card "Current Plan" detection — use entitlement plan, not profile cache
  const normalizedCurrent = plan;

  const [elevenLabsKey, setElevenLabsKey] = useState(profile?.elevenlabs_api_key || "");
  const [videoApiKey, setVideoApiKey] = useState((profile as any)?.video_api_key || "");
  const [saving, setSaving] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const { currency } = useCurrency();
  const { data: platformSettings } = usePlatformSettings();
  const plans = getPlans(currency, {
    creator_price: platformSettings?.creator_price,
    pro_price: platformSettings?.pro_price,
    agency_price: platformSettings?.agency_price,
  });
  const symbol = getCurrencySymbol(currency);

  // Sync billing cycle pill with actual subscription cycle
  useEffect(() => {
    if (lifecycle?.billing_cycle === "yearly") setBillingCycle("yearly");
  }, [lifecycle?.billing_cycle]);

  // Keep API key inputs in sync with profile (after initial load)
  useEffect(() => {
    setElevenLabsKey(profile?.elevenlabs_api_key || "");
    setVideoApiKey((profile as any)?.video_api_key || "");
  }, [profile?.elevenlabs_api_key, (profile as any)?.video_api_key]);

  const handleSubscribe = (planTier: string) => {
    const planLabel = planTier === "pro_creator" ? "Pro Creator" : planTier === "agency" ? "Agency" : "Creator";
    toast.info(`${planLabel} subscriptions are coming soon. Billing will be enabled here directly.`);
  };

  const handleSaveKeys = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await db
      .from("profiles")
      .update({ elevenlabs_api_key: elevenLabsKey, video_api_key: videoApiKey } as any)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to save");
    } else {
      toast.success("Keys saved securely");
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    }
    setSaving(false);
  };

  const tierDisplayName = getTierDisplayName(plan);

  // Usage from lifecycle (no extra RPC)
  const scriptUsed = Number((lifecycle?.script_usage as any)?.usage_count ?? 0);
  const captionUsed = Number((lifecycle?.caption_usage as any)?.usage_count ?? 0);

  return (
    <div className="pt-14 md:pt-0">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <BrandMark size={18} withWordmark={false} className="drop-shadow-[0_0_12px_hsl(217_91%_60%/0.2)]" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Creator Workspace</span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Creator Workspace</h1>
      </div>

      <div className="space-y-8 max-w-4xl">

        {/* ── Expiry warning banner ── */}
        {lifecycle?.expires_soon && !isFree && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Subscription expiring soon</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your {getTierDisplayName(plan)} plan expires in {lifecycle.days_until_expiry} day{lifecycle.days_until_expiry === 1 ? "" : "s"} on {formatDate(lifecycle.expires_at)}.
                Renew to keep access.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Cooldown warning ── */}
        {lifecycle?.cooldown_active && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex items-start gap-3"
          >
            <Clock3 className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Plan change cooldown active</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your plan was last changed on {formatDate(lifecycle.last_plan_change_at)}.
                Plan modifications unlock in {lifecycle.cooldown_days_remaining} day{lifecycle.cooldown_days_remaining === 1 ? "" : "s"}.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Free plan banner ── */}
        {isFree && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-foreground">You're on the Free plan</p>
                <p className="text-xs text-muted-foreground">Upgrade to unlock all features and remove limits.</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Subscription lifecycle panel ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/60 bg-card p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <CreditCard className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Subscription Status</h2>
            {lifecycleLoading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin ml-1" />}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {/* Plan */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Current Plan</p>
              <p className={`font-semibold font-mono uppercase ${planColor(plan)}`}>{tierDisplayName}</p>
            </div>

            {/* Status */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Status</p>
              <p className={`font-mono text-xs ${statusColor(lifecycle?.status ?? "none")}`}>
                {lifecycle?.status === "active"
                  ? "● Active"
                  : lifecycle?.status === "expired"
                    ? "✕ Expired"
                    : lifecycle?.status === "cancelled"
                      ? "— Cancelled"
                      : lifecycle?.status === "past_due"
                        ? "⚠ Past Due"
                        : "— Free"}
              </p>
            </div>

            {/* Billing Cycle */}
            {!isFree && lifecycle?.billing_cycle && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Billing Cycle</p>
                <p className="text-foreground/80">{billingCycleLabel(lifecycle.billing_cycle)}</p>
              </div>
            )}

            {/* Expires */}
            {!isFree && lifecycle?.expires_at && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">
                  {lifecycle.status === "active" ? "Renews / Expires" : "Expired On"}
                </p>
                <p className={lifecycle.expires_soon ? "text-amber-400" : "text-foreground/80"}>
                  {formatDate(lifecycle.expires_at)}
                  {lifecycle.days_until_expiry !== null && lifecycle.status === "active" && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-mono">
                      ({lifecycle.days_until_expiry}d)
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* Started */}
            {!isFree && lifecycle?.starts_at && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Started</p>
                <p className="text-foreground/80">{formatDate(lifecycle.starts_at)}</p>
              </div>
            )}

            {/* Grant info */}
            {lifecycle?.granted_by_admin && lifecycle.granted_reason && (
              <div className="col-span-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Admin Grant</p>
                <p className="text-muted-foreground/60 italic">{lifecycle.granted_reason}</p>
              </div>
            )}

            {/* Cooldown */}
            {lifecycle?.cooldown_active && (
              <div className="col-span-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">Plan Change Cooldown</p>
                <p className="text-blue-400/80 font-mono text-[11px]">
                  Unlocks on {formatDate(lifecycle.cooldown_until)} ({lifecycle.cooldown_days_remaining} day{lifecycle.cooldown_days_remaining === 1 ? "" : "s"} remaining)
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Script usage ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium text-foreground">Script Usage</h2>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
              {isAgency ? "Unlimited (Fair Usage)" : isFree ? `${scriptUsed}/2 used` : `${scriptUsed} used today`}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{scriptUsed} used today</span>
              <span>{isAgency ? "∞" : isFree ? "2" : plan === "pro_creator" ? "100" : "20"} total</span>
            </div>
            <Progress
              value={isAgency ? 15 : isFree ? (scriptUsed / 2) * 100 : plan === "pro_creator" ? (scriptUsed / 100) * 100 : (scriptUsed / 20) * 100}
              className="h-1.5"
            />
            <p className="text-[10px] text-muted-foreground/60 font-mono">
              {isFree
                ? "Free — 2 scripts in first 24h"
                : isAgency
                  ? "Agency — Unlimited generations (fair usage)"
                  : plan === "pro_creator"
                    ? "Pro Creator — 100 scripts/day"
                    : "Creator — 20 scripts/day"}
            </p>
          </div>
        </motion.div>

        {/* ── Caption usage ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Caption Engine Usage</h2>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{captionUsed} used today</span>
              <span>{isAgency ? "∞" : isFree ? "2" : plan === "pro_creator" ? "100" : "20"} total</span>
            </div>
            <Progress
              value={isAgency ? 15 : isFree ? (captionUsed / 2) * 100 : plan === "pro_creator" ? (captionUsed / 100) * 100 : (captionUsed / 20) * 100}
              className="h-1.5"
            />
            <p className="text-[10px] text-muted-foreground/60 font-mono">Caption Engine generation quota scales with your current tier.</p>
          </div>
        </motion.div>

        {/* ── BYOK API Keys ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-lg border-glass bg-card p-5 relative max-w-2xl">
          {!isByokEnabled && (
            <div className="absolute inset-0 rounded-lg bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-2">
              <Lock className="w-5 h-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-mono">BYOK — Pro Creator / Agency Only</p>
              <p className="text-[10px] text-muted-foreground/60">Upgrade to Pro Creator or Agency to bring your own API keys</p>
            </div>
          )}
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">API Keys (BYOK)</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block">ElevenLabs API Key</label>
              <Input
                type="password"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                placeholder="xi-..."
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40 h-11 font-mono text-xs"
                disabled={!isByokEnabled}
              />
              <a href="https://try.elevenlabs.io/8ym6azaucekp" target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[11px] font-mono text-primary hover:text-primary/80 underline underline-offset-2">
                Get your ElevenLabs API key
              </a>
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Replicate API Key (Video)</label>
              <Input
                type="password"
                value={videoApiKey}
                onChange={(e) => setVideoApiKey(e.target.value)}
                placeholder="r8_..."
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40 h-11 font-mono text-xs"
                disabled={!isByokEnabled}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleSaveKeys}
              disabled={saving || !isByokEnabled}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium glow-blue disabled:opacity-50 transition-all"
            >
              {saving ? "Saving..." : "Save Keys"}
            </motion.button>
          </div>
        </motion.div>

        {/* ── Account info ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Account</h2>
          </div>
          <div className="text-xs text-muted-foreground space-y-1.5">
            <p>Email: <span className="text-foreground font-mono">{user?.email}</span></p>
            <p>Plan: <span className={`font-mono uppercase font-semibold ${planColor(plan)}`}>{tierDisplayName}</span></p>
            {!isFree && lifecycle?.billing_cycle && (
              <p>Billing: <span className="text-foreground font-mono">{billingCycleLabel(lifecycle.billing_cycle)}</span></p>
            )}
            {!isFree && lifecycle?.expires_at && (
              <p>
                {lifecycle.status === "active" ? "Renews" : "Expired"}:{" "}
                <span className={`font-mono ${lifecycle.expires_soon ? "text-amber-400" : "text-foreground"}`}>
                  {formatDate(lifecycle.expires_at)}
                </span>
              </p>
            )}
            <p>Region: <span className="text-foreground font-mono">Global (USD)</span></p>
            <p>
              Status:{" "}
              <span className={`font-mono ${statusColor(lifecycle?.status ?? "none")}`}>
                {lifecycle?.subscription_active ? "Active" : isFree ? "Free" : lifecycle?.status ?? "—"}
              </span>
            </p>
          </div>
        </motion.div>

        {/* ── Subscription plans ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-center gap-2 mb-6">
            <CreditCard className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Subscription</h2>
          </div>

          <div className="text-center mb-2 space-y-1">
            <p className="text-[10px] text-muted-foreground/50 font-mono">
              Global USD pricing • Billing infrastructure is currently being finalized for global launch.
            </p>
            {lifecycle?.cooldown_active && (
              <p className="text-[10px] text-blue-400/70 font-mono">
                Plan changes unlock in {lifecycle.cooldown_days_remaining} day{lifecycle.cooldown_days_remaining === 1 ? "" : "s"}.
              </p>
            )}
          </div>

          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-full border border-border bg-secondary p-1">
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${billingCycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                MONTHLY
              </button>
              <button
                onClick={() => setBillingCycle("yearly")}
                className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${billingCycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                YEARLY <span className="ml-1 text-[10px] opacity-70">-17%</span>
              </button>
            </div>
          </div>

          <div className={`grid gap-4 ${plans.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
            {plans.map((planConfig) => {
              const isCurrent = normalizedCurrent === planConfig.tier;
              const yearlyMonthly = Math.round(planConfig.yearlyPrice / 12);
              const displayPrice = billingCycle === "yearly" ? yearlyMonthly : planConfig.monthlyPrice;
              const period = billingCycle === "yearly" ? "/mo (billed yearly)" : "/mo";
              const isAgencyCard = planConfig.isAgency;

              return (
                <div
                  key={planConfig.name}
                  className={`relative rounded-xl border p-5 transition-all ${
                    isAgencyCard
                      ? "border-amber-500/30 bg-amber-500/5 shadow-[0_0_24px_-10px_hsl(38_92%_50%/0.24)]"
                      : planConfig.popular
                        ? "border-primary/30 bg-primary/5 shadow-[0_0_24px_-10px_hsl(var(--primary)/0.24)]"
                        : "border-border/85 bg-card hover:border-border/75"
                  }`}
                >
                  {planConfig.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className={`text-[10px] font-mono tracking-wider px-3 ${planConfig.badge === "PREMIUM" ? "bg-amber-500 text-black" : "bg-primary text-primary-foreground"}`}>
                        {planConfig.badge}
                      </Badge>
                    </div>
                  )}

                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">{planConfig.name}</p>
                  <div className="flex items-baseline gap-0.5 mb-5">
                    <span className="text-3xl font-bold text-foreground">{symbol}{displayPrice.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">{period}</span>
                  </div>

                  {billingCycle === "yearly" && (
                    <p className="text-[10px] text-muted-foreground/60 font-mono mb-4 -mt-3">
                      {symbol}{planConfig.yearlyPrice.toLocaleString()}/year
                    </p>
                  )}

                  <ul className="space-y-2 mb-5">
                    {planConfig.features.map((f) => (
                      <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <svg className={`w-3.5 h-3.5 shrink-0 ${isAgencyCard ? "text-amber-400" : "text-primary"}`} viewBox="0 0 16 16" fill="none">
                          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => !isCurrent && handleSubscribe(planConfig.tier)}
                    disabled={isCurrent}
                    className={`w-full py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                      isCurrent
                        ? "bg-secondary text-muted-foreground cursor-default"
                        : isAgencyCard
                          ? "bg-amber-500 text-black hover:opacity-90"
                          : planConfig.popular
                            ? "bg-primary text-primary-foreground glow-blue hover:opacity-90"
                            : "border border-border text-foreground hover:bg-secondary"
                    }`}
                  >
                    {isCurrent
                      ? "Current Plan"
                      : planConfig.tier === "pro_creator"
                        ? "Join Pro Creator Early Access"
                        : planConfig.tier === "agency"
                          ? "Join Agency Early Access"
                          : "Join Creator Early Access"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* ── Billing policy note ── */}
          <div className="mt-6 rounded-lg border border-border/40 bg-secondary/30 p-4 max-w-2xl text-xs text-muted-foreground space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2">Billing Policy</p>
            <p>• Subscriptions are billed {billingCycle === "yearly" ? "annually" : "monthly"} and expire after 30{billingCycle === "yearly" ? "–365" : ""} days unless renewed.</p>
            <p>• Access is reverted to the Free plan immediately upon expiry.</p>
            <p>• Plan changes are subject to a <strong className="text-foreground/70">14-day cooldown</strong> after each modification.</p>
            <p>• No refunds are issued on plan switches. Unused subscription time is not credited.</p>
            <p>• Upgraded plans activate immediately at full price with a new billing cycle.</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SettingsPage;
