'use strict';
/* Self-correction gate (spec §14) + knowledge provenance (spec §10).
 *
 * CorrectionCandidate is what IN_AI may PROPOSE. It carries the full evidence:
 *   error / suspected cause / proposed adjustment / supporting history /
 *   contradicting history / replay result / walk-forward result / status
 * Statuses: PROPOSED -> TESTING -> SHADOW -> VALIDATED -> PROMOTED
 *                                   -> REJECTED ;  PROMOTED -> ROLLED_BACK
 *
 * THE KERNEL (Governor) NEVER AUTO-ACCEPTS: promotion is a separate, explicit
 * action that requires (a) status has been through SHADOW, (b) the walk-forward
 * result is non-degrading, and (c) an explicit human/kernel approval token.
 * IN_AI can propose; only the approval path can promote. A promoted correction
 * is RECORDED (provenance) and can be ROLLED_BACK, which isolates it (the
 * knowledge it touched is flagged obsolete-generation, not silently deleted).
 *
 * Provenance (spec §10): every learned conclusion knows WHERE it came from:
 *   knowledgeId / claim / source / observations[] / sampleSize / dateRange /
 *   modelGeneration / methodVersion / lastValidated / contradictingEvidence[]
 * If BBMA detection changes generation v3 -> v4, old knowledge is QUARANTINED
 * to its generation (isolateForGeneration) — it does not silently contaminate
 * the new model. The existing lineage mechanism (CONSISTENT/MIXED/UNKNOWN) is
 * preserved and expanded, not replaced.
 */
var crypto=(typeof require!=='undefined')?require('crypto'):null;
var fs=(typeof require!=='undefined')?require('fs'):null;
var STATUS=['PROPOSED','TESTING','SHADOW','VALIDATED','PROMOTED','REJECTED','ROLLED_BACK'];
function hash(s){return crypto?crypto.createHash('sha256').update(s).digest('hex').slice(0,20):null;}
/** Build a CorrectionCandidate (IN_AI proposes). status is forced to PROPOSED. */
function propose(c){
  c=c||{};
  return {
    correctionId:c.correctionId||('corr_'+hash((c.error||'')+(c.proposedAdjustment||'')+(c.createdAt||''))),
    status:'PROPOSED',
    error:c.error||null,
    suspectedCause:c.suspectedCause||null,
    proposedAdjustment:c.proposedAdjustment||null,
    supportingHistory:c.supportingHistory||[],
    contradictingHistory:c.contradictingHistory||[],
    replayResult:c.replayResult||null,
    walkForwardResult:c.walkForwardResult||null,
    createdAt:c.createdAt||new Date().toISOString(),
    modelGeneration:c.modelGeneration||null,
    methodVersion:c.methodVersion||null,
    history:[{action:'PROPOSED',at:new Date().toISOString(),by:'IN_AI'}]
  };
}
/** IN_AI advances TESTING/SHADOW with evidence (it may NOT jump to PROMOTED). */
function advance(cand,action,evidence){
  if(!cand||!cand.status)return {ok:false,reason:'no candidate'};
  var c=Object.assign({},cand,{history:(cand.history||[]).slice()});
  var now=new Date().toISOString();
  if(action==='TESTING'){if(c.status!=='PROPOSED')return {ok:false,reason:'must be PROPOSED'};c.status='TESTING';}
  else if(action==='SHADOW'){if(c.status!=='TESTING')return {ok:false,reason:'must be TESTING'};if(!cand.replayResult)return {ok:false,reason:'SHADOW requires a replay result'};c.status='SHADOW';}
  else if(action==='VALIDATED'){if(c.status!=='SHADOW')return {ok:false,reason:'must be SHADOW'};if(!cand.walkForwardResult)return {ok:false,reason:'VALIDATED requires a walk-forward result'};c.status='VALIDATED';}
  else if(action==='REJECTED'){c.status='REJECTED';}
  else return {ok:false,reason:'unknown action '+action+' (PROMOTED is kernel-only)'};
  c.history.push({action:action,at:now,evidence:evidence||null,by:'IN_AI'});
  return {ok:true,cand:c};
}
/** KERNEL-only: promote. NEVER auto — requires approval token + non-degrading
 *   walk-forward + status VALIDATED. This is the Governor's conservative gate. */
function promote(cand,approval){
  var c=Object.assign({},cand,{history:(cand.history||[]).slice()});
  if(c.status!=='VALIDATED')return {ok:false,reason:'only a VALIDATED candidate can be promoted (got '+c.status+')'};
  if(!approval||!approval.token)return {ok:false,reason:'promotion requires an explicit approval (Kernel never auto-accepts)'};
  var wf=cand.walkForwardResult||{};
  if(wf.degrading===true)return {ok:false,reason:'walk-forward is degrading — refused'};
  c.status='PROMOTED';
  c.approval=approval;
  c.history.push({action:'PROMOTED',at:new Date().toISOString(),by:approval.by||'KERNEL',token:approval.token});
  return {ok:true,cand:c};
}
function rollBack(cand,reason){
  var c=Object.assign({},cand,{history:(cand.history||[]).slice()});
  if(c.status!=='PROMOTED')return {ok:false,reason:'only a PROMOTED correction can be rolled back'};
  c.status='ROLLED_BACK';c.rollbackReason=reason||null;
  c.history.push({action:'ROLLED_BACK',at:new Date().toISOString(),reason:reason||null,by:'KERNEL'});
  return {ok:true,cand:c};
}
/** ---- knowledge provenance (spec §10) ---- */
function makeKnowledge(k){
  k=k||{};
  return {
    knowledgeId:k.knowledgeId||('k_'+hash((k.claim||'')+(k.modelGeneration||''))),
    claim:k.claim||null,
    source:k.source||'learned',
    observations:k.observations||[],
    sampleSize:k.sampleSize||0,
    dateRange:k.dateRange||null,
    modelGeneration:k.modelGeneration||'unknown',
    methodVersion:k.methodVersion||'v1',
    lastValidated:k.lastValidated||new Date().toISOString(),
    contradictingEvidence:k.contradictingEvidence||[],
    status:k.status||'CANDIDATE'
  };
}
/** Generation change (v3 -> v4): quarantine old-generation knowledge so it
 *   does not silently contaminate the new model. Returns the quarantined list.
 *   The existing lineage (CONSISTENT/MIXED/UNKNOWN) is preserved in each item. */
function isolateForGeneration(knowledgeList,fromGen,toGen){
  knowledgeList=knowledgeList||[];
  var quarantined=[];var current=[];
  knowledgeList.forEach(function(k){
    var g=Object.assign({},k,{history:(k.history||[]).slice()});
    if(String(g.modelGeneration)===String(fromGen)){
      g.status='OBSOLETE_GENERATION';
      g.quarantinedFrom=fromGen;g.quarantinedTo=toGen;g.quarantinedAt=new Date().toISOString();
      g.history.push({action:'QUARANTINED',at:g.quarantinedAt,from:fromGen,to:toGen});
      quarantined.push(g);
    }else current.push(g);
  });
  return {current:current,quarantined:quarantined,toGeneration:toGen,
    note:'old-generation knowledge is quarantined (auditable), not deleted — it no longer feeds the new model'};
}
/** linearity check preserved: lineage from generationIds (CONSISTENT/MIXED/UNKNOWN) */
function lineage(ids){
  ids=(ids||[]).filter(Boolean);
  var set={};ids.forEach(function(i){set[i]=1;});
  var n=Object.keys(set).length;
  return {status:n===0?'UNKNOWN':(n===1?'CONSISTENT':'MIXED'),generationId:n===1?ids[0]:null,generations:n};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAGovernorGate=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {STATUS:STATUS,propose:propose,advance:advance,promote:promote,rollBack:rollBack,makeKnowledge:makeKnowledge,isolateForGeneration:isolateForGeneration,lineage:lineage};});
