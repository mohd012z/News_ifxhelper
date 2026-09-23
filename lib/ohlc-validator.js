'use strict';
function n(v){return Number.isFinite(+v)?+v:null;}
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function validateCandle(c,{timeframeMinutes=1,now=Date.now(),maxLagMinutes=null}={}){
 const time=iso(c.time||c.openTime||c.timestamp),open=n(c.open),high=n(c.high),low=n(c.low),close=n(c.close),volume=n(c.volume);
 const errors=[];if(!time)errors.push('INVALID_TIME');if([open,high,low,close].some(v=>v==null))errors.push('INVALID_OHLC');
 if(high!=null&&low!=null&&high<low)errors.push('HIGH_BELOW_LOW');
 if(high!=null&&open!=null&&open>high)errors.push('OPEN_ABOVE_HIGH');if(low!=null&&open!=null&&open<low)errors.push('OPEN_BELOW_LOW');
 if(high!=null&&close!=null&&close>high)errors.push('CLOSE_ABOVE_HIGH');if(low!=null&&close!=null&&close<low)errors.push('CLOSE_BELOW_LOW');
 const openMs=time?new Date(time).getTime():null,closeMs=openMs==null?null:openMs+timeframeMinutes*60000;
 const isClosed=closeMs!=null&&now>=closeMs;const ageMinutes=closeMs==null?null:(now-closeMs)/60000;
 const lagLimit=maxLagMinutes==null?Math.max(2,timeframeMinutes*2):maxLagMinutes;
 const quality=errors.length?'INVALID':!isClosed?'FORMING':ageMinutes<=lagLimit?'EXACT_OR_CURRENT':'STALE';
 return {valid:!errors.length,errors,time,open,high,low,close,volume,isClosed,ageMinutes:ageMinutes==null?null:+ageMinutes.toFixed(2),quality};
}
function validateSeries(rows,opts={}){
 const out=(rows||[]).map(c=>validateCandle(c,opts));const seen=new Set(),duplicates=[];let gaps=[];
 for(const x of out){if(!x.time)continue;if(seen.has(x.time))duplicates.push(x.time);seen.add(x.time);}
 const validTimes=out.filter(x=>x.time).map(x=>new Date(x.time).getTime()).sort((a,b)=>a-b),step=(opts.timeframeMinutes||1)*60000;
 for(let i=1;i<validTimes.length;i++){const d=validTimes[i]-validTimes[i-1];if(d>step*1.5)gaps.push({after:new Date(validTimes[i-1]).toISOString(),before:new Date(validTimes[i]).toISOString(),missingApprox:Math.max(1,Math.round(d/step)-1)});}
 return {valid:out.every(x=>x.valid)&&duplicates.length===0,candles:out,duplicates,gaps};
}
function provenance(c,meta={}){const fetchedAt=iso(meta.fetchedAt||Date.now()),sourceAt=iso(meta.sourceAt||c.time),latencyMs=fetchedAt&&sourceAt?new Date(fetchedAt)-new Date(sourceAt):null;return {...c,provider:meta.provider||'UNKNOWN',symbol:meta.symbol||null,timeframe:meta.timeframe||null,sourceAt,fetchedAt,latencyMs,isSynthetic:!!meta.isSynthetic,derivedFrom:meta.derivedFrom||null};}
module.exports={validateCandle,validateSeries,provenance};
