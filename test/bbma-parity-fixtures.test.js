'use strict';
/* B5 PARITY FIXTURES — the canonical BBMA authority proof on DETERMINISTIC
 * fixture series (regenerate: node tools/generate-bbma-fixtures.js).
 *
 * For every fixture, THREE consumers must agree field-for-field:
 *   1. lib/bbma-engine.js classify()        (the canonical implementation)
 *   2. lib/bbma-candle-watch.js location()  (the cron builder — inherits engine)
 *   3. bbma-runtime.js classify()           (the browser — now DELEGATES to engine)
 *
 * The fixtures also pin the engine's recorded output: if any formula ever
 * drifts (a silent re-implementation), the recorded `engine` block stops
 * matching and this test fails — even before a downstream consumer diverges.
 */
const assert=require('assert'),fs=require('fs'),path=require('path');
const E=require('../lib/bbma-engine.js');
const W=require('../lib/bbma-candle-watch.js');
/* load the runtime's classify with the canonical engine injected (browser
 * <script> parity) — via the same bare-global path the browser uses */
const RT_SRC=fs.readFileSync(path.join(__dirname,'..','bbma-runtime.js'),'utf8');
globalThis.BBMAEngine=E;
(function(){
  const win={};
  win.addEventListener=function(){};win.dispatchEvent=function(){};
  win.setInterval=function(){return 0;};win.setTimeout=function(){return 0;};win.clearTimeout=function(){};
  win.localStorage={getItem:()=>null,setItem:()=>{}};
  win.fetch=async()=>({status:444,json:async()=>({})});
  new Function('window',RT_SRC)(win);
  globalThis.__RT=win.BBMARuntime.classify;
})();
const RT=globalThis.__RT;

const FIELDS=['trend','momentum','extreme','csak','reentry','zone'];
const FIX=fs.readdirSync(path.join(__dirname,'..','fixtures')).filter(f=>f.endsWith('.json'));
assert.ok(FIX.length===5,'5 parity fixtures present, got '+FIX.length+': '+FIX.join(','));

let checked=0;
for(const f of FIX){
  const fx=JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures',f),'utf8'));
  const c=fx.candles;
  /* the fixture's own candles must not be re-sorted or mutated by classify
     (deep-copy for each consumer so a mutation in one can't leak) */
  const eng=E.classify(c.map(x=>Object.assign({},x)));
  const bld=W.location(c.map(x=>Object.assign({},x)));
  const rt=RT(c.map(x=>Object.assign({},x)));
  assert.ok(eng.state==='READY',f+': engine READY');
  assert.ok(rt.state==='READY',f+': runtime READY (delegation active, not BBMA_ENGINE_MISSING)');
  /* 1) engine output matches what was RECORDED when the fixture was generated
       (determinism + formula-drift detector) */
  for(const k of FIELDS.concat(['emaGap','squeeze']))
    assert.strictEqual(eng[k],fx.engine[k],f+': engine '+k+' drifted from recorded fixture ('+eng[k]+' vs '+fx.engine[k]+')');
  /* 2) builder inherits the engine */
  assert.strictEqual(bld.zone,eng.zone,f+': builder zone inherits engine');
  for(const k of ['trend','momentum','extreme','csak','reentry'])
    assert.strictEqual(bld[k],eng[k],f+': builder '+k+' == engine');
  /* 3) the browser runtime AGREES with the engine (it delegates — no 3rd path) */
  for(const k of FIELDS)
    assert.strictEqual(rt[k],eng[k],f+': runtime '+k+' == engine ('+rt[k]+' vs '+eng[k]+')');
  for(const k of ['trend','momentum','extreme','csak','reentry','zone'])
    assert.strictEqual(rt[k],bld[k],f+': runtime '+k+' == builder');
  checked++;
}
assert.strictEqual(checked,5,'all 5 fixtures exercised');
console.log('bbma parity fixtures passed: '+checked+'/5 deterministic regimes, engine == builder == runtime on ['+FIELDS.join(',')+'], recorded engine output intact (no formula drift)');
process.exit(0);
