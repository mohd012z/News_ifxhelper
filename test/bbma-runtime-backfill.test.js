'use strict';
/* bbma-runtime.js HISTORY BACKFILL contract:
 *  - cold load + configured Twelve Data key + working fetch -> each timeframe
 *    seeds with REAL historical bars (source TWELVEDATA_BACKFILL), M5+ ready;
 *  - live ticks ALWAYS win: a tick in a bucket the backfill also covers is
 *    never clobbered, and the hero price is the live tick, not the history;
 *  - no key / no fetch / failing fetch -> runtime stays honestly empty;
 *  - malformed bars are skipped, never coerced;
 *  - backfill alone never makes the snapshot publishable.
 * No network: fetch is stubbed. Must not hang (unref'd timers). */
const fs=require('fs'),assert=require('assert');
const now=Date.now();
function iso(ms){return new Date(ms).toISOString();}
function ohlcSeries(interval,tf,count){
  /* count real bars ending at the current open bucket, oldest first */
  const out=[];const step=tf;const bucketNow=Math.floor(now/step)*step;
  for(let i=count-1;i>=0;i--){
    const b=bucketNow-i*step;
    const base=4100+((b/60000)%37);
    out.push({time:iso(b),open:base,high:base+5,low:base-4,close:base+2});
  }
  return out;
}
const TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
function makeWindow({key=true,fetchFails=false,malformed=false,withFetch=true,ratelimitBefore=null,paceMs=20}={}){
  const win={MARKET_DATA:key?{live:{twelveDataApiKey:'test-key-123',twelveDataHost:'https://api.twelvedata.com'}}:{live:{}}};
  win.addEventListener=function(){};
  win.dispatchEvent=function(){};
  win.setInterval=function(fn,ms){const t=setTimeout(()=>{},1<<30);return t;}; /* inert */
  win.__bbmaBackfillPaceMs=2; /* tests run the backfill fast (real app paces 10s) */
  win.__bbmaBackfillRetryMs=2;
  if(withFetch){
    let calls=0;
    const TFMS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
    win.fetch=async function(url){
      calls++;
      const m=String(url).match(/interval=([^&]+)/);
      const iv=m?m[1]:null;
      const rev={'5min':'M5','15min':'M15','30min':'M30','1h':'H1','4h':'H4','1day':'D1','1week':'W1','1month':'MN1'};
      const tf=rev[iv]||'M5';
      const step=TFMS[tf];
      if(ratelimitBefore!=null&&calls>ratelimitBefore){
        return {status:429,ok:false,json:async()=>({message:'rate limit'})};
      }
      if(!key)throw new Error('no key');
      if(fetchFails)throw new Error('network down');
      const count=40;
      const bucketNow=Math.floor(now/step)*step;
      const vals=[];
      for(let i=0;i<count;i++){
        const b=bucketNow-i*step;
        const o=4100+i*0.3;
        vals.push({datetime:new Date(b).toISOString().slice(0,16).replace('T',' '),open:String(o),high:String(o+4),low:String(o-3),close:String(o+1)});
      }
      if(malformed&&vals.length)vals[2]={datetime:vals[2].datetime,open:'NaN',high:'1',low:'2',close:'3'};
      vals.reverse(); /* newest first, like the real API */
      return {status:200,ok:true,json:async()=>({values:vals})};
    };
    win.__fetchCalls=function(){return calls;};
  }
  return win;
}
function evalRuntime(win){
  /* Shadow BOTH window and globalThis: the runtime reads globalThis when
   * window is absent, and in Node globalThis is the real (networked) global. */
  new Function('window','globalThis','CustomEvent',fs.readFileSync('bbma-runtime.js','utf8'))(win,win,function(){},win);
  return win;
}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
/* 1) cold load + working backfill -> real history seeds every TF */
const w1=makeWindow();
evalRuntime(w1);
await sleep(250*8+400); /* 8 TFs * 250ms pacing + margin */
let rt=w1.BBMA_RUNTIME;
assert(rt.backfill&&rt.backfill.at,'backfill must record its run');
['M5','M15','M30','H1','H4','D1','W1','MN1'].forEach(function(tf){
  assert(rt.ohlc[tf].length>0,tf+' must have backfilled candles');
  rt.ohlc[tf].forEach(function(c){assert(c.source==='TWELVEDATA_BACKFILL',tf+' candle must be labeled backfilled');});
});
['M5','M15','H1'].forEach(function(tf){
  assert.strictEqual(rt.frames[tf].state,'READY',tf+' must classify from real history');
  assert(rt.frames[tf].trend,'trend expected');
});
assert.strictEqual(rt.demo,false);
assert.strictEqual(rt.publishable,false,'history alone must NOT be publishable (no fresh live tick)');
assert.strictEqual(rt.source,'NONE','no live tick yet -> source NONE even with history');

/* 2) live tick wins: hero price becomes the tick, backfill candle never clobbered */
const liveP=9999.99;
w1.BBMARuntime.ingest(liveP,iso(now));
rt=w1.BBMA_RUNTIME;
assert.strictEqual(rt.source,'LIVE_TICK_DERIVED');
assert.strictEqual(rt.price,liveP.toFixed(2),'hero price must be the live tick, not history');
const bkt=Math.floor(now/TFS.M5)*TFS.M5;
const m5live=rt.ohlc.M5.filter(function(c){return c._b===bkt;});
assert.strictEqual(m5live.length,1,'exactly one M5 candle in the live bucket (no dup)');
assert.strictEqual(m5live[0].source,'LIVE_TICK_DERIVED','live bucket must be owned by the tick, not backfill');
assert(rt.ohlc.M5.length>1,'M5 keeps history behind the live bucket');
assert.strictEqual(rt.publishable,false,'still needs external validated alerts to be publishable');

/* 3) no key -> stays honestly empty (no fetch attempted) */
const w3=makeWindow({key:false});
evalRuntime(w3);
await sleep(300);
const rt3=w3.BBMA_RUNTIME;
['M5','M15','M30','H1','H4','D1','W1','MN1'].forEach(function(tf){assert.strictEqual((rt3.ohlc[tf]||[]).length,0,'no-key: '+tf+' must stay empty');});
assert(!rt3.backfill||!rt3.backfill.at||Object.keys(rt3.backfill.tfs||{}).length===0,'no-key: nothing backfilled');

/* 4) fetch fails -> stays honestly empty, errors recorded */
const w4=makeWindow({fetchFails:true});
evalRuntime(w4);
await sleep(250*8+400);
const rt4=w4.BBMA_RUNTIME;
['M5','M15','M30','H1','H4','D1','W1','MN1'].forEach(function(tf){assert.strictEqual((rt4.ohlc[tf]||[]).length,0,'failing-fetch: '+tf+' must stay empty');});
assert(rt4.backfill.errors.length>0,'failing fetch must record errors');
assert.strictEqual(rt4.publishable,false);

/* 5) malformed bars are skipped, never coerced (valid bars still land) */
const w5=makeWindow({malformed:true});
evalRuntime(w5);
await sleep(250*8+400);
const rt5=w5.BBMA_RUNTIME;
rt5.ohlc.M5.forEach(function(c){
  assert(Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close),'malformed OHLC must not be stored');
  assert(c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close),'stored OHLC must be internally consistent');
});
assert(rt5.ohlc.M5.length>0,'valid bars must still backfill around the malformed one');

/* 5b) rate limit: early TFs backfill, later ones 429 (persistent) -> skipped
 *     honestly, earlier TFs keep their data, error is recorded. */
const w5b=makeWindow({ratelimitBefore:2});
evalRuntime(w5b);
await sleep(200);
const rt5b=w5b.BBMA_RUNTIME;
assert(rt5b.ohlc.H1.length>0,'H1 (first) must backfill before the limit');
assert(rt5b.ohlc.M5.length>0,'M5 (second) must backfill before the limit');
assert((rt5b.ohlc.M15||[]).length===0,'M15 hit the 429 -> must stay empty (honest)');
assert(rt5b.backfill.errors.some(x=>/rate limit/i.test(x)),'429 must be recorded in backfill.errors');
assert.strictEqual(rt5b.publishable,false);

/* 6) no fetch (bare window, Node poster path) -> no backfill, no crash.
 * In Node the runtime's `var w = window || globalThis` IS the real global, so
 * read the result from globalThis — and there must be no fetch there for the
 * backfill gate to be inert (Node 26 has a global fetch, so delete it first). */
const realGlobal = globalThis;
const savedFetch = realGlobal.fetch;
delete realGlobal.fetch;
new Function('window','globalThis','CustomEvent',fs.readFileSync('bbma-runtime.js','utf8'))(undefined,realGlobal,function(){},realGlobal);
const rt6=realGlobal.BBMA_RUNTIME;
realGlobal.fetch=savedFetch;
assert((rt6.ohlc.M5||[]).length===0);
assert.strictEqual(rt6.publishable,false);
assert(rt6.backfill&&(!rt6.backfill.at||Object.keys(rt6.backfill.tfs||{}).length===0),'no-fetch window must not backfill');

console.log('bbma runtime history-backfill contract passed');
process.exit(0);
})().catch(function(e){console.error('FAIL:',e.stack||e.message);process.exit(1);});
