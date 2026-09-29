'use strict';
/* FeatureSnapshot.v1 (P2) — an IMMUTABLE, leakage-free state vector anchored
 * to the CLOSED candle being predicted from.
 *
 * The snapshot is a pure function of `candles[0..anchor]` where anchor is the
 * last CLOSED candle (candleClose). Every feature's lookback window is bounded
 * to candles that close at or before the anchor. Candles that close AFTER the
 * anchor (the future, including the next candle that is the PREDICTION TARGET)
 * are never read. This is what makes "No future information" checkable.
 */
var FP=(typeof require!=='undefined')?require('../state-fingerprint.js'):null;
var CAP=(typeof require!=='undefined')?require('../snapshot-capture.js'):null;
function n(v){return Number.isFinite(+v)?+v:null;}
function r3(v){return v==null?null:+(+v).toFixed(3);}
function pct(a,b){return n(a)!=null&&n(b)!=null&&n(b)?((n(a)-n(b))/Math.abs(n(b)))*100:null;}
function sideFromGap(emaGap){if(emaGap==='EMA50_ABOVE_BB')return 'ABOVE';if(emaGap==='EMA50_BELOW_BB')return 'BELOW';if(emaGap==='EMA50_INSIDE_BB')return 'AT';return 'UNKNOWN';}
function midDist(values){if(values&&n(values.close)!=null&&values.bb&&n(values.bb.mid)!=null)return (values.close-values.bb.mid)/Math.abs(values.bb.mid);return null;}
function atrPct(c,period){period=period||14;var a=c||[];if(a.length<2)return null;var tr=[];for(var i=1;i<a.length;i++){var hi=n(a[i].high),lo=n(a[i].low),pc=n(a[i-1].close);tr.push(Math.max(hi-lo,Math.abs(hi-pc),Math.abs(lo-pc)));}var w=tr.slice(-period);var avg=w.reduce(function(x,y){return x+y;},0)/w.length;var close=n(a[a.length-1].close);return close?avg/close*100:null;}
function deepFreeze(o){if(!o||typeof o!=='object')return o;Object.freeze(o);Object.keys(o).forEach(function(k){deepFreeze(o[k]);});return o;}
/**
 * build({ candles (closed, time-ordered), asOf (ISO — the closed candle to
 *   anchor on; default last candle), analysis, squeeze, news, instrument, tf,
 *   dataClass, generationId, mtf, now })
 * Returns a FROZEN snapshot that depends ONLY on candles closing <= asOf.
 */
function build(inp){
  inp=inp||{};
  var all=inp.candles||[];
  var asOf=(inp.asOf!=null)?inp.asOf:(all.length?all[all.length-1].time:null);
  /* bound the window to candles closing at or before the anchor (the future
     — including the prediction-target candle — is excluded BY CONSTRUCTION). */
  var c=asOf?all.filter(function(x){return !x.time||Date.parse(x.time)<=Date.parse(asOf);}).sort(function(a,b){return Date.parse(a.time)-Date.parse(b.time);}):all;
  var last=c.length?c[c.length-1]:null;
  if(!last)return {schema:'FeatureSnapshot/v1',error:'NO_CLOSED_CANDLE',candleClose:null};
  var a=inp.analysis||{};var bb=a.bbma||a;var loc=a.location||a;var dist=loc.distance||{};var sq=inp.squeeze||{};var news=inp.news||{state:'NO_EVENT'};var inst=inp.instrument||null;
  var sessionName=FP?FP.sessionOf(last.time):'UNKNOWN';
  var firstSessionCandle=false;
  if(last&&FP&&c.length>1){var s0=FP.sessionOf(c[c.length-2].time);firstSessionCandle=(s0!==sessionName);}
  var mtf={};for(var k in (inp.mtf||{}))mtf[k]={trend:(inp.mtf[k]||{}).trend||null,state:(inp.mtf[k]||{}).state||null};
  var snap={
    schema:'FeatureSnapshot/v2',
    snapshotId:CAP?CAP.idFor('FEATURE',asOf?{symbol:(inst?inst.display:'XAU/USD'),timeframe:String(inp.tf||'M15').toUpperCase(),candleTime:asOf}:{},'v2'):null,
    symbol:inst?inst.display:'XAU/USD',
    instrumentId:inst?(inst.analysisSymbol||inst.providerSymbol||'UNKNOWN'):'UNKNOWN',
    tf:String(inp.tf||'M15').toUpperCase(),
    candleClose:last.time,
    dataClass:inp.dataClass||'UNKNOWN',
    generationId:inp.generationId||null,
    builtAt:inp.now?new Date(inp.now).toISOString():null,
    bbma:{trend:bb.trend||null,momentum:bb.momentum||null,extreme:bb.extreme||null,reentry:bb.reentry||null,csak:bb.csak||null,emaGap:bb.emaGap||null,zone:loc.zone||bb.zone||null},
    location:{bbZone:loc.zone||bb.zone||null,ema50Side:sideFromGap(bb.emaGap),distanceMidBB:r3(midDist(bb.values||null))},
    volatility:{atrBand:FP&&c.length?FP.atrPctile(c):null,atrPct:r3(atrPct(c)),bbWidthPct:r3(sq.widthPct!=null?sq.widthPct:null),squeezePercentile:r3(sq.percentile!=null?sq.percentile:null),expanding:!!sq.expanding,squeeze:sq.squeeze||null},
    candle:loc.candle?{direction:loc.candle.direction,bodyRatio:loc.candle.bodyRatio,upperWick:loc.candle.upperWick,lowerWick:loc.candle.lowerWick}:{direction:last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT',bodyRatio:null,upperWick:null,lowerWick:null},
    session:{name:sessionName,firstSessionCandle:firstSessionCandle,distanceFromMid:r3(dist.midPct!=null?dist.midPct/100:null)},
    news:{mode:news.state||'NO_EVENT',eventImportance:news.event?news.event.impact:null,minutesToEvent:news.minutes!=null?news.minutes:null,eventName:news.event?news.event.title:null},
    mtf:mtf
  };
  return deepFreeze(snap);
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFeatureSnapshot=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {build:build};});
