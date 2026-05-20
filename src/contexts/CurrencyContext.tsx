import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import type { Currency } from "@/lib/pricing";
import { db } from "@/lib/cloudDb";
import { useAuth } from "@/contexts/AuthContext";

interface CurrencyContextType {
  currency: Currency;
  country: string;
  loading: boolean;
  setCurrencyOverride: (c: Currency) => void;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: "USD",
  country: "",
  loading: false,
  setCurrencyOverride: () => {},
});

export const useCurrencyContext = () => useContext(CurrencyContext);

const CACHE_KEY = "robinos_currency";
const COUNTRY_KEY = "robinos_country";

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currency, setCurrency] = useState<Currency>("USD");
  const [country, setCountry] = useState("Global");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ currency: "USD", country: "Global", timestamp: Date.now() }));
      localStorage.setItem(COUNTRY_KEY, "Global");
    } catch {
      // ignore cache errors
    } finally {
      setCurrency("USD");
      setCountry("Global");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    db.from("profiles").update({ country, currency } as any).eq("user_id", user.id).then(() => {});
  }, [user, country, currency]);

  const setCurrencyOverride = useCallback((_c: Currency) => {
    setCurrency("USD");
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ currency: "USD", country, timestamp: Date.now() }));
    } catch {
      // ignore
    }
    if (user) {
      db.from("profiles").update({ currency: "USD" } as any).eq("user_id", user.id).then(() => {});
    }
  }, [country, user]);

  return (
    <CurrencyContext.Provider value={{ currency, country, loading, setCurrencyOverride }}>
      {children}
    </CurrencyContext.Provider>
  );
}
