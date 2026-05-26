import { useEffect, useMemo, useState } from "react";
import { motion, animate } from "framer-motion";
import {
  Check,
  Copy,
  DollarSign,
  Link2,
  TrendingUp,
  Users,
  Wallet,
  Clock3,
  ShieldCheck,
  CircleDollarSign,
  ArrowUpRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";
import { useReferralData } from "@/hooks/useReferralData";
import { SkeletonCard } from "@/components/ui/skeleton";

const REFERRAL_DOMAIN = "https://tryrobin.xyz";
const WITHDRAWAL_FEE = 0;

const statusClasses: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  approved: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  paid: "bg-primary/10 text-primary border-primary/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

const CountValue = ({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) => {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(display, value, {
      duration: 0.7,
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value]);

  return <>{prefix}{Math.round(display * 100) / 100}{suffix}</>;
};

const ReferralsPage = () => {
  const queryClient = useQueryClient();
  const { dashboard, withdrawals, loading, minimumWithdrawal, payoutDelayDays, affiliateCommissionPercent } = useReferralData();

  const [copied, setCopied] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const [walletAddress, setWalletAddress] = useState(dashboard?.payout_details ?? "");

  useEffect(() => {
    if (dashboard?.payout_details) setWalletAddress(dashboard.payout_details);
  }, [dashboard?.payout_details]);

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const referralCode = dashboard?.referral_code ?? "";
  const referralLink = dashboard?.referral_link ?? (referralCode ? `${REFERRAL_DOMAIN}/?ref=${referralCode}` : "");

  const available    = Number(dashboard?.available_balance ?? 0);
  const pending      = Number(dashboard?.pending_earnings  ?? 0);
  const totalEarned  = Number(dashboard?.total_earned      ?? 0);
  const paidOut      = Number(dashboard?.paid_out          ?? 0);
  const lockedBalance = Number((dashboard as any)?.locked_balance ?? 0);
  const totalReferrals = Number(dashboard?.total_referrals ?? 0);
  const paidConversions = Number(dashboard?.conversion_count ?? 0);
  const clicks = Number(dashboard?.referral_clicks ?? 0);

  const conversionRate = totalReferrals > 0 ? (paidConversions / totalReferrals) * 100 : 0;

  const hasPayoutMethod = Boolean(dashboard?.payout_method && dashboard?.payout_details);
  const amountNumber = Number(withdrawAmount || 0);
  const hasPendingWithdrawal = useMemo(
    () => withdrawals.some((w) => w.status === "pending" || w.status === "approved"),
    [withdrawals],
  );

  const withdrawalDisabled =
    requesting ||
    !hasPayoutMethod ||
    hasPendingWithdrawal ||
    amountNumber <= 0 ||
    Number.isNaN(amountNumber) ||
    amountNumber < minimumWithdrawal ||
    amountNumber > available;

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied");
    setTimeout(() => setCopied(false), 1200);
  };

  const shareOnX = () => {
    if (!referralLink) return;
    const text = encodeURIComponent("I use RobinOS to scale content workflows. Join with my referral link:");
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(referralLink)}`, "_blank", "noopener,noreferrer");
  };

  const shareOnWhatsApp = () => {
    if (!referralLink) return;
    const text = encodeURIComponent(`I use RobinOS to launch faster. Join via my referral link: ${referralLink}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const savePayoutMethod = async () => {
    const value = walletAddress.trim();
    if (!value) {
      toast.error("Enter your USDT TRC20 wallet address");
      return;
    }

    // TRC20 address: starts with T, 34 chars, base58
    const walletOk = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
    if (!walletOk) {
      toast.error("Invalid TRC20 address — must start with T and be 34 characters");
      return;
    }

    setSavingPayout(true);
    const { error } = await db.rpc("save_payout_method", {
      p_method: "usdt_trc20",
      p_details: value,
    });

    if (error) {
      toast.error(error.message || "Failed to save wallet address");
    } else {
      toast.success("USDT wallet address saved");
      await queryClient.invalidateQueries({ queryKey: ["affiliate-dashboard"] });
    }
    setSavingPayout(false);
  };

  const requestWithdrawal = async () => {
    if (withdrawalDisabled) return;

    setRequesting(true);
    const { error } = await db.rpc("submit_withdrawal_request", { p_amount: amountNumber });

    if (error) {
      const msg = error.message || "Unable to submit withdrawal";
      if (msg.toLowerCase().includes("minimum withdrawal")) {
        toast.warning(msg, { description: "Increase the amount and try again." });
      } else if (msg.toLowerCase().includes("payout method") || msg.toLowerCase().includes("verified")) {
        toast.warning(msg, { description: "Save and verify payout details first." });
      } else if (msg.toLowerCase().includes("exceeds available") || msg.toLowerCase().includes("insufficient")) {
        toast.warning(msg, { description: "Enter an amount within your available balance." });
      } else {
        toast.error(msg);
      }
    } else {
      setWithdrawAmount("");
      toast.success("Withdrawal request submitted successfully.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["affiliate-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["withdrawals"] }),
      ]);
    }
    setRequesting(false);
  };

  const stats = [
    { icon: Users,           label: "Total Referrals",    value: totalReferrals,  prefix: "" },
    { icon: TrendingUp,      label: "Paid Conversions",   value: paidConversions, prefix: "" },
    { icon: CircleDollarSign,label: "Total Earned",       value: totalEarned,     prefix: "$" },
    { icon: Wallet,          label: "Available Balance",  value: available,       prefix: "$" },
    { icon: Clock3,          label: "In Cooldown (14d)",  value: lockedBalance,   prefix: "$" },
    { icon: DollarSign,      label: "Paid Out",           value: paidOut,         prefix: "$" },
    { icon: ArrowUpRight,    label: "Conversion Rate",    value: conversionRate,  suffix: "%" },
  ];

  return (
    <div className="pt-14 md:pt-0">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Affiliate</span>
        </div>
        <h1 className="text-chrome text-2xl md:text-3xl font-semibold">Affiliate Payouts</h1>
      </motion.div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading affiliate stats">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-6 max-w-5xl">
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {stats.map((stat, idx) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                whileHover={{ y: -2, boxShadow: "0 0 30px hsl(var(--primary) / 0.14)" }}
                className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-4"
              >
                <stat.icon className="w-4 h-4 text-primary mb-2" />
                <p className="text-chrome text-xl font-semibold leading-none">
                  <CountValue value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-1.5">{stat.label}</p>
              </motion.div>
            ))}
          </section>

          <section className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-5">
            <div className="flex items-center justify-between gap-4 mb-3">
              <p className="text-sm text-foreground font-medium">Referral Link</p>
              <span className="text-[10px] font-mono text-primary/80">Code: {referralCode || "creating..."}</span>
            </div>

            <div className="flex gap-2 mb-3 flex-col sm:flex-row">
              <div className="flex-1 px-4 py-2.5 rounded-lg bg-secondary/70 border border-border text-xs font-mono text-muted-foreground truncate">
                {referralLink || `${REFERRAL_DOMAIN}/?ref=...`}
              </div>
              <button onClick={copyLink} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center gap-2 min-w-[110px]">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy Link"}
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="rounded-md border border-border/40 bg-secondary/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground font-mono">Referral Clicks</p>
                <p className="text-sm text-foreground font-medium">{clicks}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-secondary/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground font-mono">Conversions</p>
                <p className="text-sm text-foreground font-medium">{paidConversions}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={shareOnX} className="px-3 py-2 rounded-md border border-border/60 text-xs text-foreground hover:border-primary/40 transition-colors">Share on X</button>
              <button onClick={shareOnWhatsApp} className="px-3 py-2 rounded-md border border-border/60 text-xs text-foreground hover:border-primary/40 transition-colors">Share on WhatsApp</button>
              <button onClick={copyLink} className="px-3 py-2 rounded-md border border-primary/30 bg-primary/10 text-xs text-primary hover:bg-primary/15 transition-colors">Copy Link</button>
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-foreground font-medium">Payout Method</p>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full"
                style={{ background: "hsl(142 70% 45% / 0.08)", border: "1px solid hsl(142 70% 45% / 0.2)", color: "hsl(142 70% 58%)" }}>
                USDT · TRC20
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/50 mb-3">
              Payouts are processed manually in USDT via the TRC20 network. Enter your wallet address below.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <Input
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="TRC20 wallet address (starts with T)"
                className="bg-secondary/70 border-border font-mono text-sm"
              />
              <button
                onClick={savePayoutMethod}
                disabled={savingPayout}
                className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {savingPayout ? "Saving..." : "Save"}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/50 bg-secondary/40 text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                {dashboard?.payout_details
                  ? `Wallet: ${dashboard.payout_details.slice(0, 6)}...${dashboard.payout_details.slice(-4)}`
                  : "No wallet address saved"}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/50 bg-secondary/40 text-muted-foreground">
                <Check className="w-3.5 h-3.5 text-primary" />
                {dashboard?.payout_verified ? "Verified by admin" : "Pending admin verification"}
              </span>
              {dashboard?.payout_updated_at && (
                <span className="text-muted-foreground">
                  Last updated: {new Date(dashboard.payout_updated_at).toLocaleString()}
                </span>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-5">
            <p className="text-sm text-foreground font-medium mb-3">Withdraw Earnings</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div className="rounded-md border border-border/50 bg-secondary/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground font-mono">Available Balance</p>
                <p className="text-lg text-chrome font-semibold">${available.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground font-mono">Minimum Withdrawal</p>
                <p className="text-lg text-chrome font-semibold">${minimumWithdrawal.toFixed(2)}</p>
              </div>
            </div>

            <Input
              type="number"
              min={0}
              step="0.01"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Enter amount"
              className="bg-secondary/70 border-border mb-3"
            />

            <button
              onClick={requestWithdrawal}
              disabled={withdrawalDisabled}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {requesting ? "Submitting..." : "Request Withdrawal"}
            </button>

            <div className="mt-3 text-[11px] text-muted-foreground space-y-1">
              <p>Payout method: USDT (TRC20) — manual transfer by RobinOS</p>
              <p>Estimated processing time: {Math.max(1, payoutDelayDays)} day(s)</p>
              <p>Current affiliate commission: {affiliateCommissionPercent}%</p>
              <p>Withdrawal fee: ${WITHDRAWAL_FEE.toFixed(2)}</p>
              {lockedBalance > 0 && (
                <p className="text-amber-400/70">
                  ${lockedBalance.toFixed(2)} in 14-day cooldown — available after verification period.
                </p>
              )}
              {!hasPayoutMethod && <p className="text-destructive">Save your USDT TRC20 wallet address to enable withdrawals.</p>}
              {hasPendingWithdrawal && <p className="text-primary">You already have a pending payout request in review.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/45 backdrop-blur-md p-5">
            <p className="text-sm text-foreground font-medium mb-3">Withdrawal History</p>

            {withdrawals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center rounded-xl"
                style={{ background: "hsl(222 28% 6%)", border: "1px dashed hsl(217 28% 13%)" }}>
                <p className="text-xs text-muted-foreground/40 font-mono">No withdrawal requests yet</p>
                <p className="text-[10px] text-muted-foreground/25 leading-relaxed">Once you request a payout it will appear here with live status tracking.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {withdrawals.map((w, idx) => (
                  <motion.div
                    key={w.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    whileHover={{ y: -1 }}
                    className="rounded-md border border-border/50 bg-secondary/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 min-w-[240px]">
                      <div>
                        <p className="text-[10px] text-muted-foreground font-mono">Amount</p>
                        <p className="text-sm text-foreground font-medium">${Number(w.amount).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-mono">Date</p>
                        <p className="text-xs text-foreground">{new Date(w.created_at).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-mono">Method</p>
                        <p className="text-xs text-foreground">USDT (TRC20)</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-mono">Status</p>
                        <span className={`inline-flex px-2 py-1 rounded-full border text-[10px] font-mono uppercase ${statusClasses[w.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {w.status}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default ReferralsPage;
