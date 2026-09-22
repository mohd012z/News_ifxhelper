'use strict';
const WINDOWS=[['M1',1],['M5',5],['M15',15],['M30',30],['H1',60],['H4',240],['D1',1440],['W1',10080],['MN1',43200]].map(([key,minutes])=>({key,minutes}));
function schedule(t0){const t=new Date(t0).getTime();return WINDOWS.map(w=>({...w,targetAt:new Date(t+w.minutes*60000).toISOString()}));}
function nearestAtOrAfter(candles,targetAt,maxLagMinutes){
 const t=new Date(targetAt).getTime();
 const c=(candles||[]).filter(x=>new Date(x.time).getTime()>=t).sort((a,b)=>new Date(a.time)-new Date(b.time))[0];
 if(!c)return {quality:'MISSING',lagMinutes:null,candle:null};
 const lag=(new Date(c.time).getTime()-t)/60000;
 return {quality:lag===0?'EXACT':lag<=maxLagMinutes?'NEAR':'STALE',lagMinutes:+lag.toFixed(2),candle:c};
}
function pct(base,price){return base&&price!=null?+(((+price-+base)/+base)*100).toFixed(4):null;}
function summary(checkpoints){const v=(checkpoints||[]).map(x=>x.realizedPct).filter(Number.isFinite);return {state:v.length===WINDOWS.length?'COMPLETE':v.length?'OBSERVING':'PENDING',mfePct:v.length?Math.max(...v):null,maePct:v.length?Math.min(...v):null};}
module.exports={WINDOWS,schedule,nearestAtOrAfter,pct,summary};
