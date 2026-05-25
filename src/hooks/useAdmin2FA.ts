// ============================================================
// useAdmin2FA — 2FA session state management
// ============================================================
// Stores the verified 2FA session token in sessionStorage.
// sessionStorage is:
//   - Cleared when the tab/browser closes (unlike localStorage)
//   - Isolated per tab (prevents cross-tab session sharing)
//   - Not accessible from other origins (same-origin policy)
//
// The token itself is HMAC-SHA256 signed by the backend.
// We validate expiry client-side for UX (redirect before API call),
// but the backend re-validates on every sensitive operation.
// ============================================================

import { useCallback } from "react";

const SESSION_KEY = "robinos_admin_2fa_session";

export interface Admin2FASession {
  session_token: string;
  expires_at:    string;
}

export function useAdmin2FA() {
  // Store verified session
  const setVerified = useCallback((session: Admin2FASession) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch { /* quota */ }
  }, []);

  // Clear session (logout / disable)
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
      // Client-side expiry check (backend re-validates independently)
      return new Date(session.expires_at) > new Date();
    } catch {
      return false;
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

  return { setVerified, clearVerified, isVerified, getToken };
}
