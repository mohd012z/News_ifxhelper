'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function functionSource(name) {
  const start = source.indexOf('  function '+name+'(');
  assert(start >= 0, name+' missing');
  const next = source.indexOf('\n  function ',start+3);
  return source.slice(start,next < 0 ? undefined : next);
}
assert.match(source,/LIVE_CALENDAR_SOURCE_TIMEOUT_MS = 8000/);
assert.match(source,/LIVE_CALENDAR_MAX_AGE_MS = 120000/);
const writes = new Map();
const el = {textContent:''};
const context = {
  window:{NEWS_AUTO:{calendarAll:[{sourceHorizon:'this-week',event:'OLD'},{sourceHorizon:'this-month',event:'MONTH'}],incoming:[{sourceHorizon:'this-week',event:'OLD'}]}},
  D:{incoming:[{sourceHorizon:'this-week',event:'OLD'}]},
  localStorage:{setItem:(k,v)=>writes.set(k,JSON.parse(v))},
  document:{getElementById:()=>el},
  lastLiveCalendarSignature:'',
  renderAll:()=>{context.renders++},
  renders:0,
  liveCalendarRow:e=>e,
  liveCalendarStatus:{fetchedAt:null,rows:null},
  Date,JSON,Array
};
vm.createContext(context);
vm.runInContext(functionSource('publishCalendarStatus')+'\n'+functionSource('applyLiveCalendar'),context);
const changed = context.applyLiveCalendar([],new Date().toISOString(),'test');
assert.equal(changed,true,'empty valid feed must clear old week');
assert.equal(context.window.NEWS_AUTO.calendarAll.length,1);
assert.equal(context.window.NEWS_AUTO.calendarAll[0].event,'MONTH');
assert.equal(context.window.NEWS_AUTO.incoming.length,0);
assert.equal(context.D.incoming.length,0);
assert.equal(context.renders,1);
context.publishCalendarStatus({state:'empty',source:'test',rows:0,fetchedAt:'2026-11-06T00:00:00Z',checkedAt:'now',error:null});
assert.equal(writes.get('xau-live-calendar-sync').state,'empty');
assert.match(el.textContent,/0 events/);
context.publishCalendarStatus({state:'unavailable',source:null,rows:0,fetchedAt:null,checkedAt:'now',error:'timeout'});
assert.equal(writes.get('xau-live-calendar-sync').state,'unavailable');
assert.match(el.textContent,/timeout/);
assert.match(source,/requestId !== liveCalendarRequestId/,'older request must not overwrite newer result');
assert.match(source,/if \(liveCalendarValidated\)/,'remote snapshot must preserve validated live week');
assert.match(source,/calendar contains no parseable events/,'malformed nonempty response must not erase calendar');
assert.match(source,/Date\.now\(\) \+ 60000/,'future timestamp bound required');
assert.match(source,/Date\.now\(\) - parsedTime > LIVE_CALENDAR_MAX_AGE_MS/,'stale timestamp bound required');
assert.match(source,/stale or invalid calendar timestamp/);
assert.match(source,/if \(!Array\.isArray\(events\) \|\| events\.length > 1000\)/);

const safetyContext = {window:{NEWS_AUTO:{generatedAt:'2026-11-06 00:00:00Z'}},Date,Number,parseEventTime:(v)=>new Date(v),NEWS_MAX_AGE_MS:6*3600000,EVENT_ALERT_EXPIRY_MS:30*60000};
vm.createContext(safetyContext);
vm.runInContext(functionSource('newsSnapshotStatus')+'\n'+functionSource('eventAlertEligible'),safetyContext);
assert.equal(safetyContext.newsSnapshotStatus(new Date('2026-11-06T05:59:59Z')),'CURRENT SNAPSHOT');
assert.equal(safetyContext.newsSnapshotStatus(new Date('2026-11-06T06:00:01Z')),'HISTORICAL');
safetyContext.window.NEWS_AUTO.generatedAt='invalid';
assert.equal(safetyContext.newsSnapshotStatus(new Date('2026-11-06T06:00:01Z')),'UNVERIFIED');
assert.equal(safetyContext.eventAlertEligible({timeGmt:'2026-11-06T00:00:00Z'},new Date('2026-11-06T00:30:00Z')),true);
assert.equal(safetyContext.eventAlertEligible({timeGmt:'2026-11-06T00:00:00Z'},new Date('2026-11-06T00:30:01Z')),false);
assert.equal(safetyContext.eventAlertEligible({timeGmt:'bad'},new Date()),false);
assert.match(source,/liveCalendarStatus\.state === "fresh"/);
assert.match(source,/HISTORICAL \/ UNVERIFIED/);

console.log('PASS calendar empty-state reconciliation, retained month, freshness status, timeout and schema gates');
