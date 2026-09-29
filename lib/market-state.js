'use strict';
/* MarketState — the ONE canonical analysis object (P1: "satu canonical MarketState").
 *
 * The architecture says UI and Telegram must NOT each interpret direction —
 * they render. This module assembles the runtime/builder's already-computed,
 * single-authority fields into one MarketState/v1:
 *
 *   technical   { bbma, structure, volatility, sessions }
 *   fundamental { events, macro, news }
 *   conflict    { ... }
 *   evidence    { ... }
 *   confidence  { score, verdict, prohibitions }
 *   decision    { direction, stage, publishable, evidenceScore, drivers }
 *
 * It NEVER recomputes BBMA or direction: it READS `analysis` (the engine),
 * `lifecycle` (the single authority built once), `confidence`, `instrument`
 * and `feed`. Renderers (app.js, Telegram) may only read `decision` +
 * `technical` — if they need something else, it goes into MarketState, not
 * into a second interpretation.
 */
function n(v){return Number.isFinite(+v)?+v:null;}
function _bbma(analysis,tf){
  var a=analysis&&analysis[tf];
  if(!a||!a.bbma)return null;
  return {
    state:a.bbma.state||null,trend:a.bbma.trend||null,momentum:a.bbma.momentum||null,
    extreme:a.bbma.extreme||null,csak:a.bbma.csak||null,reentry:a.bbma.reentry||null,
    zone:a.bbma.zone||null,band:a.bbma.band||null,emaGap:a.bbma.emaGap||null,squeeze:a.bbma.squeeze||null,
    oneStep:a.next?a.next.state:null,heuristicScore:a.next&&a.next.confidence!=null?a.next.confidence:null
  };
}
function _structure(analysis,tf){
  var a=analysis&&analysis[tf];if(!a||!a.bbma||!a.bbma.values)return null;
  var v=a.bbma.values;
  return {bb:{mid:v.bb&&v.bb.mid!=null?v.bb.mid:null,upper:v.bb&&v.bb.upper!=null?v.bb.upper:null,lower:v.bb&&v.bb.lower!=null?v.bb.lower:null,widthPct:v.bb&&v.bb.widthPct!=null?v.bb.widthPct:null},
    ma5:{high:v.ma5High!=null?v.ma5High:null,low:v.ma5Low!=null?v.ma5Low:null},
    ma10:{high:v.ma10High!=null?v.ma10High:null,low:v.ma10Low!=null?v.ma10Low:null},
    ema50:v.ema50!=null?v.ema50:null};
}
function _volatility(analysis,tf){
  var a=analysis&&analysis[tf];if(!a)return null;
  return {squeeze:a.squeeze&&a.squeeze.squeeze||null,widthPct:a.squeeze&&a.squeeze.widthPct!=null?a.squeeze.widthPct:null,percentile:a.squeeze&&a.squeeze.percentile!=null?a.squeeze.percentile:null,expanding:!!(a.squeeze&&a.squeeze.expanding)};
}
function _decision(lifecycle,confidence){
  var stage=lifecycle?lifecycle.stage:null;
  /* the canonical direction comes from the single-authority lifecycle,
     NEVER re-derived here. */
  return {
    direction:(lifecycle&&lifecycle.direction)||'UNKNOWN',
    stage:stage||'UNKNOWN',
    passed:!!(lifecycle&&lifecycle.passed),
    failedAt:lifecycle?lifecycle.failedAt||null:null,
    publishable:!!(lifecycle&&lifecycle.passed&&lifecycle.stage==='ALERT'),
    evidenceScore:confidence?confidence.score:null,
    verdict:confidence?confidence.verdict:null,
    drivers:(lifecycle&&lifecycle.checks)?Object.keys(lifecycle.checks).filter(function(k){return lifecycle.checks[k]===false;}):[]
  };
}
/**
 * build(out)  — `out` is the runtime/builder snapshot object
 * returns MarketState/v1 (frozen)
 */
function build(out){
  out=out||{};
  var tf=out.tf||(out.analysis&&out.analysis.M15?'M15':null);
  var ms={
    schema:'MarketState/v1',
    generatedAt:out.generatedAt||out.asOf||null,
    symbol:out.symbol||null,
    instrument:out.instrument||null,
    feed:out.feed?{state:out.feed.state,provider:out.feed.provider,latencyMs:n(out.feed.latencyMs),droppedTicks:n(out.feed.droppedTicks),gapDetected:!!out.feed.gapDetected,backfillRequired:!!out.feed.backfillRequired}:null,
    technical:{
      tf:tf,
      bbma:_bbma(out.analysis,tf),
      structure:_structure(out.analysis,tf),
      volatility:_volatility(out.analysis,tf),
      sessions:out.sessions||null /* populated by session-engine.js when wired */
    },
    fundamental:{
      events:(out.news&&out.news.events)||[],
      news:(out.news&&out.news.state)?{state:out.news.state,strength:out.news.strength||null,event:out.news.event||null,minutes:out.news.minutes!=null?out.news.minutes:null}:null,
      macro:out.macro||null
    },
    conflict:out.conflict||null,
    evidence:out.evidence||{dataClass:out.dataClass||null,lifecycle:out.lifecycle||null},
    confidence:out.confidence?{score:n(out.confidence.score),verdict:out.confidence.verdict,prohibitions:out.confidence.prohibitions||[],weights:out.confidence.weights||null}:null,
    decision:_decision(out.lifecycle,out.confidence)
  };
  /* one-step shadow is CARRIED, clearly separated from the decision */
  if(out.oneStep)ms.research={oneStep:out.oneStep};
  return Object.freeze(ms);
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAMarketState=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {build:build};});
