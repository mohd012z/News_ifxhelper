'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
['ohlc','candles','open','high','low','close','BBMA_CHART_NO_DATA','data-tf'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(!s.includes('Math.sin(i/3)'),'synthetic candle generator must be removed');
assert(s.includes('chart(x,tf)'),'chart must receive selected timeframe');
console.log('BBMA runtime OHLC chart contract passed');
