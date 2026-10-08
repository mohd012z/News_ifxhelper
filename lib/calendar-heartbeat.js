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
  if(stableSignature(oldWeek)===stableSignature(week)) return {changed:false,snapshot,week};

  const retained=oldAll
    .filter(r=>r&&r.sourceHorizon!=='this-week')
    .filter(r=>!week.some(w=>sameEvent(r,w)));
  const all=retained.concat(week).sort((a,b)=>sortMs(a)-sortMs(b));
  const incoming=all.filter(r=>r.importance==='high'||r.importance==='med');

  const out={...snapshot};
  out.calendarAll=all;
  out.incoming=incoming;
  out.calendarGeneratedAt=now;
  out.calendarHorizon={...(snapshot.calendarHorizon||{}),heartbeat:'current-week durable heartbeat (5-minute reminder cadence)'};
  return {changed:true,snapshot:out,week};
}

module.exports={rowFromProvider,stableSignature,mergeSnapshot,releaseState,sameEvent};
