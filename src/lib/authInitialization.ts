import { supabase } from "@/integrations/supabase/client";

type InitResult = {
  ok?: boolean;
  error?: string;
  code?: string;
};

function isSchemaCacheMismatch(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  return err?.code === "PGRST202";
}

export async function initializeUserAccount(referredBy?: string | null) {
  const referral = referredBy?.trim() ? referredBy.trim() : null;

  let response = await (supabase as any).rpc("initialize_user_account", {
    p_referred_by: referral,
  });

  if (isSchemaCacheMismatch(response.error)) {
    response = await (supabase as any).rpc("initialize_user_account");
  }

  const result = (response.data ?? null) as InitResult | null;

  if (response.error) {
    return {
      ok: false,
      error: response.error.message || "Unable to initialize account",
      code: response.error.code,
    } as const;
  }

  if (result && result.ok === false) {
    return {
      ok: false,
      error: result.error || "Unable to initialize account",
      code: result.code,
    } as const;
  }

  return {
    ok: true,
    data: result,
  } as const;
}