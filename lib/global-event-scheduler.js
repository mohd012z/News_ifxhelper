'use strict';
// Research-only scheduler: no network sends, no automatic publishing.
const {planNotifications}=require('./whatsapp-reminder-planner');
const {buildResearchAlert}=require('./global-event-alerts');
const {evaluateEvidence}=require('./global-evidence-review');
const {makeJob}=require('./whatsapp-staging-queue');
function planStagingTriggers(stories,nowMs,{destination='channel-draft',destinationId='research-preview',sentKeys=[],impacts=['medium','high']}={}) {
 if(!Array.isArray(stories)||!Number.isFinite(nowMs)) throw TypeError('Invalid scheduling input');
 if(!['channel-draft','group'].includes(destination)) throw Error('Unsupported destination');
 const eligible=stories.filter(s=>evaluateEvidence(s,{nowMs}).confirmed);
 const scheduled=planNotifications(eligible,nowMs,{sentKeys,impacts});
 return scheduled.map(({key,stage,event,minutesUntil})=>{
   const alert=buildResearchAlert(event);
   const job=makeJob(event,{destination,destinationId,stage:String(stage)});
   return {key,stage,minutesUntil,job:{...job,status:'staging-review'},alert,requiresApproval:true,networkSend:false};
 });
}
module.exports={planStagingTriggers};
