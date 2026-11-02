'use strict';
// Pure dispatch reconciliation; caller persists these records in a durable store.
function reconcileDelivery(job,response,nowMs,{maxAttempts=5}={}) {
 if(!job||typeof job.key!=='string'||!Number.isFinite(nowMs))throw Error('Invalid delivery record');
 if(job.status==='delivered')return {...job};
 const attempts=(Number.isInteger(job.attempts)?job.attempts:0)+1;
 const ok=response?.ok===true&&Number.isInteger(response.messageId)&&response.messageId>0;
 if(ok)return {...job,status:'delivered',attempts,messageId:response.messageId,deliveredAt:new Date(nowMs).toISOString(),nextAttemptAt:null};
 const rate=response?.status===429;
 const retryAfter=Number.isInteger(response?.retryAfter)&&response.retryAfter>=1&&response.retryAfter<=3600?response.retryAfter*1000:0;
 const delay=Math.max(retryAfter,Math.min(3600000,30000*2**Math.min(attempts-1,6)));
 const terminal=attempts>=maxAttempts;
 return {...job,status:terminal?'dead-letter':'retry',attempts,messageId:null,nextAttemptAt:terminal?null:new Date(nowMs+delay).toISOString(),failureCategory:rate?'rate-limited':response?.uncertain===true?'uncertain':'failed'};
}
module.exports={reconcileDelivery};
