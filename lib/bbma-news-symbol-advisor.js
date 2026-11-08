/* bbma-news-symbol-advisor.js — deterministic, no-lookahead recommendation engine.
 *
 * Given (a) the news calendar (weekly + upcoming) and (b) per-symbol technical
 * state (BBMA trend/momentum/mhv/csa/reentry/extreme/zone + supply/demand
 * zones), it produces ranked SYMBOL RECOMMENDATIONS for the user to trade
 * around the news, with direction, confidence score, rationale and the
 * specific upcoming/weekly events driving it.
 *
 * Pure + deterministic (same inputs -> same outputs) so it is unit-testable
 * and safe to run in both the browser dashboard and CI. No network, no clock
 * dependency beyond the caller-supplied `now` (for "upcoming" filtering).
 *
 * Inputs
 *   events:  NEWS_AUTO.calendarAll-like array of {currency,country,event,
 *            importance,release:{state,actualNumeric,forecastNumeric,surprisePct},
 *            date,timeGmt,sourceHorizon,play,actual,forecast,previous}
 *   tech:    { [symbol]: { trend, momentum, mhv, csa, reentry, extreme, zone,
 *                          location, ema50Position, sd: {supply:[],demand:[]},
 *                          lastClose } }   (symbols: XAU, BTC, EURUSD, USDJPY, GBPUSD)
 *   now:     epoch ms (events after now = "upcoming")
 *
 * Output (per recommended symbol)
 *   { symbol, name, direction, score, confidence, reasons[], events[],
 *     newsBias, technicalBias, setup, risk, timeframe }
 *
 * direction  = long / short / neutral
 * confidence = low / medium / high  (driven by |score|)
 * score      = weighted sum of news impact + technical confluence, clamped 0..100
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.BBMA_NewsSymbolAdvisor = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Which symbols are affected by a news event, keyed by currency + a few
  // "macro" triggers that move gold/correlated assets.
  // Returns an array of {symbol, why} for the symbols the event touches.
  var FX_PAIRS = {
    AUD: ['AUDUSD', 'USDJPY'], JPY: ['USDJPY'], GBP: ['GBPUSD'],
    CAD: ['USDCAD'], CHF: ['USDCHF'], EUR: ['EURUSD'], CNY: []
  };
  // USD events (Fed) move the dollar index -> inverse for USD pairs, direct
  // for XAU (USD up = gold down, all else equal).
  var USD_AFFECTS = true;

  function symbolForCurrency(cur) {
    cur = String(cur || '').toUpperCase();
    return FX_PAIRS[cur] || [];
  }

  // Map one news event to the symbols it can move + the directional thesis.
  // Returns [{symbol, impact, thesis}]
  function eventToSymbols(ev, tech) {
    var out = [];
    var cur = String(ev.currency || '').toUpperCase();
    var country = String(ev.country || '').toUpperCase();
    var text = String(ev.event || '').toUpperCase();
    var imp = String(ev.importance || 'low').toLowerCase();
    // weight by importance
    var w = imp === 'high' ? 3 : imp === 'med' || imp === 'medium' ? 2 : 1;

    // Fed / USD macro -> XAU (inverse), and USD pairs
    var isFed = /FOMC|FED |FEDERAL RESERVE|POLLARD|WILLIAMS|POMPEO|DUDLEY|POWELL|FED OFFIC/.test(text) ||
      (country === 'UNITED STATES' && /INTEREST|FOMC|CPI|PCE|NONFARM|NFP|JOB|UNEMPLOYMENT|PAYROLL|GDP|INFLATION|MORTGAGE|CONSUMER/.test(text));
    var isUsdPair = cur === 'USD' || (country === 'UNITED STATES');

    function push(symbol, thesis, dir) {
      if (!symbol || !tech[symbol]) return;
      var ex = out.find(function (x) { return x.symbol === symbol; });
      if (ex) { ex.w += w; if (thesis) ex.thesis = ex.thesis + '; ' + thesis; }
      else out.push({ symbol: symbol, w: w, thesis: thesis || '', dir: dir || 0 });
    }

    // Gold: reacts to USD + real rates + risk. Fed/CPI/NFP/PCE are the big ones.
    if (isFed || isUsdPair) {
      push('XAU', (cur === 'USD' || country === 'UNITED STATES' ? 'USD macro ' : 'Fed ') + text.slice(0, 40),
        (cur === 'USD' ? -1 : -1)); // USD strength / hawkish = gold down (baseline direction)
    }
    // Crypto: broad risk / USD liquidity
    if (country === 'UNITED STATES' && /FOMC|CPI|PCE|JOB|NFP|PAYROLL|GDP/.test(text)) {
      push('BTC', 'US macro ' + text.slice(0, 40), 0);
    }
    // Direct FX pairs for the currency in question
    symbolForCurrency(cur).forEach(function (p) { push(p, cur + ' ' + text.slice(0, 40), 0); });
    // USD-pair inverse for non-USD-currency events is handled by the pair mapping
    if (isUsdPair) {
      ['EURUSD', 'USDJPY', 'GBPUSD'].forEach(function (p) {
        if (p === 'USDJPY') push('USDJPY', 'USD ' + text.slice(0, 30), 1);
        else push(p, 'USD ' + text.slice(0, 30), -1);
      });
    }
    // JPY-specific: BOJ
    if (country === 'JAPAN' && /BOJ|INTEREST|CPI|WAGE|EMPLOYMENT/.test(text)) push('USDJPY', 'BOJ ' + text.slice(0, 30), -1);
    // AUD: RBA
    if (country === 'AUSTRALIA' && /RBA|INTEREST|CPI|WAGE/.test(text)) push('AUDUSD', 'RBA ' + text.slice(0, 30), 1);
    // GBP: BoE
    if (country === 'UNITED KINGDOM' && /BOE|INTEREST|CPI|INFLATION|GDP/.test(text)) push('GBPUSD', 'BoE ' + text.slice(0, 30), 1);

    return out;
  }

  // Technical confluence for a symbol: -100 (strong short) .. +100 (strong long)
  function techBias(t) {
    if (!t) return 0;
    var s = 0;
    if (t.trend === 'UP') s += 30; else if (t.trend === 'DOWN') s -= 30;
    if (t.momentum === 'MOMENTUM_UP') s += 25; else if (t.momentum === 'MOMENTUM_DOWN') s -= 25;
    if (/VALID/.test(t.mhv || '')) s += 15;
    if (t.csa === 'CSAK_UP' || t.csak === 'CSAK_UP') s += 15;
    else if (t.csa === 'CSAK_DOWN' || t.csak === 'CSAK_DOWN') s -= 15;
    if (/REENTRY_UP/.test(t.reentry || '')) s += 15;
    else if (/REENTRY_DOWN/.test(t.reentry || '')) s -= 15;
    if (t.extreme === 'EXTREME_HIGH') s -= 12;   // stretched long -> fade risk
    else if (t.extreme === 'EXTREME_LOW') s += 12; // stretched short -> bounce risk
    // supply/demand proximity: near an unmitigated supply = short pressure,
    // near unmitigated demand = long support.
    if (t.sd && t.lastClose) {
      var near = 0;
      (t.sd.supply || []).forEach(function (z) { if (t.lastClose <= z.high * 1.01 && t.lastClose >= z.low * 0.99) near -= 10; });
      (t.sd.demand || []).forEach(function (z) { if (t.lastClose >= z.low * 0.99 && t.lastClose <= z.high * 1.01) near += 10; });
      s += Math.max(-20, Math.min(20, near));
    }
    return Math.max(-100, Math.min(100, s));
  }

  // Direction thesis from an event's release (surprise) when available.
  function surpriseDir(ev) {
    var rel = ev.release || {};
    var sp = rel.surprisePct;
    if (typeof sp === 'number' && isFinite(sp)) {
      // positive surprise = result better than forecast
      // for inflation (CPI/PCE) positive surprise = hawkish; for jobs positive = hawkish
      var hawkish = sp > 0;
      // return baseline: hawkish -> USD up -> XAU down
      return hawkish ? -1 : 1; // sign for XAU (inverse of USD)
    }
    return 0;
  }

  function recommend(events, tech, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var horizonMs = opts.horizonMs || 7 * 86400000; // "weekly" = next 7 days
    var maxOut = opts.max || 5;

    // Bucket events: past (already occurred this week) vs upcoming (next 7d).
    // ForexFactory "this week" snapshots carry RELEASE_PENDING for every row, so
    // bucket by event TIME, not state (a pending event whose time is already in
    // the past has effectively occurred — it is "this week" context).
    var upcoming = [], released = [];
    (events || []).forEach(function (ev) {
      var ts = ev._ts; // caller pre-computes epoch ms for determinism
      if (typeof ts !== 'number' || !isFinite(ts)) ts = Date.parse(ev.date + 'T00:00:00Z');
      if (!isFinite(ts)) return;
      if (ts >= now) upcoming.push({ ev: ev, ts: ts });
      else if (ts >= now - horizonMs) released.push({ ev: ev, ts: ts });
    });

    // Per-symbol accumulator
    var acc = {};
    function add(symbol, w, thesis, dir) {
      if (!tech[symbol]) return;
      var a = acc[symbol] || (acc[symbol] = { w: 0, theses: [], dirSum: 0, evs: [] });
      a.w += w;
      if (thesis) a.theses.push(thesis);
      if (dir) a.dirSum += dir;
    }

    // Weigh upcoming (this-week) events more heavily than already-released.
    upcoming.forEach(function (x) {
      eventToSymbols(x.ev, tech).forEach(function (m) {
        add(m.symbol, m.w * 2, m.thesis, m.dir);
        var a = acc[m.symbol]; if (a && !a.evs.find(function (e) { return e.event === x.ev.event; })) {
          a.evs.push({ event: x.ev.event, importance: x.ev.importance, currency: x.ev.currency, time: x.ev.timeMyt || x.ev.timeGmt || x.ev.date, state: (x.ev.release || {}).state || 'pending' });
        }
      });
    });
    released.forEach(function (x) {
      eventToSymbols(x.ev, tech).forEach(function (m) {
        add(m.symbol, m.w * 1, m.thesis, m.dir);
        var a = acc[m.symbol]; if (a && !a.evs.find(function (e) { return e.event === x.ev.event; })) {
          a.evs.push({ event: x.ev.event, importance: x.ev.importance, currency: x.ev.currency, time: x.ev.timeMyt || x.ev.timeGmt || x.ev.date, state: (x.ev.release || {}).state || 'released', surprise: (x.ev.release || {}).surprisePct });
        }
      });
    });

    // Build scored recommendations
    var recs = [];
    Object.keys(acc).forEach(function (symbol) {
      var a = acc[symbol];
      var t = tech[symbol];
      var nb = techBias(t); // -100..100
      // news direction sign: dirSum positive = lean long, negative = lean short
      var newsSign = Math.sign(a.dirSum || 0);
      var combined = Math.max(-100, Math.min(100, nb + newsSign * Math.min(40, a.w * 6)));
      var direction = combined > 12 ? 'long' : combined < -12 ? 'short' : 'neutral';
      var score = Math.abs(combined);
      var confidence = score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low';
      // align direction to the dominant technical bias when news is weak
      if (newsSign === 0) direction = nb > 12 ? 'long' : nb < -12 ? 'short' : 'neutral';
      var setup = describeSetup(t, direction, nb);
      recs.push({
        symbol: symbol,
        name: t.name || symbol,
        direction: direction,
        score: Math.round(score),
        confidence: confidence,
        newsBias: Math.round(newsSign * Math.min(40, a.w * 6)),
        technicalBias: nb,
        reasons: a.theses.slice(0, 4),
        events: a.evs.slice(0, 4),
        setup: setup,
        risk: riskNote(t, direction),
        timeframe: t.timeframe || 'H1'
      });
    });
    // Only recommend actionable (non-neutral) first, then by score desc
    recs.sort(function (x, y) {
      var xa = x.direction !== 'neutral' ? 1 : 0, xb = y.direction !== 'neutral' ? 1 : 0;
      if (xa !== xb) return xb - xa;
      return y.score - x.score;
    });
    return {
      recommendations: recs.slice(0, maxOut),
      generatedAt: now,
      counts: { upcoming: upcoming.length, released: released.length, symbolsConsidered: Object.keys(acc).length }
    };
  }

  function describeSetup(t, dir, nb) {
    if (dir === 'neutral') return 'No clear edge — wait for a confirmed break or a higher-impact release.';
    var bits = [];
    if (t.zone) bits.push('price in ' + t.zone);
    if (/VALID/.test(t.mhv || '')) bits.push(dir === 'long' ? 'valid high (MHV) — trend continuation' : 'valid high — watch for rejection');
    if (/REENTRY_UP/.test(t.reentry || '')) bits.push('re-entry zone armed');
    if (/REENTRY_DOWN/.test(t.reentry || '')) bits.push('rejection zone armed');
    if (t.extreme === 'EXTREME_HIGH') bits.push('extreme-high stretch (mean-reversion risk)');
    if (t.extreme === 'EXTREME_LOW') bits.push('extreme-low stretch (bounce risk)');
    var base = dir === 'long' ? 'Long bias' : 'Short bias';
    if (t.sd) {
      (t.sd.supply || []).slice(0, 1).forEach(function (z) { if (dir === 'short') base += ' targeting supply ' + Math.round(z.low) + '-' + Math.round(z.high); });
      (t.sd.demand || []).slice(0, 1).forEach(function (z) { if (dir === 'long') base += ' targeting demand ' + Math.round(z.low) + '-' + Math.round(z.high); });
    }
    return base + (bits.length ? ' · ' + bits.join(', ') : '') + '.';
  }

  function riskNote(t, dir) {
    var r = 'Educational only — size for your risk, not the signal.';
    if (t.extreme === 'EXTREME_HIGH' && dir === 'long') r = 'Chasing an extreme-high — reduced reward; wait for a pullback or confirmation. ' + r;
    if (t.extreme === 'EXTREME_LOW' && dir === 'short') r = 'Shorting an extreme-low — bounce risk. ' + r;
    if (t.trend && dir === 'long' && t.trend === 'DOWN') r = 'Counter-trend long (D1/MN1 down) — tighter stop. ' + r;
    if (t.trend && dir === 'short' && t.trend === 'UP') r = 'Counter-trend short — tighter stop. ' + r;
    return r;
  }

  return {
    recommend: recommend,
    eventToSymbols: eventToSymbols,
    techBias: techBias,
    surpriseDir: surpriseDir
  };
});
