/** Explicit operator-only webhook cutover. Dry-run default; never drops pending updates. */
import {COMMANDS} from './menu-bot.mjs';
const apply=process.argv.includes('--apply');
const token=process.env.TELEGRAM_BOT_TOKEN;
const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
const endpoint=process.env.TELEGRAM_WEBHOOK_URL;
const expected=String(process.env.TELEGRAM_EXPECTED_USERNAME||'news_ifxhelperbot').replace(/^@/,'').toLowerCase();
if(!apply){console.log('DRY RUN: no Telegram API calls. To activate, configure Worker secrets, chat allowlist and endpoint, then run with --apply after owner review.');process.exit(0);}
if(!token || !/^[A-Za-z0-9_-]{16,256}$/.test(secret||'') || !endpoint || !process.env.TELEGRAM_ALLOWED_CHAT_IDS){
 console.error('Missing bot token, strong webhook secret, webhook URL or allowed chat IDs.');process.exit(2);
}
let url;
try {url=new URL(endpoint);}catch {console.error('Invalid webhook URL');process.exit(2);}
if(url.protocol!=='https:'||url.pathname!=='/api/telegram/webhook'||url.username||url.password||url.search||url.hash){
 console.error('Webhook must be a clean HTTPS /api/telegram/webhook URL.');process.exit(2);
}
if(!process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(',').every(s=>/^-?\d+$/.test(s.trim()))){console.error('Invalid allowed chat IDs');process.exit(2);}
async function api(method,payload={}){
 const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.ok!==true)throw Error(method+' rejected (HTTP '+r.status+')');return j.result;
}
try{
 const identity=await api('getMe');
 if(String(identity.username||'').toLowerCase()!==expected)throw Error('Connected token belongs to another Telegram bot; refusing cutover');
 const old=await api('getWebhookInfo');
 if(old.url&&old.url!==url.toString()&&process.env.TELEGRAM_WEBHOOK_REPLACE_ALLOWED!=='true')throw Error('An existing webhook is owned by another endpoint. No changes made.');
 const commands=await api('setMyCommands',{commands:COMMANDS});
 if(!commands)throw Error('setMyCommands returned false');
 const ok=await api('setWebhook',{url:url.toString(),secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false,max_connections:1});
 if(!ok)throw Error('setWebhook returned false');
 const current=await api('getWebhookInfo');
 if(current.url!==url.toString())throw Error('Webhook verification mismatch');
 console.log('Menu commands registered and webhook configured for @'+identity.username+'; URL '+url.origin+url.pathname+'. Live callback delivery still needs acceptance testing.');
}catch(e){console.error('Cutover refused or failed: '+e.message);process.exitCode=1;}