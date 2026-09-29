'use strict';
/* in_ai Brain — §10 / §14: the sidecar CONTEXT/REASONING brain.
 *
 * in_ai is NOT a final market predictor. Its role here is to review a compact
 * structured state (the candidate + evidence) and return a STRUCTURED
 * assessment — never a free-form prediction:
 *
 *   verdict: SUPPORTED | PARTIAL | CONTRADICTED | INSUFFICIENT
 *   conflicts: [...]        (evidence that argues against the candidate)
 *   missingEvidence: [...]  ("what is missing?")
 *   regime: TREND_CONTINUATION | ...
 *   reasonCodes: [...]
 *
 * This is a DETERMINISTIC review (the adapter contract). A real in_ai LLM call
 * (POST /api/generate, command /market-one-step-review) would fill the same
 * shape; the deterministic version means the pipeline runs with zero external
 * dependency and the LLM is OPTIONAL. It can never publish — it only informs
 * the consensus (which can lower confidence on CONTRADICTED).
 */
function review(state){
  state=state||{};
  var cand=state.candidate||{};
  var ev=state.evidence||{};
  var conflicts=[];var missing=[];var reasons=[];
  var dir=cand.state||cand.direction||null;
  /* regime explanation */
  var regime='NEUTRAL';
  var mtf=ev.mtf||{};var up=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='UP';}).length;
  var dn=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='DOWN';}).length;
  if(up>=2&&dn===0)regime='TREND_CONTINUATION';
  else if(dn>=2&&up===0)regime='TREND_REVERSAL';
  else if(up&&dn)regime='HTF_CONFLICT';
  if(ev.news&&(ev.news.strength==='REGIME_CHANGE')){regime='NEWS_DRIVEN';conflicts.push('news may redefine the regime (do not extrapolate pre-news behavior)');reasons.push('NEWS_REGIME_CHANGE');}
  if(ev.data&&(ev.data.synthetic||ev.data.stale)){conflicts.push('data quality flag: '+(ev.data.synthetic?'synthetic':'stale'));missing.push('clean observed data');}
  if(ev.history&&ev.history.status==='INSUFFICIENT_HISTORY'){missing.push('sufficient historical analogues');conflicts.push('no comparable history — direction is untested');}
  /* contradiction checks */
  if(dir==='UP'&&dn>=2){conflicts.push('HTF aligned DOWN contradicts UP call');reasons.push('MTF_CONFLICT');}
  if(dir==='DOWN'&&up>=2){conflicts.push('HTF aligned UP contradicts DOWN call');reasons.push('MTF_CONFLICT');}
  if(ev.data&&ev.data.isProxy)missing.push('direct spot instrument (currently a proxy)');
  if(ev.volatility&&/SQUEEZE|TIGHT/.test(ev.volatility.squeeze||'')&&dir!=='RANGE')reasons.push('SQUEEZE_BREAKOUT_RISK');
  if(ev.bbma&&/REENTRY/.test(ev.bbma.reentry||'')&&/TREND_CONTINUATION/.test(regime))reasons.push('REENTRY_CONTEXT');
  if(regime==='TREND_CONTINUATION')reasons.push('MTF_ALIGNED');
  /* verdict */
  var verdict;
  if(missing.length>=2)verdict='INSUFFICIENT';
  else if(conflicts.length)verdict='CONTRADICTED';
  else if(reasons.length>=2)verdict='SUPPORTED';
  else if(reasons.length)verdict='PARTIAL';
  else verdict='INSUFFICIENT';
  return {schema:'in_ai/one-step-review',verdict:verdict,regime:regime,conflicts:conflicts,missingEvidence:missing,reasonCodes:reasons,canPublish:false};
}
/* compact request builder (what would be POSTed to in_ai /api/generate) */
function buildRequest(state){
  return {command:'/market-one-step-review',symbol:state.symbol, timeframe:state.timeframe, candidate:{state:(state.candidate&&state.candidate.state)||null,heuristicConfidence:(state.candidate&&state.candidate.heuristicConfidence)||null}, evidence:{bbma:state.evidence&&state.evidence.bbma||{},news:state.evidence&&state.evidence.news||{},history:state.evidence&&state.evidence.history||{},crossAsset:state.evidence&&state.evidence.crossAsset||{}}};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAinAI=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {review:review,buildRequest:buildRequest};});
