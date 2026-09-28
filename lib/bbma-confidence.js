'use strict';
/* Evidence-weighted confidence (spec /calculate). Replaces a single arbitrary
 * confidence number with a DEFENSIBLE weighted score:
 *
 *   DataQuality        30%
 *   BBMA confirmation  25%
 *   MTF alignment      15%
 *   Freshness          10%
 *   News/Macro         10%
 *   Reaction evidence  10%
 *
 * Each factor is a 0..1 score; contribution = factor × weight. Sum → 0..100.
 *
 * HARD RULE (more important than the score): any of these PROHIBITS a
 * CONFIRMABLE verdict regardless of the score, and is surfaced as a
 * `prohibition` the renderer MUST honor:
 *
 *   syntheticData > 0
 *   stale
 *   continuityBroken
 *   instrumentMismatchUnresolved
 *   requiredEvidenceMissing
 *
 * This is the falsification boundary: a GREEN CI/test run does NOT by itself
 * prove the user-facing candle/alert is market-authentic — that is what these
 * gates check at decision time.
 */
var WEIGHTS={dataQuality:30,bbma:25,mtf:15,freshness:10,newsMacro:10,reaction:10};
function clamp01(x){x=+x;return Number.isFinite(x)?Math.max(0,Math.min(1,x)):0;}
/**
 * score(parts)
 *  parts: { dataQuality, bbma, mtf, freshness, newsMacro, reaction,
 *           prohibitions: { syntheticData, stale, continuityBroken,
 *                           instrumentMismatchUnresolved, requiredEvidenceMissing } }
 * returns: { score, breakdown:[{factor,weight,factorScore,contribution}],
 *            prohibitions:[...], confirmable:boolean, verdict:'CONFIRMABLE'|'OBSERVE'|'WAIT' }
 */
function score(parts){
  parts=parts||{};
  var p=parts.prohibitions||{};
  var breakdown=[];
  var total=0;
  Object.keys(WEIGHTS).forEach(function(k){
    var fs=clamp01(parts[k]);
    var contribution=fs*WEIGHTS[k];
    breakdown.push({factor:k,weight:WEIGHTS[k],factorScore:fs,contribution:Math.round(contribution*100)/100});
    total+=contribution;
  });
  var prohibitions=[];
  if((p.syntheticData||0)>0)prohibitions.push('SYNTHETIC_DATA_PRESENT');
  if(p.stale)prohibitions.push('STALE');
  if(p.continuityBroken)prohibitions.push('CONTINUITY_BROKEN');
  if(p.instrumentMismatchUnresolved)prohibitions.push('INSTRUMENT_MISMATCH_UNRESOLVED');
  if(p.requiredEvidenceMissing)prohibitions.push('REQUIRED_EVIDENCE_MISSING');
  var confirmable=prohibitions.length===0;
  var verdict='WAIT';
  if(confirmable){
    var s=Math.round(total*100)/100;
    verdict= s>=70?'CONFIRMABLE': s>=45?'OBSERVE':'WAIT';
  }else{
    verdict='WAIT';
  }
  return {score:Math.round(total*100)/100,breakdown:breakdown,prohibitions:prohibitions,confirmable:confirmable,verdict:verdict,weights:WEIGHTS};
}
/* Map a runtime/CI snapshot to the factor scores + prohibitions (deterministic,
 * from REAL fields only — never invents a number). */
function fromSnapshot(d){
  d=d||{};
  var src=String(d.source||'');
  var feed=d.feed||{};
  var age=feed.latencyMs!=null?feed.latencyMs:(d.freshness==='FRESH_SNAPSHOT'?0:(d.freshness==='STALE_SNAPSHOT'?11*60000:30*60000));
  var synth=0;
  if(/SYNTHETIC|BASELINE|DEMO/.test(src))synth=1;
  var dqc=d.source&&d.source!=='NONE'&&/LIVE_TICK_DERIVED|TWELVEDATA_BACKFILL|REAL/.test(src)?0.9:0;
  /* instrument mismatch: a cross-instrument proxy (GC=F -> XAUUSD) is
     UNRESOLVED unless the snapshot explicitly carries instrument.resolved=true.
     Normalise 'XAU/USD' vs 'XAUUSD' — same instrument, two spellings. */
  var instr=d.instrument||{};
  var normI=function(s){return String(s||'').replace(/[\/\.\s]/g,'').toUpperCase();};
  var crossInstrument=!!(instr.providerSymbol&&instr.analysisSymbol&&normI(instr.providerSymbol)!==normI(instr.analysisSymbol));
  var mismatchUnresolved=crossInstrument&&instr.resolved!==true;
  /* continuity: dropped/gap/out-of-order ticks degrade it */
  var cont=(feed.droppedTicks||0)+(feed.gapDetected?1:0)+(feed.outOfOrderTicks||0);
  var mtf=d.mtf||d.frames||{};
  var ready=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].state==='READY';}).length;
  var total=Object.keys(mtf).length||1;
  var up=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='UP';}).length;
  var dn=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='DOWN';}).length;
  var mtfScore=(up+dn)?Math.max(up,dn)/(up+dn):0;
  return score({
    dataQuality:dqc,
    bbma: ready/total,
    mtf: mtfScore,
    freshness: age<=5*60000?1: age<=10*60000?0.6: age<=30*60000?0.3:0,
    newsMacro: d.newsSummary||d.event?0.65:0.5,
    reaction: d.alertHistory&&d.alertHistory.length?0.7:0.5,
    prohibitions:{
      syntheticData:synth,
      stale: d.fresh===false||d.freshness==='STALE_SNAPSHOT',
      continuityBroken: cont>0,
      instrumentMismatchUnresolved: mismatchUnresolved,
      requiredEvidenceMissing: d.source==='NONE'||!ready
    }
  });
}

/* UMD */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.BBMACConfidence=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {score:score,fromSnapshot:fromSnapshot,WEIGHTS:WEIGHTS};
});
