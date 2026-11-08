'use strict';

const COUNTRY = {
  USD:'United States', EUR:'Euro Area', GBP:'United Kingdom', JPY:'Japan',
  AUD:'Australia', NZD:'New Zealand', CAD:'Canada', CHF:'Switzerland', CNY:'China'
};
const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function pad(n){ return String(n).padStart(2,'0'); }
function toMyt(d){
  const x=new Date(d.getTime()+8*3600000);
  return DAY[x.getUTCDay()]+', '+x.getUTCFullYear()+'-'+pad(x.getUTCMonth()+1)+'-'+pad(x.getUTCDate())+' '+pad(x.getUTCHours())+':'+pad(x.getUTCMinutes());
}
function toGmt(d){
  return DAY[d.getUTCDay()]+', '+d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
function parseEconomicNumber(v){
  if(v==null||v==='') return null;
  const s=String(v).trim().replace(/,/g,'');
  const m=/^([-+]?\d*\.?\d+)\s*([KMBT%]?)$/i.exec(s);
  if(!m) return null;
  let n=Number(m[1]); if(!Number.isFinite(n)) return null;
  const u=m[2].toUpperCase();
  if(u==='K') n*=1e3; else if(u==='M') n*=1e6; else if(u==='B') n*=1e9; else if(u==='T') n*=1e12;
  return n;
}
function releaseState(actual,forecast){
  const a=parseEconomicNumber(actual), f=parseEconomicNumber(forecast);
  if(a==null) return {state:'RELEASE_PENDING',actualNumeric:null,forecastNumeric:f,surpriseRaw:null,surprisePct:null};
  if(f==null) return {state:'RELEASED_NO_CONSENSUS',actualNumeric:a,forecastNumeric:null,surpriseRaw:null,surprisePct:null};
  const raw=a-f;
  return {state:'RELEASED',actualNumeric:a,forecastNumeric:f,surpriseRaw:raw,surprisePct:f===0?null:+((raw/Math.abs(f))*100).toFixed(3)};
}
function importance(impact){
  if(impact==='High') return 'high';
  if(impact==='Medium') return 'med';
  if(impact==='Holiday') return 'holiday';
  return 'low';
}
function lead(imp){ return imp==='high'?15:(imp==='med'?10:5); }

function rowFromProvider(e,fetchedAt){
  if(!e||!e.date||!e.title) return null;
  const d=new Date(e.date);
  if(isNaN(d.getTime())) return null;
  const imp=importance(e.impact);
  const actual=e.actual!=null&&e.actual!==''?e.actual:null;
  const forecast=e.forecast!=null&&e.forecast!==''?e.forecast:null;
  const previous=e.previous!=null&&e.previous!==''?e.previous:null;
  return {
    date:d.toISOString().slice(0,10),
    timeMyt:toMyt(d),
    timeGmt:toGmt(d),
    displayTime:null,
    dateOnly:false,
    event:(e.country?'['+e.country+'] ':'')+e.title,
    currency:e.country||null,
    country:COUNTRY[e.country]||null,
    importance:imp,
    actual,forecast,previous,
    release:releaseState(actual,forecast),
    note:[actual?'Actual '+actual:null,forecast?'Forecast '+forecast:null,previous?'Prev '+previous:null].filter(Boolean).join(' - ')||'No result/consensus figure published.',
    focusTf:imp==='high'?'M5 - M15':(imp==='med'?'M15':(imp==='holiday'?'Session':'Context')),
    play:imp==='holiday'
      ? 'Holiday/session context - liquidity and opening hours may differ.'
      : (actual?'Released - compare actual, consensus and observed reaction before interpretation.':'Upcoming/pending - scenario context only until an actual result is available.'),
    reminderLeadMin:lead(imp),
    sourceHorizon:'this-week',
    source:'ForexFactory calendar heartbeat JSON',
    sourceClass:'CALENDAR_HEARTBEAT_JSON',
    fetchedAt,
    url:'https://www.forexfactory.com/calendar',
    auto:true
  };
}
function gmtMs(row){
  const m=/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(String(row&&row.timeGmt||''));
  return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]):NaN;
}
function sameEvent(a,b){
  if(!a||!b||a.currency!==b.currency||a.event!==b.event) return false;
  const at=gmtMs(a), bt=gmtMs(b);
  if(Number.isFinite(at)&&Number.isFinite(bt)) return Math.abs(at-bt)<=6*3600000;
  return !!a.date&&a.date===b.date;
}
function stableSignature(rows){
  return JSON.stringify((rows||[]).map(r=>[
    r.event,r.currency,r.date,r.timeGmt,r.importance,r.actual,r.forecast,r.previous,r.dateOnly
  ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function sortMs(row){
  const t=gmtMs(row); if(Number.isFinite(t)) return t;
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row&&row.date||''));
  return m?Date.UTC(+m[1],+m[2]-1,+m[3],12):Number.MAX_SAFE_INTEGER;
}
function mergeSnapshot(snapshot,providerEvents,fetchedAt){
  const now=fetchedAt||new Date().toISOString();
  const week=(providerEvents||[]).map(e=>rowFromProvider(e,now)).filter(Boolean);
  const oldAll=Array.isArray(snapshot.calendarAll)?snapshot.calendarAll:[];
  const oldWeek=oldAll.filter(r=>r&&r.sourceHorizon==='this-week');
  // The FF this-week feed is FLAKY in coverage: it sometimes returns the full
  // month (~400 rows) and sometimes only the remaining current week (~100).
  // Replacing on every fetch therefore wipes next-week events on a short
  // window -> "All clear" (2026-11-08: 411 rows at 01:28, 116 at 01:43).
  // UNION instead: keep existing week rows, upsert the fresh fetch, so data
  // only ever accumulates until an event is in the past, then prune it.
  // A partial/empty fetch must not shrink the set below ~half of what we
  // already had (the flaky short-window failure mode) — but a full week rollover
  // (fresh >> old) still replaces cleanly.
  const fresh=week;
  const nowMs=Date.parse(now);
  const RETENTION_HORIZON_DAYS=28;      // keep future rows up to ~4 weeks ahead
  const PAST_PRUNE_HOURS=48;            // drop released rows once 2 days past
  const FUTURE_HORIZON_MS=RETENTION_HORIZON_DAYS*86400000;
  const PAST_RETENTION_MS=PAST_PRUNE_HOURS*3600000;
  // FUTURE rows always accumulate (the flaky feed drops them -> "All clear");
  // PAST rows are kept 48h (recent history) or when the fetch re-lists them
  // (content/actual update). Matched rows prefer the fresh content.
  const freshByKey=new Map(fresh.map(w=>[JSON.stringify([w.event,w.currency,w.timeGmt,w.date]),w]));
  const merged=[];
  for(const r of oldWeek){
    const t=sortMs(r);
    if(!Number.isFinite(t)){ merged.push(r); continue; }
    const key=JSON.stringify([r.event,r.currency,r.timeGmt,r.date]);
    if(freshByKey.has(key)){
      // The feed just re-sent this row (exact or within tolerance): its
      // content (actuals) is freshest, so the FRESH row wins.
      const f=freshByKey.get(key);
      freshByKey.delete(key);
      merged.push(f);
      continue;
    }
    const isFuture=t>nowMs;
    if(isFuture){ if(t-nowMs<=FUTURE_HORIZON_MS) merged.push(r); }       // future: always keep within horizon
    else { if((nowMs-t)<=PAST_RETENTION_MS) merged.push(r); }             // past: keep 48h window
  }
  for(const f of freshByKey.values()) merged.push(f);                     // brand-new rows from the fetch
  merged.sort((a,b)=>sortMs(a)-sortMs(b));
  if(stableSignature(merged)===stableSignature(oldWeek)) return {changed:false,snapshot,week:merged};
  const retainedOther=oldAll
    .filter(r=>r&&r.sourceHorizon!=='this-week')
    .filter(r=>!merged.some(w=>sameEvent(r,w)));
  const all=retainedOther.concat(merged).sort((a,b)=>sortMs(a)-sortMs(b));
  const incoming=all.filter(r=>r.importance==='high'||r.importance==='med');
  const out={...snapshot};
  out.calendarAll=all;
  out.incoming=incoming;
  out.calendarGeneratedAt=now;
  out.calendarHorizon={...(snapshot.calendarHorizon||{}),heartbeat:'current-week durable heartbeat (5-minute reminder cadence, union-merge so flaky short FF windows never drop future events)'};
  return {changed:true,snapshot:out,week:merged};
}

module.exports={rowFromProvider,stableSignature,mergeSnapshot,releaseState,sameEvent};
