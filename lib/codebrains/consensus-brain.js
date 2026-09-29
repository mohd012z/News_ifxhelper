'use strict';
/* ConsensusBrain — §11: combine the brains into ONE direction call.
 *
 * NOT a simple average: weights shift by regime (illustrative, not proven —
 * the spec is explicit these are placeholders until enough data exists). The
 * in_ai verdict can only CONTRADICT/explain, never set the direction. A
 * CONTRADICTED AI verdict lowers confidence and flags missing evidence.
 */
function regimeWeights(regime){
  /* illustrative — documented as such, not a calibrated constant */
  var W={
    TREND:{bbma:0.30,statistical:0.25,history:0.25,mtf:0.15,ai:0.05,news:0.00},
    RANGE:{bbma:0.35,statistical:0.20,history:0.25,mtf:0.10,ai:0.05,news:0.05},
    SQUEEZE:{bbma:0.25,statistical:0.20,history:0.25,mtf:0.10,ai:0.05,news:0.15},
    EXPANSION:{bbma:0.30,statistical:0.20,history:0.20,mtf:0.15,ai:0.05,news:0.10},
    NEWS_SHOCK:{bbma:0.10,statistical:0.15,history:0.20,mtf:0.10,ai:0.05,news:0.40},
    POST_NEWS:{bbma:0.10,statistical:0.15,history:0.20,mtf:0.10,ai:0.05,news:0.40},
    TRANSITION:{bbma:0.25,statistical:0.20,history:0.25,mtf:0.15,ai:0.15,news:0.00}
  };
  return W[regime]||W.TRANSITION;
}
/**
 * decide({ direction (bbma), statistical, history, mtf, news, ai })
 * each component: { dir: UP|DOWN|RANGE|NULL, weight: 0..1 }  (weight optional;
 *   regime weights used when omitted)
 * returns { direction, confidence, agreement, conflict, drivers, regime }
 */
function decide(inp){
  inp=inp||{};
  var regime=inp.regime||'TRANSITION';
  var w=regimeWeights(regime);
  var parts=[
    {dir:inp.direction,base:w.bbma},
    {dir:inp.statistical&&inp.statistical.dir,base:w.statistical},
    {dir:inp.history&&inp.history.dir,base:w.history},
    {dir:inp.mtf,base:w.mtf},
    {dir:inp.news,base:w.news},
    {dir:inp.ai&&inp.ai.dir,base:w.ai}
  ];
  var score={UP:0,DOWN:0,RANGE:0};var usedW=0;var votes={};
  parts.forEach(function(p,i){
    if(!p.dir)return;
    votes[i]=p.dir;usedW+=p.base;
    score[p.dir]=(score[p.dir]||0)+p.base;
  });
  var best='RANGE',bestS=-1;
  ['UP','DOWN','RANGE'].forEach(function(d){if((score[d]||0)>bestS){bestS=score[d]||0;best=d;}});
  var confidence=usedW?bestS/usedW*100:0;
  var conflict=Object.keys(votes).length>1&&score[best]<usedW*0.6;
  var aiVerdict=inp.ai?inp.ai.verdict:null;
  var drivers=[];
  if(aiVerdict==='CONTRADICTED'){confidence*=0.6;drivers.push('in_ai contradicts (confidence reduced)');}
  if(conflict)drivers.push('brain disagreement (no majority)');
  if((inp.history&&inp.history.status!=='OK')||!inp.history)drivers.push('history insufficient');
  return {
    direction:best,
    confidence:+confidence.toFixed(1),
    agreement:conflict?'CONFLICT':'ALIGNED',
    conflict:conflict,
    regime:regime,
    weights:w,
    aiVerdict:aiVerdict,
    aiMissingEvidence:inp.ai&&inp.ai.missingEvidence||[],
    drivers:drivers
  };
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAConsensusBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {decide:decide,regimeWeights:regimeWeights};});
