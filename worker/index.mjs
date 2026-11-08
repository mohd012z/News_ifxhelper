const RAW_BASE = "https://raw.githubusercontent.com/mohd012z/News_ifxhelper/main/";
const FF_WEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const WORKER_VERSION = "2026-11-08-candles-v3";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const VOLATILE = new Set([
  "index.html", "pwa.js", "app.js", "news-auto.js", "data-manifest.json",
  "xauusd-data.js", "macro-auto.js", "atr.js", "sw.js"
]);

function ext(path) {
  const m = /\.[A-Za-z0-9]+$/.exec(path);
  return m ? m[0].toLowerCase() : "";
}

function cleanPath(pathname) {
  let p = decodeURIComponent(pathname || "/").replace(/^\/+/, "");
  if (!p) return "index.html";
  if (p.includes("..") || p.includes("\\") || p.includes("\0")) return null;
  return p;
}

function headersFor(path, upstream) {
  // GitHub raw (and the jsDelivr mirror) stamp every object with
  //   content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
  // For an app that loads external <script> files, default-src 'none' (no
  // script-src) BLOCKS every external script -> the dashboard renders empty.
  // So never forward upstream CSP / encoding / GH-meta headers: the body is
  // already decoded by fetch(), and our own headers below are authoritative.
  const h = new Headers();
  for (const [k, v] of upstream.headers) {
    const lk = k.toLowerCase();
    if (lk === "content-security-policy" ||
        lk === "content-security-policy-report-only" ||
        lk === "content-encoding" ||
        lk === "content-length" ||
        lk === "etag" ||
        lk === "age" ||
        lk === "report-to" ||
        lk === "x-content-type-options") continue;
    h.set(k, v);
  }
  const type = MIME[ext(path)];
  if (type) h.set("Content-Type", type);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-IFXHelper-Worker-Version", WORKER_VERSION);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Vary", "Origin");
  if (VOLATILE.has(path) || path.startsWith("data/")) {
    h.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    h.set("Pragma", "no-cache");
    h.set("Expires", "0");
  } else {
    h.set("Cache-Control", "public, max-age=300, s-maxage=300");
  }
  return h;
}

async function fetchRaw(path) {
  const volatile = VOLATILE.has(path) || path.startsWith("data/");
  const refresh = volatile ? "?cf_refresh=" + Math.floor(Date.now() / 60000) : "";
  // Primary: raw.githubusercontent (fast, cache-busted for volatile files).
  const target = RAW_BASE + path.split("/").map(encodeURIComponent).join("/") + refresh;
  let upstream = await fetch(target, {
    cache: "no-store"
  });
  // 404 = genuinely missing -> keep it (the caller maps extensionless 404 to index.html).
  if (upstream.status !== 404 && !upstream.ok) {
    // 5xx (e.g. CF edge 1101 resolving raw.githubusercontent) or 429: fall back to
    // the jsDelivr GitHub mirror (Cloudflare-hosted, resilient to the same DNS issue).
    try {
      const fb = await fetch(
        "https://cdn.jsdelivr.net/gh/mohd012z/News_ifxhelper@main/" + path.split("/").map(encodeURIComponent).join("/") + refresh,
        { cache: "no-store" }
      );
      if (fb.ok) {
        upstream = fb;
      } else if (fb.status !== 404) {
        upstream = fb; // prefer the freshest upstream signal
      }
    } catch (e) { /* keep the primary upstream as best-effort */ }
  }
  return upstream;
}

// Extract window.NEWS_AUTO.calendarAll from a news-auto.js bundle via
// string-aware brace matching (the file has JS after the JSON object, so a
// naive /{[\s\S]*}$/ regex over-reaches). Returns the row array or null.
function extractCalendarAll(text) {
  const marker = "window.NEWS_AUTO = {";
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const start = text.indexOf("{", i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, q = "";
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; }
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const data = JSON.parse(text.slice(start, j + 1));
          return Array.isArray(data.calendarAll) ? data.calendarAll : null;
        } catch (e) { return null; }
      }
    }
  }
  return null;
}

async function liveCalendar() {
  const upstream = await fetch(FF_WEEK, {
    cache: "no-store"
  });
  if (!upstream.ok) {
    // ForexFactory flaky/down (429 rate-limit, 1101, 5xx): fall back to the repo's
    // freshly-generated calendar (news-auto.js calendarAll) so the route never 500s.
    try {
      const fb = await fetchRaw("news-auto.js");
      if (fb.ok) {
        const text = await fb.text();
        const rows = extractCalendarAll(text);
        if (rows) {
          return new Response(JSON.stringify({
            fetchedAt: new Date().toISOString(),
            source: "repo news-auto.js calendarAll (ForexFactory fallback)",
            upstreamStatus: upstream.status,
            events: rows
          }), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=10, s-maxage=20, stale-while-revalidate=10",
              "Access-Control-Allow-Origin": "*",
              "X-Content-Type-Options": "nosniff"
            }
          });
        }
      }
    } catch (e) { /* fall through to the 502 */ }
    return new Response(JSON.stringify({ error: "calendar upstream unavailable", status: upstream.status }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  const events = await upstream.json();
  return new Response(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: "ForexFactory current-week structured feed",
    events: Array.isArray(events) ? events : []
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=10, s-maxage=20, stale-while-revalidate=10",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// --- /api/candles: real OHLC history (keyless Yahoo GC=F, the COMEX gold
// futures that mirror XAU/USD spot) proxied server-side because Yahoo sends
// no Access-Control-Allow-Origin to browsers. The worker fetches, trims, and
// returns clean bar arrays for the 8 BBMA timeframes (H4/D1/W1/MN1 are
// aggregated from 1h bars server-side; Yahoo's 4h/1wk/1mo buckets are not
// aligned to the app's UTC day/week/month boundaries).
const TF_YAHOO = {
  M5: { interval: "5m", range: "1mo", baseMs: 300000, limit: 240 },
  M15: { interval: "15m", range: "3mo", baseMs: 900000, limit: 240 },
  M30: { interval: "30m", range: "3mo", baseMs: 1800000, limit: 240 },
  H1: { interval: "60m", range: "1y", baseMs: 3600000, limit: 240 },
  H4: { interval: "60m", range: "2y", baseMs: 14400000, limit: 240, aggregate: true },
  D1: { interval: "60m", range: "2y", baseMs: 86400000, limit: 240, aggregate: true },
  W1: { interval: "60m", range: "2y", baseMs: 604800000, limit: 240, aggregate: true },
  MN1: { interval: "1mo", range: "10y", baseMs: 2592000000, limit: 240 }
};

function aggregateBars(bars, baseMs, limit) {
  const out = [];
  for (const b of bars) {
    const bucket = Math.floor(b.t / baseMs) * baseMs;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      if (b.h > last.h) last.h = b.h;
      if (b.l < last.l) last.l = b.l;
      last.c = b.c;
    } else {
      out.push({ t: bucket, o: b.o, h: b.h, l: b.l, c: b.c });
    }
  }
  // The in-progress bucket is kept (the app's own live-tick merge completes it),
  // but everything older than the window is trimmed.
  return out.slice(-limit);
}

async function candlesRoute(url) {
  const tf = url.searchParams.get("tf") || "H1";
  const cfg = TF_YAHOO[tf];
  const jsonHead = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120"
  };
  if (!cfg) {
    return new Response(JSON.stringify({ error: "unknown tf", ok: false }), { status: 400, headers: jsonHead });
  }
  let upstream;
  try {
    upstream = await fetch(`${YAHOO_BASE}GC=F?interval=${cfg.interval}&range=${cfg.range}`, {
      cache: "no-store",
      headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "yahoo unreachable", ok: false }), { status: 502, headers: jsonHead });
  }
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "yahoo " + upstream.status, ok: false }), { status: 502, headers: jsonHead });
  }
  let doc;
  try { doc = await upstream.json(); } catch (e) {
    return new Response(JSON.stringify({ error: "yahoo bad json", ok: false }), { status: 502, headers: jsonHead });
  }
  const err = doc && doc.chart && doc.chart.error;
  if (err) {
    return new Response(JSON.stringify({ error: err.description || "yahoo error", ok: false }), { status: 502, headers: jsonHead });
  }
  const res = doc.chart && doc.chart.result && doc.chart.result[0];
  if (!res || !Array.isArray(res.timestamp)) {
    return new Response(JSON.stringify({ error: "no result", ok: false }), { status: 502, headers: jsonHead });
  }
  const q = res.indicators && res.indicators.quote && res.indicators.quote[0];
  if (!q) return new Response(JSON.stringify({ error: "no quote", ok: false }), { status: 502, headers: jsonHead });
  const raw = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    raw.push({ t: res.timestamp[i] * 1000, o: +o, h: +h, l: +l, c: +c });
  }
  const bars = cfg.aggregate ? aggregateBars(raw, cfg.baseMs, cfg.limit) : raw.slice(-cfg.limit);
  if (!bars.length) {
    return new Response(JSON.stringify({ error: "no bars", ok: false }), { status: 502, headers: jsonHead });
  }
  const last = bars[bars.length - 1];
  return new Response(JSON.stringify({
    ok: true,
    tf,
    symbol: "GC=F",
    label: "COMEX gold futures (XAU/USD proxy)",
    fetchedAt: new Date().toISOString(),
    lastPrice: res.meta ? res.meta.regularMarketPrice : last.c,
    lastBarTime: last.t,
    bars
  }), { status: 200, headers: jsonHead });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
    }

    if (url.pathname === "/api/ff-calendar") return liveCalendar();

    if (url.pathname === "/api/candles") return candlesRoute(url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "ifxhelper-news-worker",
        now: new Date().toISOString(),
        rawBase: RAW_BASE,
        workerVersion: WORKER_VERSION,
        sourceMode: "github-main-live-proxy"
      }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-IFXHelper-Worker-Version": WORKER_VERSION
        }
      });
    }

    const path = cleanPath(url.pathname);
    if (!path) return new Response("Bad Request", { status: 400 });

    let upstream = await fetchRaw(path);

    // SPA-style route fallback only for extensionless paths. Asset requests must never receive HTML.
    if (upstream.status === 404 && !ext(path)) {
      upstream = await fetchRaw("index.html");
      if (!upstream.ok) return new Response("Upstream unavailable", { status: 502 });
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: 200,
        headers: headersFor("index.html", upstream)
      });
    }

    if (!upstream.ok) {
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        headers: headersFor(path, upstream)
      });
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: headersFor(path, upstream)
    });
  }
};
