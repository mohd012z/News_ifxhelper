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
const TF='M15',MIN=15;

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

/* ---- 2. immutable PREDICTION (ledger, hash-chained) ---- */
const predId='pred_'+gen;
const ledFile=path.join(MEM,'ledger','predictions.jsonl');
const led=LED.load(ledFile);
if(!led.get(predId)){
  const line=led.append('PREDICTION',{id:predId,generationId:gen,symbol:snap.symbol,tf:TF,stateId:sid,fingerprint:FP.fingerprint(canon),
    state:canon,prediction:prediction,predictedDirection:predDir,confidence:conf,
    newsPhase:canon.newsPhase,session:canon.session,instrument:snap.instrument||null,
    snapshotPrice:last?last.close:null,snapshotTime:last?last.time:null});
  fs.appendFileSync(ledFile,JSON.stringify(line)+'\n');
}

/* ---- 4. SETTLE the prior generation's episode against THIS snapshot's last
        CLOSED M15 candle (exactly one M15 after the episode's snapshot M15). ---- */
const settleCandle=m15.length?m15[m15.length-1]:null;
const epsFile=path.join(MEM,'episodic','episodes.jsonl');
let settledCount=0,failCount=0;
if(fs.existsSync(epsFile)&&settleCandle){
  const eps=M.readJsonl(MEM,'episodic','episodes.jsonl');
  let changed=false;
  eps.forEach((e,i)=>{
    if(e.settled||!e.prediction||!e.snapshotTime)return;
    const dt=Date.parse(settleCandle.time)-Date.parse(e.snapshotTime);
    if(dt!==MIN*60000)return; /* only the immediately-next closed M15 candle settles it */
    const ad=settleCandle.close>settleCandle.open?'UP':settleCandle.close<settleCandle.open?'DOWN':'FLAT';
    const correct=(e.predictedDirection==='UNKNOWN'||e.predictedDirection==='FLAT')?null:(e.predictedDirection===ad);
    e.settled=true;e.settledAt=new Date().toISOString();
    e.actual={direction:ad,returnPct:+(((settleCandle.close-settleCandle.open)/settleCandle.open)*100).toFixed(4),nextTime:settleCandle.time};
    e.predictedDirection=e.predictedDirection||_predDir(e.prediction);e.actualDirection=ad;e.correct=correct;
    changed=true;settledCount++;
    if(correct===false)failCount++;
  });
  if(changed){
    fs.writeFileSync(epsFile,eps.map(x=>JSON.stringify(x)).join('\n')+'\n');
    /* failures are first-class mistake memory (spec §1). */
    eps.filter(e=>e.settled&&e.correct===false).forEach(e=>{
      if(!M.readJsonl(MEM,'mistakes','mistakes.jsonl').some(m=>m.id===e.stateId&&m.settledAt===e.settledAt))
        M.appendJsonl(MEM,'mistakes','mistakes.jsonl',{id:e.stateId,tf:e.tf,state:e.state,prediction:e.prediction,actual:e.actual,why:e.importanceFlags||[],recordedAt:e.recordedAt,settledAt:e.settledAt});
    });
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

fs.writeFileSync(lastGenFile,gen);
const chk=LED.load(ledFile).verify();
const allEps=M.readJsonl(MEM,'episodic','episodes.jsonl');
console.log('memory: gen '+gen+' | state '+FP.fingerprint(canon)+' | value '+rec.value.value+' ('+rec.tier+') | settled '+settledCount+' (failures '+failCount+') | ledger '+chk.lines+' verify '+(chk.ok?'OK':'BROKEN@'+chk.brokenAt)+' | episodes '+allEps.length+' (settled '+allEps.filter(e=>e.settled).length+') | patterns '+pats.length);

function _predDir(p){var s=(p&&p.state||'').toUpperCase();return s.indexOf('UP')>=0?'UP':s.indexOf('DOWN')>=0?'DOWN':s.indexOf('RANGE')>=0?'FLAT':'UNKNOWN';}
