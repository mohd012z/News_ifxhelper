'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
const r=fs.readFileSync('bbma-runtime.js','utf8');
['ohlc','candles','open','high','low','close','BBMA_CHART_NO_DATA','data-tf'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(!s.includes('Math.sin(i/3)'),'synthetic candle generator must be removed');
assert(s.includes('chart(x,tf)'),'chart must receive selected timeframe');
// The SVG chart draws its band polylines from REAL per-candle fields.
['bbUpper','bbMiddle','bbLower','ema50'].forEach(x=>assert(s.includes(x),'chart band field missing: '+x));
// The runtime must NOT contain any synthetic-candle generator or hardcoded demo price.
assert(!r.includes('Math.sin'),'runtime must not contain synthetic candle math');
assert(!r.includes('2658'),'runtime must not contain the old hardcoded demo price');
assert(!r.includes('BASELINE_CACHE'),'runtime must not seed fabricated baseline candles');
assert(!/H4 MHV confirmed rejection/.test(r),'runtime must not contain hardcoded demo alerts');
console.log('BBMA runtime OHLC chart contract passed');
