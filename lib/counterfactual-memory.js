'use strict';
/* Counterfactual memory (spec §5).
 *
 * For every setup ask: "what happened when almost everything was the same
 * EXCEPT one variable?" This lets the system estimate whether a variable
 * (e.g. news phase) ACTUALLY changes the historical outcome, rather than
 * assuming high-impact news is important.
 *
 *   REENTRY_UP + H1_UP without news: continuation 68%
 *   PRE_NEWS:                         continuation 49%
 *   POST_NEWS:                        continuation 61%
 *
 * Implementation: over the corpus of SETTLED episodes, hold every categorical
 * dimension fixed to the query state and vary ONE dimension across its values.
 * For each arm we report n (samples) + continuationRate (fraction where the
 * next candle's direction continued the setup bias) + a min-sample guard so a
 * 1-sample "arm" is never presented as evidence.
 */
var DIMS=['session','newsPhase','htfH1','htfH4','zone'];
function continuationOf(rec){
  /* rec: { predictedDirection, actualDirection, correct } from a settled episode */
  if(rec.correct==null)return null;
  return rec.correct; /* continued (correct) or not */
}
/**
 * counterfactual(corpus, queryVec, dim)
 *  corpus:  array of { vec:{categorical}, predictedDirection, actualDirection, correct, settled }
 *  queryVec: { categorical:{...} }
 *  dim:     one of DIMS
 * returns { dim, arms:[{value,n,continuationRate,significant}], reference:{value,n,continuationRate} }
 */
function counterfactual(corpus,queryVec,dim){
  dim=dim||'newsPhase';
  var cat=(queryVec&&queryVec.categorical)||{};
  /* arms keyed by the value of `dim` among corpus episodes that match the
     query on ALL OTHER categorical dims. */
  var arms={};
  (corpus||[]).forEach(function(rec){
    if(!rec||!rec.settled)return;
    var rc=(rec.vec&&rec.vec.categorical)||{};
    var othersMatch=true;
    DIMS.forEach(function(d){if(d===dim)return;if(rc[d]!==cat[d])othersMatch=false;});
    /* also require tf match (a M15 setup is only comparable to M15). */
    if(rc.tf!==cat.tf)othersMatch=false;
    if(!othersMatch)return;
    var v=rc[dim]||'UNKNOWN';
    (arms[v]=arms[v]||{n:0,cont:0});
    var c=continuationOf(rec);
    if(c==null)return;
    arms[v].n++;if(c)arms[v].cont++;
  });
  var MIN=3;
  var list=Object.keys(arms).map(function(v){
    var a=arms[v];
    return {value:v,n:a.n,continuationRate:a.n?+((a.cont/a.n)*100).toFixed(1):null,significant:a.n>=MIN};
  });
  list.sort(function(a,b){return (b.continuationRate||0)-(a.continuationRate||0);});
  var ref=cat[dim]!=null?list.filter(function(a){return a.value===cat[dim];})[0]:null;
  return {dim:dim,arms:list,reference:ref||null,minSamples:MIN};
}
/** Spread across arms = how much the variable actually matters. */
function effectSize(cf){
  var sig=cf.arms.filter(function(a){return a.significant;});
  if(sig.length<2)return {spread:null,matters:false,reason:'<2 significant arms'};
  var rates=sig.map(function(a){return a.continuationRate;});
  var spread=Math.max.apply(null,rates)-Math.min.apply(null,rates);
  return {spread:+spread.toFixed(1),matters:spread>=10,significantArms:sig.length};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMACounterfactual=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {DIMS:DIMS,counterfactual:counterfactual,effectSize:effectSize};});
