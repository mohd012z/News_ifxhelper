'use strict';
/* IntelligenceKernel — the orchestrator (Master Mind Map).
 *
 * Runs the brains in the documented order and returns ONE structured result.
 * It is DETERMINISTIC and read-only over the input; it never publishes an
 * alert and never writes — it produces a OneStepHypothesis + status that the
 * existing publisher gate (Kernel_AI) decides on. This is the P6 shadow path.
 *
 * Flow:
 *   Data -> Source -> Validation -> Feature
 *     -> [BBMA, Regime, Session, News, History, Statistical, CrossAsset]
 *     -> Consensus -> in_ai -> Prediction -> Verification
 *     -> Falsification (pre-candle) -> [Waypoint, Stop, EndMovement]
 *     -> Settlement (exact next) -> Learning -> Calibration -> Audit
 */
var DB=require('./data-brain.js'),SB=require('./source-brain.js'),VB=require('./validation-brain.js'),FB=require('./feature-brain.js');
var BB=require('./bbma-brain.js'),REG=require('../ai/regime-engine.js'),SES=require('./session-brain.js');
var NB=require('./news-brain.js'),HB=require('./history-brain.js'),ST=require('./statistical-brain.js');
var CA=require('./crossasset-brain.js'),CS=require('./consensus-brain.js'),AI=require('./in-ai-brain.js');
var PB=require('./prediction-brain.js'),VER=require('./verification-brain.js'),FAL=require('./falsification-brain.js');
var WP=require('./waypoint-brain.js'),STOP=require('./stop-brain.js'),EM=require('./endmovement-brain.js');
var SET=require('./settlement-brain.js'),LRN=require('./learning-brain.js'),CAL=require('./calibration-brain.js'),AUD=require('./audit-brain.js');
function n(v){return Number.isFinite(+v)?+v:null;}
function _tfMin(tf){var m={'M1':1,'M5':5,'M15':15,'M30':30,'H1':60,'H4':240,'D1':1440,'W1':10080};return m[String(tf||'M15').toUpperCase()]||15;}
/**
 * run({ candles, source, tf, instrument, news, mtf, cross, corpus, records,
 *        now, anchorClose })
 */
function run(inp){
  inp=inp||{};
  var candles=inp.candles||[];
  var tf=String(inp.tf||'M15').toUpperCase();
  var tfMin=_tfMin(tf);
  var now=inp.now!=null?inp.now:Date.now();
  var result={schema:'IntelligenceKernel/v1',tf:tf,trace:[]};
  /* 1. INPUT brains: can I trust the data? (measured against the analysis tf) */
  var data=DB.classify({candles:candles,source:inp.source,now:now,tfMin:tfMin});
  result.trace.push({brain:'DataBrain',status:data.status,mayPredict:data.mayPredict});
  var src=SB.identify(inp.instrument||{});
  result.trace.push({brain:'SourceBrain',id:src.id,isProxy:src.isProxy,mayPredict:src.mayPredict});
  if(!data.mayPredict||!src.mayPredict){result.status='BLOCKED';result.blockedBy='data/source';result.reason=(!data.mayPredict?('data '+data.status):('source '+src.id));return result;}
  /* 4. closed analysis window. The PREDICTION ANCHOR is the last closed
     candle (or inp.asOf for replay/reconciliation). The window only contains
     candles closed AT the anchor -> no future data in any feature. */
  var W=require('../bbma-candle-watch.js');
  var allClosed=candles.filter(function(c){var o=Date.parse(c.time);return Number.isFinite(o)&&o+tfMin*60000<=now;});
  var anchorClose=inp.asOf!=null?Date.parse(inp.asOf):(allClosed.length?Date.parse(allClosed[allClosed.length-1].time):null);
  if(!anchorClose){result.status='BLOCKED';result.blockedBy='no-closed-candle';return result;}
  var predNow=anchorClose+tfMin*60000; /* "now" from the anchor's perspective */
  var win=allClosed.filter(function(c){var o=Date.parse(c.time);return Number.isFinite(o)&&o+tfMin*60000<=predNow;}).slice(-300);
  /* Validation over the analysis window itself (contiguity + freshness at anchor time) */
  var closed=VB.validate({candles:win,source:inp.source,now:predNow,tfMin:tfMin,analysisCandles:win});
  result.trace.push({brain:'ValidationBrain',verdict:closed.verdict,drivers:closed.drivers});
  if(!closed.ok){result.status='BLOCKED';result.blockedBy='validation';return result;}
  if(win.length<50){result.status='BLOCKED';result.blockedBy='insufficient-closed-candles';result.reason=win.length+' closed < 50';return result;}
  var loc=W.location(win);var next=W.oneStepAhead(win);
  var asOf=win[win.length-1].time;
  var feat=FB.build({candles:win,asOf:asOf,tf:tf,analysis:loc,squeeze:null,news:inp.news||{state:'NO_EVENT'},instrument:inp.instrument||null,dataClass:data.dataClass,mtf:inp.mtf||{}});
  result.trace.push({brain:'FeatureBrain',snapshotId:feat.snapshotId,asOf:asOf});
  var snap=feat.snap;
  /* 5. ANALYSIS brains */
  var bbma=BB.predict(win);
  result.trace.push({brain:'BBMABrain',state:bbma.state,heuristicScore:bbma.heuristicScore});
  var regime=REG.classify(snap);
  result.trace.push({brain:'RegimeBrain',regime:regime.regime});
  var session=SES.features({candles:win,asOf:asOf});
  result.trace.push({brain:'SessionBrain',session:session.session,first:session.firstSessionCandle});
  var news=NB.analyze(inp.news||{state:'NO_EVENT'});
  result.trace.push({brain:'NewsBrain',strength:news.strength,pass:news.pass});
  var empq={tf:tf,bbma:_dom(bbma.location.reentry,bbma.location.momentum,bbma.location.trend),zone:snap.location.bbZone,volatility:snap.volatility.atrBand,session:session.session,news:snap.news.mode,trend:mtfTrend(inp.mtf,'H1')};
  var history=HB.match({horizon:'M15',records:inp.records||[],query:empq,corpus:inp.corpus||[],minSamples:8});
  result.trace.push({brain:'HistoryBrain',status:history.status,n:history.n,level:history.level});
  var stat=null;
  if(inp.corpus&&inp.corpus.length>=40){var model=ST.fit(inp.corpus,{minSamples:40});if(model.status==='ACTIVE'){stat=ST.predict(snap,model);}}
  if(stat)result.trace.push({brain:'StatisticalBrain',status:stat.status});
  var cross=CA.read(inp.cross||{});
  if(cross.available)result.trace.push({brain:'CrossAssetBrain',direction:cross.direction});
  /* 6. Consensus (regime-weighted, not a simple average) */
  var consensus=CS.decide({
    direction:bbma.direction,
    statistical:stat?{dir:_arg(stat.prob),conf:Math.max(stat.prob.UP,stat.prob.DOWN,stat.prob.RANGE)}:null,
    history:history.status==='OK'?{dir:_argDir(history)}:null,
    mtf:mtfDir(inp.mtf),
    news:news.strength==='REGIME_CHANGE'?null:null,
    ai:null,
    regime:regime.regime
  });
  result.trace.push({brain:'ConsensusBrain',direction:consensus.direction,confidence:consensus.confidence,agreement:consensus.agreement});
  /* 7. in_ai review (deterministic; can only inform, never publish) */
  var aiState={symbol:snap.symbol,timeframe:tf,candidate:{state:bbma.state,heuristicConfidence:bbma.heuristicScore},evidence:{bbma:{reentry:bbma.location.reentry,zone:snap.location.bbZone},news:{strength:news.strength},history:{status:history.status},mtf:inp.mtf||{},data:{synthetic:data.dataClass==='SYNTHETIC',stale:data.status==='STALE',isProxy:src.isProxy},volatility:{squeeze:snap.volatility.squeeze}}};
  var ai=AI.review(aiState);
  result.trace.push({brain:'in_aiBrain',verdict:ai.verdict,regime:ai.regime});
  /* re-decide consensus WITH the in_ai verdict (can lower confidence) */
  consensus=CS.decide({direction:bbma.direction,statistical:stat?{dir:_arg(stat.prob)}:null,history:history.status==='OK'?{dir:_argDir(history)}:null,mtf:mtfDir(inp.mtf),news:null,ai:{verdict:ai.verdict,dir:null,missingEvidence:ai.missingEvidence},regime:regime.regime});
  /* 8. Prediction (OneStepHypothesis) */
  var movement=_move(snap,bbma.location.squeeze);
  var expectedRange=_expectedRange(snap,movement);
  var pseudoCons={direction:consensus.direction,movementClass:movement,expectedRange:expectedRange,publishable:news.pass&&consensus.confidence>=50,heuristicScore:bbma.heuristicScore};
  var hypothesis=PB.build({consensus:pseudoCons,bbma:bbma,regime:regime,session:session,news:news,history:history,snapshot:snap});
  var falsifiers=FAL.falsifiers(hypothesis,{regime:regime.regime,newsStrength:news.strength});
  hypothesis.falsifiers=falsifiers;
  result.trace.push({brain:'PredictionBrain',direction:hypothesis.direction,status:hypothesis.status});
  /* 9. Verification gate */
  var ver=VER.verify({data:data,candidate:pseudoCons,snapshot:snap,shadow:true});
  result.trace.push({brain:'VerificationBrain',stage:ver.stage,publishable:ver.publishable,drivers:ver.drivers});
  /* 10-13. settlement only when the exact next candle exists */
  result.hypothesis=hypothesis;
  result.consensus=consensus;
  result.ai=ai;
  result.invariants={aiCanPublish:false,publishGate:'Kernel_AI only',shadow:ver.shadow};
  if(ver.stage==='REJECTED'){result.status='REJECTED';result.blockedBy='verification';return result;}
  result.status=ver.stage;
  /* settlement + learning + calibration + audit (only when the EXACT next closed candle exists) */
  var anchorPrice=win[win.length-1].close;
  var settle=SET.settle(hypothesis,{candles:allClosed,anchorClose:anchorPrice,tfMin:tfMin,now:now,withinBand:null,dataInvalid:data.status==='STALE'||data.status==='INVALID',leakage:false});
  if(settle.result!=='UNSETTLED'){
    result.settlement=settle;
    var wp=WP.evaluate(hypothesis.direction,{},{maxFavorable:0,broken:false});
    var emv=EM.assess({candles:win,direction:hypothesis.direction,location:loc,mtf:inp.mtf||{}});
    var stop=STOP.check(hypothesis,{oppositeClosedCandle:settle.actual&&settle.actual.direction&&settle.actual.direction!==hypothesis.direction&&hypothesis.direction!=='RANGE'});
    var lrn=LRN.record(hypothesis,settle,{bbZone:snap.location.bbZone,movementMagnitude:settle.actual&&settle.actual.returnPct,dataClass:data.dataClass,sourceId:src.id,waypoint:wp.endState,stopReason:stop.triggers.join(','),endMovementReason:emv.state});
    result.learning=lrn;
    result.endMovement=emv;result.stop=stop;result.waypoint=wp;
  }
  result.audit=AUD.auditRefs({asOf:asOf,tf:tf,sourceIds:[src.id],featureSnapshotId:feat.snapshotId,now:now,lineage:'CONSISTENT'});
  return result;
}
function _dom(a,b,c){for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v&&v!=='NONE'&&v!=='UNKNOWN')return v.toUpperCase();}return 'UNKNOWN';}
function _arg(p){var e=Object.keys(p).map(function(k){return [k,p[k]];}).sort(function(a,b){return b[1]-a[1];});return e[0][0];}
function _argDir(h){if(h&&h.stats){if(h.stats.upRate!=null&&h.stats.downRate!=null)return h.stats.upRate>=h.stats.downRate?'UP':'DOWN';}return null;}
function _move(snap,squeezeToken){var sq=squeezeToken||snap.volatility.squeeze;if(sq==='SQUEEZE'||sq==='TIGHT')return 'EXPANSION-WATCH';if(snap.volatility.expanding)return 'EXPANSION';return snap.volatility.atrBand==='LOW'?'SMALL':'NORMAL';}
function _expectedRange(snap,movement){
  var a=(snap.volatility&&snap.volatility.atrPct);
  if(a==null){var band=snap.volatility&&snap.volatility.atrBand;if(band)a={LOW:0.06,NORMAL:0.18,HIGH:0.35,VERY_HIGH:0.6}[band]||null;}
  if(a==null)return null;
  var mult=(movement==='EXPANSION')?1.0:0.8;
  return {atrPct:a,estMovePct:+(a*mult*100).toFixed(2),note:'ATR-normalized research estimate, not a price target'};
}
function mtfDir(mtf){var u=0,d=0;(mtf||{});Object.keys(mtf||{}).forEach(function(k){if(mtf[k]&&mtf[k].trend==='UP')u++;else if(mtf[k]&&mtf[k].trend==='DOWN')d++;});return u>=2&&d===0?'UP':d>=2&&u===0?'DOWN':null;}
function mtfTrend(mtf,tf){return mtf&&mtf[tf]&&mtf[tf].trend||null;}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAIntelligenceKernel=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {run:run};});
