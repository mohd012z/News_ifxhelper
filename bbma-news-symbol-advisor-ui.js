/* bbma-news-symbol-advisor-ui.js — renders the "NEWS SYMBOL RECOMMENDATION"
 * card: news-driven (weekly + upcoming) symbol picks, each scored with BBMA
 * (trend/momentum/MHV/CSA/RE-entry/EXT) + supply/demand confluence.
 *
 * Technical inputs:
 *   - XAU/USD: REAL, from the BBMA runtime frames (per-TF classify) + S/D zones
 *     computed by lib/bbma-supply-demand.js on H1 history.
 *   - BTC/USD, EUR/USD, GBP/USD, USD/JPY: no OHLC history in the runtime, so
 *     their BBMA/S&D fields are fail-closed "—" (only the XAU rec shows full
 *     technicals). Live price is still shown from window.LiveFeed.
 *
 * Fail-closed: if NEWS_AUTO or the advisor lib is missing, the card shows a
 * notice (never a fabricated signal). Re-renders on bbma-runtime-updated and
 * on a news refresh, and every 30s.
 */
(function () {
  'use strict';
  var el = null;
  var TF_TECH = ['H1', 'H4', 'D1']; // confluence across multiple TFs

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '—' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function adv() { return window.BBMA_NewsSymbolAdvisor || null; }

  // Per-TF XAU technical state from the runtime (classify() output)
  function xauTech(d) {
    var f = (d && (d.mtf || d.frames || d.timeframes)) || {};
    var tfData = TF_TECH.map(function (tf) { return f[tf] || {}; });
    // confluence: majority vote on trend; strongest single-TF for the rest
    var up = 0, down = 0;
    tfData.forEach(function (x) { if (x.trend === 'UP') up++; else if (x.trend === 'DOWN') down++; });
    var trend = up > down ? 'UP' : down > up ? 'DOWN' : (tfData[0].trend || 'MIXED');
    var merged = {};
    // take the most "active" signal per field (prefer H1, then H4, then D1)
    ['momentum', 'mhv', 'csa', 'csak', 'reentry', 'extreme', 'zone', 'location', 'ema50Position'].forEach(function (k) {
      for (var i = 0; i < tfData.length; i++) {
        var v = tfData[i][k];
        if (v && v !== 'NONE' && v !== '—' && !/—|NONE/.test(String(v))) { merged[k] = v; break; }
      }
    });
    merged.trend = trend;
    return merged;
  }

  // Supply/demand zones for XAU on H1 history (unmitigated only).
  // NOTE: runtime candles live in rt.candles.H1 (a {tf:[...]} dict of OHLC),
  // NOT rt.frames.H1 (a per-TF state object with classify()). Use candles.
  function xauSd(d) {
    var SD = window.BBMA_SupplyDemand;
    var rt = window.BBMARuntime || window.BBMA_RUNTIME || d;
    if (!SD || !rt) return null;
    var sets = rt.candles || rt.ohlc || rt.marketCandles || {};
    var raw = (sets.H1 || []).slice(-120);
    if (!raw.length) return null;
    var candles = raw.map(function (c) {
      var ms = (typeof c.time === 'number') ? c.time : Date.parse(c.time);
      return { time: ms, open: +c.open, high: +c.high, low: +c.low, close: +c.close };
    }).filter(function (c) { return [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite); });
    if (candles.length < 12) return null;
    try {
      var bands = SD.activeBands(candles, { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
      var supply = [], demand = [];
      bands.forEach(function (z) { if (z.kind === 'SUPPLY') supply.push(z); else demand.push(z); });
      return { supply: supply, demand: demand };
    } catch (e) { return null; }
  }

  // Live price lookup (fail-closed to null)
  function livePrice(sym) {
    var LF = window.LiveFeed;
    if (!LF) return null;
    try {
      if (sym === 'XAU') return LF.metal ? LF.metal('XAU') : null;
      if (sym === 'BTC') { var p = LF.prices ? LF.prices().crypto : null; return p ? (p.BTC || p.btc || p['BTC/USD']) : null; }
      // FX pairs: map advisor symbol -> 'BASE/QUOTE'
      var map = { EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD' };
      if (map[sym]) return LF.priceFor ? LF.priceFor(map[sym]) : null;
    } catch (e) { }
    return null;
  }

  function buildTech(d) {
    var x = xauTech(d);
    var last = null;
    var rt = window.BBMARuntime || window.BBMA_RUNTIME || d;
    if (rt) {
      // Prefer the live runtime price (always current); fall back to the last
      // H1 close (which may still be seeding / a stale synthetic baseline on
      // the very first render before candles.H1 is fully populated).
      var sets = rt.candles || rt.ohlc || rt.marketCandles || {};
      var h1 = sets.H1;
      var h1Last = (h1 && h1.length) ? +h1[h1.length - 1].close : null;
      if (d && d.price != null && isFinite(+d.price)) last = +d.price;
      else if (h1Last != null && isFinite(h1Last)) last = h1Last;
    } else if (d && d.price != null) last = +d.price;
    return {
      XAU: {
        name: 'XAU/USD', trend: x.trend || 'MIXED', momentum: x.momentum || 'NONE', mhv: x.mhv || 'NONE',
        csa: x.csa || x.csak || 'NONE', reentry: x.reentry || 'NONE', extreme: x.extreme || 'NONE',
        zone: x.zone || '—', location: x.location || '—', ema50Position: x.ema50Position || '—',
        lastClose: last, sd: xauSd(d), timeframe: 'H1·H4·D1'
      },
      BTC: { name: 'BTC/USD', trend: '—', momentum: '—', mhv: '—', csa: '—', reentry: '—', extreme: '—', zone: '—', lastClose: livePrice('BTC'), sd: null, timeframe: '—' },
      EURUSD: { name: 'EUR/USD', trend: '—', momentum: '—', mhv: '—', csa: '—', reentry: '—', extreme: '—', zone: '—', lastClose: livePrice('EURUSD'), sd: null, timeframe: '—' },
      GBPUSD: { name: 'GBP/USD', trend: '—', momentum: '—', mhv: '—', csa: '—', reentry: '—', extreme: '—', zone: '—', lastClose: livePrice('GBPUSD'), sd: null, timeframe: '—' },
      USDJPY: { name: 'USD/JPY', trend: '—', momentum: '—', mhv: '—', csa: '—', reentry: '—', extreme: '—', zone: '—', lastClose: livePrice('USDJPY'), sd: null, timeframe: '—' }
    };
  }

  function events() {
    var N = window.NEWS_AUTO;
    var arr = N ? (N.calendarAll || N.calendar || []) : [];
    if (!Array.isArray(arr) || !arr.length) return [];
    return arr.map(function (e) {
      var ev = {};
      for (var k in e) ev[k] = e[k];
      // epoch ms. timeGmt = "Dow, YYYY-MM-DD HH:MM" — Date.parse on the WHOLE
      // string mis-aligns (the weekday prefix shifts the day), so parse the
      // numeric date (e.date) and the time-of-day separately and build UTC.
      var ts = NaN;
      var dm = /(\d{4})-(\d{2})-(\d{2})/.exec(e.date || '');
      if (dm) {
        ts = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 0, 0, 0);
        var tm = /(\d{2}):(\d{2})/.exec(e.timeGmt || '');
        if (tm) ts = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0);
      }
      ev._ts = isFinite(ts) ? ts : NaN;
      return ev;
    }).filter(function (e) { return isFinite(e._ts); });
  }

  function fmtPrice(p, sym) {
    if (p == null || !isFinite(p)) return '—';
    var d = (sym === 'XAU' || sym === 'BTC') ? 2 : 4;
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function confClass(c) { return c === 'high' ? 'good' : c === 'medium' ? 'warn' : 'info'; }
  function dirClass(d) { return d === 'long' ? 'good' : d === 'short' ? 'bad' : 'info'; }

  function renderRec(r) {
    var price = r.lastPrice;
    var dir = r.direction;
    var head =
      '<div class="nsa-row">' +
      '<div class="nsa-id"><b>' + esc(r.symbol) + '</b><span class="nsa-price">' + esc(fmtPrice(price, r.symbol)) + '</span></div>' +
      '<span class="bbx-badge ' + dirClass(dir) + '">' + esc(dir.toUpperCase()) + '</span>' +
      '<span class="bbx-badge ' + confClass(r.confidence) + '">CONF ' + esc(String(r.confidence).toUpperCase()) + '</span>' +
      '<span class="bbx-badge">SCORE ' + esc(r.score) + '</span>' +
      '</div>';
    var tech = r.technicalBias != null && r.technicalBias !== 0
      ? ' · Technicals ' + (r.technicalBias > 0 ? 'bullish' : 'bearish') + ' (' + (r.technicalBias > 0 ? '+' : '') + r.technicalBias + ')'
      : '';
    var news = r.newsBias != null && r.newsBias !== 0
      ? ' · News ' + (r.newsBias > 0 ? 'bullish' : 'bearish') + ' (' + (r.newsBias > 0 ? '+' : '') + r.newsBias + ')'
      : '';
    var body =
      '<div class="bbx-detail"><b>' + esc(r.setup) + '</b>' + tech + news + '</div>' +
      (r.reasons && r.reasons.length ? '<div class="bbx-sub">Why: ' + esc(r.reasons.join('; ')) + '</div>' : '') +
      (r.events && r.events.length ?
        '<div class="nsa-evs">' + r.events.map(function (e) {
          var imp = String(e.importance || '').toLowerCase();
          var c = imp === 'high' ? 'bad' : imp === 'med' || imp === 'medium' ? 'warn' : 'info';
          return '<div class="nsa-ev"><span class="bbx-badge ' + c + '">' + esc(imp || 'low') + '</span> ' +
            esc(e.event) + ' <span class="bbx-sub">· ' + esc(e.time || '') + (e.surprise != null ? ' · surprise ' + esc(e.surprise) : '') + '</span></div>';
        }).join('') + '</div>' : '<div class="bbx-sub">No near-term high-impact events — technical-only read.</div>') +
      (r.risk ? '<div class="nsa-risk">⚠ ' + esc(r.risk) + '</div>' : '');
    return head + body;
  }

  function render() {
    el = $('bbma-news-symbol-advisor');
    if (!el) return;
    var A = adv();
    var d = window.BBMA_RUNTIME || window.BBMA_DASHBOARD || {};
    if (!A || !d) {
      el.innerHTML = '<div class="bbx-empty">Building recommendation engine…' + (d ? '' : ' (runtime not ready)') + '</div>';
      return;
    }
    var evs = events();
    if (!evs.length) {
      el.innerHTML = '<div class="bbx-empty">No news calendar loaded. Recommendation unavailable (fail-closed).</div>';
      return;
    }
    var tech = buildTech(d);
    var out;
    try {
      out = A.recommend(evs, tech, { now: Date.now(), horizonMs: 7 * 86400000, max: 5 });
    } catch (e) {
      el.innerHTML = '<div class="bbx-empty">Recommendation error: ' + esc(e.message) + '</div>';
      return;
    }
    var recs = out.recommendations || [];
    if (!recs.length) {
      el.innerHTML = '<div class="bbx-empty">No actionable symbol recommendation right now. Wait for a higher-impact release.</div>';
      return;
    }
    // attach live prices (prefer live; keep the engine's real lastClose as a
    // fallback so a not-yet-ready LiveFeed still shows a real price)
    recs.forEach(function (r) { var lp = livePrice(r.symbol); if (lp != null && isFinite(lp)) r.lastPrice = lp; });
    var actionable = recs.filter(function (r) { return r.direction !== 'neutral'; });
    var html =
      '<div class="bbx-sub" style="margin-bottom:6px">Ranked by news impact + BBMA/S&amp;D confluence · ' +
      esc(out.counts.upcoming) + ' upcoming · ' + esc(out.counts.released) + ' released this week · ' +
      esc(out.generatedAt ? new Date(out.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '') + '</div>';
    if (actionable.length) {
      html += '<div class="nsa-top"><div class="bbx-sub">TOP PICK</div>' +
        '<div class="nsa-card nsa-card-top">' + renderRec(actionable[0]) + '</div></div>';
    }
    html += '<div class="nsa-grid">' + recs.map(function (r) {
      return '<div class="nsa-card">' + renderRec(r) + '</div>';
    }).join('') + '</div>';
    html += '<div class="bbx-sub nsa-foot">Educational analysis, not financial advice. XAU shows full BBMA+S&amp;D technicals; other symbols are news-ranked (no history feed). Re-checks every 30s + on news/data update.</div>';
    el.innerHTML = html;
  }

  function boot() {
    el = $('bbma-news-symbol-advisor');
    if (!el) return;
    render();
    setInterval(render, 30000);
    document.addEventListener('bbma-runtime-updated', render);
    // news refresh: re-render when the calendar bundle is swapped (poll for a changing generatedAt)
    var lastGen = null;
    setInterval(function () {
      var N = window.NEWS_AUTO;
      var g = N ? N.generatedAt : null;
      if (g && g !== lastGen) { lastGen = g; render(); }
    }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.BBMANewsSymbolAdvisorUI = { render: render, boot: boot };
})();
