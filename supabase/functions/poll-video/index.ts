import {
  verifyAuth,
  CORS_HEADERS,
  createServiceClient,
  FEATURES,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

const AIML_BASE = "https://api.aimlapi.com";

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

    // ── Auth ───────────────────────────────────────────────────
    const { userId, error: authErr } = await verifyAuth(authHeader);
    if (authErr) return authErr;

    // ── Profile ────────────────────────────────────────────────
    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("video_api_key")
      .eq("user_id", userId)
      .single();

    if (!profile?.video_api_key) {
      return new Response(
        JSON.stringify({ error: "No AI/ML API key found." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Parse body ─────────────────────────────────────────────
    const { generation_id } = await req.json();
    if (!generation_id) {
      return new Response(
        JSON.stringify({ error: "generation_id is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Poll AI/ML API ─────────────────────────────────────────
    const pollRes = await fetch(
      `${AIML_BASE}/v2/generate/video/kling-video/generation?generation_id=${encodeURIComponent(generation_id)}`,
      {
        method:  "GET",
        headers: { "Authorization": `Bearer ${profile.video_api_key}` },
      }
    );

    if (!pollRes.ok) {
      const errText = await pollRes.text();
      console.error("[poll-video] AI/ML API poll error:", pollRes.status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to check video status. Try again." }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await pollRes.json();
    console.log("[poll-video] status:", result?.status, "generation_id:", generation_id);

    // AI/ML API status values: "processing", "queued", "completed", "failed", "error"
    const status    = result?.status ?? "processing";
    const videoData = result?.video;
    const videoUrl  = videoData?.url ?? null;

    if (status === "completed" && videoUrl) {
      // Fire analytics silently on completion
      trackFeatureUsage({ supabase, userId, feature: FEATURES.VIDEO_GENERATION });
      return new Response(
        JSON.stringify({ status: "succeeded", video_url: videoUrl }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (status === "failed" || status === "error") {
      const errMsg = result?.error ?? result?.message ?? "Video generation failed on the AI provider side.";
      return new Response(
        JSON.stringify({ status: "failed", error: errMsg, video_url: null }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Still processing / queued
    return new Response(
      JSON.stringify({ status: "processing", video_url: null }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[poll-video] unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
