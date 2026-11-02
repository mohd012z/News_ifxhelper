'use strict';
// Portable staging queue logic. A real deployment must persist these records in D1.
const {eventKey,selectEvents}=require('./whatsapp-notify');
const DESTINATIONS=new Set(['group','channel-draft']);
function makeJob(event,{destination,destinationId,stage='new'}={}) {
 if(!DESTINATIONS.has(destination)) throw Error('Unsupported destination');
 if(typeof destinationId!=='string'||!destinationId.trim()||destinationId.length>256) throw Error('Invalid destination identifier');
 const key=[destination,destinationId,eventKey(event,stage)].join('|');
 return {key,destination,destinationId,stage,status:'pending',attempts:0};
}
function enqueueUnique(queue,events,options) {
 if(!Array.isArray(queue)) throw TypeError('queue must be an array');
 const keys=new Set(queue.map(j=>j.key));
 const added=[];
 for(const e of selectEvents(events,options.impacts||['low','medium','high'])) {
  const job=makeJob(e,options);
  if(!keys.has(job.key)){keys.add(job.key);added.push(job);}
 }
 return {jobs:queue.concat(added),added};
}
function nextAttempt(job,nowMs,{maxAttempts=3,baseDelayMs=30000}={}) {
 if(!Number.isFinite(nowMs)||!Number.isInteger(job.attempts)||job.attempts<0) throw Error('Invalid attempt state');
 if(job.status==='delivered'||job.status==='cancelled'||job.status==='manual-published') return {...job};
 const attempts=job.attempts+1;
 return {...job,attempts,status:attempts>=maxAttempts?'dead-letter':'retry',nextAttemptAt:attempts>=maxAttempts?null:new Date(nowMs+Math.min(3600000,baseDelayMs*2**(attempts-1))).toISOString()};
}
module.exports={makeJob,enqueueUnique,nextAttempt};
