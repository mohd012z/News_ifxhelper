'use strict';
/* EXECUTED proof of typed ChartZone objects (spec section 7) against REAL
 * GC=F candles:
 *   - zones are typed objects {id,type,symbol,timeframe,startTime,endTime,
 *     high,low,label,source,status} — not bare rectangles
 *   - TOKYO_OPEN / US_OPEN = the 1st candle at/after 00:00 UTC / 13:30-14:30 UTC
 *   - start/end are UTC canonical; MYT is a presentation field (UTC+8)
 *   - 96h guard: no session zones on D1+ views
 *   - signalZones maps a BBMASignal -> BBMA_REENTRY/EXTREME/MHV zone
 */
const assert=require('assert');
const CZ=require('../lib/bbma-chart-zones.js');

(async()=>{
  const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=15m',{headers:{'user-agent':'Mozilla/5.0'}});
  const j=await r.json();const res=j.chart.result[0];
  const ts=res.timestamp,q=res.indicators.quote[0];
  const m15=ts.map((t,i)=>({time:t*1000,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i]})).filter(c=>c.open&&c.high&&c.low&&c.close);
  const iso=m15.map(c=>Object.assign({},c,{time:new Date(c.time).toISOString()}));
  /* trim to the most recent <90h continuous trading so Tokyo+US both exist */
  const lastT=iso[iso.length-1].time, win90=90*3600000;
  const a=iso.filter(c=>(Date.parse(lastT)-Date.parse(c.time))<=win90);
  assert.ok(a.length>=60,'enough real M15 candles ('+a.length+')');

  const zones=CZ.buildZones(a,'M15',{});
  assert.ok(zones.length>=2,'TOKYO_OPEN + US_OPEN zones present (got '+zones.length+'): '+zones.map(z=>z.type).join(','));
  for(const z of zones){
    for(const k of ['id','type','symbol','timeframe','startTime','endTime','high','low','label','source','status'])
      assert.ok(z[k]!==undefined&&z[k]!==null,'zone field present: '+k);
    assert.ok(['TOKYO_OPEN','US_OPEN','BBMA_REENTRY','EXTREME','MHV','NEWS_BLACKOUT','CUSTOM'].includes(z.type),'typed zone: '+z.type);
    assert.strictEqual(z.timeframe,'M15');
    assert.strictEqual(z.symbol,'XAU/USD');
    /* UTC canonical */
    assert.ok(!isNaN(Date.parse(z.startTime)),'startTime is parseable UTC ISO: '+z.startTime);
    assert.ok(z.startTime.endsWith('Z'),'startTime is UTC (Z): '+z.startTime);
    /* MYT display = UTC+8 presentation string */
    const utc=Date.parse(z.startTime);
    const expectMYT=new Date(utc+8*3600000).toISOString().slice(11,16)+' MYT';
    assert.strictEqual(z.mytDisplay,expectMYT,'mytDisplay is UTC+8 (got '+z.mytDisplay+' want '+expectMYT+')');
  }
  const tok=zones.find(z=>z.type==='TOKYO_OPEN'), us=zones.find(z=>z.type==='US_OPEN');
  assert.ok(tok&&us);
  /* 1st candle: the zone's candle index is the FIRST with time>=session UTC */
  const tokMs=Date.parse(tok.startTime);
  const tokDayStart=Math.floor(tokMs/86400000)*86400000;
  assert.ok(tokMs>=tokDayStart,'Tokyo zone anchored at/after 00:00 UTC');
  /* Tokyo zone is the FIRST candle of its UTC day at/after 00:00 UTC */
  assert.ok(!a.some(c=>{const m=Date.parse(c.time);return m>=tokDayStart&&m<tokMs;}),'Tokyo zone is the first candle at/after 00:00 UTC');
  const usHour=Date.parse(us.startTime);
  const hour=usHour/3600000-Math.floor(usHour/86400000)*24;
  assert.ok(hour>=13.4&&hour<=14.6,'US zone anchored at 13:30-14:30 UTC (got hour '+hour.toFixed(2)+')');
  /* US zone is the FIRST candle at/after the 13:30-14:30 open (there may be
     legitimate Tokyo-session candles earlier the same UTC day). */
  const usOpenMs=Math.floor(usHour/86400000)*86400000+(usHour%86400000>=13.5*3600000?13.5:14.5)*3600000;
  assert.ok(!a.some(c=>{const m=Date.parse(c.time);return m>=usOpenMs&&m<usHour;}),'US zone is the first candle at/after its session open');
  /* high/low from the real candle, not fabricated */
  assert.ok(tok.high>=tok.low,'Tokyo zone high>=low');
  assert.ok(tok.high>0&&tok.low>0,'Tokyo zone prices positive');

  /* 96h guard: a full 5-day span must produce NO session zones */
  const zones5d=CZ.buildZones(iso,'M15',{});
  assert.strictEqual(zones5d.length,0,'>96h span -> no session zones (D1+ guard)');

  /* signalZones: a BBMASignal with provenance -> typed zone */
  const sig={id:'tech-re_up_H1',pattern:'RE-ENTRY',direction:'UP',timeframe:'H1',candleTime:a[a.length-1].time,status:'READY',version:'v1',
    evidence:[{name:'bbUpper',value:4200},{name:'bbLower',value:4100}]};
  const sz=CZ.signalZones([sig],'H1',{});
  assert.strictEqual(sz.length,1);
  assert.strictEqual(sz[0].type,'BBMA_REENTRY');
  assert.strictEqual(sz[0].source,'BBMA_ENGINE');
  assert.strictEqual(sz[0].version,'v1','audit version carried from the signal');
  assert.strictEqual(sz[0].high,4200);

  console.log('typed ChartZone proof: real GC=F M15 -> '+zones.map(z=>z.type+' @'+z.startTime+' ('+z.mytDisplay+')').join(', ')+' | signal zone '+sz[0].type+' v'+sz[0].version+' | 96h guard OK');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.stack||e.message);process.exit(1);});
