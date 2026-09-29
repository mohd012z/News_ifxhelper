'use strict';
/* EXECUTED proof of evidence-weighted confidence (spec /calculate):
 *   - weights DQ 30 / BBMA 25 / MTF 15 / Fresh 10 / News 10 / Reaction 10
 *   - the spec's EXACT worked example scores 85.80
 *   - the HARD rule: synthetic>0 / stale / continuityBroken /
 *     instrumentMismatchUnresolved / requiredEvidenceMissing => CONFIRMABLE
 *     PROHIBITED regardless of score (falsification boundary)
 */
const assert=require('assert');
const C=require('../lib/bbma-confidence.js');

/* 1. The spec's worked example, verbatim:
   DQ .95 × 30 = 28.50 ; BBMA .88 × 25 = 22.00 ; MTF .80 × 15 = 12.00 ;
   Fresh .98 × 10 = 9.80 ; Macro .65 × 10 = 6.50 ; Reaction .70 × 10 = 7.00
   => 85.80 */
const ex=C.score({dataQuality:0.95,bbma:0.88,mtf:0.80,freshness:0.98,newsMacro:0.65,reaction:0.70});
assert.strictEqual(ex.score,85.8,'spec example = 85.80 (got '+ex.score+')');
assert.strictEqual(ex.verdict,'CONFIRMABLE','85.80 with no prohibitions => CONFIRMABLE');
assert.strictEqual(ex.confirmable,true);
assert.strictEqual(ex.prohibitions.length,0);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='dataQuality').contribution,28.5);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='bbma').contribution,22.0);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='mtf').contribution,12.0);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='freshness').contribution,9.8);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='newsMacro').contribution,6.5);
assert.strictEqual(ex.breakdown.find(b=>b.factor==='reaction').contribution,7.0);

/* 2. Weights are exactly the spec's */
assert.deepStrictEqual(C.WEIGHTS,{dataQuality:30,bbma:25,mtf:15,freshness:10,newsMacro:10,reaction:10});

/* 3. HARD RULE: each prohibition alone blocks CONFIRMABLE even at a 99 score */
const base={dataQuality:1,bbma:1,mtf:1,freshness:1,newsMacro:1,reaction:1};
[
  ['syntheticData', 1],
  ['stale', true],
  ['continuityBroken', true],
  ['instrumentMismatchUnresolved', true],
  ['requiredEvidenceMissing', true]
].forEach(([k,v])=>{
  const r=C.score(Object.assign({},base,{prohibitions:{[k]:v}}));
  assert.strictEqual(r.confirmable,false,k+' must prohibit CONFIRMABLE');
  assert.strictEqual(r.verdict,'WAIT',k+' forces WAIT (got '+r.verdict+')');
  assert.ok(r.prohibitions.length===1,k+' surfaces exactly one prohibition');
});

/* 4. A high score with a synthetic flag is STILL prohibited (the falsification
   boundary: green CI / high score != market-authentic) */
const rigged=C.score(Object.assign({},base,{prohibitions:{syntheticData:1}}));
assert.strictEqual(rigged.score,100,'score can be 100');
assert.strictEqual(rigged.confirmable,false,'...but synthetic>0 prohibits CONFIRMABLE');
assert.ok(rigged.prohibitions.includes('SYNTHETIC_DATA_PRESENT'));

/* 5. fromSnapshot: a clean spot snapshot with 50+ READY TFs is confirmable;
   the same with a stale flag is not */
function snap(over){return Object.assign({
  source:'LIVE_TICK_DERIVED',fresh:true,freshness:'FRESH_SNAPSHOT',
  feed:{latencyMs:100,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},
  instrument:{providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD'},
  mtf:{},newsSummary:null,alertHistory:[]
},over||{});}
/* 60 READY TFs aligned UP, 0 down -> bbma=1, mtf=1 */
var mtfUp={};for(var i=0;i<60;i++)mtfUp['tf'+i]={state:'READY',trend:'UP'};
const clean=C.fromSnapshot(snap({mtf:mtfUp}));
assert.strictEqual(clean.confirmable,true,'clean spot + fresh + aligned => confirmable');
assert.strictEqual(clean.verdict,'CONFIRMABLE','(got '+clean.verdict+' score '+clean.score+')');
assert.ok(!clean.prohibitions.some(p=>/STALE|SYNTHETIC|INSTRUMENT/.test(p)));
/* stale => prohibited */
const staleC=C.fromSnapshot(snap({mtf:mtfUp,fresh:false,freshness:'STALE_SNAPSHOT'}));
assert.strictEqual(staleC.confirmable,false,'stale snapshot is never confirmable');
assert.ok(staleC.prohibitions.includes('STALE'));
/* cross-instrument proxy unresolved => prohibited */
const proxyC=C.fromSnapshot(snap({mtf:mtfUp,instrument:{providerSymbol:'GC=F',analysisSymbol:'XAUUSD',resolved:false}}));
assert.strictEqual(proxyC.confirmable,false,'unresolved GC=F->XAUUSD proxy is never confirmable');
assert.ok(proxyC.prohibitions.includes('INSTRUMENT_MISMATCH_UNRESOLVED'));
/* same proxy but resolved => the instrument prohibition clears */
const resolvedC=C.fromSnapshot(snap({mtf:mtfUp,instrument:{providerSymbol:'GC=F',analysisSymbol:'XAUUSD',resolved:true}}));
assert.ok(!resolvedC.prohibitions.includes('INSTRUMENT_MISMATCH_UNRESOLVED'),'resolved proxy clears the prohibition');

console.log('evidence-weighted confidence proof: spec example = '+ex.score+' (CONFIRMABLE); all 5 prohibitions block CONFIRMABLE alone; synthetic@100 still prohibited; fromSnapshot clean=CONFIRMABLE / stale & proxy=prohibited / resolved proxy=cleared');
process.exit(0);
