import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Settings, Key, CreditCard, Shield, BarChart3, Lock, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/cloudDb";
import { toast } from "sonner";
import { useByokAccess, useProfile, useTierLevel } from "@/hooks/useProfile";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCurrency } from "@/hooks/useCurrency";
import { getPlans, getCurrencySymbol, getTierDisplayName, normalizeTier } from "@/lib/pricing";
import { BrandMark } from "@/components/BrandMark";

const SettingsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: byokEnabled } = useByokAccess();
  const tier = useTierLevel();
  const isProOrAbove = byokEnabled ?? (tier === "pro_creator" || tier === "agency" || tier === "scale_agency");
  const isFree = tier === "free";
  const isAgency = tier === "agency" || tier === "scale_agency";
  const [elevenLabsKey, setElevenLabsKey] = useState(profile?.elevenlabs_api_key || "");
  const [videoApiKey, setVideoApiKey] = useState((profile as any)?.video_api_key || "");
  const [scriptUsage, setScriptUsage] = useState<{ used: number; quota: number; remaining: number; fair_usage: boolean } | null>(null);
  const [captionUsage, setCaptionUsage] = useState<{ used: number; quota: number; remaining: number; fair_usage: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const { currency } = useCurrency();
  const plans = getPlans(currency);
  const symbol = getCurrencySymbol(currency);

  const handleSubscribe = (planTier: string) => {
    const planLabel = planTier === "pro_creator" ? "Pro Creator" : planTier === "agency" ? "Agency" : "Creator";
    toast.info(`${planLabel} subscriptions are coming soon. Billing will be enabled here directly.`);
  };

  const currentTier = profile?.subscription_tier || "free";
  const normalizedCurrent = normalizeTier(currentTier);

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

  const tierDisplayName = getTierDisplayName(currentTier);

  useEffect(() => {
    const loadUsage = async () => {
      const [{ data: scriptData, error: scriptError }, { data: captionData, error: captionError }] = await Promise.all([
        db.rpc("get_usage_status", { p_feature_name: "scripts" }),
        db.rpc("get_usage_status", { p_feature_name: "captions" }),
      ]);

      if (!scriptError && scriptData) {
        setScriptUsage({
          used: Number(scriptData.used ?? 0),
          quota: Number(scriptData.quota ?? 0),
          remaining: Number(scriptData.remaining ?? 0),
          fair_usage: Boolean(scriptData.fair_usage),
        });
      }

      if (!captionError && captionData) {
        setCaptionUsage({
          used: Number(captionData.used ?? 0),
          quota: Number(captionData.quota ?? 0),
          remaining: Number(captionData.remaining ?? 0),
          fair_usage: Boolean(captionData.fair_usage),
        });
      }
    };
    void loadUsage();
  }, [user?.id]);

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

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-medium text-foreground">Script Usage</h2>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
              {scriptUsage?.fair_usage || isAgency ? "Unlimited (Fair Usage)" : `${scriptUsage?.remaining ?? 0} left`}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{scriptUsage?.used ?? 0} used today</span>
              <span>{scriptUsage?.fair_usage || isAgency ? "∞" : scriptUsage?.quota ?? 0} total</span>
            </div>
            <Progress value={scriptUsage?.fair_usage || isAgency ? 15 : (scriptUsage?.quota ? (scriptUsage.used / scriptUsage.quota) * 100 : 0)} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground/60 font-mono">
              {isFree
                ? "Free — 3 scripts total"
                : isAgency
                  ? "Agency — Unlimited generations (fair usage), client workflows, white-label exports"
                  : normalizedCurrent === "pro_creator"
                    ? "Pro Creator — 100 scripts/day"
                    : "Creator — 20 scripts/day"}
            </p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Caption Engine Usage</h2>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{captionUsage?.used ?? 0} used today</span>
              <span>{captionUsage?.fair_usage ? "∞" : captionUsage?.quota ?? 0} total</span>
            </div>
            <Progress value={captionUsage?.fair_usage ? 15 : (captionUsage?.quota ? ((captionUsage.used / captionUsage.quota) * 100) : 0)} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground/60 font-mono">Caption Engine generation quota scales with your current tier.</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-lg border-glass bg-card p-5 relative max-w-2xl">
          {!isProOrAbove && (
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
              <Input type="password" value={elevenLabsKey} onChange={(e) => setElevenLabsKey(e.target.value)} placeholder="xi-..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40 h-11 font-mono text-xs" disabled={!isProOrAbove} />
              <a
                href="https://try.elevenlabs.io/8ym6azaucekp"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-[11px] font-mono text-primary hover:text-primary/80 underline underline-offset-2"
              >
                Get your ElevenLabs API key
              </a>
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Replicate API Key (Video)</label>
              <Input type="password" value={videoApiKey} onChange={(e) => setVideoApiKey(e.target.value)} placeholder="r8_..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40 h-11 font-mono text-xs" disabled={!isProOrAbove} />
            </div>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={handleSaveKeys} disabled={saving || !isProOrAbove} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium glow-blue disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Save Keys"}
            </motion.button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-lg border-glass bg-card p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Account</h2>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Email: <span className="text-foreground font-mono">{user?.email}</span></p>
            <p>Plan: <span className={`font-mono uppercase ${isAgency ? 'text-amber-400' : isFree ? 'text-muted-foreground' : 'text-primary'}`}>{tierDisplayName}</span></p>
            <p>Region: <span className="text-foreground font-mono">Global (USD)</span></p>
            <p>Status: <span className="text-primary font-mono">Active</span></p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-center gap-2 mb-6">
            <CreditCard className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Subscription</h2>
          </div>

          <div className="text-center mb-2 space-y-1">
            <p className="text-[10px] text-muted-foreground/50 font-mono">Global USD pricing • Billing infrastructure is currently being finalized for global launch.</p>
            <p className="text-[10px] text-primary/80 font-mono">Creator subscriptions will open in an upcoming release.</p>
          </div>

          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-full border border-border bg-secondary p-1">
              <button onClick={() => setBillingCycle("monthly")} className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${billingCycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>MONTHLY</button>
              <button onClick={() => setBillingCycle("yearly")} className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${billingCycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>YEARLY <span className="ml-1 text-[10px] opacity-70">-17%</span></button>
            </div>
          </div>

          <div className={`grid gap-4 ${plans.length > 3 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
            {plans.map((plan) => {
              const isCurrent = normalizedCurrent === plan.tier;
              const yearlyMonthly = Math.round(plan.yearlyPrice / 12);
              const displayPrice = billingCycle === "yearly" ? yearlyMonthly : plan.monthlyPrice;
              const period = billingCycle === "yearly" ? "/mo (billed yearly)" : "/mo";
              const isAgencyCard = plan.isAgency;

              return (
                <div
                  key={plan.name}
                  className={`relative rounded-xl border p-5 transition-all ${
                    isAgencyCard
                      ? "border-amber-500/30 bg-amber-500/5 shadow-[0_0_24px_-10px_hsl(38_92%_50%/0.24)]"
                      : plan.popular
                        ? "border-primary/30 bg-primary/5 shadow-[0_0_24px_-10px_hsl(var(--primary)/0.24)]"
                        : "border-border/85 bg-card hover:border-border/75"
                  }`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className={`text-[10px] font-mono tracking-wider px-3 ${plan.badge === "PREMIUM" ? "bg-amber-500 text-black" : "bg-primary text-primary-foreground"}`}>
                        {plan.badge}
                      </Badge>
                    </div>
                  )}

                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">{plan.name}</p>
                  <div className="flex items-baseline gap-0.5 mb-5">
                    <span className="text-3xl font-bold text-foreground">{symbol}{displayPrice.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">{period}</span>
                  </div>

                  {billingCycle === "yearly" && (
                    <p className="text-[10px] text-muted-foreground/60 font-mono mb-4 -mt-3">
                      {symbol}{plan.yearlyPrice.toLocaleString()}/year
                    </p>
                  )}

                  <ul className="space-y-2 mb-5">
                    {plan.features.map((f) => (
                      <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <svg className={`w-3.5 h-3.5 shrink-0 ${isAgencyCard ? "text-amber-400" : "text-primary"}`} viewBox="0 0 16 16" fill="none">
                          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => !isCurrent && handleSubscribe(plan.tier)}
                    className={`w-full py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                      isCurrent
                        ? "bg-secondary text-muted-foreground cursor-default"
                        : isAgencyCard
                          ? "bg-amber-500 text-black hover:opacity-90"
                          : plan.popular
                            ? "bg-primary text-primary-foreground glow-blue hover:opacity-90"
                            : "border border-border text-foreground hover:bg-secondary"
                    }`}
                    disabled={isCurrent}
                  >
                    {isCurrent
                      ? "Current Plan"
                      : plan.tier === "pro_creator"
                          ? "Join Pro Creator Early Access"
                          : plan.tier === "agency"
                            ? "Join Agency Early Access"
                            : "Join Creator Early Access"}
                  </button>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SettingsPage;
