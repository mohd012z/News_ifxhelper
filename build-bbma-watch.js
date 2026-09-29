'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const P=require('./lib/market-provider'),V=require('./lib/ohlc-validator'),R=require('./lib/ohlc-resampler'),W=require('./lib/bbma-candle-watch'),D=require('./lib/bbma-dashboard'),N=require('./lib/news-proximity'),I=require('./lib/instrument'),C=require('./lib/bbma-confidence'),L=require('./lib/alert-lifecycle'),FS=require('./lib/ai/feature-snapshot'),OS=require('./lib/ai/one-step-engine'),GS=require('./lib/ai/consensus-engine'),DC=require('./lib/ai/data-class'),CAP=require('./lib/snapshot-capture'),PC=require('./lib/ai/prediction-contract'),HS=require('./lib/history-store'),FM=require('./lib/formation-memory'),FP=require('./lib/state-fingerprint'),SE=require('./lib/session-engine'),IM=require('./lib/instrument-memory'),IR=require('./lib/instrument-registry');
const SYMBOL=process.env.BBMA_SYMBOL||'GC=F',OUT=process.env.BBMA_OUT||path.join('data','bbma-watch.json');
const CAL='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
function generationId(symbol,candles,events){const last=candles.at(-1);const basis=JSON.stringify({symbol,last:last&&last.time,count:candles.length,events:(events||[]).slice(0,20).map(e=>[e.date||e.scheduledAt||e.time,e.title||e.event,e.actual,e.forecast])});return 'bbma-'+crypto.createHash('sha256').update(basis).digest('hex').slice(0,20);}
async function calendar(){try{const r=await fetch(CAL,{headers:{'User-Agent':'Mozilla/5.0 XAU-Desk-BBMA/1.0'}});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();return Array.isArray(j)?j:[];}catch(e){console.warn('calendar unavailable:',e.message);return [];}}
function buildOneStep(frames,analysis,news,instrument,dataClass,closedOk,corpus,provider){
 if(!closedOk||!frames||!frames.M15||frames.M15.length<50)return{status:'NOT_READY',reason:'insufficient closed candles or gate failed'};
 const closed=frames.M15.filter(c=>Date.parse(c.time)+900000<=Date.now());
 if(closed.length<50)return{status:'NOT_READY',reason:'<50 closed M15'};
 const asOf=closed[closed.length-1];const win=closed;
 const loc=W.location(win);const snap=FS.build({candles:win,asOf:asOf.time,tf:'M15',analysis:loc,squeeze:null,news:news,instrument:instrument,dataClass:dataClass,mtf:Object.fromEntries(Object.entries(frames).map(function(t){return [t[0],{trend:t[1].bbma&&t[1].bbma.trend||null}];}))});
 /* FORMATION MEMORY (F0–F4): the MTF formation tree — HOW every timeframe
    reached its current state — plus the canonical formation fingerprint.
    corpus (settled same-instrument observations) feeds the empirical recall
    the engine used to receive EMPTY (corpus:[]) — recall was dead on arrival. */
 const tree=FM.formationTree(analysis,{tf:'M15',time:asOf.time},{symbol:instrument?instrument.analysisSymbol||SYMBOL:SYMBOL,provider:provider,sourceSymbol:SYMBOL,instrument:instrument});
 const atrPct=(FP&&win.length)?FP.atrPctile(win):null;
 const atrBand=atrPct==null?null:(atrPct>=90?'VERY_HIGH':atrPct>=75?'HIGH':atrPct<=25?'LOW':'NORMAL');
 const desc={session:(SE&&asOf.time)?SE.sessionOf(Date.parse(asOf.time)):null,newsPhase:news&&news.state||null,atrBand:atrBand};
 const fp=FM.formationFingerprint(tree,desc);
 const formation={schema:'FormationTree/v1',instrument:tree.instrument,memoryRoot:tree.memoryRoot,snapshotId:tree.snapshotId,tf:tree.tf,layers:tree.layers,relationships:tree.relationships,fingerprint:fp.fingerprint,formationFingerprintId:fp.stateId,descriptor:desc};
 const cand=OS.predict(snap,{candles:win,analysis:loc,corpus:corpus,minSamples:8,memoryRoot:tree.memoryRoot});
 const gate=GS.verify(cand,snap,{shadow:true});
 if(cand&&typeof cand==='object'){cand.formationFingerprintId=fp.stateId;cand.memoryRoot=tree.memoryRoot;if(cand.empirical)cand.empirical.memoryRoot=tree.memoryRoot;}
 /* PHASE C: freeze the immutable truth boundary + the prediction contract.
    The FEATURE snapshot is captured through snapshot-capture (deterministic
    id + deepFreeze); the PredictionContract links to it by snapshotId and
    carries pre-candle falsifiers. Neither is editable after this point —
    settlement later APPENDS a separate outcome record that references them. */
 const feat=CAP.capture('FEATURE',Object.assign({timeframe:'M15',candleTime:snap.candleClose},snap),{dataVersion:'v2',capturedAt:new Date().toISOString()});
 const contract=PC.build({snapshotId:feat.snapshotId,tf:'M15',instrumentId:instrument?instrument.analysisSymbol:null,asOf:asOf.time,forecast:cand,createdAt:new Date().toISOString(),evidenceRefs:[]});
 /* C3: the contract is IMMUTABLE but it must survive the next watch build —
    bbma-watch.json is overwritten every cycle. Persist it to the durable
    append-only prediction ledger (content-hash deduped: rebuilding the same
    contract is a no-op). The learning builder later links the observation for
    the contract's TARGET candle to it by time. */
 HS.append('prediction',{rowType:'PREDICTION',predictionId:contract.predictionId,snapshotId:feat.snapshotId,timeframe:contract.timeframe,sourceCandleTime:contract.sourceCandleTime,targetTime:contract.targetTime,direction:contract.hypothesis.direction,model:contract.model.id,modelVersion:contract.model.version,heuristicScore:contract.heuristicScore,status:contract.status,generationId:null,createdAt:contract.createdAt});
 return{status:gate.status,direction:cand.direction,movementClass:cand.movementClass,regime:cand.regime.regime,heuristicScore:cand.heuristicScore,bbContext:cand.bbContext,invalidation:cand.invalidation,empirical:cand.empirical,publishable:gate.publishable,shadow:gate.shadow,drivers:gate.drivers,asOf:asOf.time,tf:'M15',newsMode:news.state,formation:formation,featureSnapshot:feat,prediction:contract};
}
(async()=>{
 const [r,events]=await Promise.all([P.yahoo(SYMBOL,{interval:'1m',range:'5d',timeoutMs:12000}),calendar()]);
 const s=V.validateSeries(r.candles,{timeframeMinutes:1}),clean=s.candles.filter(x=>x.valid).map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume}));
 /* P0-B/C: the PREDICTION path uses the SAME closed-only + clean-source rule as the
    settlement path (build-bbma-learning: x.valid && x.isClosed). The forming candle and
    any synthetic/demo source are excluded BEFORE any model runs. */
 const nowMs=Date.now();const stepMs=60000;
 const closedM1=clean.filter(x=>Date.parse(x.time)+stepMs<=nowMs);
 const dataClassGate=DC.gate(clean.length?'REAL_GC=F':'NONE'); /* P0-C: reject synthetic/demo from prediction */
 const closedOk=closedM1.length>0&&dataClassGate.allowed;
 const frames=R.buildFrames(clean),analysis={};for(const [tf,c] of Object.entries(frames)){if(c.length<50)continue;analysis[tf]={bbma:W.location(c),squeeze:W.squeezeHistory(c),next:W.oneStepAhead(c)};}
 const news=N.proximity(events,{currencies:['USD'],preMinutes:60,releaseMinutes:5,postMinutes:120});
 for(const x of Object.values(analysis)){x.marketMode=news.state;x.next.newsState=news.state;if(news.state==='NEWS_RELEASE')x.next.confidence=Math.min(x.next.confidence,55);else if(news.state==='PRE_NEWS')x.next.confidence=Math.min(x.next.confidence,65);}
 const dash=D.build(frames,Object.fromEntries(Object.keys(frames).map(tf=>[tf,s.gaps.length?'NEAR':'EXACT']))),generatedAt=new Date().toISOString();
 /* /realtime: explicit instrument provenance — this CI watch runs on GC=F
    (futures), so it MUST be labeled as a proxy for XAUUSD, never silently
    collapsed into spot XAU/USD. The confidence engine carries the unresolved
    proxy as a prohibition unless resolved=true is set downstream. */
 const instrument=I.gcF({source:'yahoo',resolved:false});
 /* /calculate: evidence-weighted confidence over the REAL snapshot fields.
    mtf view: each ANALYZED tf (50+ candles, engine ran) is evidence-ready;
    trend feeds the MTF-alignment factor. Gaps (lunch/weekend) + the unresolved
    GC=F proxy are carried as honest prohibitions, not smoothed away. */
 const mtfView=Object.fromEntries(Object.entries(analysis).map(function(x){return [x[0],{state:'READY',trend:x[1].bbma&&x[1].bbma.trend||null}];}));
 const confidence=C.fromSnapshot({
   source: clean.length?'REAL_GC=F':'NONE',
   freshness: 'FRESH_SNAPSHOT',
   fresh: true,
   mtf: mtfView,
   newsSummary: news.state,
   feed: {droppedTicks:0,gapDetected:s.gaps.length>0,outOfOrderTicks:0,latencyMs:r.httpMs||null},
   instrument: instrument
 });
 /* FORMATION MEMORY (F0): the empirical recall corpus is filtered to SETTLED
    observations of the SAME instrument — the GC=F proxy set never feeds an
    XAUUSD spot query (and vice versa). Pre-F0 rows lack instrumentId: they
    are attributed to the CURRENT instrument (historically all GC=F) and
    partitioned accordingly. */
 let corpus=[];
 try{
   var canonId=IR.resolve({providerSymbol:SYMBOL,analysisSymbol:'XAUUSD',marketType:SYMBOL.indexOf('=')>=0?'FUTURES':'SPOT',provider:'yahoo'}).canonicalId;
   var histRoot=IM.memoryRoot(instrument);
   var histRows=JSON.parse(fs.readFileSync(path.join('data','bbma-learning.json'),'utf8'))||[];
   corpus=histRows.filter(function(o){return o&&o.status==='SETTLED'&&o.correct!=null&&o.tf==='M15'&&String(o.instrumentId||canonId)===String(canonId);})
     .map(function(o){var pat=o.bbma&&(o.bbma.momentum||o.bbma.reentry||o.bbma.csak||o.bbma.extreme)||o.location;var tr=(o.state||'').indexOf('UP')===0?'UP':(o.state||'').indexOf('DOWN')===0?'DOWN':null;return {settled:true,correct:o.correct,tf:o.tf,session:(o.session||null),volatility:(o.atrBand||null),news:(o.newsState||o.marketMode||null),trend:tr,pattern:pat,state:{pattern:pat,atr:(o.atrBand||null),session:(o.session||null),bbmaZone:o.location,newsPhase:(o.newsState||o.marketMode||null),htf:o.htf||{}},memoryRoot:histRoot};});
 }catch(e){console.warn('recall corpus unavailable:',e.message);corpus=[];}
 const out={schemaVersion:4,generationId:generationId(SYMBOL,clean,events),generatedAt,sourceGeneratedAt:generatedAt,symbol:SYMBOL,provider:r.provider,instrument:instrument,confidence:confidence,lifecycle:L.evaluateStage({source:clean.length?'REAL_GC=F':'NONE',fresh:true,freshness:'FRESH_SNAPSHOT',mtf:mtfView,newsState:news.state,feed:{droppedTicks:0,gapDetected:s.gaps.length>0,outOfOrderTicks:0,latencyMs:r.httpMs||null},instrument:instrument,confidence:confidence,externalAlert:false}),httpMs:r.httpMs,source:{candles:r.candles.length,valid:clean.length,gaps:s.gaps.length,duplicates:s.duplicates.length},last:clean.length?{time:clean.at(-1).time,close:clean.at(-1).close,bar:'M1'}:null,news,analysis,dashboard:dash,
 /* Memory Brain (spec /mindbrains): compact M15 candle history so episodes can
    carry REAL numeric features (ATR band, body/wick ratios, trend strength) and
    settlement can compare consecutive CLOSED M15 candles. 120 bars ~= 3 days;
    the builder's forming candle is included, the consumer filters to closed.
    + the F0-filtered recall corpus (same instrument only). */
memoryContext:{tf:'M15',generatedAt:generatedAt,candles:(frames.M15||[]).slice(-120),corpus:corpus,corpusInstrument:IM.memoryRoot(instrument)},
 /* 1-step-ahead RESEARCH (shadow, §21): deterministic candidate + verification gate.
    NEVER used for alert direction; settled by the exact next closed M15 later. */
oneStep:buildOneStep(frames,analysis,news,instrument,dataClassGate.dataClass,closedOk,corpus,instrument&&instrument.provider||r.provider)};
 fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(out,null,2));console.log('BBMA watch',SYMBOL,news.state,out.generationId,OUT,Object.keys(analysis).join(','));
})().catch(e=>{console.error(e);process.exit(1);});
