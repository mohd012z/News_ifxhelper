import {menuView,upcomingView,analysisView} from './helix-news-menu.mjs';
import {authorizedAdmin} from './helix-review-policy.mjs';
const ACTIONS=new Set(['menu','upcoming','analysis','breaking','results','recheck','status']);
const COMMANDS=new Map([['/start','menu'],['/menu','menu'],['/upcoming','upcoming'],['/analysis','analysis'],['/breaking','breaking'],['/results','results'],['/recheck','recheck'],['/status','status']]);
function view(action,events,now){
 if(action==='menu')return menuView();
 if(action==='upcoming')return upcomingView(events,now);
 if(action==='analysis')return analysisView(events,now);
 const titles={breaking:'🚨 Breaking News',results:'📊 Results',recheck:'🔄 Recheck Sources',status:'📋 Delivery Status'};
 return {text:titles[action]+'\nStaging preview only. Verified source records are not connected to this menu yet.',reply_markup:{inline_keyboard:[[{text:'⬅️ Menu',callback_data:'hx:menu'}]]}};
}
export async function handleHelixStagingMenu(request,env,{fetchImpl=fetch,now=Date.now()}={}){
 if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
 if(env.ENABLE_HELIX_STAGING_MENU!=='true')return new Response('Not Found',{status:404});
 const secret=env.TELEGRAM_WEBHOOK_SECRET;
 if(typeof secret!=='string'||secret.length<24||secret.length>256||!env.HELIX_REVIEW_DB?.prepare||!/^\d+:[A-Za-z0-9_-]{30,}$/.test(env.HELIX_STAGING_BOT_TOKEN||''))return new Response('Unavailable',{status:503});
 const received=request.headers.get('X-Telegram-Bot-Api-Secret-Token')||'';
 if(received.length!==secret.length)return new Response('Forbidden',{status:403});
 let mismatch=0;for(let i=0;i<secret.length;i++)mismatch|=secret.charCodeAt(i)^received.charCodeAt(i);
 if(mismatch)return new Response('Forbidden',{status:403});
 const body=await request.text();if(body.length>16384)return new Response('Payload Too Large',{status:413});
 let update;try{update=JSON.parse(body)}catch{return new Response('Bad Request',{status:400})}
 if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)return new Response('Bad Request',{status:400});
 const cb=update.callback_query,msg=cb?.message||update.message,actor=cb?.from?.id||msg?.from?.id;
 if(!authorizedAdmin(actor,env.HELIX_ADMIN_IDS)||msg?.chat?.type!=='private'||String(msg?.chat?.id)!==String(actor))return new Response('Forbidden',{status:403});
 const command=typeof msg?.text==='string'?msg.text.trim().split(/\s+/)[0].split('@')[0]:'';
 const action=cb?(/^hx:[a-z]+$/.test(cb.data||'')?cb.data.slice(3):null):COMMANDS.get(command);
 if(!ACTIONS.has(action))return Response.json({ok:true,action:'ignored'});
 // Never claim an update before transport credentials, permission and action validation.
 const claim=await env.HELIX_REVIEW_DB.prepare('INSERT OR IGNORE INTO helix_update_receipts(update_id,actor_id,command,created_at) VALUES (?,?,?,?)').bind(update.update_id,String(actor),'staging:'+action,now).run();
 if(claim.meta?.changes!==1)return Response.json({ok:true,action:'duplicate'});
 const preview=view(action,[],now); // Do not imply a live calendar feed is connected.
 const method=cb?'editMessageText':'sendMessage';
 const payload={chat_id:msg.chat.id,text:preview.text,reply_markup:preview.reply_markup,...(preview.parse_mode?{parse_mode:preview.parse_mode}:{})};
 if(cb)payload.message_id=msg.message_id;
 let response;
 try{response=await fetchImpl('https://api.telegram.org/bot'+env.HELIX_STAGING_BOT_TOKEN+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});}
 catch{return Response.json({ok:false,action:'delivery_uncertain',retry:'manual_reconciliation_required'},{status:502})}
 if(!response.ok)return Response.json({ok:false,action:'telegram_http_failure',status:response.status},{status:502});
 let result;try{result=await response.json()}catch{return Response.json({ok:false,action:'delivery_uncertain',retry:'manual_reconciliation_required'},{status:502})}
 if(result.ok!==true)return Response.json({ok:false,action:'telegram_rejected',description:String(result.description||'').slice(0,120)},{status:502});
 if(cb&&typeof cb.id==='string') {
  // Best effort: dismiss Telegram loading spinner. No channel sends.
  try{await fetchImpl('https://api.telegram.org/bot'+env.HELIX_STAGING_BOT_TOKEN+'/answerCallbackQuery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({callback_query_id:cb.id}),signal:AbortSignal.timeout(3000)})}catch{}
 }
 return Response.json({ok:true,action:'staging_menu_delivered',view:action,channel_publish:false});
}
