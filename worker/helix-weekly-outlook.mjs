import {normalizeEvent,instruments} from './fundamental-research.mjs';
const FEED='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const esc=v=>String(v??'N/A').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const mytParts=ms=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(ms).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
export function weeklyDue(now){const p=mytParts(now);return p.weekday==='Mon'&&p.hour==='08'&&Number(p.minute)<15;}
export function weeklyKey(now,destination){const p=mytParts(now);return JSON.stringify(['HELIX_WEEKLY',destination,p.year,p.month,p.day]);}
export function weeklySummary(raw,now,project='news_ifxhelper'){
 if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid calendar feed');
 const end=now+7*86400000;
 const events=raw.map(normalizeEvent).filter(e=>e&&e.time>=now&&e.time<end&&instruments(e,project).length).sort((a,b)=>a.time-b.time);
 const byImpact={High:0,Medium:0,Low:0};events.forEach(e=>byImpact[e.impact]++);
 const lines=events.map(e=>{const p=mytParts(e.time);return esc(p.weekday+' '+p.day+'/'+p.month+' '+p.hour+':'+p.minute)+' MYT | '+esc(e.currency)+' '+esc(e.impact)+'\n'+esc(e.title.slice(0,100))+'\nF: '+esc(e.forecast)+' | P: '+esc(e.previous);});
 const header='🗓️ <b>HELIX weekly economic outlook</b>\nMonday 08:00 MYT | Next 7 days\nEvents: '+events.length+' | High: '+byImpact.High+' | Medium: '+byImpact.Medium+' | Low: '+byImpact.Low+'\n';
 const footer='\n🧭 <b>Pre-event analysis</b>\nHigh-impact releases may increase volatility. Hawkish/dovish direction cannot be established before verified actual data.\nXAUUSD, BTCUSD and Oil may respond to USD developments; effects and direction are uncertain.\nSource: economic calendar (schedule/forecasts subject to revision). Not trading advice.';
 // Telegram limits text to 4096 characters. Bound to 3800 including markup.
 let text=header;let included=0;
 for(const line of lines){if((text+'\n'+line+footer).length>3800)break;text+='\n'+line+'\n';included++;}
 if(included<lines.length)text+='\n… '+(lines.length-included)+' additional events omitted due to Telegram length limit.\n';
 return {text:text+footer,count:events.length,included,impact:byImpact};
}
export async function runWeeklyOutlook(env,{now=Date.now(),fetchImpl=fetch}={}){
 if(env.ENABLE_HELIX_WEEKLY_OUTLOOK!=='true')return {disabled:true};
 if(!weeklyDue(now))return {notDue:true};
 if(env.ENABLE_HELIX_CHANNEL_DELIVERY!=='true'||env.HELIX_CHANNEL_ONLY!=='true'||env.TELEGRAM_CHANNEL_ID!=='@ifxhelper2')throw Error('Weekly channel delivery not authorized');
 if(!env.REMINDER_DB||!env.TELEGRAM_BOT_TOKEN)throw Error('Missing weekly delivery dependencies');
 const res=await fetchImpl(FEED,{signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('Calendar unavailable');
 const summary=weeklySummary(await res.json(),now,'news_ifxhelper');
 const key=weeklyKey(now,'@ifxhelper2');
 const claim=await env.REMINDER_DB.prepare("INSERT OR IGNORE INTO reminder_delivery(event_key,status,lease_until,attempts) VALUES (?,'sending',?,1)").bind(key,now+120000).run();
 if(claim.meta?.changes!==1)return {skipped:true};
 try{
  const response=await fetchImpl('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:'@ifxhelper2',text:summary.text,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok||data.ok!==true||!Number.isSafeInteger(data.result?.message_id))throw Error('Unacknowledged');
  const saved=await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='sent',lease_until=0,message_id=? WHERE event_key=? AND status='sending'").bind(String(data.result.message_id),key).run();
  if(saved.meta?.changes!==1)throw Error('Ledger mismatch');
  return {sent:true,count:summary.count,included:summary.included};
 }catch{
  await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='uncertain' WHERE event_key=? AND status='sending'").bind(key).run();
  return {uncertain:true};
 }
}
