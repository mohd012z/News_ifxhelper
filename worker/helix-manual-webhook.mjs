import {menuView,upcomingView,analysisView} from './helix-news-menu.mjs';
import {authorizedAdmin,validateNewsCandidate,resendDecision} from './helix-review-policy.mjs';

// Telegram update processing is intentionally staging-only and never publishes messages.
// Webhook secret validation must occur before parsing untrusted JSON.
export async function handleHelixWebhook(request,env) {
  if (request.method!=='POST') return new Response('Method Not Allowed',{status:405,headers:{Allow:'POST'}});
  if (env.ENABLE_HELIX_MANUAL_REVIEW!=='true') return new Response('Not Found',{status:404});
  const secret=env.TELEGRAM_WEBHOOK_SECRET;
  if(typeof secret!=='string'||secret.length<24||secret.length>256)return new Response('Unavailable',{status:503});
  const received=request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if(!received||received.length!==secret.length)return new Response('Forbidden',{status:403});
  let diff=0;for(let i=0;i<secret.length;i++)diff|=secret.charCodeAt(i)^received.charCodeAt(i);
  if(diff!==0)return new Response('Forbidden',{status:403});
  const length=Number(request.headers.get('content-length')||'0');
  if(!Number.isFinite(length)||length>16384)return new Response('Payload Too Large',{status:413});
  let update;
  try {const body=await request.text();if(body.length>16384)return new Response('Payload Too Large',{status:413});update=JSON.parse(body);}catch{return new Response('Bad Request',{status:400});}
  if(!update||!Number.isSafeInteger(update.update_id)||update.update_id<0)return new Response('Bad Request',{status:400});
  const msg=update.message;
  const actor=msg?.from?.id;
  if(!authorizedAdmin(actor,env.HELIX_ADMIN_IDS))return new Response('Forbidden',{status:403});
  if(msg?.chat?.type!=='private')return new Response('Forbidden',{status:403});
  const cmd=typeof msg.text==='string'?msg.text.trim():'';
  if(!/^\/(start|menu|upcoming|analysis|check|pending|resend)(?:\s|$)/.test(cmd))return Response.json({ok:true,action:'ignored'});
  if(!env.HELIX_REVIEW_DB)return new Response('Unavailable',{status:503});
  // One-time claim. Duplicate Telegram deliveries cannot execute a second action.
  const claim=await env.HELIX_REVIEW_DB.prepare('INSERT OR IGNORE INTO helix_update_receipts(update_id,actor_id,command,created_at) VALUES (?,?,?,?)').bind(update.update_id,String(actor),cmd.slice(0,256),Date.now()).run();
  if(claim.meta?.changes!==1)return Response.json({ok:true,action:'duplicate'});
  if(cmd==='/start'||cmd==='/menu')return Response.json({ok:true,action:'menu_preview',preview:menuView(),delivery:'disabled'});
  if(cmd==='/upcoming'||cmd==='/analysis'){
    // A preview only: no network calls or Telegram sends. Production feed adapter is pending.
    const view=cmd==='/upcoming'?upcomingView([],Date.now()):analysisView([],Date.now());
    return Response.json({ok:true,action:'news_preview',preview:view,feedStatus:'not_connected',delivery:'disabled'});
  }
  if(cmd==='/check'||cmd==='/pending'){
    return Response.json({ok:true,action:'review_requested',command:cmd,delivery:'disabled'});
  }
  // Never send from webhook. Resend requires an independently persisted approval
  // and atomic delivery claim, implemented in a separate staging-only workflow.
  return Response.json({ok:true,action:'resend_requires_review',delivery:'disabled'});
}

export async function claimReviewedResend(db,{eventKey,actorId,adminIds,record,candidate,confirmation,now=Date.now()}) {
  const decision=resendDecision({actorId,adminIds,record,candidate,confirmation,now});
  if(!decision.allowed)return {...decision,claimed:false};
  if(!db?.prepare)return {allowed:false,reason:'missing_database',claimed:false};
  // Only one concurrent caller may transition a sent record to a pending manual resend.
  const result=await db.prepare("UPDATE helix_news_delivery SET status='manual_pending',reviewed_by=?,updated_at=? WHERE event_key=? AND status='sent' AND message_id=?").bind(String(actorId),now,eventKey,String(record.messageId)).run();
  const claimed=result.meta?.changes===1;
  return {allowed:claimed,reason:claimed?'claimed':'conflict_or_stale',claimed};
}
