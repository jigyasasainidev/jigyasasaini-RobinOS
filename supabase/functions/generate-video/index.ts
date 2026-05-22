import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // Video generation is a premium feature — enforce entitlement
    // ============================================================
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
            code: entitlement.code,
            feature: entitlement.feature,
            plan: entitlement.plan,
            limit: entitlement.limit,
            used: entitlement.used,
            remaining: entitlement.remaining,
            reset_at: entitlement.reset_at,
          }),
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      return entitlementError;
    }

    // ============================================================
    // AUTH + PROFILE CHECK
    // ============================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Get user's video API key
    const { data: profile } = await supabase
      .from("profiles")
      .select("video_api_key, subscription_tier")
      .eq("user_id", user.id)
      .single();

    if (!profile?.video_api_key) {
      return new Response(
        JSON.stringify({ error: "Video API key not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const { prompt, aspect_ratio } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Map aspect ratio to width/height
    const dimensions: Record<string, { width: number; height: number }> = {
      "9:16": { width: 576, height: 1024 },
      "16:9": { width: 1024, height: 576 },
      "1:1": { width: 768, height: 768 },
    };
    const dim = dimensions[aspect_ratio] || dimensions["9:16"];

    // Create prediction on Replicate using Stable Video Diffusion
    const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.video_api_key}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: "dc59e70a0f5aa2c69c1602aeeaebe4b74cd0ce7d6d16b63f03fa83f85c969a83",
        input: {
          prompt: prompt.slice(0, 500),
          width: dim.width,
          height: dim.height,
          num_frames: 25,
          num_inference_steps: 30,
          fps: 8,
        },
      }),
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      console.error("Replicate create error:", createResponse.status, errText);
      if (createResponse.status === 401 || createResponse.status === 403) {
        return new Response(
          JSON.stringify({ error: "Invalid Replicate API key. Check your key in Settings." }),
          { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to start video generation. Try again." }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const prediction = await createResponse.json();

    // If prediction completed (Prefer: wait header)
    if (prediction.status === "succeeded" && prediction.output) {
      const videoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      // Analytics — silent, never blocks response
      trackFeatureUsage({ supabase, userId: user.id, feature: FEATURES.VIDEO_GENERATION });
      return new Response(
        JSON.stringify({ status: "succeeded", video_url: videoUrl, usage: entitlement }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Return prediction ID for polling
    return new Response(
      JSON.stringify({
        status: prediction.status || "starting",
        prediction_id: prediction.id,
        video_url: null,
        usage: entitlement,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-video error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});