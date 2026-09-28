'use strict';
/* bbma-runtime.js must be evaluable in Node with a bare `window` object
 * (send-bbma-telegram.js does exactly this), must fabricate NOTHING on a
 * cold load, and must only become publishable with fresh real ticks AND
 * real externally-supplied alerts. If this process hangs, an un-unref'd
 * interval leaked — that is a failure. */
const fs=require('fs'),assert=require('assert');

function evalRuntime(){
  const win={};
  new Function('window', fs.readFileSync('bbma-runtime.js','utf8'))(win);
  return win;
}

// 1) Node-safe load (old revision threw: window.addEventListener is not a function)
const win=evalRuntime();
let rt=win.BBMA_RUNTIME;
assert(rt,'BBMA_RUNTIME missing after eval');
assert.strictEqual(rt.demo,false);
assert.strictEqual(rt.price,null,'cold load must have no price');
assert.strictEqual(rt.source,'NONE');
assert.strictEqual(rt.fresh,false);
assert.strictEqual(rt.freshness,'NO_LIVE_TICKS');
assert.strictEqual(rt.publishable,false,'cold load must never be publishable');
assert(Array.isArray(rt.alerts)&&rt.alerts.length===0,'cold load must have zero alerts');
assert.strictEqual(rt.event,null,'cold load must have no event card');
Object.keys(rt.ohlc).forEach(tf=>assert(rt.ohlc[tf].length===0,tf+' must start empty'));
Object.keys(rt.frames).forEach(tf=>assert.strictEqual(rt.frames[tf].state,'INSUFFICIENT_DATA'));

// 2) Real ticks build real OHLC; still not publishable without alerts.
// Anchor the 25-tick (25s) span immediately BEFORE the next M5 boundary:
// all ticks are future-but-fresh (accepted by the 60s guard) AND fall inside a
// single M5 bucket, so M5.length is deterministically 1 (a wall-clock span would
// straddle the boundary ~8% of the time and flake).
var nextM5=Math.floor(Date.now()/300000)*300000+300000;
var base=nextM5-25*1000;
for(let i=0;i<25;i++){
  win.BBMARuntime.ingest(4200+i*0.1,base+i*1000);
}
rt=win.BBMA_RUNTIME;
assert.strictEqual(rt.source,'LIVE_TICK_DERIVED');
assert.strictEqual(rt.freshness,'FRESH_SNAPSHOT');
assert.strictEqual(rt.publishable,false,'ticks alone are not a publishable alert state');
// 25 ticks at 1s spacing all land inside one M5 bucket -> exactly one candle,
// and every timeframe got a tick-derived candle (never a fabricated one).
assert.strictEqual(rt.ohlc.M5.length,1);
Object.keys(rt.ohlc).forEach(tf=>assert(rt.ohlc[tf].length===1,tf+' should hold one tick candle'));
rt.ohlc.M5.forEach(c=>assert.strictEqual(c.source,'LIVE_TICK_DERIVED'));
assert.strictEqual(rt.ohlc.M5[0].close,4200+24*0.1,'close must be the last REAL tick');

// 3) Fresh external alerts make it publishable
win.BBMARuntime.setAlerts([
  {id:'a1',symbol:'XAU/USD',timeframe:'H4',pattern:'MHV',level:'HIGH',timeMYT:'now',summary:'validated from CI snapshot'}
]);
rt=win.BBMA_RUNTIME;
assert.strictEqual(rt.publishable,true,'fresh ticks + real alerts must be publishable');
assert.strictEqual(rt.alerts.length,1);

// 4) Future-dated ticks beyond the acceptance window are rejected (clock skew)
win.BBMARuntime.ingest(4199,Date.now()+3600*1000);
rt=win.BBMA_RUNTIME;
assert.strictEqual(rt.ohlc.M5.length,1,'future-dated tick must not extend candles');

console.log('bbma runtime Node-safety + honesty contract passed');
