// ============================================================
// useAdminPaymentProviders — React Query bindings
// ============================================================
// All calls go through the admin-payment-providers edge function
// (single dispatcher) which verifies admin role and routes to
// the M55 SECURITY DEFINER RPCs. Secrets are NEVER returned.
//
// Pattern matches existing admin hooks: useQuery for reads,
// useMutation for writes, query invalidation on success.
// ============================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  type Provider,
  type ProviderFull,
  type ProviderProduct,
  type ProviderProductFormValues,
  type ProviderSummary,
  type ProviderFormValues,
} from "@/lib/admin-payment-providers";

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const FN_URL            = `${SUPABASE_URL}/functions/v1/admin-payment-providers`;

// ── Query keys ──────────────────────────────────────────────
export const adminProvidersKeys = {
  all:       ["admin-providers"] as const,
  summary:   () => [...adminProvidersKeys.all, "summary"] as const,
  list:      () => [...adminProvidersKeys.all, "list"] as const,
  detail:    (id: string) => [...adminProvidersKeys.all, "detail", id] as const,
  products:  (providerId: string) => [...adminProvidersKeys.all, "products", providerId] as const,
};

// ── Edge function caller ────────────────────────────────────
type ApiEnvelope<T> = { success: true } & T;
type ApiError      = { success: false; code: string; message: string; existing_id?: string };

export class AdminApiError extends Error {
  code: string;
  existingId?: string;
  constructor(code: string, message: string, existingId?: string) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.existingId = existingId;
  }
}

async function callAdmin<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new AdminApiError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
  }

  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey:         SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });

  let data: ApiEnvelope<T> | ApiError;
  try {
    data = (await res.json()) as ApiEnvelope<T> | ApiError;
  } catch {
    throw new AdminApiError(
      "INVALID_RESPONSE",
      `Server returned a non-JSON response (HTTP ${res.status}).`,
    );
  }

  if (!res.ok || (data as ApiError).success === false) {
    const err = data as ApiError;
    throw new AdminApiError(err.code ?? "UNKNOWN", err.message ?? "Request failed", err.existing_id);
  }

  return (data as ApiEnvelope<T>) as unknown as T;
}

// ── Queries ─────────────────────────────────────────────────
export function useAdminProvidersSummary() {
  return useQuery({
    queryKey: adminProvidersKeys.summary(),
    queryFn: async () => {
      const r = await callAdmin<{ summary: ProviderSummary }>("summary");
      return r.summary;
    },
    staleTime: 30_000,
  });
}

export function useAdminProviders() {
  return useQuery({
    queryKey: adminProvidersKeys.list(),
    queryFn: async () => {
      const r = await callAdmin<{ providers: Provider[] }>("list_providers");
      return r.providers ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAdminProvider(id: string | null | undefined) {
  return useQuery({
    queryKey: adminProvidersKeys.detail(id ?? ""),
    queryFn: async () => {
      const r = await callAdmin<{ provider: ProviderFull }>("get_provider", { id });
      return r.provider;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAdminProviderProducts(providerId: string | null | undefined) {
  return useQuery({
    queryKey: adminProvidersKeys.products(providerId ?? ""),
    queryFn: async () => {
      const r = await callAdmin<{ products: ProviderProduct[] }>("list_products", {
        provider_id: providerId,
      });
      return r.products ?? [];
    },
    enabled: !!providerId,
    staleTime: 15_000,
  });
}

// ── Mutations ───────────────────────────────────────────────
export function useToggleProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      callAdmin("toggle_provider", { id, is_enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.all });
    },
  });
}

export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ProviderFormValues) => callAdmin("upsert_provider", values),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.all });
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.detail(vars.id) });
    },
  });
}

export function useUpsertProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ProviderProductFormValues) => {
      const payload: Record<string, unknown> = {
        provider_id:         values.provider_id,
        provider_product_id: values.provider_product_id,
        provider_offer_id:   values.provider_offer_id || null,
        plan_key:            values.plan_key,
        billing_cycle:       values.billing_cycle,
        duration_value:      values.duration_value,
        duration_unit:       values.duration_unit,
        amount:              values.amount,
        currency:            values.currency,
        is_subscription:     values.is_subscription,
        is_enabled:          values.is_enabled,
        display_name:        values.display_name || null,
        description:         values.description || null,
      };
      if (values.id && values.id !== "") payload.id = values.id;
      return callAdmin("upsert_product", payload);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.products(vars.provider_id) });
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.summary() });
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.list() });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; provider_id: string }) =>
      callAdmin("delete_product", { id }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.products(vars.provider_id) });
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.summary() });
      void qc.invalidateQueries({ queryKey: adminProvidersKeys.list() });
    },
  });
}
