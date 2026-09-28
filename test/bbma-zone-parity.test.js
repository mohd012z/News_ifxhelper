'use strict';
/* CONTRACT: ONE canonical BBMA zone vocabulary (7-state BB location).
 * lib/bbma-engine.js classify() is the single authority; the cron builder
 * (lib/bbma-candle-watch.js location) must INHERIT it, and the in-app runtime
 * (bbma-runtime.js, self-contained UMD) must agree field-for-field.
 * Proven against deterministic synthetic regimes AND live GC=F data.
 * This test closes the finding from the 360° audit: engine emitted a 4-band
 * zone (LOW_TO_MID/MID_TO_TOP) while builder+runtime used the 7-state model. */
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const E=require('../lib/bbma-engine.js');
const W=require('../lib/bbma-candle-watch.js');
const R=require('../lib/ohlc-resampler.js');

/* --- deterministic synthetic series (no network) --- */
function series(n,fn){const out=[];const base=Date.UTC(2026,8,20,0,0,0);
  for(let i=0;i<n;i++){const p=fn(i);const o=p+(i%3===0?1.5:-1.5),c=p;const h=Math.max(o,c)+0.8,l=Math.min(o,c)-0.8;
    out.push({time:base+i*300000,open:o,high:h,low:l,close:c});}
  return out;}
const DOWNTREND=series(140,i=>4200-i*3.2);                 /* close slides below mid+ema50 -> DOWN */
const UPTREND=series(140,i=>3900+i*3.4);                    /* UP */
const SQUEEZE=series(140,i=>4000+Math.sin(i/3)*4);          /* tight band, inside */
/* 139 low-vol bars (tiny band ~±0.6) then ONE bar closing +20: the last close
 * sits above the upper 2-sigma band -> genuine ABOVE_TOP_BB on the 7-state. */
const SPIKE=series(140,i=>i<139?4000+(i%2?0.6:-0.6):4020);

/* --- the runtime's self-contained classify (sma..classify slice of the UMD) --- */
function runtimeClassify(){
  const src=fs.readFileSync(__dirname+'/../bbma-runtime.js','utf8');
  const s0=src.indexOf('function sma(');
  const i=src.indexOf('function classify(',s0);
  let j=src.indexOf('{',i),d=0,k=j;
  for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(d===0)break;}}
  const sandbox={};vm.createContext(sandbox);
  vm.runInContext(src.slice(s0,k+1)+'\nthis.__rt=function(c){return classify(c);};',sandbox);
  return sandbox.__rt;}
const RT=runtimeClassify();

const FIELDS=['trend','momentum','extreme','csak','reentry','zone'];
const Z7=new Set(['INSIDE_BB','ABOVE_TOP_BB','BELOW_LOW_BB','TOP_BB','LOW_BB','MID_BB','EMA50']);
function check(name,candles){
  const eng=E.classify(candles),bld=W.location(candles),rt=RT(candles);
  assert.ok(eng.state==='READY',name+': engine READY');
  assert.ok(Z7.has(eng.zone),name+': engine zone is 7-state, got '+eng.zone);
  assert.ok(eng.band&&['ABOVE_TOP_BB','BELOW_LOW_BB','MID_TO_TOP','LOW_TO_MID'].includes(eng.band),name+': engine keeps 4-band as .band');
  assert.strictEqual(bld.zone,eng.zone,name+': builder zone inherits engine');
  assert.ok(Math.abs(bld.tolerance-eng.tolerance)<1e-9,name+': builder tolerance from engine');
  for(const f of FIELDS)assert.strictEqual(rt[f],eng[f],name+': runtime '+f+' == engine ('+rt[f]+' vs '+eng[f]+')');
  for(const f of FIELDS)assert.strictEqual(rt[f],bld[f],name+': runtime '+f+' == builder');
  return eng;}

check('downtrend',DOWNTREND);
check('uptrend',UPTREND);
check('squeeze',SQUEEZE);
check('spike',SPIKE);
/* direction sanity: the regimes must actually classify as intended */
assert.strictEqual(E.classify(DOWNTREND).trend,'DOWN','downtrend regime trend');
assert.strictEqual(E.classify(UPTREND).trend,'UP','uptrend regime trend');
assert.strictEqual(E.classify(SPIKE).zone,'ABOVE_TOP_BB','spike sits above upper band (7-state)');

/* --- live GC=F data (skipped honestly if the feed is unreachable) --- */
(async()=>{
  let m1=null;
  try{
    const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1m',{headers:{'user-agent':'Mozilla/5.0'}});
    const j=await r.json();const res=j.chart.result[0];const ts=res.timestamp,q=res.indicators.quote[0];
    m1=ts.map((t,i)=>({time:t*1000,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i]})).filter(c=>c.open&&c.high&&c.low&&c.close);
  }catch(e){}
  if(!m1){console.log('bbma-zone-parity contract passed (synthetic 4/4; live feed unreachable, skipped honestly)');process.exit(0);}
  const big=R.buildFrames(m1);let live=0;
  for(const tf of ['M5','M15','M30','H1']){
    const bars=big[tf].slice(-240);
    if(bars.length<50)continue;
    const eng=E.classify(bars),bld=W.location(bars),rt=RT(bars);
    assert.ok(Z7.has(eng.zone),tf+': live engine zone 7-state');
    assert.strictEqual(bld.zone,eng.zone,tf+': live builder==engine zone');
    for(const f of FIELDS)assert.strictEqual(rt[f],eng[f],tf+': live runtime '+f+' == engine');
    live++;
  }
  assert.ok(live>=3,'live data exercised at least 3 timeframes (got '+live+')');
  console.log('bbma-zone-parity contract passed (synthetic 4/4 + live GC=F '+live+'/4 TFs, engine==builder==runtime)');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.stack||e.message);process.exit(1);});
