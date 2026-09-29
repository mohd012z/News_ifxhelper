'use strict';
/* intelligence-lineage — the Learning Lineage Gate for Intelligence-360.
 *
 * Decides whether a generated PERFORMANCE snapshot (bbma-performance.json)
 * may be used to feed learning / confidence-boost for the CURRENT watch
 * generation. Two independent data streams must AGREE on which algorithm
 * generation produced them, and the performance data must be FRESH:
 *
 *   watchGenerationId       the data generationId of the current bbma-watch.json
 *   performanceGenerationId the data generationId the performance rows were
 *                           settled under (from bbma-performance.json)
 *
 *   CONSISTENT : ids match + fresh   -> learning usable, confidence boost allowed
 *   MISMATCH   : ids differ          -> the performance was produced by a
 *                (older/newer rules) different engine/ruleset; never count it as
 *                current-generation performance
 *   UNKNOWN    : performance has no  -> cannot prove provenance; refuse to use it
 *                generationId
 *   STALE      : ids match but the    -> data too old to be trusted (age > maxAgeMinutes)
 *                performance is old
 *
 * The gate is READ-ONLY: it never edits the snapshots, it only decides
 * usability. This is the "Remember everything for audit, trust selectively
 * for reasoning" rule applied to the learning feed.
 */
function isoToMs(v){
  if(v==null)return null;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const t=Date.parse(v);
  return Number.isFinite(t)?t:null;
}
/**
 * evaluate({ watchGenerationId, performanceGenerationId,
 *            watchGeneratedAt?, performanceGeneratedAt?, maxAgeMinutes?, now? })
 * -> { status, learningUsable, confidenceBoostAllowed, reason }
 */
function evaluate(inp){
  inp=inp||{};
  const w=inp.watchGenerationId||null;
  const p=inp.performanceGenerationId||null;

  /* 1) no provenance on the performance data -> cannot trust it */
  if(p==null||p===''){
    return {status:'UNKNOWN',learningUsable:false,confidenceBoostAllowed:false,
      reason:'performance has no generationId — provenance cannot be established'};
  }
  /* 2) different algorithm generation -> not current-performance */
  if(w!==p){
    return {status:'MISMATCH',learningUsable:false,confidenceBoostAllowed:false,
      reason:'performance generationId ('+p+') != watch generationId ('+w+') — different ruleset, excluded'};
  }
  /* 3) fresh? only gate when the caller supplies a freshness budget */
  if(inp.maxAgeMinutes!=null){
    const ref=isoToMs(inp.now!=null?inp.now:inp.watchGeneratedAt);
    const perf=isoToMs(inp.performanceGeneratedAt);
    if(ref!=null&&perf!=null){
      const ageMin=(ref-perf)/60000;
      if(ageMin>inp.maxAgeMinutes){
        return {status:'STALE',learningUsable:false,confidenceBoostAllowed:false,
          reason:'performance is '+ageMin.toFixed(0)+' min old (> '+inp.maxAgeMinutes+' min budget)'};
      }
    }
  }
  return {status:'CONSISTENT',learningUsable:true,confidenceBoostAllowed:true,
    reason:'same generationId, fresh — learning usable'};
}
module.exports={evaluate};
/* Browser (UMD) parity with the other lib primitives. */
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAIntelligenceLineage=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {evaluate:evaluate};});
