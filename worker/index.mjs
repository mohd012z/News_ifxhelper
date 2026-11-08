const RAW_BASE = "https://raw.githubusercontent.com/mohd012z/News_ifxhelper/main/";
const FF_WEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const WORKER_VERSION = "2026-10-09-live-proxy-v2";

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
  const h = new Headers(upstream.headers);
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
    cache: "no-store",
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  // 404 = genuinely missing -> keep it (the caller maps extensionless 404 to index.html).
  if (upstream.status !== 404 && !upstream.ok) {
    // 5xx (e.g. CF edge 1101 resolving raw.githubusercontent) or 429: fall back to
    // the jsDelivr GitHub mirror (Cloudflare-hosted, resilient to the same DNS issue).
    try {
      const fb = await fetch(
        "https://cdn.jsdelivr.net/gh/mohd012z/News_ifxhelper@main/" + path.split("/").map(encodeURIComponent).join("/") + refresh,
        { cache: "no-store", cf: { cacheTtl: 0, cacheEverything: false } }
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

async function liveCalendar() {
  const upstream = await fetch(FF_WEEK, {
    cache: "no-store",
    cf: { cacheTtl: 20, cacheEverything: true }
  });
  if (!upstream.ok) {
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
