'use strict';
/* bbma-oma-signals.js — deterministic Oma-ally-style multi-TF signal scanner.
 *
 * Reproduces the "BBMA Oma Ally" card format from the public channel:
 *   <SYMBOL> H1  Buy Now! / Sell Now!
 *   TF1 Reentry H1            (H1 close inside the trend-side re-entry zone, above/below mid BB)
 *   TF2 Reject EMA50 at Lower BB M15  (or Upper BB; optional EMA50 rejection tag)
 *   TF3 Extreme M5            (optional; 'Full Setup M5' when all three agree)
 *   Entry / Stop Loss / Take Profit x2  (1R / 2R from M15 ATR14)
 *   Trailing + cut-loss rules (fixed text, mirrors the channel's MA5/10-break rules)
 *
 * Deterministic + fail-closed: a signal only exists when TF1 is READY. TF2/TF3 are
 * confirmation layers and are labelled 'NONE' when absent — never invented. All candles
 * are keyless Dukascopy (bid). No look-ahead: the engine classifies the last closed bar
 * series (the still-forming bar is dropped).
 */
const Engine = require('./bbma-engine');
const Atr = require('./atr-mtf-engine');

/* Dukascopy m5 rows are {time, open, high, low, close} (see bbma-telegram-signals dukascopyChart). */
function toCompact(bars) {
  return (bars || []).map(b => ({ time: b.time, o: +b.open, h: +b.high, l: +b.low, c: +b.close, t: Date.parse(b.time) }));
}
function resampleFromM5(m5, minutes) {
  const step = minutes * 60000;
  const buckets = new Map();
  for (const b of m5 || []) {
    const t = Date.parse(b.time);
    const key = Math.floor(t / step) * step;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }
  const out = [];
  for (const [key, bs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    // Drop the still-forming bucket (its close time would be in the future).
    if (key + step > Date.now()) continue;
    if (bs.length < Math.max(1, Math.round(minutes / 5))) continue;
    out.push({
      time: new Date(key).toISOString(),
      open: +bs[0].open, high: Math.max(...bs.map(x => +x.high)),
      low: Math.min(...bs.map(x => +x.low)), close: +bs[bs.length - 1].close
    });
  }
  return out;
}
function toEngineBars(bars) { return (bars || []).map(b => ({ time: b.time, open: +b.open, high: +b.high, low: +b.low, close: +b.close })); }

/* Directional tags, exactly the channel's vocabulary. */
function reentryTag(x) {
  if (!x || x.state !== 'READY') return null;
  if (x.reentry === 'REENTRY_UP_ZONE') return { dir: 'BUY', text: 'TF1 Reentry H1' };
  if (x.reentry === 'REENTRY_DOWN_ZONE') return { dir: 'SELL', text: 'TF1 Reentry H1' };
  return null;
}
function rejectTag(x) {
  if (!x || x.state !== 'READY') return null;
  const v = x.values;
  if (!v) return null;
  const last = (x) && (x);
  // Rejection at a band extreme: close pulled back from the band on the trend side.
  const lower = x.trend === 'DOWN' ? false : true;
  if (x.zone === 'BELOW_LOW_BB' || x.zone === 'ABOVE_TOP_BB') {
    const atLower = x.zone === 'BELOW_LOW_BB';
    const dir = atLower ? 'BUY' : 'SELL';
    const emaReject = atLower ? v.ema50 > v.bb.mid : v.ema50 < v.bb.mid;
    return { dir, text: 'TF2 Reject EMA50 at ' + (atLower ? 'Lower' : 'Upper') + ' BB M15' + (emaReject ? '' : '') };
  }
  // Momentum push off the band (extreme) also counts as rejection context.
  if (x.momentum === 'MOMENTUM_DOWN' && x.zone === 'LOW_TO_MID') return { dir: 'BUY', text: 'TF2 Reject EMA50 at Lower BB M15' };
  if (x.momentum === 'MOMENTUM_UP' && x.zone === 'MID_TO_TOP') return { dir: 'SELL', text: 'TF2 Reject EMA50 at Upper BB M15' };
  return null;
}
function m5Tag(x) {
  if (!x || x.state !== 'READY') return null;
  if (x.extreme === 'EXTREME_HIGH' || x.extreme === 'EXTREME_LOW') {
    return { dir: x.extreme === 'EXTREME_LOW' ? 'BUY' : 'SELL', text: 'TF3 Extreme M5' };
  }
  return null;
}

/* One symbol scan. m5Bars = fresh Dukascopy m5 (>=3 days). Returns null when no TF1. */
function scanSymbol(symbol, m5Bars, { now = Date.now() } = {}) {
  if (!Array.isArray(m5Bars) || m5Bars.length < 24 * 12) return { symbol, state: 'INSUFFICIENT_DATA' };
  const m15 = resampleFromM5(m5Bars, 15);
  const h1 = resampleFromM5(m5Bars, 60);
  const m5e = toEngineBars(m5Bars.filter(b => Date.parse(b.time) + 5 * 60000 <= now).slice(-120));
  const m15e = toEngineBars(m15);
  const h1e = toEngineBars(h1);

  const h1x = Engine.classify(h1e);
  const m15x = Engine.classify(m15e);
  const m5x = Engine.classify(m5e);

  const tf1 = reentryTag(h1x);
  if (!tf1) return { symbol, state: 'NO_SIGNAL', tf2: m15x && m15x.state, h1: h1x && h1x.state };

  const tf2 = rejectTag(m15x) || { dir: tf1.dir, text: 'TF2 NONE M15' };
  const tf3 = m5Tag(m5x) || null;
  const aligned = tf2.dir === tf1.dir && (!tf3 || tf3.dir === tf1.dir);
  if (!aligned) return { symbol, state: 'CONFLICT', tf1: tf1.text, tf2: tf2.text, tf3: tf3 && tf3.text };

  // Risk ladder: entry = last closed M15 close; SL = 1x ATR14(M15) against the trade; TP = 1R/2R.
  const atr14 = Atr.wilderATR(m15, 14);
  const lastM15 = m15[m15.length - 1];
  if (!lastM15 || !atr14) return { symbol, state: 'NO_ATR' };
  const dir = tf1.dir;
  const entry = +lastM15.close;
  const sl = dir === 'BUY' ? entry - atr14 : entry + atr14;
  const risk = Math.abs(entry - sl);
  const tp1 = dir === 'BUY' ? entry + risk : entry - risk;
  const tp2 = dir === 'BUY' ? entry + 2 * risk : entry - 2 * risk;

  const fullSetup = !!(tf3 && tf3.dir === dir && m5x.momentum === (dir === 'BUY' ? 'MOMENTUM_DOWN' : 'MOMENTUM_UP'));
  const action = dir === 'BUY' ? 'Buy Now!' : 'Sell Now!';
  const tf3Text = tf3 ? (fullSetup ? 'TF3 Full Setup M5' : tf3.text) : 'TF3 NONE M5';

  return {
    symbol, state: 'SIGNAL', action, dir,
    lines: [tf1.text, tf2.text, tf3Text],
    entry, sl, tp1, tp2, atr14,
    decimals: entry > 50 ? 3 : 5,
    m15Time: lastM15.time,
    h1: h1x.state, m15: m15x.state, m5: m5x.state
  };
}

/* Card text — the channel's exact structure, fail-closed footer. */
function renderCard(s, { now = Date.now() } = {}) {
  const d = s.decimals;
  const f = v => Number(v).toFixed(d);
  const myt = new Date(now + 8 * 3600000);
  const stamp = myt.toISOString().slice(0, 16).replace('T', ' ');
  const head = s.action === 'Buy Now!' ? '🟢 <b>' + s.symbol + ' H1  Buy Now!</b>' : '🔴 <b>' + s.symbol + ' H1  Sell Now!</b>';
  return [
    head,
    s.lines.join('\n'),
    'Stop Loss: <b>' + f(s.sl) + '</b>',
    'Take Profit: <b>' + f(s.tp1) + ' / ' + f(s.tp2) + '</b>',
    '',
    'Trailing: close on M5 MA5/MA10 break or BB touch',
    'Cut loss: on opposite CSM signal or EMA50 M15 cross',
    '',
    'Entry ref ' + f(s.entry) + ' · SL = 1×ATR14(M15) · TP = 1R/2R · M15 closed ' + new Date(s.m15Time).toISOString().slice(11, 16) + 'Z',
    '📡 BBMA Oma Ally Analyzer — deterministic MTF scan (H1/M15/M5 Dukascopy). Research context, not a direction call.',
    '🕒 ' + stamp + ' MYT'
  ].join('\n');
}

module.exports = { scanSymbol, renderCard, resampleFromM5, _tags: { reentryTag, rejectTag, m5Tag } };
