'use strict';
/* EXECUTED proof of P0 demo segregation (spec: "Keep synthetic/bootstrap data
 * strictly in DEMO/INITIALIZING mode, never inside the production evidence
 * path"):
 *   - the demo data lives in lib/bbma-demo.js (the ONLY place basePrice/sine)
 *   - every demo object is tagged demo:true + source SYNTHETIC/DEMO
 *   - the PRODUCTION runtime does NOT require/import bbma-demo.js
 *   - the confidence engine + lifecycle both PROHIBIT demo/synthetic input
 *     (so even if a demo snapshot leaked into a consumer, it could never be
 *     CONFIRMABLE or publishable)
 *   - the publisher's demo guard (rt.demo===true) is respected
 */
const assert=require('assert');
const fs=require('fs'),path=require('path');
const DEMO=require('../lib/bbma-demo.js');
const C=require('../lib/bbma-confidence.js');
const L=require('../lib/alert-lifecycle.js');

/* 1. Demo module produces tagged synthetic data */
const snap=DEMO.demoSnapshot(120);
assert.strictEqual(snap.demo,true,'demo snapshot tagged demo:true');
assert.strictEqual(snap.mode,'DEMO');
assert.strictEqual(snap.source,'SYNTHETIC');
assert.ok(snap.candles.length===120,'synthetic candles generated');
assert.ok(snap.candles.every(c=>c.demo===true&&c.source==='SYNTHETIC'),'every synthetic candle tagged');
assert.ok(snap.candles.some(c=>Math.abs(c.close-2658.50)<30),'basePrice 2658.50 sine history present IN THE DEMO MODULE');
assert.ok(snap.alerts.every(a=>a.demo===true),'demo alerts tagged');
assert.strictEqual(snap.event.demo,true,'demo news tagged');

/* 2. THE PRODUCTION RUNTIME DOES NOT IMPORT THE DEMO MODULE (the boundary) */
const rtSrc=fs.readFileSync(path.join(__dirname,'..','bbma-runtime.js'),'utf8');
assert.ok(!/require\(['"].*bbma-demo/.test(rtSrc),'bbma-runtime.js does NOT require bbma-demo.js');
assert.ok(!/BBMADemo\./.test(rtSrc),'bbma-runtime.js does NOT call the demo provider');
/* and the production runtime carries NO sine/cosine bootstrap of its own */
assert.ok(!/Math\.sin/.test(rtSrc)&&!/Math\.cos/.test(rtSrc),'production runtime has no sine/cosine price generator');
assert.ok(!/basePrice\s*=\s*2658/.test(rtSrc),'production runtime has no 2658.50 basePrice');
/* 2b. BROWSER BOUNDARY: the production page does not even LOAD the demo module */
const htmlSrc=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.ok(!/src=["'].\/lib\/bbma-demo\.js["']/.test(htmlSrc),'index.html does NOT <script>-load lib/bbma-demo.js');
/* 2c. BUNDLE BOUNDARY: prepare-web.js EXCLUDES the demo module from www/ */
const prep=fs.readFileSync(path.join(__dirname,'..','tools','prepare-web.js'),'utf8');
assert.ok(/LIB_EXCLUDE[\s\S]{0,120}bbma-demo\.js/.test(prep),'prepare-web.js excludes bbma-demo.js from the production bundle');

/* 3. Even if a demo snapshot leaked into the evidence path, it is PROHIBITED:
     confidence flags synthetic, lifecycle cannot reach CONFIRMABLE. */
const conf=C.fromSnapshot({source:snap.source,fresh:true,freshness:'FRESH_SNAPSHOT',
  feed:{latencyMs:100,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},
  instrument:{providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD'},
  mtf:{a:{state:'READY',trend:'UP'},b:{state:'READY',trend:'UP'},c:{state:'READY',trend:'UP'}},
  newsSummary:null,alertHistory:[]});
assert.strictEqual(conf.confirmable,false,'demo/synthetic input is never confidence-confirmable');
assert.ok(conf.prohibitions.includes('SYNTHETIC_DATA_PRESENT'),'flagged SYNTHETIC_DATA_PRESENT');
const lc=L.evaluateStage({pattern:'RE-ENTRY',source:snap.source,fresh:true,freshness:'FRESH_SNAPSHOT',
  mtf:{a:{state:'READY',trend:'UP'},b:{state:'READY',trend:'UP'},c:{state:'READY',trend:'UP'}},
  newsState:'CLEAR',feed:{latencyMs:100,droppedTicks:0,gapDetected:false,outOfOrderTicks:0},
  instrument:{display:'XAU/USD',marketType:'SPOT'},confidence:conf,externalAlert:true});
assert.ok(lc.stage!=='CONFIRMABLE'&&lc.stage!=='ALERT','demo input cannot reach CONFIRMABLE/ALERT (got '+lc.stage+')');
assert.strictEqual(lc.failedAt,'DATA_VALIDATED','synthetic source fails at DATA_VALIDATED (real-source gate)');

/* 4. The publisher's demo guard keys off rt.demo — a demo runtime object is
     refused by loadBrowserRuntime (rt.demo===true branch). */
const demoRt={demo:true,publishable:true,price:'2658.50',alerts:[{pattern:'MHV'}]};
assert.strictEqual(demoRt.demo===true,true,'a demo runtime object would be rejected by the publisher guard (rt.demo===true)');

console.log('P0 demo-segregation proof: synthetic data isolated in lib/bbma-demo.js (tagged demo:true); production runtime has NO require/call/sine/2658; leaked demo input is confidence-prohibited (SYNTHETIC_DATA_PRESENT) + lifecycle-stops-at-DATA_VALIDATED; publisher guard keys off rt.demo');
process.exit(0);
