'use strict';
/* Uncertainty decomposition (spec §9).
 *
 * Don't average everything into one 78%. Separate the independent uncertainty
 * sources, each rated LOW/MEDIUM/HIGH with the evidence for it, and let the
 * Governor combine them into a DECISION (WATCH/PROCEED/BLOCK) via explicit
 * rules — a HIGH data-uncertainty or a blocked quality gate dominates a
 * "HIGH historical evidence" score.
 *
 *   Data uncertainty      <- feed quality / instrument / freshness (confidence)
 *   Model uncertainty    <- BBMA detection method version + lineage
 *   Historical uncertainty<- sample size of the analogues (compare)
 *   News uncertainty     <- event proximity + impact + surprise
 *   Regime uncertainty   <- HTF conflict / ATR / session / trend-strength
 *
 * The Governor rule (deterministic, auditable): if ANY hard source is blocked
 * (data or model or a confidence prohibition) => BLOCK. Else if news or regime
 * is HIGH => WATCH. Else if all are LOW/MEDIUM with enough historical sample
 * => PROCEED (the Governor then still applies the lifecycle CONFIRMABLE gate —
 * this module never publishes, it only informs).
 */
var LOW=0,MED=1,HIGH=2;
var LBL=['LOW','MEDIUM','HIGH'];
function levelOf(x){return LBL[x==null?MED:x];}
function decompose(inp){
  inp=inp||{};
  var conf=inp.confidence||{};
  /* DATA: a prohibition / stale / instrument-mismatch is HIGH; a clean fresh
     spot feed is LOW; a resolved futures proxy is MEDIUM. */
  var data;
  if(conf.prohibitions&&conf.prohibitions.length)data=HIGH;
  else if(inp.instrument&&inp.instrument.isProxy)data=MED; /* honest proxy, not direct spot */
  else if(conf.score!=null&&conf.score>=80)data=LOW;
  else data=MED;
  /* MODEL: method-version lineage — CONSISTENT generation is LOW, MIXED is
     MEDIUM, UNKNOWN (can't prove which detection made it) is HIGH. */
  var model=inp.modelLineage==='CONSISTENT'?LOW:(inp.modelLineage==='MIXED'?MED:HIGH);
  /* HISTORICAL: sample size of the best analogue base. */
  var histN=inp.histSamples!=null?inp.histSamples:0;
  var hist=histN>=30?LOW:(histN>=10?MED:HIGH);
  /* NEWS: proximity + impact + surprise. */
  var news;
  var ns=String(inp.newsState||'').toUpperCase();
  if(inp.eventImpact==='HIGH'&&/PRE_NEWS|NEWS_RELEASE/.test(ns))news=HIGH;
  else if(/PRE_NEWS|NEWS_RELEASE|POST_NEWS/.test(ns))news=MED;
  else news=LOW;
  if(inp.eventSurprise)news=Math.min(HIGH,news+1);
  /* REGIME: HTF conflict + ATR + trend strength. */
  var regime;
  var conflict=inp.htfConflict; /* true when HTF disagree materially */
  if(conflict)regime=HIGH;
  else if(inp.atr==='HIGH'||inp.atr==='VERY_HIGH'||inp.atr==='LOW')regime=MED;
  else regime=LOW;
  if(inp.trendStrength!=null&&Math.abs(inp.trendStrength)<0.1)regime=Math.max(regime,MED); /* weak trend */
  var sources={
    data:{level:levelOf(data),reason:data===HIGH?('prohibited: '+(conf.prohibitions||[]).join(',')):(data===MED?'futures proxy / moderate confidence':'clean fresh feed')},
    model:{level:levelOf(model),reason:'modelLineage '+(inp.modelLineage||'UNKNOWN')},
    historical:{level:levelOf(hist),reason:histN+' analogue samples'},
    news:{level:levelOf(news),reason:'news '+ns+(inp.eventImpact?' ('+inp.eventImpact+')':'')},
    regime:{level:levelOf(regime),reason:(conflict?'HTF conflict; ':'')+'ATR '+(inp.atr||'?')+(inp.trendStrength!=null?' trend='+inp.trendStrength:'')}
  };
  /* ---- Governor COMBINATION rule (deterministic; does NOT publish) ---- */
  var blocked=data===HIGH||model===HIGH;
  var watch=!blocked&&(news===HIGH||regime===HIGH||hist===HIGH);
  var decision=blocked?'BLOCK':(watch?'WATCH':'PROCEED');
  /* why — every driver is named so /codeview can audit the decision. */
  var drivers=[];
  Object.keys(sources).forEach(function(k){if(sources[k].level!=='LOW')drivers.push(k+'='+sources[k].level);});
  return {sources:sources,decision:decision,drivers:drivers,
    note:decision==='BLOCK'?'hard source blocked (data/model) — lifecycle CONFIRMABLE will also prohibit':(decision==='WATCH'?'elevated news/regime/historical uncertainty — do not auto-confirm':'all sources LOW/MEDIUM with sufficient samples — eligible (still gated by lifecycle)')};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMADecomp=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {decompose:decompose,LOW:LOW,MED:MED,HIGH:HIGH,LBL:LBL};});
