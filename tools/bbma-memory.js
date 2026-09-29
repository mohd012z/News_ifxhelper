#!/usr/bin/env node
'use strict';
/* CI memory loop (spec §1/§3/§5/§6) — the Memory Brain's persistence engine.
 * Runs in the BBMA Candle Watch workflow AFTER the snapshot builds (real GC=F
 * data only — never synthetic). Each 15-min run, on the REAL snapshot:
 *   1. re-derives the M15 state + canonical fingerprint (stateId)
 *   2. appends an immutable PREDICTION to the hash-chained ledger
 *   3. records a value-scored EPISODE (memory/episodic); raw line into archive
 *   4. SETTLES the prior generation's episode against THIS snapshot's last
 *      candle (exactly one M15 later) -> continuation = did the next candle
 *      continue the predicted direction; failures go to memory/mistakes
 *   5. refreshes statistical + pattern-family reports
 *   6. writes working/last-context.json (current market context)
 * Idempotent per generationId. Kernel_AI (lifecycle/confidence/publishability)
 * is untouched: memory only SUGGESTS, the Governor PUBLISHES.
 */
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MEM=path.join(ROOT,'memory');
const M=require('../lib/memory-orchestrator.js');
const LED=require('../lib/prediction-ledger.js');
const FP=require('../lib/state-fingerprint.js');
const MH=require('../lib/multi-horizon.js');
const MS=require('../lib/mindstate.js');
const TR=require('../lib/decision-trace.js');
const TF='M15',MIN=15,HORIZONS=[1,2,3,5];

M.ensureTree(MEM);
const snap=JSON.parse(fs.readFileSync(path.join(ROOT,'data','bbma-watch.json'),'utf8'));
const gen=snap.generationId||('gen_'+(snap.generatedAt||''));
const lastGenFile=path.join(MEM,'.lastgen');
/* Idempotency, two independent guards: the .lastgen marker (fast) AND the
   ledger itself (authoritative — survives a lost marker). */
const ledgerExists=fs.existsSync(path.join(MEM,'ledger','predictions.jsonl'));
const alreadyLedgered=ledgerExists&&LED.load(path.join(MEM,'ledger','predictions.jsonl')).get('pred_'+gen)!=null;
if((fs.existsSync(lastGenFile)&&fs.readFileSync(lastGenFile,'utf8')===gen)||alreadyLedgered){
  console.log('memory: generation '+gen+' already processed (idempotent); no duplicate');process.exit(0);
}

const analysis=(snap.analysis&&snap.analysis[TF])||null;
const prediction=(analysis&&analysis.next&&analysis.next.state!=='INSUFFICIENT_DATA')?analysis.next:null;
const conf=snap.confidence||null;
const last=snap.last||null;
/* REAL M15 candles from the snapshot's memoryContext (closed bars only — drop
   the forming candle so the fingerprint is reproducible from closed data). */
let m15=(snap.memoryContext&&Array.isArray(snap.memoryContext.candles))?snap.memoryContext.candles:[];
m15=m15.filter(c=>c&&c.time&&Number.isFinite(+c.high)&&Number.isFinite(+c.close));
if(m15.length&&last&&m15[m15.length-1].time===last.time)m15=m15.slice(0,-1); /* forming */
const stateRaw={asset:snap.symbol,tf:TF,analysis:analysis,dashboard:snap.dashboard,news:snap.news,candles:m15};
const canon=FP.normalizeState(stateRaw);
const sid=FP.stateId(canon);
const predDir=_predDir(prediction);

/* ---- 2. immutable PREDICTION (ledger, hash-chained) — full spec schema ---- */
const predId='pred_'+gen;
const traceId='tr_'+gen;
const inputSnapshotHash=FP.canonicalJson ? require('crypto').createHash('sha256').update(JSON.stringify({news:snap.news,dashboard:snap.dashboard,analysisM15:analysis,instrument:snap.instrument})).digest('hex').slice(0,32) : null;
const ledFile=path.join(MEM,'ledger','predictions.jsonl');
const led=LED.load(ledFile);
if(!led.get(predId)){
  const line=led.append('PREDICTION',{
    id:predId,predictionId:predId,traceId:traceId,generationId:gen,
    inputSnapshotHash:inputSnapshotHash,marketTimestamp:(m15.length?m15[m15.length-1].time:null),
    symbol:snap.symbol,tf:TF,stateId:sid,fingerprint:FP.fingerprint(canon),
    state:canon,prediction:prediction,predictedDirection:predDir,confidence:conf,
    newsPhase:canon.newsPhase,session:canon.session,instrument:snap.instrument||null,
    snapshotPrice:m15.length?m15[m15.length-1].close:null,snapshotTime:m15.length?m15[m15.length-1].time:null});
  fs.appendFileSync(ledFile,JSON.stringify(line)+'\n');
}

/* ---- 4. MULTI-HORIZON SETTLEMENT (spec: +1/+2/+3/+5, MFE/MAE) ----
   The prior generation's PREDICTION is settled against the closed M15 candles
   that have since appeared in memoryContext. Incremental + append-only:
   a horizon outcome is written only when its bar count becomes available and
   is NEVER overwritten (hindsight-leak prevention). The original prediction
   fields stay immutable; outcomes are APPENDED under actual.horizons. ---- */
let settledCount=0,failCount=0,partialCount=0;
{
  const afterByTime={};
  m15.forEach(c=>{afterByTime[c.time]=c;});
  const times=Object.keys(afterByTime).sort();
  const epsFile=path.join(MEM,'episodic','episodes.jsonl');
  if(fs.existsSync(epsFile)){
    const epsList=M.readJsonl(MEM,'episodic','episodes.jsonl');
    let changed=false;
    epsList.forEach((e)=>{
      if(!e.prediction||!e.snapshotTime||e.correct!=null)return; /* +1 already settled: never re-score the headline */
      const idx=times.indexOf(e.snapshotTime);
      if(idx<0)return;
      const after=times.slice(idx+1).map(t=>afterByTime[t]); /* closed M15 candles AFTER the prediction */
      if(!after.length)return;
      const hz=MH.settleHorizons({openPrice:e.snapshotPrice,candles:after,predictedState:e.prediction.state});
      const merged=MH.mergeSettlement(e,hz);
      /* incrementally adopt only the horizons that are now available */
      Object.assign(e,merged);
      if(hz.horizons[1]&&hz.horizons[1].available){
        settledCount++;
        if(e.correct===false)failCount++;
        /* failures are first-class MISTAKE memory (spec §1) */
        if(e.correct===false&&!M.readJsonl(MEM,'mistakes','mistakes.jsonl').some(m=>m.id===e.stateId&&m.settledAt===e.settledAt)){
          M.appendJsonl(MEM,'mistakes','mistakes.jsonl',{id:e.stateId,tf:e.tf,state:e.state,prediction:e.prediction,actual:e.actual,why:e.importanceFlags||[],recordedAt:e.recordedAt,settledAt:e.settledAt});
        }
      }else if(Object.keys(hz.horizons).some(k=>hz.horizons[k]&&hz.horizons[k].available)){
        partialCount++; /* higher horizons available but +1 not yet (shouldn't happen — +1 is the first) */
      }
      changed=true;
    });
    if(changed)fs.writeFileSync(epsFile,epsList.map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
}

/* ---- 3. record THIS generation's episode (pre-settlement) + raw archive ---- */
const rec=M.recordEpisode(MEM,{asset:snap.symbol,tf:TF,analysis:analysis,dashboard:snap.dashboard,news:snap.news,
  candles:m15,prediction:prediction,confidence:conf,generationId:gen,actual:null});

/* ---- 5. statistical + pattern reports ---- */
const stat=M.statisticalReport(MEM);
const pats=M.writePatternFamilies(MEM);

/* ---- 6. working context (current, overwritten) ---- */
fs.writeFileSync(path.join(MEM,'working','last-context.json'),JSON.stringify({generationId:gen,symbol:snap.symbol,stateId:sid,fingerprint:FP.fingerprint(canon),
  state:canon,newsPhase:canon.newsPhase,session:canon.session,confidence:conf,mtf:snap.dashboard&&snap.dashboard.overall,
  prediction:prediction,confidenceScore:conf?conf.score:null,prohibitions:conf?conf.prohibitions:[],
  writtenAt:new Date().toISOString()},null,1)+'\n');

/* ---- 7. MINDSTATE (spec §15): one compact "what the system knows" object ----
   The interface Fast-Thinker -> IN_AI -> Kernel -> Dashboard. Derived only
   from the proven libs; it never recomputes BBMA and never publishes. ---- */
{
  const allEps=M.readJsonl(MEM,'episodic','episodes.jsonl');
  const settled=allEps.filter(e=>e.settled&&e.correct!=null);
  const openPreds=allEps.filter(e=>!e.settled&&e.prediction);
  const genIds=allEps.map(e=>e.generationId).filter(Boolean);
  /* model lineage preserved + expanded (spec §10): CONSISTENT/MIXED/UNKNOWN */
  const LINE=require('../lib/bbma-learning.js');
  const lin=LINE.lineage(allEps);
  /* trend strength from real closed M15 (6-bar % move, same scale as similarity) */
  let trendStrength=null;
  if(m15.length>6){const a=+m15[m15.length-1].close,b=+m15[m15.length-7].close;if(b)trendStrength=+(((a-b)/Math.abs(b))*100).toFixed(3);}
  const up=Object.keys(snap.dashboard.rows||{}).length?snap.dashboard.rows.filter(r=>r.trend==='UP').map(r=>r.tf):[];
  const dn=snap.dashboard.rows.filter(r=>r.trend==='DOWN').map(r=>r.tf);
  const mtf={};snap.dashboard.rows.forEach(r=>{mtf[r.tf]={trend:r.trend,state:'READY'};});
  const msCtx={
    symbol:snap.symbol,price:m15.length?m15[m15.length-1].close:null,instrument:snap.instrument,feed:null,
    mtf:mtf,zone:analysis&&analysis.bbma?analysis.bbma.zone:null,pattern:analysis&&analysis.bbma?(analysis.bbma.reentry||analysis.bbma.momentum||analysis.bbma.trend):null,
    squeeze:analysis&&analysis.squeeze?analysis.squeeze.squeeze:null,
    news:snap.news,session:canon.session,atr:canon.atr,trendStrength:trendStrength,htfConflict:up.length&&dn.length,
    eventImpact:snap.news&&snap.news.event?snap.news.event.impact:null,
    confidence:conf,modelLineage:lin.status,generationIds:genIds,
    episodes:allEps,stateId:sid,
    openPredictions:openPreds.slice(-5),pendingOutcomes:openPreds.slice(-5),
    recentMistakes:M.readJsonl(MEM,'mistakes','mistakes.jsonl').slice(-5),now:Date.now()
  };
  const mind=MS.buildMindState(msCtx);
  fs.writeFileSync(path.join(MEM,'working','mindstate.json'),JSON.stringify(mind,null,1)+'\n');
}

/* ---- 8. structured DECISION TRACE (spec §12): the audit spine for /codeview ----
   One trace per generation; each stage records inputHash/output/quality. ---- */
{
  const traceFile=path.join(MEM,'ledger','traces.jsonl');
  const mk=(stage,extra)=>TR.appendToFile(traceFile,traceId,stage,Object.assign({generationId:gen,stateId:sid},extra||{}));
  if(!fs.existsSync(traceFile)||!TR.load(traceFile).at('INGEST')){
    mk('INGEST',{source:'GC=F',quality:conf?'REAL':'UNKNOWN',output:{bars:m15.length,gen:gen}});
    mk('VALIDATE',{quality:conf&&conf.prohibitions&&!conf.prohibitions.length?'VALID':'PROHIBITED',output:{prohibitions:conf?conf.prohibitions:[]}});
    mk('BBMA',{quality:analysis&&analysis.bbma?'READY':'INSUFFICIENT',output:{zone:analysis&&analysis.bbma&&analysis.bbma.zone,pattern:analysis&&analysis.bbma&&(analysis.bbma.reentry||analysis.bbma.momentum||analysis.bbma.trend)}});
    mk('NEWS',{quality:snap.news.state,output:{state:snap.news.state,event:snap.news.event&&snap.news.event.title}});
    mk('FAST_THINK',{quality:'READY',output:{prediction:prediction&&prediction.state,confidence:prediction&&prediction.confidence}});
    mk('RECALL',{quality:'OK',output:{fingerprint:FP.fingerprint(canon)}});
    mk('FALSIFY',{quality:'OK',output:{lifecycle: snap.lifecycle?snap.lifecycle.stage:null}});
    mk('KERNEL',{quality:conf?conf.verdict:'WAIT',output:{decision:conf?conf.verdict:null,score:conf?conf.score:null}});
    mk('PREDICT',{quality:'APPENDED',output:{predictionId:predId,traceId:traceId}});
  }
}

fs.writeFileSync(lastGenFile,gen);
const chk=LED.load(ledFile).verify();
const allEps2=M.readJsonl(MEM,'episodic','episodes.jsonl');
console.log('memory: gen '+gen+' | state '+FP.fingerprint(canon)+' | value '+rec.value.value+' ('+rec.tier+') | settled '+settledCount+' (failures '+failCount+') | ledger '+chk.lines+' verify '+(chk.ok?'OK':'BROKEN@'+chk.brokenAt)+' | episodes '+allEps2.length+' (settled '+allEps2.filter(e=>e.settled).length+') | patterns '+pats.length+' | mindstate + trace written');

function _predDir(p){var s=(p&&p.state||'').toUpperCase();return s.indexOf('UP')>=0?'UP':s.indexOf('DOWN')>=0?'DOWN':s.indexOf('RANGE')>=0?'FLAT':'UNKNOWN';}
