/* shared-market-logic.js - the pieces of trading logic that MUST agree between the browser
 * dashboard (app.js, loaded via <script src>) and the Node Telegram bot (telegram-notify.js,
 * loaded via require()). Written as plain functions with no closure over global state (D,
 * MARKET_DATA, settings, etc.) - every input is passed in explicitly - so the exact same file
 * runs unmodified in both environments via the UMD-style export at the bottom.
 *
 * Why this file exists: eventCurrency() had already silently diverged between the two copies
 * (telegram-notify.js gained ForexFactory's "[GBP] CPI y/y" bracket-tag detection; app.js's copy
 * never did, so the dashboard's Trade Focus was failing to detect the currency for those events
 * while the bot correctly caught it) - found by direct comparison, not by a report. bestPairFor()
 * and pipSize() hadn't diverged yet, but were one careless edit away from the same fate (this is
 * exactly how the earlier NZD/USD-vs-EUR/USD bug happened). Consolidating here removes the
 * "remember to edit both files" step entirely.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod; // Node (telegram-notify.js)
  else root.SharedMarketLogic = mod; // browser (app.js, via <script src>)
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Maps an event's headline text to the currency it's driving. Two detection paths:
   *   1. ForexFactory's own country-tagged auto-collected titles: "[GBP] CPI y/y"
   *   2. Central-bank/institution name mentions, for curated titles that don't carry a tag
   * Order matters for #2 - checked in array order, first match wins. */
  var EVENT_CCY_MAP = [
    [/\bFOMC\b|\bFed\b|\bUS\b|United States/i, "USD"],
    [/\bBoJ\b|Bank of Japan/i, "JPY"],
    [/\bECB\b|European Central Bank/i, "EUR"],
    [/\bBoE\b|Bank of England/i, "GBP"],
    [/\bRBA\b/i, "AUD"],
    [/\bRBNZ\b/i, "NZD"],
    [/\bBoC\b|Bank of Canada/i, "CAD"],
    [/\bSNB\b/i, "CHF"]
  ];
  function eventCurrency(text) {
    var tag = /\[(\w{3})\]/.exec(text || "");
    if (tag) return tag[1];
    for (var i = 0; i < EVENT_CCY_MAP.length; i++) { if (EVENT_CCY_MAP[i][0].test(text || "")) return EVENT_CCY_MAP[i][1]; }
    return null;
  }

  /* Standard FX pip convention (0.0001/0.01 for JPY), heuristic "points" for metals/crypto since
   * there's no universal pip convention for them - disclosed wherever this is surfaced to a user,
   * not asserted as broker truth. */
  function pipSize(sym) {
    var s = String(sym || "").toUpperCase();
    if (s.indexOf("JPY") > -1) return 0.01;
    if (s.indexOf("XAU") > -1 || s.indexOf("GOLD") > -1) return 0.01;
    if (s.indexOf("XAG") > -1 || s.indexOf("SILVER") > -1) return 0.001;
    if (["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"].some(function (c) { return s.indexOf(c) > -1; })) return 1;
    if (s.indexOf("/") > -1 || /^[A-Z]{6}$/.test(s)) return 0.0001;
    return 0.01;
  }

  /* score/signal for one FX pair from the currency bias table - self-contained (takes the
   * currencies array directly) so this file has no dependency on either host's own pairSignal(). */
  function pairSignalWith(currencies, p) {
    function biasOf(code) { var c = (currencies || []).filter(function (x) { return x.code === code; })[0]; return c ? c.bias : 0; }
    var s = biasOf(p.base) - biasOf(p.quote);
    var sig = s > 0.15 ? "BUY" : s < -0.15 ? "SELL" : "NEUTRAL";
    return { score: s, signal: sig, strength: Math.abs(s) };
  }

  /* Picks the "headline" pair for a currency, not just whichever loaded cross has the widest bias
   * gap - a NZD/USD cross technically scoring higher than EUR/USD is not what "the FOMC pair to
   * watch" means to anyone. Priority: 1) the direct pair against USD (how any single currency's
   * move is normally read) 2) for USD itself, the conventional major-pair watch order 3) only
   * then fall back to whichever loaded cross has the strongest bias gap. */
  var USD_MAJOR_ORDER = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"];
  function bestPairFor(fxPairs, currencies, ccy) {
    if (!ccy) return null;
    fxPairs = fxPairs || [];
    function byPair(name) { var p = fxPairs.filter(function (x) { return x.pair === name; })[0]; return p ? { pair: p.pair, s: pairSignalWith(currencies, p) } : null; }
    if (ccy !== "USD") {
      var direct = fxPairs.filter(function (p) { return (p.base === ccy && p.quote === "USD") || (p.base === "USD" && p.quote === ccy); })[0];
      if (direct) return { pair: direct.pair, s: pairSignalWith(currencies, direct) };
    } else {
      var majors = USD_MAJOR_ORDER.map(byPair).filter(Boolean);
      var nonNeutral = majors.filter(function (c) { return c.s.signal !== "NEUTRAL"; })[0];
      if (nonNeutral) return nonNeutral;
      if (majors[0]) return majors[0];
    }
    var candidates = fxPairs.filter(function (p) { return p.base === ccy || p.quote === ccy; })
      .map(function (p) { return { pair: p.pair, s: pairSignalWith(currencies, p) }; })
      .sort(function (a, b) { return b.s.strength - a.s.strength; });
    return candidates[0] || null;
  }

  /* Classifies expected movement from a predicted-% magnitude so both the dashboard and the
   * Telegram bot agree on what "big"/"slow" means - previously this only existed inside
   * telegram-notify.js, which is exactly the kind of thing that silently diverges (see the
   * eventCurrency/forex-focus history above) if the dashboard ever grows its own copy.
   * Thresholds sit on the same scale as the BUY/SELL bias threshold (±0.15): 0.7%+ is a genuinely
   * large single-event move for these instruments, 0.3-0.7% is a normal tradeable move, below
   * that is noise-level drift. */
  function impactTier(pct) {
    var a = Math.abs(pct || 0);
    return a >= 0.7 ? "High" : a >= 0.3 ? "Med" : "Low";
  }
  /* Same tiering for calendar events, which carry a curated high/med importance tag instead of a
   * numeric % estimate (ForexFactory's own red/orange/yellow impact flag, via build-news.js). */
  function impactTierFromImportance(importance) {
    return importance === "high" ? "High" : importance === "med" ? "Med" : "Low";
  }
  var MOVEMENT_LABEL = {
    High: { emoji: "💥", text: "BIG MOVEMENT", detail: "high volatility, watch closely" },
    Med: { emoji: "📈", text: "MODERATE MOVEMENT", detail: "normal tradeable move" },
    Low: { emoji: "🐢", text: "SLOW MOVEMENT", detail: "minor drift, low urgency" }
  };

  return {
    EVENT_CCY_MAP: EVENT_CCY_MAP,
    eventCurrency: eventCurrency,
    pipSize: pipSize,
    pairSignalWith: pairSignalWith,
    USD_MAJOR_ORDER: USD_MAJOR_ORDER,
    bestPairFor: bestPairFor,
    impactTier: impactTier,
    impactTierFromImportance: impactTierFromImportance,
    MOVEMENT_LABEL: MOVEMENT_LABEL
  };
});
