'use strict';
/* CONTRACT: technicalAlerts (derived monitoring signals from REAL MTF
 * readings) — and the PUBLISHABILITY boundary that keeps them separate from
 * externally-validated alerts (send-bbma-telegram.js still requires
 * d.alerts, which is supplied ONLY via setAlerts from an external source). */
const fs=require('fs'),assert=require('assert');
const now=Date.now();
function iso(ms){return new Date(ms).toISOString();}
const TFMS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};

/* 60 bars: flat 4100, but the last three COMPLETED bars crash to 3800 (the
 * current in-progress bucket is never backfilled, so the crash sits in the 3
 * most recent closed buckets) -> a genuine lower-band breakout on every TF. */
function crashSeries(step){
  const bucketNow=Math.floor(now/step)*step;
  const vals=[];
  for(let i=59;i>=0;i--){
    const b=bucketNow-i*step;
    const pos=bucketNow-b; /* step..11*step for the last 10 STORED (completed) bars */
    /* last 10 completed bars: downtrend 4150 -> 3800, so EMA50 slope < 0 and
     * the close ends below the lower BB(20,2) band on every TF */
    const p=pos>=step&&pos<=11*step?3800+(pos/step-1)*35:4150;
    const wick=pos>=step&&pos<=11*step?35:0.4;
    vals.push({datetime:new Date(b).toISOString().slice(0,16).replace('T',' '),open:String(p+wick*0.5),high:String(p+wick*0.5),low:String(p-wick*0.5),close:String(p)});
  }
  return vals;
}
const win={MARKET_DATA:{live:{twelveDataApiKey:'test-key'}}};
win.addEventListener=function(){};
win.dispatchEvent=function(){};
win.setInterval=function(){return 0;};
win.__bbmaBackfillPaceMs=2;
win.__bbmaBackfillRetryMs=2;
/* PHASE B: the runtime delegates classify() to the canonical engine. */
win.BBMAEngine=require('../lib/bbma-engine.js');
win.fetch=async function(url){
  const m=String(url).match(/interval=([^&]+)/);
  const iv=m?m[1]:null;
  const step={ '5min':TFMS.M5,'15min':TFMS.M15,'30min':TFMS.M30,'1h':TFMS.H1,'4h':TFMS.H4,'1day':TFMS.D1,'1week':TFMS.W1,'1month':TFMS.MN1 }[iv]||TFMS.M5;
  const vals=crashSeries(step);
  vals.reverse(); /* newest first, like the real API */
  return {status:200,ok:true,json:async()=>({values:vals})};
};
/* Shadow BOTH window and globalThis like the backfill harness. */
new Function('window','globalThis','CustomEvent',fs.readFileSync('bbma-runtime.js','utf8'))(win,win,function(){},win);
const R=win.BBMARuntime;
assert.strictEqual(typeof R,'object','runtime must export BBMARuntime');
assert.strictEqual(typeof R.setAlerts,'function','setAlerts (external evidence API)');

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
await sleep(250*8+400); /* 8 TFs * 2ms pacing + backfill margin */
let pub=win.BBMA_RUNTIME;
assert.strictEqual(pub.alertState,'PRE-EVENT','backfill alone -> PRE-EVENT, not a live alert');
assert.strictEqual(pub.publishable,false,'history alone must NOT be publishable');
assert.strictEqual(pub.alerts.length,0,'d.alerts must stay empty without external setAlerts (publishability boundary)');
assert.ok(Array.isArray(pub.techAlerts),'techAlerts must exist on the published frame');
assert.ok(pub.techAlerts.length>0,'a real lower-band crash must surface at least one technical signal');
pub.techAlerts.forEach(a=>{
  assert.ok(a.id.startsWith('tech-'),'technical alerts are prefixed');
  assert.strictEqual(a.technical,true);
  assert.ok(['MOMENTUM','EXTREME','RE-ENTRY','CSA'].includes(a.pattern),'pattern from the canonical classifier outputs');
  assert.ok(['HIGH','MEDIUM','LOW'].includes(a.level));
  assert.ok(a.timeMYT,'technical alerts carry MYT time');
});
/* H1 must be classified DOWN after the crash (sanity: real readings, not demo) */
assert.strictEqual(pub.frames.H1.trend,'DOWN','crash bar must classify H1 trend DOWN');
assert.strictEqual(pub.frames.H1.state,'READY');

/* External validated alert flows through d.alerts ONLY via setAlerts — and it
 * does not suppress or fake the technical signals. */
R.setAlerts([{id:'EV1',symbol:'XAU/USD',timeframe:'H1',pattern:'BB_BREAKOUT',level:'HIGH',timeMYT:'08:15',summary:'Validated external event',state:'POST_EVENT'}],[]);
pub=win.BBMA_RUNTIME;
assert.strictEqual(pub.alerts.length,1,'setAlerts populates d.alerts (publishable evidence)');
assert.strictEqual(pub.alerts[0].id,'EV1');
assert.ok(Array.isArray(pub.techAlerts)&&pub.techAlerts.length>0,'technical signals remain independent of external evidence');
console.log('bbma technical-alerts + publishability boundary contract passed');
process.exit(0);
})().catch(function(e){console.error('FAIL:',e.stack||e.message);process.exit(1);});
