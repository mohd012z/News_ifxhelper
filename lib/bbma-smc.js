/* bbma-smc.js — Smart Money Concepts (SMC) engine, pure + no-lookahead, UMD.
 *
 * Port of the concepts in:
 *   - kxngHADES/SMC-Marking (Pine v6): swing structure HH/HL/LH/LL, BOS/BMS vs
 *     CHoCH (break by close or wick), Order Blocks (extreme bar before a
 *     structure break), 3-candle Fair Value Gaps, current trading range with
 *     Premium/Discount/Equilibrium, Equal Highs/Lows liquidity.
 *   - "Sweep [pandich]": liquidity-sweep reversal (wick takes the extreme of the
 *     previous N bars, closes back inside with a reversal body in the far half)
 *     + trade plan (entry = close, stop = wick ± 0.2×ATR buffer, clamped to
 *     [0.5×ATR, 3×ATR], targets 1R/2R/3R).
 *
 * Candles: {time, open, high, low, close} + optional volume. `time` = epoch
 * ms or ISO string (only ordering + OHLC are used). All outputs carry epoch ms.
 *
 * No-lookahead rule: a swing prints at `bar + len` (it needs `len` right bars);
 * breaks, OBs and sweeps are confirmed on the CLOSE of the breaking bar and are
 * never revised afterwards.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BBMA_SMC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function tOf(c) { var t = c.time != null ? c.time : c.t; if (typeof t === 'number') return t; var n = Date.parse(t); return isNaN(n) ? 0 : n; }
  function clamp(x, a, b) { return Math.min(Math.max(x, a), b); }

  // --- Wilder ATR (period default 14) -----------------------------------------
  function atr(candles, period) {
    period = period || 14;
    var n = candles.length;
    if (n < period + 1) return null;
    var prevHL = 0;
    for (var i = 1; i <= period; i++) {
      var c = candles[i], pc = candles[i - 1];
      prevHL += Math.max(c.high - c.low, Math.abs(c.high - pc.close), Math.abs(c.low - pc.close));
    }
    prevHL /= period;
    var a = prevHL;
    for (var j = period + 1; j < n; j++) {
      var cj = candles[j], pj = candles[j - 1];
      var tr = Math.max(cj.high - cj.low, Math.abs(cj.high - pj.close), Math.abs(cj.low - pj.close));
      a = (a * (period - 1) + tr) / period;
    }
    return a;
  }

  // --- Fractal swings: pivot at bar i, printed at i+len ------------------------
  function swings(candles, len) {
    len = Math.max(1, len | 0);
    var n = candles.length, out = [];
    if (n < len * 2 + 1) return out;
    for (var i = len; i < n - len; i++) {
      var hi = -Infinity, lo = Infinity, hiOk = true, loOk = true;
      for (var k = i - len; k <= i + len; k++) {
        if (k === i) continue;
        var c = candles[k];
        // strict (ties do NOT disqualify — matches ta.pivothigh/tapivotlow, which
        // take the LATER bar on an exact tie)
        if (c.high > candles[i].high) hiOk = false;
        if (c.low < candles[i].low) loOk = false;
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (hiOk) out.push({ kind: 'H', price: candles[i].high, bar: i, time: tOf(candles[i]) });
      if (loOk) out.push({ kind: 'L', price: candles[i].low, bar: i, time: tOf(candles[i]) });
    }
    out.sort(function (a, b) { return a.bar - b.bar; });
    return out;
  }

  // --- Market structure: HH/HL/LH/LL + BOS/BMS (continuation) & CHoCH (reversal)
  // A swing is *confirmed* at bar `sv.bar + len` (it needs `len` bars on the right).
  // We iterate bar by bar: at each bar we (1) commit any swing that becomes known
  // this bar (and emit its HH/HL/LH/LL label), then (2) check the break condition
  // on this bar against the latest confirmed level — exactly how the Pine runs it
  // (the break is evaluated on every candle, not only at pivot bars). No lookahead:
  // a level is only used once its confirming bar has closed.
  function structure(candles, len, byWick) {
    len = len || 5;
    var s = swings(candles, len);
    // map confirmation-bar -> list of swings confirmed there
    var byCb = {};
    for (var i = 0; i < s.length; i++) {
      var cb = s[i].bar + len;
      (byCb[cb] = byCb[cb] || []).push(s[i]);
    }
    var lastH = null, lastL = null, trend = 0;
    var labels = [], breaks = [];
    for (var b = 0; b < candles.length; b++) {
      var close = candles[b].close, high = candles[b].high, low = candles[b].low;
      var conf = byCb[b];
      if (conf) {
        for (var j = 0; j < conf.length; j++) {
          var sv = conf[j];
          if (sv.kind === 'H') {
            if (lastH) labels.push({ tag: sv.price > lastH.level ? 'HH' : 'LH', kind: 'H', price: sv.price, bar: sv.bar, time: sv.time, close: close, high: high, low: low });
            lastH = { level: sv.price, bar: sv.bar, time: sv.time };
          } else {
            if (lastL) labels.push({ tag: sv.price < lastL.level ? 'LL' : 'HL', kind: 'L', price: sv.price, bar: sv.bar, time: sv.time, close: close, high: high, low: low });
            lastL = { level: sv.price, bar: sv.bar, time: sv.time };
          }
        }
      }
      var upSrc = byWick ? high : close;
      var dnSrc = byWick ? low : close;
      if (lastH && upSrc > lastH.level) {
        var isChoch = trend === -1;
        breaks.push({ type: isChoch ? 'CHoCH' : 'BOS', dir: 'bull', level: lastH.level, bar: b, time: tOf(candles[b]), tag: isChoch ? 'CHoCH' : 'BOS', close: close, high: high, low: low });
        trend = 1;
      }
      if (lastL && dnSrc < lastL.level) {
        var isChoch2 = trend === 1;
        breaks.push({ type: isChoch2 ? 'CHoCH' : 'BOS', dir: 'bear', level: lastL.level, bar: b, time: tOf(candles[b]), tag: isChoch2 ? 'CHoCH' : 'BOS', close: close, high: high, low: low });
        trend = -1;
      }
    }
    breaks.sort(function (a, b) { return a.bar - b.bar; });
    return { trend: trend, labels: labels, breaks: breaks };
  }

  // --- Order Blocks (supply & demand) -----------------------------------------
  // Demand OB: the bar with the LOWEST low before a bullish structure break.
  // Supply OB: the bar with the HIGHEST high before a bearish structure break.
  // Zone = that bar's [low, high]. Mitigated when a later close (or wick) goes
  // through the zone. Kept per side, newest first, bounded to maxPerSide.
  function orderBlocks(candles, struct, maxPerSide, mitigByWick) {
    maxPerSide = maxPerSide || 3;
    var demand = [], supply = [];
    for (var i = 0; i < (struct.breaks || []).length; i++) {
      var b = struct.breaks[i];
      if (b.dir === 'bull') {
        var lo = Infinity, idx = -1;
        for (var k = 1; k < b.bar; k++) if (candles[k].low < lo) { lo = candles[k].low; idx = k; }
        if (idx >= 0) demand.unshift({ kind: 'DEMAND_OB', time: tOf(candles[idx]), bar: idx, low: candles[idx].low, high: candles[idx].high, active: true });
      } else {
        var hi = -Infinity, idx2 = -1;
        for (var m = 1; m < b.bar; m++) if (candles[m].high > hi) { hi = candles[m].high; idx2 = m; }
        if (idx2 >= 0) supply.unshift({ kind: 'SUPPLY_OB', time: tOf(candles[idx2]), bar: idx2, low: candles[idx2].low, high: candles[idx2].high, active: true });
      }
    }
    for (var d = 0; d < demand.length; d++) {
      var dz = demand[d];
      for (var c = dz.bar + 1; c < candles.length; c++) {
        if (candles[c].close < dz.low || (mitigByWick && candles[c].low < dz.low)) { dz.active = false; break; }
      }
    }
    for (var sp = 0; sp < supply.length; sp++) {
      var sz = supply[sp];
      for (var e = sz.bar + 1; e < candles.length; e++) {
        if (candles[e].close > sz.high || (mitigByWick && candles[e].high > sz.high)) { sz.active = false; break; }
      }
    }
    return {
      demand: demand.filter(function (z) { return z.active; }).slice(0, maxPerSide),
      supply: supply.filter(function (z) { return z.active; }).slice(0, maxPerSide)
    };
  }

  // --- Fair Value Gaps (3-candle imbalance) ------------------------------------
  // Bull FVG: low[i] > high[i-2]  (gap = [high[i-2], low[i]]).
  // Bear FVG: high[i] < low[i-2]  (gap = [high[i], low[i-2]]).
  // A gap shrinks while price partially fills it and is removed (gap fill) when
  // price trades through it. Kept per side, bounded to maxPerSide.
  function fvg(candles, maxPerSide) {
    maxPerSide = maxPerSide || 4;
    var bull = [], bear = [];
    for (var i = 2; i < candles.length; i++) {
      if (candles[i].low > candles[i - 2].high) bull.unshift({ kind: 'BULL_FVG', time: tOf(candles[i - 1]), bar: i, top: candles[i].low, bottom: candles[i - 2].high, active: true });
      if (candles[i].high < candles[i - 2].low) bear.unshift({ kind: 'BEAR_FVG', time: tOf(candles[i - 1]), bar: i, top: candles[i - 2].low, bottom: candles[i].high, active: true });
    }
    for (var b = 0; b < bull.length; b++) {
      var g = bull[b];
      for (var k = g.bar + 1; k < candles.length; k++) {
        if (candles[k].low <= g.bottom) { g.active = false; break; }
        if (candles[k].low < g.top) g.top = candles[k].low;
      }
      if (g.active && g.top <= g.bottom + 1e-12) g.active = false;
    }
    for (var v = 0; v < bear.length; v++) {
      var g2 = bear[v];
      for (var m = g2.bar + 1; m < candles.length; m++) {
        if (candles[m].high >= g2.top) { g2.active = false; break; }
        if (candles[m].high > g2.bottom) g2.bottom = candles[m].high;
      }
      if (g2.active && g2.bottom >= g2.top - 1e-12) g2.active = false;
    }
    return {
      bull: bull.filter(function (z) { return z.active && z.top > z.bottom; }).slice(0, maxPerSide),
      bear: bear.filter(function (z) { return z.active && z.top > z.bottom; }).slice(0, maxPerSide)
    };
  }

  // --- Current trading range + Premium / Discount / Equilibrium -----------------
  // Range expands in real time: a new extreme moves its edge; the opposite edge
  // moves to the newest confirmed swing on that side (mirrors SMC-Marking).
  function tradingRange(candles, struct, depthPct, offsetPct, eqPct) {
    depthPct = depthPct == null ? 20 : depthPct;
    offsetPct = offsetPct == null ? 5 : offsetPct;
    eqPct = eqPct == null ? 5 : eqPct;
    var lastH = null, lastL = null, rTop = null, rBot = null;
    var s = (struct && struct.labels) || [];
    for (var i = 0; i < s.length; i++) {
      if (s[i].kind === 'H') lastH = s[i]; else lastL = s[i];
      if (lastH && lastL) {
        rTop = Math.max(lastH.price, lastL.price);
        rBot = Math.min(lastH.price, lastL.price);
        break;
      }
    }
    if (rTop == null) return null;
    for (var k = 0; k < candles.length; k++) {
      var c = candles[k];
      if (c.high > rTop) {
        rTop = c.high;
        if (lastL && lastL.bar > k - 1) { /* opposite edge stays */ }
      }
      if (c.low < rBot) rBot = c.low;
    }
    if (rTop <= rBot) return null;
    var span = rTop - rBot;
    var mid = rBot + span / 2;
    var eqHalf = span * (eqPct / 100) / 2;
    return {
      top: rTop, bottom: rBot, mid: mid,
      eqTop: mid + eqHalf, eqBottom: mid - eqHalf,
      premTop: rTop - span * (offsetPct / 100),
      premBottom: rTop - span * ((offsetPct + depthPct) / 100),
      discTop: rBot + span * ((offsetPct + depthPct) / 100),
      discBottom: rBot + span * (offsetPct / 100)
    };
  }

  // --- Equal Highs / Lows (resting liquidity) ----------------------------------
  // Two same-side swings within threshold×ATR of each other = EQH/EQL.
  function equalHighs(candles, len, thrAtr, atrVal) {
    len = len || 3;
    thrAtr = thrAtr == null ? 0.1 : thrAtr;
    if (atrVal == null) atrVal = atr(candles, 14);
    if (!atrVal) return { eqh: [], eql: [] };
    var th = thrAtr * atrVal;
    var hs = [], ls = [];
    var s = swings(candles, len);
    for (var i = 0; i < s.length; i++) (s[i].kind === 'H' ? hs : ls).push(s[i]);
    var eqh = [], eql = [];
    for (var a = 0; a < hs.length; a++) {
      for (var b = a + 1; b < hs.length; b++) {
        if (Math.abs(hs[a].price - hs[b].price) < th) {
          eqh.push({ kind: 'EQH', price: (hs[a].price + hs[b].price) / 2, t1: hs[a].time, t2: hs[b].time, b1: hs[a].bar, b2: hs[b].bar });
          break;
        }
      }
    }
    for (var c = 0; c < ls.length; c++) {
      for (var d = c + 1; d < ls.length; d++) {
        if (Math.abs(ls[c].price - ls[d].price) < th) {
          eql.push({ kind: 'EQL', price: (ls[c].price + ls[d].price) / 2, t1: ls[c].time, t2: ls[d].time, b1: ls[c].bar, b2: ls[d].bar });
          break;
        }
      }
    }
    return { eqh: eqh.slice(-3), eql: eql.slice(-3) };
  }

  // --- Sweep reversal (Sweep [pandich]) -----------------------------------------
  // A bar's wick takes out the extreme of the previous N bars (default 20) and
  // the bar CLOSES back inside that range with a reversal body sitting in the
  // far half of the bar -> liquidity sweep / stop-run. Entry = close of the
  // signal bar. Stop = behind the sweep wick + buffer×ATR, clamped to
  // [minStop×ATR, maxStop×ATR] (skip when wider than maxStop). Targets = 1R/2R/3R.
  // Optional volume filter: volume must exceed volMult×20-bar average (0 = off).
  function sweep(candles, params) {
    params = params || {};
    var lookback = params.lookback || 20;
    var buf = params.bufferAtr == null ? 0.2 : params.bufferAtr;
    var minStop = params.minStopAtr == null ? 0.5 : params.minStopAtr;
    var maxStop = params.maxStopAtr == null ? 3.0 : params.maxStopAtr;
    var volMult = params.volMult == null ? 0 : params.volMult;
    var n = candles.length;
    if (n < lookback + 2) return null;
    var a = atr(candles, params.atrPeriod || 14);
    if (a == null) return null;
    var i = n - 1;
    var lo = Infinity, hi = -Infinity;
    for (var k = 1; k <= lookback; k++) {
      var c = candles[n - 1 - k]; // prior N bars, EXCLUDING the signal bar (n-1)
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    var last = candles[n - 1];
    var range = last.high - last.low;
    if (range <= 0) return null;
    var mid = (last.low + last.high) / 2; // "far half of the bar" = the bar's own range
    var volOk = true;
    if (volMult > 0 && last.volume != null) {
      var vs = 0;
      for (var q = 0; q < Math.min(20, n - 1); q++) vs += (candles[n - 1 - q].volume || 0);
      var meanV = vs / Math.min(20, n - 1);
      volOk = (last.volume || 0) > meanV * volMult;
    }
    if (last.low < lo && last.close > lo && volOk && last.close > mid) {
      var stop = last.low - buf * a;
      if (stop > last.close - minStop * a) stop = last.close - minStop * a;
      var risk = last.close - stop;
      if (risk > maxStop * a) return null;
      return {
        dir: 'long', bar: n - 1, time: tOf(last),
        entry: last.close, stop: stop, risk: risk,
        tp1: last.close + risk, tp2: last.close + 2 * risk, tp3: last.close + 3 * risk,
        extreme: lo, sweep: true
      };
    }
    if (last.high > hi && last.close < hi && volOk && last.close < mid) {
      var stop2 = last.high + buf * a;
      if (stop2 < last.close + minStop * a) stop2 = last.close + minStop * a;
      var risk2 = stop2 - last.close;
      if (risk2 > maxStop * a) return null;
      return {
        dir: 'short', bar: n - 1, time: tOf(last),
        entry: last.close, stop: stop2, risk: risk2,
        tp1: last.close - risk2, tp2: last.close - 2 * risk2, tp3: last.close - 3 * risk2,
        extreme: hi, sweep: true
      };
    }
    return null;
  }

  // --- Aggregate ----------------------------------------------------------------
  function compute(candles, opts) {
    opts = opts || {};
    var len = opts.swingLen || 5;
    var byWick = !!opts.byWick;
    var struct = opts.struct !== false ? structure(candles, len, byWick) : { trend: 0, labels: [], breaks: [] };
    var ob = opts.ob !== false ? orderBlocks(candles, struct, opts.obMax || 3, opts.obWick) : { demand: [], supply: [] };
    var fv = opts.fvg !== false ? fvg(candles, opts.fvgMax || 4) : { bull: [], bear: [] };
    var tr = opts.pd !== false ? tradingRange(candles, struct, opts.depthPct, opts.offsetPct, opts.eqPct) : null;
    var eq = opts.eq !== false ? equalHighs(candles, opts.eqLen || 3, opts.eqThr == null ? 0.1 : opts.eqThr, null) : { eqh: [], eql: [] };
    var sw = opts.sweep !== false ? sweep(candles, opts) : null;
    return {
      struct: struct,
      zones: ob.demand.concat(ob.supply, fv.bull, fv.bear),
      ob: ob, fvg: fv, range: tr, eq: eq, sweep: sw
    };
  }

  return {
    atr: atr,
    swings: swings,
    structure: structure,
    orderBlocks: orderBlocks,
    fvg: fvg,
    tradingRange: tradingRange,
    equalHighs: equalHighs,
    sweep: sweep,
    compute: compute
  };
});
