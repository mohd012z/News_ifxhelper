'use strict';
const {selectEvents,eventKey}=require('./whatsapp-notify.js');
const STAGES=[30,10,2];
function planReminders(events, nowMs, preferences={}) {
  if(!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const allowed=preferences.impacts||['low','medium','high'];
  const requested=preferences.stages||STAGES;
  const stages=STAGES.filter(x=>requested.includes(x));
  const result=[];
  for(const e of selectEvents(events,allowed)) {
    const time=Date.parse(e.eventAtUtc||'');
    if(!Number.isFinite(time)) continue;
    const minutes=(time-nowMs)/60000;
    if(minutes<0||minutes>35) continue;
    // One stage per event per poll; do not send all three at T-2.
    const stage=stages.find(x=>minutes<=x&&minutes>Math.max(0,x-7));
    if(stage===undefined) continue;
    result.push({event:e,stage,key:eventKey(e,stage)});
  }
  return result;
}
function nextRetry(attempt,nowMs,retryAfterSeconds) {
  if(!Number.isInteger(attempt)||attempt<0||!Number.isFinite(nowMs)) throw new TypeError('Invalid retry input');
  const delay=Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0 ? retryAfterSeconds*1000 : Math.min(3600000,30000*Math.pow(2,Math.min(attempt,7)));
  return nowMs+Math.min(delay,3600000);
}
module.exports={planReminders,nextRetry};
