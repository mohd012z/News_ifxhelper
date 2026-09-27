'use strict';
const assert=require('assert'),E=require('../lib/event-window');
const event='2026-10-14T12:30:00Z';
const windows=E.schedule(event);
assert.equal(windows.length,7);assert.equal(windows[0].name,'T-24H');assert.equal(windows.at(-1).name,'PRE_EVENT_FREEZE');
assert.equal(windows.find(x=>x.name==='T-30M').at,'2026-10-14T12:00:00.000Z');
const due=E.due(event,'2026-10-14T12:00:30Z',{completed:['T-24H','T-6H','T-1H']});assert(due.some(x=>x.name==='T-30M'));
const checkpoints=E.reactionCheckpoints(event);assert.equal(checkpoints.M1,'2026-10-14T12:31:00.000Z');assert.equal(checkpoints.M30,'2026-10-14T13:00:00.000Z');assert.equal(checkpoints.H4,'2026-10-14T16:30:00.000Z');
const candles=[{time:'2026-10-14T13:30:00.000Z',close:2700}];
assert.equal(E.exactCheckpoint(candles,checkpoints.M30),null); // never substitute +60m for missing +30m
const exact=[...candles,{time:'2026-10-14T13:00:00.000Z',close:2690}];assert.equal(E.exactCheckpoint(exact,checkpoints.M30).close,2690);
console.log('event window tests passed');
