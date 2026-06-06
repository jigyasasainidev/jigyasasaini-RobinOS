// ============================================================
// ROBINOS — RECORD REFERRAL EDGE FUNCTION
// Records affiliate referral conversions.
// Commission rate is read LIVE from platform_settings table —
// never hardcoded. Admin panel changes propagate automatically.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Safe default — used ONLY if platform_settings row missing ──
// This should never fire in production; the table is always seeded.
const FALLBACK_COMMISSION_RATE = 0.30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    const { referral_code, referred_user_id } = await req.json();

    if (!referral_code || !referred_user_id) {
      return new Response(JSON.stringify({ error: "Missing referral_code or referred_user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const code = String(referral_code).trim().toLowerCase();
    const referredUserId = String(referred_user_id).trim();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Read live commission rate from platform_settings ──────
    // This is the SINGLE SOURCE OF TRUTH for commission %.
    // Admin panel updates → this value updates → all new commissions use new rate.
    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("affiliate_commission_percent")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const commissionPercent = Number(settings?.affiliate_commission_percent ?? (FALLBACK_COMMISSION_RATE * 100));
    const commissionRate = commissionPercent / 100; // e.g. 30 → 0.30

    console.log("[record-referral] Live commission rate:", commissionRate, "from settings:", !!settings);

    // ── 2. Validate referral code ────────────────────────────────
    const { data: refProfile, error: refErr } = await supabaseAdmin
      .from("affiliate_profiles")
      .select("user_id, referral_code")
      .eq("referral_code", code)
      .maybeSingle();

    if (refErr || !refProfile) {
      return new Response(JSON.stringify({ error: "Invalid referral code" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (refProfile.user_id === referredUserId) {
      return new Response(JSON.stringify({ error: "Cannot refer yourself" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Prevent duplicate conversions ─────────────────────────
    const { data: existingConversion } = await supabaseAdmin
      .from("affiliate_conversions")
      .select("id")
      .eq("affiliate_user_id", refProfile.user_id)
      .eq("referred_user_id", referredUserId)
      .maybeSingle();

    if (existingConversion) {
      return new Response(JSON.stringify({ success: true, message: "Referral already recorded" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Record click ──────────────────────────────────────────
    await supabaseAdmin.from("affiliate_clicks").insert({
      affiliate_user_id: refProfile.user_id,
      referred_user_id: referredUserId,
    });

    // ── 5. Record conversion with LIVE commission rate ───────────
    const { data: conversion, error: conversionErr } = await supabaseAdmin
      .from("affiliate_conversions")
      .insert({
        affiliate_user_id: refProfile.user_id,
        referred_user_id: referredUserId,
        plan_code: "signup",
        billed_amount: 0,
        commission_rate: commissionRate,  // ← live from DB, not hardcoded
        commission_amount: 0,             // computed on payment webhook
      })
      .select("id")
      .single();

    if (conversionErr || !conversion) {
      console.error("[record-referral] Conversion insert error:", conversionErr);
      return new Response(JSON.stringify({ error: "Failed to record referral conversion" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("affiliate_earnings").insert({
      affiliate_user_id: refProfile.user_id,
      conversion_id: conversion.id,
      amount: 0,
      status: "pending",
    });

    return new Response(JSON.stringify({
      success: true,
      commission_rate: commissionRate,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[record-referral] Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
