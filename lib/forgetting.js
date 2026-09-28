'use strict';
/* Forgetting (spec §13). "Remember everything for audit. Trust selectively
 * for reasoning."
 *
 * More memory != more intelligence. Forgetting does NOT delete (audit is
 * preserved in the archive) — it RE-WEIGHTS and MIGRATES so stale/irrelevant/
 * duplicate/low-quality evidence does not compete equally with current,
 * relevant, clean evidence. Operations:
 *   - duplicate compression : collapse identical stateId episodes, keep 1 + count
 *   - decay weighting       : exponential decay by age (half-life configurable)
 *   - regime relevance      : down-weight episodes from a different regime
 *   - bad-data quarantine   : quarantine episodes flagged by the quality gate
 *   - obsolete-generation isolation : quarantine by modelGeneration (v3->v4)
 *   - archive migration     : move low-weight episodes to a cold tier (audit only)
 *
 * The OUTPUT is a weighted recall set: every episode keeps its audit record,
 * but reasoning sees `weight` (0..1) and `quarantined` so it can be trusted
 * selectively. Nothing is lost.
 */
var HOURS=3600000;
/**
 * forget(episodes, opts)
 *  episodes: array (each has stateId, tf, session, newsPhase, modelGeneration,
 *            recordedAt, confidence, correct, value)
 *  opts: { now, halfLifeDays (default 45), currentRegime:{session,newsPhase},
 *          currentGeneration, quarantineProhibited:true, minWeight:0.05 }
 * returns { weighted:[{episode,weight,quarantined,quarantineReason}],
 *           compressedCount, quarantinedCount, archivedCount }
 */
function forget(episodes,opts){
  episodes=episodes||[];opts=opts||{};
  var now=opts.now||Date.now();
  var halfDays=opts.halfLifeDays!=null?opts.halfLifeDays:45;
  var halfMs=halfDays*24*HOURS;
  var curRegime=opts.currentRegime||null;
  var curGen=opts.currentGeneration||null;
  var minW=opts.minWeight!=null?opts.minWeight:0.05;
  /* 1. duplicate compression (audit: keep count, reason on the survivor). */
  var byId={};var order=[];
  episodes.forEach(function(e){var id=e.stateId||('x'+e.recordedAt);
    if(!byId[id]){byId[id]={e:e,count:1};order.push(id);}else{byId[id].count++;}});
  var survivors=order.map(function(id){return byId[id];});
  var compressedCount=episodes.length-survivors.length;
  var out=[];
  survivors.forEach(function(s){
    var e=s.e;
    var reason=null;var quarantined=false;
    /* 5. bad-data quarantine (quality gate). */
    if(opts.quarantineProhibited!==false&&e.confidence&&e.confidence.prohibitions&&e.confidence.prohibitions.length){quarantined=true;reason='BAD_DATA_'+e.confidence.prohibitions.join('_');}
    /* obsolete-generation isolation. */
    if(!quarantined&&curGen!=null&&e.modelGeneration!=null&&String(e.modelGeneration)!==String(curGen)){quarantined=true;reason='OBSOLETE_GENERATION_'+e.modelGeneration;}
    /* 3. regime relevance (down-weight, not quarantine, unless hard mismatch). */
    var regimeMatch=curRegime?(e.session===curRegime.session&&e.newsPhase===curRegime.newsPhase):true;
    /* 2. decay by age. */
    var age=now-Date.parse(e.recordedAt||now);
    var decay=Math.pow(0.5,Math.max(0,age)/halfMs);
    /* base weight from the memory-value importance (if present) else neutral. */
    var base=(e.value&&e.value.value!=null)?(0.3+0.7*e.value.value):0.5;
    var w=base*decay;
    if(!regimeMatch)w*=0.4;
    if(s.count>1)w=Math.min(1,w*Math.min(1,0.6+0.1*s.count)); /* duplicates add a little, capped */
    w=+Math.max(0,Math.min(1,w)).toFixed(4);
    out.push({episode:e,count:s.count,weight:w,quarantined:quarantined,quarantineReason:reason,regimeMatch:regimeMatch,ageDays:+(Math.max(0,age)/(24*HOURS)).toFixed(1)});
  });
  /* 6. archive migration: below minWeight & not quarantined -> archived (audit only). */
  var archivedCount=0;
  out.forEach(function(o){if(!o.quarantined&&o.weight<minW){o.archived=true;archivedCount++;}});
  var quarantinedCount=out.filter(function(o){return o.quarantined;}).length;
  /* reasoning sees weight + quarantine; the raw episode is always retained. */
  out.sort(function(a,b){return (b.quarantined?0:b.weight)-(a.quarantined?0:a.weight);});
  return {weighted:out,compressedCount:compressedCount,quarantinedCount:quarantinedCount,archivedCount:archivedCount,minWeight:minW};
}
/** The recall-facing set: only non-quarantined, non-archived, weight>=min. */
function trustedSet(forgetResult){
  return (forgetResult.weighted||[]).filter(function(o){return !o.quarantined&&!o.archived;});
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMADecay=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {forget:forget,trustedSet:trustedSet,HOURS:HOURS};});
