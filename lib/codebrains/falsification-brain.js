'use strict';
/* FalsificationBrain — "what would prove us wrong?" (§13). The most important
 * brain. Falsifiers are generated BEFORE the next candle exists, so the system
 * is not confirmed by hindsight. After settlement the hypothesis is:
 *   CONFIRMED | FALSIFIED | INCONCLUSIVE | INVALIDATED
 * Failed predictions are NOT deleted — they feed LearningBrain.
 */
function falsifiers(hypothesis,ctx){
  ctx=ctx||{};
  var out=[];
  var d=hypothesis.direction;
  if(d==='UP'){
    out.push('next candle closes DOWN');
    out.push('BB structure breaks (close below LOW_BB)');
    out.push('HTF alignment flips before the window');
  }else if(d==='DOWN'){
    out.push('next candle closes UP');
    out.push('BB structure breaks (close above TOP_BB)');
    out.push('HTF alignment flips before the window');
  }else{
    out.push('close beyond the stated BB range (squeeze breaks)');
  }
  /* source / integrity falsifiers (always present) */
  out.push('source data invalidated (synthetic/stale detected)');
  out.push('future leakage detected in snapshot');
  out.push('timestamp mismatch between feature and candle');
  if(ctx.regime==='TRANSITION')out.push('regime shifts to NEWS_SHOCK before window');
  if(ctx.newsStrength==='REGIME_CHANGE')out.push('news shock redefines regime before window');
  return out;
}
/* evaluate the hypothesis against the ACTUAL next closed candle */
function evaluate(hypothesis,actual,ctx){
  ctx=ctx||{};
  /* integrity first: if the data was invalid, the outcome is INVALIDATED, not a model error */
  if(ctx.dataInvalid)return {verdict:'INVALIDATED',reason:'source data invalid — outcome does not count toward accuracy',correct:null};
  if(ctx.leakage)return {verdict:'INVALIDATED',reason:'future leakage detected — prediction discarded, no credit/debit',correct:null};
  var d=hypothesis.direction;
  var ret=actual&&actual.returnPct;
  var actualDir=actual&&actual.direction;
  if(d==='UP'){
    if(actualDir==='DOWN')return {verdict:'FALSIFIED',reason:'next candle closed DOWN',correct:false};
    if(actualDir==='FLAT')return {verdict:'INCONCLUSIVE',reason:'next candle flat — neither confirms nor falsifies',correct:null};
    return {verdict:'CONFIRMED',reason:'next candle closed UP (return '+(ret!=null?ret.toFixed(3):'n/a')+'%)',correct:true};
  }
  if(d==='DOWN'){
    if(actualDir==='UP')return {verdict:'FALSIFIED',reason:'next candle closed UP',correct:false};
    if(actualDir==='FLAT')return {verdict:'INCONCLUSIVE',reason:'next candle flat — neither confirms nor falsifies',correct:null};
    return {verdict:'CONFIRMED',reason:'next candle closed DOWN (return '+(ret!=null?ret.toFixed(3):'n/a')+'%)',correct:true};
  }
  /* RANGE call: confirmed if the move stays within the band */
  if(actual&&actual.withinBand===false)return {verdict:'FALSIFIED',reason:'close left the range band',correct:false};
  if(actual&&actual.withinBand===true)return {verdict:'CONFIRMED',reason:'close stayed within the range band',correct:true};
  return {verdict:'INCONCLUSIVE',reason:'range outcome could not be determined from actual',correct:null};
}
/* PHASE D — pre-settlement lifecycle (waypoint / mid-watch).
 * The hypothesis is PENDING at T0; while the market is developing we track
 * whether the thesis is SURVIVING or WEAKENED, and whether any falsifier is
 * already SATISFIED (-> FALSIFIED early) or the data went bad (-> INVALID_DATA).
 * We NEVER ask "is it right?" before the outcome — only "has anything proven
 * it wrong (or too thin to judge) yet?"
 *   state: PENDING | SURVIVING | WEAKENED | FALSIFIED | INVALID_DATA
 */
function preEval(hypothesis,obs){
  obs=obs||{};
  if(obs.dataInvalid||obs.leakage||obs.lineageBroken){
    return {state:'INVALID_DATA',falsified:false,weak:false,reason:obs.leakage?'future leakage detected':(obs.lineageBroken?'snapshot lineage broken':'source data invalid'),satisfied:obs.leakage?['future leakage detected in snapshot']:(obs.lineageBroken?['snapshot lineage broke']:['source data invalidated (synthetic/stale detected)'])};
  }
  var d=hypothesis.direction,fals=(hypothesis.falsifiers||[]),reasons=[];
  /* falsifier #1 (direction) satisfied? */
  if(obs.actualDir){
    if((d==='UP'&&obs.actualDir==='DOWN')||(d==='DOWN'&&obs.actualDir==='UP')){
      reasons.push('opposite-direction price action ('+obs.actualDir+')');
      return {state:'FALSIFIED',falsified:true,weak:false,reason:reasons.join('; '),satisfied:[fals[0]]};
    }
  }
  if(obs.regimeShift)reasons.push('regime shifted ('+obs.regimeShift+') before the window');
  if(obs.counterEvidence)reasons.push(obs.counterEvidence);
  if(obs.stale)reasons.push('source quality degraded');
  if(reasons.length===0)return {state:'SURVIVING',falsified:false,weak:false,reason:'no falsifier satisfied; thesis intact',satisfied:[]};
  /* same-direction price action + no counter-evidence -> still SURVIVING */
  var held=(obs.actualDir==='UP'&&(d==='UP'))||(obs.actualDir==='DOWN'&&(d==='DOWN'));
  if(held&&!obs.regimeShift&&!obs.counterEvidence)
    return {state:'SURVIVING',falsified:false,weak:false,reason:'direction held; no falsifier satisfied',satisfied:[]};
  return {state:'WEAKENED',falsified:false,weak:true,reason:reasons.join('; '),satisfied:[]};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFalsification=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {falsifiers:falsifiers,evaluate:evaluate,preEval:preEval};});
