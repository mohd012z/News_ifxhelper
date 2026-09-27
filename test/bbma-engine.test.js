'use strict';
const assert=require('assert'),B=require('../lib/bbma-engine');
function candles(n=80,step=1){return Array.from({length:n},(_,i)=>{const p=100+i*step;return {time:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),open:p-.2,high:p+.5,low:p-.5,close:p};});}
const up=candles();
const v=B.values(up);assert(v&&v.bb&&Number.isFinite(v.ema50));assert(Number.isFinite(v.ma5High));assert(Number.isFinite(v.ma10Low));
const c=B.classify(up);assert.equal(c.state,'READY');assert.equal(c.trend,'UP');
const m=B.mtf({H1:up,M30:up,M15:up,M5:up});assert.equal(m.alignment,'UP_ALIGNED');assert(m.frames.M30);
assert.equal(B.classify(candles(20)).state,'INSUFFICIENT_DATA');
console.log('bbma engine tests passed');
