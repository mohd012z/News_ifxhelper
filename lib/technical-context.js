'use strict';
/**
 * Technical alignment primitives.
 * Pure calculations: callers supply timestamped OHLC. No trade execution.
 */
function sma(values,n){if(!Array.isArray(values)||values.length<n)return null;const a=values.slice(-n);return a.reduce((s,x)=>s+x,0)/n;}
function trueRange(cur,prev){return Math.max(cur.high-cur.low,Math.abs(cur.high-prev.close),Math.abs(cur.low-prev.close));}
function atr(candles,n=14){if(!candles||candles.length<n+1)return null;const tr=[];for(let i=1;i<candles.length;i++)tr.push(trueRange(candles[i],candles[i-1]));return sma(tr,n);}
function structure(candles){
 if(!candles||candles.length<4)return {state:'INSUFFICIENT_DATA'};
 const x=candles.slice(-4), highs=x.map(c=>+c.high), lows=x.map(c=>+c.low);
 const hh=highs[3]>highs[2]&&highs[2]>=highs[1], hl=lows[3]>lows[2]&&lows[2]>=lows[1];
 const lh=highs[3]<highs[2]&&highs[2]<=highs[1], ll=lows[3]<lows[2]&&lows[2]<=lows[1];
 return {state:hh&&hl?'BULLISH':lh&&ll?'BEARISH':'MIXED',lastClose:+x[3].close,swingHigh:Math.max(...highs),swingLow:Math.min(...lows)};
}
function alignTime(eventAt,candles,maxLagMinutes){
 const t=new Date(eventAt).getTime(); if(!Number.isFinite(t))return {state:'INVALID_EVENT_TIME'};
 const before=(candles||[]).filter(c=>new Date(c.time).getTime()<=t).sort((a,b)=>new Date(b.time)-new Date(a.time))[0];
 if(!before)return {state:'NO_CANDLE'};
 const lag=(t-new Date(before.time).getTime())/60000;
 return {state:lag<=maxLagMinutes?'ALIGNED':'STALE',lagMinutes:+lag.toFixed(1),candle:before};
}
function context(timeframe,candles,eventAt){
 const lag={M5:10,M15:30,H1:120,H4:480,D1:2880}[timeframe]||120;
 return {timeframe,alignment:alignTime(eventAt,candles,lag),structure:structure(candles),atr14:atr(candles,14)};
}
module.exports={sma,trueRange,atr,structure,alignTime,context};
