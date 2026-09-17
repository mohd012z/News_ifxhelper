/* telegram-notify.js - posts NEW high-signal items to a Telegram chat after build-atr.js /
 * build-news.js have run, so a scheduled GitHub Action can alert you the moment something
 * changes instead of you having to open the app.
 *
 * What it alerts on (kept deliberately narrow to avoid spamming every poll):
 *   - New high-importance calendar events (from D.incoming, xauusd-data.js + news-auto.js)
 *   - New auto-classified news/speaker rows with a real HAWKISH/DOVISH side (skips NEUTRAL)
 *
 * State: .news-alert-state.json holds the keys already sent, so re-runs only alert on genuinely
 * new items. This file is committed back to the repo by the workflow (see
 * .github/workflows/daily-refresh.yml) since GitHub Actions runners are ephemeral.
 *
 * Requires env vars (set as GitHub repo secrets, never hardcoded):
 *   TELEGRAM_BOT_TOKEN  - from @BotFather
 *   TELEGRAM_CHAT_ID    - your user id, group id, or channel id (@userinfobot can find yours)
 *
 * Run: node telegram-notify.js   (after build-atr.js and build-news.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.news-alert-state.json');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadJsModule(file, globalName) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return null;
  const sandbox = { window: {}, console };
  const code = fs.readFileSync(full, 'utf8');
  // xauusd-data.js / news-auto.js are plain `window.X = {...}` assignments - safe to eval in an isolated sandbox.
  new Function('window', 'console', code)(sandbox.window, console);
  return sandbox.window[globalName] || null;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { sentKeys: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) { console.log('SKIP (no Telegram credentials configured):\n' + text + '\n'); return { ok: false, skipped: true }; }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.log('FAIL Telegram send: ' + (j.description || r.status)); return { ok: false }; }
  return { ok: true };
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

(async () => {
  const MARKET_DATA = loadJsModule('xauusd-data.js', 'MARKET_DATA');
  const NEWS_AUTO = loadJsModule('news-auto.js', 'NEWS_AUTO');
  if (!MARKET_DATA) { console.log('No xauusd-data.js found - nothing to check.'); return; }

  const state = loadState();
  const seen = new Set(state.sentKeys || []);
  const toSend = [];

  // 1. High-importance calendar events (curated + auto), deduped by event+date
  const incoming = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || []);
  incoming.filter(e => e.importance === 'high').forEach(e => {
    const key = 'evt:' + e.event + '|' + e.date;
    if (seen.has(key)) return;
    seen.add(key);
    toSend.push(`📅 <b>High-impact event</b>\n${esc(e.event)}\nMYT ${esc(e.timeMyt || '—')} · GMT ${esc(e.timeGmt || '—')}\n${esc(e.note || '')}\n${e.url ? e.url : ''}`);
  });

  // 2. Auto-classified news/speaker rows with a real hawkish/dovish side (skip NEUTRAL - too noisy)
  const tabs = MARKET_DATA.tabs || [];
  tabs.forEach(tab => {
    (tab.news || []).filter(n => n.auto && n.signal && n.signal !== 'NEUTRAL').forEach(n => {
      const key = 'news:' + n.title;
      if (seen.has(key)) return;
      seen.add(key);
      const arrow = n.signal === 'BUY' ? '🟢' : '🔴';
      toSend.push(`${arrow} <b>${esc(tab.label)} — ${esc(n.signal)}</b> (${n.impactPct > 0 ? '+' : ''}${n.impactPct}%)\n${esc(n.title)}\n<i>${esc(n.source)}</i>${n.url ? '\n' + n.url : ''}`);
    });
    (tab.speakers || []).filter(s => s.auto && s.side).forEach(s => {
      const key = 'spk:' + s.name + '|' + s.date;
      if (seen.has(key)) return;
      seen.add(key);
      const arrow = s.side === 'hawkish' ? '🦅' : '🕊️';
      toSend.push(`${arrow} <b>${esc(tab.label)} — ${esc((s.side || '').toUpperCase())}</b>\n${esc(s.name)} (${esc(s.role)})\n“${esc(s.quote)}”${s.url ? '\n' + s.url : ''}`);
    });
  });

  console.log(`Checked ${incoming.length} calendar rows, ${tabs.reduce((n, t) => n + (t.news || []).length + (t.speakers || []).length, 0)} news/speaker rows -> ${toSend.length} new alert(s).`);

  for (const msg of toSend) {
    const r = await sendTelegram(msg);
    if (r.ok) console.log('SENT: ' + msg.split('\n')[1]);
    await new Promise(res => setTimeout(res, 400)); // stay well under Telegram's rate limit
  }

  state.sentKeys = Array.from(seen).slice(-2000); // cap growth - only the most recent 2000 keys matter
  saveState(state);
  console.log('State saved: ' + state.sentKeys.length + ' known keys.');
})();
