'use strict';
/* scan-oma-signals.js — Oma-ally / TheSharpShooterEA MTF signal scanner (ifx poller, 5 min).
 *
 * Symbol priority (Anam's spec):
 *   1. XAUUSD, BTCUSD — ALWAYS scanned (priority symbols).
 *   2. FX — picked from the live FF calendar: the currency of the nearest HIGH-impact event
 *      (and any event within the next 24h) maps to its USD pair (GBP->GBPUSD, JPY->USDJPY,
 *      EUR->EURUSD, AUD/NZD/CHF/CAD->USDxxx). Fallback watchlist when no high-impact event
 *      is due: the majors. Dedup: one card per (symbol, direction, M15 bar), 24h expiry.
 * Fail-closed: Dukascopy fetch or scan failure -> skip symbol, never a fabricated signal.
 * Usage: node scan-oma-signals.js          # scan + send to TELEGRAM_CHANNEL_ID
 *        node scan-oma-signals.js --dry    # print only
 */
const fs = require('fs');
const path = require('path');
const Oma = require('./lib/bbma-oma-signals');

const ALWAYS = ['xauusd', 'btcusd'];
const STATE_FILE = path.join(__dirname, '.oma-signal-state.json');
const DRY = process.argv.includes('--dry');
const CcyPair = {
  GBP: 'gbpusd', EUR: 'eurusd', JPY: 'usdjpy', AUD: 'audusd',
  NZD: 'nzdusd', CHF: 'usdchf', CAD: 'usdcad', USD: 'eurusd'
};
const CcyLabel = { gbpusd: 'GBP/USD', eurusd: 'EUR/USD', usdjpy: 'USD/JPY', audusd: 'AUD/USD', nzdusd: 'NZD/USD', usdchf: 'USD/CHF', usdcad: 'USD/CAD', xauusd: 'XAU/USD', btcusd: 'BTC/USD' };

function loadNews() {
  try {
    const win = {};
    new Function('window', fs.readFileSync(path.join(__dirname, 'news-auto.js'), 'utf8'))(win);
    return win.NEWS_AUTO || null;
  } catch { return null; }
}

/* Nearest high-impact events (within 24h) -> FX instruments. */
function fxSymbolsFromNews() {
  const FALLBACK = ['gbpusd', 'eurusd', 'usdjpy', 'audusd', 'usdchf', 'nzdusd', 'usdcad'];
  const N = loadNews();
  if (!N) return { symbols: FALLBACK, reason: 'no-news-fallback-watchlist' };
  const rows = N.calendarAll || N.incoming || [];
  const now = Date.now();
  const high = [];
  for (const e of rows) {
    if (String(e.importance || '').toLowerCase() !== 'high') continue;
    const ccy = String(e.currency || '').toUpperCase() || ((/\[(\w{3})\]/.exec(String(e.event || e.title || '')) || [])[1] || '');
    if (!ccy) continue;
    let t = Date.parse(e.timeGmt || e.date || e.scheduledAt || '');
    if (!Number.isFinite(t)) {
      const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(e.date || ''));
      if (dm) t = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 12);
    }
    if (!Number.isFinite(t)) continue;
    high.push({ ccy, t, title: e.event || e.title });
  }
  high.sort((a, b) => a.t - b.t);
  const horizon = now + 48 * 3600000; // 48h: the calendar is weekly; the next high-impact is usually <48h out
  const seen = new Set();
  const symbols = [];
  const due = [];
  for (const e of high) {
    if (e.t < now - 6 * 3600000 || e.t > horizon) continue;
    const inst = CcyPair[e.ccy];
    if (!inst || seen.has(inst)) continue;
    seen.add(inst);
    symbols.push(inst);
    due.push(e.ccy + ' ' + String(e.title).replace(/\s*\[\w{3}\]\s*/, '').slice(0, 32) + ' @ ' + new Date(e.t + 8 * 3600000).toISOString().slice(11, 16) + ' MYT');
    if (symbols.length >= 4) break;
  }
  if (!symbols.length) return { symbols: FALLBACK, reason: 'no-high-impact-event-in-window' };
  return { symbols, reason: 'news-driven: ' + due.join(' | ') };
}

async function dukascopy(instrument, timeframe, fromDays) {
  const { getHistoricalRates } = require('dukascopy-node');
  const from = new Date(Date.now() - fromDays * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // `to` is exclusive
  const rows = await getHistoricalRates({
    instrument, dates: { from, to }, timeframe, priceType: 'bid', format: 'array',
    batchSize: 10, pauseBetweenBatchesMs: 300, timeoutMs: 30000,
    retryCount: 2, pauseBetweenRetriesMs: 800, failAfterRetryCount: false
  });
  return (rows || [])
    .filter(r => Array.isArray(r) && r.length >= 5 && [r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite))
    .map(r => ({ time: new Date(r[0]).toISOString(), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
}
/* Weekly bars for the W1-agreement check: ~400 days of daily Dukascopy -> W1 (>=50 bars). */
async function w1For(instrument) {
  try {
    const daily = await dukascopy(instrument, 'd1', 400);
    return Oma.weeklyBars(daily);
  } catch { return []; }
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {} }; } }
function saveState(s) {
  const cutoff = Date.now() - 24 * 3600000;
  s.sent = Object.fromEntries(Object.entries(s.sent).filter(([, v]) => (v && v.at) && v.at > cutoff));
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
}

(async () => {
  const state = loadState();
  const fx = fxSymbolsFromNews();
  const instruments = [...new Set([...ALWAYS, ...fx.symbols])];
  console.log('oma scan: priority=' + ALWAYS.join(',') + ' fx=' + fx.symbols.join(',') + ' (' + fx.reason + ')');
  let posted = 0, failed = 0;
  for (const inst of instruments) {
    const sym = CcyLabel[inst] || inst.toUpperCase();
    let m5, m15, w1;
    try {
      m5 = await dukascopy(inst, 'm5', 7);
      await new Promise(r => setTimeout(r, 300));
      m15 = await dukascopy(inst, 'm15', 90);
      await new Promise(r => setTimeout(r, 300));
      w1 = await w1For(inst);
    } catch (e) { console.log(sym + ': fetch failed (' + (e && e.message) + ') - skipped'); continue; }
    const s = Oma.scanSymbol(sym, m5, m15, { W1: w1 });
    if (s.state !== 'SIGNAL') { console.log(sym + ': ' + s.state); continue; }
    const key = sym + ':' + s.dir + ':' + s.m15Time;
    const prev = state.sent[key];
    if (prev && prev.bar === s.m15Time) { console.log(sym + ': signal unchanged (M15 ' + s.m15Time + ') - not reposted'); continue; }
    const card = Oma.renderCard(s);
    if (DRY) {
      console.log('--- ' + sym + ' ' + s.action + ' (entry ' + s.entry + ') ---');
      console.log(card.replace(/<[^>]+>/g, ''));
      state.sent[key] = { bar: s.m15Time, at: Date.now() };
      continue;
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) { console.log(sym + ': no Telegram creds - printed only'); continue; }
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: card, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { posted++; state.sent[key] = { bar: s.m15Time, at: Date.now() }; console.log(sym + ': SENT (msg ' + j.result.message_id + ')'); }
    else { failed++; console.log(sym + ': send failed - ' + (j.description || r.status)); }
    await new Promise(res => setTimeout(res, 1500));
  }
  saveState(state);
  console.log('oma scan done: ' + instruments.length + ' symbols, ' + posted + ' posted, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
})().catch(e => { console.error('oma scan error:', e && e.stack || e); process.exitCode = 1; });
