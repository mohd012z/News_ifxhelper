'use strict';
const assert = require('node:assert/strict');
const { normalizePriceTrack, buildAtrTargets } = require('../lib/market-signal-review');

const historical = {
  tabId: 'gold', impactScore: -0.12, priceAtDetect: 4189.1,
  createdAt: '2026-09-30T21:14:42.079Z',
  checkpoints: [
    { key: 'M15', dueAt: '2026-09-30T21:29:42.079Z', capturedAt: '2026-10-01T00:41:51.328Z', price: 4173.4, realizedPct: -0.375 },
    { key: 'MN1', dueAt: '2026-10-30T21:14:42.079Z', capturedAt: '2026-10-30T23:00:23.750Z', price: 3884.9, realizedPct: -7.262 }
  ]
};
let r = normalizePriceTrack(historical);
assert.equal(r.status, 'OBSERVED');
assert.equal(r.impactScore, -0.12);
assert.equal(r.observedPct, -7.262);
assert.equal(r.checkpoint, 'MN1');
assert.equal(r.priceSource.includes('futures'), true);
assert.equal(r.isCalibratedForecast, false);
assert.equal(r.capturedAt, '2026-10-30T23:00:23.750Z');
assert.notEqual(r.capturedAt, r.detectedAt);
assert.equal(normalizePriceTrack({ tabId:'gold', impactScore: 0, priceAtDetect:100, checkpoints:[] }).status, 'UNVERIFIED');
assert.equal(normalizePriceTrack({ priceAtDetect:100, checkpoints:[{key:'M1', price:null}] }).observedPct, null);
assert.equal(normalizePriceTrack({ priceAtDetect:100, priceAtSettle:95, predictedPct:-0.5 }).observedPct, -5);
assert.equal(normalizePriceTrack({ priceAtDetect:100, priceAtSettle:95, checkpoints:[] }).status, 'UNVERIFIED');
assert.equal(normalizePriceTrack({ priceAtDetect:100, checkpoints:[{key:'H1', price:90, capturedAt:'2026-10-31T00:00:00Z', dueAt:'2026-10-30T20:00:00Z'}] }).timing, 'LATE');
const valid = { signal:'SELL', price:4000, atr:70, quoteSymbol:'GC=F', atrSymbol:'GC=F', quoteAt:'2026-10-30T10:00:00Z', atrAt:'2026-10-30 05:44:09', now:'2026-10-30T10:05:00Z' };
const t=buildAtrTargets(valid);
assert.equal(t.valid,true);
assert.equal(t.sl,4084);
assert.equal(t.tp1,3895);
assert.equal(t.tp2,3825);
assert.equal(t.riskReward1,1.25);
assert.equal(buildAtrTargets({...valid,quoteSymbol:'XAU/USD'}).reason,'INSTRUMENT_MISMATCH');
assert.equal(buildAtrTargets({...valid,now:'2026-10-31T10:00:00Z'}).reason,'STALE_QUOTE');
assert.equal(buildAtrTargets({...valid,signal:'NEUTRAL'}).reason,'NO_DIRECTION');
assert.equal(buildAtrTargets({...valid,marketOpen:false}).reason,'MARKET_CLOSED');
assert.equal(buildAtrTargets({...valid,atr:NaN}).reason,'INVALID_PRICE_OR_ATR');
assert.equal(buildAtrTargets({...valid,quoteAt:'bad-date'}).reason,'MISSING_TIMESTAMP');
assert.equal(buildAtrTargets({...valid,quoteAt:'2026-10-30T10:06:30Z'}).reason,'FUTURE_TIMESTAMP');
assert.equal(buildAtrTargets({...valid,atrAt:'2026-10-27T08:00:00Z'}).reason,'STALE_ATR');
console.log('market-signal-review tests passed');
