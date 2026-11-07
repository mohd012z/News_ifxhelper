// Read-only Telegram menu renderer. No Telegram API calls and no publishing.
const ALLOWED=new Set(['USD','EUR','GBP','JPY','CAD','AUD','NZD','CHF','CNY']);
const IMPACT=new Set(['Low','Medium','High']);
const safe=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
export const HELIX_MENU=Object.freeze([
  [{text:'📅 Upcoming News',callback_data:'hx:upcoming'},{text:'🧭 Analysis',callback_data:'hx:analysis'}],
  [{text:'🚨 Breaking News',callback_data:'hx:breaking'},{text:'📊 Results',callback_data:'hx:results'}],
  [{text:'🔄 Recheck Sources',callback_data:'hx:recheck'},{text:'📋 Delivery Status',callback_data:'hx:status'}]
]);
export function menuView(){return {text:'🛰️ HELIX News Control\nReview upcoming economic events, source evidence and preliminary analysis. Channel publishing remains disabled.',reply_markup:{inline_keyboard:HELIX_MENU}};}
export function normalizeCalendar(raw,now=Date.now()){
 if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid calendar collection');
 return raw.flatMap(e=>{
  if(!e||typeof e.title!=='string'||e.title.trim().length<3||!ALLOWED.has(e.country)||!IMPACT.has(e.impact)||typeof e.date!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(e.date))return [];
  const time=Date.parse(e.date);if(!Number.isFinite(time)||time<now||time>now+7*86400000)return [];
  return [{title:e.title.trim().slice(0,120),currency:e.country,impact:e.impact,time,forecast:e.forecast??null,previous:e.previous??null}];
 }).sort((a,b)=>a.time-b.time).slice(0,12);
}
export function upcomingView(events,now=Date.now()){
 const rows=normalizeCalendar(events,now);
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
 const lines=rows.map(e=>formatter.format(e.time)+' MYT | '+safe(e.currency)+' '+safe(e.impact)+'\n'+safe(e.title)+'\nForecast: '+safe(e.forecast??'N/A')+' | Previous: '+safe(e.previous??'N/A'));
 return {text:'📅 <b>Upcoming economic news</b>\n'+(lines.join('\n\n')||'No upcoming events in the available feed.')+'\n\nSource: structured economic calendar. Schedule may change.',parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🔄 Recheck',callback_data:'hx:upcoming'},{text:'⬅️ Menu',callback_data:'hx:menu'}]]}};
}
export function analysisView(events,now=Date.now()){
 const rows=normalizeCalendar(events,now);
 const high=rows.filter(e=>e.impact==='High');
 const currencies=[...new Set(high.map(e=>e.currency))];
 const assetNotes=currencies.includes('USD')?'USD events may affect XAUUSD, BTCUSD and Oil; direction is uncertain.':'No high-impact USD event in the available seven-day view.';
 return {text:'🧭 <b>HELIX preliminary analysis</b>\nUpcoming events: '+rows.length+' (display limit 12)\nHigh-impact events: '+high.length+'\nCurrencies: '+safe(currencies.join(', ')||'None')+'\n'+safe(assetNotes)+'\nHawkish/dovish: pending official results and source verification.\nThis is event-risk context, not a trading signal.',parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📅 Upcoming',callback_data:'hx:upcoming'},{text:'⬅️ Menu',callback_data:'hx:menu'}]]}};
}
