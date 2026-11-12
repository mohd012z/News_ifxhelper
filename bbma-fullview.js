/* bbma-fullview.js — the Charts-tab "BBMA full chart": a TradingView-style
 * full-height interactive chart for the XAU//DESK dashboard.
 *
 * Features (Anam, 2026-11-08):
 *   - fullview candle chart for all 8 TFs (M5..MN1) on real Dukascopy history
 *     (seeded into BBMA_RUNTIME by bbma-runtime.js /api/candles) + live merge
 *   - indicators: BB(20,2) + EMA50 (same math as the BBMA bridge),
 *     Supply/Demand zones (lib/bbma-supply-demand.js, native-parity detector)
 *   - drawing objects: trend line, horizontal line, rectangle, text label —
 *     click-to-place (2 clicks for line/rect, 1 for hline/text), double-click
 *     deletes the nearest object, Esc cancels a pending 2-click shape,
 *     "Clear" removes all for the current TF; persisted per TF in localStorage
 *   - pinch/ctrl-wheel zoom + drag pan (LWC handleScale/handleScroll)
 *   - Apache-2.0 attribution logo kept visible (layout.attributionLogo)
 *
 * LWC v5.2.1 custom-series contract (verified in-browser against the vendored
 * build): view = { update, priceValueBuilder, isWhitespace, defaultOptions,
 * renderer(){ return { draw(target, priceConverter) } } }. `target` is a
 * fancy-canvas: paint inside target.useMediaCoordinateSpace(function(media){
 * media.context = Canvas2D; media.mediaSize = {width,height} }).
 * x = chart.timeScale().timeToCoordinate(UTCTimestamp); y = priceConverter(p).
 *
 * Fail-closed: if lightweight-charts is unavailable, shows a notice instead of
 * an empty box (the BBMA tab still renders its own chart).
 */
(function () {
  'use strict';

  var TF_LIST = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];
  var COLORS = {
    bg: '#0b1220', text: '#d7e2f4', grid: '#18233a',
    up: '#31df8b', down: '#ff596d',
    bbUpper: '#28a9ff', bbMiddle: '#ffc928', bbLower: '#28a9ff', ema50: '#c05cff',
    ema200: '#ff8fa3', sma20: '#7aa2ff', vwap: '#ffd166',
    supply: '#ff596d', demand: '#31df8b',
    rsi: '#c05cff', rsiOver: '#ff596d', rsiUnder: '#31df8b',
    macd: '#28a9ff', macdSig: '#ffd166', macdHistUp: '#31df8b', macdHistDn: '#ff596d',
    // BBMA Oma Ally core lines: linear-weighted MA 5/10 on the HIGH and LOW series
    lwmaH5: '#ffd166', lwmaH10: '#ff9f43', lwmaL5: '#4cc9f0', lwmaL10: '#7aa2ff',
    // SMC (kxngHADES SMC-Marking + Sweep [pandich])
    smcHH: '#ffeb3b', smcHL: '#ff9800', smcLH: '#e040fb', smcLL: '#ff5252',
    smcBOS: '#00e5ff', smcCHoCH: '#00e676',
    smcOBsupply: '#f23645', smcOBdemand: '#089981', smcFVGBull: '#089981', smcFVGBear: '#f23645',
    smcPrem: '#f23645', smcDisc: '#089981', smcEq: '#787b86', smcSweep: '#ffd166',
    // Elliott Wave (lib/elliott-wave.js) — MotiveWave degree colors + EWSTRAT blue/red scenarios
    ewBase: '#8aa2c8', ewUpper: '#5b6b8c', ewSplit: '#ffd166',
    ewScenA: '#4da3ff', ewScenB: '#ff5d5d', ewStop: '#ff5d5d', ewTarget: '#31df8b',
    ewBox: 'rgba(11,18,32,0.86)', ewBoxText: '#d7e2f4',
    trend: '#ffd166', hline: '#7aa2ff', rect: '#4cc9f0', text: '#f4f4f4'
  };
  var SD_PARAMS = { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 };
  var STORE_KEY = 'xaudesk-fullview-v2';

  // Indicator math module (lib/bbma-indicators.js) — fail-closed if absent.
  function IND() { return (typeof window !== 'undefined' && window.BBMA_Indicators) || null; }
  // Overlay keys that live on the MAIN pane (visibility toggled per indicator).
  var OVERLAY_KEYS = ['bbUpper', 'bbMiddle', 'bbLower', 'ema50', 'lwmaH5', 'lwmaH10', 'lwmaL5', 'lwmaL10', 'ema200', 'sma20', 'vwap'];
  var OVERLAY_FOR = { bbUpper: 'bb', bbMiddle: 'bb', bbLower: 'bb', ema50: 'ema50', lwmaH5: 'lwma', lwmaH10: 'lwma', lwmaL5: 'lwma', lwmaL10: 'lwma', ema200: 'ema200', sma20: 'sma20', vwap: 'vwap' };
  // Indicator presets ("templates"). Applying one sets the toggle set below.
  var TEMPLATES = {
    'BBMA Oma': { bb: true, lwma: true, ema50: true, sd: true, vwap: false, ema200: false, sma20: false, rsi: false, macd: false, smc: false, ew: false },
    'TV Classic': { bb: true, lwma: false, ema50: true, sd: true, vwap: false, ema200: false, sma20: false, rsi: false, macd: false, smc: false, ew: false },
    'BB + VWAP': { bb: true, lwma: false, ema50: true, sd: false, vwap: true, ema200: false, sma20: false, rsi: false, macd: false, smc: false, ew: false },
    'Trend EMA': { bb: false, lwma: false, ema50: true, sd: false, vwap: false, ema200: true, sma20: true, rsi: false, macd: false, smc: false, ew: false },
    'Momentum RSI': { bb: true, lwma: false, ema50: false, sd: false, vwap: false, ema200: false, sma20: false, rsi: true, macd: false, smc: false, ew: false },
    'MACD': { bb: true, lwma: false, ema50: false, sd: false, vwap: false, ema200: false, sma20: false, rsi: false, macd: true, smc: false, ew: false },
    'SMC': { bb: true, lwma: true, ema50: true, sd: false, vwap: false, ema200: false, sma20: false, rsi: false, macd: false, smc: true, ew: true },
    'Full': { bb: true, lwma: true, ema50: true, sd: true, vwap: true, ema200: true, sma20: true, rsi: true, macd: true, smc: true, ew: true }
  };

  function lwc() {
    return (typeof window !== 'undefined' && (window.LightweightCharts || window.lightweightCharts)) || null;
  }
  function toSec(isoOrMs) {
    if (typeof isoOrMs === 'number') return Math.round(isoOrMs / 1000);
    var n = Date.parse(isoOrMs);
    return isNaN(n) ? null : Math.round(n / 1000);
  }

  // ---- indicator math (identical to the BBMA bridge) ------------------------
  function smaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var s = 0;
    for (var j = i + 1 - n; j <= i; j++) s += arr[j];
    return s / n;
  }
  function popStdAt(arr, n, i, mean) {
    if (i + 1 < n) return null;
    var s = 0;
    for (var j = i + 1 - n; j <= i; j++) { var d = arr[j] - mean; s += d * d; }
    return Math.sqrt(s / n);
  }
  function emaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var k = 2 / (n + 1), e = 0;
    for (var j = 0; j <= i; j++) { e = (j === 0) ? arr[0] : arr[j] * k + e * (1 - k); }
    return e;
  }
  // Linear-weighted moving average (weights 1..n on the most-recent bar) — the BBMA
  // "linear weighted" MA on the HIGH and LOW series (Oma Ally core lines).
  function lwmaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var s = 0, den = n * (n + 1) / 2;
    for (var j = i + 1 - n; j <= i; j++) s += arr[j] * (j - (i + 1 - n) + 1);
    return s / den;
  }
  function computeOverlays(bars) {
    var closes = bars.map(function (b) { return b.close; });
    var highs = bars.map(function (b) { return b.high; });
    var lows = bars.map(function (b) { return b.low; });
    var I = IND();
    for (var i = 0; i < bars.length; i++) {
      var m = smaAt(closes, 20, i);
      if (m != null) {
        var sd = popStdAt(closes, 20, i, m);
        bars[i].bbUpper = +(m + 2 * sd).toFixed(2);
        bars[i].bbMiddle = +m.toFixed(2);
        bars[i].bbLower = +(m - 2 * sd).toFixed(2);
      }
      var e50 = emaAt(closes, 50, i);
      if (e50 != null) bars[i].ema50 = +e50.toFixed(2);
      // BBMA Oma Ally core: linear-weighted MA 5/10 on the HIGH and LOW series
      var h5 = lwmaAt(highs, 5, i); if (h5 != null) bars[i].lwmaH5 = +h5.toFixed(2);
      var h10 = lwmaAt(highs, 10, i); if (h10 != null) bars[i].lwmaH10 = +h10.toFixed(2);
      var l5 = lwmaAt(lows, 5, i); if (l5 != null) bars[i].lwmaL5 = +l5.toFixed(2);
      var l10 = lwmaAt(lows, 10, i); if (l10 != null) bars[i].lwmaL10 = +l10.toFixed(2);
      if (I) {
        var e200 = I.emaAt(closes, 200, i);
        if (e200 != null) bars[i].ema200 = +e200.toFixed(2);
        var s20 = I.smaAt(closes, 20, i);
        if (s20 != null) bars[i].sma20 = +s20.toFixed(2);
      }
    }
    // Session-anchored VWAP (needs high/low/close + a per-bar UTC day bucket).
    if (I && bars.length) {
      var vw = I.vwap(bars.map(function (b) {
        return { time: b.time, high: b.high, low: b.low, close: b.close, _day: Math.floor(b.time / 86400) };
      }));
      for (var k = 0; k < bars.length; k++) if (Number.isFinite(vw[k])) bars[k].vwap = +vw[k].toFixed(2);
    }
  }

  // ---- state ------------------------------------------------------------------
  var state = {
    container: null, chart: null, candles: null, overlays: {},
    zoneSeries: null, annoSeries: null,
    rsiLine: null, rsiOver: null, rsiUnder: null,
    macdHist: null, macdLine: null, macdSig: null, smcSeries: null, rsiPane: null, macdPane: null, ewSeries: null,
    tf: 'H1', tool: null, pending: null, fullscreen: false, indPanel: false, drawPanel: false,
    ind: { bb: true, lwma: true, ema50: true, sd: true, vwap: false, ema200: false, sma20: false, rsi: false, macd: false, smc: false, ew: false },
    template: 'BBMA Oma',
    drawings: {},
    _bars: [], _zones: [], lastKey: null
  };

  function loadDrawings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var d = JSON.parse(raw); if (d && typeof d === 'object') state.drawings = d; }
    } catch (e) { /* fresh */ }
  }
  function saveDrawings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.drawings)); } catch (e) { /* quota */ }
  }

  // ---- shared draw helper: (target, priceConverter) -> paint fn ---------------
  function paintMedia(target, fn) {
    if (!target || typeof target.useMediaCoordinateSpace !== 'function') return;
    target.useMediaCoordinateSpace(function (media) {
      try { fn(media.context, media.mediaSize); } catch (e) { /* never break LWC render */ }
    });
  }
  function px(sec, price, priceConverter) {
    var ts = state.chart.timeScale();
    var x = ts.timeToCoordinate(sec);
    var y = priceConverter(price);
    return (x == null || y == null) ? null : { x: x, y: y };
  }

  // ---- annotation (drawing) layer: one custom series, all shapes --------------
  // Draw reads a shared holder (set by refreshAnno before setData) so repeated
  // setData calls never accumulate stale shapes.
  var annoState = { shapes: [] };
  function makeAnnoView() {
    return {
      update: function () { /* shapes carried via annoState */ },
      priceValueBuilder: function () { return []; }, // annotations never force autoscale
      isWhitespace: function () { return true; },
      defaultOptions: function () { return {}; },
      renderer: function () {
        return {
          draw: function (target, priceConverter) {
            var shapes = annoState.shapes;
            if (!shapes.length) return;
            paintMedia(target, function (ctx, size) {
              var W = size ? size.width : 0;
              var ts = state.chart.timeScale();
              for (var i = 0; i < shapes.length; i++) {
                var s = shapes[i];
                ctx.save();
                if (s.type === 'hline') {
                  var y = priceConverter(s.p1);
                  if (y == null) { ctx.restore(); continue; }
                  ctx.strokeStyle = s.color; ctx.lineWidth = 1;
                  if (ctx.setLineDash) ctx.setLineDash([6, 4]);
                  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
                  if (ctx.setLineDash) ctx.setLineDash([]);
                  ctx.fillStyle = s.color;
                  try { ctx.font = '10px sans-serif'; ctx.fillText(String(s.p1), 6, y - 4); } catch (e) { }
                  ctx.restore();
                  continue;
                }
                var p1 = px(s.t1, s.p1, priceConverter);
                var p2 = (s.t2 != null && s.p2 != null) ? px(s.t2, s.p2, priceConverter) : p1;
                if (!p1) { ctx.restore(); continue; }
                if (s.type === 'trend') {
                  if (!p2) { ctx.restore(); continue; }
                  ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
                  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                  ctx.restore();
                } else if (s.type === 'rect') {
                  if (!p2) { ctx.restore(); continue; }
                  ctx.globalAlpha = 0.16; ctx.fillStyle = s.color;
                  ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(1, Math.abs(p2.x - p1.x)), Math.max(1, Math.abs(p2.y - p1.y)));
                  ctx.globalAlpha = 0.9; ctx.strokeStyle = s.color; ctx.lineWidth = 1;
                  ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(1, Math.abs(p2.x - p1.x)), Math.max(1, Math.abs(p2.y - p1.y)));
                  ctx.restore();
                } else if (s.type === 'text') {
                  ctx.fillStyle = s.color;
                  try { ctx.font = '11px sans-serif'; ctx.fillText(s.text || 'note', p1.x + 4, p1.y - 4); } catch (e) { }
                  ctx.restore();
                }
              }
            });
          }
        };
      }
    };
  }

  function refreshAnno() {
    if (!state.annoSeries) return;
    annoState.shapes = (state.drawings[state.tf] || []).slice();
    // anchor on the first real bar so a 1970 timestamp never stretches the axis
    var anchor = (state._bars && state._bars.length) ? state._bars[0].time : 1;
    try { state.annoSeries.setData([{ time: anchor }]); } catch (e) { }
  }

  // ---- S/D zone layer -----------------------------------------------------------
  // Draw reads a shared holder (set by feed before setData) so repeated
  // setData calls never accumulate stale zones.
  var zoneState = { zones: [] };
  function makeZoneView() {
    return {
      update: function () { /* zones carried via zoneState */ },
      priceValueBuilder: function () { return []; }, // zones don't force autoscale (a distant zone must not squash the view)
      isWhitespace: function (item) { return !item || !item.zone; },
      defaultOptions: function () { return {}; },
      renderer: function () {
        return {
          draw: function (target, priceConverter) {
            var zones = zoneState.zones;
            if (!zones.length) return;
            paintMedia(target, function (ctx) {
              for (var i = 0; i < zones.length; i++) {
                var z = zones[i];
                var a = px(Math.round(z.formTime / 1000), z.low, priceConverter);
                var b = px(Math.round(z.toTime / 1000), z.high, priceConverter);
                if (!a || !b) continue;
                var x1 = a.x, x2 = b.x;
                var yTop = priceConverter(z.high), yBot = priceConverter(z.low);
                if (yTop == null || yBot == null) continue;
                ctx.save();
                var col = z.kind === 'SUPPLY' ? COLORS.supply : COLORS.demand;
                ctx.globalAlpha = 0.14;
                ctx.fillStyle = col;
                ctx.fillRect(Math.min(x1, x2), Math.min(yTop, yBot), Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(yBot - yTop)));
                ctx.globalAlpha = 0.55;
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                ctx.strokeRect(Math.min(x1, x2), Math.min(yTop, yBot), Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(yBot - yTop)));
                try {
                  ctx.globalAlpha = 0.9; ctx.fillStyle = col;
                  ctx.font = '9px sans-serif';
                  ctx.fillText(z.kind === 'SUPPLY' ? 'S' : 'D', Math.min(x1, x2) + 3, Math.min(yTop, yBot) + 10);
                } catch (e) { }
                ctx.restore();
              }
            });
          }
        };
      }
    };
  }

  // ---- SMC layer (kxngHADES SMC-Marking + Sweep [pandich]) ------------------------
  // One custom series draws: premium/discount/equilibrium bands, order blocks, FVGs,
  // equal high/low liquidity lines, HH/HL/LH/LL swing labels, BOS/CHoCH break lines and
  // the latest sweep-reversal plan (entry / stop / 1R 2R 3R). Reads a holder set by
  // feed() before setData so repeated setData never accumulates stale marks.
  var smcState = { data: null, on: false };
  function makeSmcView() {
    return {
      update: function () { },
      priceValueBuilder: function () { return []; }, // SMC marks never force autoscale
      zOrder: function () { return 'bottom'; }, // paint behind the candlesticks + BBMA lines so panning never hides the indicators
      isWhitespace: function () { return !smcState.on || !smcState.data; },
      defaultOptions: function () { return {}; },
      renderer: function () {
        return {
          draw: function (target, priceConverter) {
            var d = smcState.data;
            if (!smcState.on || !d) return;
            paintMedia(target, function (ctx, size) {
              var W = size ? size.width : 0;
              var ts = state.chart.timeScale();
              var X = function (ms) { return ts.timeToCoordinate(Math.round(ms / 1000)); };
              var Y = function (p) { return priceConverter ? priceConverter(p) : null; };
              var xLast = (d.lastTime != null) ? X(d.lastTime) : null;
              if (xLast == null) xLast = W;
              var i, y, x1, x2;
              if (d.range) {
                var r = d.range;
                function band(top, bot, col, alpha) {
                  var yt = Y(top), yb = Y(bot);
                  if (yt == null || yb == null) return;
                  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = col;
                  ctx.fillRect(0, Math.min(yt, yb), W, Math.max(1, Math.abs(yb - yt)));
                  ctx.globalAlpha = 0.5; ctx.strokeStyle = col; ctx.lineWidth = 1;
                  ctx.strokeRect(0, Math.min(yt, yb), W, Math.max(1, Math.abs(yb - yt)));
                  ctx.restore();
                }
                band(r.premTop, r.premBottom, COLORS.smcPrem, 0.16);
                band(r.discTop, r.discBottom, COLORS.smcDisc, 0.16);
                band(r.eqTop, r.eqBottom, COLORS.smcEq, 0.14);
                ctx.save(); ctx.globalAlpha = 0.85; ctx.font = '10px sans-serif';
                var ym = Y(r.mid); if (ym != null) { ctx.fillStyle = COLORS.smcEq; ctx.fillText('EQ', 4, ym - 3); }
                var yp = Y(r.premTop); if (yp != null) { ctx.fillStyle = COLORS.smcPrem; ctx.fillText('PREMIUM', 4, yp + 10); }
                var yd = Y(r.discBottom); if (yd != null) { ctx.fillStyle = COLORS.smcDisc; ctx.fillText('DISCOUNT', 4, yd - 3); }
                ctx.restore();
              }
              var zones = d.zones || [];
              for (i = 0; i < zones.length; i++) {
                var z = zones[i];
                var col = (z.kind === 'SUPPLY_OB' || z.kind === 'BEAR_FVG') ? COLORS.smcOBsupply : COLORS.smcOBdemand;
                var xt = X(z.time); y = Y(z.top != null ? z.top : z.high);
                var yb2 = Y(z.bottom != null ? z.bottom : z.low);
                if (xt == null || y == null || yb2 == null) continue;
                ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = col;
                ctx.fillRect(xt, Math.min(y, yb2), Math.max(2, xLast - xt), Math.max(1, Math.abs(yb2 - y)));
                ctx.globalAlpha = 0.75; ctx.strokeStyle = col; ctx.lineWidth = 1;
                ctx.strokeRect(xt, Math.min(y, yb2), Math.max(2, xLast - xt), Math.max(1, Math.abs(yb2 - y)));
                if (Math.abs(yb2 - y) > 12) {
                  ctx.globalAlpha = 0.95; ctx.fillStyle = col; ctx.font = '10px sans-serif';
                  ctx.fillText((z.kind === 'BULL_FVG' || z.kind === 'BEAR_FVG') ? 'FVG' : 'OB', xt + 3, Math.min(y, yb2) + 11);
                }
                ctx.restore();
              }
              var eq = d.eq || {};
              (eq.eqh || []).forEach(function (it) {
                y = Y(it.price); x1 = X(it.t1); x2 = X(it.t2);
                if (y == null || x1 == null || x2 == null) return;
                ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = COLORS.smcLH; ctx.lineWidth = 1;
                if (ctx.setLineDash) ctx.setLineDash([2, 2]);
                ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
                if (ctx.setLineDash) ctx.setLineDash([]);
                ctx.globalAlpha = 0.95; ctx.fillStyle = COLORS.smcLH; ctx.font = '10px sans-serif';
                ctx.fillText('EQH', Math.min(x1, x2), y - 3); ctx.restore();
              });
              (eq.eql || []).forEach(function (it) {
                y = Y(it.price); x1 = X(it.t1); x2 = X(it.t2);
                if (y == null || x1 == null || x2 == null) return;
                ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = COLORS.smcHL; ctx.lineWidth = 1;
                if (ctx.setLineDash) ctx.setLineDash([2, 2]);
                ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
                if (ctx.setLineDash) ctx.setLineDash([]);
                ctx.globalAlpha = 0.95; ctx.fillStyle = COLORS.smcHL; ctx.font = '10px sans-serif';
                ctx.fillText('EQL', Math.min(x1, x2), y + 11); ctx.restore();
              });
              var labs = (d.struct && d.struct.labels) || [];
              for (i = 0; i < labs.length; i++) {
                var lb = labs[i]; var xl = X(lb.time); var yl = Y(lb.price);
                if (xl == null || yl == null) continue;
                ctx.save(); ctx.globalAlpha = 1; ctx.font = 'bold 11px sans-serif';
                ctx.fillStyle = lb.tag === 'HH' ? COLORS.smcHH : lb.tag === 'HL' ? COLORS.smcHL : lb.tag === 'LH' ? COLORS.smcLH : COLORS.smcLL;
                var lx = xl - 10, ly = lb.kind === 'H' ? yl - 6 : yl + 14;
                ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,13,24,0.85)'; ctx.strokeText(lb.tag, lx, ly);
                ctx.fillText(lb.tag, lx, ly); ctx.restore();
              }
              var brk = (d.struct && d.struct.breaks) || [];
              for (i = 0; i < brk.length; i++) {
                var bk = brk[i]; var xb = X(bk.time); var yb3 = Y(bk.level);
                if (xb == null || yb3 == null) continue;
                ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = bk.tag === 'CHoCH' ? COLORS.smcCHoCH : COLORS.smcBOS; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(xb, yb3); ctx.lineTo(Math.max(xb, xLast - 40), yb3); ctx.stroke();
                ctx.globalAlpha = 1; ctx.fillStyle = bk.tag === 'CHoCH' ? COLORS.smcCHoCH : COLORS.smcBOS; ctx.font = '10px sans-serif';
                ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,13,24,0.85)'; ctx.strokeText(bk.tag, xb + 2, yb3 - 3);
                ctx.fillText(bk.tag, xb + 2, yb3 - 3); ctx.restore();
              }
              if (d.sweep) {
                var sv = d.sweep, xs = X(sv.time), up = sv.dir === 'long';
                var levels = [
                  { p: sv.entry, t: 'E ' + sv.entry.toFixed(1), c: COLORS.smcSweep },
                  { p: sv.stop, t: 'SL ' + sv.stop.toFixed(1), c: COLORS.smcOBsupply },
                  { p: sv.tp1, t: '1R', c: COLORS.smcOBdemand },
                  { p: sv.tp2, t: '2R', c: COLORS.smcOBdemand },
                  { p: sv.tp3, t: '3R', c: COLORS.smcOBdemand }
                ];
                for (i = 0; i < levels.length; i++) {
                  var Lp = levels[i]; var yl2 = Y(Lp.p);
                  if (yl2 == null || xs == null) continue;
                  ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = Lp.c;
                  ctx.lineWidth = (Lp.p === sv.entry) ? 2 : 1;
                  if (ctx.setLineDash) ctx.setLineDash((Lp.p === sv.entry) ? [] : [4, 3]);
                  ctx.beginPath(); ctx.moveTo(xs, yl2); ctx.lineTo(xLast, yl2); ctx.stroke();
                  if (ctx.setLineDash) ctx.setLineDash([]);
                  ctx.globalAlpha = 1; ctx.fillStyle = Lp.c; ctx.font = (Lp.p === sv.entry ? 'bold ' : '') + '10px sans-serif';
                  var sTxt = (up ? '\u25b2 ' : '\u25bc ') + Lp.t, sY = yl2 + (Lp.p === sv.entry ? (up ? 13 : -4) : -3);
                  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,13,24,0.85)'; ctx.strokeText(sTxt, xs + 3, sY);
                  ctx.fillText(sTxt, xs + 3, sY);
                  ctx.restore();
                }
              }
            });
          }
        };
      }
    };
  }

  // ---- Elliott Wave v2.9 layer (lib/elliott-wave.js, E1 engine) ---------------------
  // READ-ONLY auto-count: degree-colored wave labels (MotiveWave ladder), 0-2 channel,
  // blue forecast path, the "Red or Blue?" competing count + split level, EWSTRAT
  // terminal-extension targets, and a two-scenario box (entry / stop / target / R:R).
  // Counts are computed from the same bars the candles use; no user drawing, no
  // interaction — it mirrors the professional channels' published-scenario format.
  // Fail-closed if the EW engine is absent (window.BBMA_EW) — the chart renders as before.
  var EW_STORE = 'xaudesk-fullview-ewfp-v1';
  var ewState = { data: null, on: false };
  function ewFpGet(tf) {
    try { return (JSON.parse(sessionStorage.getItem(EW_STORE) || '{}') || {})[tf] || null; } catch (e) { return null; }
  }
  function ewFpSet(tf, fp) {
    try {
      var all = JSON.parse(sessionStorage.getItem(EW_STORE) || '{}') || {};
      all[tf] = fp;
      sessionStorage.setItem(EW_STORE, JSON.stringify(all));
    } catch (e) { }
  }
  function ewCompute(bars) {
    var EW = window.BBMA_EW;
    if (!EW || !bars || bars.length < 20) return null;
    var src = bars.map(function (b) { return { t: b._ms, high: b.high, low: b.low }; });
    var a;
    try { a = EW.autoCount(src, 2); } catch (e) { return null; }
    if (!a || !a.count || !a.count.pivots || a.count.pivots.length < 4) return null;
    var p = a.count.pivots;
    var lastPrice = bars[bars.length - 1].close;
    // Competing ("Red or Blue?") count: a corrective zigzag of the same structure,
    // opposite direction, A/B anchored on the first two pivots, C at the current price.
    var comp = null;
    if (p.length >= 3) {
      comp = { type: 'zigzag', dir: -a.dir, pivots: [
        { t: p[0].t, price: p[0].price }, { t: p[1].t, price: p[1].price },
        { t: p[2].t, price: p[2].price }, { t: p[p.length - 1].t, price: lastPrice }] };
      try { comp = { count: comp, dir: comp.dir, validation: EW.validate(comp), forecast: EW.forecast(comp) }; } catch (e) { comp = null; }
    }
    var compete = null;
    if (comp) { try { compete = EW.compete(a, comp, lastPrice); } catch (e) { compete = null; } }
    var channel = null;
    try { channel = EW.channel(a.count, bars[bars.length - 1]._ms); } catch (e) { channel = null; }
    var revision = null;
    try { revision = EW.revisionDiff(ewFpGet(state.tf), a, new Date().toISOString().slice(0, 10)); } catch (e) { revision = null; }
    try { ewFpSet(state.tf, EW.countFingerprint(a)); } catch (e) { }
    return { a: a, compete: compete, channel: channel, revision: revision, lastTime: bars[bars.length - 1]._ms, lastPrice: lastPrice };
  }
  function makeEwView() {
    return {
      update: function () { },
      priceValueBuilder: function () { return []; }, // read-only: never force autoscale
      zOrder: function () { return 'bottom'; }, // behind candles + BBMA lines (panning never hides the indicators)
      // LWC 5.x skips the custom-series draw pass for whitespace data — an always-true
      // isWhitespace meant draw() was never called, so the overlay silently vanished.
      // Gate on the live toggle so the pass runs only while the layer is on.
      isWhitespace: function () { return !ewState.on || !ewState.data; },
      defaultOptions: function () { return {}; },
      renderer: function () {
        return {
          draw: function (target, priceConverter) {
            var d = ewState.data;
            if (!ewState.on || !d) return;
            paintMedia(target, function (ctx, size) {
              var EW = window.BBMA_EW;
              if (!EW) return;
              var W = size ? size.width : 0;
              var ts = state.chart.timeScale();
              var X = function (ms) { return ts.timeToCoordinate(Math.round(ms / 1000)); };
              var Y = function (p) { return priceConverter ? priceConverter(p) : null; };
              var xLast = (d.lastTime != null) ? X(d.lastTime) : null;
              if (xLast == null) xLast = W;
              var a = d.a, p = a.count.pivots, i, x, y;
              var HL = function (s, hx, hy) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,13,24,0.85)'; ctx.strokeText(s, hx, hy); };
              // (1) degree-colored wave labels at each pivot (MotiveWave color ladder)
              var degs;
              try { degs = EW.degreeLabels(a.count); } catch (e) { degs = []; }
              for (i = 0; i < p.length && i < degs.length; i++) {
                x = X(p[i].t); y = Y(p[i].price);
                if (x == null || y == null) continue;
                ctx.save(); ctx.globalAlpha = 0.98; ctx.font = 'bold 11px sans-serif';
                ctx.fillStyle = degs[i].color;
                var up = (i > 0) ? p[i].price >= p[i - 1].price : true;
                var tx = Math.max(2, Math.min(x - 6, W - 20));
                var ty = up ? y - 8 : y + 16;
                HL.call(ctx, String(degs[i].label), tx, ty);
                ctx.fillText(String(degs[i].label), tx, ty);
                ctx.restore();
              }
              // (2) 0-2 channel (base + parallel), gray, thin
              if (d.channel && d.channel.base && d.channel.upper) {
                var b0 = d.channel.base[0], b1 = d.channel.base[1], u0 = d.channel.upper[0], u1 = d.channel.upper[1];
                var x0 = X(b0[0]), y0 = Y(b0[1]), x1 = X(b1[0]), y1 = Y(b1[1]), xu = X(u0[0]), yu = Y(u0[1]), x1u = X(u1[0]), y1u = Y(u1[1]);
                ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = COLORS.ewBase; ctx.lineWidth = 1;
                if (ctx.setLineDash) ctx.setLineDash([3, 3]);
                if (x0 != null && y0 != null && x1 != null && y1 != null) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
                if (xu != null && yu != null && x1u != null && y1u != null) { ctx.beginPath(); ctx.moveTo(xu, yu); ctx.lineTo(x1u, y1u); ctx.stroke(); }
                if (ctx.setLineDash) ctx.setLineDash([]);
                ctx.restore();
              }
              // (3) blue forecast path (Primary scenario projection)
              var path = (a.forecast && a.forecast.path) || null;
              if (path && path.length > 1) {
                ctx.save(); ctx.globalAlpha = 0.8; ctx.strokeStyle = COLORS.ewScenA; ctx.lineWidth = 1.5;
                if (ctx.setLineDash) ctx.setLineDash([6, 4]);
                ctx.beginPath();
                var started = false;
                for (i = 0; i < path.length; i++) {
                  x = X(path[i].t); y = Y(path[i].price);
                  if (x == null || y == null) continue;
                  if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
                }
                ctx.stroke();
                if (ctx.setLineDash) ctx.setLineDash([]);
                ctx.restore();
              }
              // (4) competing levels: yellow split (the "Red or Blue" line) + red invalidation stop
              var sc0 = (a.forecast && a.forecast.scenarios && a.forecast.scenarios[0]) || null;
              if (d.compete && d.compete.splitLevel != null) {
                var ys = Y(d.compete.splitLevel);
                if (ys != null) {
                  ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = COLORS.ewSplit; ctx.lineWidth = 1.5;
                  if (ctx.setLineDash) ctx.setLineDash([8, 4]);
                  ctx.beginPath(); ctx.moveTo(0, ys); ctx.lineTo(W, ys); ctx.stroke();
                  if (ctx.setLineDash) ctx.setLineDash([]);
                  ctx.globalAlpha = 1; ctx.fillStyle = COLORS.ewSplit; ctx.font = 'bold 10px sans-serif';
                  var st = 'SPLIT ' + d.compete.splitLevel.toFixed(2);
                  HL(st, 8, ys - 5); ctx.fillText(st, 8, ys - 5);
                  ctx.restore();
                }
              }
              if (sc0 && sc0.stop != null) {
                var yst = Y(sc0.stop);
                if (yst != null) {
                  ctx.save(); ctx.globalAlpha = 0.65; ctx.strokeStyle = COLORS.ewStop; ctx.lineWidth = 1;
                  if (ctx.setLineDash) ctx.setLineDash([2, 3]);
                  ctx.beginPath(); ctx.moveTo(0, yst); ctx.lineTo(W, yst); ctx.stroke();
                  if (ctx.setLineDash) ctx.setLineDash([]);
                  ctx.globalAlpha = 1; ctx.fillStyle = COLORS.ewStop; ctx.font = '10px sans-serif';
                  var invt = 'INVA ' + sc0.stop.toFixed(2);
                  HL(invt, 8, yst + 12); ctx.fillText(invt, 8, yst + 12);
                  ctx.restore();
                }
              }
              // (5) scenario box — "Red or Blue?" two-scenario read (top-right, last N bars)
              if (sc0) {
                var scen = (a.forecast && a.forecast.scenarios) || [sc0];
                var alt = scen[1] || null;
                var winner = (d.compete && d.compete.winner) || 'open';
                var rrA = (sc0.t1 != null) ? EW.rr(sc0.entry, sc0.stop, sc0.t1) : null;
                var lines = [];
                lines.t1 = 'ELLIOTT WAVE · ' + a.type + (a.dir === 1 ? ' UP' : ' DOWN') + (a.validation.valid ? ' · VALID' : ' · in progress');
                lines.push({ t: '\u25b2 A  ' + (sc0.side || '').toUpperCase() + '  E ' + (sc0.entry != null ? sc0.entry.toFixed(2) : '—') + '  SL ' + (sc0.stop != null ? sc0.stop.toFixed(2) : '—') + '  T ' + (sc0.t1 != null ? sc0.t1.toFixed(2) : '—') + (rrA != null ? '  ' + rrA + ':1' : ''), c: COLORS.ewScenA });
                if (alt) {
                  var rrB = (alt.t1 != null) ? EW.rr(alt.entry, alt.stop, alt.t1) : null;
                  lines.push({ t: '\u25bc B  ' + (alt.side || '').toUpperCase() + '  E ' + (alt.entry != null ? alt.entry.toFixed(2) : '—') + '  SL ' + (alt.stop != null ? alt.stop.toFixed(2) : '—') + '  T ' + (alt.t1 != null ? alt.t1.toFixed(2) : '—') + (rrB != null ? '  ' + rrB + ':1' : ''), c: COLORS.ewScenB });
                }
                if (d.compete && d.compete.splitLevel != null) lines.push({ t: 'split ' + d.compete.splitLevel.toFixed(2) + (winner !== 'open' ? '  ·  ' + winner + ' active' : ''), c: COLORS.ewSplit });
                if (d.revision && d.revision.changed) lines.push({ t: d.revision.note, c: '#ffd166' });
                if (d.revision && d.revision.question) lines.push({ t: 'Q: ' + d.revision.question, c: '#d7e2f4' });
                var fs = 10, pad = 8, lh = 14;
                var bw = 0;
                ctx.save(); ctx.font = fs + 'px sans-serif';
                for (i = 0; i < lines.length; i++) { var w = ctx.measureText(lines[i].t).width; if (w > bw) bw = w; }
                bw = Math.min(bw + pad * 2, W - 8);
                var bh = lines.length * lh + pad * 2;
                // top-LEFT: the top-right is where the live-price tag + premium
                // annotations crowd; the far-left of the visible window is the
                // least busy spot, so panning doesn't hide the scenario read.
                var bx = 4, by = 4;
                ctx.fillStyle = COLORS.ewBox;
                ctx.fillRect(bx, by, bw, bh);
                ctx.strokeStyle = COLORS.ewUpper; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
                var yy = by + pad + fs;
                // header
                ctx.font = 'bold ' + fs + 'px sans-serif'; ctx.fillStyle = COLORS.ewBoxText;
                ctx.fillText(lines.t1, bx + pad, yy);
                yy += lh + 2;
                ctx.font = fs + 'px sans-serif';
                for (i = 0; i < lines.length; i++) {
                  ctx.fillStyle = lines[i].c;
                  ctx.fillText(lines[i].t, bx + pad, yy);
                  yy += lh;
                }
                ctx.restore();
              }
            });
          }
        };
      }
    };
  }

  // ---- oscillator sub-panes (dynamic) ---------------------------------------------
  // RSI and MACD live in real LWC sub-panes that are added when the indicator is
  // enabled and removed when it is disabled, so an off indicator leaves no empty
  // pane (previously the panes were created once and only hidden, still occupying
  // chart height). Panes are kept in a stable order (main, RSI, MACD).
  // ---- oscillator sub-panes (dynamic) ---------------------------------------------
  // RSI and MACD live in real LWC sub-panes. addSeries(def, opts, paneIndex) in this
  // build auto-creates the target pane, and removePane(INDEX) destroys it + its series
  // (this build asserts on a numeric index — passing the pane wrapper throws
  // 'Invalid pane index', which is why the pane used to stay behind after unpress).
  // We rebuild the oscillator pane stack ONLY when the enabled-set (rsi/macd) changes:
  // drop every non-main pane, then re-add the enabled ones in canonical order (RSI
  // first, MACD second). This leaves NO empty pane behind when an indicator is off
  // (the old code created the panes once and only hid them, so a 147px empty strip
  // stayed on screen) and avoids index gaps when only one of the two is on.
  function syncOscPanes() {
    if (!state.chart || !state.container) return;
    var I = IND(), L = lwc();
    var wantRsi = !!state.ind.rsi && !!I && !!L.LineSeries;
    var wantMacd = !!state.ind.macd && !!I && !!L.HistogramSeries;
    var sig = (wantRsi ? 'r' : '') + (wantMacd ? 'm' : '');
    if (sig === state._oscSig) return; // enabled-set unchanged
    try {
      // Drop every non-main pane (from the end down) so we start from just the main pane.
      var ps = state.chart.panes ? state.chart.panes() : [];
      while (ps.length > 1) {
        ps = state.chart.panes ? state.chart.panes() : [];
        state.chart.removePane(ps.length - 1); // numeric index — required by this build
      }
      state.rsiLine = state.rsiOver = state.rsiUnder = null;
      state.macdHist = state.macdLine = state.macdSig = null;
      if (wantRsi) {
        state.rsiLine = state.chart.addSeries(L.LineSeries, {
          color: COLORS.rsi, lineWidth: 1, priceScaleId: 'right', lastValueVisible: true,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 }
        }, 1);
        if (state.rsiLine && state.rsiLine.createPriceLine) {
          try {
            state.rsiOver = state.rsiLine.createPriceLine({ price: 70, color: COLORS.rsiOver, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
            state.rsiUnder = state.rsiLine.createPriceLine({ price: 30, color: COLORS.rsiUnder, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          } catch (e) { state.rsiOver = state.rsiUnder = null; }
        }
      }
      if (wantMacd) {
        var mi = wantRsi ? 2 : 1;
        state.macdHist = state.chart.addSeries(L.HistogramSeries, { priceScaleId: 'right', lastValueVisible: true }, mi);
        state.macdLine = state.chart.addSeries(L.LineSeries, { color: COLORS.macd, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false }, mi);
        state.macdSig = state.chart.addSeries(L.LineSeries, { color: COLORS.macdSig, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false }, mi);
      }
    } catch (e) { /* never break the chart over sub-pane churn */ }
    state._oscSig = sig;
  }

  // ---- chart lifecycle ------------------------------------------------------------
  function ensureChart() {
    var L = lwc();
    if (!L) return null;
    if (state.chart && state.container) return state.chart;
    if (state.container) state.container.innerHTML = '';
    state.chart = L.createChart(state.container, {
      autoSize: true,
      layout: { background: { color: COLORS.bg }, textColor: COLORS.text, attributionLogo: true, fontSize: 11 },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 8, minBarSpacing: 0.2, maxBarSpacing: 60 },
      rightPriceScale: { borderColor: COLORS.grid },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true
    });
    state.candles = state.chart.addSeries(L.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down,
      borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
      priceScaleId: 'right', priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });
    var ov = function (color, style) {
      return state.chart.addSeries(L.LineSeries, {
        color: color, lineWidth: 1, lineStyle: style || 0, priceScaleId: 'right',
        lastValueVisible: false, crosshairMarkerVisible: false
      });
    };
    state.overlays.bbUpper = ov(COLORS.bbUpper);
    state.overlays.bbMiddle = ov(COLORS.bbMiddle, 2);
    state.overlays.bbLower = ov(COLORS.bbLower);
    state.overlays.ema50 = ov(COLORS.ema50);
    state.overlays.ema200 = ov(COLORS.ema200);
    state.overlays.sma20 = ov(COLORS.sma20);
    state.overlays.vwap = ov(COLORS.vwap, 1); // VWAP dashed
    // BBMA Oma Ally core lines (LWMA 5/10 on HIGH and LOW)
    state.overlays.lwmaH5 = ov(COLORS.lwmaH5);
    state.overlays.lwmaH10 = ov(COLORS.lwmaH10, 2);
    state.overlays.lwmaL5 = ov(COLORS.lwmaL5);
    state.overlays.lwmaL10 = ov(COLORS.lwmaL10, 2);
    // NOTE: addCustomSeries is a method on the CHART INSTANCE, not on the global
    // LightweightCharts namespace — gating on `L.addCustomSeries` was always false and
    // silently dropped every custom layer (S/D zones + drawings + SMC). Gate on the
    // instance and guard each layer so one failure never blanks the rest.
    if (typeof state.chart.addCustomSeries === 'function') {
      try { state.zoneSeries = state.chart.addCustomSeries(makeZoneView(), { priceScaleId: 'right' }); } catch (e) { state.zoneSeries = null; }
      try { state.annoSeries = state.chart.addCustomSeries(makeAnnoView(), { priceScaleId: 'right' }); } catch (e) { state.annoSeries = null; }
      try { state.smcSeries = state.chart.addCustomSeries(makeSmcView(), { priceScaleId: 'right' }); } catch (e) { state.smcSeries = null; }
      try { state.ewSeries = state.chart.addCustomSeries(makeEwView(), { priceScaleId: 'right' }); } catch (e) { state.ewSeries = null; }
    }
    // Oscillator sub-panes (RSI, MACD) are created lazily in syncOscPanes() so a
    // disabled indicator leaves NO empty pane behind.
    bindPointer();
    return state.chart;
  }

  function barsFor(tf) {
    var rt = window.BBMARuntime && window.BBMARuntime.frames;
    var raw = rt && rt[tf];
    if (!raw || !raw.length) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      var sec = toSec(c.time != null ? c.time : c.t);
      if (sec == null) continue;
      out.push({ time: sec, open: +c.open, high: +c.high, low: +c.low, close: +c.close, _ms: sec * 1000 });
    }
    var clean = [];
    for (var j = 0; j < out.length; j++) {
      if (clean.length && out[j].time <= clean[clean.length - 1].time) continue;
      clean.push(out[j]);
    }
    return clean;
  }

  function sdZones(bars) {
    var SD = window.BBMA_SupplyDemand;
    if (!SD) return [];
    var candles = bars.map(function (b) {
      return { time: b._ms, open: b.open, high: b.high, low: b.low, close: b.close };
    });
    try { return SD.activeBands(candles, SD_PARAMS); } catch (e) { return []; }
  }

  function feed() {
    var bars = barsFor(state.tf);
    if (!bars.length) {
      state.container.innerHTML = '<div class="bbx-empty" style="padding:18px">CHART_WAITING · ' + state.tf + ' history loading…</div>';
      return;
    }
    if (!ensureChart()) {
      state.container.innerHTML = '<div class="bbx-empty" style="padding:18px">lightweight-charts unavailable (offline?) — the BBMA tab still has its chart.</div>';
      return;
    }
    computeOverlays(bars);
    state._bars = bars;
    state.candles.setData(bars);
    applyOverlays();
    state._zones = state.ind.sd ? sdZones(bars) : [];
    zoneState.zones = state._zones;
    if (state.zoneSeries) {
      try { state.zoneSeries.setData(state._zones.map(function (z) { return { time: Math.round(z.formTime / 1000), zone: z }; })); } catch (e) { }
    }
    // SMC (premium/discount, order blocks, FVG, sweeps) — fail-closed if the engine is absent.
    smcState.on = !!state.ind.smc;
    if (state.smcSeries) {
      var SMC = (typeof window !== 'undefined') && window.BBMA_SMC;
      try {
        if (smcState.on && SMC) {
          var sc = bars.map(function (b) { return { time: b._ms, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }; });
          var res = SMC.compute(sc, { swingLen: 3 });
          res.lastTime = bars[bars.length - 1]._ms;
          smcState.data = res;
        } else smcState.data = null;
      } catch (e) { smcState.data = null; }
      try { state.smcSeries.setData([{ time: bars[0].time, on: smcState.on }]); } catch (e) { }
    }
    // Elliott Wave v2.9 read-only overlay (lib/elliott-wave.js) — fail-closed if the
    // engine is absent; counts computed from the same bars the candles use.
    ewState.on = !!state.ind.ew;
    if (state.ewSeries) {
      try { ewState.data = ewState.on && window.BBMA_EW ? ewCompute(bars) : null; } catch (e) { ewState.data = null; }
      try { state.ewSeries.setData([{ time: bars[0].time, on: ewState.on }]); } catch (e) { }
    }
    refreshAnno();
    updateZoneCount();
    try { state.chart.timeScale().fitContent(); } catch (e) { }
    state.lastKey = bars.length + ':' + bars[bars.length - 1].time + ':' + bars[bars.length - 1].close;
  }
  function setOverlayPts(key) {
    if (!state.overlays[key]) return;
    var on = state.ind[OVERLAY_FOR[key]];
    try {
      state.overlays[key].applyOptions({ visible: !!on });
      if (on) {
        var pts = state._bars.filter(function (b) { return Number.isFinite(b[key]); })
          .map(function (b) { return { time: b.time, value: b[key] }; });
        state.overlays[key].setData(pts);
      }
    } catch (e) { }
  }
  // Oscillator sub-panes (RSI pane 1, MACD pane 2). Fail-closed: a missing
  // indicator module or LWC sub-series leaves them empty, never breaking.
  function setOscillators() {
    syncOscPanes();
    var I = IND();
    var bars = state._bars;
    if (!bars || !bars.length) return;
    var closes = bars.map(function (b) { return b.close; });
    if (state.ind.rsi && I && state.rsiLine) {
      try {
        var rv = I.rsi(closes, 14);
        state.rsiLine.setData(bars.map(function (b, i) { return rv[i] == null ? null : { time: b.time, value: +rv[i].toFixed(1) }; }).filter(function (x) { return x; }));
      } catch (e) { }
    }
    if (state.ind.macd && I && state.macdHist) {
      try {
        var m = I.macd(closes, 12, 26, 9);
        state.macdHist.setData(bars.map(function (b, i) { return m.hist[i] == null ? null : { time: b.time, value: +m.hist[i].toFixed(3), color: m.hist[i] >= 0 ? COLORS.macdHistUp : COLORS.macdHistDn }; }).filter(function (x) { return x; }));
        state.macdLine.setData(bars.map(function (b, i) { return m.line[i] == null ? null : { time: b.time, value: +m.line[i].toFixed(3) }; }).filter(function (x) { return x; }));
        state.macdSig.setData(bars.map(function (b, i) { return m.signal[i] == null ? null : { time: b.time, value: +m.signal[i].toFixed(3) }; }).filter(function (x) { return x; }));
      } catch (e) { }
    }
  }
  function applyOverlays() {
    OVERLAY_KEYS.forEach(setOverlayPts);
    setOscillators();
  }
  function updateZoneCount() {
    var el = document.getElementById('fv-zone-count');
    if (el && state._zones) {
      var s = 0, d = 0;
      state._zones.forEach(function (z) { if (z.kind === 'SUPPLY') s++; else d++; });
      el.textContent = 'S/D: ' + s + ' supply · ' + d + ' demand (unmitigated)';
    }
    var sm = document.getElementById('fv-smc-count');
    if (sm) {
      if (state.ind.smc && smcState.data) {
        var d = smcState.data;
        var t = d.struct.trend;
        sm.textContent = 'SMC: ' + (t > 0 ? '\u25b2 up' : t < 0 ? '\u25bc down' : '\u2014 flat') + ' · ' + d.zones.length + ' OB/FVG · ' + d.struct.breaks.length + ' breaks' + (d.sweep ? ' · sweep ' + d.sweep.dir : '');
      } else sm.textContent = '';
    }
    // Elliott Wave v2.9 — count + split + scenario verdict (read-only overlay).
    var ewEl = document.getElementById('fv-ew-count');
    if (!ewEl) return;
    if (state.ind.ew && ewState.data && ewState.data.a) {
      var a = ewState.data.a;
      var sc = (a.forecast && a.forecast.scenarios && a.forecast.scenarios[0]) || null;
      var split = (ewState.data.compete && ewState.data.compete.splitLevel != null) ? ewState.data.compete.splitLevel : null;
      ewEl.textContent = 'EW v2.9: ' + a.type + (a.dir === 1 ? ' \u25b2' : ' \u25bc') + (a.validation.valid ? ' \u00b7 valid' : ' \u00b7 in progress') +
        (sc ? ' \u00b7 ' + (sc.side || '') + ' SL ' + (sc.stop != null ? sc.stop.toFixed(1) : '\u2014') + ' T ' + (sc.t1 != null ? sc.t1.toFixed(1) : '\u2014') : '') +
        (split != null ? ' \u00b7 split ' + split.toFixed(1) : '');
    } else ewEl.textContent = '';
  }

  // ---- live updates -----------------------------------------------------------------
  function onRuntimeUpdated() {
    if (!state.chart || !state.container || !state.container.isConnected) return;
    var bars = barsFor(state.tf);
    if (!bars.length) return;
    var key = bars.length + ':' + bars[bars.length - 1].time + ':' + bars[bars.length - 1].close;
    if (key === state.lastKey) return;
    if (state._bars.length && bars[bars.length - 1].time === state._bars[state._bars.length - 1].time &&
        bars.length === state._bars.length) {
      computeOverlays(bars);
      state._bars = bars;
      var last = bars[bars.length - 1];
      try {
        state.candles.update(last);
        OVERLAY_KEYS.forEach(function (k) {
          if (Number.isFinite(last[k])) { try { state.overlays[k].update({ time: last.time, value: last[k] }); } catch (e) { } }
        });
      } catch (e) { feed(); }
      state.lastKey = key;
      return;
    }
    feed();
  }

  // ---- drawing interaction --------------------------------------------------------------
  // Exact click coordinates via the candle SERIES API (verified v5.2.1):
  //   series.coordinateToPrice(y)  -> price   (round-trips exactly)
  //   chart.timeScale().coordinateToTime(x) -> {from,to} of the bar under x (or null)
  function screenToTP(x, y) {
    var t = null, p = null;
    try {
      var coord = state.chart.timeScale().coordinateToTime(x);
      // v5.2.1 returns a UTC number; tolerate {from,to} if a future build changes it
      t = (typeof coord === 'number') ? coord : (coord ? (coord.from != null ? coord.from : coord.to) : null);
    } catch (e) { }
    try {
      var cp = state.candles.coordinateToPrice(y);
      p = (cp != null && isFinite(cp)) ? cp : null;
    } catch (e) { }
    // snap time to the nearest real bar (the chart may be zoomed past the data)
    if (t != null && state._bars.length) {
      var best = state._bars[0].time, bd = Infinity;
      for (var i = 0; i < state._bars.length; i++) {
        var d = Math.abs(state._bars[i].time - t);
        if (d < bd) { bd = d; best = state._bars[i].time; }
      }
      t = best;
    }
    return { t: t, p: p };
  }
  function bindPointer() {
    // LWC's own chart mouse handlers stopPropagation on click, so a listener on
    // the container never fires. Use the DOCUMENT in capture phase and filter to
    // clicks that land inside this chart's canvas.
    if (window.__fvBound) return;
    window.__fvBound = true;
    document.addEventListener('click', function (ev) {
      if (!state.tool || !state.container) return;
      var el = ev.target;
      if (!el || !/CANVAS/i.test(el.tagName)) return;
      var host = state.container;
      var node = el;
      while (node && node !== host) node = node.parentElement;
      if (node !== host) return; // canvas of a different chart (e.g. BBMA tab)
      var rect = host.getBoundingClientRect();
      handleToolClick(ev.clientX - rect.left, ev.clientY - rect.top, ev);
    }, true);
    document.addEventListener('dblclick', function (ev) {
      if (!state.container) return;
      var el = ev.target;
      if (!el || !/CANVAS/i.test(el.tagName)) return;
      var node = el;
      while (node && node !== state.container) node = node.parentElement;
      if (node !== state.container) return;
      var rect = state.container.getBoundingClientRect();
      deleteNearest(ev.clientX - rect.left, ev.clientY - rect.top);
    }, true);
  }
  function handleToolClick(x, y, ev) {
    if (!state.tool || !state.chart) return;
    var pt = screenToTP(x, y);
    if (pt.t == null || pt.p == null) { flashHint('click on a candle area to place'); return; }
    var color = { trend: COLORS.trend, hline: COLORS.hline, rect: COLORS.rect, text: COLORS.text }[state.tool];
    var list = state.drawings[state.tf] || (state.drawings[state.tf] = []);
    if (state.tool === 'hline') {
      list.push({ type: 'hline', p1: +pt.p.toFixed(2), color: color });
      state.tool = null; updateToolbar();
    } else if (state.tool === 'text') {
      // non-blocking: place with a default label (no prompt, which blocks
      // headless/automated contexts and mobile keyboards are awkward here).
      var n = 0;
      for (var k = 0; k < list.length; k++) if (list[k].type === 'text') n++;
      list.push({ type: 'text', t1: pt.t, p1: +pt.p.toFixed(2), text: 'note ' + (n + 1), color: color });
      state.tool = null; updateToolbar();
      flashHint('text placed — double-click deletes it');
    } else {
      if (!state.pending) {
        state.pending = { t1: pt.t, p1: +pt.p.toFixed(2) };
        flashHint('click again for point 2 (Esc cancels)');
      } else {
        state.pending.t2 = pt.t; state.pending.p2 = +pt.p.toFixed(2);
        state.pending.type = state.tool; state.pending.color = color;
        list.push(state.pending);
        state.pending = null; state.tool = null; updateToolbar();
      }
    }
    saveDrawings(); refreshAnno();
  }
  function deleteNearest(x, y) {
    var list = state.drawings[state.tf];
    if (!list || !list.length || !state.chart) return;
    var ts = state.chart.timeScale();
    var best = -1, bestD = 24; // 24px pick radius
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.type === 'hline') {
        var yh = null;
        try { yh = state.candles.priceToCoordinate(s.p1); } catch (e) { }
        if (yh == null) continue;
        var dH = Math.abs(yh - y);
        if (dH < bestD) { bestD = dH; best = i; }
      } else {
        var cx = ts.timeToCoordinate(s.t1);
        var cy = null;
        try { cy = state.candles.priceToCoordinate(s.p1); } catch (e) { }
        if (cx == null || cy == null) continue;
        var d = Math.hypot(cx - x, cy - y);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) { list.splice(best, 1); saveDrawings(); refreshAnno(); }
  }
  function flashHint(msg) {
    var el = document.getElementById('fv-hint');
    if (el) { el.textContent = msg; }
  }
  function cancelPending() { state.pending = null; state.tool = null; updateToolbar(); }

  // ---- fullscreen ------------------------------------------------------------
  // The whole Charts card (toolbar + chart + foot) is the fullscreen target so
  // the user keeps their TF/indicator/drawing controls. Esc exits (native
  // fullscreenchange). Fallback: if the Fullscreen API is unavailable (some
  // mobile webviews), we use a fixed-position CSS overlay instead.
  function fvTarget() {
    var c = state.container;
    var sec = c && c.closest('[data-sec]');
    return sec || c;
  }
  function fsSupported() {
    return !!(document.documentElement.requestFullscreen || document.webkitRequestFullscreen ||
      document.mozRequestFullScreen || document.msRequestFullscreen);
  }
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement; }
  function enterFullscreen() {
    var t = fvTarget();
    if (!t) return;
    // CSS overlay is the primary, deterministic mechanism (works in webviews +
    // headless); native Fullscreen is a bonus on top for true-screen behaviour.
    t.classList.add('fv-fullscreen');
    state.fullscreen = true;
    try { document.body.style.overflow = 'hidden'; } catch (e) { }
    // In fullscreen the compact floating top bar owns the controls; hide the card's own rows.
    var tbar = document.getElementById('fv-toolbar');
    if (tbar) tbar.classList.add('fv-card-hidden');
    if (fsSupported()) {
      var req = t.requestFullscreen || t.webkitRequestFullscreen || t.mozRequestFullScreen || t.msRequestFullscreen;
      try {
        var p = req.call(t);
        if (p && typeof p.then === 'function') p.catch(function () { /* CSS overlay already active */ });
      } catch (e) { /* CSS overlay already active */ }
    }
    updateToolbar();
    setTimeout(function () { try { state.chart && state.chart.timeScale().fitContent(); } catch (e) { } }, 80);
  }
  function exitFullscreen() {
    var t = fvTarget();
    if (t) t.classList.remove('fv-fullscreen');
    state.fullscreen = false;
    try { document.body.style.overflow = ''; } catch (e) { }
    var tbar = document.getElementById('fv-toolbar');
    if (tbar) tbar.classList.remove('fv-card-hidden');
    if (fsEl()) {
      var ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      try { ex.call(document); } catch (e) { }
    }
    updateToolbar();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  function onFsChange() {
    // Native fullscreen exited (Esc / hardware) while the CSS overlay is still
    // up -> clear it too so the view returns to the card.
    if (!fsEl() && state.fullscreen) {
      var t = fvTarget();
      if (t) t.classList.remove('fv-fullscreen');
      var tbar = document.getElementById('fv-toolbar');
      if (tbar) tbar.classList.remove('fv-card-hidden');
      try { document.body.style.overflow = ''; } catch (e) { }
      state.fullscreen = false;
    }
    updateToolbar();
    setTimeout(function () { try { state.chart && state.chart.timeScale().fitContent(); } catch (e) { } }, 60);
  }
  function toggleFullscreen() {
    if (state.fullscreen || fsEl()) exitFullscreen();
    else enterFullscreen();
  }

  // ---- toolbar ---------------------------------------------------------------------------
  // Compact layout: everything routes through dropdowns.
  //   [TF select] [Preset select] [Ind N ▾] [Draw ▾] [⛶]
  // "Ind N" opens a checkbox panel — every indicator toggles on/off individually;
  // any individual change flips the preset select to Custom. "Draw" lists the
  // drawing tools. In fullscreen the same controls move to a floating top bar.
  var IND_DEFS = [['bb', 'BB(20,2)'], ['lwma', 'LWMA H/L 5/10'], ['ema50', 'EMA50'], ['ema200', 'EMA200'], ['sma20', 'SMA20'], ['vwap', 'VWAP'], ['rsi', 'RSI14'], ['macd', 'MACD'], ['sd', 'S/D zones'], ['smc', 'SMC'], ['ew', 'Elliott Wave']];
  var DRAW_DEFS = [['trend', 'Trendline'], ['hline', 'Horizontal line'], ['rect', 'Rectangle'], ['text', 'Text']];

  function onIndToggle(key) {
    state.ind[key] = !state.ind[key];
    state.template = ''; // a manual toggle overrides the active preset
    buildToolbar();
    if (key === 'sd' || key === 'smc' || key === 'ew' || key === 'rsi' || key === 'macd') feed();
    else applyOverlays();
  }
  function onToolSelect(tool) {
    if (tool === 'clear') {
      state.drawings[state.tf] = [];
      saveDrawings(); refreshAnno();
      flashHint('drawings cleared for ' + state.tf);
      state.tool = null;
    } else {
      cancelPending();
      state.tool = (state.tool === tool) ? null : tool;
      flashHint(state.tool ? 'draw ' + (DRAW_DEFS.filter(function (d) { return d[0] === state.tool; })[0] || [state.tool])[1].toLowerCase() + (state.tool === 'trend' || state.tool === 'rect' ? ' (2 clicks)' : '') + ' · double-click deletes' : 'draw off');
    }
    buildToolbar();
  }
  function makeTFSelect(idPrefix) {
    var sel = document.createElement('select');
    sel.className = 'fv-sel';
    sel.id = (idPrefix || '') + 'fv-tf';
    TF_LIST.forEach(function (tf) {
      var o = document.createElement('option');
      o.value = tf; o.textContent = tf;
      sel.appendChild(o);
    });
    sel.value = state.tf;
    sel.addEventListener('change', function () {
      if (state.tf === sel.value) return;
      cancelPending(); state.tf = sel.value;
      buildToolbar(); feed();
    });
    return sel;
  }
  function makePresetSelect(idPrefix) {
    var sel = document.createElement('select');
    sel.className = 'fv-sel';
    sel.id = (idPrefix || 'card-') + 'fv-ind-tpl';
    Object.keys(TEMPLATES).forEach(function (name) {
      var o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });
    if (state.template === '') {
      var o = document.createElement('option');
      o.value = ''; o.textContent = 'Custom (current)';
      sel.appendChild(o);
    }
    sel.value = state.template;
    sel.addEventListener('change', function () {
      state.template = sel.value;
      if (state.template === '') return; // Custom: keep the current manual set
      state.ind = { bb: false, lwma: false, ema50: false, sd: false, vwap: false, ema200: false, sma20: false, rsi: false, macd: false, smc: false, ew: false };
      Object.keys(TEMPLATES[state.template]).forEach(function (k) { state.ind[k] = TEMPLATES[state.template][k]; });
      buildToolbar();
      flashHint('template ' + state.template + ' applied');
      feed();
    });
    return sel;
  }
  function makeIndButton() {
    var b = document.createElement('button');
    var nOn = Object.keys(state.ind).filter(function (k) { return state.ind[k]; }).length;
    b.textContent = 'Ind ' + nOn + (state.indPanel ? ' ▲' : ' ▾');
    b.className = 'fv-btn ind' + (state.indPanel ? ' on' : '');
    b.dataset.indpanel = '1';
    b.title = 'Individual indicator on/off';
    b.addEventListener('click', function () {
      state.indPanel = !state.indPanel;
      buildToolbar();
    });
    return b;
  }
  function makeIndPanel() {
    var wrap = document.createElement('div');
    wrap.className = 'fv-panel';
    wrap.id = 'fv-ind-panel';
    var hd = document.createElement('div');
    hd.className = 'fv-panel-hd';
    hd.textContent = 'Indicators — tap to switch on/off';
    wrap.appendChild(hd);
    IND_DEFS.forEach(function (kv) {
      var row = document.createElement('label');
      row.className = 'fv-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!state.ind[kv[0]];
      cb.addEventListener('change', function () { onIndToggle(kv[0]); });
      var sp = document.createElement('span');
      sp.textContent = kv[1];
      row.appendChild(cb);
      row.appendChild(sp);
      wrap.appendChild(row);
    });
    return wrap;
  }
  function makeDrawButton() {
    var b = document.createElement('button');
    b.textContent = 'Draw' + (state.tool ? ' · ' + state.tool : '');
    b.className = 'fv-btn tool' + (state.tool ? ' on' : '');
    b.dataset.drawbtn = '1';
    b.title = 'Drawing tools';
    b.addEventListener('click', function () {
      state.drawPanel = !state.drawPanel;
      buildToolbar();
    });
    return b;
  }
  function makeDrawPanel() {
    var wrap = document.createElement('div');
    wrap.className = 'fv-panel';
    wrap.id = 'fv-draw-panel';
    var hd = document.createElement('div');
    hd.className = 'fv-panel-hd';
    hd.textContent = 'Draw on the chart (tap, then click the chart)';
    wrap.appendChild(hd);
    [['off', 'Draw off (no tool)']].concat(DRAW_DEFS).forEach(function (kv) {
      var row = document.createElement('label');
      row.className = 'fv-check';
      var rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'fv-draw';
      rb.checked = (kv[0] === 'off') ? !state.tool : state.tool === kv[0];
      var sp = document.createElement('span');
      sp.textContent = kv[1] + (kv[0] === 'trend' || kv[0] === 'rect' ? ' (2 clicks)' : '');
      rb.addEventListener('change', function () { onToolSelect(kv[0] === 'off' ? null : kv[0]); });
      row.appendChild(rb);
      row.appendChild(sp);
      wrap.appendChild(row);
    });
    var cl = document.createElement('button');
    cl.className = 'fv-btn danger';
    cl.textContent = 'Clear all drawings (' + (state.drawings[state.tf] ? state.drawings[state.tf].length : 0) + ')';
    cl.addEventListener('click', function () { onToolSelect('clear'); });
    wrap.appendChild(cl);
    var note = document.createElement('div');
    note.className = 'fv-panel-note';
    note.textContent = 'Double-click an object on the chart to delete it.';
    wrap.appendChild(note);
    return wrap;
  }
  function makeFsButton() {
    var b = document.createElement('button');
    b.textContent = '⛶';
    b.className = 'fv-btn tool fs' + ((state.fullscreen || fsEl()) ? ' on' : '');
    b.dataset.fs = '1';
    b.title = 'Fullscreen chart';
    b.addEventListener('click', function () { toggleFullscreen(); });
    return b;
  }
  function buildToolbar() {
    var bar = document.getElementById('fv-toolbar');
    if (!bar) return;
    bar.innerHTML = '';
    var row1 = document.createElement('div');
    row1.className = 'fv-row';
    row1.appendChild(makeTFSelect('card-'));
    row1.appendChild(makePresetSelect('card-'));
    row1.appendChild(makeIndButton());
    row1.appendChild(makeDrawButton());
    row1.appendChild(makeFsButton());
    bar.appendChild(row1);
    if (state.indPanel) bar.appendChild(makeIndPanel());
    if (state.drawPanel) bar.appendChild(makeDrawPanel());
    // Floating fullscreen control bar (reuses the same controls)
    var fsbar = document.getElementById('fv-fs-bar');
    if (fsbar) {
      fsbar.innerHTML = '';
      var frow = document.createElement('div');
      frow.className = 'fv-row';
      frow.appendChild(makeTFSelect('fs-'));
      frow.appendChild(makePresetSelect('fs-'));
      frow.appendChild(makeIndButton());
      frow.appendChild(makeDrawButton());
      var exitB = document.createElement('button');
      exitB.textContent = '✕ Close';
      exitB.className = 'fv-btn tool fs';
      exitB.addEventListener('click', function () { exitFullscreen(); });
      frow.appendChild(exitB);
      fsbar.appendChild(frow);
      if (state.indPanel) fsbar.appendChild(makeIndPanel());
      if (state.drawPanel) fsbar.appendChild(makeDrawPanel());
    }
    updateToolbar();
  }
  function updateToolbar() {
    // Selects keep their value; only the count label + open-state need refresh.
    var bar = document.getElementById('fv-toolbar');
    if (bar) {
      var indBtnEl = bar.querySelector('[data-indpanel]');
      if (indBtnEl) {
        var nOn = Object.keys(state.ind).filter(function (k) { return state.ind[k]; }).length;
        indBtnEl.textContent = 'Ind ' + nOn + (state.indPanel ? ' ▲' : ' ▾');
        indBtnEl.className = 'fv-btn ind' + (state.indPanel ? ' on' : '');
      }
      var drawBtnEl = bar.querySelector('[data-drawbtn]');
      if (drawBtnEl) {
        drawBtnEl.textContent = 'Draw' + (state.tool ? ' · ' + state.tool : '');
        drawBtnEl.className = 'fv-btn tool' + (state.tool ? ' on' : '');
      }
      var fsb = bar.querySelector('[data-fs]');
      if (fsb) fsb.className = 'fv-btn tool fs' + ((state.fullscreen || fsEl()) ? ' on' : '');
    }
    var fsbar = document.getElementById('fv-fs-bar');
    if (fsbar) {
      var fsb2 = fsbar.querySelector('[data-fs]');
      if (fsb2) fsb2.className = 'fv-btn tool fs' + ((state.fullscreen || fsEl()) ? ' on' : '');
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (state.pending || state.tool)) cancelPending();
  });

  // ---- public API + boot ------------------------------------------------------------------
  function render() {
    state.container = document.getElementById('fv-chart');
    if (!state.container) return;
    var sec = state.container.closest('[data-sec]');
    if (sec && (sec.classList.contains('hidden') || sec.style.display === 'none')) return;
    if (!state.container.clientWidth) return; // still hidden
    buildToolbar();
    feed();
  }

  window.BBMAFullView = { render: render, get tf() { return state.tf; } };

  function boot() {
    loadDrawings();
    render();
    window.addEventListener('bbma-runtime-updated', onRuntimeUpdated);
    window.addEventListener('xau-route-changed', function (e) {
      var r = e.detail && e.detail.route;
      if (r === 'charts') setTimeout(render, 60);
    });
    // hash deep-link (worker served as #bbma/#charts)
    try {
      if (window.location.hash === '#charts') setTimeout(function () {
        var btn = document.querySelector('[data-filter="charts"]');
        if (btn) btn.click();
      }, 200);
    } catch (e) { }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
