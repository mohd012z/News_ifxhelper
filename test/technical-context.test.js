'use strict';
const assert=require('assert'), T=require('../lib/technical-context');
const base=Date.parse('2026-09-23T00:00:00Z');
const candles=Array.from({length:20},(_,i)=>({time:new Date(base+i*300000).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i}));
assert(T.atr(candles,14)>0);
assert.equal(T.structure(candles).state,'BULLISH');
assert.equal(T.alignTime('2026-09-23T01:36:00Z',candles,10).state,'ALIGNED');
assert.equal(T.context('M5',candles,'2026-09-23T01:36:00Z').timeframe,'M5');
console.log('technical-context tests passed');
