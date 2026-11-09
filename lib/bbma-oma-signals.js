'use strict';
/* bbma-oma-signals.js — deterministic Oma-ally / TheSharpShooterEA-style MTF signal scanner.
 *
 * Method studied from @TheSharpShooterEA (author of the BBMA Oma Ally Analyzer Dashboard EA
 * V4.70/4.80) and its live-signal channel:
 *   - CASCADE (high -> low): D1 context (Reentry zone) + H4 Reject at Top/Lower BB + W1
 *     agreement ("Weekly wajib bearish!"), then execution TFs H1 (Reentry + Extreme/MHV),
 *     M15 (Reject + CSM), M5 (Extreme / Full Setup). "All MTF signals are combined in one
 *     signal" (V4.70 release notes).
 *   - CSAK = close-side confirmation on candle direction; CSM = CSAK + momentum aligned
 *     (V4.70: "simplified method in scanning reentry after CSAK or CSM only").
 *   - No pendings at news; entry on the closed M15; SL = 1xATR14(M15); TP = 1R/2R.
 *   - Trailing: close on M5 MA5/MA10 break or BB touch; cut loss on opposite CSM or EMA50 M15 cross.
 *
 * Deterministic + fail-closed: a SIGNAL exists only when TF1 (H1 reentry) is READY and TF2
 * aligns. W1 conflict downgrades to WATCH. Context lines (D1/H4/W1) are labelled context —
 * never the trigger. Still-forming bars are dropped (no look-ahead).
 */
const Engine = require('./bbma-engine');
const Atr = require('./atr-mtf-engine');

/* Bars are {time, open, high, low, close}. Resample a finer series up to `minutes`,
 * dropping the still-forming bucket. */
function resampleFrom(bars, fromMinutes, minutes) {
  const step = minutes * 60000;
  const buckets = new Map();
  for (const b of bars || []) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / step) * step;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }
  const out = [];
  for (const [key, bs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (key + step > Date.now()) continue; // still forming
    if (bs.length < Math.max(1, Math.round(minutes / fromMinutes))) continue;
    out.push({
      time: new Date(key).toISOString(),
      open: +bs[0].open, high: Math.max(...bs.map(x => +x.high)),
      low: Math.min(...bs.map(x => +x.low)), close: +bs[bs.length - 1].close
    });
  }
  return out;
}
const resampleFromM5 = (m5, minutes) => resampleFrom(m5, 5, minutes);
const resampleUp = (bars, toMinutes) => resampleFrom(bars, 15, toMinutes); // context series is m15
/* Weekly bars from daily, dropping the still-forming week. >=3 bars keeps FX weeks
 * (Mon-Fri = 5) AND weekend-trading weeks (gold/BTC); the engine's 50-bar guard discards
 * any W1 frame that's too short to classify. Used for the W1 agreement check. */
function weeklyBars(daily) {
  const step = 7 * 86400000;
  const buckets = new Map();
  for (const b of daily || []) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (((d.getUTCDay() + 6) % 7) * 86400000);
    if (!buckets.has(start)) buckets.set(start, []);
    buckets.get(start).push(b);
  }
  const out = [];
  for (const [key, bs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (key + step > Date.now()) continue; // forming week
    if (bs.length < 3) continue;
    bs.sort((x, y) => Date.parse(x.time) - Date.parse(y.time));
    out.push({ time: new Date(key).toISOString(), open: +bs[0].open, high: Math.max(...bs.map(x => +x.high)), low: Math.min(...bs.map(x => +x.low)), close: +bs[bs.length - 1].close });
  }
  return out;
}
function toEngineBars(bars) { return (bars || []).map(b => ({ time: b.time, open: +b.open, high: +b.high, low: +b.low, close: +b.close })); }

/* CSM: CSAK direction + momentum direction aligned (V4.70 "reentry after CSAK or CSM"). */
function csmOf(x) {
  if (!x || x.state !== 'READY') return null;
  const csaUp = x.csak === 'CSAK_UP', csaDn = x.csak === 'CSAK_DOWN';
  const momUp = x.momentum === 'MOMENTUM_UP', momDn = x.momentum === 'MOMENTUM_DOWN';
  if (csaUp && momUp) return 'CSM BUY';
  if (csaDn && momDn) return 'CSM SELL';
  if (csaUp) return 'CSAK BUY';
  if (csaDn) return 'CSAK SELL';
  return null;
}

function reentryTag(x) {
  if (!x || x.state !== 'READY') return null;
  if (x.reentry === 'REENTRY_UP_ZONE') return { dir: 'BUY', text: 'TF1 Reentry H1' };
  if (x.reentry === 'REENTRY_DOWN_ZONE') return { dir: 'SELL', text: 'TF1 Reentry H1' };
  return null;
}
function rejectSide(x) {
  if (!x || x.state !== 'READY') return null;
  if (x.zone === 'BELOW_LOW_BB') return { atLower: true };
  if (x.zone === 'ABOVE_TOP_BB') return { atLower: false };
  if (x.momentum === 'MOMENTUM_DOWN' && x.zone === 'LOW_TO_MID') return { atLower: true };
  if (x.momentum === 'MOMENTUM_UP' && x.zone === 'MID_TO_TOP') return { atLower: false };
  return null;
}
function rejectTag(x) {
  const side = rejectSide(x);
  if (!side) return null;
  const v = x.values;
  const csm = csmOf(x);
  const dir = side.atLower ? 'BUY' : 'SELL';
  const ema50Tag = v ? (side.atLower ? v.ema50 > v.bb.mid : v.ema50 < v.bb.mid) : false;
  return { dir, text: 'TF2 Reject' + (ema50Tag ? ' EMA50' : '') + ' at ' + (side.atLower ? 'Lower' : 'Upper') + ' BB M15' + (csm ? ' + ' + csm : '') };
}
function m5Tag(x) {
  if (!x || x.state !== 'READY') return null;
  if (x.extreme === 'EXTREME_HIGH') return { dir: 'SELL', text: 'TF3 Extreme M5' };
  if (x.extreme === 'EXTREME_LOW') return { dir: 'BUY', text: 'TF3 Extreme M5' };
  const csm = csmOf(x);
  if (csm) return { dir: csm.includes('BUY') ? 'BUY' : 'SELL', text: 'TF3 ' + csm + ' M5' };
  return null;
}

/* One symbol scan.
 * m5Bars  : Dukascopy m5 (~7d) -> M5/M15/H1 execution TFs
 * m15Bars : Dukascopy m15 (~90d) -> H4/D1 context
 * extra   : { W1: bars } optional (weekly agreement check) */
function scanSymbol(symbol, m5Bars, m15Bars, extra) {
  if (!Array.isArray(m5Bars) || m5Bars.length < 24 * 12) return { symbol, state: 'INSUFFICIENT_DATA' };
  const now = Date.now();
  const m5e = toEngineBars(m5Bars.filter(b => Date.parse(b.time) + 5 * 60000 <= now).slice(-120));
  const m15 = resampleFromM5(m5Bars, 15);
  const h1 = resampleFromM5(m5Bars, 60);
  const m15e = toEngineBars(m15);
  const h1e = toEngineBars(h1);

  const hasCtx = Array.isArray(m15Bars) && m15Bars.length > 150;
  const h4 = hasCtx ? toEngineBars(resampleUp(m15Bars, 240)) : [];
  const d1 = hasCtx ? toEngineBars(resampleUp(m15Bars, 1440)) : [];
  const w1 = extra && Array.isArray(extra.W1) && extra.W1.length >= 2 ? toEngineBars(extra.W1) : [];

  const h1x = Engine.classify(h1e);
  const m15x = Engine.classify(m15e);
  const m5x = Engine.classify(m5e);
  const h4x = h4.length >= 50 ? Engine.classify(h4) : null;
  const d1x = d1.length >= 50 ? Engine.classify(d1) : null;
  const w1x = w1.length >= 50 ? Engine.classify(w1) : null;

  const tf1 = reentryTag(h1x);
  if (!tf1) return { symbol, state: 'NO_SIGNAL' };

  // SharpShooter rule: the weekly trend must agree — a conflict downgrades to WATCH.
  const w1Conflicts = !!(w1x && w1x.state === 'READY' && w1x.trend !== 'MIXED' &&
    ((w1x.trend === 'DOWN' && tf1.dir === 'BUY') || (w1x.trend === 'UP' && tf1.dir === 'SELL')));

  const tf2 = rejectTag(m15x) || { dir: tf1.dir, text: 'TF2 NONE M15' };
  const tf3 = m5Tag(m5x) || null;
  const aligned = tf2.dir === tf1.dir && (!tf3 || tf3.dir === tf1.dir);
  if (!aligned) return { symbol, state: 'CONFLICT' };

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
  const action = w1Conflicts ? (dir === 'BUY' ? 'Buy (WATCH)' : 'Sell (WATCH)') : (dir === 'BUY' ? 'Buy Now!' : 'Sell Now!');
  const tf3Text = tf3 ? (fullSetup ? 'TF3 Full Setup M5' : tf3.text) : 'TF3 NONE M5';

  // Cascade context (D1 / H4 / W1) — the "combined one signal" view.
  const ctx = [];
  if (d1x) ctx.push('D1 ' + d1x.trend + (d1x.reentry !== 'NONE' ? ' · Reentry ' + (d1x.reentry === 'REENTRY_UP_ZONE' ? 'Buy' : 'Sell') : ''));
  if (h4x) {
    let t = 'H4 ' + h4x.trend;
    const r = rejectSide(h4x);
    if (r) t += ' · Reject ' + (r.atLower ? 'Lower' : 'Upper') + ' BB';
    ctx.push(t);
  }
  if (w1x) ctx.push('W1 ' + w1x.trend + (w1Conflicts ? ' (CONFLICTS — watch only)' : ''));

  return {
    symbol, state: 'SIGNAL', action, dir, w1Conflicts,
    lines: [tf1.text, tf2.text, tf3Text],
    context: ctx,
    entry, sl, tp1, tp2, atr14,
    decimals: entry > 1000 ? 1 : entry > 50 ? 3 : 5,
    m15Time: lastM15.time
  };
}

/* Card — the live-signal channel structure + the SharpShooter cascade context line. */
function renderCard(s, { now = Date.now() } = {}) {
  const d = s.decimals;
  const f = v => Number(v).toFixed(d);
  const myt = new Date(now + 8 * 3600000);
  const stamp = myt.toISOString().slice(0, 16).replace('T', ' ');
  const head = (s.dir === 'BUY' ? '🟢' : '🔴') + ' <b>' + s.symbol + ' H1  ' + s.action + '</b>';
  return [
    head,
    (s.context && s.context.length) ? 'Cascade: ' + s.context.join(' · ') : null,
    s.lines.join('\n'),
    'Stop Loss: <b>' + f(s.sl) + '</b>',
    'Take Profit: <b>' + f(s.tp1) + ' / ' + f(s.tp2) + '</b>',
    '',
    'Trailing: close on M5 MA5/MA10 break or BB touch',
    'Cut loss: on opposite CSM signal or EMA50 M15 cross',
    s.w1Conflicts ? '⚠️ Weekly trend conflicts — WATCH, reduce size or wait for W1 agreement' : null,
    '',
    'Entry ref ' + f(s.entry) + ' · SL = 1×ATR14(M15) · TP = 1R/2R · M15 closed ' + new Date(s.m15Time).toISOString().slice(11, 16) + 'Z',
    '📡 BBMA Oma Ally Analyzer — deterministic MTF scan (D1/H4/W1/H1/M15/M5 Dukascopy). Research context, not a direction call.',
    '🕒 ' + stamp + ' MYT'
  ].filter(Boolean).join('\n');
}

module.exports = { scanSymbol, renderCard, resampleFrom, resampleFromM5, resampleUp, weeklyBars, csmOf, _tags: { reentryTag, rejectTag, m5Tag, rejectSide, csmOf } };
