'use strict';
/* EXECUTED proof of the alert lifecycle (spec §6) + quality-gate-overrides-score
 * (spec §5) + §7-P2 single-authority:
 *   - full chain: DETECTED→…→CONFIRMABLE when all evidence is real + clean
 *   - CONFIRMABLE → ALERT only with an EXTERNAL (HELIX) alert; a technical
 *     signal can NEVER self-promote to ALERT (publishability boundary)
 *   - QUALITY GATE OVERRIDES SCORE: confidence 100 with a prohibition never
 *     reaches CONFIRMABLE ("85/100 tidak boleh mengubah invalid evidence jadi valid")
 *   - evidence-first payload states WHAT is observed, never BUY/SELL
 */
const assert=require('assert');
const L=require('../lib/alert-lifecycle.js');
const C=require('../lib/bbma-confidence.js');

const STAGES=L.STAGES;
assert.deepStrictEqual(STAGES,['DETECTED','DATA_VALIDATED','MTF_VALIDATED','NEWS_CHECKED','EVIDENCE_COMPLETE','CONFIRMABLE','ALERT','REACTION','OUTCOME']);

function cleanInput(over){
  return Object.assign({
    pattern:'RE-ENTRY', signalDirection:'UP',
    source:'LIVE_TICK_DERIVED', fresh:true, freshness:'FRESH_SNAPSHOT',
    mtf:{M15:{state:'READY',trend:'UP'},H1:{state:'READY',trend:'UP'},H4:{state:'READY',trend:'UP'},M5:{state:'READY',trend:'FLAT'}},
    newsState:'CLEAR',
    feed:{latencyMs:1800,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},
    instrument:{display:'XAU/USD',analysisSymbol:'XAUUSD',providerSymbol:'XAU/USD',marketType:'SPOT',isProxy:false},
    confidence:{score:85,confirmable:true,prohibitions:[]},
    externalAlert:false, timeframe:'M15', location:'MA5/10 LOW'
  },over||{});
}

/* 1. All evidence real+clean -> reaches CONFIRMABLE, but NOT ALERT (no external) */
let lc=L.evaluateStage(cleanInput());
assert.strictEqual(lc.stage,'CONFIRMABLE','clean evidence reaches CONFIRMABLE (got '+lc.stage+')');
assert.ok(!lc.passed.includes('ALERT'),'does NOT auto-reach ALERT without an external alert');

/* 2. + external (HELIX) alert -> ALERT; reaction/outcome chain continues */
lc=L.evaluateStage(cleanInput({externalAlert:true}));
assert.strictEqual(lc.stage,'ALERT','external alert -> ALERT (got '+lc.stage+')');
assert.strictEqual(L.evaluateStage(cleanInput({externalAlert:true,reaction:true})).stage,'REACTION','reaction recorded -> REACTION');
assert.strictEqual(L.evaluateStage(cleanInput({externalAlert:true,reaction:true,outcome:true})).stage,'OUTCOME');

/* 3. QUALITY GATE OVERRIDES SCORE (the spec's core rule) */
lc=L.evaluateStage(cleanInput({confidence:{score:100,confirmable:false,prohibitions:['SYNTHETIC_DATA_PRESENT']}}));
assert.strictEqual(lc.stage,'EVIDENCE_COMPLETE','score 100 + prohibition does NOT reach CONFIRMABLE (got '+lc.stage+')');
assert.strictEqual(lc.failedAt,'CONFIRMABLE','stopped exactly at CONFIRMABLE');
lc=L.evaluateStage(cleanInput({confidence:{score:85,confirmable:false,prohibitions:['STALE']}}));
assert.notStrictEqual(lc.stage,'CONFIRMABLE','85/100 cannot make invalid (stale) evidence valid');
assert.ok(lc.failedAt==='CONFIRMABLE');

/* 4. Each gate blocks independently (not just the score) */
assert.strictEqual(L.evaluateStage(cleanInput({source:'SYNTHETIC',fresh:true})).failedAt,'DATA_VALIDATED','synthetic source blocks at DATA_VALIDATED');
assert.strictEqual(L.evaluateStage(cleanInput({mtf:{M15:{state:'READY',trend:'UP'}}})).failedAt,'MTF_VALIDATED','insufficient MTF blocks at MTF_VALIDATED');
assert.strictEqual(L.evaluateStage(cleanInput({newsState:'NEWS_RELEASE'})).failedAt,'NEWS_CHECKED','news release blocks at NEWS_CHECKED');
assert.strictEqual(L.evaluateStage(cleanInput({feed:{latencyMs:null}})).failedAt,'EVIDENCE_COMPLETE','missing latency blocks at EVIDENCE_COMPLETE');

/* 4b. Continuity is a QUALITY gate (EVIDENCE_COMPLETE), not a source gate:
     real source + a lunch break gap => DATA_VALIDATED passes, stops at
     EVIDENCE_COMPLETE, flagged continuityBroken (mirrors confidence's
     CONTINUITY_BROKEN prohibition). */
const gap=L.evaluateStage(cleanInput({feed:{latencyMs:900,droppedTicks:0,gapDetected:true,outOfOrderTicks:0},confidence:{score:80,confirmable:false,prohibitions:['CONTINUITY_BROKEN']}}));
assert.strictEqual(gap.stage,'NEWS_CHECKED','continuity gate: passes DATA/MTF/NEWS, stops before EVIDENCE_COMPLETE (got '+gap.stage+')');
assert.strictEqual(gap.failedAt,'EVIDENCE_COMPLETE','gap fails the EVIDENCE_COMPLETE gate');
assert.strictEqual(gap.continuityBroken,true,'continuityBroken surfaced');

/* 5. evidence-first payload: states observation, NEVER an imperative */
const good=cleanInput();
const pl=L.payload(good,L.evaluateStage(good));
assert.ok(/XAU\/USD • M15 RE-ENTRY UP/.test(pl),'payload leads with instrument/TF/pattern/direction: '+pl);
assert.ok(/HTF/.test(pl),'payload shows HTF alignment');
assert.ok(/News CLEAR/.test(pl));
assert.ok(/Source SPOT/.test(pl));
assert.ok(/Age 1\.8s/.test(pl),'age formatted (1.8s)');
assert.ok(/Quality VALID/.test(pl));
assert.ok(/Evidence COMPLETE/.test(pl));
assert.ok(/State: CONFIRMABLE$/.test(pl),'payload ends with State:');
assert.ok(!/BUY|SELL|GOLD NOW|HIGH CONFIDENCE/i.test(pl),'payload has NO imperative / hype language');

/* 6. A prohibited payload is marked Quality INVALID + State < CONFIRMABLE */
const bad=cleanInput({confidence:{score:100,confirmable:false,prohibitions:['SYNTHETIC_DATA_PRESENT']}});
const pl2=L.payload(bad,L.evaluateStage(bad));
assert.ok(/Quality INVALID\(SYNTHETIC_DATA_PRESENT\)/.test(pl2),'prohibited -> Quality INVALID with the reason');
assert.ok(/State: EVIDENCE_COMPLETE$/.test(pl2),'prohibited -> State stops before CONFIRMABLE');

/* 7. §7-P2 single authority: the confidence engine + lifecycle AGREE on the
     same input (no second, divergent verdict) */
const conf=C.fromSnapshot({source:'LIVE_TICK_DERIVED',fresh:true,freshness:'FRESH_SNAPSHOT',feed:{latencyMs:1800,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},instrument:{providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD'},mtf:{a:{state:'READY',trend:'UP'},b:{state:'READY',trend:'UP'},c:{state:'READY',trend:'UP'}},newsSummary:'x',alertHistory:[1]});
const lc3=L.evaluateStage(cleanInput({confidence:conf}));
assert.strictEqual(conf.confirmable,true,'confidence says confirmable');
assert.strictEqual(lc3.stage,'CONFIRMABLE','lifecycle agrees with confidence on the same input');
const confP=C.fromSnapshot({source:'BASELINE_CACHE',fresh:true,freshness:'FRESH_SNAPSHOT',feed:{latencyMs:1800,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},instrument:{providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD'},mtf:{a:{state:'READY',trend:'UP'},b:{state:'READY',trend:'UP'},c:{state:'READY',trend:'UP'}},newsSummary:'x',alertHistory:[1]});
assert.strictEqual(confP.confirmable,false,'confidence says NOT confirmable (synthetic)');
assert.strictEqual(L.evaluateStage(cleanInput({confidence:confP})).stage,'EVIDENCE_COMPLETE','lifecycle agrees: stops before CONFIRMABLE');

console.log('alert lifecycle proof: full chain to CONFIRMABLE (no self-promote to ALERT); quality gate overrides score (100+synthetic stops at EVIDENCE_COMPLETE); all 4 gates block independently; payload is evidence-first with zero imperative language; confidence+lifecycle agree on identical input (§7-P2 single authority)');
process.exit(0);
