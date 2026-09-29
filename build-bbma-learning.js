'use strict';
const fs=require('fs'),path=require('path'),P=require('./lib/market-provider'),V=require('./lib/ohlc-validator'),R=require('./lib/ohlc-resampler'),L=require('./lib/bbma-learning'),S=require('./lib/learning-store'),GF=require('./lib/generation-fingerprint'),IR=require('./lib/instrument-registry'),HS=require('./lib/history-store'),FM=require('./lib/formation-memory'),IM=require('./lib/instrument-memory'),B=require('./lib/bbma-engine'),FP=require('./lib/state-fingerprint'),SE=require('./lib/session-engine');
const WATCH=path.join('data','bbma-watch.json'),HISTORY=path.join('data','bbma-learning.json'),PERF=path.join('data','bbma-performance.json'),SYMBOL=process.env.BBMA_SYMBOL||'GC=F';
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
/* P0 lineage: the ALGORITHM identity (not the per-cycle data id). Every
   observation inherits it so results from an older engine/rules/config are
   never counted as current-generation performance. */
const instrument=IR.resolve({providerSymbol:SYMBOL,analysisSymbol:'XAUUSD',marketType:SYMBOL.indexOf('=')>=0?'FUTURES':'SPOT',provider:'yahoo'});
const MEMROOT=IM.memoryRoot(instrument); /* F0: every memory row is partitioned by this */
/* ATR band as of candle t: percentile over the 500 candles ENDING at t
   (window slice before the index — no future data). Makes recall rows
   L1/L4-queryable (volatility key). */
function atrBandOf(arr,t){
  if(!arr||!arr.length)return null;
  var i=-1;
  for(var k=0;k<arr.length;k++){if(arr[k].time===t){i=k;break;}}
  if(i<0)return null;
  var p=FP.atrPctile(arr.slice(Math.max(0,i-499),i+1));
  if(p==null)return null;
  return p>=90?'VERY_HIGH':p>=75?'HIGH':p<=25?'LOW':'NORMAL';
}
const genFp=GF.fingerprint({provider:'yahoo:'+SYMBOL,instrument:instrument.canonicalId,extraConfig:{range:'5d',interval:'1m'}});
(async()=>{
const watch=read(WATCH,null);if(!watch)throw Error('bbma-watch.json missing');
const dataGenId=watch.generationId||null;
if(!dataGenId)console.warn('BBMA watch has no data generationId (lineage falls back to algorithm id only)');
const raw=await P.yahoo(SYMBOL,{interval:'1m',range:'5d',timeoutMs:12000}),valid=V.validateSeries(raw.candles,{timeframeMinutes:1});
const m1=valid.candles.filter(x=>x.valid&&x.isClosed).map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume}));
const frames=R.buildFrames(m1);

/* F1/F2 — per-TF PER-CANDLE canonical engine reads (single authority:
   lib/bbma-engine.js classify, the SAME function the live read uses).
   Window = all candles up to k (exact parity with the current read).
   M1 is excluded from formation memory (noise); TFs with <50 closed
   candles yield no READY rows — honest, not forced. */
const perTf={};
for(const tf of ['M5','M15','M30','H1']){
  const arr=frames[tf]||[];const out=[];
  for(let k=0;k<arr.length;k++){
    if(k<49)continue;
    const c=B.classify(arr.slice(0,k+1));
    if(c.state!=='READY')continue;
    out.push({time:arr[k].time,c:arr[k],bbma:c});
  }
  perTf[tf]=out;
}
/* tokens per candle time (for F5 nextState lookup) */
const tokensByTime={};
for(const tf of Object.keys(perTf)){tokensByTime[tf]={};perTf[tf].forEach(r=>{tokensByTime[tf][r.time]=FM.stateToken(r.bbma);});}

/* F1 — ClosedCandleMemory: append canonical immutable candle rows (deduped
   by contentHash: re-runs are no-ops, history is audit-complete). */
for(const tf of Object.keys(perTf)){
  perTf[tf].forEach(r=>{
    const cc=FM.canonicalCandle(r.c,r.bbma,{symbol:instrument.analysisSymbol,tf:tf,provider:raw.provider||'yahoo',sourceSymbol:SYMBOL});
    HS.append('formation',{rowType:'CANDLE',candleId:cc.candleId,instrumentId:instrument.canonicalId,memoryRoot:MEMROOT,tf:tf,time:r.time,ohlc:cc.ohlc,body:cc.body,bbma:{state:cc.bbma.state,event:cc.bbma.event,direction:cc.bbma.direction,zone:cc.bbma.zone,csak:cc.bbma.csak,momentum:cc.bbma.momentum,reentry:cc.bbma.reentry,extreme:cc.bbma.extreme},session:cc.session.name,provenance:cc.provenance});
  });
}
/* F2 — transition state machine rows (from→to, barsElapsed, candle ids). */
for(const tf of Object.keys(perTf)){
  const t=FM.transitionsFor(perTf[tf],tf,{symbol:instrument.analysisSymbol});
  t.transitions.forEach(tr=>{
    HS.append('formation',{rowType:'TRANSITION',instrumentId:instrument.canonicalId,memoryRoot:MEMROOT,tf:tf,from:tr.from,to:tr.to,startCandleId:tr.startCandleId,confirmedCandleId:tr.confirmedCandleId,barsElapsed:tr.barsElapsed});
  });
}
/* F3 — the MTF formation tree (HOW each tf reached its state) + F4
   formation fingerprint, anchored at the latest closed M15. */
let formation=null;
const m15arr=frames.M15||[];
if(m15arr.length>=50){
  const anchorTime=m15arr[m15arr.length-1].time;
  const tree=FM.formationTree(watch.analysis||{}, {tf:'M15',time:anchorTime},{symbol:instrument.analysisSymbol,provider:raw.provider||'yahoo',sourceSymbol:SYMBOL,instrument:instrument});
  const atrPct=FP.atrPctile(m15arr);
  const atrBand=atrPct==null?null:(atrPct>=90?'VERY_HIGH':atrPct>=75?'HIGH':atrPct<=25?'LOW':'NORMAL');
  const desc={session:SE.sessionOf(Date.parse(anchorTime)),newsPhase:watch.news&&watch.news.state||null,atrBand:atrBand};
  const fp=FM.formationFingerprint(tree,desc);
  formation={snapshotId:tree.snapshotId,tf:tree.tf,layers:tree.layers,relationships:tree.relationships,fingerprint:fp.fingerprint,formationFingerprintId:fp.stateId,descriptor:desc};
  HS.append('formation',{rowType:'FORMATION',instrumentId:instrument.canonicalId,memoryRoot:MEMROOT,anchorTime:anchorTime,snapshotId:tree.snapshotId,tf:tree.tf,relationships:tree.relationships,fingerprint:fp.fingerprint,formationFingerprintId:fp.stateId,descriptor:desc});
}

/* PHASE C/D ledger linkage — a prediction ANCHORED at sourceCandleTime=S
   tests the observation FOR candle S (which settleDue judges against S+tf,
   the contract's targetTime). So the link is obs.candleTime === sourceCandleTime.
   Read through the DURABLE prediction ledger (not the live watch, which is
   overwritten every cycle) so the contract that named a candle is recovered
   even after newer watches predict later candles. Append-only + content-hash
   deduped, so re-runs never double-record and the hypothesis is never edited. */
const predsBySource={};try{HS.readKind('prediction').forEach(function(r){if(r&&r.sourceCandleTime)predsBySource[r.sourceCandleTime]=r;});}catch(e){}
let rows=read(HISTORY,[]);
rows=S.settleDue(rows,frames);
/* F5 — multi-horizon settlement (+1/+2/+3/+5, direction-aware MFE/MAE,
   nextState, plus1Against). Recomputed every run while the horizons are
   still filling in (complete=false); once complete it is stable. */
for(const r of rows){
  if(r.status!=='SETTLED'||!tokensByTime[r.tf])continue;
  if(r.multiHorizon&&r.multiHorizon.complete)continue;
  const mh=FM.multiHorizon(r,frames,tokensByTime[r.tf]);
  if(mh){r.multiHorizon=mh;r.memoryRoot=MEMROOT;}
}
for(const r of rows){
  if(r.status!=='SETTLED')continue;
  const pc=predsBySource[r.candleTime];
  if(!pc||!pc.predictionId)continue;
  const verdict=r.correct===true?'CONFIRMED':r.correct===false?'FALSIFIED':'INCONCLUSIVE';
  HS.append('outcome',{rowType:'OUTCOME',predictionId:pc.predictionId,snapshotId:pc.snapshotId||null,timeframe:pc.timeframe||r.tf,instrumentId:instrument.canonicalId,memoryRoot:MEMROOT,direction:pc.direction||null,verdict:verdict,reason:r.outcomeReason||null,returnPct:r.nextReturnPct!=null?r.nextReturnPct:null,actualDirection:r.actualDirection||null,multiHorizon:r.multiHorizon||null,model:pc.model||null,modelVersion:pc.modelVersion||null,generationId:dataGenId,algoGenerationId:genFp.algoGenerationId});
}
for(const [tf,a] of Object.entries(watch.analysis||{})){
  const candles=frames[tf]||[],c=candles.at(-1);
  if(!c||!a||!a.next)continue;
  const obs=L.createObservation({generationId:dataGenId,sourceGeneratedAt:watch.generatedAt||watch.sourceGeneratedAt||null,symbol:SYMBOL,tf,candle:c,analysis:a,marketMode:a.marketMode||watch.news&&watch.news.state||'NORMAL',event:watch.news&&watch.news.event||null});
  obs.algoGenerationId=genFp.algoGenerationId;
  obs.instrumentId=instrument.canonicalId;
  obs.memoryRoot=MEMROOT; /* F0 partition tag */
  /* recall features (so the corpus built from these rows is L1/L4-queryable) */
  obs.session=SE.sessionOf(Date.parse(c.time));
  obs.atrBand=atrBandOf(frames[tf],c.time);
  obs.trend=(a.bbma&&a.bbma.trend)||null;
  /* F1: the canonical immutable candle this observation is about */
  obs.canonical=FM.canonicalCandle(c,a.bbma,{symbol:instrument.analysisSymbol,tf:tf,provider:raw.provider||'yahoo',sourceSymbol:SYMBOL});
  /* F3: how the other timeframes stand relative to this anchor */
  if(formation)obs.formationFingerprintId=formation.formationFingerprintId;
  /* PHASE C: link the observation to the PredictionContract anchored at this
     same candle (sourceCandleTime === obs.candleTime), from the durable ledger. */
  const pc=predsBySource[obs.candleTime];
  if(tf==='M15'&&pc&&pc.predictionId){obs.predictionId=pc.predictionId;obs.snapshotId=pc.snapshotId||null;}
  const res=S.upsertObservation(rows,obs);
  /* upsertObservation returns the EXISTING row when the id is already stored
     (a pending obs created by an earlier run). Merge the contract link onto it
     so provenance is never dropped — this enriches a PENDING observation only;
     it never edits a SETTLED outcome or the frozen hypothesis. */
  if(res&&res.row&&res.row!==obs&&(obs.predictionId||obs.snapshotId)){
    if(!res.row.predictionId&&obs.predictionId)res.row.predictionId=obs.predictionId;
    if(!res.row.snapshotId&&obs.snapshotId)res.row.snapshotId=obs.snapshotId;
  }
  if(res&&res.row){res.row.memoryRoot=MEMROOT;if(!res.row.instrumentId)res.row.instrumentId=instrument.canonicalId;}
}
const perf=S.performance(rows);
perf.schemaVersion=Math.max(3,perf.schemaVersion||0);
perf.generatedAt=new Date().toISOString();
perf.generationId=dataGenId;
perf.algoGenerationId=genFp.algoGenerationId;
perf.instrumentId=instrument.canonicalId;
perf.memoryRoot=MEMROOT;
perf.sourceGeneratedAt=watch.generatedAt||null;
perf.lineage={liveGenerationId:dataGenId,history:L.lineage(rows),algorithm:GF.lineage(rows),status:dataGenId?'LIVE_LINKED':'UNKNOWN'};
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(HISTORY,JSON.stringify(rows,null,2));
fs.writeFileSync(PERF,JSON.stringify(perf,null,2));
console.log('BBMA learning',rows.length,'observations','memoryRoot=',MEMROOT,'formation=',formation?formation.formationFingerprintId:'n/a','dataGen=',dataGenId||'UNKNOWN','algoGen=',genFp.algoGenerationId,'algorithmLineage=',perf.lineage.algorithm.status);
})().catch(e=>{console.error(e);process.exit(1);});
