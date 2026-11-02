'use strict';
// Pure planning logic: no network, credentials, or personal data stored.
const {selectEvents,eventKey}=require('./whatsapp-notify.js');
const STAGES=[30,10,2];
function planNotifications(events,nowMs,options={}) {
  if(!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const impacts=options.impacts||['low','medium','high'];
  const seen=new Set(options.sentKeys||[]);
  const candidates=[];
  for(const event of selectEvents(events,impacts)) {
    const timestamp=Date.parse(event.timeUtc||event.dateTimeUtc||'');
    if(!Number.isFinite(timestamp)) continue;
    const until=(timestamp-nowMs)/60000;
    if(until < 0 || until > 35) continue;
    for(const stage of STAGES) {
      // Each stage has a distinct 5-minute window; late executions never send all stages.
      if(until>stage || until<=Math.max(0,stage-5)) continue;
      const key=eventKey(event,stage);
      if(!seen.has(key)) candidates.push({key,stage,event,minutesUntil:Math.ceil(until)});
      break;
    }
  }
  return candidates;
}
function redactDeliveryResult(result) {
  return {ok:result?.ok===true,status:Number.isInteger(result?.status)?result.status:null,providerCode:Number.isInteger(result?.errorCode)?result.errorCode:null};
}
module.exports={planNotifications,redactDeliveryResult};
