'use strict';
/* MindState (spec §15). ONE compact object that tells you what the entire
 * system currently "knows". It is the single interface between
 * Fast-Thinker -> IN_AI -> Kernel_AI -> Dashboard.
 *
 *   MindState
 *   ├ marketState    (symbol, price, instrument, feed state + metrics)
 *   ├ bbmaState      (per-TF zone/trend/pattern from the canonical engine)
 *   ├ newsState      (event, phase, impact, minutes)
 *   ├ regimeState    (session, HTF alignment, ATR, trend strength)
 *   ├ activeHypotheses[]  (the surviving bull/bear/range cases + strength)
 *   ├ recalledEpisodes[]  (weighted, non-quarantined, from forgetting)
 *   ├ compare         (recent-20/100/long-term/exact/near/regime + flag)
 *   ├ uncertainties   (data/model/historical/news/regime + decision)
 *   ├ contradictions[]    (falsifier material counter-evidence)
 *   ├ predictions[]       (open, unsettled, from the ledger)
 *   ├ pendingOutcomes[]   (awaiting a closed candle to settle)
 *   ├ recentMistakes[]    (settled failures)
 *   ├ driftState          (lineage CONSISTENT/MIXED/UNKNOWN + recent flag)
 *   ├ kernelDecision      (Governor output: decision + drivers, NOT a publish)
 *   └ nextRequiredEvidence[]
 *
 * MindState is DERIVED from the proven libraries only — it never computes a
 * second BBMA, never re-derives liveness, and never publishes. The Dashboard
 * renders MindState; the Kernel acts on it. This is the "single authority"
 * made concrete.
 */
var FP=(typeof require!=='undefined')?require('./state-fingerprint.js'):null;
var COMP=(typeof require!=='undefined')?require('./compare-engine.js'):null;
var DEB=(typeof require!=='undefined')?require('./debate-falsifier.js'):null;
var UNC=(typeof require!=='undefined')?require('./uncertainty-decompose.js'):null;
var DECAY=(typeof require!=='undefined')?require('./forgetting.js'):null;
var GOV=(typeof require!=='undefined')?require('./correction-gate.js'):null;

/**
 * buildMindState(ctx)
 *  ctx: { symbol, price, instrument, feed, mtf, zones, patterns, news,
 *         session, atr, trendStrength, htfConflict, eventImpact, eventSurprise,
 *         confidence, modelLineage, episodes (settled, for compare/recall),
 *         openPredictions, pendingOutcomes, recentMistakes, now }
 */
function buildMindState(ctx){
  ctx=ctx||{};
  var mtf=ctx.mtf||{};
  var up=Object.keys(mtf).filter(function(t){return (mtf[t]||{}).trend==='UP';});
  var dn=Object.keys(mtf).filter(function(t){return (mtf[t]||{}).trend==='DOWN';});
  var pattern=ctx.pattern||null,zone=ctx.zone||null,squeeze=ctx.squeeze||null;
  var news=ctx.news||{state:'NO_EVENT'};
  var regime={session:ctx.session||null,htfAlignment:up.length&&dn.length?'MIXED':(up.length>=dn.length?(up.length?'UP':'FLAT'):'DOWN'),htfUp:up,htfDown:dn,atr:ctx.atr||null,trendStrength:ctx.trendStrength!=null?ctx.trendStrength:null};
  var debate=(DEB&&ctx.mtf)?DEB.debate({mtf:mtf,zone:zone,pattern:pattern,squeeze:squeeze,news:news,atr:ctx.atr,compare:ctx._compare,confidence:ctx.confidence,recentAccuracy:ctx.recentAccuracy}):null;
  var compare=(COMP&&ctx.episodes)?COMP.compare({tf:'M15',pattern:pattern,session:regime.session,newsPhase:(news.state||'NO_EVENT'),stateId:ctx.stateId},ctx.episodes):null;
  if(compare&&!ctx._compare)ctx._compare=compare;
  /* uncertainties (Governor-informing, does NOT publish) */
  var unc=(UNC)?UNC.decompose({confidence:ctx.confidence,instrument:ctx.instrument,modelLineage:ctx.modelLineage,histSamples:compare?compare.settledSamples:0,newsState:news.state,eventImpact:ctx.eventImpact,eventSurprise:ctx.eventSurprise,htfConflict:!!(up.length&&dn.length),atr:ctx.atr,trendStrength:ctx.trendStrength}):null;
  /* recall: weighted + non-quarantined */
  var rec=(DECAY&&ctx.episodes)?DECAY.trustedSet(DECAY.forget(ctx.episodes,{now:ctx.now,quarantineProhibited:true,currentRegime:{session:regime.session,newsPhase:news.state},currentGeneration:ctx.currentGeneration})):[];
  /* contradictions: material falsifier counter-evidence across surviving cases */
  var contradictions=[];
  if(debate)Object.keys(debate.falsifier).forEach(function(c){(debate.falsifier[c]||[]).forEach(function(f){if(f.material&&f.defeats)contradictions.push({case:c,claim:f.claim,counterEvidence:f.counterEvidence});});});
  /* drift: lineage + recent deterioration flag */
  var lineage=(GOV&&ctx.generationIds)?GOV.lineage(ctx.generationIds):{status:'UNKNOWN',generationId:null,generations:0};
  var drift={lineage:lineage.status,generationId:lineage.generationId,generations:lineage.generations,flag:compare?compare.flag:null};
  var nextRequiredEvidence=[];
  if(unc){
    if(unc.sources.data.level==='HIGH')nextRequiredEvidence.push('clean (non-prohibited) feed data');
    if(unc.sources.model.level==='HIGH')nextRequiredEvidence.push('consistent model generation (lineage)');
    if(unc.sources.historical.level==='HIGH')nextRequiredEvidence.push('more settled analogue samples (>=30)');
    if(unc.sources.news.level==='HIGH')nextRequiredEvidence.push('news outcome (post-release actual)');
    if(unc.sources.regime.level==='HIGH')nextRequiredEvidence.push('HTF alignment resolution (closed higher-TF candles)');
  }
  return {
    schema:'MindState/v1',
    symbol:ctx.symbol||'XAU/USD',
    marketState:{price:ctx.price!=null?ctx.price:null,instrument:ctx.instrument||null,feed:ctx.feed||null},
    bbmaState:{tf:'M15',zone:zone,pattern:pattern,squeeze:squeeze,mtf:mtf,up:up,down:dn},
    newsState:{state:news.state,event:news.event||null,impact:ctx.eventImpact||null,minutes:news.minutes!=null?news.minutes:null},
    regimeState:regime,
    activeHypotheses:debate?debate.surviving.map(function(c){return {case:c,strength:debate.strength[c],claims:debate.cases[c].claims};}):[],
    synthesis:debate?debate.synthesis:{leading:null},
    recalledEpisodes:rec.map(function(o){return {stateId:o.episode.stateId,weight:o.weight,count:o.count,session:o.episode.session,newsPhase:o.episode.newsPhase,correct:o.episode.correct};}),
    compare:compare,
    uncertainties:unc,
    contradictions:contradictions,
    predictions:(ctx.openPredictions||[]).slice(0,10),
    pendingOutcomes:(ctx.pendingOutcomes||[]).slice(0,10),
    recentMistakes:(ctx.recentMistakes||[]).slice(0,10),
    driftState:drift,
    kernelDecision:unc?{decision:unc.decision,drivers:unc.drivers,note:unc.note}:null,
    nextRequiredEvidence:nextRequiredEvidence,
    builtAt:(ctx.now)?new Date(ctx.now).toISOString():new Date().toISOString()
  };
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAMindState=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {buildMindState:buildMindState};});
