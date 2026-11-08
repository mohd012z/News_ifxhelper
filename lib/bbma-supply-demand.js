/* bbma-supply-demand.js — Supply & Demand zone detection (pure, no lookahead).
 *
 * Parity with the native engine: mirrors myaichart SupplyDemand.kt
 * (detect(candles, config) -> zones[]; unmitigated(zones, candles) -> zones[])
 * so web and native produce identical zones for the same bars.
 *
 * Algorithm (base + impulse):
 *   for i in baseBars..len-1:
 *     base    = candles[i-baseBars .. i)          // the "formation"
 *     impulse = candles[i]                         // the breakout bar
 *     threshold = max(minImpulseBody, mean(|base body|) * impulseMultiplier)
 *     |impulse.body| must exceed threshold (a genuine break, not noise)
 *     low = min(base.low); high = max(base.high)
 *     impulse closes ABOVE base high  (bullish)  -> DEMAND zone {low, high}
 *     impulse closes BELOW base low   (bearish)  -> SUPPLY zone {low, high}
 *   A zone is unmitigated while NO later candle's [low, high] band overlaps
 *   it after confirmation (a touch mitigates -> the zone is greyed/dropped).
 *
 * Candles: {time, open, high, low, close} (time = ISO string OR epoch ms; the
 * detector only needs ordering + OHLC). Output zones carry epoch ms.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.BBMA_SupplyDemand = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 };

  function tOf(c) {
    if (typeof c.time === 'number') return c.time;
    if (c.t != null) return c.t;
    var n = Date.parse(c.time);
    return isNaN(n) ? null : n;
  }

  function detect(candles, config) {
    config = Object.assign({}, DEFAULTS, config || {});
    var baseBars = config.baseBars, mult = config.impulseMultiplier, minBody = config.minImpulseBody;
    if (baseBars < 1 || baseBars > 10) throw new Error('baseBars must be 1..10');
    if (!(mult > 0) || !isFinite(mult)) throw new Error('impulseMultiplier must be > 0');
    if (minBody < 0 || !isFinite(minBody)) throw new Error('minImpulseBody must be >= 0');
    if (!Array.isArray(candles) || candles.length <= baseBars) return [];
    // strictly ascending times (parity with the Kotlin require)
    for (var i = 0; i + 1 < candles.length; i++) {
      var a = tOf(candles[i]), b = tOf(candles[i + 1]);
      if (a == null || b == null || !(a < b)) throw new Error('candles must be strictly ascending by time');
    }
    var out = [];
    for (var k = baseBars; k < candles.length; k++) {
      var base = candles.slice(k - baseBars, k);
      var impulse = candles[k];
      var meanBody = 0;
      for (var j = 0; j < base.length; j++) meanBody += Math.abs(base[j].close - base[j].open);
      meanBody /= base.length;
      var body = Math.abs(impulse.close - impulse.open);
      var threshold = Math.max(minBody, meanBody * mult);
      if (body <= threshold || body === 0) continue;
      var low = Infinity, high = -Infinity;
      for (var m = 0; m < base.length; m++) {
        if (base[m].low < low) low = base[m].low;
        if (base[m].high > high) high = base[m].high;
      }
      var kind;
      if (impulse.close > impulse.open && impulse.close > high) kind = 'DEMAND';
      else if (impulse.close < impulse.open && impulse.close < low) kind = 'SUPPLY';
      else continue;
      out.push({
        kind: kind,
        low: low,
        high: high,
        formedAtMs: tOf(base[0]),
        confirmedAtMs: tOf(impulse),
        impulseIndex: k,
        baseStartIndex: k - baseBars,
        baseEndIndex: k - 1
      });
    }
    return out;
  }

  function unmitigated(zones, candles) {
    return zones.filter(function (z) {
      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        if (tOf(c) > z.confirmedAtMs && c.low <= z.high && c.high >= z.low) return false;
      }
      return true;
    });
  }

  // Convenience: zones still active on the latest bar, extended to `toMs` for
  // rendering ("zone to now" bands). Returns [{kind,low,high,formTime,toTime,active}].
  function activeBands(candles, config) {
    var zones = detect(candles, config);
    var live = unmitigated(zones, candles);
    var toMs = candles.length ? tOf(candles[candles.length - 1]) : 0;
    return live.map(function (z) {
      return { kind: z.kind, low: z.low, high: z.high, formTime: z.formedAtMs, toTime: toMs, active: true };
    });
  }

  return { detect: detect, unmitigated: unmitigated, activeBands: activeBands, DEFAULTS: DEFAULTS };
});
