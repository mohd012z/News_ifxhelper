/* Service worker for XAU//DESK.
 * App shell is cached so the app opens offline; live-data endpoints are always network-only.
 * Note: service workers only run on http(s) origins - opening index.html from file:// skips this file.
 *
 * CACHE is bumped on every deploy that changes the app shell so clients drop
 * any previously cached (possibly broken) bundle and re-fetch from the network.
 * v8: 2026-11-08 - Charts-tab fullview (bbma-fullview.js) added; stale-client
 *       re-claim. BBMA dashboard JS + candles snapshot marked volatile.
 * v15: 2026-11-12 - fullview layout (bigger chart, 2-row toolbar,
 *       Fit view), pan/zoom no longer culls the SMC/EW overlay (spread anchors).
 * v16: 2026-11-12 - EW fibo PREDICTION WAVE (nextWave: W5/ABC/C endpoint +
 *       structural stop), default ON with a Predict toggle; EW on by default in
 *       the BBMA Oma template; per-TF default zoom (W1/MN1 density fix);
 *       pan/zoom keeps SMC+EW overlay (spread anchors); bigger chart + realigned
 *       two-row toolbar.
 * v14: 2026-11-12 - Elliott Wave v2.9 read-only overlay (lib/elliott-wave.js) +
 *       BBMA EW enhancer (lib/bbma-ew-enhance.js); both marked volatile; cache bump.
 */
const CACHE = "xaudesk-v16";
const VOLATILE = new Set([
  "/",
  "/index.html",
  "/pwa.js",
  "/app.js",
  "/news-auto.js",
  "/data-manifest.json",
  "/xauusd-data.js",
  "/macro-auto.js",
  "/atr.js",
  "/sw.js",
  "/bbma-fullview.js",
  "/bbma-camarilla-ui.js",
  "/pivots.js",
  "/lib/bbma-supply-demand.js",
  "/lib/bbma-indicators.js",
  "/lib/bbma-smc.js",
  "/lib/elliott-wave.js",
  "/candles-auto.json",
  "/bbma-runtime.js",
  "/bbma-chart-lwc.js",
  "/bbma-dashboard-ui.js",
  "/lib/bbma-news-symbol-advisor.js",
  "/bbma-news-symbol-advisor-ui.js",
  "/bbma-router-fix.js",
  "/bbma-link.js"
]);

function contentTypeMismatch(url, res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (/\.js$/.test(url.pathname)) return !ct.includes("javascript");
  if (/\.json$/.test(url.pathname)) return !ct.includes("json");
  return false;
}

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

  const isVolatile = VOLATILE.has(url.pathname);
  const request = isVolatile ? new Request(e.request, { cache: "no-store" }) : e.request;

  // Network-first. For JS/JSON, reject an HTML SPA fallback instead of executing/parsing it.
  e.respondWith(
    fetch(request).then((res) => {
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "network"));
      if (contentTypeMismatch(url, res)) throw new Error("content-type mismatch for " + url.pathname);
      caches.open(CACHE).then((cache) => cache.put(e.request, res.clone())).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => {
      if (hit && !contentTypeMismatch(url, hit)) return hit;
      // Only navigation/document requests may fall back to index.html. Never return HTML for JS/JSON.
      if (e.request.mode === "navigate" || e.request.destination === "document") {
        return caches.match("./index.html").then((h) => h || fetch(e.request));
      }
      return new Response("Offline asset unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })).catch((err) => {
      // Last resort: a fetch handler that REJECTS turns the whole navigate into
      // ERR_FAILED on the page. Never let that happen - return a response so the
      // page always loads (re-fetch network if cache missed too).
      console.warn("SW fetch failed, using last-resort response", err);
      return new Response("Service worker recovery: reloading from network", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    })
  );
});
