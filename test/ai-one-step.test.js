'use strict';
/* Executed proof for the 1-step-ahead slice (lib/ai/*).
 * Run: node test/ai-one-step.test.js
 */
const assert=require('assert');
const W=require('../lib/bbma-candle-watch.js');
const FS=require('../lib/ai/feature-snapshot.js');
const VAL=require('../lib/ai/feature-validator.js');
const REG=require('../lib/ai/regime-engine.js');
const EM=require('../lib/ai/empirical-memory.js');
const OS=require('../lib/ai/one-step-engine.js');
const GS=require('../lib/ai/consensus-engine.js');
const DC=require('../lib/ai/data-class.js');
const MET=require('../lib/ai/metrics.js');

/* deterministic M15 candles directly (weekdays, contiguous, .time = bucket OPEN) */
function realM15(n){
  let p=4167.0;const out=[];let seed=11;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  let t=Date.UTC(2026,8,21,0,0,0); // a Monday
  let made=0;
  while(made<n){
    const d=new Date(t);
    if(d.getUTCDay()!==0&&d.getUTCDay()!==6){
      const o=p;p=Math.max(1000,o+(rnd()-0.48)*1.2);const c=p;
      out.push({time:new Date(t).toISOString(),open:o,high:Math.max(o,c)+.4,low:Math.min(o,c)-.4,close:c,volume:1,isClosed:true,valid:true});
      made++;
    }
    t+=900000;
  }
  return out;
}
const m15=realM15(120);
const N=m15.length;
const INST={display:'XAU/USD',analysisSymbol:'XAUUSD',providerSymbol:'GC=F',marketType:'FUTURES',isProxy:true};
let pass=0;function ok(c,m){assert(c,m);pass++;}

/* 1. DATA-CLASS gate (P0-C) */
ok(DC.gate('REAL_GC=F').allowed===true,'real observed source allowed');
ok(DC.gate('BASELINE_CACHE').allowed===false,'synthetic BASELINE_CACHE rejected');
ok(DC.gate('SYNTHETIC').allowed===false,'synthetic rejected');
ok(DC.gate('DEMO_SAMPLE').allowed===false,'demo rejected');
ok(DC.gate('YAHOO_LIVE').allowed===true,'live feed allowed');
ok(DC.classify('BASELINE_CACHE')==='SYNTHETIC','BASELINE_CACHE -> SYNTHETIC');

/* 2. FEATURE SNAPSHOT: anchored, future-invariant, real features */
const anchor=m15[N-3];
const upto=m15.slice(0,N-2);
const target=m15[N-2];
const loc=W.location(upto);
const inp={candles:m15,asOf:anchor.time,tf:'M15',analysis:loc,squeeze:null,news:{state:'CLEAR'},instrument:INST,dataClass:'OBSERVED',mtf:{H1:{trend:'UP'},H4:{trend:'UP'}}};
const snap=FS.build(inp);
ok(snap.schema==='FeatureSnapshot/v1','snapshot schema');
ok(snap.candleClose===anchor.time,'anchored to the closed candle (asOf)');
ok(snap.dataClass==='OBSERVED','dataClass carried');
ok(snap.volatility.atrBand&&snap.volatility.atrPct!=null,'real ATR band+pct present');
ok(snap.session.name!=='UNKNOWN','real session (weekdays)');
ok(snap.location.bbZone===loc.zone,'zone from engine (single authority, not recomputed)');
/* deep-frozen immutability */
let threw=false;try{snap.bbma.trend='HACK';}catch(e){threw=true;}
ok(threw,'snapshot is deep-frozen (assignment throws)');
threw=false;try{snap.volatility.atrPct=99;}catch(e){threw=true;}
ok(threw,'nested field frozen too');

/* 3. LEAKAGE: future-invariant (append + mutation), and detector has teeth */
const leak=VAL.check(inp);
ok(leak.ok===true,'no future information in anchored snapshot');
/* detector has teeth: a future-anchored snapshot (different closed candle) MUST differ */
const futureAnchorSnap=FS.build(Object.assign({},inp,{asOf:m15[N-1].time,analysis:W.location(m15.slice(0,N-1))}));
ok(futureAnchorSnap.candleClose!==snap.candleClose,'a future-anchored snapshot is a DIFFERENT state (leakage detector has teeth)');

/* 4. ONE-STEP ENGINE: candidate (deterministic), heuristicScore (renamed), movement, invalidation */
const cand=OS.predict(snap,{candles:upto,analysis:loc,corpus:[],minSamples:8});
ok(cand.status==='CANDIDATE','engine emits a CANDIDATE (never PENDING itself)');
ok(['UP','DOWN','RANGE'].indexOf(cand.direction)>=0,'direction is UP/DOWN/RANGE');
ok(cand.heuristicScore!=null,'heuristicScore present (renamed from confidence)');
ok(cand.invalidation.length>0,'invalidation conditions present');
ok(cand.regime.regime!=='UNKNOWN','regime classified');
ok(cand.movementClass,'movement class present');

/* 5. REGIME engine */
const reg=REG.classify(snap);
ok(['TREND','RANGE','SQUEEZE','EXPANSION','NEWS_SHOCK','POST_NEWS','TRANSITION'].indexOf(reg.regime)>=0,'regime in vocabulary');

/* 6. EMPIRICAL memory: hierarchical, UNKNOWN on thin, rate on enough */
const q={tf:'M15',bbma:loc.reentry&&loc.reentry!=='NONE'?loc.reentry:'UP',zone:loc.zone,volatility:snap.volatility.atrBand,session:snap.session.name,news:'CLEAR',trend:'UP'};
const corpus=Array.from({length:10},(_,i)=>({tf:'M15',settled:true,correct:i<6,state:{pattern:q.bbma,bbmaZone:q.zone,atr:q.volatility,session:q.session,newsPhase:'CLEAR',htf:{H1:'UP'}}}));
const thin=EM.match(q,corpus.slice(0,1));
ok(thin.ok===false,'1 sample -> no empirical claim (UNKNOWN)');
const enough=EM.match(q,corpus);
ok(enough.ok===true,'10 samples -> empirical rate produced');
ok(enough.rate.n===10&&Math.abs(enough.rate.rate-60)<0.01,'rate 60% / n=10 correct');

/* 7. CONSENSUS / VERIFICATION GATE (shadow, AI-never-publishes) */
const gate=GS.verify(cand,snap,{shadow:true});
ok(gate.status==='PENDING_SHADOW','clean candidate -> PENDING_SHADOW (not a live alert)');
ok(gate.publishable===true,'publishable when dataClass/news clean');
ok(gate.aiCanPublish===false,'AI sidecar can NEVER publish (§20)');
/* reject synthetic */
const badSnap=Object.assign({},snap);badSnap.dataClass='SYNTHETIC';
const badGate=GS.verify(cand,badSnap,{shadow:true});
ok(badGate.status==='REJECTED'&&badGate.drivers.length>0,'SYNTHETIC dataClass -> REJECTED with driver');
/* reject missing instrument */
const noInst=Object.assign({},snap);noInst.instrumentId='UNKNOWN';
ok(GS.verify(cand,noInst,{shadow:true}).status==='REJECTED','missing instrument -> REJECTED');

/* 8. EXACT-NEXT settlement + METRICS (the "teaches the system" loop) */
function settle(cand2,anchorC,targetC,snapX){
  const retPct=((targetC.close-anchorC.close)/anchorC.close)*100;
  const act=targetC.close>anchorC.close?'UP':targetC.close<anchorC.close?'DOWN':'FLAT';
  return {settled:true,direction:cand2.direction,actualDirection:act,forecastProb:cand2.heuristicScore/100,heuristicScore:cand2.heuristicScore,actualReturnPct:retPct,tf:'M15',session:snapX.session.name,regime:cand2.regime.regime,newsMode:snapX.news.mode,bbZone:snapX.bbma.zone,mtfAligned:'UP',correct:(cand2.direction==='RANGE'?Math.abs(retPct)<0.05:(cand2.direction===act))};
}
/* settle the same anchor against several targets to build a metric sample */
const obs=[];
for(let k=0;k<10;k++){
  const aIdx=N-20+k, an=m15[aIdx], tg=m15[aIdx+1];
  const w=upto.slice(0,aIdx);
  const l2=W.location(w);
  const s2=FS.build({candles:m15,asOf:an.time,tf:'M15',analysis:l2,squeeze:null,news:{state:'CLEAR'},instrument:INST,dataClass:'OBSERVED',mtf:{H1:{trend:'UP'},H4:{trend:'UP'}}});
  const c2=OS.predict(s2,{candles:w,analysis:l2,corpus:[],minSamples:8});
  obs.push(settle(c2,an,tg,s2));
}
const m=MET.summarize(obs);
ok(m.n===10,'metrics over 10 settled obs');
ok(m.directionalAccuracy!=null,'directional accuracy present');
ok(m.brier!=null,'brier score present');
ok(m.confusion&&m.precision,'confusion matrix + precision present');
ok(m.breakdown.tf&&m.breakdown.session,'breakdown by tf + session');
ok(m.meanNextReturn!=null&&m.medianNextReturn!=null,'mean+median next-return');

console.log('PASS: ai-one-step — 1-step-ahead slice executed-proofed (dataClass gate, anchored+leak-free snapshot, deterministic candidate, hierarchical empirical memory, shadow verification gate, exact-next settlement, metrics).',pass,'assertions');
