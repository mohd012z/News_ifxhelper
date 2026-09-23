'use strict';
const assert=require('assert'),H=require('../lib/news-level-reaction-history');
const input={eventId:'e1',event:{category:'INFLATION',importance:'HIGH',surpriseDirection:'UP'},zone:'UPPER_BAND',behavior:'UPPER_REJECTION',mtfAlignment:'MIXED',volatility:'EXPANDING',technical:{atrPct:.42,bbWidthPct:1.1},basePrice:100,quality:'EXACT',checkpoints:{M1:{price:99.8},M5:{price:99.5},M15:{price:99},M30:{price:98.8},H1:{price:99.2},H4:{price:100.2}}};
const r=H.record(input);assert.equal(r.reactions.M30.direction,'DOWN');assert.equal(r.reactions.H4.direction,'UP');
const current={event:input.event,zone:input.zone,behavior:input.behavior,mtfAlignment:input.mtfAlignment,volatility:input.volatility,technical:input.technical};
assert.equal(H.comparable([r],current).length,1);
const s=H.reversalStats([r],'UP');assert.equal(s.horizons.M30.reversalRate,100);assert.equal(s.horizons.H4.reversalRate,0);
console.log('news level reaction history tests passed');
