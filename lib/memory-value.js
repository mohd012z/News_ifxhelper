'use strict';
/* Memory importance scoring (spec §2).
 *
 * Don't retain every observation at equal priority. Each event is scored
 *   MemoryValue = novelty x importance x evidenceQuality x learningValue
 * (each 0..1, product clamped 0..1) and tiered:
 *   - low  -> ARCHIVE_RAW   (kept for audit, NOT aggressively indexed)
 *   - mid  -> INDEX_EPISODIC (stored + indexed for recall)
 *   - high -> INDEX_SEMANTIC_CANDIDATE (may later promote to a semantic fact)
 *
 * The four factors are computed from OBSERVABLE properties of the event, not
 * from a model's mood:
 *   novelty        = how rare this fingerprint is in the recent window
 *   importance     = did something unusual happen (reversal / news shock /
 *                    rare sequence / provider conflict / regime change /
 *                    high-confidence WRONG forecast) vs an ordinary range tick
 *   evidenceQuality= the confidence engine's quality gate (1 = clean, lower as
 *                    prohibitions / gaps appear)
 *   learningValue  = a PREDICTION FAILURE is the highest-value training signal
 *                    (we must recall failures, not just wins)
 */
function clamp01(x){x=+x;if(!Number.isFinite(x))return 0;return Math.max(0,Math.min(1,x));}
/** rarity of a fingerprint in a recent list of stateIds (0..1). 1 = unseen. */
function novelty(stateId, recentIds){
  if(!stateId)return 0;
  recentIds=recentIds||[];
  if(!recentIds.length)return 1;
  var hits=recentIds.filter(function(x){return x===stateId;}).length;
  /* 1 hit in 50 recent -> 0.98; 10 hits -> 0.8; saturates so a common state
     still keeps a small novelty floor. */
  return clamp01(1-hits/Math.max(1,recentIds.length));
}
/** Importance of an event (0..1). Flags are explicit so a human can audit why. */
function importance(evt){
  evt=evt||{};
  var flags=[];var score=0;
  if(evt.bigMove){score+=0.4;flags.push('BIG_MOVE');}
  if(evt.unexpectedReversal){score+=0.45;flags.push('REVERSAL');}
  if(evt.newsShock){score+=0.4;flags.push('NEWS_SHOCK');}
  if(evt.predictionFailure){score+=0.5;flags.push('PREDICTION_FAILURE');}
  if(evt.rareSequence){score+=0.3;flags.push('RARE_SEQUENCE');}
  if(evt.providerConflict){score+=0.35;flags.push('PROVIDER_CONFLICT');}
  if(evt.regimeTransition){score+=0.3;flags.push('REGIME_TRANSITION');}
  if(evt.highConfidenceWrong){score+=0.5;flags.push('HIGH_CONF_WRONG');}
  /* Low-priority: ordinary range, duplicate, unchanged — these actively drag
     the score down (an unchanged M1 range tick is near-zero value). */
  if(evt.ordinaryRange){score-=0.3;flags.push('ORDINARY_RANGE');}
  if(evt.duplicateState){score-=0.3;flags.push('DUPLICATE_STATE');}
  if(evt.unchangedBBMA){score-=0.25;flags.push('UNCHANGED_BBMA');}
  if(evt.noMeaningfulEvent){score-=0.1;flags.push('NO_EVENT');}
  if(!flags.length)flags.push('BASELINE');
  return {value:clamp01(0.15+score),flags:flags};
}
/** Evidence quality 0..1 from the confidence engine's output. */
function evidenceQuality(confidence){
  confidence=confidence||{};
  if(confidence.prohibitions&&confidence.prohibitions.length)return 0;
  if(confidence.score==null)return 0.4;
  return clamp01(confidence.score/100);
}
/** Learning value: a settled prediction that was WRONG (esp. high-confidence)
    is the most valuable training sample. */
function learningValue(evt){
  evt=evt||{};
  if(evt.predictionFailure)return 1;
  if(evt.highConfidenceWrong)return 0.9;
  if(evt.settled&&evt.predictionCorrect==null)return 0.6; /* a settled, informative non-failure */
  if(evt.rareSequence)return 0.7;
  return 0.35; /* default: a fresh observation has some value */
}
/** Score + retention tier for an event. */
function score(evt){
  evt=evt||{};
  var imp=importance(evt);
  var n=novelty(evt.stateId,evt.recentIds);
  var eq=evidenceQuality(evt.confidence);
  var lv=learningValue(evt);
  var v=clamp01(n*imp.value*eq*lv);
  var tier=v>=0.35?'INDEX_SEMANTIC_CANDIDATE':(v>=0.12?'INDEX_EPISODIC':'ARCHIVE_RAW');
  return {value:+v.toFixed(4),novelty:+n.toFixed(4),importance:imp.value,importanceFlags:imp.flags,evidenceQuality:eq,learningValue:lv,tier:tier};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAMemoryValue=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {novelty:novelty,importance:importance,evidenceQuality:evidenceQuality,learningValue:learningValue,score:score,clamp01:clamp01};});
