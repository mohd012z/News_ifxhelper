import assert from "node:assert/strict";
import worker from "../worker/index.mjs";

const originalFetch = globalThis.fetch;
const calls = [];

// Deterministic fetch stub (no real network). The raw origin 5xxs on
// news-auto.js so the jsDelivr fallback path is exercised on every run.
const trackingFetch = async (input) => {
  const url = String(input);
  calls.push(url);

  if (url === "https://nfs.faireconomy.media/ff_calendar_thisweek.json") {
    return new Response(JSON.stringify([
      { date: "2026-10-09T12:30:00Z", country: "USD", title: "Example Event", impact: "High", actual: "", forecast: "1", previous: "2" }
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (url.includes("/app.js?cf_refresh=")) {
    return new Response("console.log('fresh app')", { status: 200, headers: { "Content-Type": "text/plain", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "Content-Encoding": "gzip" } });
  }
  if (url.includes("/pwa.js?cf_refresh=")) {
    return new Response("console.log('fresh pwa')", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("/data-manifest.json?cf_refresh=")) {
    return new Response('{"schemaVersion":3}', { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("/index.html?cf_refresh=")) {
    return new Response("<!doctype html><title>XAU Desk</title>", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("missing.js")) {
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("/route-without-extension")) {
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("cdn.jsdelivr.net/gh/mohd012z/News_ifxhelper@main/news-auto.js")) {
    return new Response('{"generatedAt":"2026-11-08 05:58:38Z","via":"jsdelivr-fallback"}', { status: 200, headers: { "Content-Type": "application/javascript" } });
  }
  if (url.includes("candles-auto.json")) {
    // Snapshot (primary /api/candles path) is served by default in this stub
    // so tests cover the Dukascopy branch; the yahoo branch is still exercised
    // by the dedicated snapshot-missing test below.
    if (!globalThis.__candlesSnapshotMissing) {
      return new Response(JSON.stringify({
        generatedAt: "2026-11-08T06:00:00.000Z",
        source: "dukascopy xauusd (bid, spot)",
        bars: {
          H4: [
            { t: 1762502400000, o: 4000, h: 4010, l: 3995, c: 4005 },
            { t: 1762516800000, o: 4005, h: 4035, l: 4000, c: 4012 }
          ],
          H1: [{ t: 1762502400000, o: 4000, h: 4010, l: 3995, c: 4005 }]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }
  if (url.includes("query1.finance.yahoo.com/v8/finance/chart/GC=F")) {
    // 4 x 1h bars in the same UTC 4h bucket (00,01,02,03h) + one earlier bar.
    // Aggregated to H4 the first five bars must collapse to two 4h bars.
    const base = 1762502400; // a fixed epoch hour, divisible by 3600
    const mk = (o, h, l, c) => ({ o, h, l, c });
    const rows = [
      mk(4000, 4010, 3995, 4005), // t=base-3600 (previous 4h bucket)
      mk(4005, 4020, 4000, 4015), // t=base      (new 4h bucket opens)
      mk(4015, 4030, 4010, 4025), // t=base+3600
      mk(4025, 4035, 4018, 4020), // t=base+7200
      mk(4020, 4028, 4008, 4012)  // t=base+10800
    ];
    return new Response(JSON.stringify({
      chart: { result: [{
        meta: { regularMarketPrice: 4012 },
        timestamp: [base - 3600, base, base + 3600, base + 7200, base + 10800],
        indicators: { quote: [{ open: rows.map(r => r.o), high: rows.map(r => r.h), low: rows.map(r => r.l), close: rows.map(r => r.c) }] }
      }]}
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/news-auto.js?cf_refresh=")) {
    return new Response("raw origin unavailable", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("not found", { status: 404 });
};

// FF-down variant: ForexFactory 429s; the repo news-auto.js carries a
// calendarAll the worker must fall back to.
const ffDownFetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url === "https://nfs.faireconomy.media/ff_calendar_thisweek.json") {
    return new Response("rate limited", { status: 429 });
  }
  if (url.includes("/news-auto.js?cf_refresh=")) {
    return new Response('window.NEWS_AUTO = {"generatedAt":"2026-11-08","calendarAll":[{"date":"2026-11-08","event":"[USD] Test Event"}]};\nfunction after(){}\n', { status: 200, headers: { "Content-Type": "text/javascript" } });
  }
  return trackingFetch(input);
};

globalThis.fetch = trackingFetch;

try {
  let r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/app.js"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/javascript/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  assert.equal(await r.text(), "console.log('fresh app')");
  assert.match(r.headers.get("x-ifxhelper-worker-version") || "", /^\d{4}-\d{2}-\d{2}-(live-proxy|candles|fullview|advisor)-v\d+$/);
  // GitHub raw's CSP (default-src 'none') must NOT leak through: it blocks
  // every external <script> and renders the dashboard empty.
  assert.equal(r.headers.get("content-security-policy"), null, "upstream CSP must be stripped");
  assert.equal(r.headers.get("content-encoding"), null, "upstream content-encoding must be stripped (body already decoded)");

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/data-manifest.json"));
  assert.match(r.headers.get("content-type") || "", /application\/json/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/pwa.js"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/javascript/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);

  // raw.githubusercontent 5xx -> worker must fall back to the jsDelivr mirror
  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/news-auto.js"));
  assert.equal(r.status, 200, "jsDelivr fallback must rescue a 5xx raw origin");
  assert.match(await r.text(), /jsdelivr-fallback/);
  assert(calls.some((u) => u.includes("cdn.jsdelivr.net/gh/mohd012z/News_ifxhelper@main/news-auto.js")), "fallback URL must be requested");

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/ff-calendar"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/json/);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const live = await r.json();
  assert.equal(live.events.length, 1);
  assert.equal(live.events[0].title, "Example Event");

  // ForexFactory down (429) -> worker falls back to repo news-auto.js calendarAll
  globalThis.fetch = ffDownFetch;
  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/ff-calendar"));
  assert.equal(r.status, 200, "FF 429 must be rescued by the repo calendar fallback");
  const fb = await r.json();
  assert.match(fb.source, /ForexFactory fallback/);
  assert.equal(fb.events.length, 1);
  assert.equal(fb.events[0].event, "[USD] Test Event");
  assert.equal(fb.upstreamStatus, 429);
  globalThis.fetch = trackingFetch;

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/missing.js"));
  assert.equal(r.status, 404, "missing asset must stay 404 instead of receiving index.html");
  assert.doesNotMatch(await r.text(), /doctype html/i);

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/route-without-extension"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/html/);

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/health"));
  const health = await r.json();
  assert.equal(health.ok, true);
  assert.equal(health.service, "ifxhelper-news-worker");
  assert.match(String(health.workerVersion), /^\d{4}-\d{2}-\d{2}-(live-proxy|candles|fullview|advisor)-v\d+$/);
  assert.equal(health.sourceMode, "github-main-live-proxy");

  // /api/candles: real OHLC history (primary = Dukascopy snapshot).
  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/candles?tf=H4"));
  assert.equal(r.status, 200, "candles H4 must be 200");
  const cd = await r.json();
  assert.equal(cd.ok, true);
  assert.equal(cd.tf, "H4");
  assert.match(cd.source, /dukascopy/i, "snapshot path must be labelled dukascopy");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(cd.bars.length, 2);
  assert.equal(cd.bars[0].o, 4000);
  assert.equal(cd.bars[1].c, 4012);

  // snapshot missing -> Yahoo fallback (5 raw 1h bars pass through as H1)
  globalThis.__candlesSnapshotMissing = true;
  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/candles?tf=H1"));
  const cd1 = await r.json();
  assert.equal(cd1.ok, true, "yahoo fallback must rescue a missing snapshot");
  assert.match(cd1.source, /yahoo/i);
  assert.equal(cd1.bars.length, 5);
  globalThis.__candlesSnapshotMissing = false;

  // unknown tf -> 400
  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/candles?tf=XX"));
  assert.equal(r.status, 400);

  assert(calls.some((u) => u.includes("raw.githubusercontent.com/mohd012z/News_ifxhelper/main/app.js?cf_refresh=")), "volatile upstream URL must be cache-busted");
  console.log("Cloudflare Worker proxy tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
