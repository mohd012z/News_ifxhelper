/** Read-only Telegram identity/webhook probe; does not modify Telegram settings. */
const expected=String(process.env.TELEGRAM_EXPECTED_USERNAME||'news_ifxhelperbot').replace(/^@/,'').toLowerCase();
const token=process.env.TELEGRAM_BOT_TOKEN;
if(process.argv.includes('--dry-run')){console.log('DRY_RUN: getMe and getWebhookInfo only');process.exit(0);}
if(!token){console.error('BLOCKED: TELEGRAM_BOT_TOKEN unavailable');process.exit(2);}
async function get(method){
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok!==true)throw Error(method+' failed HTTP '+response.status);
 return data.result;
}
try{
 const me=await get('getMe');
 const username=String(me?.username||'').toLowerCase();
 if(username!==expected)throw Error('Bot username mismatch: expected '+expected+', got '+(username||'unknown'));
 const info=await get('getWebhookInfo');
 let host=null;if(info?.url){try{host=new URL(info.url).host;}catch{host='invalid';}}
 const intended=String(process.env.TELEGRAM_EXPECTED_WEBHOOK_HOST||'').toLowerCase();
 const conflict=!!intended&&host!==intended;
 console.log(JSON.stringify({identityVerified:true,username:'@'+username,webhookConfigured:!!info?.url,webhookHost:host,pendingUpdates:Number(info?.pending_update_count||0),hasLastWebhookError:!!info?.last_error_date,expectedHost:intended||null,hostMatchesExpected:!conflict,readOnly:true}));
 if(conflict)process.exitCode=3;
}catch(error){console.error('Probe failed: '+error.message);process.exitCode=1;}
