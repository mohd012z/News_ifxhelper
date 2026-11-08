/* bbma-indicators.js — pure, deterministic indicator math for the Charts-tab
 * fullview templates. No look-ahead: every value at index i uses only bars
 * [0..i]. Shared by the browser chart (bbma-fullview.js) and unit tests.
 *
 * UMD: browser global window.BBMA_Indicators + CommonJS export for tests.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.BBMA_Indicators = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Simple moving average at index i (window n). null while warm-up.
  function smaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var s = 0;
    for (var j = i + 1 - n; j <= i; j++) s += arr[j];
    return s / n;
  }

  // Exponential moving average, seed = first close. null while warm-up.
  function emaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var k = 2 / (n + 1), e = arr[0];
    for (var j = 1; j <= i; j++) e = arr[j] * k + e * (1 - k);
    return e;
  }

  // Wilder RSI (14 default). out[i] in [0,100], null while warm-up.
  function rsi(closes, period) {
    period = period || 14;
    var n = closes.length;
    var out = new Array(n).fill(null);
    if (n <= period) return out;
    var g = 0, l = 0;
    for (var i = 1; i <= period; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    var avgG = g / period, avgL = l / period;
    out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (var i2 = period + 1; i2 < n; i2++) {
      var d2 = closes[i2] - closes[i2 - 1];
      var up = d2 > 0 ? d2 : 0, dn = d2 < 0 ? -d2 : 0;
      avgG = (avgG * (period - 1) + up) / period;
      avgL = (avgL * (period - 1) + dn) / period;
      out[i2] = avgL === 0 ? 100 : (avgG === 0 ? 0 : 100 - 100 / (1 + avgG / avgL));
    }
    return out;
  }

  // MACD (12,26,9). {line, signal, hist} arrays (null during warm-up).
  function macd(closes, fast, slow, sig) {
    fast = fast || 12; slow = slow || 26; sig = sig || 9;
    var n = closes.length;
    var line = new Array(n).fill(null), signal = new Array(n).fill(null), hist = new Array(n).fill(null);
    if (n < slow + sig - 1) return { line: line, signal: signal, hist: hist };
    var ef = emaAt(closes, fast, 0); // seed (only valid once warm)
    // compute two EMA series over the whole range
    var emaF = new Array(n), emaS = new Array(n);
    var kf = 2 / (fast + 1), ks = 2 / (slow + 1);
    emaF[0] = closes[0]; emaS[0] = closes[0];
    for (var i = 1; i < n; i++) {
      emaF[i] = closes[i] * kf + emaF[i - 1] * (1 - kf);
      emaS[i] = closes[i] * ks + emaS[i - 1] * (1 - ks);
    }
    for (var j = slow - 1; j < n; j++) line[j] = emaF[j] - emaS[j];
    // signal = EMA of the (non-null) macd line, seeded at the first line value
    var seedIdx = slow - 1;
    var ksg = 2 / (sig + 1), sigVal = line[seedIdx];
    for (var k = seedIdx; k < n; k++) {
      if (k === seedIdx) sigVal = line[k];
      else sigVal = line[k] * ksg + sigVal * (1 - ksg);
      signal[k] = sigVal;
      hist[k] = line[k] - sigVal;
    }
    return { line: line, signal: signal, hist: hist };
  }

  // Session-anchored VWAP (resets each UTC day). Bars carry high/low/close.
  // Volume proxy = (high-low) range per bar (no real tick volume in the desk
  // feed); the shape is what matters for a level overlay. out[i] = vwap, null
  // before the first bar of the session completes.
  function vwap(bars) {
    var n = bars.length;
    var out = new Array(n).fill(null);
    var day = null, pv = 0, vv = 0;
    for (var i = 0; i < n; i++) {
      var b = bars[i];
      var d = (typeof b._day === 'number') ? b._day : Math.floor(b.time / 86400);
      if (day === null) day = d;
      if (d !== day) { day = d; pv = 0; vv = 0; }
      var tp = (b.high + b.low + b.close) / 3;
      var vol = Math.max(0, b.high - b.low);
      pv += tp * vol; vv += vol;
      out[i] = vv > 0 ? pv / vv : tp;
    }
    return out;
  }

  return { smaAt: smaAt, emaAt: emaAt, rsi: rsi, macd: macd, vwap: vwap };
});
