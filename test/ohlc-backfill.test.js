'use strict';
const assert=require('assert'),V=require('../lib/ohlc-validator'),B=require('../lib/ohlc-backfill');
const now=new Date('2026-09-23T02:00:00Z').getTime();
const rows=[{time:'2026-09-23T01:30:00Z',open:100,high:102,low:99,close:101},{time:'2026-09-23T01:31:00Z',open:101,high:103,low:100,close:102},{time:'2026-09-23T01:32:00Z',open:102,high:104,low:101,close:103}];
assert(V.validateSeries(rows,{timeframeMinutes:1,now}).valid);
let x=B.select(rows,'2026-09-23T01:31:00Z',{timeframeMinutes:1,now});assert.equal(x.quality,'EXACT');assert.equal(x.candle.close,102);
x=B.select(rows,'2026-09-23T01:30:30Z',{timeframeMinutes:1,maxLagMinutes:1,now});assert.equal(x.quality,'NEAR');assert.equal(x.candle.time,'2026-09-23T01:31:00.000Z');
const bad=V.validateCandle({time:'2026-09-23T01:30:00Z',open:105,high:102,low:99,close:101},{timeframeMinutes:1,now});assert.equal(bad.valid,false);
console.log('ohlc backfill tests passed');
