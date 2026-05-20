// Re-export from CurrencyContext for backward compatibility
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Currency } from "@/lib/pricing";

export function useCurrency(): { currency: Currency; loading: boolean } {
  const { currency, loading } = useCurrencyContext();
  return { currency, loading };
}
