// ============================================================
// RobinOS Admin Service Worker
// ============================================================
// Strategy:
//   - STATIC SHELL: Cache-first for app shell assets (JS/CSS/fonts/icons)
//   - API / SUPABASE: Network-only — NEVER cache auth or data responses
//   - ADMIN ROUTES: Network-first with offline fallback to shell
//
// Security:
//   - Supabase API calls are NEVER cached (auth tokens, user data)
//   - Edge function calls are NEVER cached
//   - Only static build artifacts are cached
// ============================================================

const CACHE_VERSION = "robinos-admin-v3";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;

// Static assets to pre-cache on install (app shell)
const SHELL_ASSETS = [
  "/",
  "/adminsh/dashboard",
  "/manifest.json",
  "/admin-manifest.json",
  "/robinos.ico",
  "/robinos-logo.png",
];

// Patterns that must NEVER be cached (auth, API, realtime)
const NEVER_CACHE_PATTERNS = [
  /supabase\.co/,
  /functions\/v1\//,
  /rest\/v1\//,
  /auth\/v1\//,
  /realtime\/v1\//,
  /storage\/v1\//,
  /googleapis\.com/,
  /qrserver\.com/,
];

function shouldNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(url));
}

function isStaticAsset(url) {
  return (
    url.includes("/assets/") ||
    url.match(/\.(js|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|webp|ico|gif)(\?|$)/)
  );
}

// ── Install: pre-cache shell ───────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ─────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("robinos-admin-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // NEVER cache: Supabase, auth, API, external services
  if (shouldNeverCache(url)) return;

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Admin navigation routes: network-first, fallback to shell
  if (url.includes("/adminsh/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful navigation responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          // Offline: serve cached shell so the SPA can boot
          caches.match("/adminsh/dashboard").then(
            (cached) => cached || caches.match("/")
          )
        )
    );
    return;
  }

  // Everything else: network-only (don't interfere)
});

// ── Push notifications foundation ─────────────────────────
// Architecture prepared for future payout/moderation alerts.
// Actual push subscription requires VAPID keys + backend setup.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "RobinOS Admin", body: event.data.text() };
  }

  const options = {
    body:    payload.body    ?? "New admin notification",
    icon:    payload.icon    ?? "/android-chrome-192x192.png",
    badge:   payload.badge   ?? "/robinos.ico?v=4",
    tag:     payload.tag     ?? "robinos-admin",
    data:    payload.data    ?? {},
    vibrate: [100, 50, 100],
    actions: payload.actions ?? [],
    requireInteraction: payload.requireInteraction ?? false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "RobinOS Admin", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? "/adminsh/dashboard";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing window if open
        for (const client of windowClients) {
          if (client.url.includes("/adminsh/") && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
