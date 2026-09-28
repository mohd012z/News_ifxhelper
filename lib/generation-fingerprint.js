'use strict';
/* Generation fingerprint (P0 — "fix lineage first").
 *
 * The EXISTING generationId is a DATA identity (hash of symbol + last candle
 * + events) — it changes every cycle, so it cannot distinguish "results from
 * algorithm A" vs "algorithm B". This module adds the ALGORITHM identity:
 *
 *   algoGenerationId = SHA256( engineVersion
 *                            + bbmaRuleVersion
 *                            + featureSchemaVersion
 *                            + resamplerVersion
 *                            + providerIdentity
 *                            + instrumentIdentity
 *                            + configHash )
 *
 * Every observation / prediction / reaction / outcome inherits it, so:
 *   - algorithm A vs B is separable after a rule change
 *   - regression / replay / rollback is reproducible
 *   - historical results from an older algorithm can never masquerade as
 *     current-generation results (the lineage CONSISTENT/MIXED/UNKNOWN
 *     classification now runs over algoGenerationId, not data id).
 *
 * It is DETERMINISTIC in its inputs and depends on no network, no wall clock
 * and no data — the same config always yields the same id.
 */
var crypto=require('crypto');
/* ---- version constants (bump when the named component changes) ---- */
var VERSIONS={
  engineVersion:'bbma-candle-watch/v1',       /* the deterministic BBMA watcher */
  bbmaRuleVersion:'bbma-engine/rules-v2',     /* 50-candle gate, CSA needs MA5+MA10, 7-state zone */
  featureSchemaVersion:'FeatureSnapshot/v2',  /* the immutable snapshot contract (promoted snapshot-capture) */
  resamplerVersion:'ohlc-resampler/v1'
};
function configHash(extra){
  extra=extra||{};
  /* stable key-sorted serialization of the config inputs */
  var keys=Object.keys(extra).sort();
  var parts=[];
  keys.forEach(function(k){parts.push(k+'='+JSON.stringify(extra[k]));});
  return parts.join('|');
}
/**
 * fingerprint({ provider (identity string, e.g. 'yahoo:GC=F'),
 *               instrument (canonical instrument id, e.g. 'GC_FUTURES'),
 *               extraConfig (any stable config object) })
 * returns { algoGenerationId, components:{...}, configHash }
 */
function fingerprint(opts){
  opts=opts||{};
  var provider=opts.provider||'UNKNOWN';
  var instrument=opts.instrument||'UNKNOWN';
  var ch=configHash(opts.extraConfig||{});
  var basis=[
    VERSIONS.engineVersion,
    VERSIONS.bbmaRuleVersion,
    VERSIONS.featureSchemaVersion,
    VERSIONS.resamplerVersion,
    'provider:'+provider,
    'instrument:'+instrument,
    'config:'+ch
  ].join('\n');
  var id='gen-'+crypto.createHash('sha256').update(basis).digest('hex').slice(0,20);
  return {algoGenerationId:id,components:Object.assign({providerIdentity:provider,instrumentIdentity:instrument,configHash:ch},VERSIONS)};
}
/**
 * lineage over observations keyed by algoGenerationId (same CONSISTENT/MIXED/
 * UNKNOWN contract as bbma-learning.lineage, but over the ALGORITHM id so a
 * rule change is visible).
 */
function lineage(rows){
  var ids=[].concat.apply([],(rows||[]).map(function(r){return [r&&r.algoGenerationId];})).filter(Boolean);
  var uniq={};ids.forEach(function(i){uniq[i]=1;});
  var u=Object.keys(uniq);
  var missing=(rows||[]).filter(function(r){return !r||!r.algoGenerationId;}).length;
  if(!u.length)return {status:'UNKNOWN',algoGenerationId:null,generations:0,missing:missing};
  if(u.length===1&&!missing)return {status:'CONSISTENT',algoGenerationId:u[0],generations:1,missing:0};
  return {status:'MIXED',algoGenerationId:null,generations:u.length,missing:missing};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAGeneration=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {fingerprint:fingerprint,lineage:lineage,VERSIONS:VERSIONS,configHash:configHash};});
