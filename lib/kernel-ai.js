'use strict';

/**
 * Kernel AI: evidence-gated one-step-ahead combiner.
 * This layer does not create BUY/SELL orders. It combines the existing
 * BBMA heuristic with empirical learning evidence and fail-closes when
 * required evidence is weak, stale, conflicted, or synthetic.
 */
const Learning = require('./bbma-learning');

function clamp(v, lo=0, hi=100){
  v=Number(v);
  return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):0;
}

function normalizeQuality(q={}){
  const reasons=[];
  if(q.synthetic){reasons.push('SYNTHETIC_DATA');}
  if(q.stale){reasons.push('STALE_DATA');}
  if(q.continuityBroken){reasons.push('CONTINUITY_BROKEN');}
  if(q.providerConflict){reasons.push('PROVIDER_CONFLICT');}
  if(q.instrumentMismatch){reasons.push('INSTRUMENT_MISMATCH');}
  return {valid:reasons.length===0,reasons};
}

function historicalScore(evidence){
  if(!evidence||!Number.isFinite(+evidence.empiricalAccuracyPct))return null;
  return clamp(evidence.empiricalAccuracyPct);
}

function combine({analysis,evidence,quality={},mtfScore=50,newsState='NORMAL'}={}){
  const next=analysis&&analysis.next||{};
  const q=normalizeQuality(quality);
  const raw=clamp(next.confidence);
  const empirical=historicalScore(evidence);
  const samples=evidence&&Number.isFinite(+evidence.sampleSize)?+evidence.sampleSize:0;
  const reasons=[...(next.reasons||[])];

  if(!q.valid){
    return {state:'WAIT',confidence:0,publishable:false,reasons:[...q.reasons,...reasons],components:{rawBBMA:raw,empirical,samples,mtf:clamp(mtfScore),newsState}};
  }

  if(samples<20||empirical==null){
    return {state:'LEARNING',confidence:Math.min(raw,49),publishable:false,reasons:['INSUFFICIENT_HISTORY',...reasons],components:{rawBBMA:raw,empirical,samples,mtf:clamp(mtfScore),newsState}};
  }

  const newsFactor=newsState==='NEWS_RELEASE'?40:newsState==='PRE_NEWS'?65:newsState==='POST_NEWS'?80:100;
  // Weighted evidence, not a probability. Empirical history receives the
  // largest weight; current BBMA and MTF provide current-regime context.
  let score=raw*0.30+empirical*0.45+clamp(mtfScore)*0.25;
  score=score*(newsFactor/100);
  score=Math.round(clamp(score));

  let state=next.state||'UNKNOWN';
  let publishable=Boolean(evidence&&evidence.publishable);
  if(newsState==='NEWS_RELEASE'){state='WATCH';publishable=false;reasons.unshift('NEWS_RELEASE_GATE');}
  else if(score<55){state='WATCH';publishable=false;reasons.unshift('LOW_CALIBRATED_EVIDENCE');}

  return {state,confidence:score,publishable,reasons,components:{rawBBMA:raw,empirical,samples,mtf:clamp(mtfScore),newsState,newsFactor}};
}

function oneStepAhead({generationId,sourceGeneratedAt,symbol,tf,candle,analysis,marketMode,event,history=[],quality={},mtfScore=50}={}){
  if(!analysis||!analysis.next)return {state:'WAIT',confidence:0,publishable:false,reasons:['MISSING_ANALYSIS']};
  const observation=Learning.createObservation({generationId,sourceGeneratedAt,symbol,tf,candle,analysis,marketMode,event});
  const evidence=Learning.evidenceFor(observation,history);
  const decision=combine({analysis,evidence,quality,mtfScore,newsState:marketMode||'NORMAL'});
  return {schemaVersion:1,method:'KERNEL_AI_1_STEP_AHEAD',observation,evidence,decision};
}

module.exports={clamp,normalizeQuality,historicalScore,combine,oneStepAhead};
