import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkAndIncrementUsage,
  verifyAuth,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── AI/ML API config ───────────────────────────────────────
// Primary model: Kling 2.1 Standard text-to-video via AI/ML API
const AIML_BASE = "https://api.aimlapi.com";

// Aspect ratio → AI/ML API format
const ASPECT_MAP: Record<string, string> = {
  "9:16":  "9:16",
  "16:9":  "16:9",
  "1:1":   "1:1",
  "4:5":   "4:5",
  "21:9":  "21:9",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Entitlement check + increment ─────────────────────────
    const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
      authHeader,
      FEATURES.VIDEO_GENERATION,
      crypto.randomUUID()
    );

    if (entitlementError) {
      if (entitlement && !entitlement.success) {
        return new Response(
          JSON.stringify({
            error: entitlement.code === "FEATURE_DISABLED"
              ? "Video Studio requires Pro Creator or Agency plan"
              : entitlement.message || "Video generation limit reached",
            code:      entitlement.code,
            remaining: entitlement.remaining,
          }),
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      return entitlementError;
    }

    // ── Auth + profile ─────────────────────────────────────────
    const { userId, error: authErr } = await verifyAuth(authHeader);
    if (authErr) return authErr;

    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("video_api_key, subscription_tier")
      .eq("user_id", userId)
      .single();

    if (!profile?.video_api_key) {
      return new Response(
        JSON.stringify({ error: "AI/ML API key not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Parse request ──────────────────────────────────────────
    const { prompt, aspect_ratio, style, duration } = await req.json();
    if (!prompt?.trim()) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const ar       = ASPECT_MAP[aspect_ratio] ?? "16:9";
    const dur      = Number(duration) || 5;
    const fullPrompt = `${style ? style + " style, " : ""}${prompt.slice(0, 500)}`;

    console.log("[generate-video] AI/ML API request:", { ar, dur, style, promptLen: fullPrompt.length });

    // ── Submit to AI/ML API (Kling 2.1 Standard) ──────────────
    const submitRes = await fetch(
      `${AIML_BASE}/v2/generate/video/kling-video/generation`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${profile.video_api_key}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          prompt:       fullPrompt,
          duration:     String(dur),
          aspect_ratio: ar,
        }),
      }
    );

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error("[generate-video] AI/ML API error:", submitRes.status, errText);

      let userMsg = `AI/ML API error (${submitRes.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) userMsg = parsed.error.message;
        else if (parsed?.message)   userMsg = parsed.message;
        else if (parsed?.error)     userMsg = String(parsed.error);
        if (submitRes.status === 401) userMsg = "Invalid AI/ML API key. Check your key in Settings.";
        if (submitRes.status === 429) userMsg = "AI/ML API rate limit reached. Wait a moment and try again.";
        if (submitRes.status === 402) userMsg = "Insufficient AI/ML API credits. Top up at aimlapi.com.";
      } catch { /* keep default */ }

      return new Response(
        JSON.stringify({ error: userMsg }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const submission = await submitRes.json();
    console.log("[generate-video] submission response:", JSON.stringify(submission).slice(0, 300));

    // AI/ML API returns generation_id or id
    const generationId = submission?.id ?? submission?.generation_id ?? submission?.generationId;

    if (!generationId) {
      // Check if it came back immediately completed
      if (submission?.status === "completed" && submission?.video?.url) {
        trackFeatureUsage({ supabase, userId, feature: FEATURES.VIDEO_GENERATION });
        return new Response(
          JSON.stringify({ status: "succeeded", video_url: submission.video.url }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      console.error("[generate-video] no generation ID in response:", submission);
      return new Response(
        JSON.stringify({ error: "Video generation failed to start. Try again." }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Return generation ID for frontend polling
    return new Response(
      JSON.stringify({
        status:        submission.status ?? "processing",
        generation_id: generationId,
        video_url:     null,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[generate-video] unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error. Try again." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
