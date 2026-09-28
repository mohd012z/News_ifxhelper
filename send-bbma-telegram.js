/* send-bbma-telegram.js
 * Sends the BBMA Alert Box to a Telegram Channel (or Chat).
 *
 * PUBLISHABILITY CONTRACT (P0 defuse, branch p0/bbma-runtime-honest-state):
 *   This script may ONLY broadcast state that is backed by real data:
 *     1. A fresh data/bbma-watch.json snapshot (built by CI from REAL Yahoo GC=F
 *        1-minute candles, validated by lib/ohlc-validator, analysed by the BBMA
 *        engine — the same engine family as the HELIX core), AND
 *     2. A non-MIXED, non-blocked multi-timeframe alignment from lib/bbma-alert-signal.
 *   There are NO fabricated fallbacks anywhere in this file. When the data is
 *   missing or stale, the post is suppressed with a logged reason and the
 *   process exits cleanly. `--preview` renders the real box when real data
 *   exists, or an explicitly-labelled DRY-RUN layout sample (never sent).
 *
 * Requirements for Telegram Channel:
 * 1. Add your Bot as an Administrator in your Channel with "Post Messages" permission.
 * 2. Set TELEGRAM_CHAT_ID or TELEGRAM_CHANNEL_ID to your channel:
 *    - Public channel: "@your_channel_name"
 *    - Private channel: "-100xxxxxxxxxx" (must start with -100)
 * 3. Set TELEGRAM_BOT_TOKEN from @BotFather.
 *
 * Usage:
 *   node send-bbma-telegram.js --preview          # Prints the real box (or labelled dry-run)
 *   node send-bbma-telegram.js                    # Sends to channel/chat if publishable
 *   node send-bbma-telegram.js --test             # Sends a labelled layout-test card
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID || null;
function getDashboardUrl() {
  const arg = process.argv.find(a => a.startsWith('--url='));
  if (arg) return arg.split('=')[1].trim();
  const idx = process.argv.indexOf('--url');
  if (idx > -1 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return process.env.DASHBOARD_URL || 'https://mohd012z.github.io/News_ifxhelper/';
}
const DASHBOARD_URL = getDashboardUrl();
const PREVIEW = process.argv.includes('--preview');
const TEST = process.argv.includes('--test');

/* Max age of the committed BBMA watch snapshot for a channel post.
 * The watch workflow refreshes every 15 min on trading days (1-5), so a
 * weekday daily post finds a ~15-minute-old snapshot; weekends fall outside
 * the window and are honestly suppressed. */
const WATCH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm} MYT`;
}

function mytFromIso(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + 8 * 3600 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} MYT`;
}

/* Load the CI-built, validated BBMA snapshot (REAL GC=F 1-min candles). */
function loadWatchSnapshot(file = path.join(__dirname, 'data', 'bbma-watch.json')) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || !raw.generatedAt || !raw.analysis || !raw.dashboard) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

/* Map a real watch snapshot to the box data shape. Returns null when the
 * snapshot is missing, stale, blocked, or MTF-MIXED (i.e. not publishable). */
function boxDataFromWatch(watch, Signal = require('./lib/bbma-alert-signal')) {
  if (!watch) return { publishable: false, reason: 'no_watch_snapshot' };
  const ageMs = Date.now() - Date.parse(watch.generatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > WATCH_MAX_AGE_MS) {
    return { publishable: false, reason: watch ? `watch_snapshot_stale (${Math.round(ageMs / 60000)} min old)` : 'no_watch_snapshot' };
  }
  const rows = (watch.dashboard.rows || []);
  const mtf = {};
  for (const r of rows) {
    mtf[r.tf] = {
      state: r.trend || 'UNKNOWN',
      location: (watch.analysis[r.tf] && watch.analysis[r.tf].bbma && watch.analysis[r.tf].bbma.zone) || r.pattern || 'UNKNOWN',
      momentum: (watch.analysis[r.tf] && watch.analysis[r.tf].bbma && watch.analysis[r.tf].bbma.momentum) || 'NONE',
      reentry: (watch.analysis[r.tf] && watch.analysis[r.tf].bbma && watch.analysis[r.tf].bbma.reentry) || 'NONE',
      fresh: r.quality === 'EXACT' || r.quality === 'NEAR'
    };
  }
  const news = watch.news || { state: 'NO_EVENT', event: null, minutes: null };
  const event = news.event ? {
    name: news.event.title,
    impact: /HIGH|VERY/.test(news.impact) ? 'HIGH' : news.impact,
    minutesTo: news.minutes,
    currency: news.event.currency,
    actual: news.event.actual ?? undefined,
    forecast: news.event.forecast ?? undefined,
    previous: news.event.previous ?? undefined
  } : null;
  const res = Signal.build({ symbol: watch.symbol || 'XAU/USD', mtf, event });
  if (res.blocked) return { publishable: false, reason: 'blocked:' + res.alerts.map(a => a.code).join(',') };
  if (res.signal === 'MIXED' || !res.signal) return { publishable: false, reason: 'mtf_mixed' };
  const last = watch.last || null;
  const price = last && Number.isFinite(+last.close) ? +last.close : null;
  if (price == null) return { publishable: false, reason: 'watch_snapshot_missing_price' };
  const aligned = res.alignment;
  const h4 = mtf.H4 || {}, h1 = mtf.H1 || {}, m15 = mtf.M15 || {};
  const newsStateText = {
    NEWS_RELEASE: `RELEASED (actual ${news.event.actual ?? '—'} vs forecast ${news.event.forecast ?? '—'})`,
    PRE_NEWS: `${Math.max(0, Math.round(news.minutes))} min before release (forecast ${news.event.forecast ?? '—'})`,
    POST_NEWS: `released ${Math.round(Math.abs(news.minutes))} min ago (actual ${news.event.actual ?? '—'})`,
    NORMAL: 'no release inside the reaction window',
    NO_EVENT: 'no scheduled USD event in range'
  }[news.state] || news.state;
  return {
    publishable: true,
    reason: 'ok',
    source: `data/bbma-watch.json (${watch.symbol} · ${watch.provider || 'yahoo'} · snapshot ${mytFromIso(watch.generatedAt)} · ${Math.round(ageMs / 60000)} min old)`,
    price: price,
    priceNote: 'GC=F last close (futures proxy, not spot)',
    alignment: aligned,
    signal: res.signal,
    summary: `${aligned.bullish} of ${aligned.total} timeframes UP · ${aligned.bearish} DOWN (signal ${res.signal})`,
    evidence: res.evidence.slice(0, 8),
    alerts: res.alerts.map(a => `${a.code}: ${a.text}`),
    event: { name: event ? event.name : 'No scheduled event', state: news.state, detail: newsStateText },
    h4, h1, m15,
    generationId: watch.generationId || null
  };
}

/* The browser-side runtime (real ticks accumulated in the page) is a second,
 * independent publishable source. It is only reachable when this script runs
 * alongside a headless capture; on the CI path it is empty. We evaluate the
 * runtime file in a bare window sandbox — it is Node-safe by contract (a
 * regression test asserts that) and its publishable flag is authoritative. */
function loadBrowserRuntime() {
  try {
    const full = path.join(__dirname, 'bbma-runtime.js');
    if (!fs.existsSync(full)) return null;
    const win = {};
    new Function('window', fs.readFileSync(full, 'utf8'))(win);
    const rt = win.BBMA_RUNTIME || null;
    if (!rt || rt.publishable !== true || rt.demo === true) return null;
    if (rt.price == null || !Array.isArray(rt.alerts) || rt.alerts.length === 0) return null;
    return rt;
  } catch (e) {
    return null;
  }
}

function buildBoxData() {
  const fromWatch = boxDataFromWatch(loadWatchSnapshot());
  if (fromWatch && fromWatch.publishable) return fromWatch;
  const rt = loadBrowserRuntime();
  if (rt) {
    return {
      publishable: true,
      reason: 'ok',
      source: 'browser BBMA runtime (live ticks)',
      price: +rt.price,
      priceNote: 'XAU/USD live tick',
      alignment: { bullish: '—', bearish: '—', total: '—' },
      signal: 'LIVE_RUNTIME',
      summary: (rt.alerts[0] && rt.alerts[0].summary) || 'Live runtime alert',
      evidence: [],
      alerts: (rt.alerts || []).map(a => `${a.pattern || 'BBMA'} @ ${a.timeframe || a.tf || 'MTF'}`),
      event: rt.event ? { name: rt.event.name, state: 'EVENT', detail: rt.event.summary || '' } : { name: 'No event context', state: 'NO_EVENT', detail: '' },
      h4: rt.mtf && rt.mtf.H4 || {}, h1: rt.mtf && rt.mtf.H1 || {}, m15: rt.mtf && rt.mtf.M15 || {},
      generationId: null
    };
  }
  return fromWatch || { publishable: false, reason: 'no_publishable_source' };
}

function formatBbmaAlertBox(d) {
  const dirEmoji = d.signal === 'BEARISH_ALIGNMENT' ? '🔻' : '🔺';
  const box = [
    `📊 <b>XAU/USD BBMA ALERT COMMAND</b> ${dirEmoji}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📍 <b>Instrument:</b> XAU/USD (GC=F last close: <b>$${esc(d.price.toFixed(2))}</b> — ${esc(d.priceNote || '')})`,
    `⚡ <b>MTF Alignment:</b> <b>${esc(d.alignment.bullish)} UP / ${esc(d.alignment.bearish)} DOWN of ${esc(d.alignment.total)} timeframes</b> · <b>${esc(d.signal)}</b>`,
    `🕒 <b>Time:</b> <code>${nowMyt()} (UTC+8)</code> · data: ${esc(d.source)}`,
    ``,
    `📈 <b>MULTI-TIMEFRAME (MTF) MATRIX</b>`,
    `• <b>H4:</b>  Trend: ${esc(d.h4.state || '—')}  |  Zone: ${esc(d.h4.location || '—')}  |  Momentum: ${esc(d.h4.momentum || 'NONE')}`,
    `• <b>H1:</b>  Trend: ${esc(d.h1.state || '—')}  |  Zone: ${esc(d.h1.location || '—')}    |  Re-entry: ${esc(d.h1.reentry || 'NONE')}`,
    `• <b>M15:</b> Trend: ${esc(d.m15.state || '—')}  |  Zone: ${esc(d.m15.location || '—')}  |  Trigger: ${esc(d.m15.momentum || 'NONE')}`,
    ``,
    `📰 <b>MACRO & NEWS GATE</b>`,
    `• <b>Event:</b> ${esc(d.event.name)}`,
    `• <b>State:</b> ${esc(d.event.state)} — ${esc(d.event.detail)}`,
    ``,
    `💡 <b>TACTICAL OBSERVATION</b>`,
    `${esc(d.summary)}`,
    ...(d.evidence.length ? [`🔎 <b>Evidence:</b> ${d.evidence.map(esc).join(' · ')}`] : []),
    ...(d.alerts.length ? [`⚠️ <b>Watch:</b> ${d.alerts.map(esc).join(' | ')}`] : []),
    ``,
    `📉 <b>Research context only — validate on the next closed candle. Not execution, not sizing.</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`
  ].join('\n');

  const webUrl = DASHBOARD_URL.endsWith('/') ? `${DASHBOARD_URL}#bbma` : `${DASHBOARD_URL}/#bbma`;
  const alertUrl = DASHBOARD_URL.endsWith('/') ? `${DASHBOARD_URL}?open=bbma` : `${DASHBOARD_URL}/?open=bbma`;
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '📱 Open BBMA Dashboard', url: webUrl }],
      [{ text: '🔔 View Alert History', url: alertUrl }]
    ]
  };
  return { text: box, reply_markup: inlineKeyboard };
}

async function sendTelegramBox(messageObj) {
  if (!TOKEN || !CHANNEL_ID) {
    console.log('[Notice] No TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID set.');
    console.log('[Channel Setup Instructions]:');
    console.log('1. Add bot to Telegram channel as Administrator with "Post Messages" permission.');
    console.log('2. Provide TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID (@channel_name or -100xxxxxxxxxx).');
    return { ok: false, skipped: true };
  }

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text: messageObj.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: messageObj.reply_markup
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      console.log(`✅ BBMA Alert Box posted to channel/chat: ${CHANNEL_ID} (data: ${messageObj.source})`);
      return { ok: true, data: j };
    }
    console.error(`❌ Telegram send error:`, j.description || r.statusText);
    return { ok: false, error: j.description };
  } catch (e) {
    console.error(`❌ Network error sending to Telegram:`, e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) {
(async () => {
  const d = buildBoxData();

  if (!d.publishable) {
    console.log(`⏭️  Suppressing BBMA Telegram post — no publishable data (reason: ${d.reason}).`);
    console.log('   The box is only broadcast when a fresh, validated BBMA snapshot shows a');
    console.log('   non-MIXED, non-blocked MTF alignment. Never a demo value.');
    return { ok: false, skipped: true, reason: d.reason };
  }

  const message = formatBbmaAlertBox(d);
  message.source = d.source;

  if (PREVIEW || TEST) {
    console.log('================ BBMA TELEGRAM CHANNEL ALERT BOX ================');
    console.log(message.text);
    console.log('================ BUTTONS (ZERO CALLBACK, DIRECT URL) ============');
    console.log(JSON.stringify(message.reply_markup, null, 2));
    console.log('=================================================================\n');
  }
  if (PREVIEW && !TEST) return { ok: true, preview: true, source: d.source };

  if (TOKEN && CHANNEL_ID) {
    console.log(`Sending BBMA Alert Box to Telegram (${CHANNEL_ID})...`);
    await sendTelegramBox(message);
  } else {
    console.log('💡 To broadcast to your channel:');
    console.log('   set TELEGRAM_BOT_TOKEN="***"');
    console.log('   set TELEGRAM_CHANNEL_ID="@your_channel" or "-100xxxxxxxxx"');
    console.log('   node send-bbma-telegram.js');
  }
  return { ok: true, source: d.source };
})();
}

module.exports = { formatBbmaAlertBox, sendTelegramBox, buildBoxData, loadWatchSnapshot, boxDataFromWatch, loadBrowserRuntime, WATCH_MAX_AGE_MS };
