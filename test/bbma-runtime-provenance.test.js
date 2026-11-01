const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const raw=fs.readFileSync('bbma-runtime.js','utf8');
function createRuntime(){
 const events=new Map();
 const win={
  addEventListener(name,handler){events.set(name,handler);},
  dispatchEvent(){},
  LiveFeed:null
 };
 vm.runInNewContext(raw,{window:win,Math,Number,Date,JSON,isFinite,setInterval(){},CustomEvent:class{constructor(name,options){this.name=name;this.detail=options.detail;}}});
 return{runtime:win.BBMARuntime,snapshot:()=>win.BBMA_RUNTIME,events};
}
test('startup uses demo candles without inventing live price or alerts',()=>{
 const w=createRuntime(),rt=w.snapshot();
 assert.equal(rt.price,null);assert.equal(rt.at,null);assert.equal(rt.fresh,false);
 assert.equal(rt.source,'BASELINE_CACHE');assert.equal(rt.freshness,'DEMO_BASELINE');
 assert.equal(rt.alerts.length,0);assert.equal(rt.alertHistory.length,0);assert.equal(rt.event,null);
 assert.equal(rt.mtf.H1.state,'DEMO_ONLY');assert.equal(rt.mtf.H1.trend,'—');
 assert(rt.ohlc.H1.some(c=>c.source==='BASELINE_CACHE'));
});
test('unsourced browser tick never authenticates synthetic candles',()=>{
 const w=createRuntime();w.runtime.ingest(3210,new Date().toISOString());
 const rt=w.snapshot();
 assert.equal(rt.price,'3210.00');assert.equal(rt.fresh,false);
 assert.equal(rt.source,'UNVERIFIED_BROWSER_TICK');
 assert.equal(rt.alerts.length,0);
 assert.equal(rt.mtf.M15.state,'UNVERIFIED_BROWSER_TICK');assert.equal(rt.mtf.M15.reentry,'—');
});
test('invalid browser tick cannot change demo-state',()=>{
 const w=createRuntime();w.runtime.ingest(-10,new Date().toISOString());
 assert.equal(w.snapshot().source,'BASELINE_CACHE');
});
test('BBMA runtime bridge retains UI compatibility contract',()=>{
 const w=createRuntime(),rt=w.snapshot();
 assert.equal(rt.mtf,rt.frames);assert.equal(rt.timeframes,rt.frames);assert(rt.ohlc.H4);
 assert.equal(typeof w.events.get('xau-live-tick'),'function');
});
