'use strict';

const assert=require('assert');
const {mergeSnapshot,rowFromProvider,stableSignature,releaseState}=require('../lib/calendar-heartbeat');

const oldWeek={
  date:'2026-10-09',timeMyt:'Fri, 2026-10-09 20:30',timeGmt:'Fri, 2026-10-09 12:30',
  event:'[USD] CPI y/y',currency:'USD',importance:'high',actual:null,forecast:'3.1%',previous:'3.0%',
  sourceHorizon:'this-week',auto:true
};
const monthDup={...oldWeek,sourceHorizon:'this-month',source:'month'};
const monthOther={date:'2026-10-20',timeMyt:'Tue, 2026-10-20 20:30',timeGmt:'Tue, 2026-10-20 12:30',
  event:'[USD] Existing Month Event',currency:'USD',importance:'med',sourceHorizon:'this-month',auto:true};

const base={generatedAt:'2026-10-08 21:15:31Z',calendarAll:[monthDup,monthOther,oldWeek],incoming:[oldWeek,monthOther],calendarHorizon:{loaded:['this-week','this-month']}};
const same=[{date:'2026-10-09T12:30:00Z',country:'USD',title:'CPI y/y',impact:'High',actual:'',forecast:'3.1%',previous:'3.0%'}];

const mapped=rowFromProvider(same[0],'2026-10-09T00:00:00Z');
assert.equal(mapped.timeGmt,'Fri, 2026-10-09 12:30');
assert.equal(mapped.timeMyt,'Fri, 2026-10-09 20:30');
assert.equal(mapped.release.state,'RELEASE_PENDING');
assert.equal(releaseState('3.3%','3.1%').state,'RELEASED');

const unchanged=mergeSnapshot({...base,calendarAll:[monthOther,{...mapped,fetchedAt:'old'}]},same,'2026-10-09T00:05:00Z');
assert.equal(unchanged.changed,false,'fetchedAt-only differences must not create commits');

const changedEvents=[{...same[0],actual:'3.3%'}];
const changed=mergeSnapshot(base,changedEvents,'2026-10-09T00:10:00Z');
assert.equal(changed.changed,true);
assert.equal(changed.snapshot.calendarGeneratedAt,'2026-10-09T00:10:00Z');
assert.equal(changed.snapshot.generatedAt,base.generatedAt,'heartbeat must not pretend headlines were regenerated');
assert.equal(changed.snapshot.calendarAll.filter(x=>x.event==='[USD] CPI y/y').length,1,'current-week row must replace duplicate month row');
assert.equal(changed.snapshot.calendarAll.some(x=>x.event==='[USD] Existing Month Event'),true,'unrelated month horizon must be preserved');
assert.equal(changed.snapshot.incoming.some(x=>x.event==='[USD] CPI y/y'&&x.actual==='3.3%'),true);
assert.notEqual(stableSignature(changed.snapshot.calendarAll.filter(x=>x.sourceHorizon==='this-week')),stableSignature([oldWeek]));

console.log('calendar heartbeat tests passed');
