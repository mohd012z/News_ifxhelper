'use strict';
const TF={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};
function n(v){return Number.isFinite(+v)?+v:null;}
function floorUtc(ms,minutes){const step=minutes*60000;return Math.floor(ms/step)*step;}
function resample(rows,minutes,{requireComplete=true,sourceMinutes=1,asOf=Date.now(),requireReceiptTime=false}={}){
 if(!Number.isInteger(minutes)||minutes<1||!Number.isInteger(sourceMinutes)||sourceMinutes<1||minutes%sourceMinutes!==0)throw new RangeError('Invalid timeframe ratio');
 const cutoff=new Date(asOf).getTime();if(!Number.isFinite(cutoff))throw new RangeError('Invalid asOf');
 const buckets=new Map();for(const r of rows||[]){const t=new Date(r.time).getTime();if(!Number.isFinite(t))continue;const received=r.receivedAt||r.fetchedAt;if(requireReceiptTime&&(!received||!Number.isFinite(new Date(received).getTime())||new Date(received).getTime()>cutoff))continue;const key=floorUtc(t,minutes);if(t% (sourceMinutes*60000)!==0||t+sourceMinutes*60000>cutoff)continue;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
 const out=[];for(const [key,b] of [...buckets].sort((a,b)=>a[0]-b[0])){b.sort((a,b)=>new Date(a.time)-new Date(b.time));const expected=minutes/sourceMinutes;const unique=new Set(b.map(r=>new Date(r.time).getTime()));const complete=unique.size===expected&&b.length===expected&&[...unique].every(t=>t>=key&&t<key+minutes*60000&&(t-key)%(sourceMinutes*60000)===0)&&key+minutes*60000<=cutoff;if(requireComplete&&!complete)continue;const bar=aggregate(key,b,expected,sourceMinutes+'m');if(bar)out.push({...bar,complete});}
 return out;
}
function aggregate(key,b,expected,derivedFrom){const o=n(b[0].open),c=n(b.at(-1).close),high=Math.max(...b.map(x=>n(x.high)).filter(Number.isFinite)),low=Math.min(...b.map(x=>n(x.low)).filter(Number.isFinite));if([o,c,high,low].some(v=>!Number.isFinite(v)))return null;const vols=b.map(x=>n(x.volume)).filter(Number.isFinite);return {time:new Date(key).toISOString(),open:o,high,low,close:c,volume:vols.length?vols.reduce((a,v)=>a+v,0):null,isSynthetic:true,derivedFrom,sourceCount:b.length,expectedCount:expected,complete:b.length>=expected};}
function weekStartUtc(ms){const d=new Date(ms),day=d.getUTCDay(),delta=(day+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-delta);}
function monthStartUtc(ms){const d=new Date(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);}
function daysInUtcMonth(ms){const d=new Date(ms);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();}
function resampleCalendar(rows,tf,{sourceTf='D1',requireComplete=true,asOf=Date.now(),sessionDates=null,requireReceiptTime=false}={}){
 const cutoff=new Date(asOf).getTime();if(!Number.isFinite(cutoff))throw new RangeError('Invalid asOf');
 if(sessionDates!==null&&!Array.isArray(sessionDates))throw new TypeError('sessionDates must be an array');
 const sessions=sessionDates===null?null:new Set(sessionDates.map(x=>{const t=new Date(x).getTime();if(!Number.isFinite(t))throw new RangeError('Invalid session date');return new Date(t).toISOString().slice(0,10);}));
 if(!['W1','MN1'].includes(tf))throw new Error('Unsupported calendar timeframe: '+tf);
 const buckets=new Map();
 for(const r of rows||[]){const ms=new Date(r.time).getTime();if(!Number.isFinite(ms)||ms+86400000>cutoff)continue;const received=r.receivedAt||r.fetchedAt;if(requireReceiptTime&&(!received||!Number.isFinite(new Date(received).getTime())||new Date(received).getTime()>cutoff))continue;const key=tf==='W1'?weekStartUtc(ms):monthStartUtc(ms);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
 const out=[];
 for(const [key,b] of [...buckets].sort((a,b)=>a[0]-b[0])){
  b.sort((a,b)=>new Date(a.time)-new Date(b.time));
  const periodEnd=tf==='W1'?key+7*86400000:Date.UTC(new Date(key).getUTCFullYear(),new Date(key).getUTCMonth()+1,1);
  const dates=[];for(let t=key;t<periodEnd;t+=86400000){const date=new Date(t).toISOString().slice(0,10);if(!sessions||sessions.has(date))dates.push(date);}
  const expected=sourceTf==='D1'?dates.length:null;
  const unique=new Set(b.map(x=>new Date(x.time).toISOString().slice(0,10)));
  const complete=periodEnd<=cutoff&&expected!==null&&b.length===expected&&unique.size===expected&&dates.every(d=>unique.has(d));
  if(requireComplete&&!complete)continue;
  const bar=aggregate(key,b,expected==null?b.length:expected,sourceTf);
  if(bar)out.push({...bar,complete,calendarTimeframe:tf});
 }
 return out;
}
function buildFrames(m1,{daily=null,asOf=Date.now(),sessionDates=null,requireReceiptTime=false}={}){const cutoff=new Date(asOf).getTime();if(!Number.isFinite(cutoff))throw new RangeError('Invalid asOf');const out={M1:(m1||[]).filter(r=>{const t=new Date(r.time).getTime();const received=r.receivedAt||r.fetchedAt;return Number.isFinite(t)&&t+60000<=cutoff&&(!requireReceiptTime||(received&&Number.isFinite(new Date(received).getTime())&&new Date(received).getTime()<=cutoff));})};for(const [tf,min] of Object.entries(TF)){if(tf==='M1')continue;out[tf]=resample(m1,min,{sourceMinutes:1,requireComplete:true,asOf,requireReceiptTime});}if(Array.isArray(daily)){out.W1=resampleCalendar(daily,'W1',{sourceTf:'D1',asOf,sessionDates,requireReceiptTime});out.MN1=resampleCalendar(daily,'MN1',{sourceTf:'D1',asOf,sessionDates});}return out;}
module.exports={TF,floorUtc,resample,resampleCalendar,weekStartUtc,monthStartUtc,buildFrames};
