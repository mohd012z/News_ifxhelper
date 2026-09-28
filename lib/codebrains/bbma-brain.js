'use strict';
/* BBMABrain — "what structure exists?" (BaselineBrain, §4).
 *
 * THIN WRAP of the existing bbma-candle-watch.js — it does NOT re-implement
 * BBMA (single-authority rule). It only:
 *   1. runs W.location + W.oneStepAhead on the closed window,
 *   2. renames the heuristic `confidence` -> `heuristicScore` (§24),
 *   3. maps the 4-state output to the 1-step direction vocabulary,
 *   4. carries the reasons for explainability.
 * This is a BaselineBrain: input to consensus, NOT the final prediction.
 */
var W=(typeof require!=='undefined')?require('../bbma-candle-watch.js'):null;
function predict(candles,opts){
  opts=opts||{};
  if(!W)return {error:'bbma-candle-watch unavailable'};
  var c=candles||[];
  if(c.length<(opts.min||50))return {state:'INSUFFICIENT',heuristicScore:null,reasons:['<50 closed candles'],direction:null};
  var loc=W.location(c);
  var next=W.oneStepAhead(c);
  var dir=next.state==='UP_BIAS'?'UP':next.state==='DOWN_BIAS'?'DOWN':next.state==='MIXED'?'MIXED':'RANGE';
  return {
    state:next.state,
    direction:dir,
    heuristicScore:next.confidence, /* renamed, NOT a probability */
    reasons:next.reasons||[],
    location:{trend:loc.trend,momentum:loc.momentum,extreme:loc.extreme,csak:loc.csak,reentry:loc.reentry,emaGap:loc.emaGap,zone:loc.zone,band:loc.band,squeeze:loc.squeeze},
    dataNote:next.dataNote||null
  };
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMABrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {predict:predict};});
