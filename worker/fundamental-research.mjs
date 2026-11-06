export const ZONE='Asia/Kuala_Lumpur';
export const ROUTES=Object.freeze({news_ifxhelper:['XAUUSD','BTCUSD'],helix:['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURJPY','EURGBP']});
const currencies=new Set(['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','CNY']);
const impacts=new Set(['Low','Medium','High']);
export function normalizeEvent(raw){
 if(!raw||typeof raw.title!=='string'||!raw.title.trim()||!currencies.has(raw.country)||!impacts.has(raw.impact)||typeof raw.date!=='string'||!/(Z|[+-]\\d{2}:\\d{2})$/.test(raw.date))return null;
 const time=Date.parse(raw.date);if(!Number.isFinite(time))return null;
 return {title:raw.title.trim(),currency:raw.country,impact:raw.impact,time,forecast:raw.forecast??null,previous:raw.previous??null,actual:raw.actual??null,source:raw.source??'calendar'};
}
export function instruments(event,project){if(!ROUTES[project])throw Error('Unknown project');if(project==='news_ifxhelper')return event.currency==='USD'?['XAUUSD','BTCUSD']:[];return ROUTES.helix.filter(pair=>pair.includes(event.currency));}
export function morningDue(now){return new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(now)==='08:00';}
export function stage(event,now){const delta=(event.time-now)/60000;if(delta>25&&delta<=30)return 'T-30';if(delta>5&&delta<=10)return 'T-10';if(delta<=0&&delta>=-15)return 'RESULT';return null;}
export function deliveryKey(project,event,destination,phase){return JSON.stringify([project,event.currency,event.title.toLowerCase(),event.time,destination,phase]);}
export function numericSurprise(event){const a=Number(event.actual),f=Number(event.forecast);if(event.actual===null||event.forecast===null||String(event.actual).trim()===''||String(event.forecast).trim()===''||!Number.isFinite(a)||!Number.isFinite(f))return null;return {actual:a,forecast:f,difference:a-f};}
export function stance(event){const surprise=numericSurprise(event);if(!surprise)return {bias:'Unverified',reason:'Comparable actual and forecast not available'};const name=event.title.toLowerCase();const inflation=/cpi|inflation|pce|price index/.test(name),employment=/non.farm|employment change|payroll/.test(name),unemployment=/unemployment rate/.test(name);if(!inflation&&!employment&&!unemployment)return {bias:'Mixed',reason:'No supported policy interpretation rule'};const signed=surprise.difference*(unemployment?-1:1);return {bias:signed>0?'Hawkish':signed<0?'Dovish':'Mixed',reason:'Preliminary data surprise, not a verified central-bank policy decision'};}
