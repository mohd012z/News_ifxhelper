'use strict';
/* EXECUTED proof of the canonical FEED STATE MACHINE + metrics (spec section 3):
 * CONNECTING / LIVE / DEGRADED / RECONNECTING / BACKFILL, plus provider,
 * latencyMs, tickCount, reconnectCount, droppedTicks, outOfOrderTicks,
 * gapDetected, backfillRequired.
 *
 * The vm has its OWN Date, and host-created Date objects do not reliably
 * interoperate with the vm realm, so ALL timestamps are generated INSIDE the
 * vm by a helper (vmIso) that uses the controllable fake clock. That guarantees
 * the runtime's 60s drop-guard and its tick-age computation agree with the
 * test. DEGRADED / RECONNECTING are proven by advancing the fake clock, not by
 * waiting real minutes. */
const fs=require('fs'),assert=require('assert'),path=require('path'),vm=require('vm');

function loadRuntime(){
  const win={MARKET_DATA:{live:{twelveDataApiKey:''}}};
  win.addEventListener=function(){};win.dispatchEvent=function(){};
  win.setInterval=function(){return 0;};win.setTimeout=function(){return 0;};win.clearTimeout=function(){};
  win.localStorage={getItem:()=>null,setItem:()=>{}};win.fetch=async()=>({status:444,json:async()=>({})});
  vm.createContext(win);
  vm.runInContext(`
    (function(){
      var Real=Date, offset=0;
      function FakeDate(){ var a=arguments;
        if(a.length===0){ this.__t=Real.now()+offset; }
        else if(a.length===1 && typeof a[0]==='number'){ this.__t=a[0]; }
        else { this.__t=Real.parse(a[0]); } }
      FakeDate.now=function(){return Real.now()+offset;};
      FakeDate.parse=function(x){return Real.parse(x);};
      FakeDate.UTC=Real.UTC;
      FakeDate.prototype.getTime=function(){return this.__t;};
      FakeDate.prototype.valueOf=function(){return this.__t;};
      FakeDate.prototype.toISOString=function(){var s=new Real(); s.setTime(this.__t); return s.toISOString();};
      globalThis.__Date=FakeDate;
      globalThis.__setOffset=function(o){offset=o;};
      globalThis.__resetOffset=function(){offset=0;};
      globalThis.Date=FakeDate;
    })();
  `,win);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','bbma-runtime.js'),'utf8'),win,{filename:'bbma-runtime.js'});
  return win;
}
/* generate an ISO timestamp INSIDE the vm, `ago` ms before the current fake now */
const vmIso=(win,ago)=>vm.runInContext('new __Date(Date.now()-('+(ago)+')).toISOString()',win);
/* publish current feed WITHOUT a new tick (setAlerts refreshes alerts, then publish() recomputes feed from tick age) */
function forcePublish(win){ win.BBMARuntime.setAlerts([],[]); return win.BBMA_RUNTIME; }

(async()=>{
  /* 1. Cold load, no ticks, transport connecting -> CONNECTING, backfillRequired */
  let win=loadRuntime();
  win.BBMARuntime.setFeedStatus('connecting','first request');
  let s=win.BBMA_RUNTIME.feed;
  assert.strictEqual(s.state,'CONNECTING','no ticks + connected -> CONNECTING');
  assert.strictEqual(s.backfillRequired,true,'no ticks -> backfillRequired');
  assert.strictEqual(s.tickCount,0,'tickCount 0');

  /* 2. Fresh stream tick -> LIVE, provider=stream, low latency */
  win.BBMARuntime.ingest(4150.10, vmIso(win,200), 'stream');
  s=win.BBMA_RUNTIME.feed;
  assert.strictEqual(s.state,'LIVE','fresh tick -> LIVE');
  assert.strictEqual(s.provider,'stream','provider stream');
  assert.strictEqual(s.tickCount,1,'tickCount 1');
  assert.ok(s.latencyMs<1000,'latency low (got '+s.latencyMs+')');
  assert.strictEqual(s.backfillRequired,false,'live tick -> backfillRequired false');

  /* 3. Fresh poll tick -> stays LIVE, provider=poll */
  win.BBMARuntime.ingest(4150.55, vmIso(win,100), 'poll');
  s=win.BBMA_RUNTIME.feed;
  assert.strictEqual(s.state,'LIVE','poll tick -> LIVE');
  assert.strictEqual(s.provider,'poll','provider poll');
  assert.strictEqual(s.tickCount,2,'tickCount 2');

  /* 4. A 6-min-old tick is REJECTED by the 60s guard -> dropped + surfaced */
  win.BBMARuntime.ingest(4150.60, vmIso(win,6*60000), 'poll');
  s=win.BBMA_RUNTIME.feed;
  assert.ok(s.droppedTicks>=1,'6min-old tick dropped + surfaced (got '+s.droppedTicks+')');
  assert.strictEqual(s.state,'LIVE','dropped tick does not change state (still fresh)');

  /* 5. Advance the fake clock so the last ACCEPTED tick ages past 5min
     (DEGRADED), past 10min (RECONNECTING, transport up), then transport down (BACKFILL). */
  let win2=loadRuntime();
  win2.BBMARuntime.setFeedStatus('streaming','websocket open');
  win2.BBMARuntime.ingest(4140.00, vmIso(win2,1000), 'stream');
  assert.strictEqual(win2.BBMA_RUNTIME.feed.state,'LIVE','LIVE before time jump');
  try{
    win2.__setOffset(6*60000);
    s=forcePublish(win2).feed;
    assert.strictEqual(s.state,'DEGRADED','6min since last tick -> DEGRADED (got '+s.state+')');
    assert.ok(s.latencyMs>=5*60000,'latency >=5min (got '+s.latencyMs+')');

    win2.__setOffset(11*60000);
    s=forcePublish(win2).feed;
    assert.strictEqual(s.state,'RECONNECTING','11min old + connected -> RECONNECTING (got '+s.state+')');

    win2.BBMARuntime.setFeedStatus('offline','websocket closed');
    s=win2.BBMA_RUNTIME.feed;
    assert.strictEqual(s.state,'BACKFILL','11min old + disconnected -> BACKFILL (got '+s.state+')');
  } finally { win2.__resetOffset(); }

  /* 6. outOfOrderTicks: a tick >1.5s behind the last accepted */
  let win3=loadRuntime();
  win3.BBMARuntime.setFeedStatus('streaming','websocket open');
  win3.BBMARuntime.ingest(4100.00, vmIso(win3,2000), 'stream');
  win3.BBMARuntime.ingest(4100.10, vmIso(win3,5000), 'stream');
  assert.ok(win3.BBMA_RUNTIME.feed.outOfOrderTicks>=1,'out-of-order tick counted (got '+win3.BBMA_RUNTIME.feed.outOfOrderTicks+')');

  /* 7. gapDetected: a tick skips a completed M1 bucket (second tick 2min in
     the future — within the +5min accept window — so it's accepted but crosses
     >=1 completed minute bucket) */
  let win4=loadRuntime();
  win4.BBMARuntime.setFeedStatus('streaming','websocket open');
  win4.BBMARuntime.ingest(4000.00, vmIso(win4,1000), 'stream');
  win4.BBMARuntime.ingest(4000.05, vmIso(win4,-2*60000), 'stream');
  assert.strictEqual(win4.BBMA_RUNTIME.feed.gapDetected,true,'3min skip -> gapDetected');

  /* 8. reconnectCount: offline -> up transitions */
  let win5=loadRuntime();
  win5.BBMARuntime.setFeedStatus('offline','init');
  win5.BBMARuntime.setFeedStatus('streaming','websocket open');
  win5.BBMARuntime.setFeedStatus('offline','dropped');
  win5.BBMARuntime.setFeedStatus('live','polling');
  assert.ok(win5.BBMA_RUNTIME.feed.reconnectCount>=2,'two offline->up counted (got '+win5.BBMA_RUNTIME.feed.reconnectCount+')');

  console.log('feed state machine + metrics proof: all 8 conditions verified on the real runtime');
  console.log('  CONNECTING/LIVE/DEGRADED/RECONNECTING/BACKFILL + provider/latency/tickCount/dropped/outOfOrder/gap/reconnect asserted');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.stack||e.message);process.exit(1);});
