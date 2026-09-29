'use strict';
/* build-alert-history.js
 * Turns the committed Telegram delivery state (.news-alert-state.json) into
 * NEWS_AUTO.alertHistory in news-auto.js — the REAL alert history the dashboard
 * renders (previously the panel read d.alertHistory, which nothing ever set).
 *
 * Honesty contract:
 *  - state.history entries carry generatedAt (recorded at confirmed delivery by
 *    telegram-notify.js / send-bbma-telegram.js) -> shown with that time.
 *  - legacy sentKeys (pre-history era) carry NO timestamp -> they are folded in
 *    as "recorded, time unknown" (never back-dated or invented), newest by
 *    date parsed from the key when present, else listed without a date.
 *  - dedupe by key; capped at 300 entries (newest first by timestamp, then key
 *    order) to keep the bundled file small.
 *
 * Re-serialises news-auto.js in place (build-news.js output + alertHistory),
 * so data-manifest.json checksums stay valid when the workflow commits it.
 * Idempotent: safe to run repeatedly; only writes when the file changes. */
const fs = require('fs'), path = require('path');
const STATE = path.join(__dirname, '.news-alert-state.json');
const OUT = path.join(__dirname, 'news-auto.js');
const CAP = 300;

function typeOf(key) {
  const t = String(key).split(':')[0] || 'ALERT';
  return { evt: 'EVENT', remind: 'REMINDER', followup: 'RESULT_CHECK', news: 'NEWS', spk: 'SPEAKER', result: 'PRICE_TRACK', bbma: 'BBMA_BOX' }[t] || t.toUpperCase();
}
/* Key shapes (from telegram-notify.js):
 *   evt:NAME|YYYY-MM-DD        remind:NAME|YYYY-MM-DD:STAGE
 *   followup:NAME|YYYY-MM-DD   news:HEADLINE   spk:NAME|YYYY-MM-DD   result:KEY
 *   bbma:generationId|SIGNAL   (channel box posts) */
function titleOf(key) {
  const s = String(key);
  const type = s.split(':')[0] || '';
  const rest = s.slice(s.indexOf(':') + 1);
  const parts = rest.split('|');
  let title = '';
  if (type === 'evt' || type === 'followup') title = parts[0] || parts[1] || '';
  else if (type === 'remind') title = parts[0] || '';
  else if (type === 'spk') title = parts[0] || '';
  else title = parts[1] || parts[0] || rest;
  return title.replace(/^\[?[A-Z]{1,3}\]\s*/, '').slice(0, 120) || s.slice(0, 120);
}
/* Some legacy keys embed a date ('evt:[CAD] CPI m/m|2026-09-14' or 'evt:FOMC rate decision|16 Sep').
 * Parse conservatively; return null when unsure — we never invent times. */
function dateFromKey(key) {
  const m = String(key).match(/\|(\d{4}-\d{2}-\d{2})\b/);
  if (m) {
    const t = Date.parse(m[1] + 'T00:00:00Z');
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}
function buildHistory(state) {
  const byKey = new Map();
  // 1) structured history (has real delivery timestamps) — wins over legacy.
  for (const h of (state.history || [])) {
    if (!h || !h.key) continue;
    byKey.set(h.key, {
      key: h.key,
      type: h.type || typeOf(h.key),
      title: h.title || titleOf(h.key),
      timeMYT: h.generatedAt ? new Date(new Date(h.generatedAt).getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ') + ' MYT' : '—',
      at: h.generatedAt || null,
      legacy: false
    });
  }
  // 2) box posts (BBMA channel box history recorded by send-bbma-telegram.js).
  for (const h of (state.boxHistory || [])) {
    if (!h || !h.key) continue;
    byKey.set(h.key, {
      key: h.key,
      type: h.type || 'BBMA_BOX',
      title: h.title || h.key,
      timeMYT: h.generatedAt ? new Date(new Date(h.generatedAt).getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ') + ' MYT' : '—',
      at: h.generatedAt || null,
      legacy: false
    });
  }
  // 3) legacy sentKeys: confirmed-sent but un-timestamped.
  for (const key of (state.sentKeys || [])) {
    if (byKey.has(key)) continue;
    const at = dateFromKey(key);
    byKey.set(key, { key, type: typeOf(key), title: titleOf(key), timeMYT: at ? new Date(new Date(at).getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ') + ' MYT' : 'recorded', at, legacy: !at });
  }
  return [...byKey.values()]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, CAP);
}
function main() {
  const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return { sentKeys: [] }; } })();
  const history = buildHistory(state);
  let body = fs.readFileSync(OUT, 'utf8');
  const start = body.indexOf('window.NEWS_AUTO = ');
  if (start === -1) { console.error('news-auto.js: cannot locate window.NEWS_AUTO assignment — run build-news.js first'); process.exit(1); }
  const jsonStart = body.indexOf('{', start);
  if (jsonStart === -1) { console.error('news-auto.js: cannot locate NEWS_AUTO object start'); process.exit(1); }
  // brace-scan to the object's closing '}' (handles strings containing braces)
  let depth = 0, inStr = false, esc = false, jsonEnd = -1;
  for (let i = jsonStart; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
  }
  if (jsonEnd === -1) { console.error('news-auto.js: unbalanced NEWS_AUTO object'); process.exit(1); }
  const data = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
  data.alertHistory = history;
  data.alertHistoryGeneratedAt = new Date().toISOString();
  const next = body.slice(0, jsonStart) + JSON.stringify(data, null, 2) + body.slice(jsonEnd + 1);
  if (next !== body) fs.writeFileSync(OUT, next, 'utf8');
  const tsd = history.filter(h => h.at).length;
  console.log(`alert-history: ${history.length} entries (${tsd} timestamped, ${history.length - tsd} legacy-unknown-time) -> news-auto.js`);
}
if (require.main === module) main();
module.exports = { buildHistory, typeOf, titleOf, dateFromKey, main };
