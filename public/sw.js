// Stub service worker — install prompt + app-shell claim only.
// No offline support (good Swiss mobile coverage — confirmed in PRD NFR Data Compliance section).
// Full caching strategy deferred until PWA story in Epic 8.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  /* pass-through */
});
