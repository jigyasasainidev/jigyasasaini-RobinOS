// ============================================================
// ROBINOS — CENTRALIZED FEATURE USAGE TRACKER
// ============================================================
// ALL analytics writes must go through this module.
// Edge functions call trackFeatureUsage() after successful
// generation — never from frontend or presentation layers.
//
// DESIGN PRINCIPLES:
//   - Silent failure: analytics NEVER crash generation flows
//   - Daily upsert: one row per (user_id, feature_name, date_key)
//     — avoids duplicate spam while preserving granular daily data
//   - Atomic increment: ON CONFLICT DO UPDATE SET usage_count += N
//   - Service client: bypasses RLS — safe for backend-only writes
//   - No frontend writes: this module is Deno-only (_shared/)
//
// USAGE:
//   import { trackFeatureUsage } from "../_shared/feature-usage.ts";
//
//   // After successful generation (non-fatal, fire-and-forget):
//   trackFeatureUsage({ supabase, userId, feature: "script_generation" });
//
// FEATURE NAME CONSTANTS:
//   Use the same string keys as plan_entitlements.feature_key
//   so analytics can be joined with entitlement data later.
// ============================================================

import { createServiceClient } from "./entitlement.ts";

// ── Types ────────────────────────────────────────────────────

export interface TrackFeatureUsageOptions {
  /** Supabase service-role client (already created in calling function) */
  supabase: ReturnType<typeof createServiceClient>;
  /** Verified user UUID — must come from supabase.auth.getUser(), never from client input */
  userId: string;
  /**
   * Feature key — must match plan_entitlements.feature_key values:
   * "script_generation" | "caption_generation" | "trend_scan" |
   * "hashtag_scan" | "tts_generation" | "video_generation"
   */
  feature: string;
  /** How many units consumed. Defaults to 1. */
  amount?: number;
}

// ── Core tracker ─────────────────────────────────────────────

/**
 * Record feature usage for analytics.
 *
 * Performs a daily upsert: if a row already exists for this
 * (user_id, feature_name, date_key) today, increments usage_count.
 * If not, creates a new row with usage_count = amount.
 *
 * This function NEVER throws. All errors are caught and logged
 * silently so analytics never block or crash the calling flow.
 *
 * Call this AFTER confirming the generation succeeded — not before,
 * not on error paths.
 */
export async function trackFeatureUsage(
  opts: TrackFeatureUsageOptions,
): Promise<void> {
  const { supabase, userId, feature, amount = 1 } = opts;

  if (!userId || !feature) {
    console.error(JSON.stringify({
      fn: "feature-usage",
      phase: "VALIDATION_FAILED",
      reason: "missing userId or feature",
    }));
    return;
  }

  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  try {
    const { error } = await supabase.rpc("upsert_feature_usage", {
      p_user_id: userId,
      p_feature_name: feature,
      p_date_key: dateKey,
      p_increment: amount,
    });

    if (error) {
      // RPC may not exist yet or there may be a transient DB error — log, don't throw
      console.error(JSON.stringify({
        fn: "feature-usage",
        phase: "UPSERT_ERROR",
        feature,
        error_code: error.code,
        error_message: error.message,
      }));

      // Fallback: direct insert (will fail on duplicate but that's fine — ON CONFLICT DO NOTHING)
      await supabase.from("feature_usage").upsert(
        {
          user_id: userId,
          feature_name: feature,
          date_key: dateKey,
          usage_count: amount,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id,feature_name,date_key", ignoreDuplicates: false },
      ).then(({ error: fallbackErr }) => {
        if (fallbackErr) {
          console.error(JSON.stringify({
            fn: "feature-usage",
            phase: "FALLBACK_INSERT_ERROR",
            feature,
            error_code: fallbackErr.code,
          }));
        }
      });
    }
  } catch (err) {
    // Absolute last resort — analytics must never propagate exceptions
    console.error(JSON.stringify({
      fn: "feature-usage",
      phase: "UNEXPECTED_ERROR",
      feature,
      message: err instanceof Error ? err.message : "unknown",
    }));
  }
}
