'use strict';

/**
 * Completed-candle Wilder ATR(14) for every timeframe used by XAU//DESK.
 *
 * The source contract is OHLC with explicit instrument and provider provenance.
 * No price is inferred from a headline. Accepts broker XAU/USD spot OHLC when
 * supplied, but the default Yahoo GC=F source remains gold FUTURES.
 *
 * Yahoo feed tiers: 1m/5d; 5m/1mo; 1h/3mo; 1d/5y.
 * No missing bars are invented. Weekly/monthly buckets are calendar periods,
 * not 10080/43200-minute fixed-width approximations.
 */
const FRAMES = Object.freeze([
  { tf: 'M1',  source: '1m', unitMinutes: 1,   atrAgeHours: .25 },
  { tf: 'M5',  source: '5m', unitMinutes: 5,   atrAgeHours: .5 },
  { tf: 'M15', source: '5m', unitMinutes: 15,  atrAgeHours: 1 },
  { tf: 'M30', source: '5m', unitMinutes: 30,  atrAgeHours: 2 },
  { tf: 'H1',  source: '1h', unitMinutes: 60,  atrAgeHours: 4 },
  { tf: 'H4',  source: '1h', unitMinutes: 240, atrAgeHours: 12 },
  { tf: 'D1',  source: '1d', unitMinutes: 1440,atrAgeHours: 96 },
  { tf: 'W1',  source: '1d', unitMinutes: null,atrAgeHours: 336 },
  { tf: 'MN1', source: '1d', unitMinutes: null,atrAgeHours: 1200 }
]);
const MS_MIN = 60000;
const UTC_DAY = 86400000;
const LIMIT = 14;

function numeric(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function barTimestamp(r) {
  const v = r && (r.time ?? r.t);
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : NaN;
  if (typeof v !== 'string') return NaN;
  return Date.parse(v);
}
function utcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function weekStart(ms) {
  const d = new Date(ms), day = (d.getUTCDay() + 6) % 7;
  return utcDay(ms) - day * UTC_DAY;
}
function monthStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function monthEnd(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
function cleanRows(raw, sourceMinutes, now) {
  const rows = [], seen = new Set();
  let rejected = 0, duplicates = 0, future = 0;
  for (const r of raw || []) {
    const t = barTimestamp(r);
    const o = numeric(r.open ?? r.o), h = numeric(r.high ?? r.h),
      l = numeric(r.low ?? r.l), c = numeric(r.close ?? r.c);
    if (![t,o,h,l,c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0
        || l > h || o > h || o < l || c > h || c < l) { rejected++; continue; }
    // Daily Yahoo timestamps represent the trading date, not necessarily midnight UTC.
    const start = sourceMinutes === 1440 ? utcDay(t) : t;
    const end = start + sourceMinutes * MS_MIN;
    if (end > now) { future++; continue; } // current/forming bars never enter ATR
    if (seen.has(start)) { duplicates++; continue; }
    seen.add(start);
    rows.push({time:new Date(start).toISOString(),t:start,o,h,l,c});
  }
  rows.sort((a,b)=>a.t-b.t);
  return { rows, rejected, duplicates, future };
}
function aggregateBars(base, targetMinutes, sourceMinutes, now) {
  if (targetMinutes === sourceMinutes) return base.slice();
  if (!Number.isInteger(targetMinutes/sourceMinutes)) throw Error('NON_DIVISIBLE_TIMEFRAME');
  const step = targetMinutes * MS_MIN, srcStep = sourceMinutes * MS_MIN;
  const grouped = new Map();
  for (const b of base) {
    const bucket = Math.floor(b.t / step) * step;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(b);
  }
  const out=[], expected=targetMinutes/sourceMinutes;
  for (const [start,bs] of [...grouped.entries()].sort((a,b)=>a[0]-b[0])) {
    if (start+step>now || bs.length!==expected) continue;
    const sorted=bs.sort((a,b)=>a.t-b.t);
    if (sorted[0].t !== start || sorted.at(-1).t + srcStep !== start + step) continue;
    if (sorted.some((x,i)=>i>0 && x.t!==sorted[i-1].t+srcStep)) continue;
    out.push({t:start,time:new Date(start).toISOString(),
      o:sorted[0].o,h:Math.max(...sorted.map(x=>x.h)),
      l:Math.min(...sorted.map(x=>x.l)),c:sorted.at(-1).c});
  }
  return out;
}
function calendarBars(daily, tf, now) {
  const isWeek=tf==='W1', grouped=new Map();
  for(const b of daily) {
    const start=isWeek?weekStart(b.t):monthStart(b.t);
    if(!grouped.has(start)) grouped.set(start,[]);
    grouped.get(start).push(b);
  }
  const out=[];
  for (const [start,bs] of [...grouped.entries()].sort((a,b)=>a[0]-b[0])) {
    const end=isWeek?start+7*UTC_DAY:monthEnd(start);
    if(end>now) continue; // no current partial week/month
    bs.sort((a,b)=>a.t-b.t);
    const distinct = new Set(bs.map(x=>utcDay(x.t)));
    // Trading weeks exclude weekends and holidays; NEVER demand 7 daily bars.
    // Requiring >2 days/10 days reduces accidental partial provider ranges.
    if(distinct.size < (isWeek?3:10)) continue;
    out.push({t:start,time:new Date(start).toISOString(),
      o:bs[0].o,h:Math.max(...bs.map(x=>x.h)),
      l:Math.min(...bs.map(x=>x.l)),c:bs.at(-1).c,
      periodEnd:new Date(end).toISOString(),tradingDays:distinct.size});
  }
  return out;
}
function wilderATR(bars, period=LIMIT) {
  if(!Array.isArray(bars)||bars.length<period+1) return null;
  let a=0;
  const tr=[];
  for(let i=1;i<bars.length;i++){
    const b=bars[i],prev=bars[i-1].c;
    tr.push(Math.max(b.h-b.l,Math.abs(b.h-prev),Math.abs(b.l-prev)));
  }
  a=tr.slice(0,period).reduce((s,v)=>s+v,0)/period;
  for(let i=period;i<tr.length;i++)a=(a*(period-1)+tr[i])/period;
  return Number.isFinite(a)&&a>0?a:null;
}
function maxAgeMs(frame) {return frame.atrAgeHours*3600000;}
function latestClosedAt(bar,frame) {
  if(frame.tf==='W1'||frame.tf==='MN1') return Date.parse(bar.periodEnd);
  return bar.t + frame.unitMinutes*MS_MIN;
}
/**
 * \`sets\`: { '1m':[candles], '5m':[candles], '1h':[candles], '1d':[candles] }.
 * Missing provider tiers produce separate UNAVAILABLE rows, not fabricated prices.
 */
function analyzeAll(sets,options={}) {
  const now=options.now===undefined?Date.now():typeof options.now==='number'?options.now:Date.parse(options.now);
  if(!Number.isFinite(now)) throw Error('INVALID_NOW');
  const instrument=String(options.instrument||'');
  const provider=String(options.provider||'');
  const source=String(options.source||'');
  if(!instrument||!provider||!source) throw Error('MISSING_PROVENANCE');
  const sourceMs={'1m':1,'5m':5,'1h':60,'1d':1440};
  const clean={},errors={};
  for(const [id,min] of Object.entries(sourceMs)) {
    clean[id]=cleanRows((sets||{})[id],min,now);
    if(clean[id].duplicates || clean[id].rejected) errors[id]='CORRUPT_SOURCE_BARS';
  }
  const frames={};
  for(const frame of FRAMES){
    const info=clean[frame.source];
    let bars=[];
    let reason=errors[frame.source]||null;
    if(!reason) {
      bars=frame.tf==='W1'||frame.tf==='MN1'
        ?calendarBars(info.rows,frame.tf,now)
        :aggregateBars(info.rows,frame.unitMinutes,sourceMs[frame.source],now);
      if(bars.length<LIMIT+1)reason='INSUFFICIENT_CLOSED_CANDLES';
    }
    const last=bars.at(-1);
    const asOf=last?new Date(latestClosedAt(last,frame)).toISOString():null;
    const atr=!reason?wilderATR(bars):null;
    if(!reason && atr===null)reason='INVALID_ATR';
    // If last completed candle is older than this frame's own refresh tolerance,
    // show the row but do not authorize current TP for it.
    if(!reason && now-Date.parse(asOf)>maxAgeMs(frame))reason='STALE_CANDLES';
    const data={
      tf:frame.tf,sourceInterval:frame.source,instrument,provider,source,
      state:reason?'UNAVAILABLE':'READY',reason,atr:atr===null?null:+atr.toFixed(6),
      last: last?+last.c.toFixed(6):null,asOf,
      closedBars:bars.length,period:LIMIT,ageHours:asOf?+((now-Date.parse(asOf))/3600000).toFixed(2):null,
      evidence:{sourceCandles:info.rows.length,rejected:info.rejected,duplicates:info.duplicates,formingExcluded:info.future}
    };
    frames[frame.tf]=data;
  }
  const ready=Object.values(frames).filter(x=>x.state==='READY').length;
  return {
    schemaVersion:1,instrument,provider,source,generatedAt:new Date(now).toISOString(),
    timeframes:frames,readyCount:ready,total:FRAMES.length,
    state:ready===FRAMES.length?'READY':ready?'PARTIAL':'UNAVAILABLE',
    note:'Completed OHLC candles; Wilder ATR14 by timeframe. No calibrated direction or executable XAU/USD spot quote.'
  };
}
module.exports={FRAMES,cleanRows,aggregateBars,calendarBars,wilderATR,analyzeAll,weekStart,monthStart,monthEnd};
