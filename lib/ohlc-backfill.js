'use strict';
const V=require('./ohlc-validator');
function target(eventAt,minutes){return new Date(new Date(eventAt).getTime()+minutes*60000).toISOString();}
function select(rows,targetAt,{timeframeMinutes=1,maxLagMinutes=2,requireClosed=true,now=Date.now()}={}){
 const series=V.validateSeries(rows,{timeframeMinutes,now});const t=new Date(targetAt).getTime();
 const candidates=series.candles.filter(c=>c.valid&&(!requireClosed||c.isClosed)&&new Date(c.time).getTime()>=t).sort((a,b)=>new Date(a.time)-new Date(b.time));
 const c=candidates[0];if(!c)return {quality:'MISSING',targetAt,candle:null,lagMinutes:null,seriesIssues:{duplicates:series.duplicates,gaps:series.gaps}};
 const lag=(new Date(c.time)-t)/60000;const quality=lag===0?'EXACT':lag<=maxLagMinutes?'NEAR':'STALE';
 return {quality,targetAt,candle:c,lagMinutes:+lag.toFixed(2),seriesIssues:{duplicates:series.duplicates,gaps:series.gaps}};
}
function checkpoints(eventAt,rowsByTf){
 const defs={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440,W1:10080,MN1:43200},out={};
 for(const [h,mins] of Object.entries(defs)){const source=rowsByTf[h]||rowsByTf.M1||[];const tf=h==='M1'?1:h==='M5'?5:h==='M15'?15:h==='M30'?30:h==='H1'?60:h==='H4'?240:h==='D1'?1440:h==='W1'?10080:43200;out[h]=select(source,target(eventAt,mins),{timeframeMinutes:tf,maxLagMinutes:Math.max(2,tf)});}
 return out;
}
module.exports={target,select,checkpoints};
