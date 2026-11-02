'use strict';
// Deterministic research calculations; never represent these as calibrated forecasts.
function surprise(actual,forecast,historicalStdDev) {
 if(![actual,forecast,historicalStdDev].every(Number.isFinite)||historicalStdDev<=0) return null;
 return {difference:actual-forecast,standardized:(actual-forecast)/historicalStdDev};
}
function returns(prices) {
 if(!Array.isArray(prices)||prices.length<2||prices.some(x=>!Number.isFinite(x)||x<=0))return [];
 return prices.slice(1).map((p,i)=>Math.log(p/prices[i]));
}
function realizedVolatility(prices) {
 const r=returns(prices);
 if(r.length<2)return null;
 const mean=r.reduce((a,b)=>a+b,0)/r.length;
 return Math.sqrt(r.reduce((a,b)=>a+(b-mean)**2,0)/(r.length-1));
}
function atr(bars,period=14) {
 if(!Array.isArray(bars)||!Number.isInteger(period)||period<1||bars.length<period+1)return null;
 const tr=[];
 for(let i=1;i<bars.length;i++){
  const p=bars[i-1],b=bars[i];
  if(![p.close,b.high,b.low,b.close].every(Number.isFinite)||b.high<b.low)return null;
  tr.push(Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close)));
 }
 return tr.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function historicalScenario(eventReturns,{minSamples=30}={}) {
 if(!Array.isArray(eventReturns)||eventReturns.length<minSamples||eventReturns.some(x=>!Number.isFinite(x)))return {status:'insufficient-history',sampleSize:eventReturns?.length||0};
 const sorted=[...eventReturns].sort((a,b)=>a-b);
 const quantile=q=>{const pos=q*(sorted.length-1),lo=Math.floor(pos),hi=Math.ceil(pos);return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);};
 return {status:'descriptive-only',sampleSize:sorted.length,median:quantile(.5),p10:quantile(.1),p90:quantile(.9),positiveFraction:sorted.filter(x=>x>0).length/sorted.length};
}
module.exports={surprise,returns,realizedVolatility,atr,historicalScenario};
