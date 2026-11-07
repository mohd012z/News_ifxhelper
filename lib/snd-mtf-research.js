'use strict';
/** Evidence-only multi-timeframe BBMA/S&D observations; no delivery or trading. */
const S=require('./structural-snd');
const B=require('./bbma-engine');
const DURATIONS={M1:60000,M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000};
const ORDER=['W1','D1','H4','H1','M30','M15','M5','M1'];
function analyze(frames,options={}){
 if(!frames||typeof frames!=='object'||Array.isArray(frames))throw new TypeError('frames object required');
 const at=Date.parse(options.asOf);
 if(!Number.isFinite(at))throw new TypeError('valid asOf timestamp required');
 const selected=options.timeframes??ORDER.filter(tf=>Object.hasOwn(frames,tf));
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(tf=>!Object.hasOwn(DURATIONS,tf)))throw new TypeError('invalid timeframes');
 const result={schemaVersion:1,kind:'RESEARCH_ONLY',asOf:new Date(at).toISOString(),timeframes:{},summary:{alignedDemand:0,alignedSupply:0,conflicts:0,unavailable:0}};
 for(const tf of selected){
  const raw=frames[tf];
  if(!Array.isArray(raw)){result.timeframes[tf]={state:'UNAVAILABLE',reason:'MISSING_CANDLES',zones:[]};result.summary.unavailable++;continue;}
  let candles;
  try{candles=S.validate(raw);}catch(e){result.timeframes[tf]={state:'UNAVAILABLE',reason:'INVALID_CANDLES',zones:[]};result.summary.unavailable++;continue;}
  // Source timestamps are bar OPEN timestamps. A bar is usable only once its interval ends.
  const cutoff=at-DURATIONS[tf];
  const closed=raw.filter((x,i)=>candles[i].t<=cutoff);
  // Fail closed if any supplied bar is marked incomplete, even when its time is in the past.
  const zones=S.detect(closed,options.detector);
  const bb=closed.length>=50?B.classify(closed):{state:'INSUFFICIENT_DATA'};
  const evidence=zones.map(z=>{
   const context=S.confluence(z,closed);
   const record={...z,timeframe:tf,bbmaAtConfirmation:context,sourceCandles:closed.length};
   if(context.state==='ALIGNED'){if(z.side==='DEMAND')result.summary.alignedDemand++;else result.summary.alignedSupply++;}
   else if(context.state==='NOT_ALIGNED')result.summary.conflicts++;
   return record;
  });
  result.timeframes[tf]={state:closed.length?'READY':'INSUFFICIENT_DATA',closedCandles:closed.length,latestClosedOpen:closed.length?closed.at(-1).time:null,bbma:bb.state==='READY'?{state:bb.state,trend:bb.trend,zone:bb.zone,lastTime:bb.lastTime}: {state:bb.state},zones:evidence};
  if(!closed.length)result.summary.unavailable++;
 }
 return result;
}
module.exports={analyze,DURATIONS};
