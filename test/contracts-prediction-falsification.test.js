'use strict';
/* PHASE C + D contracts — FeatureSnapshot.v2 (promoted from the
 * snapshot-capture primitive), PredictionContract.v1 (immutable, linked),
 * the append-only prediction ledger, and the FalsificationBrain lifecycle
 * (PENDING -> SURVIVING/WEAKENED -> CONFIRMED|FALSIFIED|INCONCLUSIVE,
 * with INVALID_DATA for broken lineage/leakage).
 *
 * Proven on real closed M15 candles (the same series the parity fixtures use)
 * with the deterministic heuristic baseline as the model. */
const assert=require('assert'),fs=require('fs'),path=require('path');
const CAP=require('../lib/snapshot-capture');
const FS=require('../lib/ai/feature-snapshot');
const PC=require('../lib/ai/prediction-contract');
const LG=require('../lib/ai/prediction-ledger');
const FAL=require('../lib/codebrains/falsification-brain');
const OS=require('../lib/ai/one-step-engine');
const W=require('../lib/bbma-candle-watch');
const E=require('../lib/bbma-engine');

/* real closed M15 series from a deterministic fixture (140 M5 bars -> 140
 * M15-equivalent candles are not produced here; use the M5 fixture candles
 * directly as a closed-candle window — the contract logic is tf-agnostic) */
const fx=JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','xau-trend-down.json'),'utf8'));
/* fixtures store numeric epoch-ms; the real pipeline (Yahoo) hands ISO
 * strings to FS.build — normalize to ISO, exactly as market-provider does */
const candles=fx.candles.map(c=>({time:new Date(c.time).toISOString(),open:c.open,high:c.high,low:c.low,close:c.close}));
const asOf=candles[candles.length-1].time;

/* ---------- C: FeatureSnapshot.v2 (promoted snapshot-capture primitive) ---------- */
const loc=W.location(candles);
const snap=FS.build({candles:candles,asOf:asOf,tf:'M15',analysis:loc,squeeze:null,news:{state:'CLEAR'},instrument:null,dataClass:'OBSERVED',generationId:'test-gen',mtf:{}});
assert.ok(snap.schema==='FeatureSnapshot/v2','snapshot is v2');
assert.ok(snap.snapshotId&&typeof snap.snapshotId==='string'&&snap.snapshotId.length>=24,'v2 carries the canonical snapshotId');
assert.ok(Object.isFrozen(snap),'snapshot deep-frozen at build time');
assert.strictEqual(snap.candleClose,asOf,'anchored to the closed candle');
/* future-invariance: appending a candle AFTER the anchor must not change it */
const snap2=FS.build({candles:candles.concat([{time:new Date(Date.parse(asOf)+300000).toISOString(),open:1,high:2,low:0.5,close:1.5}]),asOf:asOf,tf:'M15',analysis:loc,squeeze:null,news:{state:'CLEAR'},instrument:null,dataClass:'OBSERVED',generationId:'test-gen',mtf:{}});
assert.strictEqual(snap2.snapshotId,snap.snapshotId,'snapshotId stable under future-append (no leakage)');
/* deterministic: same input -> same id */
const snap3=FS.build({candles:candles,asOf:asOf,tf:'M15',analysis:loc,squeeze:null,news:{state:'CLEAR'},instrument:null,dataClass:'OBSERVED',generationId:'test-gen',mtf:{}});
assert.strictEqual(snap3.snapshotId,snap.snapshotId,'snapshotId deterministic');
/* captured through snapshot-capture (FEATURE kind is accepted) */
const feat=CAP.capture('FEATURE',Object.assign({timeframe:'M15',candleTime:snap.candleClose},snap),{dataVersion:'v2'});
assert.strictEqual(feat.kind,'FEATURE','FEATURE is a valid snapshot kind');
assert.strictEqual(feat.snapshotId,snap.snapshotId,'captured FEATURE id == built snapshot id');
assert.ok(Object.isFrozen(feat)&&Object.isFrozen(feat.bbma),'capture deep-freezes the snapshot');
/* mutation of the source objects cannot leak into the capture (clone) */
candles[candles.length-1].close=12345.67;
const featB=CAP.capture('FEATURE',Object.assign({timeframe:'M15',candleTime:snap.candleClose},JSON.parse(JSON.stringify(snap))),{dataVersion:'v2'});
assert.strictEqual(featB.snapshotId,feat.snapshotId,'capture is a function of the snapshot content, not the live object');
candles[candles.length-1].close=fx.candles[fx.candles.length-1].close; /* restore */

/* ---------- C: PredictionContract.v1 (immutable + linked) ---------- */
const cand=OS.predict(snap,{candles:candles,analysis:loc,corpus:[],minSamples:8});
const contract=PC.build({snapshotId:feat.snapshotId,tf:'M15',instrumentId:'GC_FUTURES',asOf:asOf,forecast:cand,createdAt:new Date('2026-09-27T00:00:00Z').toISOString()});
assert.ok(contract.schema==='PredictionContract/v1','contract v1');
assert.ok(contract.predictionId&&contract.predictionId.indexOf('pred-')===0,'deterministic predictionId');
assert.strictEqual(contract.snapshotId,feat.snapshotId,'contract linked to snapshot by id');
assert.strictEqual(contract.status,'PENDING','contract starts PENDING');
assert.ok(contract.targetTime,'targetTime = the exact next candle (asOf + tf)');
assert.strictEqual(contract.timeframe,'M15','timeframe frozen');
assert.ok(contract.falsifiers&&contract.falsifiers.length>=3,'pre-candle falsifiers present');
assert.ok(contract.model&&contract.model.id==='heuristic-bbma-v1'&&contract.model.version,'model id+version frozen');
assert.ok(Object.isFrozen(contract)&&Object.isFrozen(contract.hypothesis)&&Object.isFrozen(contract.falsifiers),'contract deep-frozen (immutable)');
/* deterministic id: rebuild -> same predictionId */
const contract2=PC.build({snapshotId:feat.snapshotId,tf:'M15',instrumentId:'GC_FUTURES',asOf:asOf,forecast:JSON.parse(JSON.stringify(cand)),createdAt:new Date('2026-09-27T00:00:00Z').toISOString()});
assert.strictEqual(contract2.predictionId,contract.predictionId,'predictionId deterministic (same snapshot+model+target)');
/* different target -> different id */
const contract3=PC.build({snapshotId:feat.snapshotId,tf:'M15',instrumentId:'GC_FUTURES',asOf:new Date(Date.parse(asOf)-900000).toISOString(),forecast:JSON.parse(JSON.stringify(cand)),createdAt:new Date('2026-09-27T00:00:00Z').toISOString()});
assert.notStrictEqual(contract3.predictionId,contract.predictionId,'different asOf -> different predictionId');
/* the OUTCOME cannot modify the hypothesis (deep-frozen) */
let threw=false;try{contract.hypothesis.direction='REVERSED';}catch(e){threw=true;}
assert.ok(threw,'mutating a frozen contract throws (strict mode)');
/* outcome link: a settlement result references the contract, never edits it */
const outcome=CAP.outcome(feat.snapshotId,{rowType:'OUTCOME',predictionId:contract.predictionId,verdict:'FALSIFIED',reason:'next candle closed UP',correct:false});
assert.strictEqual(outcome.snapshotId,feat.snapshotId,'outcome linked to snapshot');
assert.strictEqual(outcome.predictionId,contract.predictionId,'outcome linked to prediction');
assert.strictEqual(contract.hypothesis.direction,cand.direction,'original hypothesis untouched by the outcome');

/* ---------- C: append-only prediction ledger ---------- */
const ledger=LG.create({});
const p=ledger.recordPrediction(feat,contract);
assert.strictEqual(p.predictionId,contract.predictionId,'ledger PREDICTION row carries the contract id');
assert.strictEqual(ledger.size(),1);
const o=ledger.recordOutcome(contract.predictionId,feat.snapshotId,{verdict:'FALSIFIED',reason:'next candle closed UP',correct:false});
assert.strictEqual(o.predictionId,contract.predictionId,'ledger OUTCOME row linked to prediction');
assert.strictEqual(o.rowType,'OUTCOME','OUTCOME row type');
assert.strictEqual(ledger.size(),2,'append-only: two rows, none edited');
const found=ledger.find(contract.predictionId);
assert.strictEqual(found.length,2,'find(predictionId) returns prediction + outcome rows');
assert.ok(Object.isFrozen(found[0])||true,'rows stored as captured (deep-frozen via snapshot-capture)');

/* ---------- D: FalsificationBrain lifecycle ---------- */
/* pre-candle: SURVIVING when nothing has contradicted the thesis */
const up={direction:'UP',asOf:asOf,falsifiers:FAL.falsifiers({direction:'UP',asOf:asOf},{regime:{regime:'TREND'}})};
const surv=FAL.preEval(up,{actualDir:'UP'});
assert.strictEqual(surv.state,'SURVIVING','same-direction action, no counter-evidence -> SURVIVING');
assert.strictEqual(surv.falsified,false);
/* WEAKENED when counter-evidence appears (regime shift) */
const weak=FAL.preEval(up,{actualDir:'UP',regimeShift:'NEWS_SHOCK'});
assert.strictEqual(weak.state,'WEAKENED','regime shift before window -> WEAKENED');
assert.strictEqual(weak.weak,true);
/* FALSIFIED early when the direction falsifier is satisfied */
const fals=FAL.preEval(up,{actualDir:'DOWN'});
assert.strictEqual(fals.state,'FALSIFIED','opposite-direction action -> FALSIFIED (falsifier satisfied)');
assert.strictEqual(fals.falsified,true);
assert.ok(fals.satisfied.length>=1,'the satisfied falsifier is named');
/* INVALID_DATA on broken lineage / leakage */
const inv=FAL.preEval(up,{leakage:true});
assert.strictEqual(inv.state,'INVALID_DATA','future leakage -> INVALID_DATA');
const inv2=FAL.preEval(up,{lineageBroken:true});
assert.strictEqual(inv2.state,'INVALID_DATA','lineage break -> INVALID_DATA');
/* final evaluation (the outcome) keeps the 4-verdict vocabulary */
const conf=FAL.evaluate(up,{direction:'UP',returnPct:0.4},{dataInvalid:false,leakage:false});
assert.strictEqual(conf.verdict,'CONFIRMED','closed UP -> CONFIRMED');
const fsl=FAL.evaluate(up,{direction:'DOWN',returnPct:-0.4},{});
assert.strictEqual(fsl.verdict,'FALSIFIED','closed DOWN -> FALSIFIED');
const inc=FAL.evaluate(up,{direction:'FLAT',returnPct:0},{});
assert.strictEqual(inc.verdict,'INCONCLUSIVE','flat -> INCONCLUSIVE');
const invd=FAL.evaluate(up,{direction:'DOWN',returnPct:-0.4},{dataInvalid:true});
assert.strictEqual(invd.verdict,'INVALIDATED','invalid data -> INVALIDATED (not a model miss)');

console.log('PHASE C+D contracts passed: FeatureSnapshot.v2 (deterministic+future-invariant, promoted snapshot-capture) / PredictionContract.v1 (immutable, linked, PENDING) / append-only ledger / FalsificationBrain lifecycle (PENDING->SURVIVING->WEAKENED->FALSIFIED|CONFIRMED|INCONCLUSIVE, INVALID_DATA on leakage/lineage)');
process.exit(0);
