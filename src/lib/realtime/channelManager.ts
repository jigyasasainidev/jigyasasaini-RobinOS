// ============================================================
// ROBINOS CENTRALIZED REALTIME CHANNEL MANAGER
// Production-safe lifecycle model for Supabase channels.
// ============================================================
// Rules enforced here:
//   1. ALL .on() listeners registered BEFORE .subscribe()
//   2. Every channel gets a UNIQUE name — no singleton reuse
//   3. Cleanup calls supabase.removeChannel() synchronously
//   4. React Strict Mode safe — fresh channel per effect mount
//   5. Supabase never sees .on() called after .subscribe()
//
// Why no singleton / channel reuse?
//   supabase.removeChannel() is async. If a React cleanup fires
//   and an effect re-runs (Strict Mode, fast nav), calling
//   supabase.channel(sameName) may return the *existing*
//   subscribed instance before removal completes.
//   Calling .on() on that subscribed instance throws:
//   "Cannot call .on() after .subscribe()"
//
//   Solution: append a unique ID to every channel name.
//   Each subscription instance owns its own channel object.
//   Cleanup removes it; the next mount creates a fresh one.
// ============================================================

import { type RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────

export type PostgresEvent = "*" | "INSERT" | "UPDATE" | "DELETE";

export interface SingleTableConfig {
  table: string;
  schema?: string;
  filter?: string;
  event?: PostgresEvent;
  callback: () => void;
}

export interface ChannelConfig {
  /** Human-readable label — used in dev logs and as prefix for unique name */
  channelName: string;
  table: string;
  schema?: string;
  filter?: string;
  event?: PostgresEvent;
  callback: () => void;
}

export interface MultiListenerConfig {
  /** Human-readable label */
  channelName: string;
  listeners: SingleTableConfig[];
}

// ── Unique ID helper ────────────────────────────────────────

let _counter = 0;
function uniqueChannelName(base: string): string {
  _counter = (_counter + 1) % 999999;
  // crypto.randomUUID not available in all environments; counter is sufficient
  return `${base}:${_counter}`;
}

// ── Core: build channel with all listeners then subscribe ───

function buildAndSubscribe(
  uniqueName: string,
  listeners: SingleTableConfig[]
): RealtimeChannel {
  // Start with a fresh channel object
  let ch = supabase.channel(uniqueName);

  // Register ALL listeners BEFORE subscribe — this is the critical contract
  for (const { table, schema = "public", filter, event = "*", callback } of listeners) {
    ch = ch.on(
      // Using type assertion because the TS overload union is complex
      "postgres_changes" as Parameters<typeof ch.on>[0],
      {
        event: event as any,
        schema,
        table,
        ...(filter ? { filter } : {}),
      } as any,
      () => {
        try {
          callback();
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn(`[Realtime] Listener error on ${uniqueName}:`, err);
          }
        }
      }
    );
  }

  // subscribe() is ALWAYS last — never before all .on() calls
  ch.subscribe((status) => {
    if (import.meta.env.DEV && status !== "SUBSCRIBED") {
      console.debug(`[Realtime] ${uniqueName} → ${status}`);
    }
  });

  return ch;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Subscribe to a single postgres_changes event.
 * Returns a cleanup function — always call it on unmount.
 *
 * Usage inside useEffect:
 *   const unsub = subscribePostgresChanges({ channelName, table, callback });
 *   return unsub;
 */
export function subscribePostgresChanges(config: ChannelConfig): () => void {
  const { channelName, table, schema, filter, event, callback } = config;

  const uniqueName = uniqueChannelName(channelName);
  const channel = buildAndSubscribe(uniqueName, [
    { table, schema, filter, event, callback },
  ]);

  if (import.meta.env.DEV) {
    console.debug(`[Realtime] subscribed: ${uniqueName} → ${schema ?? "public"}.${table}`);
  }

  return () => {
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Channel may already be cleaned up — safe to ignore
    }
    if (import.meta.env.DEV) {
      console.debug(`[Realtime] removed: ${uniqueName}`);
    }
  };
}

/**
 * Subscribe to MULTIPLE tables on a SINGLE channel.
 * All listeners are registered before the single .subscribe() call.
 * This is the recommended pattern when you need to watch several
 * tables in one hook — avoids multiple channels for the same user.
 *
 * Usage inside useEffect:
 *   const unsub = subscribeMultiTable({
 *     channelName: 'user-sync',
 *     listeners: [
 *       { table: 'profiles', filter: `user_id=eq.${userId}`, callback: refresh },
 *       { table: 'user_subscriptions', filter: `user_id=eq.${userId}`, callback: refresh },
 *     ],
 *   });
 *   return unsub;
 */
export function subscribeMultiTable(config: MultiListenerConfig): () => void {
  const { channelName, listeners } = config;
  if (!listeners.length) return () => {};

  const uniqueName = uniqueChannelName(channelName);
  const channel = buildAndSubscribe(uniqueName, listeners);

  if (import.meta.env.DEV) {
    const tables = listeners.map((l) => l.table).join(", ");
    console.debug(`[Realtime] multi-subscribed: ${uniqueName} → [${tables}]`);
  }

  return () => {
    try {
      void supabase.removeChannel(channel);
    } catch {
      // safe to ignore
    }
    if (import.meta.env.DEV) {
      console.debug(`[Realtime] multi-removed: ${uniqueName}`);
    }
  };
}

/**
 * Remove all channels immediately. Call on auth logout to
 * ensure no zombie subscriptions remain after sign-out.
 */
export async function removeAllUserChannels(): Promise<void> {
  const channels = supabase.getChannels();
  await Promise.allSettled(channels.map((ch) => supabase.removeChannel(ch)));
  if (import.meta.env.DEV) {
    console.debug(`[Realtime] removeAllUserChannels — removed ${channels.length} channels`);
  }
}

// Keep old name for backward compatibility with DashboardLayout.tsx
export const forceRemoveChannel = (_name: string) => {
  // no-op — channels are now instance-scoped, not name-scoped
};
