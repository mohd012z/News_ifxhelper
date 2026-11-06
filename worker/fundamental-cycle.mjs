import {normalizeEvent,instruments,morningDue,stage,deliveryKey,stance} from './fundamental-research.mjs';
const FEED='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const localDate=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
function textFor(event,phase,project){
 const assets=instruments(event,project).join(', ');
 if(phase==='RESULT')return '📊 <b>Verified event result</b>\n'+esc(event.title)+' ('+esc(event.currency)+')\nActual: '+esc(event.actual)+' | Forecast: '+esc(event.forecast??'N/A')+' | Previous: '+esc(event.previous??'N/A')+'\nPolicy hint: '+esc(stance(event).bias)+' (preliminary)\nMarkets: '+esc(assets);
 return '🔔 <b>'+esc(phase)+' '+esc(event.impact)+' impact</b>\n'+esc(event.title)+' ('+esc(event.currency)+')\nForecast: '+esc(event.forecast??'N/A')+' | Previous: '+esc(event.previous??'N/A')+'\nMarkets: '+esc(assets);
}
async function deliver(env,fetchImpl,key,destination,message,now){
 const claim=await env.REMINDER_DB.prepare("INSERT OR IGNORE INTO reminder_delivery(event_key,status,lease_until,attempts) VALUES (?,'sending',?,1)").bind(key,now+120000).run();
 if(claim.meta?.changes!==1)return 'skipped';
 try{
  const r=await fetchImpl('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:destination,text:message,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
  const data=await r.json();if(!r.ok||data.ok!==true||!data.result?.message_id)throw Error('Unacknowledged');
  const saved=await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='sent',lease_until=0,message_id=? WHERE event_key=? AND status='sending'").bind(String(data.result.message_id),key).run();
  if(saved.meta?.changes!==1)throw Error('Ledger mismatch');return 'sent';
 }catch{
  await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='uncertain' WHERE event_key=? AND status='sending'").bind(key).run();
  return 'uncertain';
 }
}
export async function runFundamentalCycle(env,{now=Date.now(),fetchImpl=fetch}={}){
 if(env.ENABLE_FUNDAMENTAL_DELIVERY!=='true')return {disabled:true};
 const project=env.FUNDAMENTAL_PROJECT;
 if(!['news_ifxhelper','helix'].includes(project)||!env.REMINDER_DB||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw Error('Missing research configuration');
 const res=await fetchImpl(FEED,{signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('Calendar unavailable');
 const raw=await res.json();if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid feed');
 const events=raw.map(normalizeEvent).filter(e=>e&&instruments(e,project).length);
 const destinations=[...new Set([env.TELEGRAM_CHAT_ID,env.TELEGRAM_CHANNEL_ID].filter(Boolean))];
 const report={sent:0,skipped:0,uncertain:0,pending:0};
 for(const destination of destinations){
  if(morningDue(now)){
   const todays=events.filter(e=>localDate(e.time)===localDate(now)).sort((a,b)=>a.time-b.time);
   const lines=todays.slice(0,60).map(e=>esc(e.currency)+' '+esc(e.title)+' ['+esc(e.impact)+'] Forecast: '+esc(e.forecast??'N/A'));
   const message='☀️ <b>08:00 MYT fundamental briefing</b>\n'+(lines.join('\n')||'No relevant scheduled events in the verified feed')+'\nForecasts are not confirmed results.';
   const result=await deliver(env,fetchImpl,JSON.stringify([project,destination,'DAILY',localDate(now)]),destination,message,now);report[result]++;
  }
  for(const e of events){
   const phase=stage(e,now);if(!phase)continue;
   if(phase==='RESULT'&&(e.actual===null||String(e.actual).trim()==='')){report.pending++;continue;}
   const result=await deliver(env,fetchImpl,deliveryKey(project,e,destination,phase),destination,textFor(e,phase,project),now);report[result]++;
  }
 }
 return report;
}
