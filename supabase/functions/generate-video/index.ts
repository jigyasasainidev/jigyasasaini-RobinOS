import {
  checkAndIncrementUsage,
  verifyAuth,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── AI/ML API — universal video endpoint ──────────────────
// Docs: https://docs.aimlapi.com/api-references/video-models/kling-ai/v2.5-turbo-pro-text-to-video
const AIML_VIDEO_URL = "https://api.aimlapi.com/v2/video/generations";

// Model: Kling 2.5 turbo/pro (latest stable text-to-video as of 2025)
const VIDEO_MODEL = "klingai/v2.5-turbo/pro/text-to-video";

// Only aspect ratios supported by Kling via AI/ML API
const VALID_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);

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

    // ── Entitlement check + atomic increment ──────────────────
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
      .select("video_api_key")
      .eq("user_id", userId)
      .single();

    if (!profile?.video_api_key) {
      return new Response(
        JSON.stringify({ error: "AI/ML API key not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Parse + validate request ───────────────────────────────
    const body = await req.json();
    const prompt      = String(body?.prompt ?? "").trim();
    const rawRatio    = String(body?.aspect_ratio ?? "16:9");
    const style       = String(body?.style ?? "").trim();
    const rawDuration = Number(body?.duration ?? 5);

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Clamp to valid values
    const aspectRatio = VALID_ASPECT_RATIOS.has(rawRatio) ? rawRatio : "16:9";
    const duration    = rawDuration === 10 ? 10 : 5; // only 5 or 10 supported

    // Prepend style to prompt if provided
    const fullPrompt = style
      ? `${style} style. ${prompt.slice(0, 480)}`
      : prompt.slice(0, 500);

    console.log("[generate-video] submitting to AI/ML API", {
      model:       VIDEO_MODEL,
      aspect_ratio: aspectRatio,
      duration,
      promptLen:   fullPrompt.length,
    });

    // ── Submit to AI/ML API ────────────────────────────────────
    const submitRes = await fetch(AIML_VIDEO_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${profile.video_api_key}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:        VIDEO_MODEL,   // REQUIRED — missing this caused silent failures
        prompt:       fullPrompt,
        duration:     duration,      // integer, not string
        aspect_ratio: aspectRatio,
      }),
    });

    const submitText = await submitRes.text();
    console.log("[generate-video] AI/ML API response", submitRes.status, submitText.slice(0, 400));

    if (!submitRes.ok) {
      let userMsg = `Video generation failed (${submitRes.status})`;
      try {
        const parsed = JSON.parse(submitText);
        // AI/ML API error shapes: { error: { message } } or { message } or { detail }
        userMsg =
          parsed?.error?.message ??
          parsed?.message ??
          parsed?.detail ??
          String(parsed?.error ?? userMsg);

        if (submitRes.status === 401) userMsg = "Invalid AI/ML API key. Check your key in Settings.";
        if (submitRes.status === 402) userMsg = "Insufficient AI/ML API credits. Top up at aimlapi.com.";
        if (submitRes.status === 429) userMsg = "AI/ML API rate limit reached. Wait a moment and try again.";
      } catch { /* keep default */ }

      return new Response(
        JSON.stringify({ error: userMsg }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let submission: Record<string, unknown>;
    try {
      submission = JSON.parse(submitText);
    } catch {
      console.error("[generate-video] could not parse success body:", submitText);
      return new Response(
        JSON.stringify({ error: "Unexpected response from AI provider. Try again." }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Generation ID is always `id` per AI/ML API docs
    const generationId = String(submission?.id ?? "").trim();

    if (!generationId) {
      console.error("[generate-video] no id in response:", submission);
      return new Response(
        JSON.stringify({ error: "Video generation failed to start. Try again." }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // If somehow already completed (rare with sync response)
    if (submission?.status === "completed") {
      const videoUrl = (submission?.video as any)?.url ?? null;
      if (videoUrl) {
        trackFeatureUsage({ supabase, userId, feature: FEATURES.VIDEO_GENERATION });
        return new Response(
          JSON.stringify({ status: "succeeded", video_url: videoUrl }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
    }

    // Normal async path — frontend will poll
    return new Response(
      JSON.stringify({
        status:        submission.status ?? "queued",
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
