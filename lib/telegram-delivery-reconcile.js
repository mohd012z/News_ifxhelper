'use strict';
// Pure dispatch reconciliation; caller persists these records in a durable store.
function receiptMatchesDestination(job, response) {
 const expected = String(job.chatId ?? '').trim();
 if (!expected) return false;
 const chat = response?.chat || {};
 if (expected.startsWith('@')) {
  const username = String(response?.chatUsername ?? chat.username ?? '').replace(/^@/, '');
  return username.length > 0 && username.toLowerCase() === expected.slice(1).toLowerCase();
 }
 const actual = response?.chatId ?? chat.id;
 return actual !== undefined && actual !== null && String(actual) === expected;
}
function reconcileDelivery(job,response,nowMs,{maxAttempts=5}={}) {
 if(!job||typeof job.key!=='string'||!Number.isFinite(nowMs))throw Error('Invalid delivery record');
 // Unknown outcomes require operator reconciliation, never automatic resending.
 if(job.status==='delivered'||job.status==='uncertain')return {...job};
 const attempts=(Number.isInteger(job.attempts)?job.attempts:0)+1;
 const acknowledged=response?.ok===true;
 const validReceipt=Number.isSafeInteger(response?.messageId)&&response.messageId>0&&receiptMatchesDestination(job,response);
 if(acknowledged&&validReceipt&&response?.uncertain!==true)
  return {...job,status:'delivered',attempts,messageId:response.messageId,deliveredAt:new Date(nowMs).toISOString(),nextAttemptAt:null};
 if(response?.uncertain===true||acknowledged)
  return {...job,status:'uncertain',attempts,messageId:null,nextAttemptAt:null,failureCategory:'uncertain'};
 const rate=response?.status===429;
 const retryAfter=Number.isInteger(response?.retryAfter)&&response.retryAfter>=1&&response.retryAfter<=3600?response.retryAfter*1000:0;
 const delay=Math.max(retryAfter,Math.min(3600000,30000*2**Math.min(attempts-1,6)));
 const terminal=attempts>=maxAttempts;
 return {...job,status:terminal?'dead-letter':'retry',attempts,messageId:null,nextAttemptAt:terminal?null:new Date(nowMs+delay).toISOString(),failureCategory:rate?'rate-limited':'failed'};
}
module.exports={reconcileDelivery};
