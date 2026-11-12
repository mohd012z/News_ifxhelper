/* lib/bbma-ew-enhance.js — Elliott Wave v2.9 enhancement of BBMA Oma signals.
 *
 * The BBMA pipeline (bbma-oma-signals.js) is deterministic MTF reentry/reject with
 * SL = 1xATR14(M15), TP = 1R/2R. Elliott Wave adds the missing PREDICTION layer the
 * pro channels publish up-front (E1.2 study, 2026-11-12):
 *   - a STRUCTURAL stop (wave-4 territory / W1-origin re-entry) instead of a purely
 *     volatility-based ATR stop,
 *   - a CONFLUENCE target (2+ fib methods agreeing) instead of blind 1R/2R,
 *   - a HIGHER-DEGREE bias gate (counter-degree setups downgraded, not dropped).
 *
 * `ewEnhance()` takes an existing bbma-oma SIGNAL object + the bars used to build it
 * and returns the SAME object with an added `ew` field:
 *   { ew: null }                       — fail-closed (engine absent / no count / no H1 bars)
 *   { ew: { ok, dir, count, stop, stopBasis, target, targetNote, rr, aligned, note } }
 * When ew.ok the enhancer ALSO tightens the trade levels the card shows:
 *   - sl  := the tighter of (ATR stop, structural stop) measured from entry,
 *   - tp1 := the confluence target when its R:R beats the ATR 1R, tp2 kept at 2x new risk.
 * The original values are preserved as atrSl / atrTp1 / atrTp2 for audit.
 *
 * Pure + deterministic (no I/O, no Date.now in the returned numbers). Node + browser.
 */
'use strict';

function EW() {
  if (typeof require === 'function') { try { return require('./elliott-wave.js'); } catch (e) { /* fall through */ } }
  if (typeof module === 'object' && module.exports) return null;
  return (typeof window !== 'undefined') ? window.BBMA_EW : null;
}

/* bars: [{t(ms or s), o,h,l,c}] -> normalized {t(s),h,l} for the EW engine. */
function toEngineBars(bars) {
  const out = [];
  for (const b of bars || []) {
    let t = b.t != null ? b.t : b.time;
    if (t == null) continue;
    if (t > 1e12) t = Math.round(t / 1000); // ms -> s
    const h = b.h != null ? b.h : b.high;
    const l = b.l != null ? b.l : b.low;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
    out.push({ t: Math.round(t), high: h, low: l, close: b.c != null ? b.c : b.close });
  }
  return out;
}

/* Structural stop for the signal direction, clamped to the correct side of entry. */
function structuralStopFor(E, count, dir, entry) {
  const probe = { type: count.type, dir, pivots: count.pivots };
  const ss = E.structStop(probe, entry);
  // ensure the stop is on the risk side of entry
  if (dir === 1 && ss.level >= entry) ss.level = entry - ss.minDist;
  if (dir === -1 && ss.level <= entry) ss.level = entry + ss.minDist;
  return ss;
}

/*
 * ewEnhance(signal, { h1Bars, h4Bars, d1Bars, minRR })
 *   signal  : object from bbma-oma-signals scanSymbol with state==='SIGNAL'
 *             { entry, sl, tp1, tp2, dir:'BUY'|'SELL', atr14, ... }
 *   h1Bars  : H1 bars (execution context count) — required
 *   h4Bars/d1Bars : optional higher degrees for the bias gate
 *   minRR   : default 1.0
 * Returns a NEW object (signal is not mutated).
 */
function ewEnhance(signal, ctx = {}) {
  if (!signal || signal.state !== 'SIGNAL') return signal;
  const E = EW();
  const out = Object.assign({}, signal);
  const ew = { ok: false, dir: null, count: null, stop: null, stopBasis: null,
               target: null, targetNote: null, rr: null, aligned: null, note: null };
  if (!E) { out.ew = ew; ew.note = 'ew engine absent (fail-closed)'; return out; }

  const h1 = toEngineBars(ctx.h1Bars || []);
  if (h1.length < 40) { out.ew = ew; ew.note = 'insufficient H1 bars (fail-closed)'; return out; }
  const entry = signal.entry;
  const dir = signal.dir === 'BUY' ? 1 : -1;

  let a;
  try { a = E.autoCount(h1, 2); } catch (e) { a = null; }
  if (!a || !a.count || !a.count.pivots || a.count.pivots.length < 4) {
    out.ew = ew; ew.note = 'no H1 count (fail-closed)'; return out;
  }

  // HTF bias: prefer D1, else H4, else null (gate off)
  let htfDir = null;
  const htfBars = toEngineBars((ctx.d1Bars && ctx.d1Bars.length >= 40) ? ctx.d1Bars : (ctx.h4Bars || []));
  if (htfBars.length >= 40) {
    try { const h = E.autoCount(htfBars, 2); if (h && h.count) htfDir = h.dir || null; } catch (e) { htfDir = null; }
  }

  const tr = E.tradeable(a.count, a.forecast, { price: entry, htfDir: htfDir, minRR: ctx.minRR != null ? ctx.minRR : 1.0 });
  ew.count = a.count.type + (a.count.dir === 1 ? ' up' : ' down');
  ew.dir = a.count.dir;
  ew.stop = tr.stop ? tr.stop.level : null;
  ew.stopBasis = tr.stop ? tr.stop.basis : null;
  ew.target = tr.target ? tr.target.price : null;
  ew.targetNote = tr.target ? tr.target.note : null;
  ew.rr = tr.target ? tr.target.rr : null;
  ew.aligned = tr.bias ? tr.bias.aligned : null;
  ew.ok = !!tr.ok;
  ew.note = (tr.bias && tr.bias.note) + (tr.target && tr.target.belowMinRR ? ' · target below minRR' : '');

  if (tr.ok && tr.stop && tr.target) {
    // confluence target must be on the signal's side (the count may be counter-degree
    // in price terms); otherwise keep the ATR targets untouched.
    const tgtForward = dir === 1 ? tr.target.price > entry : tr.target.price < entry;
    if (tgtForward) {
      // tighten the stop to the tighter of (ATR, structural) on the risk side
      const atrSl = signal.sl;
      const structSl = dir === 1 ? Math.min(atrSl, tr.stop.level) : Math.max(atrSl, tr.stop.level);
      out.atrSl = atrSl;
      out.sl = structSl;
      const risk = Math.abs(entry - out.sl);
      if (risk > 0) {
        const rrTgt = Math.abs(tr.target.price - entry) / risk;
        if (rrTgt >= 1.0) {
          out.atrTp1 = signal.tp1;
          out.atrTp2 = signal.tp2;
          out.tp1 = tr.target.price;                        // confluence target as TP1
          out.tp2 = dir === 1 ? entry + 2 * risk : entry - 2 * risk; // 2R on new risk
        }
      }
      out.ewStop = tr.stop.level;
      out.ewTarget = tr.target.price;
    } else {
      ew.note = (ew.note || '') + ' · target counter-side (kept ATR levels)';
    }
  }
  out.ew = ew;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ewEnhance, toEngineBars, structuralStopFor };
}
if (typeof window !== 'undefined') window.BBMA_EWEnhance = { ewEnhance, toEngineBars, structuralStopFor };
