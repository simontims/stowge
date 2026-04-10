/* Minimal service worker: activates immediately and avoids app-level caching. */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op for now to avoid stale data/cache bugs.
});
