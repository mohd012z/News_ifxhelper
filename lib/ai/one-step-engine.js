'use strict';
/* OneStepEngine (P3) — turns a FeatureSnapshot into a OneStepForecast
 * candidate. The deterministic BBMA heuristic is the BASELINE model; it is
 * NOT a probability (renamed heuristicScore per §24). Direction/movement/
 * invalidation all come from the closed-candle state only.
 *
 * The engine NEVER publishes. It emits a CANDIDATE; the Verifier/consensus
 * gate decides whether it can even be a PENDING forecast, and settlement is
 * by the exact next closed candle only.
 */
var W=(typeof require!=='undefined')?require('../bbma-candle-watch.js'):null;
var REG=(typeof require!=='undefined')?require('./regime-engine.js'):null;
function n(v){return Number.isFinite(+v)?+v:null;}
function r3(v){return v==null?null:+(+v).toFixed(3);}
function _dom(a,b,c){for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v&&v!=='NONE'&&v!=='UNKNOWN')return v.toUpperCase();}return 'UNKNOWN';}
/**
 * predict(snap, { analysis (W.location output), next (W.oneStepAhead output),
 *                  corpus (settled episodes), minSamples })
 * returns { schema, asOf, tf, direction, movementClass, expectedRange, bbContext,
 *   invalidation, heuristicScore, heuristicState, empirical, regime, status:'CANDIDATE' }
 */
function predict(snap,opts){
  opts=opts||{};
  if(!snap||snap.error){return {schema:'OneStepForecast/v1',status:'REJECTED',reason:'no valid snapshot'};}
  if(!W){return {schema:'OneStepForecast/v1',status:'REJECTED',reason:'bbma-candle-watch unavailable'};}
  var next=opts.next||W.oneStepAhead(opts.candles||[]);
  var dir=next.state; /* UP_BIAS|DOWN_BIAS|MIXED|RANGE_OR_BREAKOUT_WATCH */
  var direction=dir==='UP_BIAS'?'UP':dir==='DOWN_BIAS'?'DOWN':'RANGE';
  var loc=opts.analysis||{};
  var squeeze=(loc.squeeze!=null)?loc.squeeze:(snap.volatility&&snap.volatility.squeeze);
  var movement=moveClass(snap,squeeze);
  var range=expectedRange(snap);
  var invalid=invalidation(snap,direction,range);
  var empirical=null;
  if(opts.corpus&&opts.corpus.length){
    var EM=require('./empirical-memory.js');
    var bbmaTok=_dom(snap.bbma.reentry,snap.bbma.momentum,snap.bbma.trend); /* mirror patternOf */
    var q={tf:snap.tf,bbma:bbmaTok,zone:snap.location.bbZone,volatility:snap.volatility.atrBand,session:snap.session.name,news:snap.news.mode,trend:snap.mtf&&snap.mtf.H1&&snap.mtf.H1.trend,memoryRoot:opts.memoryRoot||null};
    var m=EM.match(q,opts.corpus,{minSamples:opts.minSamples});
    empirical={level:m.level,rate:m.rate,basis:m.basis,samples:m.samples,ok:m.ok};
  }
  var regime=REG?REG.classify(snap):{regime:'UNKNOWN',reason:'regime lib unavailable',newsPass:true};
  return {
    schema:'OneStepForecast/v1',
    asOf:snap.candleClose, tf:snap.tf,
    direction:direction, movementClass:movement,
    expectedRange:range,
    bbContext:bbContext(snap),
    invalidation:invalid,
    heuristicScore:next.confidence, /* renamed from `confidence` per §24 — a heuristic score, NOT a probability */
    heuristicState:dir,
    empirical:empirical,
    regime:regime,
    dataClass:snap.dataClass,
    status:'CANDIDATE' /* only a candidate — verifier decides PENDING */
  };
}
function moveClass(s,squeezeToken){
  if(!s)return 'UNKNOWN';
  var sq=(squeezeToken!=null)?squeezeToken:(s.volatility&&s.volatility.squeeze);
  if(sq==='SQUEEZE'||sq==='TIGHT')return 'EXPANSION-WATCH'; /* compression -> breakout watch */
  if(s.volatility&&s.volatility.expanding)return 'EXPANSION';
  var band=s.volatility&&s.volatility.atrBand;
  if(band==='LOW')return 'SMALL';
  return 'NORMAL';
}
function expectedRange(s,atrPctAbs){
  if(!s)return null;
  var a=atrPctAbs!=null?atrPctAbs:(s.volatility&&s.volatility.atrPct);
  if(a==null){var band=s.volatility&&s.volatility.atrBand;if(band)a={LOW:0.06,NORMAL:0.18,HIGH:0.35,VERY_HIGH:0.6}[band]||null;}
  if(a==null)return null;
  var mult=(moveClass(s)==='EXPANSION')?1.0:0.8;
  return {atrPct:a,estMovePct:r3(a*mult*100),note:'ATR-normalized; research estimate, not a price target'};
}
function invalidation(s,dir,range){
  var out=[];
  if(dir==='UP'){out.push('close below anchor low');out.push('BB top rejection + bear HTF divergence');}
  if(dir==='DOWN'){out.push('close above anchor high');out.push('BB bottom rejection + bull HTF divergence');}
  if(dir==='RANGE'){out.push('close beyond BB band (squeeze breaks)');}
  if(s.news&&s.news.minutesToEvent!=null&&s.news.minutesToEvent<=60)out.push('news release inside 60 min (regime may shift)');
  return out;
}
function bbContext(s){
  if(!s||!s.location)return null;
  var z=s.location.bbZone;
  if(z==='LOW_BB')return 'Low BB -> Mid BB (mean reversion toward mid)';
  if(z==='TOP_BB')return 'Top BB -> Mid BB (mean reversion toward mid)';
  if(z==='MID_BB')return 'Mid BB hold (trend continuation)';
  if(z==='INSIDE_BB')return 'Inside BB (no edge until re-entry)';
  return z?('Near '+z):null;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAOneStep=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {predict:predict,moveClass:moveClass};});
