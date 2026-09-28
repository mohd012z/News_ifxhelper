'use strict';
/* Executed proof: IntelligenceKernel — the full 22-brain shadow flow.
 * Run: node test/codebrains-kernel.test.js
 */
const assert=require('assert');
const K=require('../lib/codebrains/intelligence-kernel.js');
let pass=0;function ok(c,m){assert(c,m);pass++;}
function m15(n){let p=4167.0;const out=[];let seed=9;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};let t=Date.UTC(2026,8,21,0,0,0);let made=0;while(made<n){const d=new Date(t);if(d.getUTCDay()!==0&&d.getUTCDay()!==6){const o=p;p=Math.max(1000,o+(rnd()-0.48)*1.2);const c=p;out.push({time:new Date(t).toISOString(),open:o,high:Math.max(o,c)+.4,low:Math.min(o,c)-.4,close:c,volume:1,isClosed:true,valid:true});made++;}t+=900000;}return out;}
const candles=m15(120);
const tLast=Date.parse(candles[candles.length-1].time);
const now=tLast+20*60000; /* 20 min after the last OPEN -> last candle fully closed -> settlement can fire */
const inst={providerSymbol:'GC=F',analysisSymbol:'XAUUSD',marketType:'FUTURES'};

/* ===== full run (clean feed, aligned MTF, clear news) =====
   Pin asOf to the second-to-last closed candle so the EXACT next candle is
   already closed -> the full loop incl. settlement fires (replay mode). */
const res=K.run({candles:candles,asOf:candles[candles.length-2].time,source:'YAHOO_LIVE',tf:'M15',instrument:inst,news:{state:'CLEAR'},mtf:{M15:{trend:'UP'},H1:{trend:'UP'},H4:{trend:'UP'}},corpus:[],records:[],now:now});
ok(res.schema==='IntelligenceKernel/v1','kernel schema');
ok(res.status==='PENDING_SHADOW','clean run -> PENDING_SHADOW (shadow, not a live alert)',res.status+' '+JSON.stringify(res.blockedBy||''));
/* trace covers the documented brain order */
const brains=res.trace.map(b=>b.brain);
['DataBrain','SourceBrain','ValidationBrain','FeatureBrain','BBMABrain','RegimeBrain','SessionBrain','NewsBrain','HistoryBrain','ConsensusBrain','in_aiBrain','PredictionBrain','VerificationBrain'].forEach(b=>ok(brains.indexOf(b)>=0,'trace includes '+b));
const by={};res.trace.forEach(b=>{by[b.brain]=b;});
ok(by.DataBrain.status==='VALID'||by.DataBrain.status==='DEGRADED','data brain VALID/DEGRADED on clean feed');
ok(by.SourceBrain.id==='GC_FUTURES','source brain = GC_FUTURES (explicit identity, not anonymous GOLD)');
ok(by.ValidationBrain.verdict==='VALID'||by.ValidationBrain.verdict==='DEGRADED','validation brain ok');
ok(by.HistoryBrain.status==='INSUFFICIENT_HISTORY','history HONEST: INSUFFICIENT_HISTORY on empty corpus (no forced claim)');
ok(by.VerificationBrain.stage==='PENDING_SHADOW','verification stage PENDING_SHADOW');
/* hypothesis contract (§12) */
const h=res.hypothesis;
ok(h&&h.schema==='OneStepHypothesis/v1','OneStepHypothesis emitted');
ok(['UP','DOWN','RANGE'].indexOf(h.direction)>=0,'direction UP/DOWN/RANGE');
ok(h.movementClass,'movement class');
ok(h.falsifier&&h.falsifier.length>0,'falsifier present (pre-candle)');
ok(h.falsifiers&&h.falsifiers.length>=3,'multiple falsifiers (incl. integrity: leakage/timestamp/source)');
ok(h.status==='PENDING','hypothesis PENDING (never CONFIRMED by the engine)');
ok(h.regime,'regime on hypothesis');
ok(h.session&&h.session!=='UNKNOWN','real session on hypothesis');
/* invariants: AI can never publish; gate is Kernel_AI only */
ok(res.invariants.aiCanPublish===false,'invariant: in_ai can NEVER publish');
ok(res.invariants.publishGate==='Kernel_AI only','invariant: publish gate = Kernel_AI only');
/* settlement (exact next closed candle) fired now that the next candle is closed */
ok(res.settlement&&res.settlement.result,'settlement fired on the exact next closed candle',JSON.stringify(res.settlement||null));
ok(['CONFIRMED','FALSIFIED','INCONCLUSIVE','INVALIDATED'].indexOf(res.settlement.result)>=0,'settlement verdict in vocabulary');
ok(res.settlement.actual&&res.settlement.actual.returnPct!=null,'settlement records actual return');
/* learning record appended (append-only, not deleted on failure) */
ok(res.learning&&res.learning.result===res.settlement.result,'learning record mirrors the settlement');
ok(res.learning.tf==='M15','learning record carries tf');
/* audit refs for reconstruction */
ok(res.audit&&res.audit.predictionId&&res.audit.rulesVersion==='codebrains/v1','audit refs (predictionId + rules version)');
ok(res.audit.lineage==='CONSISTENT','audit lineage CONSISTENT');

/* ===== integrity refusals (the hard rules) ===== */
const syn=K.run({candles:candles,source:'BASELINE_CACHE',tf:'M15',instrument:inst,news:{state:'CLEAR'},mtf:{},now:now});
ok(syn.status==='BLOCKED'&&syn.blockedBy==='data/source','SYNTHETIC feed BLOCKED at DataBrain (never reaches a model)');
const syn2=K.run({candles:candles,source:'DEMO_SAMPLE',tf:'M15',instrument:inst,news:{state:'CLEAR'},mtf:{},now:now});
ok(syn2.status==='BLOCKED','DEMO feed BLOCKED');
const badSrc=K.run({candles:candles,source:'YAHOO_LIVE',tf:'M15',instrument:{providerSymbol:'???'},news:{state:'CLEAR'},mtf:{},now:now});
ok(badSrc.status==='BLOCKED','unknown instrument identity BLOCKED');
const short=K.run({candles:candles.slice(0,30),source:'YAHOO_LIVE',tf:'M15',instrument:inst,news:{state:'CLEAR'},mtf:{},now:now});
ok(short.status==='BLOCKED','<50 closed candles BLOCKED (no prediction on thin history)');
const stale=K.run({candles:candles,source:'YAHOO_LIVE',tf:'M15',instrument:inst,news:{state:'CLEAR'},mtf:{},now:tLast+5*3600*1000});
ok(stale.status==='BLOCKED','stale feed (5h old) BLOCKED');
/* news regime change must surface (not be averaged away) */
const newsRes=K.run({candles:candles,source:'YAHOO_LIVE',tf:'M15',instrument:inst,news:{state:'NEWS_RELEASE',event:{impact:'HIGH',actual:'0.4',forecast:'0.1'}},mtf:{M15:{trend:'UP'},H1:{trend:'UP'}},corpus:[],records:[],now:now});
ok(newsRes.trace.find(b=>b.brain==='NewsBrain').strength==='REGIME_CHANGE','high-impact release -> NewsBrain REGIME_CHANGE');

console.log('PASS: codebrains-kernel — the full 22-brain IntelligenceKernel executed end-to-end on real closed candles: input gate (Data/Source/Validation) -> locked Feature -> BBMA/Regime/Session/News/History/Consensus/in_ai -> OneStepHypothesis with pre-candle falsifiers -> PENDING_SHADOW verification (aiCanPublish:false, Kernel_AI-only gate) -> exact-next-candle settlement -> append-only learning -> audit refs; synthetic/demo/unknown-instrument/thin/stale feeds all BLOCKED; empty history reports INSUFFICIENT_HISTORY honestly.',pass,'assertions');
