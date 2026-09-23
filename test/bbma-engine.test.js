'use strict';
const assert=require('assert'),B=require('../lib/bbma-engine');
function candles(n=80,step=1){return Array.from({length:n},(_,i)=>{const p=100+i*step;return {time:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),open:p-.2,high:p+.5,low:p-.5,close:p};});}
const up=candles();
const down=candles(80,-.5);
const v=B.values(up);assert(v&&v.bb&&Number.isFinite(v.ema50));assert(Number.isFinite(v.ma5High));assert(Number.isFinite(v.ma10Low));
const c=B.classify(up);assert.equal(c.state,'READY');assert.equal(c.trend,'UP');
const all={MN1:up,W1:up,D1:up,H4:up,H1:up,M30:up,M15:up,M5:up};
const m=B.mtf(all);assert.equal(m.alignment,'UP_ALIGNED');assert(m.frames.M30);assert(m.frames.MN1);assert(m.frames.W1);
assert.equal(m.roles.MN1,'MACRO_STRUCTURE');assert.equal(m.roles.W1,'WEEKLY_STRUCTURE');assert.equal(m.roles.M30,'REACTION_STRUCTURE');assert.equal(m.roles.M5,'CONFIRMATION');
const mixed=B.mtf({...all,H4:down,H1:down,M30:down,M15:down,M5:down});assert.equal(mixed.alignment,'MIXED');assert.equal(mixed.structural.MN1,'UP');assert.equal(mixed.structural.W1,'UP');assert.equal(mixed.execution.M5,'DOWN');
assert.equal(B.classify(candles(20)).state,'INSUFFICIENT_DATA');
console.log('bbma engine tests passed');
