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
    supply: '#ff596d', demand: '#31df8b',
    trend: '#ffd166', hline: '#7aa2ff', rect: '#4cc9f0', text: '#f4f4f4'
  };
  var SD_PARAMS = { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 };
  var STORE_KEY = 'xaudesk-fullview-v1';

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
  function computeOverlays(bars) {
    var closes = bars.map(function (b) { return b.close; });
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
    }
  }

  // ---- state ------------------------------------------------------------------
  var state = {
    container: null, chart: null, candles: null, overlays: {},
    zoneSeries: null, annoSeries: null,
    tf: 'H1', tool: null, pending: null,
    ind: { bb: true, ema50: true, sd: true },
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
    if (L.addCustomSeries) {
      state.zoneSeries = state.chart.addCustomSeries(makeZoneView(), { priceScaleId: 'right' });
      state.annoSeries = state.chart.addCustomSeries(makeAnnoView(), { priceScaleId: 'right' });
    }
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
    setOverlayPts('bbUpper'); setOverlayPts('bbMiddle'); setOverlayPts('bbLower'); setOverlayPts('ema50');
    state._zones = state.ind.sd ? sdZones(bars) : [];
    zoneState.zones = state._zones;
    if (state.zoneSeries) {
      try { state.zoneSeries.setData(state._zones.map(function (z) { return { time: Math.round(z.formTime / 1000), zone: z }; })); } catch (e) { }
    }
    refreshAnno();
    updateZoneCount();
    try { state.chart.timeScale().fitContent(); } catch (e) { }
    state.lastKey = bars.length + ':' + bars[bars.length - 1].time + ':' + bars[bars.length - 1].close;
  }
  function setOverlayPts(key) {
    if (!state.overlays[key]) return;
    var on = key === 'ema50' ? state.ind.ema50 : state.ind.bb;
    try {
      state.overlays[key].applyOptions({ visible: !!on });
      if (on) {
        var pts = state._bars.filter(function (b) { return Number.isFinite(b[key]); })
          .map(function (b) { return { time: b.time, value: b[key] }; });
        state.overlays[key].setData(pts);
      }
    } catch (e) { }
  }
  function updateZoneCount() {
    var el = document.getElementById('fv-zone-count');
    if (!el || !state._zones) return;
    var s = 0, d = 0;
    state._zones.forEach(function (z) { if (z.kind === 'SUPPLY') s++; else d++; });
    el.textContent = 'S/D: ' + s + ' supply · ' + d + ' demand (unmitigated)';
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
        ['bbUpper', 'bbMiddle', 'bbLower', 'ema50'].forEach(function (k) {
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
      t = coord ? coord.from : null;
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
    var host = state.container;
    if (!host || host.__fvBound) return;
    host.__fvBound = true;
    host.addEventListener('click', function (ev) {
      if (!state.tool) return;
      if (ev.target && /CANVAS/i.test(ev.target.tagName)) {
        var rect = host.getBoundingClientRect();
        handleToolClick(ev.clientX - rect.left, ev.clientY - rect.top, ev);
      }
    });
    host.addEventListener('dblclick', function (ev) {
      var rect = host.getBoundingClientRect();
      deleteNearest(ev.clientX - rect.left, ev.clientY - rect.top);
    });
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
      var txt = 'note';
      try { var g = window.prompt('Label text:', txt); if (g != null && g.trim()) txt = g.trim().slice(0, 40); } catch (e) { }
      list.push({ type: 'text', t1: pt.t, p1: +pt.p.toFixed(2), text: txt, color: color });
      state.tool = null; updateToolbar();
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

  // ---- toolbar ---------------------------------------------------------------------------
  function buildToolbar() {
    var bar = document.getElementById('fv-toolbar');
    if (!bar) return;
    bar.innerHTML = '';
    var tfWrap = document.createElement('div');
    tfWrap.className = 'fv-row';
    TF_LIST.forEach(function (tf) {
      var b = document.createElement('button');
      b.textContent = tf;
      b.className = 'fv-btn' + (tf === state.tf ? ' on' : '');
      b.dataset.tf = tf;
      b.addEventListener('click', function () {
        if (state.tf === tf) return;
        cancelPending(); state.tf = tf; buildToolbar(); feed();
      });
      tfWrap.appendChild(b);
    });
    bar.appendChild(tfWrap);

    var indWrap = document.createElement('div');
    indWrap.className = 'fv-row';
    [['bb', 'BB(20,2)'], ['ema50', 'EMA50'], ['sd', 'S/D zones']].forEach(function (kv) {
      var b = document.createElement('button');
      b.textContent = kv[1];
      b.className = 'fv-btn' + (state.ind[kv[0]] ? ' on' : '');
      b.dataset.ind = kv[0];
      b.addEventListener('click', function () {
        state.ind[kv[0]] = !state.ind[kv[0]];
        b.className = 'fv-btn' + (state.ind[kv[0]] ? ' on' : '');
        if (kv[0] === 'sd') feed();
        else { setOverlayPts('bbUpper'); setOverlayPts('bbMiddle'); setOverlayPts('bbLower'); setOverlayPts('ema50'); }
      });
      indWrap.appendChild(b);
    });
    bar.appendChild(indWrap);

    var toolWrap = document.createElement('div');
    toolWrap.className = 'fv-row';
    [['trend', 'Trend'], ['hline', 'H-Line'], ['rect', 'Rect'], ['text', 'Text'], ['clear', 'Clear']].forEach(function (kv) {
      var b = document.createElement('button');
      b.textContent = kv[1];
      b.className = 'fv-btn tool' + (state.tool === kv[0] ? ' on' : '');
      b.dataset.tool = kv[0];
      b.addEventListener('click', function () {
        if (kv[0] === 'clear') {
          state.drawings[state.tf] = [];
          saveDrawings(); refreshAnno();
          flashHint('drawings cleared for ' + state.tf);
          return;
        }
        cancelPending();
        state.tool = (state.tool === kv[0]) ? null : kv[0];
        updateToolbar();
        flashHint(state.tool ? 'click the chart to draw ' + kv[1].toLowerCase() + ((state.tool === 'trend' || state.tool === 'rect') ? ' (2 clicks)' : '') + ' · double-click deletes' : 'draw off');
      });
      toolWrap.appendChild(b);
    });
    bar.appendChild(toolWrap);
    updateToolbar();
  }
  function updateToolbar() {
    var bar = document.getElementById('fv-toolbar');
    if (!bar) return;
    bar.querySelectorAll('[data-tf]').forEach(function (b) { b.className = 'fv-btn' + (b.dataset.tf === state.tf ? ' on' : ''); });
    bar.querySelectorAll('[data-tool]').forEach(function (b) { b.className = 'fv-btn tool' + (b.dataset.tool === state.tool ? ' on' : ''); });
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
