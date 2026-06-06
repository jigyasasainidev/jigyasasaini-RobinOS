// ============================================================
// useAdmin2FA — 2FA session state management
// ============================================================
// Stores the verified 2FA session token in sessionStorage.
// sessionStorage is:
//   - Cleared when the tab/browser closes (unlike localStorage)
//   - Isolated per tab (prevents cross-tab session sharing)
//   - Not accessible from other origins (same-origin policy)
//
// Session TTL: 1 hour (security policy — admin must re-verify hourly)
// The token itself is HMAC-SHA256 signed by the backend.
// We validate expiry client-side for UX (redirect before API call),
// but the backend re-validates on every sensitive operation.
// ============================================================

import { useCallback } from "react";

const SESSION_KEY  = "robinos_admin_2fa_session";
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface Admin2FASession {
  session_token: string;
  expires_at:    string;
}

export function useAdmin2FA() {
  // Store verified session — always set expires_at to now + 1 hour
  // regardless of what the backend returns (backend may have longer TTL)
  const setVerified = useCallback((session: Admin2FASession) => {
    try {
      const enforced: Admin2FASession = {
        session_token: session.session_token,
        // Enforce 1-hour client-side expiry
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(enforced));
    } catch { /* quota */ }
  }, []);

  // Clear session (logout / auto-expire)
  const clearVerified = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  // Check if session is valid and not expired
  const isVerified = useCallback((): boolean => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session: Admin2FASession = JSON.parse(raw);
      if (!session?.session_token || !session?.expires_at) return false;
      return new Date(session.expires_at) > new Date();
    } catch {
      return false;
    }
  }, []);

  // Get ms remaining until session expires (0 if expired/missing)
  const getExpiresInMs = useCallback((): number => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return 0;
      const session: Admin2FASession = JSON.parse(raw);
      if (!session?.expires_at) return 0;
      return Math.max(0, new Date(session.expires_at).getTime() - Date.now());
    } catch {
      return 0;
    }
  }, []);

  // Get the raw token for API calls
  const getToken = useCallback((): string | null => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session: Admin2FASession = JSON.parse(raw);
      if (new Date(session.expires_at) <= new Date()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session.session_token;
    } catch {
      return null;
    }
  }, []);

  return { setVerified, clearVerified, isVerified, getToken, getExpiresInMs };
}
