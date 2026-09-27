'use strict';
const TF={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};
function n(v){return Number.isFinite(+v)?+v:null;}
function floorUtc(ms,minutes){const step=minutes*60000;return Math.floor(ms/step)*step;}
function resample(rows,minutes,{requireComplete=true,sourceMinutes=1}={}){
 const buckets=new Map();for(const r of rows||[]){const t=new Date(r.time).getTime();if(!Number.isFinite(t))continue;const key=floorUtc(t,minutes);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
 const out=[];for(const [key,b] of [...buckets].sort((a,b)=>a[0]-b[0])){b.sort((a,b)=>new Date(a.time)-new Date(b.time));const expected=Math.max(1,Math.round(minutes/sourceMinutes));if(requireComplete&&b.length<expected)continue;const bar=aggregate(key,b,expected,sourceMinutes+'m');if(bar)out.push(bar);}
 return out;
}
function aggregate(key,b,expected,derivedFrom){const o=n(b[0].open),c=n(b.at(-1).close),high=Math.max(...b.map(x=>n(x.high)).filter(Number.isFinite)),low=Math.min(...b.map(x=>n(x.low)).filter(Number.isFinite));if([o,c,high,low].some(v=>!Number.isFinite(v)))return null;const vols=b.map(x=>n(x.volume)).filter(Number.isFinite);return {time:new Date(key).toISOString(),open:o,high,low,close:c,volume:vols.length?vols.reduce((a,v)=>a+v,0):null,isSynthetic:true,derivedFrom,sourceCount:b.length,expectedCount:expected,complete:b.length>=expected};}
function weekStartUtc(ms){const d=new Date(ms),day=d.getUTCDay(),delta=(day+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-delta);}
function monthStartUtc(ms){const d=new Date(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);}
function daysInUtcMonth(ms){const d=new Date(ms);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();}
function resampleCalendar(rows,tf,{sourceTf='D1',requireComplete=true}={}){
 if(!['W1','MN1'].includes(tf))throw new Error('Unsupported calendar timeframe: '+tf);
 const buckets=new Map();
 for(const r of rows||[]){const ms=new Date(r.time).getTime();if(!Number.isFinite(ms))continue;const key=tf==='W1'?weekStartUtc(ms):monthStartUtc(ms);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
 const out=[];
 for(const [key,b] of [...buckets].sort((a,b)=>a[0]-b[0])){
  b.sort((a,b)=>new Date(a.time)-new Date(b.time));
  const expected=sourceTf==='D1'?(tf==='W1'?7:daysInUtcMonth(key)):null;
  if(requireComplete&&expected!=null&&b.length<expected)continue;
  const bar=aggregate(key,b,expected==null?b.length:expected,sourceTf);
  if(bar)out.push({...bar,calendarTimeframe:tf});
 }
 return out;
}
function buildFrames(m1,{daily=null}={}){const out={M1:m1};for(const [tf,min] of Object.entries(TF)){if(tf==='M1')continue;out[tf]=resample(m1,min,{sourceMinutes:1,requireComplete:true});}if(Array.isArray(daily)){out.W1=resampleCalendar(daily,'W1',{sourceTf:'D1'});out.MN1=resampleCalendar(daily,'MN1',{sourceTf:'D1'});}return out;}
module.exports={TF,floorUtc,resample,resampleCalendar,weekStartUtc,monthStartUtc,buildFrames};
