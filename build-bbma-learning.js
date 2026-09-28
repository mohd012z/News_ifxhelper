'use strict';
const fs=require('fs'),path=require('path'),P=require('./lib/market-provider'),V=require('./lib/ohlc-validator'),R=require('./lib/ohlc-resampler'),L=require('./lib/bbma-learning'),S=require('./lib/learning-store'),GF=require('./lib/generation-fingerprint'),IR=require('./lib/instrument-registry'),HS=require('./lib/history-store');
const WATCH=path.join('data','bbma-watch.json'),HISTORY=path.join('data','bbma-learning.json'),PERF=path.join('data','bbma-performance.json'),SYMBOL=process.env.BBMA_SYMBOL||'GC=F';
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
/* P0 lineage: the ALGORITHM identity (not the per-cycle data id). Every
   observation inherits it so results from an older engine/rules/config are
   never counted as current-generation performance. */
const instrument=IR.resolve({providerSymbol:SYMBOL,analysisSymbol:'XAUUSD',marketType:SYMBOL.indexOf('=')>=0?'FUTURES':'SPOT',provider:'yahoo'});
const genFp=GF.fingerprint({provider:'yahoo:'+SYMBOL,instrument:instrument.canonicalId,extraConfig:{range:'5d',interval:'1m'}});
(async()=>{const watch=read(WATCH,null);if(!watch)throw Error('bbma-watch.json missing');const dataGenId=watch.generationId||null;if(!dataGenId)console.warn('BBMA watch has no data generationId (lineage falls back to algorithm id only)');const raw=await P.yahoo(SYMBOL,{interval:'1m',range:'5d',timeoutMs:12000}),valid=V.validateSeries(raw.candles,{timeframeMinutes:1}),m1=valid.candles.filter(x=>x.valid&&x.isClosed).map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume})),frames=R.buildFrames(m1);let rows=read(HISTORY,[]);rows=S.settleDue(rows,frames);
/* PHASE C/D ledger linkage — a prediction ANCHORED at sourceCandleTime=S
   tests the observation FOR candle S (which settleDue judges against S+tf,
   the contract's targetTime). So the link is obs.candleTime === sourceCandleTime.
   Read through the DURABLE prediction ledger (not the live watch, which is
   overwritten every cycle) so the contract that named a candle is recovered
   even after newer watches predict later candles. Append-only + content-hash
   deduped, so re-runs never double-record and the hypothesis is never edited. */
const predsBySource={};try{HS.readKind('prediction').forEach(function(r){if(r&&r.sourceCandleTime)predsBySource[r.sourceCandleTime]=r;});}catch(e){}
for(let i=0;i<rows.length;i++){const row2=rows[i];if(row2.status!=='SETTLED')continue;const pc=predsBySource[row2.candleTime];if(!pc||!pc.predictionId)continue;const verdict=row2.correct===true?'CONFIRMED':row2.correct===false?'FALSIFIED':'INCONCLUSIVE';HS.append('outcome',{rowType:'OUTCOME',predictionId:pc.predictionId,snapshotId:pc.snapshotId||null,timeframe:pc.timeframe||row2.tf,direction:pc.direction||null,verdict:verdict,reason:row2.outcomeReason||null,returnPct:row2.nextReturnPct!=null?row2.nextReturnPct:null,actualDirection:row2.actualDirection||null,model:pc.model||null,modelVersion:pc.modelVersion||null,generationId:dataGenId,algoGenerationId:genFp.algoGenerationId});}
for(const [tf,a] of Object.entries(watch.analysis||{})){const candles=frames[tf]||[],c=candles.at(-1);if(!c||!a||!a.next)continue;const obs=L.createObservation({generationId:dataGenId,sourceGeneratedAt:watch.generatedAt||watch.sourceGeneratedAt||null,symbol:SYMBOL,tf,candle:c,analysis:a,marketMode:a.marketMode||watch.news&&watch.news.state||'NORMAL',event:watch.news&&watch.news.event||null});obs.algoGenerationId=genFp.algoGenerationId;obs.instrumentId=instrument.canonicalId;
/* PHASE C: link the observation to the PredictionContract anchored at this
   same candle (sourceCandleTime === obs.candleTime), from the durable ledger. */
const pc=predsBySource[obs.candleTime];if(tf==='M15'&&pc&&pc.predictionId){obs.predictionId=pc.predictionId;obs.snapshotId=pc.snapshotId||null;}
const res=S.upsertObservation(rows,obs);
/* upsertObservation returns the EXISTING row when the id is already stored
   (a pending obs created by an earlier run). Merge the contract link onto it
   so provenance is never dropped — this enriches a PENDING observation only;
   it never edits a SETTLED outcome or the frozen hypothesis. */
if(res&&res.row&&res.row!==obs&&(obs.predictionId||obs.snapshotId)){
  if(!res.row.predictionId&&obs.predictionId)res.row.predictionId=obs.predictionId;
  if(!res.row.snapshotId&&obs.snapshotId)res.row.snapshotId=obs.snapshotId;
}
}const perf=S.performance(rows);perf.schemaVersion=Math.max(3,perf.schemaVersion||0);perf.generatedAt=new Date().toISOString();perf.generationId=dataGenId;perf.algoGenerationId=genFp.algoGenerationId;perf.instrumentId=instrument.canonicalId;perf.sourceGeneratedAt=watch.generatedAt||null;perf.lineage={liveGenerationId:dataGenId,history:L.lineage(rows),algorithm:GF.lineage(rows),status:dataGenId?'LIVE_LINKED':'UNKNOWN'};fs.mkdirSync('data',{recursive:true});fs.writeFileSync(HISTORY,JSON.stringify(rows,null,2));fs.writeFileSync(PERF,JSON.stringify(perf,null,2));console.log('BBMA learning',rows.length,'observations','dataGen=',dataGenId||'UNKNOWN','algoGen=',genFp.algoGenerationId,'algorithmLineage=',perf.lineage.algorithm.status);})().catch(e=>{console.error(e);process.exit(1);});
