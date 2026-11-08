'use strict';
const {FRAMES,startOf,endOf}=require('./xauusd-min-candle-policy');
const MINUTE=60000;
function validateIntervals(intervals){
 if(!Array.isArray(intervals))throw Error('calendar intervals required');
 let previous=-1;
 for(const x of intervals){
  if(!x||!Number.isSafeInteger(x.start)||!Number.isSafeInteger(x.end)||x.start<0||x.end<=x.start||x.start%MINUTE||x.end%MINUTE||x.start<previous)throw Error('invalid calendar intervals');
  previous=x.end;
 }
}
function researchSessionCalendar(start,end,{closures=[]}={}){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start%MINUTE||end%MINUTE||end<start)throw Error('invalid range');
 validateIntervals(closures);
 // Explicitly provisional: UTC Sunday 22:00 to Friday 22:00; broker DST/holidays NOT verified.
 const intervals=[];
 for(let t=start;t<end;t+=MINUTE){
  const d=new Date(t),dow=d.getUTCDay(),hour=d.getUTCHours();
  const weekday=(dow>=1&&dow<=4)||(dow===5&&hour<22)||(dow===0&&hour>=22);
  if(!weekday||closures.some(x=>t>=x.start&&t<x.end))continue;
  const last=intervals[intervals.length-1];
  if(last&&last.end===t)last.end=t+MINUTE;
  else intervals.push({start:t,end:t+MINUTE});
 }
 return {intervals,verified:false,model:'provisional_utc_22_sunday_to_22_friday',closureEvidence:'caller_supplied_unverified'};
}
function auditSessionCoverage(rows,{asOf,calendar,minimum=1000,warmup=200,historyYears=10}={}){
 if(!Number.isSafeInteger(asOf)||!Number.isInteger(minimum)||minimum<1||!Number.isInteger(warmup)||warmup<0||historyYears!==10)throw Error('invalid policy');
 if(!calendar||typeof calendar.verified!=='boolean')throw Error('explicit calendar required');
 validateIntervals(calendar.intervals);
 let prev=-1;
 for(const x of rows){
  if(!x||!Number.isSafeInteger(x.time)||x.time%MINUTE||x.time<0||x.time<=prev)throw Error('invalid M1 chronology');
  if(!['open','high','low','close'].every(k=>Number.isFinite(x[k]))||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close)||x.low>x.high)throw Error('invalid OHLC');
  prev=x.time;
 }
 const date=new Date(asOf),cutoff=Date.UTC(date.getUTCFullYear()-10,date.getUTCMonth(),date.getUTCDate(),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());
 const observed=new Set(rows.filter(x=>x.time>=cutoff&&x.time+MINUTE<=asOf).map(x=>x.time));
 const output={};
 for(const tf of Object.keys(FRAMES)){
  const buckets=new Map();
  const ensure=t=>{let b=buckets.get(t);if(!b){b={time:t,expected:0,observed:0};buckets.set(t,b)}return b};
  // Only calendar-expected minutes count toward completeness; exclude zero-session buckets.
  for(const interval of calendar.intervals){
   for(let t=Math.max(interval.start,cutoff);t<Math.min(interval.end,asOf);t+=MINUTE){
    const s=startOf(t,tf);
    if(endOf(s,tf)>asOf)continue;
    const b=ensure(s);b.expected++;
    if(observed.has(t))b.observed++;
   }
  }
  const closed=[...buckets.values()].sort((a,b)=>a.time-b.time);
  const incomplete=closed.filter(b=>b.observed!==b.expected);
  const complete=closed.filter(b=>b.observed===b.expected);
  const unclassified=rows.filter(x=>x.time>=cutoff&&x.time+MINUTE<=asOf&&!calendar.intervals.some(i=>x.time>=i.start&&x.time<i.end)).length;
  output[tf]={
   closedCount:closed.length,completeCount:complete.length,incompleteCount:incomplete.length,
   missingExpectedMinutes:incomplete.reduce((s,b)=>s+b.expected-b.observed,0),
   unexpectedObservedMinutes:unclassified,
   insufficientHistory:closed.length<minimum,
   usableCompleteAfterWarmup:Math.max(0,complete.length-warmup),
   bbmaWarmupEligible:complete.length>warmup,
   calendarVerified:calendar.verified,
   sourceOutageConfirmed:false,
   gapClassification:incomplete.length?'missing_expected_minutes_cause_unverified':'no_missing_expected_minutes',
   partialBoundaryExcluded:true
  };
 }
 return {policy:{minimum,warmup,historyYears,closedOnly:true,insufficient:'use_available_and_flag'},calendarModel:calendar.model||'custom',timeframes:output};
}
module.exports={researchSessionCalendar,auditSessionCoverage,validateIntervals};
