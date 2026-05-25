import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkAndIncrementUsage,
  verifyAuth,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// ── Per-voice tuned settings ───────────────────────────────
// All 20 voices — each voice ID maps to distinct EQ settings
const voiceSettings: Record<string, { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }> = {
  // ── Male ──────────────────────────────────────────────────
  "pNInz6obpgDQGcFmaJgB": { stability: 0.88, similarity_boost: 0.70, style: 0.08, use_speaker_boost: false }, // Ethan — Deep Cinematic
  "JBFqnCBsd6RMkjVDRZzb": { stability: 0.75, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true  }, // James — Confident Corporate
  "ErXwobaYiN019PkySvjV": { stability: 0.55, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true  }, // Alex  — Friendly Creator
  "TX3LPaxmHKxFdv7VOQHJ": { stability: 0.38, similarity_boost: 0.92, style: 0.72, use_speaker_boost: true  }, // Ryan  — Energetic Viral
  "onwK4e9ZLuTAKqWW03F9": { stability: 0.85, similarity_boost: 0.65, style: 0.10, use_speaker_boost: false }, // David — Documentary Calm
  "TxGEqnHWrfWFTfGW9XjX": { stability: 0.82, similarity_boost: 0.72, style: 0.15, use_speaker_boost: false }, // Michael — Luxury Smooth (Josh)
  "SOYHLrjzK2X1ezoPC6cr": { stability: 0.42, similarity_boost: 0.88, style: 0.65, use_speaker_boost: true  }, // Liam  — Youthful Fast (Harry)
  "VR6AewLTigWG4xSOukaG": { stability: 0.60, similarity_boost: 0.82, style: 0.50, use_speaker_boost: true  }, // Daniel — Motivational (Arnold)
  "yoZ06aMxZJJ28mfd3POQ": { stability: 0.52, similarity_boost: 0.80, style: 0.38, use_speaker_boost: true  }, // Noah  — Conversational (Sam)
  "CwhRBWXzGAHq8TQ4Fs17": { stability: 0.78, similarity_boost: 0.82, style: 0.22, use_speaker_boost: true  }, // Marcus — Strong Authority (Roger)
  // ── Female ────────────────────────────────────────────────
  "EXAVITQu4vr4xnSDxMaL": { stability: 0.65, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true  }, // Emma    — Warm & Natural (Sarah)
  "FGY2WhTYpPnrIDTdsKH5": { stability: 0.82, similarity_boost: 0.70, style: 0.12, use_speaker_boost: false }, // Sophia  — Luxury Elegant (Laura)
  "pFZP5JQG7iQjIQuC4Bku": { stability: 0.55, similarity_boost: 0.78, style: 0.52, use_speaker_boost: true  }, // Olivia  — Friendly Creator (Lily)
  "21m00Tcm4TlvDq8ikWAM": { stability: 0.78, similarity_boost: 0.68, style: 0.18, use_speaker_boost: false }, // Ava     — Soft & Calm (Rachel)
  "MF3mGyEYCl7XYWbV9V6O": { stability: 0.40, similarity_boost: 0.90, style: 0.70, use_speaker_boost: true  }, // Isabella — Expressive Viral (Elli)
  "cgSgspJ2msm6clMCkdW9": { stability: 0.55, similarity_boost: 0.82, style: 0.48, use_speaker_boost: true  }, // Mia — Soft Modern Creator (Jessica)
  "ThT5KcBeYPX3keUQqHPh": { stability: 0.80, similarity_boost: 0.72, style: 0.14, use_speaker_boost: false }, // Charlotte — Documentary (Dorothy)
  "AZnzlk1XvdvUeBnXmlld": { stability: 0.62, similarity_boost: 0.78, style: 0.48, use_speaker_boost: true  }, // Amelia  — Emotional Cinematic (Bella)
  "XB0fDUnXU5powFXDhCwa": { stability: 0.36, similarity_boost: 0.90, style: 0.75, use_speaker_boost: true  }, // Harper  — Gen-Z Fast Energy (Charlotte)
  "XrExE9yKIg1WjnnlVkGX": { stability: 0.76, similarity_boost: 0.78, style: 0.20, use_speaker_boost: true  }, // Grace   — Premium Corporate (Matilda)
};

// Default fallback settings for any unknown voice
const DEFAULT_SETTINGS = { stability: 0.65, similarity_boost: 0.80, style: 0.30, use_speaker_boost: true };

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

    // ── Parse body first so we know if this is a preview ──────
    // Previews skip quota increment (they're UI feature, not billable)
    let text = "";
    let voiceId = "";
    let isPreview = false;

    try {
      const body = await req.json();
      text      = String(body?.text     ?? "").trim();
      voiceId   = String(body?.voiceId  ?? "").trim();
      isPreview = !!body?.isPreview;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!text || !voiceId) {
      return new Response(
        JSON.stringify({ error: "text and voiceId are required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!isPreview && text.length > 5000) {
      return new Response(
        JSON.stringify({ error: "Text must be under 5000 characters" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Entitlement check ──────────────────────────────────────
    // Previews: verify auth only — no quota increment
    // Generations: full check + atomic increment
    let userId = "";

    if (isPreview) {
      // Auth-only path — no usage increment for previews
      const { userId: uid, error: authErr } = await verifyAuth(authHeader);
      if (authErr) return authErr;
      userId = uid;
    } else {
      const { result: entitlement, error: entitlementError } = await checkAndIncrementUsage(
        authHeader,
        FEATURES.TTS_GENERATION,
        crypto.randomUUID()
      );

      if (entitlementError) {
        if (entitlement && !entitlement.success) {
          return new Response(
            JSON.stringify({
              error: entitlement.code === "FEATURE_DISABLED"
                ? "Voice Over requires Pro Creator or Agency plan"
                : entitlement.message || "TTS generation limit reached",
              code:      entitlement.code,
              feature:   entitlement.feature,
              plan:      entitlement.plan,
              limit:     entitlement.limit,
              used:      entitlement.used,
              remaining: entitlement.remaining,
              reset_at:  entitlement.reset_at,
            }),
            { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }
        return entitlementError;
      }

      // Extract userId from auth header for profile lookup below
      const { userId: uid, error: authErr } = await verifyAuth(authHeader);
      if (authErr) return authErr;
      userId = uid;
    }

    // ── Profile — get BYOK API key ─────────────────────────────
    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("elevenlabs_api_key, subscription_tier")
      .eq("user_id", userId)
      .single();

    if (!profile?.elevenlabs_api_key) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Call ElevenLabs ────────────────────────────────────────
    const settings  = voiceSettings[voiceId] ?? DEFAULT_SETTINGS;
    const ttsText   = isPreview ? text.slice(0, 200) : text;

    const elResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key":   profile.elevenlabs_api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text:          ttsText,
          model_id:      "eleven_multilingual_v2",
          voice_settings: settings,
        }),
      }
    );

    if (!elResponse.ok) {
      const errText = await elResponse.text();
      console.error("[elevenlabs-tts] ElevenLabs error", elResponse.status, errText);

      // Surface the actual ElevenLabs error message to the user
      let userMessage = `ElevenLabs error (${elResponse.status})`;
      try {
        const parsed = JSON.parse(errText);
        const detail = parsed?.detail;
        if (typeof detail === "string") {
          userMessage = detail;
        } else if (typeof detail?.message === "string") {
          userMessage = detail.message;
        } else if (detail?.status === "voice_not_found") {
          userMessage = "Voice not found on your ElevenLabs account. Try a different voice.";
        } else if (elResponse.status === 401) {
          userMessage = "Invalid ElevenLabs API key. Check your key in Settings → API Keys.";
        } else if (elResponse.status === 422) {
          userMessage = "Voice not found or unavailable. Try a different voice.";
        } else if (elResponse.status === 429) {
          userMessage = "ElevenLabs rate limit reached. Wait a moment and try again.";
        }
      } catch { /* keep default */ }

      return new Response(
        JSON.stringify({ error: userMessage, el_status: elResponse.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await elResponse.arrayBuffer();

    // Analytics — only for full generations, not previews
    if (!isPreview) {
      trackFeatureUsage({ supabase, userId, feature: FEATURES.TTS_GENERATION });
    }

    return new Response(audioBuffer, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/mpeg",
      },
    });

  } catch (err) {
    console.error("[elevenlabs-tts] unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
