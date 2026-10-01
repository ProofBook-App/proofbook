// Proofbook service worker. It caches the app shell's static files and nothing else: hashed
// build output under /assets/ (JS, CSS, fonts), the icons and the manifest. Page HTML, route
// data (*.data), /api/*, /og/*, the indexer and every RPC call always go to the network, because
// NAV and PnL must be live. Cross-origin requests are never touched.
// Registered from app/root.tsx after hydration, in production builds only.

// Bump the version when an icon or the manifest changes: those keep their names across builds.
const CACHE = "proofbook-shell-v1";
const SHELL = [
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

// Shown when a page is opened with no connection. Nothing in it comes from a cache.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#141a26"><title>Offline | Proofbook</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141a26;color:#f8f7f4;font:16px/1.6 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:32rem}h1{font:420 40px/1.05 Georgia,serif;margin:0 0 12px}p{color:#aab6cc;margin:0 0 24px}a{display:inline-flex;align-items:center;min-height:48px;padding:0 20px;border-radius:6px;background:#d8c27a;color:#1c1b18;text-decoration:none;font-weight:500}</style></head><body><main><h1>You're offline</h1><p>Proofbook shows live figures from the chain, so it needs a connection. Nothing here is cached.</p><a href="">Try again</a></main></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  // Vite fingerprints everything under /assets/, so a cached copy is never stale.
  return url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always the network. With no connection, a plain offline page instead of the browser's error.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    );
    return;
  }

  // Anything with a query string is data, not a file (route data, ?index, lazy route manifests).
  if (url.search || !isStatic(url)) return;

  // Static files: cache first, then the network, keeping a copy of good responses.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok && res.type === "basic") cache.put(request, res.clone());
      return res;
    }),
  );
});
