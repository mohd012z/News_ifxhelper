'use strict';
const {loadLedger,saveLedger,upsertJob}=require('./telegram-delivery-ledger');
const {approve,reserve,recover}=require('./telegram-delivery-state');
// Single-runner staging coordinator; no network sends.
function stageDraft(file,draft) {
 if(!draft||typeof draft.key!=='string'||!draft.key)throw Error('Draft key required');
 const ledger=loadLedger(file);
 const existing=ledger.jobs.find(j=>j.key===draft.key);
 if(existing)return existing;
 const job={...draft,status:'pending-approval',attempts:0};
 saveLedger(file,upsertJob(ledger,job));
 return job;
}
function transition(file,key,action,args={}) {
 const ledger=loadLedger(file);
 const current=ledger.jobs.find(j=>j.key===key);
 if(!current)throw Error('Unknown job');
 const next=action==='approve'?approve(current,args):action==='reserve'?reserve(current,args):action==='recover'?recover(current):null;
 if(!next)throw Error('Unsupported transition');
 saveLedger(file,upsertJob(ledger,next));
 return next;
}
module.exports={stageDraft,transition};
