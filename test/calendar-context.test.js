'use strict';
const assert=require('assert'),C=require('../lib/calendar-context');
const thu=C.classify('2026-09-17T12:00:00Z');
assert.equal(thu.dayOfWeek,'THURSDAY');assert.equal(thu.weekOfMonth,3);assert.equal(thu.isThursday,true);assert.equal(thu.isFriday,false);
const fri=C.classify('2026-09-18T12:00:00Z');assert.equal(fri.dayOfWeek,'FRIDAY');assert.equal(fri.weekOfMonth,3);
const first=C.classify('2026-10-01T12:00:00Z');assert.equal(first.weekOfMonth,1);
const fifth=C.classify('2026-10-30T12:00:00Z');assert.equal(fifth.weekOfMonth,5);
const bars=[
 {open:100,high:110,low:98,close:108},
 {open:108,high:115,low:105,close:112},
 {open:112,high:118,low:109,close:116}
];
const r=C.rangeContext(bars,20);assert.equal(r.open,100);assert.equal(r.high,118);assert.equal(r.low,98);assert.equal(r.close,116);assert.equal(r.range,20);assert.equal(r.atrConsumedPct,100);
assert.equal(C.rangeContext([],20).state,'INSUFFICIENT_DATA');
console.log('calendar context tests passed');
