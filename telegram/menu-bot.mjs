import {renderCalendar,isCalendarAction} from './calendar-filters.mjs';
import {withTelegramReceipt} from './update-receipts.mjs';
/** News_ifxhelper Telegram menu (read-only). No order execution or synthetic quotes. */
export const WEB_ROOT = 'https://mohd012z.github.io/News_ifxhelper/';
const RAW_ROOT = 'https://raw.githubusercontent.com/mohd012z/News_ifxhelper/main/';
const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const ACTIONS = new Set(['menu','news','calendar','calendar_high','bbma','alerts','health','help']);
const TFS = new Set(['M1','M5','M15','M30','H1','H4','D1','W1','MN1']);
const MAX_AGE_MS = 15 * 60 * 1000;
export const COMMANDS = [
  {command:'start',description:'Open interactive menu'},
  {command:'menu',description:'Show all buttons'},
  {command:'news',description:'News dashboard and source freshness'},
  {command:'calendar',description:'Current-week economic calendar'},
  {command:'bbma',description:'Read-only BBMA research snapshot'},
  {command:'alerts',description:'Alert history and status'},
  {command:'health',description:'Source and bot status'},
  {command:'help',description:'Button and command guide'}
];
const esc = x => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const callback = (name, key) => ({text:name, callback_data:'ifx:v1:'+key});
const link = (name, url) => ({text:name,url});
const menuKeys = () => ({inline_keyboard:[
 [callback('📰 News','news'),callback('📅 Calendar','calendar')],
 [callback('📊 BBMA','bbma'),callback('📨 Alerts','alerts')],
 [callback('🩺 Health','health'),callback('❔ Help','help')],
 [link('🌐 Dashboard',WEB_ROOT)]
]});
const backKeys = (extras=[]) => ({inline_keyboard:[...extras,[callback('🏠 Main menu','menu')],[link('🌐 Open dashboard',WEB_ROOT)]]});
function ageLabel(stamp,now) {
 const t=Date.parse(stamp||'');
 if (!Number.isFinite(t) || t>now+60000) return 'UNKNOWN (no trustworthy timestamp)';
 const age=Math.max(0,now-t);
 return `${Math.floor(age/60000)} minutes old · ${age<=MAX_AGE_MS?'RECENT SNAPSHOT':'STALE SNAPSHOT'}`;
}
async function getJSON(url, fetcher) {
 const r=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if (!r.ok) throw new Error('upstream HTTP '+r.status);
 const declared=Number(r.headers.get('content-length')||0);
 if (declared>2_000_000) throw new Error('oversized upstream');
 const body=await r.text();
 if(body.length>2_000_000) throw new Error('oversized upstream');
 return JSON.parse(body);
}
function mytTime(raw) {
 const d=new Date(raw);
 return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)+' MYT':'time unverified';
}
function isTodayMyt(t,now) {
 const dateKey = n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(n));
 return dateKey(t)===dateKey(now);
}
export async function renderAction(action, {fetcher=fetch, now=Date.now()}={}) {
 if(action==='menu') return {text:'<b>NEWS IFXHELPER • Main menu</b>\nChoose a research panel. The bot does not place orders. Data is labeled by source and timestamp.',reply_markup:menuKeys()};
 if(action==='help') return {text:'<b>How to use the bot</b>\n/start or /menu — open all buttons\n/news — view news refresh status\n/calendar — week events (MYT)\n/bbma — historical BBMA scan\n/alerts — alert history link\n/health — snapshot status\n\nButtons open the selected panel. These are research observations, not live-price trade signals.',reply_markup:backKeys()};
 if(action==='news') {
  const keys=backKeys([[callback('🔄 Refresh news','news'),link('📰 News dashboard',WEB_ROOT)]]);
  try {
   const manifest=await getJSON(RAW_ROOT+'data-manifest.json',fetcher);
   let headline='Most recent classified research event: unavailable (see dashboard for cited headlines).';
   try {
    const item=await getJSON(RAW_ROOT+'data/intelligence-360.json',fetcher);
    const evt=item.news?.event;
    if(evt?.title){
     const when=evt.time?mytTime(evt.time):'timestamp unavailable';
     headline=`Recorded event: ${esc(String(evt.title).slice(0,170))}\nCountry: ${esc(String(evt.currency||'unknown').slice(0,12))} · Impact: ${esc(String(evt.impact||'unknown').slice(0,20))}\nEvent time: ${esc(when)}\nResearch snapshot: ${esc(ageLabel(item.sourceGeneratedAt||item.generatedAt,now))}`;
    }
   } catch {} // A missing secondary research feed must not erase manifest freshness.
   return {text:'<b>📰 News desk</b>\nManifest generation: '+esc(ageLabel(manifest.generatedAt,now))+'\n'+headline+'\nThis is historical research context, not a live news headline or evidence of delivered alerts. Original sources are on the dashboard.',reply_markup:keys};
  } catch {return {text:'<b>📰 News desk</b>\nSource freshness unavailable. Do not assume headlines are current. Use the dashboard to inspect source links.',reply_markup:keys};}
 }
 if(isCalendarAction(action))return renderCalendar(action,{fetcher,now});
 if(action==='bbma'||action.startsWith('tf:')) {
  const tf=action.startsWith('tf:')?action.slice(3):null;
  if(tf&&!TFS.has(tf))return {text:'Unsupported timeframe.',reply_markup:backKeys()};
  const keys=backKeys([[callback('M1','tf:M1'),callback('M5','tf:M5'),callback('M15','tf:M15')],[callback('M30','tf:M30'),callback('H1','tf:H1'),callback('H4','tf:H4')],[callback('D1','tf:D1'),callback('W1','tf:W1'),callback('MN1','tf:MN1')],[callback('📊 Summary','bbma'),link('📈 Chart',WEB_ROOT+'?open=bbma')]]);
  try {
   const data=await getJSON(RAW_ROOT+'data/bbma-watch.json',fetcher);
   const age=esc(ageLabel(data.sourceGeneratedAt||data.generatedAt,now));
   if(tf){const a=data.analysis?.[tf]?.bbma;if(!a)return {text:`<b>BBMA ${esc(tf)}</b>\nNo verified observation in the stored snapshot.\n${age}`,reply_markup:keys};
    return {text:`<b>📊 BBMA ${esc(tf)} • ${esc(data.symbol||'Unknown')}</b>\nSource: ${esc(data.provider||'unknown')}\n${age}\nTrend: ${esc(a.trend||'Unknown')}\nReentry: ${esc(a.reentry||'None')}\nExtreme: ${esc(a.extreme||'None')}\nCSAK: ${esc(a.csak||'None')}\nClosed-candle timestamp: ${esc(a.values?.lastTime||a.lastTime||'unverified')}\nHistorical research only — not a real-time trading signal.`,reply_markup:keys};}
   const rows=(data.dashboard?.rows||[]).slice(0,8).map(r=>`${esc(r.tf)}: ${esc(r.trend||'Unknown')} · ${esc(r.pattern||'No setup')}`).join('\n');
   return {text:`<b>📊 BBMA research snapshot</b>\nSymbol: ${esc(data.symbol||'Unknown')}\nProvider: ${esc(data.provider||'Unknown')}\n${age}\n${rows||'No dashboard rows'}\nIndicator classifications require independent broker/candle verification.`,reply_markup:keys};
  }catch{return {text:'<b>📊 BBMA research</b>\nNo validated snapshot available. No signal generated.',reply_markup:keys};}
 }
 if(action==='alerts')return {text:'<b>🔔 Alerts &amp; history</b>\nScheduled news notifications and BBMA observations are different services. The web dashboard contains the available alert history. Telegram delivery receipts are not exposed here; a successful job is not proof of a message delivered to this chat.',reply_markup:backKeys([[link('🔔 Open BBMA history',WEB_ROOT+'?open=bbma&view=history')]])};
 if(action==='health'){
  try{
   const h=await getJSON(RAW_ROOT+'data/agent-health.json',fetcher);
   const agents=['market','intelligence','learning'].map(k=>`${k}: ${esc(String(h.agents?.[k]?.state||h.agents?.[k]?.status||'UNKNOWN').slice(0,30))}`).join('\n');
   return {text:'<b>🩺 Source health</b>\nLast recorded health: '+esc(ageLabel(h.generatedAt,now))+'\n'+agents+'\nWebhook responded to this request; real provider connectivity, Telegram delivery and receipt durability are separately unverified.',reply_markup:backKeys([[callback('🔄 Refresh health','health')]])};
  }catch{return {text:'<b>🩺 Source health</b>\nHealth snapshot unavailable. Webhook processing responded, but downstream health is unknown.',reply_markup:backKeys([[callback('🔄 Retry','health')]])};}
 }
 return {text:'Unknown button action. Select an item below.',reply_markup:menuKeys()};
}
function actionFrom(data){if(typeof data!=='string'||!data.startsWith('ifx:v1:')||BufferSize(data)>64)return 'menu';const action=data.slice(7);return ACTIONS.has(action)||action.startsWith('tf:')&&TFS.has(action.slice(3))||isCalendarAction(action)?action:'menu';}
function BufferSize(s){return new TextEncoder().encode(s).length;}
function authorized(chatId, env){const raw=String(env.TELEGRAM_ALLOWED_CHAT_IDS||env.TELEGRAM_CHAT_ID||'');const ids=raw.split(',').map(s=>s.trim()).filter(s=>/^-?\d+$/.test(s));return ids.includes(String(chatId));}
function equalSecret(a,b){const x=new TextEncoder().encode(String(a||'')),y=new TextEncoder().encode(String(b||''));if(!x.length||x.length!==y.length)return false;let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0;}
export async function handleWebhook(request, env, fetcher=fetch) {
 if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
 if(!env?.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET||!authorizedConfig(env))return new Response('Bot not configured',{status:503});
 if(!equalSecret(request.headers.get('x-telegram-bot-api-secret-token'),env.TELEGRAM_WEBHOOK_SECRET))return new Response('Forbidden',{status:403});
 if(Number(request.headers.get('content-length')||0)>32768)return new Response('Too large',{status:413});
 let update;
 try {const body=await request.text();if(new TextEncoder().encode(body).length>32768)return new Response('Too large',{status:413});update=JSON.parse(body);}catch{return new Response('Bad JSON',{status:400});}
 if(!update||typeof update!=='object'||!Number.isSafeInteger(update.update_id)||update.update_id<0)return new Response('Invalid update',{status:400});
 const cb=update.callback_query;
 const chatId=cb?.message?.chat?.id??update.message?.chat?.id;
 if(!authorized(chatId,env))return new Response('OK',{status:200});
 if(env.TELEGRAM_REQUIRE_INBOX==='true' && !env.TELEGRAM_INBOX_DB?.prepare)return new Response('Inbox not configured',{status:503});
 const processUpdate=async()=>{
 const api=async(method,payload)=>{
  const r=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||body.ok!==true){const e=new Error('Telegram '+method+' error '+r.status);e.status=r.status;e.description=String(body.description||'');throw e;}
  return body.result;
 };
 try{
  if(cb){
   if(typeof cb.id!=='string'||!cb.id)return new Response('Invalid callback',{status:400});
   try {await api('answerCallbackQuery',{callback_query_id:cb.id,cache_time:0});}
   catch(e){if(!(e.status===400&&/query is too old|query id is invalid|query_id_invalid/i.test(e.description)))throw e;}
   const action=actionFrom(cb.data);
   const view=await renderAction(action,{fetcher});
   if(cb.message?.message_id!=null){
    try{await api('editMessageText',{chat_id:chatId,message_id:cb.message.message_id,parse_mode:'HTML',disable_web_page_preview:true,...view});}
    catch(e){if(e.status===400&&/message is not modified/i.test(e.description))return new Response('OK');
      if(e.status!==400)throw e;
      await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',disable_web_page_preview:true,...view});}
   }
   return new Response('OK');
  }
  if(update.message){
   const raw=String(update.message.text||'').trim();
   const name=/^\/([a-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec(raw)?.[1]?.toLowerCase();
   const addressed=/^\/([a-z_]+)@([A-Za-z0-9_]+)(?:\s|$)/i.exec(raw);
   if(addressed&&String(env.TELEGRAM_BOT_USERNAME||'news_ifxhelperbot').toLowerCase()!==addressed[2].toLowerCase())return new Response('OK');
   const action=({start:'menu',menu:'menu',news:'news',calendar:'calendar',bbma:'bbma',alerts:'alerts',health:'health',help:'help'})[name]||'menu';
   const view=await renderAction(action,{fetcher});
   await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',disable_web_page_preview:true,...view});
  }
  return new Response('OK');
 }catch(e){return new Response('Telegram reply failed; retry may occur',{status:503});}
 };
 if(env.TELEGRAM_INBOX_DB?.prepare){
  try {const outcome=await withTelegramReceipt(env.TELEGRAM_INBOX_DB,update.update_id,processUpdate);
   if(outcome.status==='duplicate')return new Response('OK');
   if(outcome.status==='busy')return new Response('Update already processing',{status:503});
   return outcome.value;
  } catch {return new Response('Inbox failure',{status:503});}
 }
 return processUpdate();
}
function authorizedConfig(env){return String(env.TELEGRAM_ALLOWED_CHAT_IDS||env.TELEGRAM_CHAT_ID||'').split(',').some(s=>/^-?\d+$/.test(s.trim()));}