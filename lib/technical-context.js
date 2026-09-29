'use strict';
/** Technical observation primitives. Pure calculations only; no trade execution. */
function sma(values,n){if(!Array.isArray(values)||values.length<n)return null;const a=values.slice(-n).map(Number);return a.reduce((s,x)=>s+x,0)/n;}
function stddev(values,n){if(!Array.isArray(values)||values.length<n)return null;const a=values.slice(-n).map(Number),m=a.reduce((s,x)=>s+x,0)/n;return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/n);}
function ema(values,n){if(!Array.isArray(values)||values.length<n)return null;const a=values.map(Number),k=2/(n+1);let e=a.slice(0,n).reduce((s,x)=>s+x,0)/n;for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function trueRange(cur,prev){return Math.max(+cur.high-+cur.low,Math.abs(+cur.high-+prev.close),Math.abs(+cur.low-+prev.close));}
function atr(candles,n=14){if(!candles||candles.length<n+1)return null;const tr=[];for(let i=1;i<candles.length;i++)tr.push(trueRange(candles[i],candles[i-1]));return sma(tr,n);}
function bollinger(candles,n=20,k=2){if(!candles||candles.length<n)return null;const closes=candles.map(c=>+c.close),mid=sma(closes,n),sd=stddev(closes,n);if(mid==null||sd==null)return null;const upper=mid+k*sd,lower=mid-k*sd,last=closes.at(-1),width=mid?((upper-lower)/mid)*100:null;return {period:n,deviation:k,mid:+mid.toFixed(6),upper:+upper.toFixed(6),lower:+lower.toFixed(6),widthPct:width==null?null:+width.toFixed(4),position:last>upper?'ABOVE_UPPER':last<lower?'BELOW_LOWER':last>=mid?'UPPER_HALF':'LOWER_HALF'};}
function structure(candles){if(!candles||candles.length<4)return {state:'INSUFFICIENT_DATA'};const x=candles.slice(-4),highs=x.map(c=>+c.high),lows=x.map(c=>+c.low);const hh=highs[3]>highs[2]&&highs[2]>=highs[1],hl=lows[3]>lows[2]&&lows[2]>=lows[1],lh=highs[3]<highs[2]&&highs[2]<=highs[1],ll=lows[3]<lows[2]&&lows[2]<=lows[1];return {state:hh&&hl?'BULLISH':lh&&ll?'BEARISH':'MIXED',lastClose:+x[3].close,swingHigh:Math.max(...highs),swingLow:Math.min(...lows)};}
function alignTime(eventAt,candles,maxLagMinutes){const t=new Date(eventAt).getTime();if(!Number.isFinite(t))return {state:'INVALID_EVENT_TIME'};const before=(candles||[]).filter(c=>new Date(c.time).getTime()<=t).sort((a,b)=>new Date(b.time)-new Date(a.time))[0];if(!before)return {state:'NO_CANDLE'};const lag=(t-new Date(before.time).getTime())/60000;return {state:lag<=maxLagMinutes?'ALIGNED':'STALE',lagMinutes:+lag.toFixed(1),candle:before};}
/* PHASE B: bbmaContext DELEGATES to the canonical lib/bbma-engine.js
 * classify() — this module no longer carries its own BBMA/EMA5/EMA10
 * classification (the duplicate authority that could drift from the engine).
 * The engine is the SINGLE source for trend/momentum/extreme/csak/reentry/
 * zone; bbmaContext only adds the descriptive note. */
var BBMA=(typeof require!=='undefined')?require('./bbma-engine.js'):null;
function bbmaContext(candles){if(!candles||candles.length<50)return {state:'INSUFFICIENT_DATA'};if(!BBMA)return {state:'ENGINE_MISSING',note:'lib/bbma-engine.js required'};const c=BBMA.classify(candles),ma50=c.values.ema50;return {state:c.state,trend:c.trend,momentum:c.momentum,extreme:c.extreme,csak:c.csak,reentry:c.reentry,zone:c.zone,ema50:+ma50.toFixed(6),bollinger:c.values.bb,note:'Canonical lib/bbma-engine.js result; descriptive context, not a one-step-ahead price forecast.'};}
function context(timeframe,candles,eventAt){const lag={M5:10,M15:30,M30:60,H1:120,H4:480,D1:2880,W1:20160}[timeframe]||120;return {timeframe,alignment:alignTime(eventAt,candles,lag),structure:structure(candles),atr14:atr(candles,14),bollinger20:bollinger(candles,20,2),bbma:bbmaContext(candles)};}
module.exports={sma,stddev,ema,trueRange,atr,bollinger,structure,alignTime,bbmaContext,context};
