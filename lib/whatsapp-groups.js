'use strict';
// WhatsApp Groups API staging adapter. Every operation defaults to offline dry-run.
const {normalizeImpact,selectEvents,eventKey}=require('./whatsapp-notify');
const GROUP_FIELDS=['group_lifecycle_update','group_participants_update','group_settings_update','group_status_update'];
function assessEligibility(info={}) {
 const checks={
  officialBusinessAccount:info.officialBusinessAccount===true,
  cloudApiNumber:info.cloudApiNumber===true,
  messagingPermission:info.messagingPermission===true,
  webhookSubscribed:GROUP_FIELDS.every(x=>Array.isArray(info.webhookFields)&&info.webhookFields.includes(x)),
  billingAuthorized:info.billingAuthorized===true,
  approvedForGroupApi:info.approvedForGroupApi===true
 };
 return {eligible:Object.values(checks).every(Boolean),checks,missing:Object.keys(checks).filter(k=>!checks[k])};
}
function buildGroupMessage({groupId,text,impact}) {
 if(typeof groupId!=='string'||!/^[A-Za-z0-9_:-]{8,256}$/.test(groupId)) throw Error('Invalid API-managed group ID');
 if(typeof text!=='string'||!text.trim()||text.length>4096) throw Error('Invalid group message text');
 const level=normalizeImpact(impact);
 if(!['low','medium','high'].includes(level)) throw Error('Invalid impact level');
 return {messaging_product:'whatsapp',recipient_type:'group',to:groupId,type:'text',text:{preview_url:false,body:text}};
}
async function sendGroupMessage({phoneNumberId,accessToken,groupId,text,impact,eligibility},{dryRun=true,fetchImpl=globalThis.fetch}={}) {
 const gate=assessEligibility(eligibility);
 const body=buildGroupMessage({groupId,text,impact});
 if(dryRun) return {ok:false,dryRun:true,eligible:gate.eligible,missing:gate.missing,payload:body};
 if(!gate.eligible) throw Error('WhatsApp Groups API eligibility not verified');
 if(!/^\d{5,25}$/.test(String(phoneNumberId||''))||typeof accessToken!=='string'||accessToken.length<16) throw Error('Missing sender configuration');
 if(typeof fetchImpl!=='function') throw Error('Missing transport');
 const res=await fetchImpl('https://graph.facebook.com/v23.0/'+encodeURIComponent(phoneNumberId)+'/messages',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||data.error) return {ok:false,status:res.status,providerCode:data.error?.code||null};
 return {ok:true,messageId:data.messages?.[0]?.id||null};
}
module.exports={GROUP_FIELDS,assessEligibility,buildGroupMessage,sendGroupMessage,selectEvents,eventKey};
