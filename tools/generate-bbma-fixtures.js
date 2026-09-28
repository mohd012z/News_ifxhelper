'use strict';
/* B5 fixture generator — deterministic candle series for the canonical BBMA
 * parity test (test/bbma-parity-fixtures.test.js). Every regime is tried
 * against candidate formulas until the CANONICAL engine (lib/bbma-engine.js)
 * classifies it exactly as expected; only engine-validated series are written.
 * Regimes + confirmed formulas:
 *   xau-trend-up    : 3900+i*3.4                                   -> trend UP
 *   xau-trend-down  : 4200-i*3.2                                   -> trend DOWN
 *   xau-momentum    : 139 flat 0.6 then close -30 below the band   -> MOMENTUM_DOWN
 *   xau-range       : 4000+sin(i/3)*1.2                            -> momentum NONE, inside band
 *   xau-reentry     : downtrend -> flat, final bar high pokes into
 *                     the LWMA-of-highs, close stays below mid     -> REENTRY_DOWN_ZONE
 * Regenerate with: node tools/generate-bbma-fixtures.js
 */
const fs=require('fs'),path=require('path');
const E=require('../lib/bbma-engine.js');
const OUT=path.join(__dirname,'..','fixtures');
fs.mkdirSync(OUT,{recursive:true});
const base=Date.UTC(2026,8,20,0,0,0);
function series(n,fn){const o=[];for(let i=0;i<n;i++){const p=fn(i);const op=p+(i%3===0?1.5:-1.5);o.push({time:base+i*300000,open:+op.toFixed(2),high:+(Math.max(op,p)+0.8).toFixed(2),low:+(Math.min(op,p)-0.8).toFixed(2),close:+p.toFixed(2)});}return o;}
function reentryDown(){
  const dropN=125,slope=2.6,poke=2,flat=4200-dropN*slope;
  const c=series(140,i=>i<dropN?4200-i*slope:flat);
  const last=c[c.length-1];
  last.close=+flat.toFixed(2);
  last.open=+(flat-0.5).toFixed(2);
  last.high=+(flat+poke).toFixed(2);   /* pokes into the lower LWMA of highs */
  last.low=+(flat-0.5-0.8).toFixed(2);
  return c;
}
function pick(name,expect,builder){
  const c=builder();
  const r=E.classify(c);
  if(!expect(r)){console.error('fixture',name,'did NOT classify as expected:',JSON.stringify({trend:r.trend,momentum:r.momentum,extreme:r.extreme,csak:r.csak,reentry:r.reentry,zone:r.zone,squeeze:r.squeeze}));process.exit(1);}
  fs.writeFileSync(path.join(OUT,name+'.json'),JSON.stringify({
    regime:name,generatedBy:'tools/generate-bbma-fixtures.js',
    candles:c,engine:{trend:r.trend,momentum:r.momentum,extreme:r.extreme,csak:r.csak,reentry:r.reentry,zone:r.zone,emaGap:r.emaGap,squeeze:r.squeeze,band:r.band}
  },null,2));
  console.log('OK',name,r.trend,r.momentum,r.reentry,r.zone,r.squeeze);
}
pick('xau-trend-up',   r=>r.state==='READY'&&r.trend==='UP',      ()=>series(140,i=>3900+i*3.4));
pick('xau-trend-down', r=>r.state==='READY'&&r.trend==='DOWN',    ()=>series(140,i=>4200-i*3.2));
pick('xau-momentum',   r=>r.state==='READY'&&r.momentum==='MOMENTUM_DOWN', ()=>series(140,i=>i<139?4000+(i%2?0.6:-0.6):3970));
pick('xau-range',      r=>r.state==='READY'&&r.momentum==='NONE'&&r.zone!=='ABOVE_TOP_BB'&&r.zone!=='BELOW_LOW_BB', ()=>series(140,i=>4000+Math.sin(i/3)*1.2));
pick('xau-reentry',    r=>r.state==='READY'&&r.reentry==='REENTRY_DOWN_ZONE', ()=>reentryDown());
console.log('5 fixtures written to',OUT);
