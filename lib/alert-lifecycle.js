'use strict';
/* Alert lifecycle (spec /alerts §6). Replaces "BBMA → BUY/SELL → Telegram"
 * with a deterministic evidence-first pipeline:
 *
 *   DETECTED → DATA_VALIDATED → MTF_VALIDATED → NEWS_CHECKED →
 *   EVIDENCE_COMPLETE → CONFIRMABLE → ALERT → REACTION → OUTCOME
 *
 * A signal is at stage N only if EVERY stage before N passed (contiguous).
 * The QUALITY GATE OVERRIDES THE SCORE (spec §5): a confidence score of 85 or
 * 100 cannot turn invalid evidence valid — if `confidence.prohibitions` is
 * non-empty (synthetic>0 / stale / continuityBroken / instrumentMismatch /
 * requiredEvidenceMissing) the signal NEVER reaches CONFIRMABLE, full stop.
 *
 * The payload is evidence-first (replay/falsification friendly) — it states
 * WHAT is observed, never an imperative:
 *   XAU/USD • M15 RE-ENTRY UP / HTF H1 UP · H4 UP / BBMA REENTRY /
 *   Location MA5-10 LOW / News CLEAR / Source SPOT / Age 1.8s /
 *   Quality VALID / Evidence COMPLETE / State: CONFIRMABLE
 *   — NOT "BUY GOLD NOW HIGH CONFIDENCE".
 *
 * Publishability boundary preserved: reaching CONFIRMABLE is a STATEMENT of
 * evidence quality only. Stage ALERT is only reached when an EXTERNALLY
 * validated alert (HELIX) exists — a technical signal can never self-promote
 * to a Telegram post.
 */
var STAGES=['DETECTED','DATA_VALIDATED','MTF_VALIDATED','NEWS_CHECKED','EVIDENCE_COMPLETE','CONFIRMABLE','ALERT','REACTION','OUTCOME'];
/* Explicit stage -> checks-key map (keys are camelCase; a naive lower/strip
   mangles DATA_VALIDATED -> datavalidated). */
var CHECK_KEY={DETECTED:'detected',DATA_VALIDATED:'dataValidated',MTF_VALIDATED:'mtfValidated',NEWS_CHECKED:'newsChecked',EVIDENCE_COMPLETE:'evidenceComplete',CONFIRMABLE:'confirmable',ALERT:'alert',REACTION:'reaction',OUTCOME:'outcome'};
var NEWS_PASS=['CLEAR','NO_EVENT','NORMAL'];
function idx(s){var i=STAGES.indexOf(s);return i<0?0:i;}
function isRealSource(src){return !!src&&/LIVE_TICK_DERIVED|TWELVEDATA_BACKFILL|REAL|SPOT/.test(src)&&!/SYNTHETIC|BASELINE|DEMO/.test(src);}
function fmtAge(ms){if(ms==null)return '—';if(ms>=1000)return (Math.round(ms/100)/10)+'s';return ms+'ms';}
/**
 * evaluateStage(s)
 *  s: { signalPattern?, signalDirection?, source, fresh, freshness,
 *       mtf: {TF:{state,trend}}, readyMin (default 3),
 *       newsState, feed:{latencyMs,droppedTicks,gapDetected,outOfOrderTicks},
 *       instrument, confidence:{score,prohibitions,confirmable},
 *       externalAlert (bool: a HELIX-validated alert exists),
 *       reaction (bool), outcome (bool) }
 * returns { stage, passed:[...], failedAt, checks:{...} }
 */
function evaluateStage(s){
  s=s||{};
  var mtf=s.mtf||{},ready=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].state==='READY';});
  var up=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='UP';});
  var dn=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='DOWN';});
  var dir=s.signalDirection||((up.length>=dn.length&&up.length>0)?'UP':(dn.length>0)?'DOWN':null);
  var aligned=dir==='UP'?up:dir==='DOWN'?dn:[];
  var feed=s.feed||{};
  var conf=s.confidence||{};
  var continuity=(feed.droppedTicks>0||!!feed.gapDetected||feed.outOfOrderTicks>0);
  var checks={
    detected:true,
    /* DATA_VALIDATED = the source is REAL (not synthetic/demo/baseline) and
       FRESH. Continuity (gaps/drops) is a QUALITY issue, enforced one gate
       later at EVIDENCE_COMPLETE — consistent with the confidence engine,
       where continuityBroken is a prohibition, not a source failure. */
    dataValidated: isRealSource(s.source)&&s.fresh===true,
    mtfValidated: ready.length>=(s.readyMin!=null?s.readyMin:3)&&aligned.length>=2,
    newsChecked: NEWS_PASS.indexOf(String(s.newsState||'').toUpperCase())>=0,
    /* EVIDENCE_COMPLETE = everything the payload claims to have is actually
       present: instrument identity, a real confidence score, feed telemetry
       (latency), AND continuity (no gaps/drops/out-of-order). */
    evidenceComplete: !!(s.instrument&&s.instrument.display)&&(conf.score!=null)&&s.feed&&s.feed.latencyMs!=null&&!continuity,
    confirmable: (conf.confirmable===true)&&(Array.isArray(conf.prohibitions)?conf.prohibitions.length===0:false),
    alert: !!s.externalAlert,
    reaction: !!s.reaction,
    outcome: !!s.outcome
  };
  var failedAt=null,stage='DETECTED';
  for(var i=1;i<STAGES.length;i++){
    if(checks[CHECK_KEY[STAGES[i]]]){stage=STAGES[i];}
    else{failedAt=STAGES[i];break;}
  }
  var passed=STAGES.slice(0,idx(stage)+1);
  return {stage:stage,passed:passed,failedAt:failedAt,checks:checks,direction:dir,readyTfCount:ready.length,alignedTf:aligned.slice(0,4),continuityBroken:continuity};
}
/** Evidence-first payload line (no imperatives, no BUY/SELL). */
function payload(s,lc){
  lc=lc||evaluateStage(s);
  s=s||{};
  var inst=s.instrument||{};
  var src=inst.marketType||String(s.source||'').toUpperCase();
  var parts=[];
  parts.push((inst.display||'XAU/USD')+' • '+(s.timeframe||'—')+' '+(s.pattern||'—')+' '+(lc.direction||'—'));
  if(lc.alignedTf.length)parts.push('HTF '+lc.alignedTf.map(function(t){return t+' '+(lc.direction==='UP'?'UP':'DOWN');}).join(' / '));
  if(s.pattern)parts.push('BBMA '+s.pattern.replace(/-/g,''));
  if(s.location)parts.push('Location '+s.location);
  parts.push('News '+(s.newsState||'UNKNOWN'));
  parts.push('Source '+src);
  parts.push('Age '+fmtAge(s.feed?s.feed.latencyMs:null));
  var conf=s.confidence||{};
  parts.push('Quality '+(Array.isArray(conf.prohibitions)&&conf.prohibitions.length===0?'VALID':'INVALID('+conf.prohibitions.join('+')+')'));
  parts.push('Evidence '+(lc.checks.evidenceComplete?'COMPLETE':'INCOMPLETE'));
  parts.push('State: '+lc.stage);
  return parts.join(' / ');
}
/* UMD: Node (require) + browser (window.BBMALifecycle). */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.BBMALifecycle=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {STAGES:STAGES,evaluateStage:evaluateStage,payload:payload};
});
