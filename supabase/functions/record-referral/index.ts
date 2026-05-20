import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    await supabaseAdmin.from("affiliate_clicks").insert({
      affiliate_user_id: refProfile.user_id,
      referred_user_id: referredUserId,
    });

    const { data: conversion, error: conversionErr } = await supabaseAdmin
      .from("affiliate_conversions")
      .insert({
        affiliate_user_id: refProfile.user_id,
        referred_user_id: referredUserId,
        plan_code: "signup",
        billed_amount: 0,
        commission_rate: 0.30,
        commission_amount: 0,
      })
      .select("id")
      .single();

    if (conversionErr || !conversion) {
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

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("record-referral error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
