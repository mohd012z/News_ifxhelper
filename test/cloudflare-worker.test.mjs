import assert from "node:assert/strict";
import worker from "../worker/index.mjs";

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);

  if (url === "https://nfs.faireconomy.media/ff_calendar_thisweek.json") {
    return new Response(JSON.stringify([
      { date: "2026-10-09T12:30:00Z", country: "USD", title: "Example Event", impact: "High", actual: "", forecast: "1", previous: "2" }
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (url.endsWith("/app.js")) {
    return new Response("console.log('fresh app')", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.endsWith("/data-manifest.json")) {
    return new Response('{"schemaVersion":3}', { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.endsWith("/index.html")) {
    return new Response("<!doctype html><title>XAU Desk</title>", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("missing.js")) {
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  if (url.includes("/route-without-extension")) {
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("not found", { status: 404 });
};

try {
  let r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/app.js"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/javascript/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  assert.equal(await r.text(), "console.log('fresh app')");

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/data-manifest.json"));
  assert.match(r.headers.get("content-type") || "", /application\/json/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/ff-calendar"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/json/);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const live = await r.json();
  assert.equal(live.events.length, 1);
  assert.equal(live.events[0].title, "Example Event");

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

  assert(calls.some((u) => u.includes("raw.githubusercontent.com/mohd012z/News_ifxhelper/main/app.js")));
  console.log("Cloudflare Worker proxy tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
