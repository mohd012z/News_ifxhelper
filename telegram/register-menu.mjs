/** Explicit, manual-only Telegram cutover. Safe by default. */
import {pathToFileURL} from 'node:url';
import {COMMANDS} from './menu-bot.mjs';
export function validateConfig(env){
 const token=String(env.TELEGRAM_BOT_TOKEN||''), secret=String(env.TELEGRAM_WEBHOOK_SECRET||'');
 const allow=String(env.TELEGRAM_ALLOWED_CHAT_IDS||''), target=String(env.TELEGRAM_WEBHOOK_URL||'');
 if(!token||!/^[A-Za-z0-9_-]{16,256}$/.test(secret)||!target||!allow)throw Error('Required bot configuration missing');
 if(!allow.split(',').every(s=>/^-?[0-9]+$/.test(s.trim())))throw Error('Invalid chat allowlist');
 let url;try{url=new URL(target);}catch{throw Error('Invalid webhook URL');}
 const expectedHost=String(env.TELEGRAM_EXPECTED_WEBHOOK_HOST||'gentle-violet-4a79.ifxhelper.workers.dev').toLowerCase();
 if(url.protocol!=='https:'||url.host.toLowerCase()!==expectedHost||url.pathname!=='/api/telegram/webhook'||url.search||url.hash||url.username||url.password)throw Error('Unapproved webhook host or path');
 const expectedBot=String(env.TELEGRAM_EXPECTED_USERNAME||'news_ifxhelperbot').replace(/^@/,'').toLowerCase();
 return{token,secret,url,expectedBot};
}
export async function registerMenu({env=process.env,fetcher=fetch}={}){
 const cfg=validateConfig(env);
 const api=async (method,body={})=>{
  const r=await fetcher('https://api.telegram.org/bot'+cfg.token+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok!==true)throw Error('Telegram '+method+' HTTP '+r.status);
  return j.result;
 };
 const me=await api('getMe');
 if(String(me?.username||'').toLowerCase()!==cfg.expectedBot)throw Error('Bot identity mismatch (no changes)');
 const prior=await api('getWebhookInfo');
 if(prior?.url&&prior.url!==cfg.url.href&&env.TELEGRAM_WEBHOOK_REPLACE_ALLOWED!=='true')throw Error('Existing webhook owner conflict (no changes)');
 // The old static proxy returns HTML for GET and 405 for POST.
 const get=await fetcher(cfg.url.href,{method:'GET',signal:AbortSignal.timeout(10000)});
 if(get.status!==405)throw Error('Receiver not deployed: GET preflight expected 405');
 const post=await fetcher(cfg.url.href,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
 if(post.status!==403)throw Error('Receiver secrets not configured: anonymous POST expected 403');
 const changed=await api('setWebhook',{url:cfg.url.href,secret_token:cfg.secret,allowed_updates:['message','callback_query'],drop_pending_updates:false,max_connections:1});
 if(changed!==true)throw Error('setWebhook returned false');
 const current=await api('getWebhookInfo');
 if(current?.url!==cfg.url.href)throw Error('Webhook read-back mismatch; no commands changed');
 const commands=await api('setMyCommands',{commands:COMMANDS});
 if(commands!==true)throw Error('setMyCommands failed (webhook already changed)');
 const readback=await api('getMyCommands');
 if(!Array.isArray(readback)||readback.length!==COMMANDS.length||COMMANDS.some((x,i)=>readback[i]?.command!==x.command))throw Error('Commands read-back mismatch');
 return{bot:'@'+me.username,webhookHost:cfg.url.host,receiverReady:true,commandsVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--apply'))console.log('DRY RUN: no network calls or Telegram settings changed.');
 else try{console.log('VERIFIED CUTOVER '+JSON.stringify(await registerMenu()));}catch(e){console.error('CUTOVER BLOCKED: '+e.message);process.exitCode=1;}
}
