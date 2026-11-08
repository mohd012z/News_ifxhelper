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

  if (url.includes("/app.js?cf_refresh=")) {
    return new Response("console.log('fresh app')", { status: 200, headers: { "Content-Type": "text/plain" } });
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
  if (url.startsWith("https://api.telegram.org/")) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

try {
  let r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/app.js"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/javascript/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  assert.equal(await r.text(), "console.log('fresh app')");
  assert.equal(r.headers.get("x-ifxhelper-worker-version"), "2026-11-06-telegram-relay-v3");

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/data-manifest.json"));
  assert.match(r.headers.get("content-type") || "", /application\/json/);
  assert.match(r.headers.get("cache-control") || "", /no-store/);

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/pwa.js"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /application\/javascript/);
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
  assert.equal(health.workerVersion, "2026-11-06-telegram-relay-v3");
  assert.equal(health.sourceMode, "github-main-live-proxy");

  // ---- Telegram send relay (POST /api/telegram/:method) ----
  const relayEnv = { RELAY_KEY: "test-relay-key", TELEGRAM_BOT_TOKEN: "123:TEST", CHAT_IDS: "30006405" };
  const relayBase = "https://gentle-violet-4a79.ifxhelper.workers.dev/api/telegram/sendMessage";
  const relayBody = { chat_id: "30006405", text: "relay test" };

  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(relayBody) }), {});
  assert.equal(r.status, 503, "relay must report unconfigured (no env), not crash");

  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "wrong" }, body: JSON.stringify(relayBody) }), relayEnv);
  assert.equal(r.status, 401, "relay must reject a bad key");

  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify({ chat_id: "99999", text: "nope" }) }), relayEnv);
  assert.equal(r.status, 403, "relay must reject a chat outside CHAT_IDS");

  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify(relayBody) }), relayEnv);
  assert.equal(r.status, 200, "relay must forward to api.telegram.org on valid key+chat");
  const relayJson = await r.json();
  assert.equal(relayJson.ok, true);
  assert(calls.some((u) => u.startsWith("https://api.telegram.org/bot123:TEST/sendMessage")), "relay must target the worker's own bot token");

  for (const badMethod of ["getMe", "deleteWebhook"]) {
    r = await worker.fetch(new Request(relayBase.replace("sendMessage", badMethod), { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify(relayBody) }), relayEnv);
    assert.equal(r.status, 400, "relay must reject non-send methods");
  }
  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify(relayBody) }), { ...relayEnv, CHAT_IDS: "" });
  assert.equal(r.status, 503, "empty chat allowlist must fail closed");
  r = await worker.fetch(new Request(relayBase, { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify({ text: "missing destination" }) }), relayEnv);
  assert.equal(r.status, 403, "missing destination must fail closed");

  const photoReq = new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/telegram/sendPhoto", { method: "POST", headers: { "Content-Type": "application/json", "x-ifx-relay-key": "test-relay-key" }, body: JSON.stringify({ chat_id: "30006405", photo: "https://quickchart.io/x" }) });
  r = await worker.fetch(photoReq, relayEnv);
  assert.equal(r.status, 200);
  assert(calls.some((u) => u.startsWith("https://api.telegram.org/bot123:TEST/sendPhoto")), "relay must support sendPhoto too");

  r = await worker.fetch(new Request("https://gentle-violet-4a79.ifxhelper.workers.dev/api/health"), relayEnv);
  const health2 = await r.json();
  assert.equal(health2.relayConfigured, true, "health must expose relayConfigured");

  assert(calls.some((u) => u.includes("raw.githubusercontent.com/mohd012z/News_ifxhelper/main/app.js?cf_refresh=")), "volatile upstream URL must be cache-busted");
  console.log("Cloudflare Worker proxy tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
