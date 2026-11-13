'use strict';
/* bbma-chat-scan.js — BBMA Oma Ally MTF (Diamond) scanner for the ifxhelper_Trader Chat group.
 *
 * Same deterministic cascade the channel scanner runs (lib/bbma-oma-signals.js):
 *   TF1 H1 Reentry -> TF2 M15 Reject at EMA50/BB -> TF3 M5 Reentry/Extreme/MHV,
 *   with D1/H4/W1 context and the W1-agreement rule (conflict -> WATCH).
 *
 * Difference from scan-oma-signals.js (channel): destination = the linked group
 * (TELEGRAM_TRADER_CHAT_ID), own dedup state (.bbma-chat-state.json, 24h expiry,
 * keyed symbol+dir+M15-bar). Two modes:
 *   node bbma-chat-scan.js             # live: post a full SIGNAL card only when the
 *                                      # complete MTF trigger fires (silent otherwise)
 *   node bbma-chat-scan.js --status    # always: post a "SCAN IN PROGRESS" status card
 *                                      # showing each TF leg (live / missing / conflict)
 *                                      # + the exact condition needed next
 *
 * Leg states come from the engine's tags directly (no look-ahead: still-forming bars
 * are dropped by the resampler) — a leg is "live" only when its pattern is present on
 * a CLOSED bar in the right direction. Fail-closed: fetch failure -> symbol skipped.
 */
const fs = require('fs');
const path = require('path');
const Oma = require('./lib/bbma-oma-signals');
const Engine = require('./lib/bbma-engine');
const { getHistoricalRates } = require('dukascopy-node');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_TRADER_CHAT_ID || '-1004296386476';
const STATE_FILE = path.join(__dirname, '.bbma-chat-state.json');
const STATUS = process.argv.includes('--status');

async function dukascopy(instrument, timeframe, fromDays) {
  const from = new Date(Date.now() - fromDays * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const rows = await getHistoricalRates({ instrument, dates: { from, to }, timeframe, priceType: 'bid', format: 'array', batchSize: 10, pauseBetweenBatchesMs: 300, timeoutMs: 30000, retryCount: 2, pauseBetweenRetriesMs: 800, failAfterRetryCount: false });
  return (rows || [])
    .filter(r => Array.isArray(r) && r.length >= 5 && [r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite))
    .map(r => ({ time: new Date(r[0]).toISOString(), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
}
const toE = b => (b || []).map(x => ({ time: x.time, open: +x.open, high: +x.high, low: +x.low, close: +x.close }));
const t = x => (x && x.state === 'READY' ? `${x.trend} · mom ${x.momentum} · ${x.csak} · ${x.extreme || '-'} · ${x.reentry} · ${x.zone}` : 'n/a');

/* One symbol: fetch (same 3 Dukascopy calls as the channel scanner) + full cascade state. */
async function scanFull(label, instrument) {
  const m5 = await dukascopy(instrument, 'm5', 7);
  await new Promise(r => setTimeout(r, 300));
  const m15 = await dukascopy(instrument, 'm15', 90);
  await new Promise(r => setTimeout(r, 300));
  const daily = await dukascopy(instrument, 'd1', 400).catch(() => []);
  const w1 = Oma.weeklyBars(daily);
  const h1 = Oma.resampleFromM5(m5, 60);
  const m15r = Oma.resampleFromM5(m5, 15);
  const h4 = Oma.resampleUp(m15, 240);
  const d1 = Oma.resampleUp(m15, 1440);
  const now = Date.now();
  const m5e = toE(m5.filter(b => Date.parse(b.time) + 5 * 60000 <= now).slice(-120));
  const h1x = Engine.classify(toE(h1));
  const m15x = Engine.classify(toE(m15r));
  const m5x = Engine.classify(m5e);
  const h4x = h4.length >= 50 ? Engine.classify(toE(h4)) : null;
  const d1x = d1.length >= 50 ? Engine.classify(toE(d1)) : null;
  const w1x = w1.length >= 50 ? Engine.classify(toE(w1)) : null;
  const signal = Oma.scanSymbol(label, m5, m15, { W1: w1 });
  const tf1 = Oma._tags.reentryTag(h1x);
  const tf2 = Oma._tags.rejectTag(m15x);
  const tf3 = Oma._tags.m5Tag(m5x);
  const last = m15r[m15r.length - 1];
  return {
    label, instrument, signal, tf1, tf2, tf3,
    legs: {
      H1: { x: h1x, tag: tf1, need: 'Reentry zone (BB pullback into EMA50 area)' },
      M15: { x: m15x, tag: tf2, need: 'Reject at EMA50 & BB' },
      M5: { x: m5x, tag: tf3, need: 'Reentry / EXT / MHV confirmation' }
    },
    context: { W1: w1x, D1: d1x, H4: h4x },
    price: last && last.close,
    m15Time: last && last.time
  };
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Leg line: ✅ live (matches dir) / ⚪ not yet (with what's needed) / ⛔ present but opposite. */
function legLine(name, leg, dir) {
  const tag = leg.tag;
  if (tag) {
    if (tag.dir === dir) return `✅ TF ${name} — ${esc(tag.text)}`;
    return `⛔ TF ${name} — opposite: ${esc(tag.text)}`;
  }
  const st = leg.x && leg.x.state === 'READY' ? leg.x.trend : '—';
  return `⚪ TF ${name} — not yet (trend ${st}) · needs ${esc(leg.need)}`;
}

/* Status card: the cascade as it stands right now, per symbol. */
function statusCard(results) {
  const d = new Date(Date.now() + 8 * 3600000);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const stamp = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} MYT`;
  const lines = [
    '🔍 <b>BBMA SMART SCANNER — MTF cascade status</b> · ' + stamp,
    '<i>BBMA Oma Ally strategy: TF1 H1 Reentry → TF2 M15 Reject at EMA50 &amp; BB → TF3 M5 confirm · full signal posts only when all legs align (no look-ahead, closed bars only)</i>',
    ''
  ];
  for (const r of results) {
    const sig = r.signal;
    const head = sig.state === 'SIGNAL' ? (sig.dir === 'BUY' ? '🟢' : '🔴') + ' <b>' + esc(r.label) + ' — ' + esc(sig.action) + '</b>'
      : '⚪ <b>' + esc(r.label) + ' — ' + esc(sig.state.replace('_', ' ')) + '</b>' + (r.price != null ? ' · last M15 ' + r.price.toFixed(r.price > 1000 ? 1 : 4) + ' (' + r.m15Time.slice(11, 16) + 'Z)' : '');
    lines.push(head);
    const ctx = [];
    for (const [k, x] of Object.entries(r.context)) {
      if (!x || x.state !== 'READY') continue;
      ctx.push(k + ' ' + x.trend);
    }
    lines.push('   Context: ' + (ctx.length ? ctx.join(' · ') : 'insufficient') + (sig.w1Conflicts ? ' · ⚠️ W1 conflicts' : ''));
    if (sig.state === 'SIGNAL') {
      sig.lines.forEach(l => lines.push('   ' + l));
      const d = sig.decimals;
      lines.push('   SL <b>' + Number(sig.sl).toFixed(d) + '</b> · TP <b>' + Number(sig.tp1).toFixed(d) + ' / ' + Number(sig.tp2).toFixed(d) + '</b> (1×ATR14 M15 / 1R / 2R)');
    } else {
      const dir = r.tf1 ? r.tf1.dir : (r.tf2 ? r.tf2.dir : null);
      if (dir) {
        lines.push('   Cascade legs (reading ' + dir + '):');
        lines.push('     ' + legLine('1 H1', r.legs.H1, dir));
        lines.push('     ' + legLine('2 M15', r.legs.M15, dir));
        lines.push('     ' + legLine('3 M5', r.legs.M5, dir));
      } else {
        lines.push('   TF1 H1 not in a reentry zone yet — waiting for a closed H1 reentry (either direction).');
      }
    }
    lines.push('');
  }
  lines.push('📡 Deterministic scan (Dukascopy m5/m15/d1, no look-ahead). Research context, not a direction call.');
  lines.push('🏷️ ifxhelper_2026 · Trader Desk');
  return lines.join('\n');
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {} }; } }
function saveState(s) {
  const cutoff = Date.now() - 24 * 3600000;
  s.sent = Object.fromEntries(Object.entries(s.sent).filter(([, v]) => v && v.at > cutoff));
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
}
async function send(text) {
  if (!TOKEN || !CHAT_ID) { console.log('SKIP (no creds):\n' + text); return { ok: false, skipped: true }; }
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.log('send failed: ' + (j.description || r.status)); return { ok: false }; }
  return { ok: true, id: j.result.message_id };
}

/* Watchlist: XAU/USD + BTC/USD always, + the FX pair of the next high-impact event (same
 * rule as the channel scanner's scan-oma-signals.js — one source of truth for priority). */
function watchlist() {
  const ALWAYS = ['xauusd', 'btcusd'];
  const CcyPair = { GBP: 'gbpusd', EUR: 'eurusd', JPY: 'usdjpy', AUD: 'audusd', NZD: 'nzdusd', CHF: 'usdchf', CAD: 'usdcad', USD: 'eurusd' };
  const Label = { gbpusd: 'GBP/USD', eurusd: 'EUR/USD', usdjpy: 'USD/JPY', audusd: 'AUD/USD', nzdusd: 'NZD/USD', usdchf: 'USD/CHF', usdcad: 'USD/CAD', xauusd: 'XAU/USD', btcusd: 'BTC/USD' };
  try {
    const win = {};
    new Function('window', fs.readFileSync(path.join(__dirname, 'news-auto.js'), 'utf8'))(win);
    const rows = (win.NEWS_AUTO || {}).calendarAll || (win.NEWS_AUTO || {}).incoming || [];
    const now = Date.now();
    const due = [];
    for (const e of rows) {
      if (String(e.importance || '').toLowerCase() !== 'high') continue;
      const ccy = String(e.currency || '').toUpperCase() || ((/\[(\w{3})\]/.exec(String(e.event || e.title || '')) || [])[1] || '');
      let t = Date.parse(e.timeGmt || e.date || e.scheduledAt || '');
      if (!Number.isFinite(t)) { const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(e.date || '')); if (dm) t = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 12); }
      if (!ccy || !Number.isFinite(t) || t < now - 6 * 3600000 || t > now + 48 * 3600000) continue;
      const inst = CcyPair[ccy];
      if (inst && !due.some(x => x.inst === inst)) due.push({ inst, ccy, title: String(e.event || e.title).replace(/\s*\[\w{3}\]\s*/, '').slice(0, 32) });
    }
    due.sort((a, b) => 0);
    const fx = due.slice(0, 2).map(x => x.inst);
    const list = [...new Set([...ALWAYS, ...fx])];
    return { list, labels: Label, note: fx.length ? 'news-driven: ' + due.slice(0, 2).map(x => x.ccy + ' ' + x.title).join(' | ') : 'no high-impact FX event in 48h' };
  } catch {
    return { list: ALWAYS, labels: Label, note: 'no-news-fallback' };
  }
}

(async () => {
  const { list, labels, note } = watchlist();
  console.log('bbma chat scan: ' + list.join(',') + ' (' + note + ')');
  const results = [];
  for (const inst of list) {
    try { results.push(await scanFull(labels[inst] || inst.toUpperCase(), inst)); }
    catch (e) { console.log(labels[inst] + ': fetch failed (' + (e && e.message) + ')'); }
  }
  if (!results.length) { console.log('all fetches failed — silent (fail-closed)'); return; }
  const state = loadState();
  let posted = 0;
  for (const r of results) {
    if (STATUS) continue;
    if (r.signal.state !== 'SIGNAL') { console.log(r.label + ': ' + r.signal.state + ' (silent)'); continue; }
    const key = r.label + ':' + r.signal.dir + ':' + r.signal.m15Time;
    if (state.sent[key] && state.sent[key].bar === r.signal.m15Time) { console.log(r.label + ': unchanged M15 — not reposted'); continue; }
    const rr = await send(Oma.renderCard(r.signal));
    if (rr.ok) { posted++; state.sent[key] = { bar: r.signal.m15Time, at: Date.now() }; console.log(r.label + ': SIGNAL SENT (msg ' + rr.id + ')'); }
    await new Promise(res => setTimeout(res, 1500));
  }
  if (STATUS) {
    const rr = await send(statusCard(results));
    console.log(rr.ok ? 'STATUS SENT (msg ' + rr.id + ')' : 'STATUS not sent');
  } else {
    saveState(state);
  }
  console.log('bbma chat scan done: ' + results.length + ' scanned, ' + posted + ' full signal(s) posted' + (STATUS ? ' + status card' : ''));
})().catch(e => { console.error('bbma chat scan error:', e && e.stack || e); process.exitCode = 1; });
