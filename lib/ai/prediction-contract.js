'use strict';
/* PredictionContract.v1 — the IMMUTABLE, linked prediction record (PHASE C).
 *
 * Freezes the output of the deterministic heuristic-bbma-v1 baseline model
 * into one contract object that every downstream brain/settlement/ledger
 * entry references:
 *
 *   predictionId  deterministic sha256(id, snapshotId, modelId, modelVersion,
 *                 targetTime, direction) — no wall-clock component, so the
 *                 same prediction built twice is the SAME id
 *   snapshotId    links the FeatureSnapshot.v2 it was predicted FROM
 *   targetTime    the EXACT next closed candle's open (settlement anchor)
 *   falsifiers[]  generated BEFORE the target candle exists
 *
 * Once built the contract is deep-frozen: an outcome can never modify the
 * original hypothesis — settlement appends a SEPARATE record (the ledger)
 * that REFERENCES this contract by predictionId.
 */
var FAL=(typeof require!=='undefined')?require('../codebrains/falsification-brain.js'):null;
function n(v){return Number.isFinite(+v)?+v:null;}
function _id(parts){
  try{
    var crypto=require('crypto');
    return 'pred-'+crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,24);
  }catch(e){return 'pred-'+Math.abs(parts.join('|').length*2654435761%2147483647).toString(16);}
}
function deepFreeze(o){if(!o||typeof o!=='object')return o;Object.freeze(o);Object.keys(o).forEach(function(k){deepFreeze(o[k]);});return o;}
function tfMin(tf){var m={'M1':1,'M5':5,'M15':15,'M30':30,'H1':60,'H4':240,'D1':1440,'W1':10080};return m[String(tf||'M15').toUpperCase()]||15;}
/**
 * build({ snapshotId, tf, instrumentId, asOf (ISO of the closed candle the
 *   prediction is anchored to), forecast (one-step-engine output),
 *   falsifiers (pre-candle list; auto-generated when omitted), createdAt })
 * Returns a deep-frozen PredictionContract.v1 with status PENDING.
 */
function build(inp){
  inp=inp||{};
  var f=inp.forecast||{};
  var asOf=inp.asOf!=null?inp.asOf:(f.asOf||null);
  var tf=String(inp.tf||f.tf||'M15').toUpperCase();
  var step=tfMin(tf)*60000;
  var targetTime=asOf!=null?new Date(Date.parse(asOf)+step).toISOString():null;
  var direction=f.direction||'UNKNOWN';
  var modelId=f.modelId||'heuristic-bbma-v1';
  var modelVersion=f.modelVersion||'v1';
  var id=_id(['PredictionContract',inp.snapshotId||'nosnap',modelId,modelVersion,targetTime||'notarget',direction]);
  var fals=(inp.falsifiers&&inp.falsifiers.length)?inp.falsifiers
    :(FAL&&asOf!=null)?FAL.falsifiers({direction:direction,asOf:asOf},f.regime?f.regime:{})
    :['exact next closed candle contradicts the direction'];
  var c={
    schema:'PredictionContract/v1',
    predictionId:id,
    snapshotId:inp.snapshotId||null,
    instrumentId:inp.instrumentId||null,
    timeframe:tf,
    sourceCandleTime:asOf,
    createdAt:(inp.createdAt!=null?new Date(inp.createdAt).toISOString():null),
    targetTime:targetTime,
    horizon:'EXACT_NEXT_CANDLE',
    hypothesis:{
      direction:direction,
      movementClass:f.movementClass||'UNKNOWN',
      alternative:f.expectedRange?f.expectedRange.note:null
    },
    model:{id:modelId,version:modelVersion},
    heuristicScore:n(f.heuristicScore),
    heuristicState:f.heuristicState||null,
    empiricalEvidence:f.empirical||null,
    reasonCodes:(f.reasons&&f.reasons.length)?f.reasons.slice():null,
    evidenceRefs:inp.evidenceRefs||[],
    falsifiers:deepFreeze(fals.slice()),
    status:'PENDING'
  };
  return deepFreeze(c);
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAPredictionContract=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {build:build,tfMin:tfMin};});
