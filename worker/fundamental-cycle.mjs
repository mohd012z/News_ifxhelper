import {normalizeEvent,instruments,deliveryKey,stance} from './fundamental-research.mjs';
const FEED='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const localDate=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
export function resultVerified(event){return event.actual!==null&&String(event.actual).trim()!==''&&event.verifiedSource==='official'&&typeof event.verifiedAt==='string'&&Number.isFinite(Date.parse(event.verifiedAt))&&event.verifiedAt.endsWith('Z')&&Number.isFinite(event.time)&&Date.parse(event.verifiedAt)>=event.time&&typeof event.officialUrl==='string'&&/^https:\/\//.test(event.officialUrl);}
export function briefingDue(now){const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);return local>='08:00'&&local<'12:00';}
export function phaseDue(event,now){const delta=(event.time-now)/60000;if(delta>25&&delta<=30)return 'T-30';if(delta>5&&delta<=10)return 'T-10';if(delta<=0&&delta>=-1440)return 'RESULT';return null;}
function textFor(event,phase,project){
 const assets=instruments(event,project).join(', ');
 if(phase==='RESULT'){const hint=stance(event);const source=event.officialUrl||'';return '📊 <b>Economic release — source reported</b>\n'+esc(event.title)+' ('+esc(event.currency)+')\nActual: '+esc(event.actual)+' | Forecast: '+esc(event.forecast??'N/A')+' | Previous: '+esc(event.previous??'N/A')+'\n🧭 Data hint: <b>'+esc(hint.bias.toUpperCase())+'</b> (preliminary)\nEvidence: '+esc(hint.reason)+'\nSource URL: '+esc(source)+'\nSource timestamp (UTC): '+esc(event.verifiedAt)+'\nVerification: source attribution supplied; independent source authentication not established.\nMarkets monitored: '+esc(assets)+'\nNot a central-bank decision or trade recommendation.';}
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
export async function inspectUncertainDeliveries(env){
 if(!env.REMINDER_DB)throw Error('Missing REMINDER_DB');
 const rows=await env.REMINDER_DB.prepare("SELECT event_key,lease_until,attempts FROM reminder_delivery WHERE status='uncertain' ORDER BY lease_until LIMIT 100").all();
 if(!Array.isArray(rows.results))throw Error('Invalid D1 response');
 return rows.results.map(r=>({eventKey:r.event_key,leaseUntil:r.lease_until,attempts:r.attempts,requiresManualReconciliation:true}));
}
export async function reconcileConfirmedDelivery(env,{eventKey,messageId}){
 if(!env.REMINDER_DB||typeof eventKey!=='string'||!eventKey||!Number.isSafeInteger(messageId)||messageId<=0)throw Error('Verified Telegram message evidence required');
 const saved=await env.REMINDER_DB.prepare("UPDATE reminder_delivery SET status='sent',lease_until=0,message_id=? WHERE event_key=? AND status='uncertain'").bind(String(messageId),eventKey).run();
 return {reconciled:saved.meta?.changes===1};
}
export async function runFundamentalCycle(env,{now=Date.now(),fetchImpl=fetch,officialResolver=null}={}){
 if(env.ENABLE_FUNDAMENTAL_DELIVERY!=='true')return {disabled:true};
 const project=env.FUNDAMENTAL_PROJECT;
 if(!['news_ifxhelper','helix'].includes(project)||!env.REMINDER_DB||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw Error('Missing research configuration');
 const res=await fetchImpl(FEED,{signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('Calendar unavailable');
 const raw=await res.json();if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid feed');
 const events=raw.map(item=>{const e=normalizeEvent(item);return e?{...e,verifiedSource:item.verifiedSource??null,verifiedAt:item.verifiedAt??null}:null;}).filter(e=>e&&instruments(e,project).length);
 const destinations=[...new Set([env.TELEGRAM_CHAT_ID,env.TELEGRAM_CHANNEL_ID].filter(Boolean))];
 const report={sent:0,skipped:0,uncertain:0,pending:0};
 for(const destination of destinations){
  if(briefingDue(now)){
   const todays=events.filter(e=>localDate(e.time)===localDate(now)).sort((a,b)=>a.time-b.time);
   const lines=todays.slice(0,60).map(e=>esc(e.currency)+' '+esc(e.title)+' ['+esc(e.impact)+'] Forecast: '+esc(e.forecast??'N/A'));
   const message='☀️ <b>08:00 MYT fundamental briefing</b>\n'+(lines.join('\n')||'No relevant scheduled events in the verified feed')+'\nForecasts are not confirmed results.';
   const result=await deliver(env,fetchImpl,JSON.stringify([project,destination,'DAILY',localDate(now)]),destination,message,now);report[result]++;
  }
  for(const e of events){
   const phase=phaseDue(e,now);if(!phase)continue;
   let verified=e;
   if(phase==='RESULT'){
    if(typeof officialResolver!=='function'){report.pending++;continue;}
    try{
     const official=await officialResolver(Object.freeze({...e}));
     verified={...e,actual:official?.actual??null,verifiedSource:official?.verifiedSource??null,verifiedAt:official?.verifiedAt??null,officialUrl:official?.officialUrl??null};
     if(!resultVerified(verified)){report.pending++;continue;}
    }catch{report.pending++;continue;}
   }
   const result=await deliver(env,fetchImpl,deliveryKey(project,e,destination,phase),destination,textFor(verified,phase,project),now);report[result]++;
  }
 }
 return report;
}
