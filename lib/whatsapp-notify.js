'use strict';
// Staging-only WhatsApp Cloud API adapter. No network call without explicit dryRun:false.
const IMPACTS = new Set(['low','medium','high']);
function normalizeImpact(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'med' || v === 'moderate' ? 'medium' : v;
}
function selectEvents(events, allowed=['low','medium','high']) {
  const set = new Set(allowed.map(normalizeImpact).filter(x=>IMPACTS.has(x)));
  return (Array.isArray(events) ? events : []).filter(e=>set.has(normalizeImpact(e.importance || e.impact)));
}
function eventKey(e, stage='new') {
  return ['economic-event',String(e.date||''),String(e.timeMyt||''),String(e.event||e.title||''),normalizeImpact(e.importance||e.impact),String(stage)].join('|');
}
function validateConfig({phoneNumberId,accessToken,recipient,templateName,language='en_US'}) {
  if(!/^\d{5,25}$/.test(String(phoneNumberId||''))) throw Error('Invalid WhatsApp phone number ID');
  if(typeof accessToken!=='string'||accessToken.length<16) throw Error('Missing WhatsApp access token');
  if(!/^\d{7,15}$/.test(String(recipient||''))) throw Error('Invalid E.164 recipient digits');
  if(!/^[a-z][a-z0-9_]{0,511}$/.test(String(templateName||''))) throw Error('Invalid approved template name');
  if(!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw Error('Invalid template language');
}
async function sendApprovedTemplate(config, parameters, {dryRun=true, fetchImpl=globalThis.fetch, optedIn=false}={}) {
  if(!optedIn) throw Error('Recipient opt-in required');
  validateConfig(config);
  if(!Array.isArray(parameters)||parameters.length>10||parameters.some(x=>typeof x!=='string'||x.length>1024)) throw Error('Invalid template parameters');
  const body={messaging_product:'whatsapp',to:String(config.recipient),type:'template',template:{name:config.templateName,language:{code:config.language||'en_US'},components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}]}};
  if(dryRun) return {ok:false,dryRun:true,request:body};
  if(typeof fetchImpl!=='function') throw Error('Missing fetch implementation');
  const response=await fetchImpl('https://graph.facebook.com/v21.0/'+encodeURIComponent(config.phoneNumberId)+'/messages',{method:'POST',headers:{Authorization:'Bearer '+config.accessToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error) return {ok:false,status:response.status,errorCode:data.error?.code||null};
  return {ok:true,messageId:data.messages?.[0]?.id||null};
}
module.exports={normalizeImpact,selectEvents,eventKey,validateConfig,sendApprovedTemplate};
