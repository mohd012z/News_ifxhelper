/* Trade Plan dashboard - generates an entry/SL/TP summary for every instrument.
 * Inputs: xauusd-data.js (bias, news, events, plan params), atr.js (measured ATR), live.js (live prices).
 * Every level is a multiple of the measured ATR, so the maths is auditable.
 */
(function () {
  "use strict";
  var $ = function (s, p) { return (p || document).querySelector(s); };
  var $$ = function (s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); };
  var D = window.MARKET_DATA, A = window.ATR_DATA;
  if (!D || !A) { document.addEventListener("DOMContentLoaded", function () { var e = document.getElementById("load-error"); if (e) e.style.display = "block"; }); return; }

  var groupFilter = "All", signalFilter = "All";
  var liveRates = null, liveCrypto = null, liveAt = null, liveState = { state: "idle" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function px(v) {
    if (v == null || !isFinite(v)) return "\u2014";
    var a = Math.abs(v);
    var d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : 5;
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v, d) { return (v > 0 ? "+" : "") + Number(v).toFixed(d == null ? 2 : d) + "%"; }
  function sigCls(s) { return s === "SELL" ? "sig-sell" : s === "BUY" ? "sig-buy" : "sig-neu"; }

  function biasFor(id, group) {
    if (group === "Forex") {
      var p = null;
      (D.fxPairs || []).forEach(function (x) { if (x.pair.replace("/", "") === id) p = x; });
      if (p) {
        var g = function (c) { var r = (D.currencies || []).filter(function (y) { return y.code === c; })[0]; return r ? r.bias : 0; };
        return g(p.base) - g(p.quote);
      }
      return 0;
    }
    return (D.macroBias || {})[id] || 0;
  }
  function groupOf(id, group) { return group; }

  function livePrice(row) {
    if (row.group === "Forex") {
      var p = null;
      (D.fxPairs || []).forEach(function (x) { if (x.pair.replace("/", "") === row.id) p = x; });
      if (p && liveRates) {
        var parts = p.pair.split("/");
        var b = parseFloat(liveRates[parts[0]]), q = parseFloat(liveRates[parts[1]]);
        if (b && q) return { price: q / b, live: true };
      }
      return { price: row.last, live: false };
    }
    if (row.group === "Crypto") {
      var key = row.id.replace("USD", "");
      if (liveCrypto && liveCrypto[key]) return { price: liveCrypto[key], live: true };
      return { price: row.last, live: false };
    }
    return { price: row.last, live: false };
  }

  function eventToday() {
    var hi = (D.incoming || []).filter(function (e) { return e.importance === "high"; });
    return hi.length ? hi[0] : null;
  }
  function timeframeFor(group) {
    var ev = eventToday();
    if (group === "Crypto") return "H1 / H4 (24h venue)";
    return ev ? "M15 / H1 (event day: " + ev.event + ")" : "H4 / D1";
  }
  /* Malaysia time for the next event that matters to this instrument */
  function mytFor(r) {
    var ev = eventToday();
    var out = ev ? ev.timeMyt + " \u00b7 " + ev.event : "\u2014";
    if (r.group === "Forex" && r.id.indexOf("JPY") > -1) {
      var boj = (D.incoming || []).filter(function (e) { return /BoJ/.test(e.event); })[0];
      if (boj) out += "  |  BoJ " + boj.timeMyt;
    }
    if (r.group === "Crypto") out = (ev ? ev.timeMyt : "\u2014") + " \u00b7 FOMC (24h venue)";
    return out;
  }
  function fundamentalFor(row) {
    if (row.group === "Forex") {
      var p = null;
      (D.fxPairs || []).forEach(function (x) { if (x.pair.replace("/", "") === row.id) p = x; });
      if (!p) return "\u2014";
      var g = function (c) { return (D.currencies || []).filter(function (y) { return y.code === c; })[0] || {}; };
      var b = g(p.base), q = g(p.quote);
      return b.code + ": " + (b.stance || "\u2014") + " (" + (b.next || "-") + "). " + q.code + ": " + (q.stance || "\u2014") + " (" + (q.next || "-") + ").";
    }
    if (row.group === "Crypto") {
      var t = D.tabs.filter(function (x) { return x.id === "crypto"; })[0];
      return t ? t.sentiment.summary : "\u2014";
    }
    var c = D.tabs.filter(function (x) { return x.id === "gold"; })[0];
    var oil = (D.crossAsset || {}).oilNote || "";
    if (row.id === "BRENT" || row.id === "WTI") return oil;
    return (c ? c.sentiment.summary : "") + " " + ((D.crossAsset || {}).note || "");
  }

  function build() {
    var P = D.plan || {}, out = [];
    (A.rows || []).forEach(function (row) {
      var lp = livePrice(row);
      var price = lp.price;
      if (price == null) return;
      var atrAbs = price * (row.atrPct / 100);
      var score = biasFor(row.id, row.group);
      var signal = score > 0.15 ? "BUY" : score < -0.15 ? "SELL" : "WAIT";
      var trend = score > 0.15 ? "UP" : score < -0.15 ? "DOWN" : "RANGE";
      var dir = signal === "BUY" ? 1 : signal === "SELL" ? -1 : 0;
      var entryMkt = price;
      var entryLim = price - dir * (P.entryOffsetAtr || 0.25) * atrAbs;
      var sl = dir === 0 ? null : entryMkt - dir * (P.slAtr || 1.2) * atrAbs;
      var tp1 = dir === 0 ? null : entryMkt + dir * (P.tp1Atr || 1.5) * atrAbs;
      var tp2 = dir === 0 ? null : entryMkt + dir * (P.tp2Atr || 2.5) * atrAbs;
      var risk = sl != null ? Math.abs(entryMkt - sl) : null;
      var rr1 = risk ? Math.abs(tp1 - entryMkt) / risk : null;
      var rr2 = risk ? Math.abs(tp2 - entryMkt) / risk : null;
      out.push({
        id: row.id, label: row.label, group: row.group, price: price, live: lp.live,
        atr: atrAbs, atrPct: row.atrPct, score: score, signal: signal, trend: trend,
        entryMkt: entryMkt, entryLim: entryLim, sl: sl, tp1: tp1, tp2: tp2, rr1: rr1, rr2: rr2,
        tf: timeframeFor(row.group), window: (D.bestWindow || {})[row.group] || "\u2014",
        myt: mytFor({ id: row.id, group: row.group }),
        fundamental: fundamentalFor(row), src: row.src, riskPct: risk ? (risk / price) * 100 : null
      });
    });
    return out;
  }

  function renderSummary(rows) {
    var buys = rows.filter(function (r) { return r.signal === "BUY"; }).length;
    var sells = rows.filter(function (r) { return r.signal === "SELL"; }).length;
    var wait = rows.filter(function (r) { return r.signal === "WAIT"; }).length;
    var liveN = rows.filter(function (r) { return r.live; }).length;
    var vol = rows.slice().sort(function (a, b) { return b.atrPct - a.atrPct; });
    var ev = eventToday();
    var cards = [
      { k: "BUY setups", v: String(buys), s: "bias > +0.15" },
      { k: "SELL setups", v: String(sells), s: "bias < -0.15" },
      { k: "Wait / no edge", v: String(wait), s: "inside \u00b10.15" },
      { k: "Live-priced now", v: liveN + " / " + rows.length, s: "rest = last daily close" },
      { k: "Most volatile", v: vol[0] ? vol[0].label : "\u2014", s: vol[0] ? "ATR " + vol[0].atrPct.toFixed(2) + "% of price" : "" },
      { k: "Event risk", v: ev ? ev.event : "none flagged", s: ev ? ev.date + " \u00b7 " + ev.focusTf : "" }
    ];
    $("#summary").innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="k">' + esc(c.k) + '</div><div class="v sm">' + esc(c.v) + '</div><div class="sub">' + esc(c.s) + "</div></div>";
    }).join("");
  }

  function renderFilters() {
    var groups = ["All", "Forex", "Crypto", "Commodity"], sigs = ["All", "BUY", "SELL", "WAIT"];
    var gb = $("#group-filter"), sb = $("#signal-filter");
    gb.innerHTML = ""; sb.innerHTML = "";
    groups.forEach(function (g) {
      var b = document.createElement("button");
      b.className = "chip" + (g === groupFilter ? " on" : ""); b.textContent = g;
      b.onclick = function () { groupFilter = g; renderFilters(); renderTable(); };
      gb.appendChild(b);
    });
    sigs.forEach(function (g) {
      var b = document.createElement("button");
      b.className = "chip" + (g === signalFilter ? " on" : ""); b.textContent = g;
      b.onclick = function () { signalFilter = g; renderFilters(); renderTable(); };
      sb.appendChild(b);
    });
  }

  function renderTable() {
    var rows = build().filter(function (r) {
      return (groupFilter === "All" || r.group === groupFilter) && (signalFilter === "All" || r.signal === signalFilter);
    });
    var body = $("#plan-body"); body.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><b>" + esc(r.label) + '</b><div style="color:var(--muted);font-size:10px">' + esc(r.group) + (r.live ? ' <span class="badge b-live">LIVE</span>' : ' <span class="badge b-neu">daily close</span>') + "</div></td>" +
        '<td class="num">' + px(r.price) + "</td>" +
        '<td><span class="sig ' + sigCls(r.signal) + '">' + esc(r.signal) + "</span></td>" +
        '<td class="' + (r.trend === "UP" ? "good" : r.trend === "DOWN" ? "bad" : "muted") + '">' + esc(r.trend) + "</td>" +
        '<td class="num">' + px(r.entryMkt) + '<div style="color:var(--muted);font-size:10px">limit ' + px(r.entryLim) + "</div></td>" +
        '<td class="num bad">' + px(r.sl) + "</td>" +
        '<td class="num good">' + px(r.tp1) + '<div style="color:var(--muted);font-size:10px">TP2 ' + px(r.tp2) + "</div></td>" +
        '<td class="num">' + (r.rr1 ? "1:" + r.rr1.toFixed(2) + '<div style="color:var(--muted);font-size:10px">TP2 1:' + r.rr2.toFixed(2) + "</div>" : "\u2014") + "</td>" +
        '<td class="num">' + esc(r.atrPct.toFixed(2)) + '%<div style="color:var(--muted);font-size:10px">ATR ' + px(r.atr) + "</div></td>" +
        '<td style="color:var(--muted);font-size:11px">' + esc(r.tf) + "</td>" +
        '<td class="num" style="color:var(--accent)">' + esc(r.myt) + "</td>" +
        '<td class="num">' + (r.score > 0 ? "+" : "") + r.score.toFixed(2) + "</td>" +
        '<td style="color:var(--muted);font-size:11px">' + esc(r.fundamental) + "</td>" +
        '<td style="color:var(--muted);font-size:10px">' + esc(r.src) + "</td>";
      body.appendChild(tr);
    });
    if (!rows.length) body.innerHTML = '<tr><td colspan="14" style="color:var(--muted)">No instruments match this filter.</td></tr>';
    var w = $("#window-note");
    var grp = groupFilter === "All" ? "Forex/Commodity" : groupFilter;
    w.textContent = (D.bestWindow || {})[grp] || (D.bestWindow || {}).Forex || "";
  }

  function renderClock() {
    var s = liveState.state;
    var q = (liveState.quality || {});
    var map = { live: ["LIVE", "good"], streaming: ["STREAMING", "good"], connecting: ["CONNECTING", "acc"], offline: ["OFFLINE", "bad"], idle: ["IDLE", "muted"] };
    var m = map[s] || map.idle;
    var el = $("#live-pill");
    el.innerHTML = '<span class="dot" style="background:var(--' + (m[1] === "good" ? "good" : m[1] === "bad" ? "bad" : "accent") + ')"></span><b>' + m[0] + "</b> \u00b7 quality <b>" + esc(q.label || "\u2014") + "</b> \u00b7 " +
      (q.latency != null ? q.latency + "ms" : "\u2014") + " \u00b7 " + (q.rate != null ? (q.rate * 100).toFixed(0) + "% ok" : "\u2014") + " \u00b7 ticks " + (liveState.ticks || 0);
    var t = $("#last-tick");
    if (t) t.textContent = liveAt ? liveAt.toLocaleTimeString() : "\u2014";
    var n = $("#live-note");
    if (n) n.textContent = "Prices refresh every " + ((D.live || {}).intervalSec || 5) + "s \u00b7 " + rowsLiveCount() + " instruments on a live venue price, the rest on the last daily close.";
  }
  function rowsLiveCount() { return build().filter(function (r) { return r.live; }).length; }

  function initLive() {
    if (!window.LiveFeed || !window.fetch) { liveState = { state: "offline" }; renderClock(); return; }
    var cfg = D.live || {};
    window.LiveFeed.start({ intervalSec: cfg.intervalSec || 5, fxEndpoint: cfg.fxEndpoint, cryptoEndpoint: cfg.cryptoEndpoint },
      function (p) {
        if (p.rates) liveRates = p.rates;
        if (p.crypto) liveCrypto = p.crypto;
        liveAt = p.at;
        renderTable(); renderClock();
      },
      function (st) { liveState = st; renderClock(); });
  }

  function boot() {
    var a = $("#atr-asof"); if (a) a.textContent = (A.asOf || "\u2014") + " \u00b7 period " + (A.period || 14) + " \u00b7 " + (A.rows || []).length + " instruments";
    var p = $("#plan-params");
    if (p) { var P = D.plan || {}; p.textContent = "entry offset " + P.entryOffsetAtr + " ATR \u00b7 SL " + P.slAtr + " ATR \u00b7 TP1 " + P.tp1Atr + " ATR \u00b7 TP2 " + P.tp2Atr + " ATR"; }
    var sb = $("#sessions");
    if (sb) {
      var sess = (D.sessions || []).map(function (x) { return "<b>" + x.k + "</b> " + (x.myt || x.gmt); }).join(" \u00b7 ");
      var bw = Object.keys(D.bestWindow || {}).map(function (g) { return "<b>" + g + ":</b> " + D.bestWindow[g]; }).join(" ");
      var tzn = (D.tz || {}).name || "Malaysia time";
      sb.innerHTML = "Sessions in " + tzn + " (" + ((D.tz || {}).offset || "GMT+8") + "): " + sess + ".<br><b>Best window by group:</b> " + bw;
    }
    renderSummary(build()); renderFilters(); renderTable(); renderClock();
    $("#refresh").onclick = function () { location.reload(); };
    initLive();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
