import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Guard: only set loading=false once, on the first auth event (INITIAL_SESSION)
  const initializedRef = useRef(false);

  useEffect(() => {
    // Single source of truth: onAuthStateChange handles INITIAL_SESSION on
    // every tab open/refresh, plus SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED.
    //
    // DO NOT call getSession() separately here.
    // Calling both creates a race condition where INITIAL_SESSION can fire
    // with a transiently null session (Supabase client mid-initialization),
    // setting loading=false before getSession() resolves — causing protected
    // routes to redirect to /login before the real session is known.
    //
    // Supabase JS v2 guarantees INITIAL_SESSION is the first event and
    // carries the correct session from localStorage. It is the canonical
    // way to hydrate auth state on app boot and on new tab open.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);

        // Set loading=false exactly once, on the first auth event.
        // INITIAL_SESSION is always first, so this resolves the loading
        // state with the definitive auth truth on every page load.
        if (!initializedRef.current) {
          initializedRef.current = true;
          setLoading(false);
        }

        // For subsequent events after initialization, keep loading=false.
        // TOKEN_REFRESHED, SIGNED_IN, SIGNED_OUT all update session in place.
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
