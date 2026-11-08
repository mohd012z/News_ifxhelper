'use strict';
const FRAMES=Object.freeze({M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440,W1:10080,MN1:null});
function startOf(t,tf){
 if(!Number.isSafeInteger(t)||t<0||!(tf in FRAMES))throw Error('invalid timestamp/timeframe');
 const d=new Date(t);
 if(tf==='MN1')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
 if(tf==='W1')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-((d.getUTCDay()+6)%7)*86400000;
 return Math.floor(t/(FRAMES[tf]*60000))*FRAMES[tf]*60000;
}
function endOf(t,tf){if(tf==='MN1'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}return t+FRAMES[tf]*60000}
function evaluate(m1,{asOf,minimum=1000,warmup=200}={}){
 if(!Number.isSafeInteger(asOf)||!Number.isInteger(minimum)||minimum<1||!Number.isInteger(warmup)||warmup<0)throw Error('invalid options');
 const d=new Date(asOf),cutoff=Date.UTC(d.getUTCFullYear()-10,d.getUTCMonth(),d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
 let prev=-1;
 for(const c of m1){
  if(!c||!Number.isSafeInteger(c.time)||c.time%60000!==0||c.time<=prev)throw Error('invalid M1 chronology');
  if(!['open','high','low','close'].every(k=>Number.isFinite(c[k]))||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||c.low>c.high)throw Error('invalid OHLC');
  prev=c.time;
 }
 const timeframes={};
 for(const tf of Object.keys(FRAMES)){
  const bars=[];let active=null;
  for(const c of m1){
   if(c.time<cutoff||c.time+60000>asOf)continue;
   const t=startOf(c.time,tf);
   if(endOf(t,tf)>asOf)continue;
   if(!active||active.time!==t){
    active={time:t,open:c.open,high:c.high,low:c.low,close:c.close,sourceMinutes:1};
    bars.push(active);
   }else{
    active.high=Math.max(active.high,c.high);active.low=Math.min(active.low,c.low);active.close=c.close;active.sourceMinutes++;
   }
  }
  const count=bars.length;
  timeframes[tf]={count,minimum,sufficient:count>=minimum,insufficientHistory:count<minimum,warmupReady:count>warmup,usableAfterWarmup:Math.max(0,count-warmup),sourceCompletenessVerified:false,incompleteSourceBars:bars.filter(b=>FRAMES[tf]!==null&&b.sourceMinutes<FRAMES[tf]).length,lastClosedStart:count?bars[count-1].time:null};
 }
 return {policy:{historyYears:10,minimum,warmup,closedBarOnly:true,insufficient:'use_available_and_flag'},timeframes};
}
module.exports={FRAMES,startOf,endOf,evaluate};
