'use strict';
/* DataBrain — "Can I trust the data?" (CodeBrains P0, first brain).
 *
 * Classifies raw feed quality and HARD-REFUSES prediction when the feed is
 * FORMING / SYNTHETIC / STALE / INVALID. Composes the existing validator +
 * dataClass + closed-candle gate — it does not re-implement them.
 *
 * Status vocabulary: VALID | DEGRADED | STALE | INVALID | SYNTHETIC | FORMING
 * Hard rule: FORMING | SYNTHETIC | STALE | INVALID  =>  NO NEW PREDICTION.
 */
var V=(typeof require!=='undefined')?require('../ohlc-validator.js'):null;
var DC=(typeof require!=='undefined')?require('../ai/data-class.js'):null;
var GATE=(typeof require!=='undefined')?require('../ai/closed-candle-gate.js'):null;
function n(v){return Number.isFinite(+v)?+v:null;}
function _gap(c,a,b){return (b-a)>c*2+1;}
/**
 * classify({ candles (raw, time-asc), source (provider string), now, tfMin,
 *            allowForming (default false) })
 * returns { status, reason, dataClass, closedCount, total, gaps, dupes, lagMin, mayPredict }
 */
function classify(inp){
  inp=inp||{};
  var now=inp.now!=null?inp.now:Date.now();
  var tfMin=inp.tfMin||1;
  var raw=inp.candles||[];
  /* 1. source class — synthetic/demo is refused before anything else. */
  var dc={dataClass:'UNKNOWN',allowed:false};
  if(DC&&inp.source!=null)dc=DC.gate(String(inp.source));
  if(!dc.allowed)return {status:'SYNTHETIC',reason:'dataClass '+dc.dataClass+' refused: '+dc.reason,dataClass:dc.dataClass,closedCount:0,total:raw.length,gaps:0,dupes:0,lagMin:null,mayPredict:false};
  if(!raw.length)return {status:'INVALID',reason:'no candles',dataClass:dc.dataClass,closedCount:0,total:0,gaps:0,dupes:0,lagMin:null,mayPredict:false};
  /* 2. validator (OHLC validity, duplicates). */
  var valid=raw,validCount=raw.length,gaps=0,dupes=0;
  if(V){try{var r=V.validateSeries(raw,{timeframeMinutes:tfMin});valid=r.candles||raw;validCount=r.candles?r.candles.filter(function(c){return c.valid;}).length:validCount;gaps=r.gaps?r.gaps.length:0;dupes=r.duplicates?r.duplicates.length:0;}catch(e){}}
  if(validCount===0)return {status:'INVALID',reason:'no valid candles after OHLC check',dataClass:dc.dataClass,closedCount:0,total:raw.length,gaps:0,dupes:dupes,lagMin:null,mayPredict:false};
  /* 3. closed vs forming. A candle is closed when open+tf <= now. */
  var step=tfMin*60000;
  var closed=valid.filter(function(c){return c.isClosed===true||(Date.parse(c.time)&&Date.parse(c.time)+step<=now);});
  if(!closed.length)return {status:'FORMING',reason:'no closed candles yet (last is still forming)',dataClass:dc.dataClass,closedCount:0,total:valid.length,gaps:gaps,dupes:dupes,lagMin:null,mayPredict:false};
  if(!inp.allowForming&&closed.length<valid.length){/* a trailing forming candle is present — note it but the closed set is usable */}
  var last=closed[closed.length-1];
  var lastCloseMs=Date.parse(last.time)+step; /* candle CLOSE time = open + tf (freshness is judged from the close, not the open) */
  var lagMin=(now-lastCloseMs)/60000;
  if(lagMin<0)lagMin=0;
  var maxLag=(inp.maxLagMin!=null)?inp.maxLagMin:Math.max(5,tfMin);
  if(lagMin>maxLag)return {status:'STALE',reason:'last closed candle closed '+lagMin.toFixed(0)+' min ago',dataClass:dc.dataClass,closedCount:closed.length,total:valid.length,gaps:gaps,dupes:dupes,lagMin:+lagMin.toFixed(1),mayPredict:false};
  /* 4. contiguity over recent tail. */
  var tail=closed.slice(-120),breaks=0;
  for(var i=1;i<tail.length;i++)if(_gap(step,Date.parse(tail[i-1].time),Date.parse(tail[i].time)))breaks++;
  var hasForming=(valid.length-closed.length)>0;
  var status='VALID';
  if(breaks>0||dupes>0||gaps>2)status='DEGRADED';
  var may=(status==='VALID'||status==='DEGRADED');
  return {status:status,hasForming:hasForming,reason:status==='VALID'?(hasForming?'VALID closed set present; trailing forming candle excluded':'VALID AND CLOSED AND FRESH AND CONTIGUOUS'):(breaks?breaks+' gap(s) in recent tail':(dupes?dupes+' duplicate(s)':gaps+' gap(s) (lunch/weekend expected)')),dataClass:dc.dataClass,closedCount:closed.length,total:valid.length,gaps:gaps,dupes:dupes,lagMin:+lagMin.toFixed(2),mayPredict:may};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMADataBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {classify:classify};});
