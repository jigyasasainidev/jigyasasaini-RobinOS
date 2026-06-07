// ============================================================
// SHARED AFFILIATE COMMISSION HELPER
// Used by both dodo-webhook and whop-webhook edge functions.
// This is the single source of truth for commission recording.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Shared affiliate commission recording ──────────────────

async function recordAffiliateCommission(
  supabase: ReturnType<typeof createClient>,
  referredUserId: string,
  referralCode:   string,
  paymentAmount:  number,
  subscriptionId: string
): Promise<void> {
  try {
    // 1. Find affiliate by referral code
    const { data: affiliateProfile } = await supabase
      .from("affiliate_profiles")
      .select("user_id, referral_code")
      .eq("referral_code", referralCode.toUpperCase())
      .maybeSingle();

    if (!affiliateProfile?.user_id) {
      console.warn(`[affiliate] Referral code not found: ${referralCode}`);
      return;
    }

    const affiliateUserId = affiliateProfile.user_id;

    // Prevent self-referral
    if (affiliateUserId === referredUserId) {
      console.warn(`[affiliate] Self-referral blocked: ${affiliateUserId}`);
      return;
    }

    // 2. Read live commission rate from platform_settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("affiliate_commission_percent")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const commissionPercent = Number(settings?.affiliate_commission_percent ?? 30);
    const commissionRate    = commissionPercent / 100;
    const commissionAmount  = Math.round(paymentAmount * commissionRate * 100) / 100;

    console.log(`[affiliate] Commission: affiliate=${affiliateUserId} referred=${referredUserId} amount=$${paymentAmount} rate=${commissionPercent}% commission=$${commissionAmount}`);

    // 3. Insert commission record (idempotent via dodo_subscription_id)
    // Status = 'pending' — NOT withdrawable until 14-day cooldown passes
    const eligibleAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: commErr } = await supabase
      .from("affiliate_commissions")
      .insert({
        affiliate_user_id:    affiliateUserId,
        referred_user_id:     referredUserId,
        dodo_subscription_id: subscriptionId,
        amount:               commissionAmount,
        status:               "pending",
        eligible_at:          eligibleAt,   // unlocks after 14 days
      })
      .select("id")
      .single();

    if (commErr) {
      // Unique constraint violation = already recorded (idempotent)
      if (commErr.code === "23505") {
        console.log(`[affiliate] Commission already recorded (idempotent)`);
        return;
      }
      throw new Error(`Commission insert failed: ${commErr.message}`);
    }

    // 4. Update affiliate_profiles totals atomically
    await supabase.rpc("increment_affiliate_balance", {
      p_affiliate_user_id: affiliateUserId,
      p_amount:            commissionAmount,
    });

    console.log(`[affiliate] Commission recorded: $${commissionAmount} for affiliate ${affiliateUserId}`);

    // Emit admin notification
    await supabase.rpc("push_admin_notification", {
      p_type:     "affiliate",
      p_title:    "🪙 Affiliate commission generated",
      p_message:  `$${commissionAmount} (${commissionPercent}%) · ref ${referralCode}`,
      p_priority: "info",
      p_metadata: { affiliate_user_id: affiliateUserId, referred_user_id: referredUserId, amount: commissionAmount },
    });

  } catch (err) {
    // Never let commission recording crash the payment flow
    console.error(`[affiliate] Commission recording failed (non-fatal):`, err instanceof Error ? err.message : err);
  }
}

export { recordAffiliateCommission };