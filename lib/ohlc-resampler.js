'use strict';
const TF={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};
function n(v){return Number.isFinite(+v)?+v:null;}
function floorUtc(ms,minutes){const step=minutes*60000;return Math.floor(ms/step)*step;}
function resample(rows,minutes,{requireComplete=true,sourceMinutes=1}={}){
 const buckets=new Map();for(const r of rows||[]){const t=new Date(r.time).getTime();if(!Number.isFinite(t))continue;const key=floorUtc(t,minutes);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
 const out=[];for(const [key,b] of [...buckets].sort((a,b)=>a[0]-b[0])){b.sort((a,b)=>new Date(a.time)-new Date(b.time));const expected=Math.max(1,Math.round(minutes/sourceMinutes));if(requireComplete&&b.length<expected)continue;const o=n(b[0].open),c=n(b.at(-1).close),high=Math.max(...b.map(x=>n(x.high)).filter(Number.isFinite)),low=Math.min(...b.map(x=>n(x.low)).filter(Number.isFinite));if([o,c,high,low].some(v=>!Number.isFinite(v)))continue;const vols=b.map(x=>n(x.volume)).filter(Number.isFinite);out.push({time:new Date(key).toISOString(),open:o,high,low,close:c,volume:vols.length?vols.reduce((a,v)=>a+v,0):null,isSynthetic:true,derivedFrom:sourceMinutes+'m',sourceCount:b.length,expectedCount:expected,complete:b.length>=expected});}
 return out;
}
function buildFrames(m1){const out={M1:m1};for(const [tf,min] of Object.entries(TF)){if(tf==='M1')continue;out[tf]=resample(m1,min,{sourceMinutes:1,requireComplete:true});}return out;}
module.exports={TF,floorUtc,resample,buildFrames};
