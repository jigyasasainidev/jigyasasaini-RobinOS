import { supabase } from "@/integrations/supabase/client";

export const db = {
  from: (table: string) => (supabase as any).from(table),
  rpc: (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args),
};
