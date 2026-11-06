const FEED='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const SOURCE='https://www.forexfactory.com/calendar';
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function normalize(e){
 if(!e||e.impact!=='High'||typeof e.title!=='string'||!e.title.trim()||typeof e.date!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(e.date))return null;
 const time=Date.parse(e.date);
 if(!Number.isFinite(time)||!['USD','CAD','EUR','GBP','JPY','CNY','AUD','NZD','CHF'].includes(e.country))return null;
 return {title:e.title.trim(),currency:e.country,time,forecast:e.forecast??null,previous:e.previous??null};
}
export function due(e,now){const minutes=(e.time-now)/60000;return minutes>25&&minutes<=30;}
export function eventKey(e,destination){return JSON.stringify([e.currency,e.title.toLowerCase(),e.time,destination]);}
export function format(e){
 const myt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(e.time);
 return '🔔 <b>High-impact economic reminder — T−30</b>\n<b>'+esc(e.currency)+': '+esc(e.title)+'</b>\n🕒 '+myt+' MYT\nForecast: '+esc(e.forecast??'Not published')+' | Previous: '+esc(e.previous??'Not published')+'\nAffected assets: XAUUSD, oil, BTCUSD (relevance varies)\nConfirmed: Scheduled calendar event; time subject to change.\nInterpretation: Volatility may rise; direction is uncertain. No trade signal.\nSource: '+SOURCE;
}
export async function runReminders(env,{now=Date.now(),fetchImpl=fetch}={}){
 if(!env.REMINDER_DB||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw Error('Missing REMINDER_DB or Telegram credentials');
 const upstream=await fetchImpl(FEED,{signal:AbortSignal.timeout(10000)});
 if(!upstream.ok)throw Error('Calendar HTTP '+upstream.status);
 const events=await upstream.json();
 if(!Array.isArray(events))throw Error('Invalid calendar response');
 const destinations=[...new Set([env.TELEGRAM_CHAT_ID,env.TELEGRAM_CHANNEL_ID].filter(Boolean))];
 let sent=0,skipped=0,failed=0;
 for(const raw of events.slice(0,1000)){
  const e=normalize(raw);if(!e||!due(e,now))continue;
  for(const destination of destinations){
   const key=eventKey(e,destination);
   const claim=await env.REMINDER_DB.prepare("INSERT OR IGNORE INTO reminder_delivery (event_key,status,lease_until,attempts) VALUES (?,'sending',?,1)").bind(key,now+120000).run();
   let acquired=(claim.meta?.changes??0)===1;
   if(!acquired){
    const retry=await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='sending',lease_until=?,attempts=attempts+1 WHERE event_key=? AND status!='sent' AND lease_until<? AND attempts<4").bind(now+120000,key,now).run();
    acquired=(retry.meta?.changes??0)===1;
   }
   if(!acquired){skipped++;continue;}
   try{
    const response=await fetchImpl('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:destination,text:format(e),parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok||result.ok!==true||!result.result?.message_id)throw Error('Telegram not acknowledged');
    await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='sent',lease_until=0,message_id=? WHERE event_key=? AND status='sending'").bind(String(result.result.message_id),key).run();sent++;
   }catch{
    failed++;
    await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='uncertain',lease_until=? WHERE event_key=? AND status='sending'").bind(now+120000,key).run();
   }
  }
 }
 return {sent,skipped,failed};
}
