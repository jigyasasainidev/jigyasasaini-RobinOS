import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkAndIncrementUsage,
  CORS_HEADERS,
  FEATURES,
  createServiceClient,
} from "../_shared/entitlement.ts";
import { trackFeatureUsage } from "../_shared/feature-usage.ts";

// Per-voice tuned settings — covers all 20 voices in RobinOS voice library
const voiceSettings: Record<string, { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }> = {
  // ── Male ──────────────────────────────────────────────────────────────────
  "pNInz6obpgDQGcFmaJgB": { stability: 0.88, similarity_boost: 0.70, style: 0.08, use_speaker_boost: false }, // Ethan - Deep Cinematic
  "JBFqnCBsd6RMkjVDRZzb": { stability: 0.75, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true  }, // James - Confident Corporate
  "ErXwobaYiN019PkySvjV": { stability: 0.55, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true  }, // Alex - Friendly Creator
  "TX3LPaxmHKxFdv7VOQHJ": { stability: 0.38, similarity_boost: 0.92, style: 0.72, use_speaker_boost: true  }, // Ryan - Energetic Viral
  "onwK4e9ZLuTAKqWW03F9": { stability: 0.85, similarity_boost: 0.65, style: 0.10, use_speaker_boost: false }, // David - Documentary Calm
  "TxGEqnHWrfWFTfGW9XjX": { stability: 0.82, similarity_boost: 0.72, style: 0.15, use_speaker_boost: false }, // Michael - Luxury Smooth
  "SOYHLrjzK2X1ezoPC6cr": { stability: 0.42, similarity_boost: 0.88, style: 0.65, use_speaker_boost: true  }, // Liam - Youthful Fast
  "VR6AewLTigWG4xSOukaG": { stability: 0.60, similarity_boost: 0.82, style: 0.50, use_speaker_boost: true  }, // Daniel - Motivational
  "yoZ06aMxZJJ28mfd3POQ": { stability: 0.52, similarity_boost: 0.80, style: 0.38, use_speaker_boost: true  }, // Noah - Conversational
  "CwhRBWXzGAHq8TQ4Fs17": { stability: 0.78, similarity_boost: 0.82, style: 0.22, use_speaker_boost: true  }, // Marcus - Strong Authority
  // ── Female ────────────────────────────────────────────────────────────────
  "EXAVITQu4vr4xnSDxMaL": { stability: 0.65, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true  }, // Emma - Warm & Natural
  "FGY2WhTYpPnrIDTdsKH5": { stability: 0.82, similarity_boost: 0.70, style: 0.12, use_speaker_boost: false }, // Sophia - Luxury Elegant
  "pFZP5JQG7iQjIQuC4Bku": { stability: 0.55, similarity_boost: 0.78, style: 0.52, use_speaker_boost: true  }, // Olivia - Friendly Creator
  "21m00Tcm4TlvDq8ikWAM": { stability: 0.78, similarity_boost: 0.68, style: 0.18, use_speaker_boost: false }, // Ava - Soft & Calm
  "LcfcDJNUP1GQjkzn1xUU": { stability: 0.40, similarity_boost: 0.90, style: 0.70, use_speaker_boost: true  }, // Isabella - Expressive Viral
  "cgSgspJ2msm6clMCkdW9": { stability: 0.50, similarity_boost: 0.85, style: 0.60, use_speaker_boost: true  }, // Mia - Conversational
  "ThT5KcBeYPX3keUQqHPh": { stability: 0.80, similarity_boost: 0.72, style: 0.14, use_speaker_boost: false }, // Charlotte - Documentary
  "AZnzlk1XvdvUeBnXmlld": { stability: 0.62, similarity_boost: 0.78, style: 0.48, use_speaker_boost: true  }, // Amelia - Emotional Cinematic
  "XB0fDUnXU5powFXDhCwa": { stability: 0.36, similarity_boost: 0.90, style: 0.75, use_speaker_boost: true  }, // Harper - Gen-Z Fast Energy
  "oWAxZDx7w5VEj9dCyTzz": { stability: 0.76, similarity_boost: 0.78, style: 0.20, use_speaker_boost: true  }, // Grace - Premium Corporate
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // ============================================================
    // SERVER-SIDE ENTITLEMENT CHECK + ATOMIC INCREMENT
    // TTS generation is a premium feature
    // ============================================================
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

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from("profiles").select("elevenlabs_api_key, subscription_tier").eq("user_id", user.id).single();

    if (!profile?.elevenlabs_api_key) {
      return new Response(JSON.stringify({ error: "ElevenLabs API key not configured. Add it in Settings → API Keys." }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const { text, voiceId } = await req.json();
    if (!text || !voiceId) {
      return new Response(JSON.stringify({ error: "Text and voiceId are required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (text.length > 5000) {
      return new Response(JSON.stringify({ error: "Text must be under 5000 characters" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Use per-voice tuned settings for distinct sound
    const settings = voiceSettings[voiceId] || { stability: 0.5, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": profile.elevenlabs_api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: settings,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs error:", errText);
      return new Response(JSON.stringify({ error: "ElevenLabs API error. Check your API key." }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const audioBuffer = await response.arrayBuffer();

    // Analytics — silent, never blocks response
    trackFeatureUsage({ supabase, userId: user.id, feature: FEATURES.TTS_GENERATION });

    return new Response(audioBuffer, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/mpeg",
        "X-Usage-Remaining": String(entitlement.remaining ?? ""),
      },
    });
  } catch (err) {
    console.error("TTS error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});