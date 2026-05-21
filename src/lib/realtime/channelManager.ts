// Centralized Realtime Channel Manager
// Prevents duplicate subscriptions, stale listener attachment, and lifecycle leaks.
// Singleton pattern: same channel name = same instance across the app.

import { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type PostgresChangeHandler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;

export interface ChannelConfig {
  channelName: string;
  table: string;
  schema?: string;
  filter?: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  callback: PostgresChangeHandler;
}

interface ManagedChannel {
  channel: RealtimeChannel;
  refCount: number;
  isSubscribed: boolean;
}

const channelRegistry = new Map<string, ManagedChannel>();

function getOrCreateManagedChannel(channelName: string): ManagedChannel {
  let managed = channelRegistry.get(channelName);
  if (!managed) {
    const channel = supabase.channel(channelName);
    managed = { channel, refCount: 0, isSubscribed: false };
    channelRegistry.set(channelName, managed);

    if (import.meta.env.DEV) {
      console.log(`[RealtimeManager] Created channel: ${channelName}`);
    }
  }
  return managed;
}

/**
 * Subscribe to a postgres_changes event with singleton protection.
 * Returns an unsubscribe function. Call on cleanup.
 * NOT a React hook — safe to call inside useEffect callbacks.
 */
export function subscribePostgresChanges(config: ChannelConfig): () => void {
  const { channelName, table, schema = "public", filter, event = "*", callback } = config;

  const managed = getOrCreateManagedChannel(channelName);

  // Attach listener BEFORE subscribe (correct Supabase lifecycle order)
  if (!managed.isSubscribed) {
    const handler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      try {
        callback(payload);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn(`[RealtimeManager] Listener error on ${channelName}:`, err);
        }
      }
    };

    const channelDef = managed.channel.on(
      "postgres_changes" as any,
      { event, schema, table, filter },
      handler as any,
    );

    managed.channel = channelDef;
    managed.channel.subscribe();
    managed.isSubscribed = true;

    if (import.meta.env.DEV) {
      console.log(`[RealtimeManager] Subscribed: ${channelName} -> ${schema}.${table}`);
    }
  }

  managed.refCount++;

  return () => {
    managed.refCount--;
    if (managed.refCount <= 0) {
      try {
        supabase.removeChannel(managed.channel);
      } catch {
        // Channel may already be removed by Supabase internals
      }
      channelRegistry.delete(channelName);
      managed.isSubscribed = false;

      if (import.meta.env.DEV) {
        console.log(`[RealtimeManager] Removed channel: ${channelName}`);
      }
    }
  };
}

/**
 * Force-remove a channel by name. Used for aggressive cleanup.
 */
export function forceRemoveChannel(channelName: string): void {
  const managed = channelRegistry.get(channelName);
  if (managed) {
    try {
      supabase.removeChannel(managed.channel);
    } catch {
      // ignore
    }
    channelRegistry.delete(channelName);
    managed.isSubscribed = false;
  }
}

/**
 * Remove all managed channels. Used on auth logout.
 */
export function removeAllChannels(): void {
  for (const [name, managed] of channelRegistry.entries()) {
    try {
      supabase.removeChannel(managed.channel);
    } catch {
      // ignore
    }
    managed.isSubscribed = false;
  }
  channelRegistry.clear();

  if (import.meta.env.DEV) {
    console.log("[RealtimeManager] All channels removed");
  }
}