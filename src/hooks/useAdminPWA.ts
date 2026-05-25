// ============================================================
// useAdminPWA — PWA install prompt + SW registration
// ============================================================
// Manages:
//   1. Service worker registration (admin SW at /sw.js)
//   2. beforeinstallprompt capture for custom install UI
//   3. Install state persistence (localStorage)
//   4. iOS detection for manual install instructions
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
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
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

        // Check for updates every 60 minutes
        const interval = setInterval(() => reg.update(), 60 * 60 * 1000);
        return () => clearInterval(interval);
      } catch (err) {
        console.warn("[AdminPWA] SW registration failed:", err);
      }
    };

    void register();
  }, []);

  // ── Detect install state ───────────────────────────────
  useEffect(() => {
    // Already running as installed PWA
    if (isInStandaloneMode()) {
      setInstallState("installed");
      return;
    }

    // Previously installed (user dismissed or installed)
    if (localStorage.getItem(INSTALLED_KEY) === "true") {
      setInstallState("installed");
      return;
    }

    // iOS — no beforeinstallprompt, show manual instructions
    if (isIOS()) {
      setInstallState("ios");
      return;
    }

    // Listen for Chrome/Edge/Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setInstallState("available");
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Listen for successful install
    const installedHandler = () => {
      setInstallState("installed");
      localStorage.setItem(INSTALLED_KEY, "true");
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  // ── Trigger install prompt ─────────────────────────────
  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    setInstallState("installing");
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setInstallState("installed");
        localStorage.setItem(INSTALLED_KEY, "true");
      } else {
        setInstallState("available");
      }
    } catch {
      setInstallState("available");
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  // ── Dismiss (don't show again this session) ────────────
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
