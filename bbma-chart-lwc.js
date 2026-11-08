/* BBMA dashboard chart — lightweight-charts v5.2.1 (native pinch-zoom/pan, live update).
 *
 * Replaces the hand-rolled 720x180 SVG with a real TradingView lightweight-charts
 * canvas. The chart is created ONCE per container and reused across renders/TF
 * switches; per-tick it calls series.update() (in-place, no range snap) so the
 * live bar advances smoothly. Fail-closed: if lightweight-charts failed to load
 * (offline / CDN 5xx) the legacy inline SVG is rendered instead, so the dashboard
 * never goes blank.
 *
 * Vendor: ./vendor/lightweight-charts.standalone.production.js (sha256
 * e21cc5caa0226ef30bd8549c50b9ef926615f2a4ee6b4e486353477a55f598cf, v5.2.1).
 * Attribution: Apache-2.0 + attribution requirement satisfied via
 * layout.attributionLogo (the TradingView badge renders on the chart).
 */
(function () {
  'use strict';
  var COLORS = {
    up: '#31df8b', down: '#ff596d',
    bbUpper: '#28a9ff', bbLower: '#28a9ff', bbMiddle: '#ffc928', ema50: '#c05cff',
    bg: '#071522', text: '#8da9bd', grid: '#0d2438',
  };
  var OVERLAYS = [
    { key: 'bbUpper', color: COLORS.bbUpper },
    { key: 'bbMiddle', color: COLORS.bbMiddle },
    { key: 'bbLower', color: COLORS.bbLower },
    { key: 'ema50', color: COLORS.ema50 },
  ];

  function lwc() { return window.LightweightCharts || null; }

  // Runtime candle -> LWC bar (time is UTCTimestamp SECONDS; strictly ascending).
  function toBar(c) {
    var t = c.time;
    var ms = (typeof t === 'number') ? t : Date.parse(t);
    if (!Number.isFinite(ms)) return null;
    var sec = Math.floor(ms / 1000);
    var o = +c.open, h = +c.high, l = +c.low, cl = +c.close;
    if (![o, h, l, cl].every(Number.isFinite)) return null;
    return { time: sec, open: o, high: h, low: l, close: cl };
  }
  function toPoints(bars, key) {
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var raw = bars[i];
      if (raw && Number.isFinite(+raw[key])) out.push({ time: bars[i]._sec, value: +raw[key] });
    }
    return out;
  }
  // BB(20,2) + EMA50 per bar — same math as the canonical bbma-runtime engine
  // (population std dev over last 20 closes for the bands; SMA20 mid; EMA50).
  // Runtime candles don't carry these fields, so the chart computes them here
  // to render the overlays (the old SVG had the same latent gap).
  function sma(arr, n, i) { if (i + 1 < n) return null; var s = 0; for (var j = i + 1 - n; j <= i; j++) s += arr[j]; return s / n; }
  function popStd(arr, n, i) {
    if (i + 1 < n) return null;
    var m = 0; for (var j = i + 1 - n; j <= i; j++) m += arr[j]; m /= n;
    var sq = 0; for (var k = i + 1 - n; k <= i; k++) sq += Math.pow(arr[k] - m, 2);
    return Math.sqrt(sq / n);
  }
  function emaAt(arr, n, i) {
    if (i + 1 < n) return null;
    var k = 2 / (n + 1), e = 0;
    for (var j = 0; j < i + 1; j++) { if (j === 0) e = arr[j]; else e = arr[j] * k + e * (1 - k); }
    return e;
  }
  function computeBands(bars) {
    var closes = bars.map(function (b) { return b.close; });
    for (var i = 0; i < bars.length; i++) {
      var m = sma(closes, 20, i), sd = popStd(closes, 20, i), e50 = emaAt(closes, 50, i);
      if (m != null && sd != null) { bars[i].bbUpper = +(m + 2 * sd).toFixed(2); bars[i].bbMiddle = +m.toFixed(2); bars[i].bbLower = +(m - 2 * sd).toFixed(2); }
      if (e50 != null) bars[i].ema50 = +e50.toFixed(2);
    }
  }

  var state = { chart: null, candles: null, overlays: {}, markers: null, container: null, tf: null, bars: [] };

  function teardown() {
    if (state.ro) { try { state.ro.disconnect(); } catch (e) { /* ignore */ } state.ro = null; }
    if (state.chart && state.container) {
      // remove() is irreversible; clear the container so a fresh instance can be created.
      try { state.chart.remove(); } catch (e) { /* ignore */ }
    }
    state.chart = state.candles = null; state.overlays = {}; state.markers = null; state.fitted = false;
    if (state.container) { state.container.innerHTML = ''; }
  }

  function ensureChart(container) {
    var L = lwc();
    if (!L) return null;
    if (state.chart && state.container === container) return state.chart;
    if (state.chart) teardown();
    state.container = container;
    container.innerHTML = '';
    try {
      state.chart = L.createChart(container, {
        autoSize: true,
        layout: { background: { color: COLORS.bg }, textColor: COLORS.text, attributionLogo: true, fontSize: 10 },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2, barSpacing: 7, minBarSpacing: 0.2, maxBarSpacing: 40 },
        rightPriceScale: { borderColor: COLORS.grid },
        crosshair: { mode: 1 }, // Magnet — snaps to OHLC for FX precision
        handleScroll: true,    // wheel/drag zoom+pan
        handleScale: true,     // pinch / ctrl-wheel zoom (the "like tradingview" behaviour)
      });
    } catch (e) {
      console.warn('[BBMA] lightweight-charts createChart failed; falling back to SVG', e);
      state.chart = null;
      return null;
    }
    state.candles = state.chart.addSeries(L.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down,
      borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
      priceScaleId: 'right', priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    OVERLAYS.forEach(function (o) {
      state.overlays[o.key] = state.chart.addSeries(L.LineSeries, {
        color: o.color, lineWidth: 1, priceScaleId: 'right',
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    });
    try { state.markers = L.createSeriesMarkers(state.candles, []); } catch (e) { state.markers = null; }
    // The dashboard renders on init while the BBMA section is hidden (width 0),
    // so fitContent() computes spacing from an empty container and the view
    // stays collapsed until the section is shown. Re-fit when the container
    // first gets a real size (autoSize / tab switch).
    state.fitted = false;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        state.ro = new ResizeObserver(function () {
          if (state.fitted) return;
          if (state.chart && state.bars.length && container.clientWidth > 0 && container.clientHeight > 0) {
            try { state.chart.timeScale().fitContent(); state.fitted = true; } catch (e) { /* ignore */ }
          }
        });
        state.ro.observe(container);
      } catch (e) { /* ignore */ }
    }
    return state.chart;
  }

  function feedData(container, rawCandles) {
    // Build LWC bars + overlay points.
    var bars = [];
    for (var i = 0; i < rawCandles.length; i++) {
      var b = toBar(rawCandles[i]);
      if (b) { b._sec = b.time; b._raw = rawCandles[i]; bars.push(b); }
    }
    if (!bars.length) return false;
    state.bars = bars;
    computeBands(bars); // populate bbUpper/bbMiddle/bbLower/ema50 (runtime candles don't carry them)
    state.candles.setData(bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    OVERLAYS.forEach(function (o) {
      var pts = toPoints(bars, o.key);
      state.overlays[o.key].setData(pts);
    });
    // Show all bars (fit); the user pinches/drags to zoom. A fixed right-offset
    // window overshoots past the last bar and collapses the visible range.
    try { state.chart.timeScale().fitContent(); } catch (e) { /* ignore */ }
    return true;
  }
  // Live path: advance the last bar in place (no visible-range reset).
  function updateLive(rawLast) {
    if (!state.chart || !state.bars.length) return;
    var b = toBar(rawLast);
    if (!b) return;
    var last = state.bars[state.bars.length - 1];
    try { state.candles.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }); } catch (e) { return; }
    // Refresh overlay last points (cheap).
    OVERLAYS.forEach(function (o) {
      if (rawLast && Number.isFinite(+rawLast[o.key])) {
        try { state.overlays[o.key].update({ time: b.time, value: +rawLast[o.key] }); } catch (e) { /* ignore */ }
      }
    });
    if (b.time > last.time) { state.bars.push(b); } else { state.bars[state.bars.length - 1] = b; }
  }

  /* Public: render a fresh dataset (TF switch / new data). Keeps one chart instance. */
  window.BBMAChart = {
    render: function (container, rawCandles) {
      if (!container) return false;
      if (!rawCandles || !rawCandles.length) {
        if (state.chart) teardown();
        container.innerHTML = '<div class="bbx-empty" style="padding:14px">BBMA_CHART_NO_DATA · waiting for validated OHLC</div>';
        return false;
      }
      var ok = ensureChart(container);
      if (!ok) return false; // caller falls back to legacy SVG
      return feedData(container, rawCandles);
    },
    updateLive: updateLive,
    hasLwc: function () { return !!lwc(); },
    teardown: teardown,
  };
})();
