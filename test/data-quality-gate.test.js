'use strict';
const assert=require('assert'),Q=require('../lib/data-quality-gate');
const candles=[
 {time:'2026-09-23T09:00:00Z',open:100,high:103,low:99,close:102},
 {time:'2026-09-23T09:05:00Z',open:102,high:104,low:101,close:103},
 {time:'2026-09-23T09:10:00Z',open:103,high:105,low:102,close:104}
];
let r=Q.validateCandles(candles,{timeframeMin:5});assert.equal(r.state,'PASS');
r=Q.validateCandles([...candles,candles[2]],{timeframeMin:5});assert.equal(r.state,'BLOCK');assert(r.issues.some(x=>x.code==='DUPLICATE_CANDLE'));
r=Q.validateCandles([candles[0],candles[2]],{timeframeMin:5});assert.equal(r.state,'BLOCK');assert(r.issues.some(x=>x.code==='MISSING_CANDLE'));
r=Q.validateCandles([candles[1],candles[0]],{timeframeMin:5});assert(r.issues.some(x=>x.code==='OUT_OF_ORDER'));
r=Q.validateCandles([{time:'2026-09-23T09:00:00Z',open:100,high:99,low:101,close:100}],{timeframeMin:5});assert(r.issues.some(x=>x.code==='INVALID_OHLC'));
const ev=Q.validateEvent({scheduledAt:'2026-09-23T10:00:00Z',sourceAt:'2026-09-23T09:59:00Z',previous:2,forecast:2.1,actual:2.3,revision:2.05},{now:'2026-09-23T10:01:00Z'});assert.equal(ev.state,'PASS');
const future=Q.validateEvent({scheduledAt:'2026-09-23T10:00:00Z',sourceAt:'2026-09-23T10:10:00Z',actual:2.3},{now:'2026-09-23T10:01:00Z'});assert.equal(future.state,'BLOCK');assert(future.issues.some(x=>x.code==='SOURCE_FROM_FUTURE'));
const disagree=Q.sourceAgreement([{name:'a',value:2700.0},{name:'b',value:2708.0}],{tolerancePct:0.1});assert.equal(disagree.state,'CONFLICT');
console.log('data quality gate tests passed');
