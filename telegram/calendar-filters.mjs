/** Read-only filtered Forex Factory current-week calendar. Source data is untrusted. */
const ROOT='https://mohd012z.github.io/News_ifxhelper/';
const URL='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const COUNTRIES=['ALL','USD','EUR','GBP','JPY','AUD','CAD','NZD','CHF'];
const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const cb=(title,action)=>({text:title,callback_data:'ifx:v1:'+action});
const link=(title,url)=>({text:title,url});
const mytDay=n=>new Date(n+28800000).toISOString().slice(0,10);
const mytTime=n=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(n))+' MYT';
export function parseCalendarAction(action){
 if(action==='calendar'||action==='calendar_high')return{country:'ALL',impact:action==='calendar_high'?'H':'A',period:'W',page:0,legacy:true};
 const legacy=/^(calendar|calendar_high):p:(\d{1,2})$/.exec(action);
 if(legacy&&+legacy[2]<=31)return{country:'ALL',impact:legacy[1]==='calendar_high'?'H':'A',period:'W',page:+legacy[2],legacy:true};
 const m=/^cal2:(ALL|USD|EUR|GBP|JPY|AUD|CAD|NZD|CHF):([AHM]):([WTN]):(\d{1,2})$/.exec(action);
 if(!m||+m[4]>31)return null;
 return{country:m[1],impact:m[2],period:m[3],page:+m[4],legacy:false};
}
export const isCalendarAction=action=>parseCalendarAction(action)!==null;
function actionFor(cfg,page=0){
 if(cfg.legacy&&cfg.country==='ALL'&&cfg.period==='W'&&cfg.impact!=='M')return(cfg.impact==='H'?'calendar_high':'calendar')+':p:'+page;
 return 'cal2:'+cfg.country+':'+cfg.impact+':'+cfg.period+':'+page;
}
function keyboard(cfg,page,pages){
 const change=p=>({...cfg,...p,legacy:false,page:0});
 const choose=(label,opts)=>cb((cfg.country===opts.country&&cfg.impact===opts.impact&&cfg.period===opts.period?'✓ ':'')+label,actionFor(opts));
 const nations=COUNTRIES.map(country=>choose(country,change({country})));
 const impact=[choose('All impact',change({impact:'A'})),choose('High',change({impact:'H'})),choose('Medium',change({impact:'M'}))];
 const period=[choose('Week',change({period:'W'})),choose('Today',change({period:'T'})),choose('Tomorrow',change({period:'N'}))];
 const navigation=[];
 if(page>0)navigation.push(cb('◀ Previous',actionFor(cfg,page-1)));
 if(page+1<pages&&page<31)navigation.push(cb('Next ▶',actionFor(cfg,page+1)));
 return{inline_keyboard:[nations.slice(0,5),nations.slice(5),impact,period,...(navigation.length?[navigation]:[]),[cb('📅 All week','calendar'),cb('🔴 High impact','calendar_high')],[cb('🏠 Main menu','menu')],[link('🌐 Open dashboard',ROOT)]]};
}
export async function renderCalendar(action,{fetcher=fetch,now=Date.now()}={}){
 const cfg=parseCalendarAction(action);
 if(!cfg)throw TypeError('Invalid calendar action');
 const failed={text:'<b>📅 Economic calendar</b>\nThe current-week feed is unavailable. No verified upcoming releases.',reply_markup:{inline_keyboard:[[cb('🔄 Retry calendar',actionFor(cfg,cfg.page))],[cb('🏠 Main menu','menu')]]}};
 try{
  const response=await fetcher(URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok||Number(response.headers.get('content-length')||0)>2000000)return failed;
  const body=await response.text();
  if(body.length>2000000)return failed;
  const arr=JSON.parse(body);
  if(!Array.isArray(arr))return failed;
  const seen=new Set(),out=[],today=mytDay(now),tomorrow=mytDay(now+86400000);
  for(const e of arr){
   if(!e||typeof e!=='object'||Array.isArray(e))continue;
   const t=Date.parse(e.date||'');
   if(!Number.isFinite(t)||t<now-3600000||t>=now+8*86400000)continue;
   const country=String(e.country||e.currency||'').trim().toUpperCase();
   if(cfg.country!=='ALL'&&country!==cfg.country)continue;
   const impact=String(e.impact||'').toLowerCase();
   if(cfg.impact==='H'&&!/high/.test(impact))continue;
   if(cfg.impact==='M'&&!/medium|moderate/.test(impact))continue;
   const day=mytDay(t);
   if(cfg.period==='T'&&day!==today)continue;
   if(cfg.period==='N'&&day!==tomorrow)continue;
   const title=String(e.title||'Untitled'),dedupe=[t,country,title.trim().toLowerCase(),impact].join('|');
   if(seen.has(dedupe))continue;
   seen.add(dedupe);out.push({t,country,title,impact:String(e.impact||'Unknown')});
  }
  out.sort((a,b)=>a.t-b.t||a.country.localeCompare(b.country));
  const pages=Math.max(1,Math.ceil(out.length/8)),page=Math.min(cfg.page,pages-1);
  const items=out.slice(page*8,page*8+8);
  const rows=items.length?items.map(e=>'• '+esc(mytTime(e.t))+' · '+esc(e.country.slice(0,12))+' · '+esc(e.title.slice(0,110))+' ('+esc(e.impact.slice(0,20))+' impact)').join('\n'):'No matching upcoming events in the current-week feed.';
  const period=cfg.period==='T'?'Today':cfg.period==='N'?'Tomorrow':'Current week';
  const impact=cfg.impact==='H'?'High':cfg.impact==='M'?'Medium':'All';
  return{text:'<b>📅 '+period+' · '+cfg.country+' · '+impact+' impact</b>\nTimes: MYT · Forex Factory structured current-week feed\n'+rows+'\nPage '+(page+1)+'/'+pages+' · '+out.length+' unique matching events'+(pages>32?' · first 32 pages navigable':'')+'. Source fetch does not prove live event accuracy.',reply_markup:keyboard(cfg,page,pages)};
 }catch{return failed;}
}
