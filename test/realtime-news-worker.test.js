'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const pwa = fs.readFileSync(path.join(root, 'pwa.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'worker', 'index.mjs'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
const deploy = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-worker.yml'), 'utf8');

assert(app.includes('LIVE_CALENDAR_URLS = ['), 'live calendar source chain missing');
assert(app.includes('https://gentle-violet-4a79.ifxhelper.workers.dev/api/ff-calendar'), 'live Worker calendar endpoint missing');
assert(app.includes('https://nfs.faireconomy.media/ff_calendar_thisweek.json'), 'direct structured-feed fallback missing');
assert(app.includes('setInterval(fetchLiveCalendar, 60000)'), 'live calendar must refresh every 60 seconds');
assert(app.includes('syncProfileVersion: 2'), 'sync profile migration marker missing');
assert(app.includes('remoteMin: "5"'), 'durable remote sync default must be five minutes');
assert(app.includes('fetchLiveCalendarSource(index + 1, errors)'), 'live calendar must fail over to the next source');
assert(app.includes('LIVE_CALENDAR_SOURCE_TIMEOUT_MS = 2500'), 'each live calendar source must have a bounded timeout');
assert(app.includes('Promise.race([request, timeout])'), 'live source timeout must race the network request');
assert(app.includes('controller.abort()'), 'timed-out live source should be aborted when AbortController is available');
assert(app.includes('visibilitychange'), 'live calendar must refresh when app becomes visible');
assert(app.includes('window.addEventListener("focus", fetchLiveCalendar)'), 'live calendar must refresh on focus');
assert(app.includes('sourceClass: "LIVE_CALENDAR_PROXY"'), 'live rows must be labeled by source class');
assert(app.includes('liveGeneratedAt'), 'UI freshness must include live update timestamp');
assert(!app.includes('var today = (T.alerts || {}).today || [];'), 'assistant today alerts must not read the legacy static alert table');
assert(app.includes('var today = calendarAlertRows("today");'), 'assistant today alerts must read the live calendar');
assert(app.includes('function hardRefreshShell()'), 'Reload must use the stale-shell recovery path');
assert(app.includes('searchParams.set("_fresh"'), 'hard refresh must add a cache-busting query');
assert(app.includes('navigator.serviceWorker.getRegistration()'), 'hard refresh must ask the service worker to update before navigation');

assert(sw.includes('const CACHE = "xaudesk-v6"'), 'service-worker cache version must be v6');
assert(sw.includes('"/index.html"') && sw.includes('"/pwa.js"'), 'service worker must network-first the HTML/PWA bootstrap');
assert(pwa.includes('register("./sw.js?v=6", { updateViaCache: "none" })'), 'PWA must bypass stale HTTP cache when checking the service worker');
assert(pwa.includes('reg.update()'), 'PWA must actively check for a newer service worker');
assert(pwa.includes('controllerchange'), 'PWA must react when a newer worker takes control');
assert(sw.includes('contentTypeMismatch'), 'service worker must reject HTML returned for JS/JSON');
assert(sw.includes('Offline asset unavailable'), 'service worker must not use index.html as an asset fallback');

assert(worker.includes('/api/ff-calendar'), 'Worker live calendar route missing');
assert(worker.includes('raw.githubusercontent.com/mohd012z/News_ifxhelper/main/'), 'Worker must proxy current main assets');
assert(worker.includes('no-store, no-cache, must-revalidate'), 'volatile Worker assets must disable stale caching');
assert(worker.includes('"pwa.js"'), 'Worker must treat pwa.js as volatile');

assert(wrangler.includes('name = "gentle-violet-4a79"'), 'Wrangler worker name must target the existing Worker');
assert(deploy.includes('CLOUDFLARE_API_TOKEN'), 'Cloudflare token secret hook missing');
assert(deploy.includes('CLOUDFLARE_ACCOUNT_ID'), 'Cloudflare account secret hook missing');
assert(deploy.includes('/api/health'), 'post-deploy health verification missing');
assert(!/^\s{2}push:/m.test(deploy), 'Worker deploy must stay manual until Cloudflare Actions credentials are configured');
assert(deploy.includes('workflow_dispatch: {}'), 'Worker deploy must remain manually runnable once credentials are added');

console.log('Realtime news Worker contract tests passed');
