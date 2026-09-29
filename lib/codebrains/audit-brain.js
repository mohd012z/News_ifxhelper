'use strict';
/* AuditBrain — §22: every prediction carries the refs to reconstruct WHY the
 * model said UP, weeks later.
 */
function auditRefs(input){
  input=input||{};
  var now=input.now?new Date(input.now).toISOString():new Date().toISOString();
  return {
    predictionId:input.predictionId||('pred_'+Math.abs(hash(JSON.stringify(input.asOf||'')+(input.tf||''))).toString(36)),
    featureSnapshotId:input.featureSnapshotId||null,
    sourceIds:input.sourceIds||[],
    modelVersions:input.modelVersions||{bbma:'bbma-candle-watch/v1',empirical:'empirical-memory/v1',regime:'regime-engine/v1'},
    rulesVersion:input.rulesVersion||'codebrains/v1',
    createdAt:now,
    verifiedAt:input.verifiedAt||null,
    settledAt:input.settledAt||null,
    lineage:input.lineage||'UNKNOWN' /* CONSISTENT|MIXED|UNKNOWN — preserved, not overwritten */
  };
}
/* reconstruct the decision path from the stored audit + hypothesis + settlement */
function reconstruct({audit,hypothesis,settlement}){
  var steps=[
    {stage:'VALIDATED',note:'data brain accepted the closed, clean feed'},
    {stage:'FEATURE',note:'locked FeatureSnapshot at '+((hypothesis&&hypothesis.asOf)||'?')},
    {stage:'CONSENSUS',note:'direction='+(hypothesis&&hypothesis.direction)+' regime='+(hypothesis&&hypothesis.regime)+' news='+(hypothesis&&hypothesis.newsStrength)},
    {stage:'FALSIFIERS',note:(hypothesis&&hypothesis.falsifier)||''}
  ];
  if(settlement)steps.push({stage:'SETTLED',note:settlement.verdict+' — '+(settlement.reason||''),correct:settlement.correct,returnPct:settlement.returnPct});
  return {predictionId:audit?audit.predictionId:null,when:audit?audit.createdAt:null,steps:steps,why:'see steps: data quality + locked features + regime + news + falsifier drove the call'};
}
function hash(s){var h=0;for(var i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i);h|=0;}return h;}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAAudit=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {auditRefs:auditRefs,reconstruct:reconstruct};});
