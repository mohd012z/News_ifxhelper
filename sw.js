/* Service worker for XAU//DESK.
 * App shell is cached so the app opens offline; live-data endpoints are always network-only.
 * Note: service workers only run on http(s) origins - opening index.html from file:// skips this file.
 */
const CACHE = "xaudesk-v4";
const SHELL = [
  "./",
  "./index.html",
  "./trade-plan.html",
  "./app.js",
  "./trade-plan.js",
  "./live.js",
  "./shared-market-logic.js",
  "./xauusd-data.js",
  "./atr.js",
  "./news-auto.js",
  "./macro-auto.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache live market data - always hit the network.
  if (url.hostname.indexOf("coinbase.com") > -1 || url.hostname.indexOf("yahoo.com") > -1 || url.hostname.indexOf("binance.com") > -1) {
    e.respondWith(fetch(e.request).catch(() => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network-first so the bundled data can never be served stale; cache is the offline fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
