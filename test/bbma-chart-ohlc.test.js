'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
const lwc=fs.readFileSync('bbma-chart-lwc.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const vendor=fs.readFileSync('vendor/lightweight-charts.standalone.production.js','utf8');

// --- dashboard contract (kept + extended) ---
['ohlc','candles','open','high','low','close','BBMA_CHART_NO_DATA','data-tf','renderChart(document.getElementById(\'bbma-chart\'),x,tf)','function chart(x,f)'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(!s.includes('Math.sin(i/3)'),'synthetic candle generator must be removed');
// legacy SVG stays as fail-closed fallback
assert(s.includes('<svg'),'legacy SVG fallback must remain for offline / CDN failure');

// --- lightweight-charts vendor + wiring ---
assert(vendor.includes('TradingView Lightweight Charts™ v5.2.1'),'vendored LWC must be v5.2.1');
assert(html.includes('./vendor/lightweight-charts.standalone.production.js'),'index.html must load the vendored LWC build');
assert(html.includes('./bbma-chart-lwc.js'),'index.html must load bbma-chart-lwc.js');
// script order: runtime -> vendor LWC -> chart bridge -> dashboard UI
const iRuntime=html.indexOf('./bbma-runtime.js'),iVendor=html.indexOf('./vendor/lightweight-charts.standalone.production.js'),iBridge=html.indexOf('./bbma-chart-lwc.js'),iUi=html.indexOf('./bbma-dashboard-ui.js');
assert(iRuntime>-1&&iVendor>iRuntime&&iBridge>iVendor&&iUi>iBridge,'script order wrong (need runtime -> vendor -> bridge -> ui): '+[iRuntime,iVendor,iBridge,iUi]);

// --- pinch-zoom / pan options (the "like tradingview" behaviour) ---
assert(lwc.includes('handleScale: true'),'LWC must enable pinch/ctrl-wheel zoom (handleScale)');
assert(lwc.includes('handleScroll: true'),'LWC must enable wheel/drag pan (handleScroll)');
assert(lwc.includes('minBarSpacing'),'LWC must set a zoom-in floor (minBarSpacing) for fast pinch');
assert(lwc.includes('maxBarSpacing'),'LWC must set a zoom-out cap (maxBarSpacing)');
// v5 API shape (not v4)
assert(lwc.includes('addSeries(L.CandlestickSeries'),'LWC must use v5 addSeries(CandlestickSeries)');
assert(!lwc.includes('addCandlestickSeries'),'v4 addCandlestickSeries must not be used');
assert(lwc.includes('/ 1000'),'timestamps must be converted ms->seconds');
// live path: update() in place (no per-tick setData -> no range snap)
assert(lwc.includes('candles.update'),'live bar must use series.update() in place');
assert(lwc.includes('attributionLogo: true'),'Apache-2.0 attribution badge must be on');
// fail-closed: hasLwc gate + SVG fallback in the dashboard
assert(s.includes('hasLwc'),'dashboard must gate on hasLwc() and fall back to SVG');

console.log('BBMA LWC pinch-zoom chart contract passed');
