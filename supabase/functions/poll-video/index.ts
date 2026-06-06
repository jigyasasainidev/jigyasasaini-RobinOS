import {
  verifyAuth,
  CORS_HEADERS,
  createServiceClient,
  FEATURES,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── AI/ML API — universal video endpoint (same URL, GET for polling) ──
// Docs: https://docs.aimlapi.com/api-references/video-models/kling-ai/v2.5-turbo-pro-text-to-video
const AIML_VIDEO_URL = "https://api.aimlapi.com/v2/video/generations";

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

    // ── Parse request ──────────────────────────────────────────
    const { generation_id } = await req.json();
    if (!generation_id) {
      return new Response(
        JSON.stringify({ error: "generation_id is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Poll AI/ML API ─────────────────────────────────────────
    // GET /v2/video/generations?generation_id=<id>
    const pollUrl = `${AIML_VIDEO_URL}?generation_id=${encodeURIComponent(generation_id)}`;
    console.log("[poll-video] polling:", pollUrl.slice(-60));

    const pollRes = await fetch(pollUrl, {
      method:  "GET",
      headers: {
        "Authorization": `Bearer ${profile.video_api_key}`,
        "Content-Type":  "application/json",
      },
    });

    const pollText = await pollRes.text();
    console.log("[poll-video] status:", pollRes.status, pollText.slice(0, 300));

    if (!pollRes.ok) {
      return new Response(
        JSON.stringify({ status: "processing", error: "Poll request failed. Will retry." }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(pollText);
    } catch {
      return new Response(
        JSON.stringify({ status: "processing" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // AI/ML API status values: "queued" | "generating" | "completed" | "error"
    const status   = String(result?.status ?? "queued");
    const videoUrl = (result?.video as any)?.url ?? null;

    if (status === "completed" && videoUrl) {
      trackFeatureUsage({ supabase, userId, feature: FEATURES.VIDEO_GENERATION });
      return new Response(
        JSON.stringify({ status: "succeeded", video_url: videoUrl }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (status === "error") {
      const errMsg =
        (result?.error as any)?.message ??
        String(result?.error ?? "Video generation failed. Try again.");
      return new Response(
        JSON.stringify({ status: "failed", error: errMsg }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Still queued or generating
    return new Response(
      JSON.stringify({ status: "processing", video_url: null }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[poll-video] unexpected error:", err);
    return new Response(
      JSON.stringify({ status: "processing", error: "Internal error. Will retry." }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
