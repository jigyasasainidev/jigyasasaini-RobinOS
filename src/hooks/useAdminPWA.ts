// ============================================================
// useAdminPWA — PWA install prompt + SW registration
// ============================================================
// Key insight: Chrome fires `beforeinstallprompt` on page load,
// BEFORE React renders. We must capture it globally as early as
// possible. This module uses a module-level variable to store
// the deferred prompt so it survives React re-renders.
//
// Manifest swap: AdminRouteGuard injects admin-manifest.json via
// Helmet. On first visit Chrome may have already evaluated the
// default manifest.json. The DOM swap + SW registration together
// make the app installable on subsequent visits / page reloads.
// ============================================================

import { useCallback, useEffect, useState } from "react";

// BeforeInstallPromptEvent is not in standard TS lib
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

type InstallState = "idle" | "available" | "installing" | "installed" | "ios" | "unsupported";

const INSTALLED_KEY = "robinos_admin_pwa_installed";

// ── Module-level deferred prompt store ────────────────────
// Captured as early as possible — before React mounts.
// This survives component unmount/remount cycles.
let _deferredPrompt: BeforeInstallPromptEvent | null = null;
let _promptListeners: Array<() => void> = [];

function notifyListeners() {
  _promptListeners.forEach((fn) => fn());
}

// Attach the global listener immediately when this module loads.
// This runs before any React component mounts, ensuring we never
// miss the beforeinstallprompt event.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    _deferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    _deferredPrompt = null;
    localStorage.setItem(INSTALLED_KEY, "true");
    notifyListeners();
  });
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream
  );
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

export function useAdminPWA() {
  const [installState, setInstallState] = useState<InstallState>(() => {
    // Compute initial state synchronously
    if (isInStandaloneMode()) return "installed";
    if (localStorage.getItem(INSTALLED_KEY) === "true") return "installed";
    if (isIOS()) return "ios";
    if (_deferredPrompt) return "available";
    return "idle";
  });

  const [swRegistered, setSwRegistered] = useState(false);

  // ── Register service worker ────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        setSwRegistered(true);
        // Check for SW updates every 60 minutes
        const interval = setInterval(() => reg.update(), 60 * 60 * 1000);
        return () => clearInterval(interval);
      } catch (err) {
        console.warn("[AdminPWA] SW registration failed:", err);
      }
    };

    void register();
  }, []);

  // ── Subscribe to global prompt store changes ───────────
  useEffect(() => {
    // If already in a terminal state, no need to listen
    if (installState === "installed" || installState === "ios") return;

    const listener = () => {
      if (localStorage.getItem(INSTALLED_KEY) === "true" || isInStandaloneMode()) {
        setInstallState("installed");
      } else if (_deferredPrompt) {
        setInstallState("available");
      } else {
        setInstallState("idle");
      }
    };

    _promptListeners.push(listener);
    // Also check immediately in case prompt arrived between render and effect
    listener();

    return () => {
      _promptListeners = _promptListeners.filter((fn) => fn !== listener);
    };
  }, [installState]);

  // ── Swap manifest link in DOM immediately ──────────────
  // Helmet handles this declaratively, but we also do it imperatively
  // here so it happens as early as possible on mount.
  useEffect(() => {
    const existing = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (existing && existing.href !== `${window.location.origin}/admin-manifest.json`) {
      existing.href = "/admin-manifest.json";
    }
    return () => {
      // Restore original manifest when leaving admin area
      const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (link) link.href = "/manifest.json";
    };
  }, []);

  // ── Trigger install prompt ─────────────────────────────
  const triggerInstall = useCallback(async () => {
    if (!_deferredPrompt) return;

    setInstallState("installing");
    const prompt = _deferredPrompt;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;

      if (outcome === "accepted") {
        setInstallState("installed");
        localStorage.setItem(INSTALLED_KEY, "true");
        _deferredPrompt = null;
      } else {
        setInstallState("available");
      }
    } catch {
      setInstallState("available");
    }
  }, []);

  // ── Dismiss ────────────────────────────────────────────
  const dismissInstall = useCallback(() => {
    setInstallState("idle");
  }, []);

  return {
    installState,
    swRegistered,
    triggerInstall,
    dismissInstall,
    isInstalled: installState === "installed",
    isAvailable: installState === "available",
    isIOS:       installState === "ios",
  };
}
