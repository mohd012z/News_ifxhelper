'use strict';
/**
 * BBMA research/visualisation primitives.
 * Descriptive technical context only; no trade execution or guaranteed prediction.
 * Settings follow commonly documented BBMA OA layouts:
 * BB(20,2), LWMA 5/10 High, LWMA 5/10 Low, EMA50.
 */
function finite(v){return Number.isFinite(+v);}
function sma(a,n){if(!a||a.length<n)return null;const x=a.slice(-n).map(Number);return x.reduce((s,v)=>s+v,0)/n;}
function ema(a,n){if(!a||a.length<n)return null;const x=a.map(Number),k=2/(n+1);let e=x.slice(0,n).reduce((s,v)=>s+v,0)/n;for(let i=n;i<x.length;i++)e=x[i]*k+e*(1-k);return e;}
function lwma(a,n){if(!a||a.length<n)return null;const x=a.slice(-n).map(Number),den=n*(n+1)/2;return x.reduce((s,v,i)=>s+v*(i+1),0)/den;}
function sd(a,n){if(!a||a.length<n)return null;const x=a.slice(-n).map(Number),m=x.reduce((s,v)=>s+v,0)/n;return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/n);}
function bands(c,n=20,k=2){const closes=(c||[]).map(x=>+x.close),mid=sma(closes,n),dev=sd(closes,n);if(mid==null||dev==null)return null;return {mid,upper:mid+k*dev,lower:mid-k*dev,widthPct:mid?((2*k*dev)/mid)*100:null};}
function values(c){
 const highs=(c||[]).map(x=>+x.high),lows=(c||[]).map(x=>+x.low),closes=(c||[]).map(x=>+x.close),bb=bands(c);
 if(!bb||c.length<50)return null;
 return {bb,ma5High:lwma(highs,5),ma10High:lwma(highs,10),ma5Low:lwma(lows,5),ma10Low:lwma(lows,10),ema50:ema(closes,50),close:closes.at(-1)};
}
function classify(c){
 const v=values(c);if(!v)return {state:'INSUFFICIENT_DATA'};
 const last=c.at(-1),prev=c.at(-2),dir=last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT';
 const trend=v.close>v.bb.mid&&v.close>v.ema50?'UP':v.close<v.bb.mid&&v.close<v.ema50?'DOWN':'MIXED';
 const momentum=v.close>v.bb.upper?'MOMENTUM_UP':v.close<v.bb.lower?'MOMENTUM_DOWN':'NONE';
 const extreme=v.ma5High>v.bb.upper?'EXTREME_HIGH':v.ma5Low<v.bb.lower?'EXTREME_LOW':'NONE';
 const csak=dir==='UP'&&v.close>v.ma5High&&v.close>v.ma10High&&v.close>v.bb.mid?'CSAK_UP':dir==='DOWN'&&v.close<v.ma5Low&&v.close<v.ma10Low&&v.close<v.bb.mid?'CSAK_DOWN':'NONE';
 let reentry='NONE';
 if(trend==='UP'&&last.low<=Math.max(v.ma5Low,v.ma10Low)&&v.close>v.bb.mid&&v.close>v.ma5Low)reentry='REENTRY_UP_ZONE';
 if(trend==='DOWN'&&last.high>=Math.min(v.ma5High,v.ma10High)&&v.close<v.bb.mid&&v.close<v.ma5High)reentry='REENTRY_DOWN_ZONE';
 const emaGap=v.ema50<v.bb.lower?'EMA50_BELOW_BB':v.ema50>v.bb.upper?'EMA50_ABOVE_BB':'EMA50_INSIDE_BB';
 const squeeze=finite(v.bb.widthPct)&&v.bb.widthPct<0.35?'TIGHT':'NORMAL';
 return {state:'READY',trend,momentum,extreme,csak,reentry,emaGap,squeeze,values:v,lastTime:last.time,previousTime:prev&&prev.time};
}
function mtf(frames){
 const order=['W1','D1','H4','H1','M30','M15','M5','M1'];const out={};for(const tf of order)if(frames&&frames[tf])out[tf]=classify(frames[tf]);
 const dirs=Object.entries(out).filter(([,x])=>x.state==='READY'&&['UP','DOWN'].includes(x.trend)).map(([tf,x])=>({tf,direction:x.trend}));
 const up=dirs.filter(x=>x.direction==='UP').length,down=dirs.filter(x=>x.direction==='DOWN').length;
 return {frames:out,alignment:!dirs.length?'INSUFFICIENT_DATA':up===dirs.length?'UP_ALIGNED':down===dirs.length?'DOWN_ALIGNED':'MIXED',up,down};
}
module.exports={sma,ema,lwma,sd,bands,values,classify,mtf};
