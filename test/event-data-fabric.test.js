'use strict';
const assert = require('assert');
const { normalizeCalendarEvent, normalizeCoinMarketCalEvent, relevance, dedupe } = require('../lib/event-data-fabric');

const cpi = normalizeCalendarEvent({ title:'CPI m/m', currency:'USD', date:'2026-09-30T12:30:00Z', impact:'High', forecast:'0.3%', previous:'0.2%' });
assert.equal(cpi.impact, 'HIGH');
assert.equal(cpi.actionable, false);
assert(relevance(cpi, 'forex', 'EURUSD'));
assert(relevance(cpi, 'commodity', 'XAUUSD'));
assert(relevance(cpi, 'crypto', 'BTCUSD'));
assert(!relevance(cpi, 'forex', 'EURJPY'));

const eth = normalizeCoinMarketCalEvent({ id:'1', title:'Protocol upgrade', date:'2026-10-01T00:00:00Z', displayedDate:'01 Oct 2026', coins:[{symbol:'ETH'}], isEstimated:false });
assert(relevance(eth, 'crypto', 'ETHUSDT'));
assert(!relevance(eth, 'crypto', 'BTCUSDT'));
assert.equal(eth.actionable, false);

assert.equal(dedupe([cpi, cpi]).length, 1);
console.log('event-data-fabric tests: PASS');
