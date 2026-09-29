'use strict';
/* EvidenceBrain — §21: normalized evidence envelope.
 *
 * Wraps the existing evidence envelope (source, sourceAt, fetchedAt, latency,
 * quality, freshness, status, fallbackUsed) and adds the prediction/settlement
 * refs so one EvidenceObject links source -> feature -> prediction -> settlement.
 */
function envelope(input){
  input=input||{};
  return {
    schemaVersion:1,
    agent:input.agent||'News_ifxhelper',
    source:input.source||'UNKNOWN',
    observationTime:input.observationTime||input.sourceAt||null,
    receivedTime:input.receivedTime||input.fetchedAt||new Date().toISOString(),
    integrity:input.integrity||'OK',
    quality:input.quality||'UNKNOWN',
    freshness:input.freshness||null,
    status:input.status||'OK',
    fallbackUsed:!!input.fallbackUsed,
    dataClass:input.dataClass||null,
    featureSnapshotId:input.featureSnapshotId||null,
    predictionId:input.predictionId||null,
    settlementId:input.settlementId||null,
    evidence:input.evidence||[],
    conflicts:input.conflicts||[]
  };
}
/* link a prediction + settlement to the envelope (returns a new envelope) */
function link(base,predId,settleId){
  var e=envelope(base);
  e.predictionId=predId||e.predictionId||null;
  e.settlementId=settleId||e.settlementId||null;
  return e;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAEvidence=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {envelope:envelope,link:link};});
