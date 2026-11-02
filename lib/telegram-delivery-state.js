'use strict';
// Pure state transitions. Persist records atomically before/after dispatch.
function approve(job,{reviewer,nowMs}={}) {
 if(!job||job.status!=='pending-approval')throw Error('Job is not pending approval');
 if(typeof reviewer!=='string'||!reviewer.trim()||!Number.isFinite(nowMs))throw Error('Reviewer and clock required');
 return {...job,status:'approved',approvedBy:reviewer,approvedAt:new Date(nowMs).toISOString()};
}
function reserve(job,{attemptId,nowMs}={}) {
 if(!job||!['approved','retry'].includes(job.status))throw Error('Job cannot be reserved');
 if(typeof attemptId!=='string'||!attemptId.trim()||!Number.isFinite(nowMs))throw Error('Attempt ID and clock required');
 if(job.nextAttemptAt&&Date.parse(job.nextAttemptAt)>nowMs)throw Error('Retry is not due');
 return {...job,status:'in-flight',attemptId,attemptedAt:new Date(nowMs).toISOString()};
}
function recover(job) {
 if(!job||job.status!=='in-flight')return job;
 return {...job,status:'uncertain',failureCategory:'unknown-send-outcome',nextAttemptAt:null};
}
module.exports={approve,reserve,recover};
