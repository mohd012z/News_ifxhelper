'use strict';
/* F0 — INSTRUMENT MEMORY ISOLATION (formation-memory deep-dive §11, P0).
 *
 * The active leak: lib/state-fingerprint.js normAsset() mapped GC=F (Yahoo
 * futures proxy) to the SAME 'GOLD' token as XAUUSD spot — so every
 * formation fingerprint and learning episode keyed as if it were spot.
 * Proxy observations must NEVER contaminate XAUUSD semantic memory.
 *
 * Policy:
 *   memoryRoot(instrument)      — the per-instrument memory partition.
 *                                 canonicalId + '_PROXY' when the data is a
 *                                 proxy, else canonicalId.
 *   sameMemoryA(a, b)           — the ONLY join rule across partitions:
 *                                 exact same memoryRoot. No asset-level
 *                                 cross-matching.
 *   crossResearchKey(a)         — the opt-in proxy→target experiment bucket
 *                                 (proxyResearch/GC=F→XAUUSD), never used
 *                                 for normal historical recall.
 *   contaminated()              — true when a record lacks a memoryRoot
 *                                 (pre-F0 records): isolate, never match.
 */
function normId(x){return String(x||'UNKNOWN').toUpperCase();}
/* Derive the canonical instrument id when a record predates canonicalId
   (e.g. lib/instrument.js gcF() has isProxy/proxyFor but no canonicalId). */
function canonicalIdOf(inst){
  if(!inst)return 'UNKNOWN';
  if(inst.canonicalId)return normId(inst.canonicalId);
  var pfx=normId(inst.proxyFor||inst.analysisSymbol||'');
  var mt=normId(inst.marketType||inst.source||'');
  if(inst.isProxy||mt.indexOf('FUT')>=0)return pfx==='XAUUSD'?'GC_FUTURES':pfx;
  if(mt.indexOf('TOKENIZED')>=0||mt.indexOf('CRYPTO')>=0)return (pfx==='XAUUSD'?'XAUSDT':pfx)+'_PROXY';
  return pfx||'UNKNOWN';
}
function proxyFlag(inst){
  if(!inst)return false;
  if(inst.proxyStatus)return inst.proxyStatus==='PROXY';
  if(inst.isProxy!=null)return !!inst.isProxy;
  var mt=String(inst.marketType||'').toUpperCase();
  return mt.indexOf('FUT')>=0||mt.indexOf('TOKENIZED')>=0;
}
function memoryRoot(inst){
  var id=canonicalIdOf(inst);
  return proxyFlag(inst)?id+'_PROXY':id;
}
function sameMemoryA(a,b){return memoryRoot(a)===memoryRoot(b);}
function crossResearchKey(a){
  if(!a||!proxyFlag(a))return null;
  var target=a.proxyFor||a.analysisSymbol||null;
  if(!target)return null;
  return normId(a.canonicalId)+'→'+normId(target);
}
function contaminated(inst){
  /* A record with no memoryRoot cannot be attributed to an instrument
     (pre-F0 behavior). Isolate it; never match it. */
  return !inst||!inst.memoryRoot;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAMemoryPartition=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {normId:normId,canonicalIdOf:canonicalIdOf,proxyFlag:proxyFlag,memoryRoot:memoryRoot,sameMemoryA:sameMemoryA,crossResearchKey:crossResearchKey,contaminated:contaminated};});
