/* XAU//DESK render logic + live feed wiring.
 * Data: window.MARKET_DATA (xauusd-data.js). Live prices: window.LiveFeed (live.js).
 * Prices are live-polled or the last stored snapshot; both states are labelled on screen.
 */
(function () {
  "use strict";
  var $ = function (s, p) { return (p || document).querySelector(s); };
  var $$ = function (s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); };
  var D = window.MARKET_DATA || window.MARKET_EMBEDDED;
  if (!D) {
    document.addEventListener("DOMContentLoaded", function () { var m = document.getElementById("load-error"); if (m) m.style.display = "block"; });
    return;
  }
  var T = D.tabs[0], activeId = D.tabs[0].id, tfFilter = "All";
  var liveState = { state: "idle", at: null, ticks: 0, error: "" };
  var voiceEnabled = false, lastAnnouncedNext = null, lastAnnouncedAlerts = null;
  var lastPrices = {}, firstPrices = {};

  /* ---- watchlist: commodities are always-on/priority, crypto + FX are user-selectable ---- */
  var COMMODITIES = [{ sym: "XAU/USD", label: "Gold" }, { sym: "XAG/USD", label: "Silver" }];
  var CRYPTO_ALL = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"];
  var wlDefault = { crypto: ["BTC", "ETH"], fx: ["EUR/USD", "GBP/USD", "USD/JPY"] };
  var watchlist = (function () {
    try {
      var raw = localStorage.getItem("xau-watchlist");
      if (raw) { var p = JSON.parse(raw); return { crypto: p.crypto || [], fx: p.fx || [] }; }
    } catch (e) {}
    return { crypto: wlDefault.crypto.slice(), fx: wlDefault.fx.slice() };
  })();
  function saveWatchlist() { try { localStorage.setItem("xau-watchlist", JSON.stringify(watchlist)); } catch (e) {} }
  function wlToggle(kind, key) {
    var arr = watchlist[kind]; var i = arr.indexOf(key);
    if (i > -1) arr.splice(i, 1); else arr.push(key);
    saveWatchlist(); renderWatchlist(); renderPairs(); renderPivotChips(); renderTape(lastTick || {});
  }
  function renderWatchlist() {
    var box = $("#wl-groups"); if (!box) return;
    box.innerHTML = "";
    function group(title, count, chips) {
      box.insertAdjacentHTML("beforeend", '<div class="wl-group"><div class="wl-gt">' + esc(title) + '<span class="n">' + count + '</span></div><div class="wl-chips">' + chips + "</div></div>");
    }
    /* the chip filter shown here always matches the currently open instrument tab:
       Gold -> commodities (fixed list, nothing to filter), Crypto -> crypto symbols, Forex -> FX majors/minors */
    if (activeId === "gold") {
      group("Commodities · always on", COMMODITIES.length,
        COMMODITIES.map(function (c) { return '<span class="wl-chip commodity on">' + esc(c.label) + " · " + esc(c.sym) + "</span>"; }).join(""));
    } else if (activeId === "crypto") {
      group("Crypto · tap to show/hide", watchlist.crypto.length,
        CRYPTO_ALL.map(function (c) { return '<button class="wl-chip crypto' + (watchlist.crypto.indexOf(c) > -1 ? " on" : "") + '" data-kind="crypto" data-key="' + c + '">' + c + "</button>"; }).join(""));
    } else {
      group("FX Majors · tap to show/hide", watchlist.fx.filter(function (p) { return majorSet[p]; }).length,
        (D.fxPairs || []).filter(function (p) { return p.group === "Major"; }).map(function (p) { return '<button class="wl-chip' + (watchlist.fx.indexOf(p.pair) > -1 ? " on" : "") + '" data-kind="fx" data-key="' + p.pair + '">' + esc(p.pair) + "</button>"; }).join(""));
      group("FX Minors / Crosses · tap to show/hide", watchlist.fx.filter(function (p) { return !majorSet[p]; }).length,
        (D.fxPairs || []).filter(function (p) { return p.group !== "Major"; }).map(function (p) { return '<button class="wl-chip' + (watchlist.fx.indexOf(p.pair) > -1 ? " on" : "") + '" data-kind="fx" data-key="' + p.pair + '">' + esc(p.pair) + "</button>"; }).join(""));
    }
    $$(".wl-chips button", box).forEach(function (b) { b.onclick = function () { wlToggle(b.dataset.kind, b.dataset.key); }; });
  }
  var majorSet = {}; (D.fxPairs || []).forEach(function (p) { if (p.group === "Major") majorSet[p.pair] = true; });
  var lastTick = null;

  /* ---- Live page: independent symbol filter (separate from the Pairs watchlist) ---- */
  function liveAllSymbols() {
    return COMMODITIES.map(function (c) { return { key: c.sym, label: c.label + " · " + c.sym, kind: "commodity" }; })
      .concat(CRYPTO_ALL.map(function (c) { return { key: c, label: c + "/USD", kind: "crypto" }; }))
      .concat((D.fxPairs || []).map(function (p) { return { key: p.pair, label: p.pair, kind: "fx" }; }));
  }
  var liveFilter = (function () {
    try { var raw = localStorage.getItem("xau-live-filter"); if (raw) return JSON.parse(raw); } catch (e) {}
    return COMMODITIES.map(function (c) { return c.sym; }).concat(["BTC", "ETH"], watchlist.fx.slice());
  })();
  function saveLiveFilter() { try { localStorage.setItem("xau-live-filter", JSON.stringify(liveFilter)); } catch (e) {} }
  function liveFilterToggle(key) {
    var i = liveFilter.indexOf(key);
    if (i > -1) liveFilter.splice(i, 1); else liveFilter.push(key);
    saveLiveFilter(); renderLiveFilterGroups(); renderLiveDetail();
  }
  function renderLiveFilterGroups() {
    var box = $("#live-filter-groups"); if (!box) return;
    box.innerHTML = "";
    function group(title, kind) {
      var chips = liveAllSymbols().filter(function (s) { return s.kind === kind; })
        .map(function (s) { return '<button class="wl-chip ' + kind + (liveFilter.indexOf(s.key) > -1 ? " on" : "") + '" data-key="' + esc(s.key) + '">' + esc(s.label) + "</button>"; }).join("");
      var count = liveAllSymbols().filter(function (s) { return s.kind === kind && liveFilter.indexOf(s.key) > -1; }).length;
      box.insertAdjacentHTML("beforeend", '<div class="wl-group"><div class="wl-gt">' + title + '<span class="n">' + count + '</span></div><div class="wl-chips">' + chips + "</div></div>");
    }
    group("Commodities", "commodity"); group("Crypto", "crypto"); group("Forex", "fx");
    $$(".wl-chips button", box).forEach(function (b) { b.onclick = function () { liveFilterToggle(b.dataset.key); }; });
  }
  function liveHistFor(key, kind) {
    if (!window.LiveFeed || !window.LiveFeed.history) return [];
    if (kind === "fx") return window.LiveFeed.history(key) || [];
    return window.LiveFeed.history(key) || [];
  }
  function renderLiveDetail() {
    var body = $("#live-detail-body"); if (!body) return;
    var rows = liveAllSymbols().filter(function (s) { return liveFilter.indexOf(s.key) > -1; });
    if (!rows.length) { body.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No symbols selected — pick some above.</td></tr>'; return; }
    body.innerHTML = rows.map(function (s) {
      var px = s.kind === "commodity" ? (window.LiveFeed && window.LiveFeed.metal ? window.LiveFeed.metal(s.key) : null)
        : s.kind === "crypto" ? (window.LiveFeed && window.LiveFeed.prices ? (window.LiveFeed.prices().crypto || {})[s.key] : null)
        : (window.LiveFeed && window.LiveFeed.priceFor ? window.LiveFeed.priceFor(s.key) : null);
      if (px == null && s.key === "XAU/USD") px = T.price.spot;
      var fkey = "live-" + s.key;
      var base = firstPrices[fkey]; if (base == null && px != null) { firstPrices[fkey] = px; base = px; }
      var pct = (px != null && base) ? ((px - base) / base) * 100 : null;
      var movePips = (px != null && base) ? pipsFor(s.key, px - base) : null;
      var hist = liveHistFor(s.key, s.kind);
      var hi = hist.length ? Math.max.apply(null, hist) : null, lo = hist.length ? Math.min.apply(null, hist) : null;
      var src = s.kind === "commodity" ? "gold-api.com / Twelve Data" : s.kind === "crypto" ? "Coinbase (polled)" : "Coinbase EUR table (derived)";
      return "<tr><td><b>" + esc(s.label) + "</b></td>" +
        '<td class="px">' + (px != null ? (s.kind === "fx" ? pairFmt(px) : money(px)) : "—") + "</td>" +
        '<td class="chg ' + (pct == null ? "muted" : pctCls(pct)) + '">' + (pct == null ? "—" : (pct > 0 ? "+" : "") + pct.toFixed(3) + "%") + "</td>" +
        '<td class="' + (movePips == null ? "muted" : pctCls(movePips)) + '">' + (movePips == null ? "—" : (movePips > 0 ? "+" : "") + movePips.toFixed(1) + "p") + "</td>" +
        "<td style=\"color:var(--muted)\">" + (hi != null ? (s.kind === "fx" ? pairFmt(lo) + " - " + pairFmt(hi) : money(lo) + " - " + money(hi)) : "—") + "</td>" +
        '<td style="color:var(--muted)">' + src + "</td></tr>";
    }).join("");
  }
  function bindLiveFilterButtons() {
    var all = $("#live-filter-all"); if (all) all.onclick = function () { liveFilter = liveAllSymbols().map(function (s) { return s.key; }); saveLiveFilter(); renderLiveFilterGroups(); renderLiveDetail(); };
    var none = $("#live-filter-none"); if (none) none.onclick = function () { liveFilter = []; saveLiveFilter(); renderLiveFilterGroups(); renderLiveDetail(); };
  }

  /* ---- Auto-computed gauge: xauusd-data.js's tabs[].sentiment (bias/tone/score/confidence/
   *      netSignal/netPct/summary) was hand-set once and never touched by any refresh script,
   *      even after ATR/news/calendar/macro all started auto-updating - so the gauge everyone
   *      looks at was silently frozen next to data that looked live. This recomputes it from
   *      the tab's own news[]+speakers[] (curated + auto-merged), which already carry a
   *      signal/impactPct per item either way. Every dirRule in this app states "hawkish =
   *      SELL <the tab's own instrument>" as the primary framing, so SELL is uniformly the
   *      hawkish direction across gold/crypto/forex - no per-tab sign flipping needed.
   *      Falls back to leaving the curated sentiment untouched if there's nothing to score. */
  function computeAutoSentiment(tab) {
    var items = (tab.news || []).concat(tab.speakers || []);
    var scored = items.filter(function (i) { return i.signal && i.signal !== "NEUTRAL" && i.impactPct != null; });
    if (!scored.length) return null;
    var netPct = 0, buys = 0, sells = 0;
    scored.forEach(function (i) { netPct += i.impactPct; if (i.signal === "BUY") buys++; else if (i.signal === "SELL") sells++; });
    netPct = +netPct.toFixed(2);
    var netSignal = netPct > 0.05 ? "BUY" : netPct < -0.05 ? "SELL" : "NEUTRAL";
    var score = +Math.max(-1, Math.min(1, (sells - buys) / scored.length)).toFixed(2); // positive = hawkish (right side of gauge)
    var confidence = Math.round(Math.min(95, 40 + scored.length * 4));
    var bias = score > 0.15 ? "HAWKISH" : score < -0.15 ? "DOVISH" : "MIXED";
    var tone = netSignal === "SELL" ? "BEARISH" : netSignal === "BUY" ? "BULLISH" : "MIXED";
    return {
      bias: bias, tone: tone, score: score, confidence: confidence,
      netSignal: netSignal, netPct: netPct,
      summary: scored.length + " classified item" + (scored.length === 1 ? "" : "s") + " (" + buys + " bullish, " + sells + " bearish) from real news/speakers.",
      netNote: "Computed live from classified news/speaker impact% values (curated + auto-collected) — not hand-set."
    };
  }
  function applyAutoSentiment() {
    (D.tabs || []).forEach(function (tab) {
      var computed = computeAutoSentiment(tab);
      if (computed) tab.sentiment = computed;
    });
  }

  /* ---- Currency strength meter: derived live, not from the analyst bias table.
   *      Each FX pair's % move since connect is credited to its base currency and
   *      debited from its quote currency, then averaged per currency. ---- */
  function computeCurrencyStrength() {
    var sums = {}, counts = {};
    (D.currencies || []).forEach(function (c) { sums[c.code] = 0; counts[c.code] = 0; });
    (D.fxPairs || []).forEach(function (p) {
      var px = lastPrices[p.pair], base = firstPrices[p.pair];
      if (px == null || !base) return;
      var pct = ((px - base) / base) * 100;
      if (sums[p.base] != null) { sums[p.base] += pct; counts[p.base]++; }
      if (sums[p.quote] != null) { sums[p.quote] -= pct; counts[p.quote]++; }
    });
    var out = Object.keys(sums).map(function (code) { return { code: code, v: counts[code] ? sums[code] / counts[code] : 0, n: counts[code] }; });
    out.sort(function (a, b) { return b.v - a.v; });
    return out;
  }
  function renderCurrencyStrength() {
    var box = $("#ccy-strength"); if (!box) return;
    var adv = $("#ccy-strength-advice");
    var rows = computeCurrencyStrength();
    var any = rows.some(function (r) { return r.n > 0; });
    if (!any) {
      box.innerHTML = '<div class="note">Waiting for enough live FX ticks to derive strength (needs at least one poll per currency’s pairs)…</div>';
      if (adv) adv.innerHTML = "";
      return;
    }
    var maxAbs = Math.max(0.02, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); })));
    box.innerHTML = rows.map(function (r) {
      var pctW = Math.min(50, (Math.abs(r.v) / maxAbs) * 50);
      var fill = r.v >= 0 ? '<span class="cs-fill good" style="width:' + pctW + '%"></span>' : '<span class="cs-fill bad" style="width:' + pctW + '%"></span>';
      return '<div class="cs-row"><span class="cc">' + esc(r.code) + '</span><span class="cs-track">' + fill + '</span><span class="cs-val ' + pctCls(r.v) + '">' + (r.v > 0 ? "+" : "") + r.v.toFixed(3) + "%</span></div>";
    }).join("");
    if (adv) adv.innerHTML = renderStrengthAdvice(rows);
  }
  /* ---- "which currency is good to trade" list: pairs the strongest live mover against the
   * weakest (widest live spread = cleanest live trend), cross-checked against the analyst bias
   * table so a live spike that contradicts the fundamental gauge is flagged, not just quoted. ---- */
  function renderStrengthAdvice(rows) {
    var ranked = rows.filter(function (r) { return r.n > 0; });
    if (ranked.length < 2) return '<div class="note">Need at least two currencies with live pairs to rank a trade.</div>';
    var strongest = ranked[0], weakest = ranked[ranked.length - 1];
    function pairFor(a, b) {
      var found = (D.fxPairs || []).filter(function (p) { return (p.base === a && p.quote === b) || (p.base === b && p.quote === a); })[0];
      if (!found) return null;
      var dir = found.base === a ? "BUY " + found.pair : "SELL " + found.pair;
      return { pair: found.pair, dir: dir };
    }
    function biasAgrees(code, liveUp) {
      var b = biasOf(code);
      var biasUp = b > 0.1, biasDown = b < -0.1;
      if (liveUp && biasUp) return "agrees with the fundamental bias table";
      if (!liveUp && biasDown) return "agrees with the fundamental bias table";
      if (liveUp && biasDown) return "contradicts the fundamental bias (analyst view is bearish this currency) — treat as a short-lived live spike, not a trend";
      if (!liveUp && biasUp) return "contradicts the fundamental bias (analyst view is bullish this currency) — treat as a short-lived live spike, not a trend";
      return "no strong fundamental lean either way";
    }
    var out = [];
    var top = pairFor(strongest.code, weakest.code);
    out.push('<div class="al"><div class="hd"><span class="badge b-tf">CLEANEST LIVE TREND</span></div><div class="tx">' +
      "<b>" + esc(strongest.code) + "</b> is the live-strongest (" + (strongest.v > 0 ? "+" : "") + strongest.v.toFixed(3) + "%), <b>" + esc(weakest.code) + "</b> the live-weakest (" + (weakest.v > 0 ? "+" : "") + weakest.v.toFixed(3) + "%). " +
      (top ? "Widest live spread: <b>" + esc(top.dir) + "</b>." : "No loaded pair quotes " + esc(strongest.code) + "/" + esc(weakest.code) + " directly — trade each leg via its own pair.") +
      " " + esc(strongest.code) + " " + biasAgrees(strongest.code, true) + "." +
      "</div></div>");
    out.push('<div class="note">Live strength reshuffles every poll — this ranks who’s moving right now in this session, not a multi-day trend. Cross-check against the Analysis tab’s currency bias table before sizing a position.</div>');
    return out.join("");
  }

  /* ---- event-time parsing for soonest-first sort ---- */
  function parseEventTime(gmtStr) {
    if (!gmtStr) return null;
    // auto-collected rows are "YYYY-MM-DD HH:MM" (optionally with a "Mon, " day-name prefix) -
    // unambiguous, no year-guessing needed.
    var iso = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(gmtStr);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5]));
    // curated rows are "DD Mon HH:MM" with no year - infer the year, rolling forward if the
    // resulting date would be implausibly far in the past.
    var m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2})/.exec(gmtStr);
    if (!m) return null;
    var months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    var now = new Date(), year = now.getUTCFullYear();
    var d = new Date(Date.UTC(year, months[m[2]] != null ? months[m[2]] : 0, parseInt(m[1], 10), parseInt(m[3], 10), parseInt(m[4], 10)));
    if (d.getTime() < now.getTime() - 200 * 86400000) d = new Date(Date.UTC(year + 1, months[m[2]], parseInt(m[1], 10), parseInt(m[3], 10), parseInt(m[4], 10)));
    return d;
  }
  /* Prepends the day name to a "DD Mon HH:MM" MYT string (curated calendar rows, entered before
   * the auto-collected pipeline started including a day name of its own) - COMPUTED from the
   * real calendar date, not fabricated: 17 Sep 2026 is a specific, real Thursday regardless of
   * who typed the string. Auto rows already start with a day name ("Mon, 2026-09-14 20:30") and
   * are returned unchanged. */
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* The day a moment falls on in MYT, as a section-header label ("Thu, 17 Sep") - computed from
   * the already-parsed instant (it.t, from timeGmt) rather than re-parsing timeMyt strings, so it
   * stays correct even right around midnight where GMT and MYT can disagree on the calendar day. */
  function mytDayLabel(t) {
    if (!t) return "Unknown day";
    var myt = new Date(t.getTime() + 8 * 3600 * 1000);
    return DAY_NAMES[myt.getUTCDay()] + ", " + myt.getUTCDate() + " " + MONTH_NAMES[myt.getUTCMonth()];
  }
  var MONTH_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  /* News rows carry two shapes of date string: curated ("16 Sep", date only, no time - the source
   * never had an intraday timestamp) and auto-collected ("Thu 17 Sep, 20:35 MYT", real day+time
   * from the RSS feed). Parses either into {t: sortable timestamp, day: "Thu, 17 Sep" group label}
   * treated as a plain MYT calendar date/time - exact UTC offset doesn't matter here, only
   * relative order and the correct day-of-week for grouping. Missing time defaults to 00:00,
   * which correctly sorts a date-only row before same-day timed rows, not after. */
  function parseNewsMeta(str) {
    if (!str) return { t: -Infinity, day: "Unknown day" };
    var m = /(\d{1,2})\s+([A-Za-z]{3})(?:,?\s+(\d{1,2}):(\d{2}))?/.exec(str);
    if (!m || MONTH_MAP[m[2]] == null) return { t: -Infinity, day: "Unknown day" };
    var day = +m[1], mon = MONTH_MAP[m[2]], hour = m[3] != null ? +m[3] : 0, min = m[4] != null ? +m[4] : 0;
    var nowMyt = new Date(Date.now() + 8 * 3600 * 1000);
    var year = nowMyt.getUTCFullYear();
    var d = new Date(Date.UTC(year, mon, day, hour, min));
    if (d.getTime() > nowMyt.getTime() + 2 * 86400000) d = new Date(Date.UTC(year - 1, mon, day, hour, min));
    return { t: d.getTime(), day: DAY_NAMES[d.getUTCDay()] + ", " + day + " " + MONTH_NAMES[mon] };
  }
  /* Fine-grained countdown text: minutes when close, hours/days once far out. Replaces the old
   * hour-only rounding (which showed "within the hour" for anything from 59 minutes down to the
   * exact second) with an actual live countdown once an event is within reach. */
  function countdownText(deltaMs) {
    if (deltaMs == null) return "";
    var past = deltaMs < 0;
    var abs = Math.abs(deltaMs);
    var mins = Math.round(abs / 60000);
    var suffix = past ? " ago" : "";
    var prefix = past ? "" : "in ";
    if (mins < 1) return past ? "just now" : "starting now";
    if (mins < 60) return prefix + mins + "m" + suffix;
    var hours = Math.floor(mins / 60), remMins = mins % 60;
    if (hours < 48) return prefix + hours + "h" + (remMins ? " " + remMins + "m" : "") + suffix;
    return prefix + Math.round(hours / 24) + "d" + suffix;
  }
  function mytDisplay(timeMyt) {
    if (!timeMyt) return "—";
    if (/^[A-Za-z]{3},/.test(timeMyt)) return timeMyt; // already has a day name
    var d = parseEventTime(timeMyt); // same "DD Mon HH:MM" shape parseEventTime already handles
    if (!d) return timeMyt;
    return DAY_NAMES[d.getUTCDay()] + ", " + timeMyt;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(v) { return "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function pairFmt(v) { if (v == null) return "\u2014"; return Number(v) >= 20 ? Number(v).toFixed(3) : Number(v).toFixed(5); }
  function pctTxt(v) { if (v == null) return "\u2014"; var n = Number(v); return (n > 0 ? "+" : "") + n.toFixed(2) + "%"; }
  function pctCls(v) { var n = Number(v); return n > 0 ? "good" : n < 0 ? "bad" : ""; }
  /* Big/Moderate/Slow movement badge, same thresholds as the Telegram bot (shared-market-logic.js) -
   * kept in one place so the dashboard and the bot can't drift apart on what "big move" means. */
  function movementBadge(pct) {
    var tier = window.SharedMarketLogic.impactTier(pct);
    var m = window.SharedMarketLogic.MOVEMENT_LABEL[tier];
    return '<span class="badge mv-' + tier.toLowerCase() + '" title="' + esc(m.text + " \u2014 " + m.detail) + '">' + m.emoji + " " + esc(tier) + "</span>";
  }
  // pipSize lives in shared-market-logic.js now - same reasoning as eventCurrency above.
  // Disclosed in every pip answer so the number is auditable, not asserted as broker truth.
  function pipSize(sym) { return window.SharedMarketLogic.pipSize(sym); }
  function pipsFor(sym, priceMove) { var p = pipSize(sym); return p ? priceMove / p : null; }
  /* ---- pip $ value: only computed when the pair's quote currency matches the account currency
   *      in Settings (otherwise it would need a live cross-rate conversion this app doesn't do).
   *      Standard contract sizes: 100,000 units FX, 100oz gold, 5,000oz silver, 1 unit crypto. ---- */
  function pipDollarValue(sym) {
    var s = String(sym || "").toUpperCase();
    var acct = settings.accountCcy || "USD", lot = Number(settings.lotSize) || 1;
    var quote = s.indexOf("/") > -1 ? s.split("/")[1] : (s.length === 6 ? s.slice(3) : (s.indexOf("XAU") > -1 || s.indexOf("XAG") > -1 || ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"].some(function (c) { return s.indexOf(c) > -1; }) ? "USD" : null));
    if (!quote || quote !== acct) return null;
    var contract = (s.indexOf("XAU") > -1) ? 100 : (s.indexOf("XAG") > -1) ? 5000 : (["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"].some(function (c) { return s.indexOf(c) > -1; })) ? 1 : 100000;
    return pipSize(s) * contract * lot;
  }
  function sigCls(s) { return s === "SELL" ? "sig-sell" : s === "BUY" ? "sig-buy" : "sig-neu"; }
  function dirGlyph(d) { return d === "up" ? "UP" : d === "down" ? "DOWN" : d === "mixed" ? "MIXED" : "-"; }
  function dirCls(d) { return d === "up" ? "good" : d === "down" ? "bad" : "muted"; }
  function biasOf(code) { var c = (D.currencies || []).filter(function (x) { return x.code === code; })[0]; return c ? c.bias : 0; }
  function cbOf(code) { var c = (D.currencies || []).filter(function (x) { return x.code === code; })[0]; return c || {}; }
  function pairSignal(p) {
    var s = biasOf(p.base) - biasOf(p.quote);
    var sig = s > 0.15 ? "BUY" : s < -0.15 ? "SELL" : "NEUTRAL";
    return { score: s, signal: sig, strength: Math.abs(s) };
  }
  // bestPairFor lives in shared-market-logic.js now - same reasoning as eventCurrency above.
  function bestPairForCurrency(ccy) { return window.SharedMarketLogic.bestPairFor(D.fxPairs, D.currencies, ccy); }

  /* theme */
  var safeGet = function () { try { return localStorage.getItem("xau-theme"); } catch (e) { return null; } };
  var safeSet = function (t) { try { localStorage.setItem("xau-theme", t); } catch (e) {} };
  function setTheme(t) { document.documentElement.setAttribute("data-theme", t); safeSet(t); $$("#theme button").forEach(function (b) { b.classList.toggle("active", b.dataset.theme === t); }); }
  function bindTheme() { $$("#theme button").forEach(function (b) { b.onclick = function () { setTheme(b.dataset.theme); }; }); }

  /* ---- voice: reads incoming-event and today's-alert changes aloud via the browser's own TTS ---- */
  var safeGetVoice = function () { try { return localStorage.getItem("xau-voice") === "1"; } catch (e) { return false; } };
  var safeSetVoice = function (on) { try { localStorage.setItem("xau-voice", on ? "1" : "0"); } catch (e) {} };
  /* Presenter-style presets: the Web Speech API has no "sound like a person" knob, but rate/pitch
   * tuning plus reading sentence-by-sentence (see speak() below) gets meaningfully further from
   * the flat, one-shot monotone a raw SpeechSynthesisUtterance(text) produces at rate=1/pitch=1.
   * "Robotic" is kept as an explicit, honest option rather than removed. */
  var VOICE_STYLES = {
    presenter: { label: "Presenter (measured, clear)", rate: 0.96, pitch: 1.0 },
    newsAnchor: { label: "News Anchor (confident, brisk)", rate: 1.05, pitch: 0.96 },
    calm: { label: "Calm Analyst (slow, low)", rate: 0.85, pitch: 0.9 },
    energetic: { label: "Energetic (upbeat, faster)", rate: 1.15, pitch: 1.1 },
    robotic: { label: "Default (flat, robotic)", rate: 1, pitch: 1 }
  };
  var availableVoices = [];
  function refreshVoiceList() {
    if (!("speechSynthesis" in window)) return;
    availableVoices = window.speechSynthesis.getVoices() || [];
    populateVoiceSelect();
  }
  /* System voices ARE the "many person templates" - every OS/browser ships several distinct
   * synthetic voices (different names, genders, accents); this just surfaces the real list
   * instead of silently taking whatever the browser defaults to. Voices with "Natural"/"Neural"/
   * "Online" in the name (Edge/Windows 11, some Android builds) sound far less robotic than
   * legacy SAPI voices, so one of those is preferred as the default pick when available. */
  function bestDefaultVoiceURI() {
    if (!availableVoices.length) return "";
    var en = availableVoices.filter(function (v) { return /^en/i.test(v.lang); });
    var pool = en.length ? en : availableVoices;
    var natural = pool.filter(function (v) { return /natural|neural|online/i.test(v.name); })[0];
    return (natural || pool[0]).voiceURI;
  }
  function currentVoiceObj() {
    var uri = settings.voiceURI || bestDefaultVoiceURI();
    return availableVoices.filter(function (v) { return v.voiceURI === uri; })[0] || null;
  }
  /* Reads what the text MEANS, not what it literally contains - a presenter says "Euro versus
   * the US Dollar", never "E U R slash U S D". This only affects what's SPOKEN; the on-screen
   * text is untouched (traders still want to read "EUR/USD" and "M15" at a glance). Order
   * matters: currency pairs before lone currency codes, so "EUR/USD" isn't half-converted. */
  var SPEECH_CCY_NAMES = {
    USD: "the US Dollar", EUR: "the Euro", GBP: "the British Pound", JPY: "the Japanese Yen",
    AUD: "the Australian Dollar", NZD: "the New Zealand Dollar", CAD: "the Canadian Dollar", CHF: "the Swiss Franc",
    XAU: "Gold", XAG: "Silver", BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "Ripple", ADA: "Cardano", DOGE: "Dogecoin"
  };
  var SPEECH_TF_NAMES = {
    M1: "the one minute chart", M5: "the five minute chart", M15: "the fifteen minute chart", M30: "the thirty minute chart",
    H1: "the one hour chart", H4: "the four hour chart", D1: "the daily chart", W1: "the weekly chart", MN1: "the monthly chart"
  };
  function humanizeForSpeech(text) {
    var t = " " + text + " ";
    // currency/metal/crypto pairs: "EUR/USD" -> "the Euro versus the US Dollar"
    t = t.replace(/\b([A-Z]{3})\/([A-Z]{3})\b/g, function (_, a, b) {
      var an = SPEECH_CCY_NAMES[a] || a, bn = SPEECH_CCY_NAMES[b] || b;
      return an + " versus " + bn;
    });
    // chart/timeframe shorthand, longest-first so "M15" doesn't get chewed up by an "M1" rule
    Object.keys(SPEECH_TF_NAMES).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
      t = t.replace(new RegExp("\\b" + k + "\\b", "g"), SPEECH_TF_NAMES[k]);
    });
    t = t
      .replace(/\bMYT\b/g, "Malaysia time")
      .replace(/\bGMT\b/g, "G M T")
      .replace(/\bFOMC\b/g, "the Fed")
      .replace(/\bATR\b/g, "average true range")
      .replace(/\bDXY\b/g, "the dollar index")
      .replace(/\bbps\b/gi, "basis points")
      .replace(/\bBUY\b/g, "buy").replace(/\bSELL\b/g, "sell") // avoid TTS spelling out short all-caps as letters
      .replace(/~/g, "about ")
      .replace(/→|->/g, " to ")
      .replace(/[•·]/g, ",")
      .replace(/[—–]/g, ", ")
      .replace(/[()]/g, ", ")
      .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}☀-➿️]/gu, "") // strip emoji/pictographs - TTS either skips or mispronounces these
      .replace(/[*_`#]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return t;
  }
  /* Splits into sentences and speaks them as separate queued utterances instead of one long run-
   * on. The brief natural gap the API leaves between queued utterances reads as sentence pacing -
   * closer to how a presenter actually pauses between statements than one flat monotone block. */
  function speak(text) {
    if (!voiceEnabled || !text) return;
    if (!("speechSynthesis" in window)) return;
    try {
      var style = VOICE_STYLES[settings.voiceStyle] || VOICE_STYLES.presenter;
      var voice = currentVoiceObj();
      var spoken = humanizeForSpeech(text);
      var sentences = spoken.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
      if (!sentences.length) sentences = [spoken];
      sentences.forEach(function (s) {
        var u = new SpeechSynthesisUtterance(s);
        u.rate = style.rate; u.pitch = style.pitch;
        if (voice) u.voice = voice;
        window.speechSynthesis.speak(u);
      });
    } catch (e) {}
  }
  function updateVoiceBtn() {
    var btn = $("#voice-toggle"); if (!btn) return;
    btn.textContent = voiceEnabled ? "🔊 Voice on" : "🔈 Voice off";
    btn.classList.toggle("go", voiceEnabled);
  }
  function bindVoice() {
    voiceEnabled = safeGetVoice() && ("speechSynthesis" in window);
    updateVoiceBtn();
    var btn = $("#voice-toggle"); if (!btn) return;
    if (!("speechSynthesis" in window)) { btn.title = "Speech synthesis not supported in this browser"; btn.disabled = true; return; }
    refreshVoiceList();
    if ("onvoiceschanged" in window.speechSynthesis) window.speechSynthesis.onvoiceschanged = refreshVoiceList;
    if (voiceEnabled) { lastAnnouncedNext = null; lastAnnouncedAlerts = null; renderIncoming(); renderAlerts(); }
    btn.onclick = function () {
      voiceEnabled = !voiceEnabled; safeSetVoice(voiceEnabled); updateVoiceBtn();
      if (voiceEnabled) { speak("Voice alerts on."); lastAnnouncedNext = null; lastAnnouncedAlerts = null; renderIncoming(); renderAlerts(); }
    };
  }
  function populateVoiceSelect() {
    var sel = $("#set-voice-uri"); if (!sel) return;
    var current = settings.voiceURI || bestDefaultVoiceURI();
    sel.innerHTML = availableVoices.length
      ? availableVoices.map(function (v) { return '<option value="' + esc(v.voiceURI) + '">' + esc(v.name) + " (" + esc(v.lang) + ")</option>"; }).join("")
      : '<option value="">No voices found yet — open this panel again in a moment</option>';
    sel.value = current;
  }
  function bindVoiceSettings() {
    var sel = $("#set-voice-uri"), styleSel = $("#set-voice-style"), testBtn = $("#set-voice-test");
    if (!sel) return;
    populateVoiceSelect();
    sel.onchange = function () { settings.voiceURI = sel.value; safeSetSettings(settings); };
    if (styleSel) {
      if (!styleSel.options.length) styleSel.innerHTML = Object.keys(VOICE_STYLES).map(function (id) { return '<option value="' + id + '">' + esc(VOICE_STYLES[id].label) + "</option>"; }).join("");
      styleSel.value = settings.voiceStyle || "presenter";
      styleSel.onchange = function () { settings.voiceStyle = styleSel.value; safeSetSettings(settings); };
    }
    if (testBtn) testBtn.onclick = function () {
      var was = voiceEnabled; voiceEnabled = true;
      speak("Hi, this is your desk assistant. This is how I'll sound reading your alerts.");
      voiceEnabled = was;
    };
  }

  /* ---- settings: accent/font/size/profile + notification toggles, all local to this device ---- */
  var DEFAULT_SETTINGS = { profile: "", accent: "#e2b04a", font: "", fontSize: "1", notifPopup: false, notifOS: false, defaultTab: "", accountCcy: "USD", lotSize: 1, riskPct: 1, showAuto: true, compact: false, aiMode: "offline", aiProvider: "groq", aiKey: "", aiModel: "", remoteUrl: "", remoteMin: "15", voiceURI: "", voiceStyle: "presenter" };
  var safeGetSettings = function () {
    try { var s = JSON.parse(localStorage.getItem("xau-settings") || "{}"); var out = {}; for (var k in DEFAULT_SETTINGS) out[k] = (s[k] !== undefined ? s[k] : DEFAULT_SETTINGS[k]); return out; }
    catch (e) { var d = {}; for (var k2 in DEFAULT_SETTINGS) d[k2] = DEFAULT_SETTINGS[k2]; return d; }
  };
  var safeSetSettings = function (s) { try { localStorage.setItem("xau-settings", JSON.stringify(s)); } catch (e) {} };
  var settings = safeGetSettings();
  function applySettings() {
    document.documentElement.style.setProperty("--accent", settings.accent || DEFAULT_SETTINGS.accent);
    if (settings.font) document.documentElement.style.setProperty("--ui-font", settings.font);
    else document.documentElement.style.removeProperty("--ui-font");
    document.body.style.zoom = settings.fontSize || "1";
    document.body.classList.toggle("compact", !!settings.compact);
  }
  var CCY_LIST = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"];
  function bindSettings() {
    var btn = $("#settings-btn"), panel = $("#settings-panel"), close = $("#settings-close");
    if (btn) btn.onclick = function () { panel.classList.toggle("open"); };
    if (close) close.onclick = function () { panel.classList.remove("open"); };
    var prof = $("#set-profile"); if (prof) { prof.value = settings.profile; prof.oninput = function () { settings.profile = prof.value; safeSetSettings(settings); }; }
    var acc = $("#set-accent"); if (acc) { acc.value = settings.accent; acc.oninput = function () { settings.accent = acc.value; safeSetSettings(settings); applySettings(); }; }
    var font = $("#set-font"); if (font) { font.value = settings.font; font.onchange = function () { settings.font = font.value; safeSetSettings(settings); applySettings(); }; }
    $$("#set-size button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.size === settings.fontSize);
      b.onclick = function () { settings.fontSize = b.dataset.size; safeSetSettings(settings); applySettings(); $$("#set-size button").forEach(function (x) { x.classList.toggle("active", x === b); }); };
    });
    $$("#set-deftab button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === (settings.defaultTab || ""));
      b.onclick = function () {
        settings.defaultTab = (settings.defaultTab === b.dataset.tab) ? "" : b.dataset.tab;
        safeSetSettings(settings);
        $$("#set-deftab button").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === settings.defaultTab); });
      };
    });
    var accCcy = $("#set-account-ccy");
    if (accCcy) {
      accCcy.innerHTML = CCY_LIST.map(function (c) { return '<option value="' + c + '">' + c + "</option>"; }).join("");
      accCcy.value = settings.accountCcy || "USD";
      accCcy.onchange = function () { settings.accountCcy = accCcy.value; safeSetSettings(settings); };
    }
    var lot = $("#set-lot-size"); if (lot) { lot.value = settings.lotSize; lot.oninput = function () { settings.lotSize = parseFloat(lot.value) || 1; safeSetSettings(settings); }; }
    var risk = $("#set-risk-pct"); if (risk) { risk.value = settings.riskPct; risk.oninput = function () { settings.riskPct = parseFloat(risk.value) || 1; safeSetSettings(settings); }; }
    var showAuto = $("#set-show-auto"); if (showAuto) { showAuto.checked = settings.showAuto !== false; showAuto.onchange = function () { settings.showAuto = showAuto.checked; safeSetSettings(settings); renderAll(); }; }
    var compact = $("#set-compact"); if (compact) { compact.checked = !!settings.compact; compact.onchange = function () { settings.compact = compact.checked; safeSetSettings(settings); applySettings(); }; }
    bindAiSettings();
    bindRemoteSettings();
    bindVoiceSettings();
    var np = $("#set-notif-popup"); if (np) { np.checked = settings.notifPopup; np.onchange = function () { settings.notifPopup = np.checked; safeSetSettings(settings); }; }
    var no = $("#set-notif-os"); if (no) {
      no.checked = settings.notifOS;
      no.onchange = function () {
        if (no.checked && "Notification" in window && Notification.permission !== "granted") {
          Notification.requestPermission().then(function (perm) { settings.notifOS = perm === "granted"; no.checked = settings.notifOS; safeSetSettings(settings); });
        } else { settings.notifOS = no.checked; safeSetSettings(settings); }
      };
    }
    var reset = $("#set-reset"); if (reset) reset.onclick = function () {
      var d = {}; for (var k in DEFAULT_SETTINGS) d[k] = DEFAULT_SETTINGS[k];
      settings = d; safeSetSettings(settings); applySettings(); bindSettings(); renderAll();
    };
    applySettings();
  }
  function bindAiSettings() {
    var modeSel = $("#set-ai-mode"), provSel = $("#set-ai-provider"), keyIn = $("#set-ai-key"), modelIn = $("#set-ai-model");
    var testBtn = $("#set-ai-test"), statusEl = $("#set-ai-status"), toggleKey = $("#set-ai-key-toggle");
    if (!modeSel || !provSel) return;
    if (!provSel.options.length) provSel.innerHTML = Object.keys(AI_PROVIDERS).map(function (id) { return '<option value="' + id + '">' + esc(AI_PROVIDERS[id].label) + "</option>"; }).join("");
    modeSel.value = settings.aiMode || "offline";
    provSel.value = settings.aiProvider || "groq";
    keyIn.value = settings.aiKey || "";
    modelIn.value = settings.aiModel || "";
    modelIn.placeholder = "default: " + (AI_PROVIDERS[provSel.value] || {}).defaultModel;
    modeSel.onchange = function () { settings.aiMode = modeSel.value; safeSetSettings(settings); };
    provSel.onchange = function () { settings.aiProvider = provSel.value; settings.aiModel = ""; modelIn.value = ""; modelIn.placeholder = "default: " + (AI_PROVIDERS[provSel.value] || {}).defaultModel; safeSetSettings(settings); if (statusEl) statusEl.textContent = ""; };
    keyIn.oninput = function () { settings.aiKey = keyIn.value.trim(); safeSetSettings(settings); if (statusEl) statusEl.textContent = ""; };
    modelIn.oninput = function () { settings.aiModel = modelIn.value.trim(); safeSetSettings(settings); };
    if (toggleKey) toggleKey.onclick = function () { keyIn.type = keyIn.type === "password" ? "text" : "password"; toggleKey.textContent = keyIn.type === "password" ? "Show" : "Hide"; };
    if (testBtn) testBtn.onclick = function () {
      if (!settings.aiKey) { if (statusEl) { statusEl.textContent = "Enter a key first."; statusEl.className = "note"; statusEl.style.color = "var(--bad)"; } return; }
      if (statusEl) { statusEl.textContent = "Testing…"; statusEl.style.color = ""; }
      testBtn.disabled = true;
      callOnlineAI("Reply with exactly: OK").then(function (r) {
        if (statusEl) { statusEl.textContent = "✓ Connected — " + AI_PROVIDERS[settings.aiProvider].label + " replied: “" + r.slice(0, 80) + "”"; statusEl.style.color = "var(--good)"; }
      }).catch(function (e) {
        if (statusEl) { statusEl.textContent = "✗ " + e.message; statusEl.style.color = "var(--bad)"; }
      }).then(function () { testBtn.disabled = false; });
    };
  }

  /* ================= Remote data refresh (optional) =================
   * Bundled xauusd-data.js/news-auto.js give an instant, fully offline first paint - that never
   * changes. This block is an opt-in layer on top: if Settings has a remote base URL (e.g. this
   * repo's raw.githubusercontent.com path once the daily-refresh.yml / news-watch.yml bot is
   * pushing to it), the app periodically fetches the live files from there and swaps them in
   * without a reload, so an already-installed APK/PWA sees the bot's updates without a rebuild.
   * The fetched files are plain `window.X = {...}` assignments (same as loaded via <script src>),
   * evaluated in an isolated sandbox function scope - never string-eval'd into this app's own
   * global scope, and never executed if the fetch/JSON-shape doesn't look right. */
  var remoteTimer = null, lastRemoteMarketUpdated = D.updated, lastRemoteNewsGenerated = (window.NEWS_AUTO || {}).generatedAt;
  function sandboxEvalDataFile(text, globalName) {
    var win = {};
    new Function("window", text)(win); // same pattern telegram-notify.js uses server-side
    return win[globalName] || null;
  }
  function fetchText(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  }
  function applyRemoteData(remoteMarket, remoteNewsAuto) {
    if (remoteMarket) {
      Object.keys(D).forEach(function (k) { delete D[k]; });
      Object.assign(D, remoteMarket);
      T = D.tabs.filter(function (t) { return t.id === activeId; })[0] || D.tabs[0];
    }
    if (remoteNewsAuto) {
      window.NEWS_AUTO = remoteNewsAuto;
      function dedupe(list, extra, key) {
        var seen = {}; (list || []).forEach(function (x) { seen[x[key]] = 1; });
        return (list || []).concat((extra || []).filter(function (x) { return x[key] && !seen[x[key]]; }));
      }
      D.incoming = dedupe(D.incoming, remoteNewsAuto.incoming, "event");
      (D.tabs || []).forEach(function (t) {
        var by = remoteNewsAuto.byTab && remoteNewsAuto.byTab[t.id]; if (!by) return;
        t.news = dedupe(t.news, by.news, "title");
        t.speakers = dedupe(t.speakers, by.speakers, "quote");
      });
    }
    renderAll(); updateChartContext();
    showToast("Data refreshed", "Picked up the latest bot update" + (remoteMarket ? " (" + (remoteMarket.updated || "") + ")" : "") + ".");
  }
  function checkRemote(base, statusEl) {
    if (!base) return Promise.resolve({ changed: false });
    var b = base.replace(/\/?$/, "/");
    return Promise.all([
      fetchText(b + "xauusd-data.js").then(function (t) { return sandboxEvalDataFile(t, "MARKET_DATA"); }).catch(function () { return null; }),
      fetchText(b + "news-auto.js").then(function (t) { return sandboxEvalDataFile(t, "NEWS_AUTO"); }).catch(function () { return null; })
    ]).then(function (res) {
      var rm = res[0], rn = res[1];
      var changed = false;
      if (rm && rm.updated && rm.updated !== lastRemoteMarketUpdated) { lastRemoteMarketUpdated = rm.updated; changed = true; }
      else rm = null;
      if (rn && rn.generatedAt && rn.generatedAt !== lastRemoteNewsGenerated) { lastRemoteNewsGenerated = rn.generatedAt; changed = true; }
      else rn = null;
      if (changed) applyRemoteData(rm, rn);
      if (statusEl) statusEl.textContent = changed ? "✓ Updated just now." : "✓ Checked — already up to date.";
      return { changed: changed };
    }).catch(function (e) {
      if (statusEl) statusEl.textContent = "✗ " + e.message;
      return { changed: false };
    });
  }
  function scheduleRemotePolling() {
    if (remoteTimer) { clearInterval(remoteTimer); remoteTimer = null; }
    if (!settings.remoteUrl) return;
    var ms = Math.max(1, Number(settings.remoteMin) || 15) * 60000;
    remoteTimer = setInterval(function () { checkRemote(settings.remoteUrl, null); }, ms);
  }
  function bindRemoteSettings() {
    var urlIn = $("#set-remote-url"), minSel = $("#set-remote-min"), testBtn = $("#set-remote-test"), statusEl = $("#set-remote-status");
    if (!urlIn) return;
    urlIn.value = settings.remoteUrl || "";
    if (minSel) minSel.value = settings.remoteMin || "15";
    urlIn.onchange = function () { settings.remoteUrl = urlIn.value.trim(); safeSetSettings(settings); scheduleRemotePolling(); if (statusEl) statusEl.textContent = ""; };
    if (minSel) minSel.onchange = function () { settings.remoteMin = minSel.value; safeSetSettings(settings); scheduleRemotePolling(); };
    if (testBtn) testBtn.onclick = function () {
      if (!settings.remoteUrl) { if (statusEl) statusEl.textContent = "Enter a remote base URL first."; return; }
      if (statusEl) statusEl.textContent = "Checking…";
      checkRemote(settings.remoteUrl, statusEl);
    };
  }

  /* ---- toasts + OS notifications, both gated behind Settings toggles ---- */
  function showToast(title, body) {
    var wrap = $("#toast-wrap"); if (!wrap) return;
    var el = document.createElement("div"); el.className = "toast";
    el.innerHTML = "<b>" + esc(title) + "</b>" + esc(body || "");
    wrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 8000);
  }
  function notifyOS(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body: body || "" }); } catch (e) {}
  }
  function fireAlert(title, body) {
    if (settings.notifPopup) showToast(title, body);
    if (settings.notifOS) notifyOS(title, body);
    speak(title + (body ? ". " + body : ""));
  }

  /* ---- desk assistant: a local, offline chat bubble that answers from this page's own data ---- */
  function nextIncomingEvent() {
    var now = new Date();
    var items = (D.incoming || []).map(function (e) { return { e: e, t: parseEventTime(e.timeGmt) }; })
      .sort(function (a, b) { return (a.t ? a.t.getTime() : Infinity) - (b.t ? b.t.getTime() : Infinity); });
    for (var i = 0; i < items.length; i++) { if (items[i].t && items[i].t.getTime() >= now.getTime()) return items[i]; }
    return null;
  }
  function findPairInText(q) {
    var norm = q.toUpperCase().replace(/\s+/g, "");
    var found = (D.fxPairs || []).filter(function (p) { return norm.indexOf(p.pair.replace("/", "")) > -1 || norm.indexOf(p.pair) > -1; });
    return found[0] || null;
  }
  function findSpeakerInText(q) {
    var norm = q.toLowerCase();
    var found = (T.speakers || []).filter(function (sp) { return sp.name && norm.indexOf(sp.name.toLowerCase()) > -1; });
    return found[0] || null;
  }
  var TAB_SYNONYMS = { gold: ["gold", "xauusd", "xau/usd", "xau", "silver", "xag", "commodity", "commodities"], crypto: ["crypto", "bitcoin", "btc", "ethereum", "eth", "coin"], forex: ["forex", "fx pair", "fx pairs", " fx ", "currency", "currencies"] };
  function findTabInText(q) {
    var lq = " " + q.toLowerCase() + " ";
    for (var id in TAB_SYNONYMS) {
      for (var i = 0; i < TAB_SYNONYMS[id].length; i++) {
        if (lq.indexOf(TAB_SYNONYMS[id][i]) > -1) return D.tabs.filter(function (t) { return t.id === id; })[0] || null;
      }
    }
    return null;
  }
  function tabSummary(tab) {
    var s = tab.sentiment || {};
    return tab.label + ": spot " + money(tab.price.spot) + " (" + (tab.price.changePct >= 0 ? "+" : "") + num(tab.price.changePct) + "%), gauge " + (s.bias || "—") + "/" + (s.tone || "—") + ".";
  }
  function answerQuery(qRaw) {
    var q = String(qRaw || "").trim();
    var lq = q.toLowerCase();
    if (!q) return "Ask me something — try \"next event\", \"gauge\", \"EUR/USD signal\", \"switch to crypto\", or \"sources\".";
    if (/\bhelp\b|what can you do/.test(lq)) {
      return "I read this page's own loaded data (no internet, no external AI) and can answer: next event / when / what time to trade, today's alerts, the hawkish/dovish gauge, spot price, a pair's BUY/SELL signal, a speaker's stance, \"summarise\", \"report\" (multi-section with references), \"why\", \"how to trade\", \"predict\" / \"outlook\", \"advice\", \"pivot [symbol]\", \"pips EUR/USD 1.1050 to 1.1100\", \"sources\", or \"switch to gold/crypto/forex\".";
    }
    if (/^(switch to|open|go to|show)\s/.test(lq) || /^(gold|crypto|forex)$/.test(lq)) {
      var swTab = findTabInText(q);
      if (swTab) { setInst(swTab.id); return "Switched to " + swTab.label + ". " + tabSummary(swTab); }
    }
    if (/what.?s next|\bnext\s+(event|news|release)\b|\bwhen\s+is\b|\bwhat\s+time\b.*(news|event)?|\bnext\b$/.test(lq)) {
      var nx = nextIncomingEvent();
      if (!nx) return "No upcoming events left in the loaded calendar.";
      var hAway = nx.t ? Math.round((nx.t.getTime() - Date.now()) / 3600000) : null;
      return "Next event: " + nx.e.event + " (" + (nx.e.importance || "").toUpperCase() + ")" + (hAway != null ? ", in about " + hAway + "h" : "") + ". Time: MYT " + mytDisplay(nx.e.timeMyt) + " / GMT " + (nx.e.timeGmt || "—") + ". Focus timeframe: " + (nx.e.focusTf || "—") + ". " + (nx.e.url ? "Source: " + nx.e.url : "No source linked.");
    }
    if (/\balert/.test(lq)) {
      var today = (T.alerts || {}).today || [];
      if (!today.length) return "No alerts flagged today for " + T.label + ".";
      return today.length + " alert(s) today for " + T.label + ": " + today.map(function (a) { return "[" + (a.level || "").toUpperCase() + "] " + a.text; }).join(" · ");
    }
    if (/gauge|sentiment|hawkish|dovish/.test(lq)) {
      var s = T.sentiment || {};
      return T.label + " gauge: " + (s.bias || "—") + " / " + (s.tone || "—") + ", confidence " + (s.confidence || "—") + "%. " + (s.summary || "");
    }
    if (/\bsource|link/.test(lq)) {
      var count = $$("#sources-list .al").length;
      return "Every incoming event, news headline and speaker quote links to its source — open the News view and scroll to the Sources card (" + count + " links collected for " + T.label + ").";
    }
    /* ---- pips: "50 pips EURUSD", "pips EURUSD 1.1050 to 1.1100", "pip size XAUUSD" ---- */
    if (/\bpip(s)?\b/.test(lq)) {
      var pp = findPairInText(q) || (/xau|gold/i.test(q) ? { pair: "XAU/USD" } : /xag|silver/i.test(q) ? { pair: "XAG/USD" } : /btc|bitcoin/i.test(q) ? { pair: "BTC/USD" } : null);
      var symKey = pp ? pp.pair.replace("/", "") : null;
      var nums = q.match(/\d+(\.\d+)?/g) || [];
      var dv = symKey ? pipDollarValue(symKey) : null;
      var dvTxt = dv != null ? " ≈ " + money(dv) + "/pip at " + settings.lotSize + " lot (" + settings.accountCcy + " account)." : (symKey && settings.accountCcy ? " Pip $ value not shown — " + pp.pair + " isn't quoted in your account currency (" + settings.accountCcy + "); set it in Settings if this is wrong." : "");
      if (/size|worth|value/.test(lq) && symKey) {
        return "Pip size for " + pp.pair + ": " + pipSize(symKey) + " (i.e. price moving by " + pipSize(symKey) + " = 1 pip)." + dvTxt;
      }
      if (nums.length >= 2 && symKey) {
        var a = parseFloat(nums[0]), b = parseFloat(nums[1]);
        var mv = Math.abs(b - a), pips = pipsFor(symKey, mv);
        return "Move from " + a + " to " + b + " on " + pp.pair + " = " + num(mv) + " price = " + (pips != null ? pips.toFixed(1) : "—") + " pips (pip size " + pipSize(symKey) + ")." + (dv != null ? " That's " + money(dv * (pips || 0)) + " at " + settings.lotSize + " lot." : "");
      }
      if (nums.length === 1 && symKey) {
        var n1 = parseFloat(nums[0]);
        return n1 + " pips on " + pp.pair + " = " + num(n1 * pipSize(symKey)) + " in price (pip size " + pipSize(symKey) + ")." + (dv != null ? " That's " + money(dv * n1) + " at " + settings.lotSize + " lot." : "");
      }
      if (symKey) return "Ask e.g. \"pips " + pp.pair + " 1.1050 to 1.1100\" or \"50 pips " + pp.pair + "\" and I'll convert. Pip size here: " + pipSize(symKey) + ".";
      return "Tell me the pair too, e.g. \"pips EUR/USD 1.1050 to 1.1100\" or \"50 pips XAU/USD\".";
    }
    /* ---- pivot: reuses the same Pivot card math (classic floor pivots from H/L/C) ---- */
    if (/\bpivot\b/.test(lq)) {
      var pvSym = (findPairInText(q) || {}).pair || (/xau|gold/i.test(q) ? "XAU/USD" : /xag|silver/i.test(q) ? "XAG/USD" : /btc/i.test(q) ? "BTC" : pivotSymbol);
      var det = autoDetectOHLC(pvSym);
      if (!det) return "No H/L/C yet for " + pvSym + " to compute a pivot — open the Pivot card (Analysis tab), pick " + pvSym + " and enter High/Low/Close (or wait for a few live ticks to auto-detect).";
      var rows = pivotRows(det.h, det.l, det.c);
      var line = rows.map(function (r) { return r[0] + " " + num(r[1]); }).join(" · ");
      return pvSym + " pivot (from live-session H " + num(det.h) + " / L " + num(det.l) + " / C " + num(det.c) + "): " + line + ". Full ladder + editable inputs: Analysis tab → Pivot card.";
    }
    /* ---- predict: directional call from the loaded sentiment model, always caveated ---- */
    if (/\bpredict|forecast|outlook\b/.test(lq)) {
      var pTab = findTabInText(q) || T;
      var ps = pTab.sentiment || {};
      var confWord = (ps.confidence || 0) >= 80 ? "high" : (ps.confidence || 0) >= 60 ? "medium" : "low";
      return "Model-implied bias for " + pTab.label + ": " + (ps.netSignal || "—") + " (" + (ps.bias || "—") + "/" + (ps.tone || "—") + "), cumulative est. move " + pctTxt(ps.netPct) + ", " + confWord + " confidence (" + (ps.confidence || "—") + "%). Basis: " + (ps.summary || "loaded news/speaker set") + " This is a heuristic read of already-priced news, not a guaranteed forecast — events overlap and surprises are not in this number.";
    }
    /* ---- advice: gauge + best pair + timing, combined into one actionable line ---- */
    if (/\badvice|recommend|what should i (do|trade)|trade idea|what.?s the trade\b/.test(lq)) {
      var aTab = findTabInText(q) || T;
      var as = aTab.sentiment || {};
      var nxA = nextIncomingEvent();
      var advPairs = (D.fxPairs || []).map(function (p) { return { pair: p.pair, s: pairSignal(p) }; }).sort(function (x, y) { return y.s.strength - x.s.strength; })[0];
      var out = aTab.label + ": " + (as.netSignal || "—") + ", confidence " + (as.confidence || "—") + "%. " + (aTab.dirRule || "");
      if (advPairs && aTab.id === "forex") out += " Cleanest expression: " + advPairs.pair + " " + advPairs.s.signal + " (score " + (advPairs.s.score > 0 ? "+" : "") + advPairs.s.score.toFixed(2) + ").";
      if (nxA) out += " Next catalyst: " + nxA.e.event + " at MYT " + mytDisplay(nxA.e.timeMyt) + ", focus " + (nxA.e.focusTf || "—") + " — size down or wait through the print if you're not trading the news itself.";
      out += " Your risk setting: " + (settings.riskPct || 1) + "% per trade, " + settings.lotSize + " lot (Settings → Trading profile) — size the stop distance to that, not the other way round. Not financial advice — a model read of the loaded data only.";
      return out;
    }
    /* ---- report: multi-section summary with every source link, for pasting elsewhere ---- */
    if (/\breport\b/.test(lq)) {
      var rTab = findTabInText(q) || T;
      var rs = rTab.sentiment || {};
      var top5 = (rTab.news || []).slice(0, 5);
      var spk5 = (rTab.speakers || []).slice(0, 3);
      var lines = [];
      lines.push("REPORT — " + rTab.label + " (" + (D.updated || "—") + ")");
      lines.push("Gauge: " + (rs.bias || "—") + "/" + (rs.tone || "—") + ", " + (rs.netSignal || "—") + " " + pctTxt(rs.netPct) + ", confidence " + (rs.confidence || "—") + "%.");
      lines.push("Why: " + (rs.summary || "—"));
      if (top5.length) lines.push("Top news: " + top5.map(function (n) { return n.title + " [" + n.signal + ", " + pctTxt(n.impactPct) + "] (" + n.source + ")"; }).join(" | "));
      if (spk5.length) lines.push("Key speakers: " + spk5.map(function (s) { return s.name + " (" + s.role + ") " + s.side.toUpperCase() + " " + pctTxt(s.impactPct); }).join(" | "));
      var nxR = nextIncomingEvent();
      if (nxR) lines.push("Next event: " + nxR.e.event + " — MYT " + mytDisplay(nxR.e.timeMyt) + ", focus " + (nxR.e.focusTf || "—") + ".");
      lines.push("References: " + top5.concat(spk5).map(function (x) { return x.url; }).filter(Boolean).join(" , "));
      return lines.join("\n");
    }
    /* ---- why: explain the current gauge/signal in plain language ---- */
    if (/^\s*why\b/.test(lq)) {
      var wTab = findTabInText(q) || T;
      var ws = wTab.sentiment || {};
      return "Why " + wTab.label + " is " + (ws.netSignal || "—") + ": " + (ws.summary || "no summary loaded") + " " + (ws.netNote || "");
    }
    /* ---- how: what to actually do with the current read ---- */
    if (/^\s*how\b.*(trade|play)|how to trade/.test(lq)) {
      var hTab = findTabInText(q) || T;
      var hs = hTab.sentiment || {};
      var nxH = nextIncomingEvent();
      return "How to trade " + hTab.label + ": rule is \"" + (hTab.dirRule || "—") + "\", current read is " + (hs.netSignal || "—") + ". " + (nxH ? "Wait for " + nxH.e.event + " (MYT " + mytDisplay(nxH.e.timeMyt) + ") if you want to trade the catalyst itself, focus timeframe " + (nxH.e.focusTf || "—") + "; the first M1-M5 spike often reverses, so the listed focus timeframe is usually where the real move holds." : "No upcoming catalyst loaded — this would be a positioning trade on the existing gauge only.") + " Size and stops are your call — this desk gives direction and timing, not position sizing.";
    }
    if (/\bwhat time (should|to|do i)\b.*trade|best (time|session) to trade|when.*trade\b/.test(lq)) {
      var btTab = findTabInText(q) || T;
      var grp = btTab.id === "gold" ? "Commodity" : btTab.id === "crypto" ? "Crypto" : "Forex";
      var bw = (D.bestWindow || {})[grp] || "no session guidance loaded";
      var nxW = nextIncomingEvent();
      return "Best window for " + btTab.label + ": " + bw + (nxW ? " Next catalyst: " + nxW.e.event + " at MYT " + mytDisplay(nxW.e.timeMyt) + "." : "");
    }
    if (/summar|summary|catch me up|recap/.test(lq)) {
      var focusTab = findTabInText(q);
      var tgt = focusTab || T;
      var items2 = (focusTab ? focusTab.news : T.news) || [];
      if (!items2.length) return "No news loaded for " + tgt.label + " to summarise.";
      var buys = items2.filter(function (n) { return n.signal === "BUY"; }).length;
      var sells = items2.filter(function (n) { return n.signal === "SELL"; }).length;
      var lead = tgt.label + " summary — " + items2.length + " headlines (" + buys + " bullish, " + sells + " bearish). Gauge: " + ((tgt.sentiment || {}).bias || "—") + "/" + ((tgt.sentiment || {}).tone || "—") + ". ";
      var top3 = items2.slice(0, 3).map(function (n) { return n.title + " [" + n.signal + "]"; }).join(" · ");
      return lead + "Top headlines: " + top3;
    }
    var pair = findPairInText(q);
    if (pair) {
      var sig = pairSignal(pair);
      return pair.pair + ": " + sig.signal + " (score " + (sig.score > 0 ? "+" : "") + sig.score.toFixed(2) + "), snapshot " + pairFmt(pair.snap) + ". Derived from the currency-bias table, base minus quote.";
    }
    var spk = findSpeakerInText(q);
    if (spk) {
      return spk.name + " (" + spk.role + "): " + spk.side.toUpperCase() + " — \"" + spk.quote + "\" · est. impact " + pctTxt(spk.impactPct) + (spk.url ? " · " + spk.url : "");
    }
    if (/\bspot\b|\bprice\b/.test(lq)) {
      return T.label + " spot: " + money(T.price.spot) + " (" + (T.price.change >= 0 ? "+" : "") + num(T.price.change) + ", " + (T.price.changePct >= 0 ? "+" : "") + num(T.price.changePct) + "%).";
    }
    var mentionedTab = findTabInText(q);
    if (mentionedTab) return tabSummary(mentionedTab) + " Say \"switch to " + mentionedTab.id + "\" to open that tab.";
    return NO_LOCAL_MATCH;
  }
  var NO_LOCAL_MATCH = "I couldn't match that to loaded data. Try: \"next event\", \"alerts\", \"gauge\", \"EUR/USD signal\", \"switch to crypto\", a speaker's name, or \"sources\".";

  /* ================= Online AI (bring-your-own-key, optional) =================
   * Everything above is 100% offline. This block is the opt-in exception: if the user pastes
   * their own API key in Settings, we call it directly from the browser (all five providers
   * below expose CORS to the browser — no proxy server needed, confirmed by hand). The key is
   * stored only in this device's localStorage and sent only to the provider's own endpoint,
   * never anywhere else. Local pattern-matching above always runs first and is preferred for
   * anything it can answer (pips/pivot/signals are exact math — an LLM is the wrong tool for
   * that); online AI only fires for "hybrid" mode when local truly has no match, or in "always"
   * mode. Every online reply is grounded with a compact snapshot of THIS page's own loaded data
   * as a system prompt, and is visually tagged (see bindAssistant) so answers are never
   * silently swapped between offline-certain and online-generated. */
  var AI_PROVIDERS = {
    groq: { label: "Groq (fast, generous free tier)", defaultModel: "llama-3.3-70b-versatile", endpoint: "https://api.groq.com/openai/v1/chat/completions", kind: "openai-chat" },
    openrouter: { label: "OpenRouter (many free models)", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", endpoint: "https://openrouter.ai/api/v1/chat/completions", kind: "openai-chat" },
    openai: { label: "OpenAI", defaultModel: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions", kind: "openai-chat" },
    gemini: { label: "Google Gemini (free tier)", defaultModel: "gemini-1.5-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", kind: "gemini" },
    anthropic: { label: "Anthropic Claude", defaultModel: "claude-haiku-4-5-20251001", endpoint: "https://api.anthropic.com/v1/messages", kind: "anthropic" }
  };
  function aiContextSnapshot() {
    var s = T.sentiment || {};
    var news = (T.news || []).slice(0, 6).map(function (n) { return n.title + " [" + n.signal + ", " + pctTxt(n.impactPct) + "]"; });
    var spk = (T.speakers || []).slice(0, 4).map(function (sp) { return sp.name + " (" + sp.role + ") " + sp.side; });
    var nx = nextIncomingEvent();
    var strength = computeCurrencyStrength().filter(function (r) { return r.n > 0; }).slice(0, 3).map(function (r) { return r.code + " " + (r.v > 0 ? "+" : "") + r.v.toFixed(2) + "%"; });
    return "Instrument: " + T.label + " | Spot: " + money(T.price.spot) + " (" + pctTxt(T.price.changePct) + ")\n" +
      "Gauge: " + (s.bias || "—") + "/" + (s.tone || "—") + ", " + (s.netSignal || "—") + " " + pctTxt(s.netPct) + ", confidence " + (s.confidence || "—") + "%\n" +
      "Direction rule: " + (T.dirRule || "—") + "\n" +
      "Top news: " + (news.join(" | ") || "none loaded") + "\n" +
      "Key speakers: " + (spk.join(" | ") || "none loaded") + "\n" +
      "Next event: " + (nx ? nx.e.event + " at MYT " + mytDisplay(nx.e.timeMyt) + ", focus " + (nx.e.focusTf || "—") : "none loaded") + "\n" +
      "Live currency strength (top movers): " + (strength.join(", ") || "not enough live ticks yet") + "\n" +
      "Data as of: " + (D.updated || "—");
  }
  var AI_SYSTEM_PROMPT = "You are the XAU//DESK desk assistant, embedded in a gold/forex/crypto news dashboard. " +
    "Answer using ONLY the data snapshot given below plus general, widely-known trading concepts — never invent prices, news, or events not in the snapshot. " +
    "Be concise (2-4 sentences max), name concrete numbers from the snapshot when relevant, and always end with a one-line reminder that this is a heuristic read, not financial advice. " +
    "If the question needs live data not in the snapshot, say so plainly instead of guessing.\n\nDATA SNAPSHOT:\n";
  function callOnlineAI(question) {
    var prov = AI_PROVIDERS[settings.aiProvider];
    if (!prov) return Promise.reject(new Error("No provider selected"));
    var key = settings.aiKey;
    if (!key) return Promise.reject(new Error("No API key set — add one in Settings → Online AI"));
    var model = settings.aiModel || prov.defaultModel;
    var sys = AI_SYSTEM_PROMPT + aiContextSnapshot();
    if (prov.kind === "openai-chat") {
      var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
      if (settings.aiProvider === "openrouter") { headers["HTTP-Referer"] = location.href; headers["X-Title"] = "XAU//DESK"; }
      return fetch(prov.endpoint, {
        method: "POST", headers: headers,
        body: JSON.stringify({ model: model, messages: [{ role: "system", content: sys }, { role: "user", content: question }], temperature: 0.3, max_tokens: 400 })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status)); return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "(empty response)"; }); });
    }
    if (prov.kind === "gemini") {
      var url = prov.endpoint.replace("{model}", encodeURIComponent(model)).replace("{key}", encodeURIComponent(key));
      return fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: question }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 400 } })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status)); var c = j.candidates && j.candidates[0]; var parts = c && c.content && c.content.parts; return (parts && parts.map(function (p) { return p.text; }).join("")) || "(empty response)"; }); });
    }
    if (prov.kind === "anthropic") {
      return fetch(prov.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: model, system: sys, messages: [{ role: "user", content: question }], max_tokens: 400 })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status)); return (j.content && j.content[0] && j.content[0].text) || "(empty response)"; }); });
    }
    return Promise.reject(new Error("Unknown provider kind"));
  }
  function assistAddMsg(text, who, tag) {
    var box = $("#assist-body"); if (!box) return;
    var tagHtml = tag ? '<span class="assist-tag">' + esc(tag) + "</span>" : "";
    box.insertAdjacentHTML("beforeend", '<div class="assist-msg ' + (who === "user" ? "user" : "bot") + '">' + tagHtml + esc(text).replace(/\n/g, "<br>") + "</div>");
    box.scrollTop = box.scrollHeight;
  }
  function bindAssistant() {
    var fab = $("#assist-fab"), panel = $("#assist-panel"), close = $("#assist-close"), input = $("#assist-input"), send = $("#assist-send");
    if (!fab || !panel) return;
    var greeted = false;
    function open() {
      panel.classList.add("open");
      if (!greeted) {
        greeted = true;
        var onlineNote = settings.aiMode && settings.aiMode !== "offline" && settings.aiKey
          ? " Online AI (" + (AI_PROVIDERS[settings.aiProvider] || {}).label + ") is on as " + (settings.aiMode === "always" ? "the primary answerer" : "a fallback when I can't match locally") + " — change this in Settings → Online AI."
          : " Fully offline right now — add your own API key in Settings → Online AI to enable online answers for open-ended questions.";
        assistAddMsg("Hi" + (settings.profile ? " " + settings.profile : "") + " — I'm the desk assistant. I read this page's own loaded data first, always." + onlineNote + " Try \"advice\", \"predict gold\", \"why\", \"how to trade\", \"report\", \"pivot XAU/USD\", \"pips EUR/USD 1.1050 to 1.1100\", \"next event\", or tap the mic to talk.", "bot");
      }
      if (input) input.focus();
    }
    function toggle() { panel.classList.contains("open") ? panel.classList.remove("open") : open(); }
    function ask(text) {
      var v = text != null ? text : (input ? input.value.trim() : ""); if (!v) return;
      assistAddMsg(v, "user"); if (input) input.value = "";
      var reply = answerQuery(v);
      var mode = settings.aiMode || "offline";
      var wantsOnline = settings.aiKey && (mode === "always" || (mode === "hybrid" && reply === NO_LOCAL_MATCH));
      if (!wantsOnline) { assistAddMsg(reply, "bot", "offline"); speak(reply); return; }
      var thinking = document.createElement("div");
      thinking.className = "assist-msg bot"; thinking.innerHTML = '<span class="assist-tag">online</span>Thinking…';
      var box = $("#assist-body"); if (box) { box.appendChild(thinking); box.scrollTop = box.scrollHeight; }
      callOnlineAI(v).then(function (aiReply) {
        if (thinking.parentNode) thinking.parentNode.removeChild(thinking);
        assistAddMsg(aiReply, "bot", "online · " + (AI_PROVIDERS[settings.aiProvider] || {}).label);
        speak(aiReply);
      }).catch(function (err) {
        if (thinking.parentNode) thinking.parentNode.removeChild(thinking);
        assistAddMsg("Online AI failed (" + err.message + "). Falling back to the offline answer:", "bot", "online · error");
        assistAddMsg(reply, "bot", "offline");
        speak(reply);
      });
    }
    fab.onclick = function () { if (fab.dataset.dragged === "1") { fab.dataset.dragged = ""; return; } toggle(); };
    if (close) close.onclick = function () { panel.classList.remove("open"); };
    if (send) send.onclick = function () { ask(); };
    if (input) input.onkeydown = function (e) { if (e.key === "Enter") ask(); };
    bindAssistMic(ask);
    bindDraggableFab(fab);
  }
  function bindAssistMic(ask) {
    var micBtn = $("#assist-mic"); if (!micBtn) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.title = "Voice input not supported in this browser — try Chrome or Edge"; micBtn.disabled = true; return; }
    var rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    var listening = false;
    rec.onresult = function (e) { ask(e.results[0][0].transcript); };
    rec.onend = function () { listening = false; micBtn.classList.remove("go"); };
    rec.onerror = function () { listening = false; micBtn.classList.remove("go"); };
    micBtn.onclick = function () {
      if (listening) { rec.stop(); return; }
      try { rec.start(); listening = true; micBtn.classList.add("go"); } catch (e) {}
    };
  }
  function bindDraggableFab(fab) {
    var pos = (function () { try { return JSON.parse(localStorage.getItem("xau-fab-pos") || "null"); } catch (e) { return null; } })();
    if (pos) { fab.style.left = pos.x + "px"; fab.style.top = pos.y + "px"; fab.style.right = "auto"; fab.style.bottom = "auto"; }
    var dragging = false, moved = false, offX = 0, offY = 0;
    fab.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false;
      var r = fab.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    });
    fab.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      moved = true;
      var x = e.clientX - offX, y = e.clientY - offY;
      x = Math.max(4, Math.min(window.innerWidth - fab.offsetWidth - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - fab.offsetHeight - 4, y));
      fab.style.left = x + "px"; fab.style.top = y + "px"; fab.style.right = "auto"; fab.style.bottom = "auto";
    });
    fab.addEventListener("pointerup", function () {
      dragging = false;
      if (moved) {
        var r = fab.getBoundingClientRect();
        try { localStorage.setItem("xau-fab-pos", JSON.stringify({ x: r.left, y: r.top })); } catch (err) {}
        fab.dataset.dragged = "1";
      } else { fab.dataset.dragged = ""; }
    });
  }

  /* instrument tabs */
  function renderInst() {
    var box = $("#inst"); box.innerHTML = "";
    D.tabs.forEach(function (t) {
      var b = document.createElement("button");
      b.className = t.id === activeId ? "active" : "";
      b.innerHTML = esc(t.label) + "<small>" + esc(t.subtitle) + "</small>";
      b.onclick = function () { setInst(t.id); };
      box.appendChild(b);
    });
  }
  function setInst(id) {
    activeId = id;
    T = D.tabs.filter(function (t) { return t.id === id; })[0] || D.tabs[0];
    tfFilter = "All";
    renderInst(); renderAll();
    $$("#analysis-scope button").forEach(function (b) { b.classList.toggle("active", b.dataset.id === id); });
    updateChartContext();
  }
  function bindAnalysisScope() {
    $$("#analysis-scope button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.id === activeId);
      b.onclick = function () { setInst(b.dataset.id); };
    });
  }

  /* top / hero / gauge */
  /* The header used to show D.updated verbatim - the ORIGINAL hand-curated xauusd-data.js
   * timestamp, frozen since day one, even after news-auto.js/macro-auto.js started refreshing
   * real data multiple times a day. That made the header actively misleading: it kept saying
   * "built <day-old date>" right above a live-ticking price tape. This picks whichever of
   * D.updated / NEWS_AUTO.generatedAt / MACRO_AUTO.generatedAt is actually the most recent and
   * shows that instead, so the header never claims to be staler than the data really is. */
  function latestRefreshLabel() {
    var candidates = [];
    if (D.updated) { var d0 = new Date(D.updated.replace(" SGT", "Z").replace(" GMT", "Z")); if (!isNaN(d0.getTime())) candidates.push(d0); }
    [window.NEWS_AUTO, window.MACRO_AUTO].forEach(function (src) {
      if (src && src.generatedAt) { var d = new Date(src.generatedAt.replace(" ", "T")); if (!isNaN(d.getTime())) candidates.push(d); }
    });
    if (!candidates.length) return D.updated || "\u2014";
    var latest = new Date(Math.max.apply(null, candidates.map(function (d) { return d.getTime(); })));
    var myt = new Date(latest.getTime() + 8 * 3600 * 1000);
    return DAY_NAMES[myt.getUTCDay()] + ", " + myt.getUTCDate() + " " + MONTH_NAMES[myt.getUTCMonth()] + " " + String(myt.getUTCHours()).padStart(2, "0") + ":" + String(myt.getUTCMinutes()).padStart(2, "0") + " MYT";
  }
  function renderTop() {
    $("#inst-label").textContent = T.label;
    $("#session-label").textContent = D.session || "\u2014";
    $("#updated-label").textContent = latestRefreshLabel();
  }
  function renderHero() {
    var p = T.price;
    $("#k-spot-label").textContent = (T.label.split("\u00b7")[1] || "Spot").trim();
    $("#k-spot").textContent = money(p.spot);
    $("#k-spot-sub").innerHTML = '<span class="' + (p.change >= 0 ? "good" : "bad") + '">' + (p.change >= 0 ? "+" : "") + num(p.change) + " (" + (p.change >= 0 ? "+" : "") + num(p.changePct) + "%)</span> \u00b7 " + esc(p.dayRange);
    var m = T.macro || [];
    ["m1", "m2", "m3"].forEach(function (id, i) {
      var x = m[i] || {};
      $("#k-" + id + "-label").textContent = x.label || "\u2014";
      $("#k-" + id).textContent = x.value || "\u2014";
      $("#k-" + id + "-sub").textContent = (x.delta ? x.delta + " \u00b7 " : "") + (x.note || "");
    });
  }
  function renderGauge() {
    var s = T.sentiment;
    $("#gmark").style.left = Math.max(2, Math.min(98, 50 + (s.score || 0) * 45)) + "%";
    $("#gauge-label").textContent = s.bias + " / " + s.tone + " \u00b7 confidence " + (s.confidence || "\u2014") + "%";
    $("#gauge-summary").textContent = s.summary || "";
    $("#dir-rule").textContent = T.dirRule || "";
    $("#net-sig").innerHTML = '<span class="sig ' + sigCls(s.netSignal) + '">' + esc(s.netSignal) + "</span>";
    $("#net-pct").textContent = pctTxt(s.netPct);
    $("#net-pct").style.color = s.netPct > 0 ? "var(--good)" : "var(--bad)";
    $("#net-sig").style.color = s.netPct > 0 ? "var(--good)" : "var(--bad)";
    $("#net-note").textContent = s.netNote || "";
  }
  function renderAlerts() {
    var map = { high: "b-high", med: "b-med" };
    var fill = function (sel, arr) {
      var box = $(sel); box.innerHTML = "";
      (arr || []).forEach(function (a) {
        box.insertAdjacentHTML("beforeend", '<div class="al"><div class="hd"><span class="badge ' + (map[a.level] || "b-med") + '">' + esc((a.level || "").toUpperCase()) + '</span><span class="badge b-tf">' + esc(a.tf || "") + '</span></div><div class="tx">' + esc(a.text) + "</div></div>");
      });
      if (!(arr || []).length) box.innerHTML = '<div class="note">Nothing flagged.</div>';
    };
    fill("#alerts-today", (T.alerts || {}).today);
    fill("#alerts-week", (T.alerts || {}).week);
    var today = (T.alerts || {}).today || [];
    var key = activeId + ":" + today.length + ":" + (today[0] ? today[0].text : "");
    if (today.length && key !== lastAnnouncedAlerts) {
      lastAnnouncedAlerts = key;
      fireAlert(today.length + (today.length === 1 ? " alert" : " alerts") + " today — " + T.label, today[0].text);
    }
  }
  // eventCurrency lives in shared-market-logic.js now - see that file for why (it had already
  // silently diverged from telegram-notify.js's copy: this dashboard was missing ForexFactory's
  // "[GBP] CPI y/y" bracket-tag detection that the bot already had).
  function eventCurrency(text) { return window.SharedMarketLogic.eventCurrency(text); }
  /* which session (Sydney/Tokyo/London/NY/overlap) is active at a given MYT hour, and the
   * plain-English "when to trade" line combining that with the event's own focus timeframe */
  function sessionAtMyt(hour) {
    var hits = (D.sessions || []).filter(function (s) {
      var m = /(\d{1,2}):\d{2}-(\d{1,2}):\d{2}/.exec(s.myt || ""); if (!m) return false;
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      return a <= b ? (hour >= a && hour < b) : (hour >= a || hour < b);
    });
    return hits.map(function (s) { return s.k; }).join(" + ") || "off-session (thin liquidity)";
  }
  function whenToTradeLine(e, t) {
    var hAway = t ? Math.round((t.getTime() - Date.now()) / 3600000) : null;
    var mytHour = null;
    if (e.timeMyt) { var m = /(\d{1,2}):(\d{2})/.exec(e.timeMyt); if (m) mytHour = parseInt(m[1], 10); }
    var sess = mytHour != null ? sessionAtMyt(mytHour) : "unknown session";
    return "Trade window: MYT " + esc(mytDisplay(e.timeMyt)) + " (" + esc(sess) + ")" + (hAway != null ? ", in ~" + hAway + "h" : "") + ". Focus timeframe " + esc(e.focusTf || "—") + " — the first spike (M1-M5) is often the least reliable print; the numbers above name the timeframe where the real move tends to hold.";
  }
  var tradeFocusOpen = {};
  function renderTradeFocus() {
    var box = $("#trade-focus-list"); if (!box) return;
    var now = new Date();
    var items = (D.incoming || []).filter(function (e) { return settings.showAuto !== false || !e.auto; }).map(function (e) { return { e: e, t: parseEventTime(e.timeGmt) }; })
      .sort(function (a, b) { return (a.t ? a.t.getTime() : Infinity) - (b.t ? b.t.getTime() : Infinity); })
      .filter(function (it) { return !it.t || it.t.getTime() >= now.getTime(); })
      .slice(0, 4);
    if (!items.length) { box.innerHTML = '<div class="note">No upcoming events left in the loaded calendar to map.</div>'; return; }
    box.innerHTML = items.map(function (it, idx) {
      var e = it.e;
      var ccy = eventCurrency(e.event + " " + (e.note || ""));
      var top = bestPairForCurrency(ccy);
      var hAway = it.t ? Math.round((it.t.getTime() - now.getTime()) / 3600000) : null;
      var pairLine = top
        ? esc(top.pair) + ' <span class="sig ' + sigCls(top.s.signal) + '">' + esc(top.s.signal) + "</span> (score " + (top.s.score > 0 ? "+" : "") + top.s.score.toFixed(2) + ")"
        : (ccy ? "No loaded FX pair carries " + esc(ccy) + " — watch it via a related cross or XAU/USD." : "No single currency driver — treat as a broad risk/USD event; watch XAU/USD and DXY directly.");
      var open = !!tradeFocusOpen[idx];
      var more = '<div class="tf-more">' +
        '<div class="im">' + esc(e.note || "") + "</div>" +
        '<div class="mt">MYT ' + esc(mytDisplay(e.timeMyt)) + "  ·  GMT " + esc(e.timeGmt || "—") + "  ·  focus " + esc(e.focusTf || "—") + "</div>" +
        '<div class="im">' + esc(whenToTradeLine(e, it.t)) + "</div>" +
        '<div class="im">' + esc(e.play || "") + "</div>" +
        '<div class="im">' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗ Source: ' + esc(e.source || "official release") + "</a>" : '<span style="color:var(--muted)">Source not linked</span>') + "</div></div>";
      return '<div class="al tf-item' + (open ? " open" : "") + '" data-idx="' + idx + '"><div class="hd"><span class="badge b-tf">' + esc(e.focusTf || "—") + '</span><span class="badge ' + (e.importance === "high" ? "b-high" : "b-med") + '">' + esc((e.importance || "").toUpperCase()) + "</span></div>" +
        '<div class="tx"><b>' + esc(e.event) + "</b>" + (hAway != null ? " · in ~" + hAway + "h" : "") + '<span class="tf-caret">' + (open ? "▲ hide detail" : "▼ tap for detail") + "</span><br>Best expression: " + pairLine + " · Focus timeframe: <b>" + esc(e.focusTf || "—") + "</b></div>" + more + "</div>";
    }).join("");
    $$(".tf-item", box).forEach(function (el) {
      el.onclick = function () { var i = el.dataset.idx; tradeFocusOpen[i] = !tradeFocusOpen[i]; renderTradeFocus(); };
    });
  }
  var incomingView = "upcoming";
  function renderIncoming() {
    var box = $("#incoming-list"); box.innerHTML = "";
    var now = new Date();
    var all = (D.incoming || []).filter(function (e) { return settings.showAuto !== false || !e.auto; }).map(function (e) { return { e: e, t: parseEventTime(e.timeGmt) }; });
    var items = all.slice().sort(function (a, b) { return (a.t ? a.t.getTime() : Infinity) - (b.t ? b.t.getTime() : Infinity); });
    var nextIdx = -1;
    items.forEach(function (it, i) { if (nextIdx === -1 && it.t && it.t.getTime() >= now.getTime()) nextIdx = i; });
    if (nextIdx > -1) {
      var ne = items[nextIdx].e, nkey = activeId + ":" + ne.event + ":" + ne.timeGmt;
      if (nkey !== lastAnnouncedNext) {
        lastAnnouncedNext = nkey;
        var hAway = items[nextIdx].t ? Math.round((items[nextIdx].t.getTime() - now.getTime()) / 3600000) : null;
        fireAlert("Next event - " + T.label, ne.event + ", " + (ne.importance || "") + " impact" + (hAway != null ? ", in about " + hAway + " hours" : "") + ".");
      }
    }
    if (incomingView === "past") {
      items = all.filter(function (it) { return it.t && it.t.getTime() < now.getTime(); }).sort(function (a, b) { return b.t.getTime() - a.t.getTime(); });
      nextIdx = -1;
    } else {
      items = items.filter(function (it) { return !it.t || it.t.getTime() >= now.getTime(); });
    }
    var lastDay = null;
    items.forEach(function (it, i) {
      var e = it.e;
      var day = mytDayLabel(it.t);
      if (day !== lastDay) { lastDay = day; box.insertAdjacentHTML("beforeend", '<div class="day-sep">' + esc(day) + "</div>"); }
      var when = countdownText(it.t ? it.t.getTime() - now.getTime() : null);
      var isSoon = incomingView === "upcoming" && it.t && it.t.getTime() - now.getTime() <= 2 * 3600000 && it.t.getTime() >= now.getTime();
      box.insertAdjacentHTML("beforeend",
        '<div class="inc"><div class="hd"><div>' + (i === nextIdx ? '<span class="badge b-hawk" style="margin-right:6px">NEXT</span>' : "") + '<span class="nm">' + esc(e.event) + '</span> <span class="rl' + (isSoon ? " countdown-live" : "") + '">\u00b7 ' + esc(when) + "</span></div>" +
        '<div style="display:flex;gap:6px;align-items:center"><span class="badge ' + (e.importance === "high" ? "b-high" : "b-med") + '">' + esc((e.importance || "").toUpperCase()) + '</span><span class="badge b-tf">' + esc(e.focusTf || "") + "</span></div></div>" +
        '<div class="im">' + esc(e.note) + "</div>" +
        '<div class="mt">MYT ' + esc(mytDisplay(e.timeMyt || e.timeSgt)) + "  \u00b7  GMT " + esc(e.timeGmt) + "  \u00b7  focus " + esc(e.focusTf) + "</div>" +
        '<div class="im">' + esc(e.play || "") + "</div>" +
        '<div class="im">' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">\u2197 Source: ' + esc(e.source || "official release") + "</a>" : '<span style="color:var(--muted)">Source not linked</span>') + "</div></div>");
    });
    if (!items.length) box.innerHTML = '<div class="note">' + (incomingView === "past" ? "No past events loaded." : "Nothing scheduled.") + "</div>";
  }
  function bindIncomingView() {
    var seg = $("#incoming-view-seg"); if (!seg) return;
    $$("button", seg).forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === incomingView);
      b.onclick = function () { incomingView = b.dataset.view; $$("button", seg).forEach(function (x) { x.classList.toggle("active", x === b); }); renderIncoming(); };
    });
  }
  function renderTfFilter() {
    var set = {}; (T.news || []).forEach(function (n) { set[n.tf || "\u2014"] = 1; });
    var box = $("#tf-filter"); box.innerHTML = "";
    ["All"].concat(Object.keys(set)).forEach(function (f) {
      var b = document.createElement("button");
      b.className = "chip"; b.textContent = f;
      if (f === tfFilter) { b.style.borderColor = "var(--accent)"; b.style.color = "var(--accent)"; }
      b.onclick = function () { tfFilter = f; renderTfFilter(); renderNews(); };
      box.appendChild(b);
    });
  }
  function renderNews() {
    var body = $("#news-body"); body.innerHTML = "";
    var rows = (T.news || []).filter(function (n) { return (tfFilter === "All" || (n.tf || "\u2014") === tfFilter) && (settings.showAuto !== false || !n.auto); })
      .map(function (n) { return { nw: n, meta: parseNewsMeta(n.time) }; })
      .sort(function (a, b) { return b.meta.t - a.meta.t; }); // latest first
    var lastDay = null;
    rows.forEach(function (item) {
      var nw = item.nw;
      if (item.meta.day !== lastDay) {
        lastDay = item.meta.day;
        body.insertAdjacentHTML("beforeend", '<tr class="day-sep-row"><td colspan="7"><div class="day-sep">' + esc(lastDay) + "</div></td></tr>");
      }
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="news-time" style="white-space:nowrap">' + esc(nw.time) + "</td>" +
        '<td><span class="badge b-tf">' + esc(nw.tf || "\u2014") + "</span></td>" +
        '<td><div style="font-weight:600">' + esc(nw.title) + '</div><div style="color:var(--muted);margin-top:2px">' + esc(nw.summary) + "</div></td>" +
        '<td><span class="sig ' + sigCls(nw.signal) + '">' + esc(nw.signal || "\u2014") + "</span></td>" +
        '<td class="pct ' + pctCls(nw.impactPct) + '">' + pctTxt(nw.impactPct) + "</td>" +
        '<td>' + movementBadge(nw.impactPct) + "</td>" +
        '<td style="white-space:nowrap">' + (nw.url ? '<a href="' + esc(nw.url) + '" target="_blank" rel="noopener">' + esc(nw.source) + "</a>" : esc(nw.source || "\u2014")) + "</td>";
      body.appendChild(tr);
    });
    if (!rows.length) body.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">No items for this timeframe.</td></tr>';
  }
  function renderSpeakers() {
    var box = $("#speaker-list"); box.innerHTML = "";
    var order = { hawkish: 0, dovish: 1, neutral: 2 };
    (T.speakers || []).filter(function (sp) { return settings.showAuto !== false || !sp.auto; }).sort(function (a, b) { return (order[a.side] || 9) - (order[b.side] || 9); }).forEach(function (sp) {
      var cls = sp.side === "hawkish" ? "b-hawk" : sp.side === "dovish" ? "b-dove" : "b-neu";
      var side = sp.side === "hawkish" ? "hawk" : sp.side === "dovish" ? "dove" : "";
      var el = document.createElement("div");
      el.className = "spk " + side;
      el.innerHTML =
        '<div class="hd"><div><span class="nm">' + esc(sp.name) + '</span> <span class="rl">\u00b7 ' + esc(sp.role) + "</span></div>" +
        '<div style="display:flex;gap:6px;align-items:center"><span class="badge ' + cls + '">' + esc((sp.side || "").toUpperCase()) + '</span><span class="sig ' + sigCls(sp.signal) + '">' + esc(sp.signal) + "</span></div></div>" +
        '<div class="qt">"' + esc(sp.quote) + '"</div>' +
        '<div class="im">' + esc(sp.impact) + " \u00b7 " + esc(sp.date) + (sp.url ? ' \u00b7 <a href="' + esc(sp.url) + '" target="_blank" rel="noopener">' + esc(sp.source) + "</a>" : "") + "</div>" +
        '<div class="mt">est. impact ' + pctTxt(sp.impactPct) + " " + movementBadge(sp.impactPct) + "  \u00b7  w " + (sp.w != null ? sp.w : "\u2014") + " x s " + (sp.s != null ? sp.s : "\u2014") + " x f " + (sp.f != null ? sp.f : "\u2014") + "</div>";
      box.appendChild(el);
    });
  }
  function renderSources() {
    var box = $("#sources-list"); if (!box) return;
    var seen = {}, rows = [];
    function add(url, label, kind) {
      if (!url) return;
      if (seen[url]) return;
      seen[url] = 1;
      rows.push({ url: url, label: label, kind: kind });
    }
    (D.incoming || []).forEach(function (e) { add(e.url, e.event, "Incoming"); });
    (T.news || []).forEach(function (n) { add(n.url, n.title, "News"); });
    (T.speakers || []).forEach(function (sp) { add(sp.url, sp.name + " — " + sp.role, "Speaker"); });
    box.innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="al"><div class="hd"><span class="badge b-tf">' + esc(r.kind) + '</span></div><div class="tx"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.label) + " ↗</a></div></div>";
    }).join("") : '<div class="note">No linked sources for this instrument yet.</div>';
  }
  function renderModel() {
    var m = D.model || {};
    $("#model-formula").textContent = m.formula || "\u2014";
    $("#model-note").textContent = m.note || "";
    $("#m-base").textContent = (m.base != null ? m.base + "%" : "\u2014");
    [["#m-weights", m.weights], ["#m-strength", m.strength], ["#m-surprise", m.surprise]].forEach(function (pair) {
      var t = $(pair[0]); if (!t) return; t.innerHTML = "";
      (pair[1] || []).forEach(function (r) { t.insertAdjacentHTML("beforeend", "<tr><td>" + esc(r.k) + "</td><td>" + esc(r.v) + "</td></tr>"); });
    });
  }
  function renderCross() {
    var C = D.crossAsset || {};
    $("#cross-note").textContent = C.note || "";
    $("#cross-oil").textContent = C.oilNote || "";
    var head = $("#cross-head"); head.innerHTML = "";
    (C.headers || []).forEach(function (h) { head.insertAdjacentHTML("beforeend", "<th>" + esc(h) + "</th>"); });
    var body = $("#cross-body"); body.innerHTML = "";
    (C.rows || []).forEach(function (r) {
      body.insertAdjacentHTML("beforeend",
        '<tr><td style="font-weight:600">' + esc(r.driver) + "</td>" +
        '<td class="' + dirCls(r.gold) + '">' + dirGlyph(r.gold) + "</td>" +
        '<td class="' + dirCls(r.crypto) + '">' + dirGlyph(r.crypto) + "</td>" +
        '<td class="' + dirCls(r.fx) + '">' + esc(r.fx === "-" ? "-" : r.fx) + "</td>" +
        '<td class="' + dirCls(r.oil) + '">' + dirGlyph(r.oil) + "</td>" +
        '<td style="color:var(--muted)">' + esc(r.note) + "</td></tr>");
    });
    var rb = $("#cross-ratios"); rb.innerHTML = "";
    (C.ratios || []).forEach(function (x) { rb.insertAdjacentHTML("beforeend", '<div class="o"><div class="k">' + esc(x.k) + '</div><div class="val acc">' + esc(x.v) + '</div><div class="note">' + esc(x.note) + "</div></div>"); });
    $("#cross-sources").textContent = C.sources || "";
  }

  /* ---- currency exposure map ---- */
  function renderCurrencies() {
    var body = $("#cur-body"); if (!body) return;
    body.innerHTML = "";
    (D.currencies || []).slice().sort(function (a, b) { return b.bias - a.bias; }).forEach(function (c) {
      var dir = c.bias > 0.15 ? "STRONG" : c.bias < -0.15 ? "WEAK" : "FLAT";
      var cls = c.bias > 0.15 ? "good" : c.bias < -0.15 ? "bad" : "muted";
      body.insertAdjacentHTML("beforeend",
        "<tr><td><b>" + esc(c.code) + "</b> <span style='color:var(--muted)'>" + esc(c.name) + "</span></td>" +
        "<td>" + esc(c.cb) + "</td><td>" + esc(c.stance) + "</td>" +
        '<td class="' + cls + '">' + esc(dir) + " (" + (c.bias > 0 ? "+" : "") + esc(c.bias.toFixed(2)) + ")</td>" +
        "<td>" + esc(c.next) + "</td>" +
        '<td style="color:var(--muted)">' + esc(c.note) + "</td></tr>");
    });
  }

  /* ---- pairs list: content, columns and title all switch with the active instrument tab ---- */
  function renderPairs() {
    var body = $("#pairs-body"), head = $("#pairs-head"), title = $("#pairs-title"), sub = $("#pairs-subtitle"), pn = $("#pair-note");
    if (!body || !head) return;
    body.innerHTML = ""; head.innerHTML = "";
    var exposureCard = $("#currency-exposure-card");
    if (exposureCard) exposureCard.classList.toggle("hidden", activeId !== "forex");

    if (activeId === "gold") {
      if (title) title.textContent = "Commodity List \u2014 gold & silver";
      if (sub) sub.textContent = "Always-on commodity watch (spot metals only). Switch to the Crypto or Forex tab to see those lists.";
      head.innerHTML = "<th>Symbol</th><th>Price</th><th>Since connect</th><th>Source</th>";
      COMMODITIES.forEach(function (c) {
        var px = window.LiveFeed && window.LiveFeed.metal ? window.LiveFeed.metal(c.sym) : null;
        if (px == null && c.sym === "XAU/USD") px = T.price.spot;
        var base = firstPrices["pt-" + c.sym]; if (base == null && px != null) { firstPrices["pt-" + c.sym] = px; base = px; }
        var pct = (px != null && base) ? ((px - base) / base) * 100 : null;
        var tr = document.createElement("tr"); tr.setAttribute("data-pairrow", c.sym);
        tr.innerHTML = "<td><b>" + esc(c.label) + "</b> <span class=\"badge b-neu\">" + esc(c.sym) + "</span></td>" +
          '<td class="px">' + (px != null ? money(px) : "\u2014") + "</td>" +
          '<td class="chg ' + (pct == null ? "muted" : pct > 0 ? "good" : pct < 0 ? "bad" : "muted") + '">' + (pct == null ? "\u2014" : (pct > 0 ? "+" : "") + pct.toFixed(3) + "%") + "</td>" +
          '<td style="color:var(--muted)">Twelve Data (gold WS) / gold-api.com</td>';
        body.appendChild(tr);
      });
      if (pn) pn.textContent = "Commodity prices stream live where a feed is connected; XAU/USD ticks in real time via the Live view.";
    } else if (activeId === "crypto") {
      if (title) title.textContent = "Crypto List \u2014 your selection";
      if (sub) sub.textContent = "Shows every crypto symbol toggled on above.";
      head.innerHTML = "<th>Symbol</th><th>Price</th><th>Since connect</th><th>Source</th>";
      if (!watchlist.crypto.length) { body.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">No crypto symbols selected \u2014 tap one above.</td></tr>'; }
      watchlist.crypto.forEach(function (c) {
        var px = window.LiveFeed && window.LiveFeed.prices ? (window.LiveFeed.prices().crypto || {})[c] : null;
        var base = firstPrices["pt-" + c]; if (base == null && px != null) { firstPrices["pt-" + c] = px; base = px; }
        var pct = (px != null && base) ? ((px - base) / base) * 100 : null;
        var tr = document.createElement("tr"); tr.setAttribute("data-pairrow", c);
        tr.innerHTML = "<td><b>" + esc(c) + "</b></td>" +
          '<td class="px">' + (px != null ? money(px) : "\u2014") + "</td>" +
          '<td class="chg ' + (pct == null ? "muted" : pct > 0 ? "good" : pct < 0 ? "bad" : "muted") + '">' + (pct == null ? "\u2014" : (pct > 0 ? "+" : "") + pct.toFixed(3) + "%") + "</td>" +
          '<td style="color:var(--muted)">Coinbase exchange-rates (polled)</td>';
        body.appendChild(tr);
      });
      if (pn) pn.textContent = "Add or remove symbols with the Crypto chips above; picks are saved on this device.";
    } else {
      if (title) title.textContent = "FX Pair List \u2014 selected pairs only";
      if (sub) sub.textContent = "Shows every FX pair toggled on above. Signal rule: BUY = base currency stronger than quote.";
      head.innerHTML = "<th>Pair</th><th>Price</th><th>Since connect</th><th>Signal</th><th>Score</th><th>Driver events</th><th>Source</th>";
      var selected = (D.fxPairs || []).filter(function (p) { return watchlist.fx.indexOf(p.pair) > -1; });
      if (!selected.length) { body.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">No FX pairs selected \u2014 tap one above.</td></tr>'; }
      selected.forEach(function (p) {
        var s = pairSignal(p);
        var b = cbOf(p.base), q = cbOf(p.quote);
        var tr = document.createElement("tr");
        tr.setAttribute("data-pairrow", p.pair);
        tr.innerHTML =
          "<td><b>" + esc(p.pair) + '</b> <span class="badge b-neu">' + esc(p.group) + "</span></td>" +
          '<td class="px">' + pairFmt(p.snap) + "</td>" +
          '<td class="chg muted">\u2014</td>' +
          '<td><span class="sig ' + sigCls(s.signal) + '">' + esc(s.signal) + "</span></td>" +
          '<td class="pct ' + (s.score > 0 ? "good" : s.score < 0 ? "bad" : "") + '">' + (s.score > 0 ? "+" : "") + s.score.toFixed(2) + "</td>" +
          '<td style="color:var(--muted)">' + esc(b.next || "-") + " / " + esc(q.next || "-") + "</td>" +
          '<td style="color:var(--muted)">' + (p.derived ? "derived" : "quoted") + "</td>";
        body.appendChild(tr);
      });
      if (pn) pn.textContent = (D.pairNote || "") + " Signals are derived from the currency bias table below.";
    }
  }

  /* ---- generated deep-dive analysis ---- */
  function renderAnalysis() {
    var box = $("#analysis-list"); if (!box) return;
    var cs = (D.currencies || []).slice().sort(function (a, b) { return b.bias - a.bias; });
    var pairs = (D.fxPairs || []).map(function (p) { var s = pairSignal(p); return { pair: p.pair, s: s }; });
    var buys = pairs.filter(function (x) { return x.s.signal === "BUY"; });
    var sells = pairs.filter(function (x) { return x.s.signal === "SELL"; });
    var top = pairs.slice().sort(function (a, b) { return b.s.strength - a.s.strength; })[0];
    var jpy = pairs.filter(function (p) { return p.pair.indexOf("JPY") > -1 && p.s.signal !== "NEUTRAL"; });
    var out = [];
    if (cs.length) out.push("<b>Strongest currency:</b> " + cs[0].code + " (" + cs[0].stance + ", bias +" + cs[0].bias.toFixed(2) + ") - " + cs[0].note + ".");
    if (cs.length) out.push("<b>Weakest currency:</b> " + cs[cs.length - 1].code + " (" + cs[cs.length - 1].stance + ", bias " + cs[cs.length - 1].bias.toFixed(2) + ") - " + cs[cs.length - 1].note + ".");
    out.push("<b>Signal split:</b> " + buys.length + " BUY, " + sells.length + " SELL, " + (pairs.length - buys.length - sells.length) + " NEUTRAL across " + pairs.length + " pairs. A dollar-heavy SELL skew means the same trade (long USD) expressed many ways.");
    if (top) out.push("<b>Cleanest expression:</b> " + top.pair + " at " + top.s.signal + " (score " + (top.s.score > 0 ? "+" : "") + top.s.score.toFixed(2) + ") - the widest gap between the two currencies involved.");
    if (jpy.length) out.push("<b>Yen crosses:</b> " + jpy.map(function (p) { return p.pair + " " + p.s.signal; }).join(", ") + " - these carry the most event risk into Friday's BoJ decision.");
    out.push("<b>Event map:</b> FOMC drives every USD leg (16 Sep 18:00 GMT); ECB sets the EUR leg; BoJ sets the JPY leg (18 Sep). Trade the pair whose two currencies are both moving on the same news.");
    box.innerHTML = out.map(function (t) { return '<div class="al"><div class="tx">' + t + "</div></div>"; }).join("");
  }

  /* ---- range + model ---- */
  function renderRanges() {
    var R = D.ranges || {};
    $("#ranges-note").textContent = R.note || "";
    var box = $("#range-methods"); box.innerHTML = "";
    (R.methods || []).forEach(function (mth) {
      box.insertAdjacentHTML("beforeend", '<div class="card"><div class="k">' + esc(mth.name) + '</div><div class="formula">' + esc(mth.formula) + '</div><div class="note"><b>Use:</b> ' + esc(mth.use) + "<br><b>Caveat:</b> " + esc(mth.caveat) + "</div></div>");
    });
    var pf = R.prefill || {};
    $("#c-open").value = pf.open; $("#c-high").value = pf.high; $("#c-low").value = pf.low; $("#c-prev").value = pf.prevClose;
    $("#c-atr").value = pf.atr; $("#c-iv").value = pf.iv; $("#c-dte").value = pf.dte; $("#c-k").value = pf.k;
    $("#calc-note").textContent = R.prefillNote || "";
    calc();
    renderPivotChips();
    bindPivotTf();
    loadPivotInputs();
    renderPivot();
    updateChartContext();
  }
  function calc() {
    var v = function (id) { var x = parseFloat($(id).value); return isNaN(x) ? null : x; };
    var o = v("#c-open"), h = v("#c-high"), l = v("#c-low"), pc = v("#c-prev"), atr = v("#c-atr"), iv = v("#c-iv"), dte = v("#c-dte"), k = v("#c-k");
    var out = [];
    if (o && h != null && l != null) out.push({ k: "Realized range", v: ((h - l) / o * 100).toFixed(2) + "%", n: "(" + h + " - " + l + ") / " + o });
    if (h != null && l != null) {
      var tr = [h - l];
      if (pc != null) tr.push(Math.abs(h - pc), Math.abs(l - pc));
      var trv = Math.max.apply(null, tr);
      out.push({ k: "True range", v: num(trv), n: pc != null ? "max(H-L, |H-PC|, |L-PC|)" : "H - L" });
      if (atr) out.push({ k: "TR / ATR", v: (trv / atr).toFixed(2) + "x", n: "how unusual this candle is" });
      if (atr && k) out.push({ k: "ATR expected range", v: num(atr * k), n: "ATR x " + k + " (event multiplier)" });
    }
    if (o && iv != null && dte != null && dte >= 0) {
      var em = o * (iv / 100) * Math.sqrt(dte / 365);
      out.push({ k: "Implied expected move", v: num(em) + " (" + ((em / o) * 100).toFixed(2) + "%)", n: "Price x IV x sqrt(DTE/365)" });
      out.push({ k: "Implied band", v: num(o - em) + " - " + num(o + em), n: "Price +/- expected move" });
    }
    var box = $("#calc-out"); box.innerHTML = "";
    out.forEach(function (x) { box.insertAdjacentHTML("beforeend", '<div class="o"><div class="k">' + esc(x.k) + '</div><div class="val acc">' + esc(x.v) + '</div><div class="note">' + esc(x.n) + "</div></div>"); });
    if (!out.length) box.innerHTML = '<div class="note">Enter at least Open / High / Low to compute.</div>';
  }

  /* ---- pivot levels: pick a symbol + timeframe, enter that combination's H/L/C.
   *      Every symbol+timeframe pair is saved separately, so switching either one
   *      swaps in its own numbers instead of sharing one global set. ---- */
  var pivotSymbol = "XAU/USD", pivotTf = "d1", pivotAuto = {};
  var PIVOT_TFS = ["h1", "h4", "d1", "w1", "mn1"];
  function pivotSymbolList() {
    return COMMODITIES.map(function (c) { return c.sym; }).concat(watchlist.crypto, watchlist.fx);
  }
  var safeGetPivotData = function () { try { return JSON.parse(localStorage.getItem("xau-pivot-data") || "{}"); } catch (e) { return {}; } };
  var safeSetPivotData = function (d) { try { localStorage.setItem("xau-pivot-data", JSON.stringify(d)); } catch (e) {} };
  var pivotData = safeGetPivotData();
  function pivotRows(h, l, c) {
    var pp = (h + l + c) / 3;
    var r1 = 2 * pp - l, s1 = 2 * pp - h;
    var r2 = pp + (h - l), s2 = pp - (h - l);
    var r3 = h + 2 * (pp - l), s3 = l - 2 * (h - pp);
    return [["R3", r3], ["R2", r2], ["R1", r1], ["Pivot", pp], ["S1", s1], ["S2", s2], ["S3", s3]];
  }
  /* live-tick auto-detect: only meaningful for H1/H4/D1, since the browser only
   * ever has whatever ticks streamed in this session — there is no real weekly
   * or monthly OHLC source wired up, so W1/MN1 always require manual entry. */
  function currentPriceFor(symbol) {
    if (!window.LiveFeed) return null;
    if (COMMODITIES.some(function (c) { return c.sym === symbol; })) return window.LiveFeed.metal ? window.LiveFeed.metal(symbol) : null;
    if (CRYPTO_ALL.indexOf(symbol) > -1) return window.LiveFeed.prices ? (window.LiveFeed.prices().crypto || {})[symbol] : null;
    return window.LiveFeed.priceFor ? window.LiveFeed.priceFor(symbol) : null;
  }
  function autoDetectOHLC(symbol) {
    if (!window.LiveFeed || !window.LiveFeed.history) return null;
    var hist = window.LiveFeed.history(symbol) || [];
    var c = currentPriceFor(symbol);
    if (hist.length >= 2) return { h: Math.max.apply(null, hist), l: Math.min.apply(null, hist), c: c != null ? c : hist[hist.length - 1] };
    if (symbol === "XAU/USD" && D.ranges && D.ranges.prefill) {
      var pf = D.ranges.prefill;
      if (pf.high != null && pf.low != null) return { h: pf.high, l: pf.low, c: pf.prevClose != null ? pf.prevClose : pf.open };
    }
    return null;
  }
  function renderPivotChips() {
    var box = $("#pivot-symbol-chips"); if (!box) return;
    var list = pivotSymbolList();
    if (list.indexOf(pivotSymbol) === -1) pivotSymbol = list[0] || "XAU/USD";
    box.innerHTML = list.map(function (s) { return '<button class="wl-chip' + (s === pivotSymbol ? " on" : "") + '" data-sym="' + esc(s) + '">' + esc(s) + "</button>"; }).join("");
    $$("button", box).forEach(function (b) { b.onclick = function () { pivotSymbol = b.dataset.sym; renderPivotChips(); loadPivotInputs(); renderPivot(); updateChartContext(); }; });
  }
  function bindPivotTf() {
    $$("#pivot-tf-seg button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tf === pivotTf);
      b.onclick = function () { pivotTf = b.dataset.tf; $$("#pivot-tf-seg button").forEach(function (x) { x.classList.toggle("active", x === b); }); loadPivotInputs(); renderPivot(); updateChartContext(); };
    });
  }
  function loadPivotInputs() {
    var key = pivotSymbol + "|" + pivotTf;
    var saved = ((pivotData[pivotSymbol] || {})[pivotTf]);
    var src = saved;
    var auto = false;
    if (!src && (pivotTf === "h1" || pivotTf === "h4" || pivotTf === "d1")) {
      var det = autoDetectOHLC(pivotSymbol);
      if (det) { src = det; auto = true; }
    }
    pivotAuto[key] = auto;
    var d = src || {};
    if ($("#pv-high")) $("#pv-high").value = d.h != null ? round5(d.h) : "";
    if ($("#pv-low")) $("#pv-low").value = d.l != null ? round5(d.l) : "";
    if ($("#pv-close")) $("#pv-close").value = d.c != null ? round5(d.c) : "";
  }
  function round5(v) { return Math.round(v * 100000) / 100000; }
  function renderPivot() {
    var box = $("#pivot-ladder"), src = $("#pivot-source"); if (!box) return;
    var v = function (id) { var el = $(id); var x = el ? parseFloat(el.value) : NaN; return isNaN(x) ? null : x; };
    var h = v("#pv-high"), l = v("#pv-low"), c = v("#pv-close");
    var key = pivotSymbol + "|" + pivotTf;
    if (h == null || l == null || c == null) {
      var needAuto = (pivotTf === "w1" || pivotTf === "mn1");
      box.innerHTML = '<div class="note">Enter High, Low and Close for ' + esc(pivotSymbol) + " (" + pivotTf.toUpperCase() + ")" + (needAuto ? " — no live weekly/monthly source, so this timeframe is always manual." : " — not enough live ticks yet to auto-detect; enter manually or wait a few seconds.") + "</div>";
      if (src) src.textContent = "";
      return;
    }
    if (src) src.textContent = pivotAuto[key] ? "Auto-detected from live ticks collected this session (edit any field to override and save your own)." : "Using your saved values for " + pivotSymbol + " / " + pivotTf.toUpperCase() + ".";
    var rows = pivotRows(h, l, c);
    box.innerHTML = '<div class="note" style="margin-bottom:4px">' + esc(pivotSymbol) + " — " + pivotTf.toUpperCase() + " pivot</div>" + rows.map(function (r) {
      var cls = r[0] === "Pivot" ? "acc" : r[0].charAt(0) === "R" ? "bad" : "good";
      return '<div class="rung"><span class="lab">' + r[0] + '</span><span class="num ' + cls + '">' + num(r[1]) + "</span></div>";
    }).join("");
  }
  function savePivotOverride() {
    /* called only when the user edits a field by hand, so auto-detected values never get "saved" as if they were manual */
    var v = function (id) { var el = $(id); var x = el ? parseFloat(el.value) : NaN; return isNaN(x) ? null : x; };
    var h = v("#pv-high"), l = v("#pv-low"), c = v("#pv-close");
    if (h == null || l == null || c == null) return;
    if (!pivotData[pivotSymbol]) pivotData[pivotSymbol] = {};
    pivotData[pivotSymbol][pivotTf] = { h: h, l: l, c: c };
    safeSetPivotData(pivotData);
    pivotAuto[pivotSymbol + "|" + pivotTf] = false;
    renderPivot();
  }
  function updateChartContext() {
    var el = $("#chart-context"); if (!el) return;
    el.innerHTML = "Pivot levels above are for <b>" + esc(pivotSymbol) + "</b> on <b>" + pivotTf.toUpperCase() + "</b>. The line charts and support/resistance ladder below remain snapshots for the open instrument tab (" + esc(T.label) + ") — this app has no per-pair candle history, so only the Pivot card actually changes with the symbol/timeframe pickers above.";
  }
  function bindPivotInputs() {
    ["pv-high", "pv-low", "pv-close"].forEach(function (id) {
      var el = $("#" + id); if (el) el.addEventListener("input", savePivotOverride);
    });
  }

  /* charts */
  var W = 400, H = 200, PADL = 46, PADR = 12, PADT = 16, PADB = 30;
  function compact(v) { return v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v * 100) / 100); }
  function buildChart(host, series, color) {
    if (!host || !series || !series.points || !series.points.length) return;
    var pts = series.points, yMin = series.yMin, yMax = series.yMax;
    var x = function (i) { return PADL + (i * (W - PADL - PADR) / Math.max(1, pts.length - 1)); };
    var y = function (v) { return PADT + (1 - (v - yMin) / (yMax - yMin)) * (H - PADT - PADB); };
    var grid = "", ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var val = yMin + (yMax - yMin) * t / ticks, yy = y(val);
      grid += '<line x1="' + PADL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PADR) + '" y2="' + yy.toFixed(1) + '" stroke="var(--line)"/>';
      grid += '<text class="axis-text" x="' + (PADL - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end">' + compact(val) + "</text>";
    }
    var step = Math.ceil(pts.length / 5);
    var xlab = pts.map(function (p, i) { return (i % step !== 0 && i !== pts.length - 1) ? "" : '<text class="axis-text" x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(p.x) + "</text>"; }).join("");
    var poly = pts.map(function (p, i) { return x(i).toFixed(1) + "," + y(p.y).toFixed(1); }).join(" ");
    var dots = pts.map(function (p, i) { return '<circle class="hit" cx="' + x(i).toFixed(1) + '" cy="' + y(p.y).toFixed(1) + '" r="3.2" fill="' + color + '"/>'; }).join("");
    host.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(series.label) + '"><title>' + esc(series.label) + "</title>" + grid +
      '<line x1="' + PADL + '" y1="' + (H - PADB) + '" x2="' + (W - PADR) + '" y2="' + (H - PADB) + '" stroke="var(--line)"/>' +
      '<line x1="' + PADL + '" y1="' + PADT + '" x2="' + PADL + '" y2="' + (H - PADB) + '" stroke="var(--line)"/>' + xlab +
      '<text class="axis-title" x="' + ((W + PADL) / 2).toFixed(0) + '" y="' + (H - 1) + '" text-anchor="middle">Period</text>' +
      '<text class="axis-title" x="-104" y="11" transform="rotate(-90)" text-anchor="middle">' + esc(series.unit) + "</text>" +
      '<polyline fill="none" stroke="' + color + '" stroke-width="2.6" points="' + poly + '"/>' + dots + "</svg>";
  }
  function renderCharts() {
    buildChart($("#chart1"), T.chart1, "#e2b04a");
    buildChart($("#chart2"), T.chart2, "#6fd3c7");
    $("#c1-title").textContent = (T.chart1 || {}).label || "\u2014";
    $("#c2-title").textContent = (T.chart2 || {}).label || "\u2014";
    $("#c1-note").textContent = T.chart1Note || "";
    $("#c2-note").textContent = T.chart2Note || "";
    $("#legend1").innerHTML = '<span class="lg" style="--lg-c:#e2b04a">' + esc((T.chart1 || {}).label) + " (" + esc((T.chart1 || {}).unit) + ")</span>";
    $("#legend2").innerHTML = '<span class="lg" style="--lg-c:#6fd3c7">' + esc((T.chart2 || {}).label) + " (" + esc((T.chart2 || {}).unit) + ")</span>";
  }
  function renderLevels() {
    var r = $("#res-ladder"); r.innerHTML = ""; $("#res-title").textContent = (T.levels || {}).title || "";
    (T.levels.resistance || []).slice().reverse().forEach(function (v, i, a) { r.insertAdjacentHTML("beforeend", '<div class="rung"><span class="lab">R' + (a.length - i) + '</span><span class="num bad">' + num(v) + "</span></div>"); });
    var s = $("#sup-ladder"); s.innerHTML = ""; $("#sup-title").textContent = (T.levels || {}).title || "";
    (T.levels.support || []).forEach(function (v, i) { s.insertAdjacentHTML("beforeend", '<div class="rung"><span class="lab">S' + (i + 1) + '</span><span class="num good">' + num(v) + "</span></div>"); });
  }
  function renderPressure() {
    var box = $("#pressure"); box.innerHTML = "";
    (T.pressure || []).forEach(function (p) { box.insertAdjacentHTML("beforeend", '<div class="row"><div class="hd"><span>' + esc(p.label) + '</span><span style="color:var(--muted)">' + esc(p.level) + (p.dir === "up" ? " \u25b2" : " \u25bc") + '</span></div><div class="bar"><i class="' + (p.dir === "down" ? "dn" : "") + '" style="--w:' + p.w + '%"></i></div></div>'); });
  }
  function renderCalendar() {
    var box = $("#calendar"); box.innerHTML = "";
    (T.calendar || []).forEach(function (c) { box.insertAdjacentHTML("beforeend", '<div class="row"><span class="dt">' + esc(c.date) + '</span><span style="flex:1">' + esc(c.event) + '</span><span class="badge ' + (c.importance === "high" ? "b-high" : "b-med") + '">' + esc((c.importance || "").toUpperCase()) + "</span></div>"); });
  }
  function renderFlow() {
    $("#f1").textContent = "Retrieved " + (T.news || []).length + " news items and " + (T.speakers || []).length + " speaker items.";
    $("#f3").textContent = (T.dirRule || "") + " \u00b7 net " + (T.sentiment.netSignal || "\u2014") + " " + pctTxt(T.sentiment.netPct) + ".";
    $("#f4").textContent = "Snapshot built " + (D.updated || "\u2014") + "; live prices polled on a " + ((D.live || {}).intervalSec || 5) + "s interval.";
    $("#sources").textContent = "Sources: " + (D.sources || []).join(" \u00b7 ");
  }
  function renderAll() { renderTop(); renderHero(); renderGauge(); renderAlerts(); renderTradeFocus(); renderIncoming(); renderWatchlist(); renderTfFilter(); renderNews(); renderSpeakers(); renderSources(); renderModel(); renderCross(); renderCurrencies(); renderPairs(); renderAnalysis(); renderLevels(); renderPressure(); renderCalendar(); renderCharts(); renderFlow(); renderLiveFilterGroups(); renderLiveDetail(); renderCurrencyStrength(); }

  /* ---------- live feed ---------- */
  function fmtClock(d) { return d ? d.toLocaleTimeString() : "\u2014"; }
  function setBadge() {
    var el = $("#live-pill"); if (!el) return;
    var map = { live: ["LIVE", "good"], streaming: ["STREAMING", "good"], connecting: ["CONNECTING", "acc"], offline: ["OFFLINE", "bad"], idle: ["IDLE", "muted"] };
    var m = map[liveState.state] || map.idle;
    el.innerHTML = '<span class="dot" style="background:var(--' + (m[1] === "good" ? "good" : m[1] === "bad" ? "bad" : "accent") + ')"></span>' +
      "<b>" + m[0] + "</b> \u00b7 ticks " + liveState.ticks + " \u00b7 " + fmtClock(liveState.at) +
      (liveState.error && liveState.state !== "live" ? ' \u00b7 <span style="color:var(--bad)">' + esc(liveState.error) + "</span>" : "");
    var src = $("#live-source");
    if (src) {
      var srcs = window.LiveFeed && window.LiveFeed.sources ? window.LiveFeed.sources() : null;
      var anyFallback = srcs && (/fallback/.test(srcs.fx) || /fallback/.test(srcs.crypto) || /fallback/.test(srcs.metal));
      src.textContent = srcs ? "FX: " + srcs.fx + "  \u00b7  Crypto: " + srcs.crypto + "  \u00b7  Gold: " + srcs.metal : ((D.live || {}).fxEndpoint || "\u2014");
      src.style.color = anyFallback ? "var(--accent)" : "";
    }
    var iv = $("#live-interval"); if (iv) iv.textContent = ((D.live || {}).intervalSec || 5) + "s";
    var p2 = $("#live-pill2"); if (p2) p2.textContent = m[0] + " \u00b7 " + liveState.ticks + " ticks";
  }
  function onStatus(st) { liveState = st; setBadge(); }
  function onTick(p) {
    var changed = 0;
    if (p.rates) {
      (D.fxPairs || []).forEach(function (pair) {
        var px = null;
        var parts = pair.pair.split("/");
        var b = parseFloat(p.rates[parts[0]]), q = parseFloat(p.rates[parts[1]]);
        if (b && q) px = q / b;
        if (px == null) return;
        if (firstPrices[pair.pair] == null) firstPrices[pair.pair] = px;
        var prev = lastPrices[pair.pair];
        lastPrices[pair.pair] = px;
        var row = document.querySelector('[data-pairrow="' + pair.pair + '"]');
        if (row) {
          var cell = row.querySelector(".px");
          var up = prev != null && px > prev, dn = prev != null && px < prev;
          cell.textContent = pairFmt(px);
          if (up || dn) {
            cell.classList.remove("flash-up", "flash-down");
            void cell.offsetWidth; /* restart the animation */
            cell.classList.add(up ? "flash-up" : "flash-down");
          }
          var chg = row.querySelector(".chg");
          var base = firstPrices[pair.pair];
          var pct = base ? ((px - base) / base) * 100 : 0;
          chg.textContent = (pct > 0 ? "+" : "") + pct.toFixed(3) + "%";
          chg.className = "chg " + (pct > 0 ? "good" : pct < 0 ? "bad" : "muted");
        }
        changed++;
      });
    }
    if (p.crypto) {
      if (p.crypto.BTC) updateCryptoHero(p.crypto.BTC, "BTC");
      if (p.crypto.ETH) updateCryptoHero(p.crypto.ETH, "ETH");
    }
    var note = $("#live-note");
    if (note) note.textContent = "Last poll " + fmtClock(p.at) + " \u00b7 " + changed + " FX pairs refreshed" + (p.crypto ? " \u00b7 crypto updated" : "") + ".";
    lastTick = p;
    renderTape(p);
    if (activeId === "crypto" || activeId === "forex") renderPairs();
    renderLiveDetail();
    renderCurrencyStrength();
    setBadge();
  }
  function renderTape(p) {
    var tape = $("#live-tape"); if (!tape) return;
    var items = [];
    /* priority 1: commodities, always shown */
    COMMODITIES.forEach(function (c) {
      var px = window.LiveFeed && window.LiveFeed.metal ? window.LiveFeed.metal(c.sym) : null;
      if (px == null) return;
      var key = "tape-" + c.sym;
      if (firstPrices[key] == null) firstPrices[key] = px;
      var pct = ((px - firstPrices[key]) / firstPrices[key]) * 100;
      items.push({ k: c.sym, v: money(px), pct: pct, cls: "commodity" });
    });
    /* priority 2: crypto, as selected in the watchlist */
    if (p && p.crypto) {
      watchlist.crypto.forEach(function (c) {
        if (!p.crypto[c]) return;
        var key = "tape-" + c;
        if (firstPrices[key] == null) firstPrices[key] = p.crypto[c];
        var pct = ((p.crypto[c] - firstPrices[key]) / firstPrices[key]) * 100;
        items.push({ k: c, v: money(p.crypto[c]), pct: pct, cls: "crypto" });
      });
    }
    /* priority 3: FX pairs, as selected in the watchlist */
    if (p && p.rates) {
      watchlist.fx.forEach(function (pair) {
        var px = window.LiveFeed && window.LiveFeed.priceFor ? window.LiveFeed.priceFor(pair) : null;
        if (px == null) return;
        var base = firstPrices[pair]; if (base == null) firstPrices[pair] = px;
        if (base == null) base = px;
        var pct = ((px - base) / base) * 100;
        items.push({ k: pair, v: pairFmt(px), pct: pct, cls: "" });
      });
    }
    if (!items.length) { tape.textContent = "Waiting for the first tick\u2026 (pick symbols in Watchlist)"; return; }
    tape.innerHTML = items.map(function (i) {
      var cls = i.pct > 0 ? "good" : i.pct < 0 ? "bad" : "muted";
      return '<span class="ti ' + i.cls + '"><b>' + esc(i.k) + "</b><span>" + esc(i.v) + '</span><span class="' + cls + '">' + (i.pct > 0 ? "\u25b2 +" : i.pct < 0 ? "\u25bc " : "") + i.pct.toFixed(3) + "%</span></span>";
    }).join("");
  }
  function updateCryptoHero(px, which) {
    var crypto = D.tabs.filter(function (t) { return t.id === "crypto"; })[0];
    if (!crypto) return;
    if (which === "BTC") crypto.price.spot = px;
    if (activeId === "crypto" && which === "BTC") {
      $("#k-spot").textContent = money(px);
      if (firstPrices.__btc == null) firstPrices.__btc = px;
      var pc = ((px - firstPrices.__btc) / firstPrices.__btc) * 100;
      $("#k-spot-sub").innerHTML = '<span class="' + (pc >= 0 ? "good" : "bad") + '">' + (pc >= 0 ? "+" : "") + pc.toFixed(3) + '%</span> since connect';
    }
  }
  function updateMetalHero(px, sym) {
    var tab = D.tabs.filter(function (t) { return t.id === "gold"; })[0];
    if (!tab || sym.indexOf("XAU") === -1) return;
    tab.price.spot = px;
    if (activeId === "gold") {
      $("#k-spot").textContent = money(px);
      if (firstPrices.__xau == null) firstPrices.__xau = px;
      var pc = ((px - firstPrices.__xau) / firstPrices.__xau) * 100;
      $("#k-spot-sub").innerHTML = '<span class="' + (pc >= 0 ? "good" : "bad") + '">' + (pc >= 0 ? "+" : "") + pc.toFixed(3) + '%</span> live \u00b7 real-time stream';
    }
  }
  function initLive() {
    var cfg = D.live || {};
    var note = $("#live-note");
    if (!window.LiveFeed || !window.fetch) {
      liveState = { state: "offline", at: new Date(), ticks: 0, error: "fetch unavailable" };
      setBadge();
      if (note) note.textContent = "Live feed unavailable in this browser context; showing the last snapshot.";
      return;
    }
    if (note) note.textContent = "Connecting to live endpoints\u2026";
    window.LiveFeed.start({ intervalSec: cfg.intervalSec || 5, fxEndpoint: cfg.fxEndpoint, cryptoEndpoint: cfg.cryptoEndpoint }, onTick, onStatus);
    if (cfg.twelveDataApiKey && cfg.twelveDataSymbols && cfg.twelveDataSymbols.length) {
      window.LiveFeed.streamTwelveData(cfg.twelveDataApiKey, cfg.twelveDataSymbols, function (q) {
        updateMetalHero(q.price, q.symbol);
        var n = $("#live-note"); if (n) n.textContent = "Realtime " + q.symbol + " " + money(q.price) + " \u00b7 tick @ " + fmtClock(new Date());
        renderTape(lastTick || {});
        if (activeId === "gold") renderPairs();
        renderLiveDetail();
        setBadge();
      });
    }
  }
  function bindLiveControls() {
    var stop = $("#live-stop"); if (stop) stop.onclick = function () { if (window.LiveFeed) { window.LiveFeed.stop(); window.LiveFeed.stopTwelveData(); } liveState = { state: "idle", at: new Date(), ticks: liveState.ticks, error: "" }; setBadge(); var n = $("#live-note"); if (n) n.textContent = "Polling stopped. Snapshot values remain on screen."; };
    var go = $("#live-go"); if (go) go.onclick = function () { initLive(); };
    var wsBtn = $("#ws-go"); if (wsBtn) wsBtn.onclick = function () {
      var url = ($("#ws-url") || {}).value;
      if (!url) return;
      var ok = window.LiveFeed && window.LiveFeed.subscribe(url, function (q) {
        if (q.symbol.indexOf("BTC") > -1) updateCryptoHero(q.price, "BTC");
        if (q.symbol.indexOf("ETH") > -1) updateCryptoHero(q.price, "ETH");
        var n = $("#live-note"); if (n) n.textContent = "Stream " + q.symbol + " " + q.price;
      });
      var n2 = $("#live-note"); if (n2 && !ok) n2.textContent = "WebSocket could not be opened.";
    };
    var wsStop = $("#ws-stop"); if (wsStop) wsStop.onclick = function () { if (window.LiveFeed) window.LiveFeed.unsubscribe(); };
    bindLiveFilterButtons();
    renderLiveFilterGroups();
    renderLiveDetail();
    renderCurrencyStrength();
  }

  /* filter / charts / palette */
  function applyFilter(f) {
    $$("#bottomnav button").forEach(function (b) { b.classList.toggle("active", b.dataset.filter === f); });
    $$("[data-sec]").forEach(function (sec) {
      var tags = (sec.getAttribute("data-sec") || "").split(/\s+/);
      /* "all" marks a pinned section (e.g. the hero) that stays visible under every view */
      sec.classList.toggle("hidden", tags.indexOf("all") === -1 && tags.indexOf(f) === -1);
    });
    var main = $(".main"); if (main) main.scrollTop = 0; window.scrollTo(0, 0);
  }
  function bindBottomNav() {
    $$("#bottomnav button").forEach(function (b) { b.onclick = function () { applyFilter(b.dataset.filter); }; });
  }
  var floating = null, placeholder = null;
  function bindCharts() {
    var focusEl = $("#focus");
    $$(".chart-shell").forEach(function (shell) {
      var vx = $(".vx", shell), hy = $(".hy", shell), lb = $(".lb", shell);
      if (!vx) return;
      shell.onmousemove = function (e) {
        var r = shell.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
        shell.classList.add("active"); vx.style.left = x + "%"; hy.style.top = y + "%"; lb.textContent = "x:" + x.toFixed(1) + " y:" + (100 - y).toFixed(1);
      };
      shell.onmouseleave = function () { shell.classList.remove("active"); };
      shell.onclick = function () {
        if (floating === shell) { placeholder.parentNode.insertBefore(shell, placeholder); placeholder.remove(); placeholder = null; floating = null; shell.classList.remove("floating"); shell.style = ""; focusEl.classList.remove("show"); document.body.style.overflow = ""; return; }
        if (floating) floating.click();
        var rect = shell.getBoundingClientRect();
        placeholder = document.createElement("div"); placeholder.style.width = rect.width + "px"; placeholder.style.height = rect.height + "px";
        shell.parentNode.insertBefore(placeholder, shell);
        floating = shell; shell.classList.add("floating");
        shell.style.top = Math.max(24, (innerHeight - rect.height * 1.25) / 2) + "px";
        shell.style.left = Math.max(24, (innerWidth - rect.width * 1.25) / 2) + "px";
        shell.style.width = Math.min(innerWidth - 48, rect.width * 1.25) + "px";
        shell.style.height = Math.min(innerHeight - 48, rect.height * 1.25) + "px";
        document.body.appendChild(shell); focusEl.classList.add("show"); document.body.style.overflow = "hidden";
      };
    });
    if (focusEl) focusEl.onclick = function () { if (floating) floating.click(); };
  }
  function bindPalette() {
    var palette = $("#palette"), cmd = $("#cmd");
    function exec(q) {
      q = String(q || "").toLowerCase();
      D.tabs.forEach(function (t) { if (q.indexOf(t.id) > -1) setInst(t.id); });
      if (q.indexOf("theme dark") > -1) setTheme("dark");
      if (q.indexOf("theme light") > -1) setTheme("light");
      if (q.indexOf("filter ") > -1) applyFilter(q.split("filter ")[1].trim());
      if (q.indexOf("focus chart") > -1) { var c = $(".chart-shell"); if (c) c.click(); }
      if (q.indexOf("live on") > -1) initLive();
      if (q.indexOf("live off") > -1) { if (window.LiveFeed) window.LiveFeed.stop(); }
      palette.classList.remove("open");
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !palette.classList.contains("open") && document.activeElement.tagName !== "INPUT") { e.preventDefault(); palette.classList.add("open"); cmd.focus(); cmd.value = "/"; }
      else if (e.key === "Escape") { palette.classList.remove("open"); if (floating) floating.click(); }
    });
    if (cmd) cmd.onkeydown = function (e) { if (e.key === "Enter") exec(cmd.value); };
    $$("#palette button").forEach(function (b) { b.onclick = function () { exec(b.dataset.cmd || ""); }; });
    if (palette) palette.onclick = function (e) { if (e.target === palette) palette.classList.remove("open"); };
  }

  function boot() {
    var st = safeGet(); setTheme(st || "dark");
    if (settings.defaultTab && D.tabs.some(function (t) { return t.id === settings.defaultTab; })) {
      activeId = settings.defaultTab; T = D.tabs.filter(function (t) { return t.id === activeId; })[0];
    }
    applyAutoSentiment();
    renderInst(); renderRanges(); renderAll();
    bindCharts(); bindPalette(); bindLiveControls(); bindBottomNav(); bindTheme(); bindVoice(); bindAssistant(); bindAnalysisScope(); bindPivotInputs(); bindSettings(); bindIncomingView();
    applyFilter("news");
    var rb = $("#refresh"); if (rb) rb.onclick = function () { location.reload(); };
    ["c-open", "c-high", "c-low", "c-prev", "c-atr", "c-iv", "c-dte", "c-k"].forEach(function (id) { var el = $("#" + id); if (el) el.addEventListener("input", calc); });
    var wsu = $("#ws-url"); if (wsu && (D.live || {}).wsHint) wsu.value = D.live.wsHint;
    initLive();
    scheduleRemotePolling();
    // Live countdown: re-render Priority Read every 15s so "in 12m" actually ticks down instead
    // of only updating on the next unrelated re-render (a live poll tick, a tab switch, etc).
    setInterval(function () { if ($("#incoming-list")) renderIncoming(); }, 15000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
