'use strict';
// Bridge confirmed research drafts into review-only, durable single-runner staging.
const {planTelegramDrafts}=require('./telegram-global-alert-drafts');
const {makeChannelReviewJobs}=require('./telegram-channel-readiness');
const {stageDraft}=require('./telegram-staging-coordinator');
function stageVerifiedAlerts(file,events,nowMs,options={}) {
 const drafts=planTelegramDrafts(events,nowMs,options);
 const jobs=makeChannelReviewJobs(drafts,{sentKeys:options.sentKeys||[]});
 return jobs.map(job=>stageDraft(file,job));
}
module.exports={stageVerifiedAlerts};
