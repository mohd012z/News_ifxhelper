'use strict';

const assert=require('assert');
const {mergeSnapshot,rowFromProvider,stableSignature,releaseState}=require('../lib/calendar-heartbeat');
const {parseNewsFile}=require('../refresh-calendar-snapshot');

const oldWeek={
  date:'2026-10-09',timeMyt:'Fri, 2026-10-09 20:30',timeGmt:'Fri, 2026-10-09 12:30',
  event:'[USD] CPI y/y',currency:'USD',importance:'high',actual:null,forecast:'3.1%',previous:'3.0%',
  sourceHorizon:'this-week',auto:true
};
const monthDup={...oldWeek,sourceHorizon:'this-month',source:'month'};
const monthOther={date:'2026-10-20',timeMyt:'Tue, 2026-10-20 20:30',timeGmt:'Tue, 2026-10-20 12:30',
  event:'[USD] Existing Month Event',currency:'USD',importance:'med',sourceHorizon:'this-month',auto:true};

const parsed=parseNewsFile('/* header */\nwindow.NEWS_AUTO = {"generatedAt":"x","calendarAll":[]};\n\n/* Merges window.NEWS_AUTO */\n');
assert.equal(parsed.snapshot.generatedAt,'x');
assert(parsed.prefix.includes('window.NEWS_AUTO = '));
assert(parsed.suffix.startsWith('\n\n/* Merges'));

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

// Flaky short-window fetch (the real 2026-11-08 failure): the FF this-week
// feed sometimes returns only the remaining current week (~116 rows) instead
// of the full month. A REPLACE merge wiped the 294 next-week rows -> "All
// clear". A UNION merge must preserve them (fresh rows still upsert).
const fullWeekNow=['2026-11-09T13:30:00Z','2026-11-10T07:30:00Z','2026-11-11T09:30:00Z','2026-11-12T10:00:00Z']
  .map((t,i)=>{const d=new Date(t);const iso=t.slice(0,10);const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];const p=n=>String(n).padStart(2,'0');const myt=new Date(d.getTime()+8*3600000);const mytStr=day+', '+myt.getUTCFullYear()+'-'+p(myt.getUTCMonth()+1)+'-'+p(myt.getUTCDate())+' '+p(myt.getUTCHours())+':'+p(myt.getUTCMinutes());const gmtStr=day+', '+d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes());return {date:iso,timeMyt:mytStr,timeGmt:gmtStr,event:['[CNY] CPI y/y','[USD] CPI y/y','[USD] Core CPI m/m','[GBP] GDP q/q'][i],currency:['CNY','USD','USD','GBP'][i],importance:['low','high','high','med'][i],actual:null,forecast:'1.0%',previous:'0.8%',sourceHorizon:'this-week',auto:true};});
const shortFetch=[ // only the next few days (Nov-09, Nov-10) come back this time
  {date:'2026-11-09T13:30:00Z',country:'CNY',title:'CPI y/y',impact:'Low',actual:'',forecast:'1.0%',previous:'0.8%'},
  {date:'2026-11-10T07:30:00Z',country:'USD',title:'CPI y/y',impact:'High',actual:'',forecast:'0.3%',previous:'0.6%'}
];
const unionShort=mergeSnapshot({generatedAt:'x',calendarAll:[...fullWeekNow],incoming:fullWeekNow.filter(r=>r.importance!=='low'),calendarHorizon:{}},shortFetch,'2026-11-08T02:00:00Z');
assert.equal(unionShort.changed,true);
const kept=unionShort.snapshot.calendarAll.filter(x=>x.event==='[USD] Core CPI m/m');
assert.equal(kept.length,1,'a short fetch must NOT drop next-week events the feed omitted');
assert.equal(unionShort.snapshot.calendarAll.some(x=>x.event==='[GBP] GDP q/q'),true,'later-week rows must survive a short window');
assert.equal(unionShort.snapshot.calendarAll.filter(x=>x.event==='[USD] CPI y/y').length,1,'fetched rows still upsert (no duplicates)');
assert.equal(unionShort.snapshot.calendarAll.find(x=>x.event==='[USD] CPI y/y').forecast,'0.3%','fresh forecast wins on upsert');
// A repeated identical short fetch is a no-op (no commit churn).
const again=mergeSnapshot(unionShort.snapshot,shortFetch,'2026-11-08T02:05:00Z');
assert.equal(again.changed,false,'identical re-fetch must not churn');
// Old past events (>48h) are pruned so the store does not grow forever.
const oldPast={date:'2026-11-04T00:00:00Z',timeMyt:'Wed, 2026-11-04 08:00',timeGmt:'Wed, 2026-11-04 00:00',event:'[EUR] Retail Sales m/m',currency:'EUR',importance:'low',actual:'0.4%',forecast:'0.2%',previous:'0.1%',sourceHorizon:'this-week',auto:true};
const pruned=mergeSnapshot({generatedAt:'x',calendarAll:[oldPast,...fullWeekNow],incoming:[],calendarHorizon:{}},shortFetch,'2026-11-08T02:00:00Z');
assert.equal(pruned.snapshot.calendarAll.some(x=>x.event==='[EUR] Retail Sales m/m'),false,'4+ day old past rows are pruned');

console.log('calendar heartbeat tests passed');
