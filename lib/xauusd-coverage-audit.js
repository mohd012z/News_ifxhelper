'use strict';
const {FRAMES,startOf,endOf}=require('./xauusd-min-candle-policy');
function auditCoverage(rows,{asOf,minimum=1000,warmup=200}={}){
 if(!Number.isSafeInteger(asOf)||!Number.isInteger(minimum)||minimum<1||!Number.isInteger(warmup)||warmup<0)throw Error('invalid policy');
 let prev=-1;
 for(const x of rows){
  if(!x||!Number.isSafeInteger(x.time)||x.time<0||x.time%60000||x.time<=prev)throw Error('invalid M1 chronology');
  if(!['open','high','low','close'].every(k=>Number.isFinite(x[k]))||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close)||x.low>x.high)throw Error('invalid OHLC');
  prev=x.time;
 }
 const out={};
 const cutoff=new Date(asOf);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-10);
 for(const [tf,minutes] of Object.entries(FRAMES)){
  const groups=new Map();
  for(const x of rows){
   if(x.time<cutoff.getTime()||x.time+60000>asOf)continue;
   const start=startOf(x.time,tf),end=endOf(start,tf);
   if(end>asOf)continue;
   let g=groups.get(start);
   if(!g){g={start,end,first:x.time,last:x.time,observed:0,gaps:0};groups.set(start,g)}
   if(x.time>g.last+60000)g.gaps+=Math.floor((x.time-g.last)/60000)-1;
   g.last=x.time;g.observed++;
  }
  const arr=[...groups.values()].sort((a,b)=>a.start-b.start);
  const incomplete=arr.filter(g=>g.gaps>0||g.first!==g.start||g.last+60000!==g.end||g.observed!==(g.end-g.start)/60000);
  const count=arr.length;
  out[tf]={closedCount:count,minimum,insufficientHistory:count<minimum,warmupReady:count>warmup,usableAfterWarmup:Math.max(0,count-warmup),incompleteSourceBars:incomplete.length,sourceCompletenessVerified:incomplete.length===0&&count>0&&tf==='M1',coverageStatus:incomplete.length?'gaps_or_session_closures_unclassified':'no_internal_gaps_detected',marketCalendarVerified:false};
 }
 return {policy:{years:10,minimum,warmup,insufficient:'use_available_and_flag',closedOnly:true},timeframes:out};
}
module.exports={auditCoverage};
