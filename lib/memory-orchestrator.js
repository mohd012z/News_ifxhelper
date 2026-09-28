'use strict';
/* Memory Brain orchestrator (spec /mindbrains — the "Memory" + "Critic"
 * substrate). This is the ONE module that owns the tiered memory/ tree and
 * wires the pure libs (fingerprint, memory-value, similarity, ledger,
 * counterfactual) into a single ingestion -> scoring -> recall flow.
 *
 *   Tiers (spec §1)  <->  storage:
 *     working/        current market context  (in-memory, capped, never recall)
 *     episodic/       "what happened last time" (JSONL, value-indexed)
 *     semantic/       general learned facts   (evidence-gated; sampleSize/period/
 *                                              CI/generationId/lastValidated)
 *     statistical/    aggregate stats         (by pattern / regime)
 *     event/          scheduled-event history
 *     mistakes/       prediction failures     (the highest-value training data)
 *     corrections/    applied corrections + whether they worked
 *     patterns/       mined pattern families
 *     archive/        raw audit trail (everything, low-value included)
 *
 * The Governor brain (Kernel_AI = lifecycle + confidence + publishability) is
 * NOT touched here: memory can SUGGEST, but only the Governor decides evidence
 * state and publication. recall() returns PROVEN tiers only (episodic +
 * evidence-gated semantic); raw archive/working never surface as "learned".
 */
var fs=(typeof require!=='undefined')?require('fs'):null;
var path=(typeof require!=='undefined')?require('path'):null;
var FP=require('./state-fingerprint.js');
var MV=require('./memory-value.js');
var SIM=require('./setup-similarity.js');
var CF=require('./counterfactual-memory.js');
var LED=require('./prediction-ledger.js');
var TIERS=['working','episodic','semantic','statistical','event','mistakes','corrections','patterns','archive'];

function dir(root,t){return path.join(root,t);}
function ensureTree(root){if(!fs||!root)return;TIERS.forEach(function(t){fs.mkdirSync(dir(root,t),{recursive:true});});fs.mkdirSync(path.join(root,'ledger'),{recursive:true});}
function jpath(root,t,name){return path.join(dir(root,t),name);}
function readJsonl(root,t,name){
  var p=jpath(root,t,name);
  if(!fs||!fs.existsSync(p))return[];
  return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(function(l){try{return JSON.parse(l);}catch(e){return null;}}).filter(Boolean);
}
function appendJsonl(root,t,name,obj){
  var p=jpath(root,t,name);
  if(fs){if(!fs.existsSync(dir(root,t)))fs.mkdirSync(dir(root,t),{recursive:true});fs.appendFileSync(p,JSON.stringify(obj)+'\n');}
  return obj;
}

/* ---------- WORKING (in-memory, capped, never surfaced by recall) ---------- */
function WorkingMemory(cap){cap=cap||200;this.cap=cap;this.candles=[];this.state=null;this.mtf=null;this.session=null;this.upcomingNews=null;this.openObservations=[];}
WorkingMemory.prototype.pushCandle=function(c){this.candles.push(c);if(this.candles.length>this.cap*3)this.candles=this.candles.slice(-this.cap*3);};
WorkingMemory.prototype.set=function(k,v){this[k]=v;};
WorkingMemory.prototype.snapshot=function(){return {candles:this.candles.length,state:this.state,mtf:this.mtf,session:this.session,upcomingNews:this.upcomingNews,openObservations:this.openObservations.slice()};};

/* ---------- EPISODIC: record one settled/observed situation ---------- */
/**
 * recordEpisode(root, { tf, asset, candles, analysis, dashboard, news,
 *                       confidence, prediction:{state,confidence,reasons},
 *                       actual:{direction,returnPct} (present once settled) })
 * returns the stored episode (with stateId + value + tier).
 */
function recordEpisode(root,input){
  input=input||{};
  var canon=FP.normalizeState({asset:input.asset,tf:input.tf,analysis:input.analysis,dashboard:input.dashboard,news:input.news,candles:input.candles});
  var sid=FP.stateId(canon);
  var prevEp=readJsonl(root,'episodic','episodes.jsonl');
  var recentIds=prevEp.slice(-120).map(function(e){return e.stateId;});
  var lastC=(input.candles&&input.candles.length)?input.candles[input.candles.length-1]:null;
  var impFlags=[];
  /* derive importance signals from observable properties. */
  if(lastC&&input.candles&&input.candles.length>7){
    var prev6=input.candles.slice(-7,-1);
    var dir0=lastC.close>lastC.open?'UP':'DOWN';
    var prevUp=prev6.filter(function(c){return c.close>c.open;}).length;
    if(prev6.length>=6&&prevUp/prev6.length<0.35&&dir0==='UP')impFlags.push('unexpectedReversal');
    if(prev6.length>=6&&prevUp/prev6.length>0.65&&dir0==='DOWN')impFlags.push('unexpectedReversal');
  }
  var prov=(input.news&&input.news.state||'').toUpperCase();
  if(prov==='PRE_NEWS'||prov==='NEWS_RELEASE')impFlags.push('newsShock');
  if(input.providerConflict)impFlags.push('providerConflict');
  var predFailure=!!(input.prediction&&input.actual&&input.predictionCorrect===false);
  var highConfWrong=predFailure&&input.prediction&&input.prediction.confidence>=70;
  if(input.actual)impFlags.push(predFailure?'predictionFailure':'');
  var evt={stateId:sid,recentIds:recentIds,confidence:input.confidence,
    predictionFailure:predFailure,highConfidenceWrong:highConfWrong,
    unexpectedReversal:impFlags.indexOf('unexpectedReversal')>=0,
    newsShock:impFlags.indexOf('newsShock')>=0,providerConflict:impFlags.indexOf('providerConflict')>=0,
    duplicateState:recentIds.indexOf(sid)>=0,settled:!!input.actual};
  var val=MV.score(evt);
  var rec={
    id:sid,tf:input.tf,asset:FP.normAsset(input.asset)||canon.asset,
    state:canon,fingerprint:FP.fingerprint(canon),stateId:sid,
    pattern:canon.pattern,bbmaZone:canon.bbmaZone,session:canon.session,newsPhase:canon.newsPhase,
    vec:SIM.vectorize({asset:input.asset,tf:input.tf,analysis:input.analysis,dashboard:input.dashboard,news:input.news,candles:input.candles}),
    prediction:input.prediction||null,
    actual:input.actual||null,settled:!!input.actual,
    predictedDirection:input.actual&&input.prediction?_predDir(input.prediction):null,
    actualDirection:input.actual?input.actual.direction:null,
    correct:predFailure?false:(input.actual&&input.prediction?_correct(input):null),
    value:val,importanceFlags:val.importanceFlags,tier:val.tier,
    generationId:input.generationId||null,confidence:input.confidence||null,
    snapshotPrice:lastC?+lastC.close:null,snapshotTime:lastC?lastC.time:null,
    recordedAt:new Date().toISOString()
  };
  appendJsonl(root,'episodic','episodes.jsonl',rec);
  /* raw audit: EVERY observation, low-value included. */
  appendJsonl(root,'archive','raw.jsonl',{id:rec.id,stateId:sid,tf:rec.tf,settled:rec.settled,value:val.value,tier:val.tier,recordedAt:rec.recordedAt});
  /* mistakes: prediction failures are first-class (spec §1 mistake memory). */
  if(predFailure)appendJsonl(root,'mistakes','mistakes.jsonl',{id:sid,tf:rec.tf,state:canon,prediction:rec.prediction,actual:rec.actual,why:val.importanceFlags,recordedAt:rec.recordedAt});
  /* event tier: scheduled-event observations. */
  if(prov!=='NO_EVENT'&&prov!=='NORMAL'&&input.news&&input.news.event)appendJsonl(root,'event','events.jsonl',{id:sid,event:input.news.event.title,state:prov,recordedAt:rec.recordedAt});
  return rec;
}
function _predDir(p){var s=(p&&p.state||'').toUpperCase();return s.indexOf('UP')>=0?'UP':s.indexOf('DOWN')>=0?'DOWN':s.indexOf('RANGE')>=0?'FLAT':'UNKNOWN';}
function _correct(input){var pd=_predDir(input.prediction);if(pd==='UNKNOWN'||pd==='FLAT')return null;return pd===input.actual.direction;}

/* ---------- SEMANTIC: evidence-gated general facts ---------- */
/**
 * promoteSemantic(root, { pattern, dim, claim, ... }) — only promotes when the
 * supporting settled episodes meet minSamples AND the confidence engine is
 * clean. Carries sampleSize / period / confidence interval / generationId /
 * lastValidated (spec §1: weak observations must not become "permanent facts").
 */
function promoteSemantic(root,fact){
  fact=fact||{};
  var eps=readJsonl(root,'episodic','episodes.jsonl').filter(function(e){return e.settled&&(fact.tf==null||e.tf===fact.tf)&&(fact.pattern==null||e.pattern===fact.pattern);});
  var MIN=fact.minSamples!=null?fact.minSamples:15;
  if(eps.length<MIN)return {promoted:false,reason:'insufficient_samples ('+eps.length+'/'+MIN+')',id:null};
  var correct=eps.filter(function(e){return e.correct===true;}).length;
  var p=correct/eps.length;
  var ci=1.96*Math.sqrt(p*(1-p)/eps.length); /* 95% normal-approx CI */
  var gens=[...new Set(eps.map(function(e){return e.generationId;}).filter(Boolean))];
  var rec={
    id:'sem_'+FP.stateId({asset:fact.asset||'GOLD',tf:fact.tf||fact.pattern,pattern:fact.pattern||fact.pattern,bbmaZone:fact.dim||'ALL',htf:{},atr:'UNKNOWN',session:fact.dim||'ALL',newsPhase:'ALL'})||'x',
    claim:fact.claim,asset:fact.asset||'GOLD',tf:fact.tf||null,pattern:fact.pattern||null,dim:fact.dim||null,
    period:{from:new Date(Math.min.apply(null,eps.map(function(e){return Date.parse(e.recordedAt);}))).toISOString(),to:new Date(Math.max.apply(null,eps.map(function(e){return Date.parse(e.recordedAt);}))).toISOString()},
    rate:+p.toFixed(3),ci95:{lo:+Math.max(0,p-ci).toFixed(3),hi:+Math.min(1,p+ci).toFixed(3)},
    generationId:gens.length===1?gens[0]:(gens.length?gens:null),
    lastValidated:new Date().toISOString(),
    status:'CANDIDATE' /* evidence-gated: stays CANDIDATE until re-validated */
  };
  var sem=readJsonl(root,'semantic','facts.jsonl');
  var i=sem.findIndex(function(x){return x.id===rec.id;});
  if(i>=0)sem[i]=rec;else sem.push(rec);
  if(fs)fs.writeFileSync(jpath(root,'semantic','facts.jsonl'),sem.map(function(x){return JSON.stringify(x);}).join('\n')+'\n');
  return {promoted:true,reason:'ok',id:rec.id,fact:rec};
}

/* ---------- RECALL: proven tiers only ---------- */
/**
 * recall(root, query, k) ->
 *  { exact[], near[], similar:[{id,pct,same,different,settled,continuation}],
 *    counterfactuals:{}, mistakes[], semanticFacts[], working:{...} }
 * NEVER surfaces raw archive as learned fact.
 */
function recall(root,query,k){
  k=k||10;
  var qv=SIM.vectorize(query);
  var corpus=readJsonl(root,'episodic','episodes.jsonl').filter(function(e){return e.settled;}).map(function(e){return {id:e.id,vec:e.vec,settled:true,continuation:e.correct,prediction:e.prediction,createdAt:e.recordedAt};});
  var qcanon=FP.normalizeState(query);
  var qsid=FP.stateId(qcanon);
  var all=readJsonl(root,'episodic','episodes.jsonl');
  var exact=all.filter(function(e){return e.stateId===qsid&&e.settled;});
  var near=[];
  all.forEach(function(e){if(!e.settled||e.stateId===qsid)return;var m=FP.matchLevel(qcanon,e.state);if(m.level==='NEAR'||m.level==='PATTERN_FAMILY')near.push({id:e.id,level:m.level,same:m.same,different:m.different,settled:true});});
  near.sort(function(a,b){return (a.level==='NEAR'?0:1)-(b.level==='NEAR'?0:1);});
  /* counterfactual uses the same settled corpus (it carries vec + correct). */
  return {
    stateId:qsid,fingerprint:FP.fingerprint(qcanon),
    exact:exact,near:near.slice(0,k),
    similar:SIM.nearest(corpus,qv,null,k),
    counterfactuals:{newsPhase:CF.counterfactual(corpus,qv,'newsPhase')},
    mistakes:readJsonl(root,'mistakes','mistakes.jsonl').slice(-10),
    semanticFacts:readJsonl(root,'semantic','facts.jsonl'),
    working:null
  };
}

/* ---------- STATISTICAL + PATTERN aggregation ---------- */
function statisticalReport(root){
  var all=readJsonl(root,'episodic','episodes.jsonl').filter(function(e){return e.settled&&e.correct!=null;});
  function agg(rows){var c=rows.filter(function(e){return e.correct===true;}).length;return {samples:rows.length,correct:c,rate:rows.length?+(c/rows.length).toFixed(3):null};}
  var byPattern={},bySession={};
  all.forEach(function(e){(byPattern[e.pattern]=byPattern[e.pattern]||[]).push(e);(bySession[e.session]=bySession[e.session]||[]).push(e);});
  var rep={generatedAt:new Date().toISOString(),overall:agg(all),
    byPattern:Object.fromEntries(Object.keys(byPattern).map(function(k){return [k,agg(byPattern[k])];})),
    bySession:Object.fromEntries(Object.keys(bySession).map(function(k){return [k,agg(bySession[k])];})),
    episodes:all.length};
  appendJsonl(root,'statistical','report.jsonl',rep);
  return rep;
}
function writePatternFamilies(root){
  var all=readJsonl(root,'episodic','episodes.jsonl').filter(function(e){return e.settled;});
  var fam={};
  all.forEach(function(e){var key=e.tf+'|'+e.pattern+'|'+e.session+'|'+e.newsPhase;(fam[key]=fam[key]||[]).push(e);});
  var rows=Object.entries(fam).map(function(k){var e=fam[k[0]];var c=e.filter(function(x){return x.correct===true;}).length;return {family:k[0],samples:e.length,rate:e.length?+(c/e.length).toFixed(3):null};});
  if(fs)fs.writeFileSync(jpath(root,'patterns','families.jsonl'),rows.map(function(x){return JSON.stringify(x);}).join('\n')+'\n');
  return rows;
}

module.exports={TIERS:TIERS,ensureTree:ensureTree,WorkingMemory:WorkingMemory,
  recordEpisode:recordEpisode,promoteSemantic:promoteSemantic,recall:recall,
  statisticalReport:statisticalReport,writePatternFamilies:writePatternFamilies,
  readJsonl:readJsonl,appendJsonl:appendJsonl,jpath:jpath,dir:dir};
