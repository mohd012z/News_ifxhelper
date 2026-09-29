'use strict';
/* Closed-candle gate (P0-B: no forming-candle contamination).
 *
 * A 1-step-ahead prediction may only be created from candles that are:
 *   VALID    (validator: no OHLC errors)
 *   CLOSED   (the candle's close time is in the past — not still forming)
 *   FRESH    (the most recent closed candle is within maxLagMin of now)
 *   CONTIGUOUS (no gaps larger than the expected step in the recent tail)
 *
 * This makes the PREDICTION path use the same closed-only rule as the
 * SETTLEMENT path (build-bbma-learning uses x.valid && x.isClosed), removing
 * the latent divergence where the watch used .valid only.
 */
function minutesBetween(aIso,bIso){return (Date.parse(bIso)-Date.parse(aIso))/60000;}
function closedOnly(candles){
  candles=candles||[];
  return candles.filter(function(c){return c&&c.valid!==false&&c.isClosed===true;});
}
/**
 * gate(candles, opts)
 *  candles: array of validator rows { time, valid, isClosed, quality, ... }
 *  opts: { expectedMin (step between candles, default 1), maxLagMin (default 10),
 *          now (ms, default Date.now()), contiguityTail (default 120) }
 * returns { ok, reason, closedCount, lastClosed, gaps, lagMin }
 */
function gate(candles,opts){
  opts=opts||{};
  var step=opts.expectedMin||1;
  var maxLag=opts.maxLagMin!=null?opts.maxLagMin:10;
  var now=opts.now||Date.now();
  var tail=opts.contiguityTail!=null?opts.contiguityTail:120;
  var closed=closedOnly(candles);
  if(!closed.length)return {ok:false,reason:'no closed candles',closedCount:0,lastClosed:null,gaps:0,lagMin:null};
  var last=closed[closed.length-1];
  var lastMs=Date.parse(last.time);
  if(!Number.isFinite(lastMs))return {ok:false,reason:'last closed candle time unparseable',closedCount:closed.length,lastClosed:last.time,gaps:0,lagMin:null};
  var lagMin=(now-lastMs)/60000;
  if(lagMin<0)lagMin=0;
  if(lagMin>maxLag)return {ok:false,reason:'STALE: last closed candle is '+lagMin.toFixed(1)+' min old (> '+maxLag+')',closedCount:closed.length,lastClosed:last.time,gaps:0,lagMin:+lagMin.toFixed(2)};
  /* contiguity over the recent tail: a gap > 2x the expected step is a break. */
  var seg=closed.slice(-tail);
  var gaps=0;
  for(var i=1;i<seg.length;i++){
    var d=minutesBetween(seg[i-1].time,seg[i].time);
    if(d>step*2+0.5)gaps++;
  }
  if(gaps>0)return {ok:false,reason:'NOT CONTIGUOUS: '+gaps+' gap(s) in the last '+seg.length+' closed candles',closedCount:closed.length,lastClosed:last.time,gaps:gaps,lagMin:+lagMin.toFixed(2)};
  return {ok:true,reason:'VALID AND CLOSED AND FRESH AND CONTIGUOUS',closedCount:closed.length,lastClosed:last.time,gaps:0,lagMin:+lagMin.toFixed(2)};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAGate=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {closedOnly:closedOnly,gate:gate,minutesBetween:minutesBetween};});
