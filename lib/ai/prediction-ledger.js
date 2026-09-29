'use strict';
/* PredictionLedger — immutable, append-only link between the
 * FeatureSnapshot.v2 (what we saw), the PredictionContract.v1 (what we
 * predicted) and the settlement/falsification/outcome (what happened).
 *
 * Design rules:
 *   - append-only: entries are NEVER edited or deleted.
 *   - the snapshot is captured through lib/snapshot-capture.js (clone +
 *     deterministic id + deepFreeze) so the original objects passed in are
 *     left untouched and the stored copy cannot be mutated in place.
 *   - every entry carries the full lineage ids (snapshotId, predictionId,
 *     outcomeId) so a row in the ledger is fully reconstructable.
 *
 * The ledger is a process-local in-memory structure. Persistence is handled
 * by lib/history-store.js (append JSONL by month, SHA-256 dedupe) via the
 * `persist` callback option — keeping this module free of fs so it can run
 * in the browser/shadow path too.
 */
var CAP=(typeof require!=='undefined')?require('../snapshot-capture.js'):null;
var HS=(typeof require!=='undefined')?require('../history-store.js'):null;
function _oid(parts){
  try{
    var crypto=require('crypto');
    return 'out-'+crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,24);
  }catch(e){return 'out-'+Math.abs(parts.join('|').length*2654435761%2147483647).toString(16);}
}
function create(opts){
  opts=opts||{};
  var entries=[];
  function persist(kind,record){
    if(!opts.persist||!HS)return record;
    try{return HS.append(kind,record);}catch(e){return record;}
  }
  /* record a PREDICTION against an already-captured FEATURE snapshot */
  function recordPrediction(featSnapshot,contract,ctx){
    ctx=ctx||{};
    if(!featSnapshot||!featSnapshot.snapshotId)throw new Error('recordPrediction: a captured FEATURE snapshot (with snapshotId) is required');
    if(!contract||!contract.predictionId)throw new Error('recordPrediction: a built PredictionContract (with predictionId) is required');
    var row=CAP?CAP.outcome(featSnapshot.snapshotId,{
      rowType:'PREDICTION',
      predictionId:contract.predictionId,
      direction:contract.hypothesis?contract.hypothesis.direction:null,
      model:contract.model,
      modelVersion:contract.model?contract.model.version:null,
      heuristicScore:contract.heuristicScore,
      targetTime:contract.targetTime,
      status:contract.status,
      sourceEvidenceIds:ctx.sourceEvidenceIds||[]
    }):{snapshotId:featSnapshot.snapshotId,rowType:'PREDICTION',predictionId:contract.predictionId,status:'PENDING'};
    var stored=Object.assign({},row,{createdAt:new Date().toISOString()});
    entries.push(stored);
    if(opts.persist)persist('prediction',stored);
    return Object.assign({snapshotId:featSnapshot.snapshotId,predictionId:contract.predictionId},stored);
  }
  /* record the OUTCOME for a prediction (settlement result + falsification) */
  function recordOutcome(predictionId,snapshotId,result){
    if(!predictionId)throw new Error('recordOutcome: predictionId required');
    var rid=_oid(['outcome',predictionId,result?result.verdict||result.result:null]);
    var row=CAP?CAP.outcome(snapshotId||null,{
      rowType:'OUTCOME',
      outcomeId:rid,
      predictionId:predictionId,
      verdict:result?result.verdict||result.result:null,
      reason:result?result.reason:null,
      correct:result?result.correct:null,
      returnPct:result&&result.actual?result.actual.returnPct:null
    }):{rowType:'OUTCOME',outcomeId:rid,predictionId:predictionId,verdict:result?result.verdict:null};
    var stored=Object.assign({},row,{observedAt:new Date().toISOString()});
    entries.push(stored);
    if(opts.persist)persist('outcome',stored);
    return stored;
  }
  function find(predictionId){
    return entries.filter(function(e){return e.predictionId===predictionId;});
  }
  function entries_(){return entries.slice();}
  function size(){return entries.length;}
  return {recordPrediction:recordPrediction,recordOutcome:recordOutcome,find:find,entries:entries_,size:size};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMALedger=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {create:create};});
